/**
 * Out-of-credits modal — shown when api.kubeez.com returns
 * `insufficient_credits` (HTTP 400) on a generate request.
 *
 * Two purchase paths, mirrored from kubeez.com /billing:
 *
 *   - **Top-up tab**: one-time credit packs (`credit_bundles` table → 4
 *     tiers S/M/L/XL). Card colors mirror the kubeez.com `TopUpCard`
 *     palette so this never looks like a different app — muted/light for
 *     S, deep indigo M, brand red L, dark teal XL. Clicking a card invokes
 *     the `stripe-credit-checkout` edge function with the user's session
 *     JWT and opens the returned Stripe URL in a new tab.
 *
 *   - **Subscribe tab**: monthly subscription plans (`subscription_plans`
 *     table). Same color cascade per tier (creator → muted, pro → indigo,
 *     enterprise → red, powerhouse → teal). Invokes
 *     `stripe-subscription-checkout`.
 *
 * If anything fails (no Supabase session, edge function error, empty
 * tables), there's always a "View all on kubeez.com/billing" deep-link
 * fallback so the user is never trapped.
 */

import * as React from 'react';
import { Coins, CreditCard, ExternalLink, Loader2, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KUBEEZ_BRAND_LOGO_URL } from '@/components/brand/kubeez-cut-logo';
import { cn } from '@/shared/ui/cn';
import {
  fetchKubeezCreditBundles,
  fetchKubeezSubscriptionPlans,
  formatBundlePrice,
  startKubeezCreditCheckout,
  startKubeezSubscriptionCheckout,
  type KubeezCreditBundle,
  type KubeezSubscriptionPlan,
} from '@/infrastructure/kubeez/kubeez-credit-bundles';
import { useInsufficientCreditsModal } from './insufficient-credits-store';

const KUBEEZ_BILLING_URL = 'https://kubeez.com/billing';

/**
 * Tier color cascade — copied verbatim from the kubeez.com TopUpCard /
 * PricingCard. Hex literals (not Tailwind tokens) keep the cards visually
 * identical to the main app regardless of the editor's theme tokens.
 *
 * `light` tiers render dark text on a muted surface. All others render
 * white text on a saturated dark gradient. Same dichotomy drives the Buy
 * button color (white-on-dark vs. dark-on-light).
 */
type TierStyle = {
  gradient: string;
  /** True when the card surface is light enough to need dark text. */
  light: boolean;
};

const CREDIT_TIER_STYLE: Record<string, TierStyle> = {
  's': {
    gradient: 'from-muted/60 to-muted/40 border-border/60',
    light: true,
  },
  'm': {
    gradient: 'from-[#3F4391] to-[#2F3375] border-[#3F4391]/30',
    light: false,
  },
  'l': {
    gradient: 'from-[#DC2626] to-[#B91C1C] border-[#DC2626]/30',
    light: false,
  },
  'xl': {
    gradient: 'from-[#1A3D2E] to-[#0F2419] border-[#1A3D2E]/30',
    light: false,
  },
};

const SUBSCRIPTION_TIER_STYLE: Record<string, TierStyle> = {
  creator: { gradient: 'from-muted/60 to-muted/40 border-border/60', light: true },
  advanced: { gradient: 'from-muted/60 to-muted/40 border-border/60', light: true },
  starter: { gradient: 'from-muted/60 to-muted/40 border-border/60', light: true },
  pro: { gradient: 'from-[#3F4391] to-[#2F3375] border-[#3F4391]/30', light: false },
  enterprise: { gradient: 'from-[#DC2626] to-[#B91C1C] border-[#DC2626]/30', light: false },
  agency_plus: { gradient: 'from-[#1A3D2E] to-[#0F2419] border-[#1A3D2E]/30', light: false },
  powerhouse: { gradient: 'from-[#1A3D2E] to-[#0F2419] border-[#1A3D2E]/30', light: false },
};

const FALLBACK_STYLE: TierStyle = {
  gradient: 'from-muted/60 to-muted/40 border-border/60',
  light: true,
};

function creditTierKey(slug: string): keyof typeof CREDIT_TIER_STYLE {
  const m = /topup-(s|m|l|xl)/.exec(slug);
  return (m?.[1] as keyof typeof CREDIT_TIER_STYLE) ?? 's';
}

export function InsufficientCreditsModal() {
  const { isOpen, context, close } = useInsufficientCreditsModal();
  const [tab, setTab] = React.useState<'topup' | 'subscribe'>('topup');

  const [bundles, setBundles] = React.useState<KubeezCreditBundle[] | null>(null);
  const [plans, setPlans] = React.useState<KubeezSubscriptionPlan[] | null>(null);
  const [bundlesError, setBundlesError] = React.useState<string | null>(null);
  const [plansError, setPlansError] = React.useState<string | null>(null);
  const [bundlesLoading, setBundlesLoading] = React.useState(false);
  const [plansLoading, setPlansLoading] = React.useState(false);
  const [checkoutId, setCheckoutId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setTab('topup');
    setBundles(null);
    setPlans(null);
    setBundlesError(null);
    setPlansError(null);
    setBundlesLoading(true);
    setPlansLoading(true);

    fetchKubeezCreditBundles()
      .then((rows) => {
        if (!cancelled) setBundles(rows);
      })
      .catch((e) => {
        if (!cancelled) setBundlesError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setBundlesLoading(false);
      });

    fetchKubeezSubscriptionPlans()
      .then((rows) => {
        if (!cancelled) setPlans(rows);
      })
      .catch((e) => {
        if (!cancelled) setPlansError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleBuyBundle = async (bundle: KubeezCreditBundle) => {
    setCheckoutId(`bundle:${bundle.slug}`);
    try {
      const { checkoutUrl } = await startKubeezCreditCheckout(bundle.slug);
      window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
      close();
    } catch (e) {
      setBundlesError(e instanceof Error ? e.message : 'Checkout failed.');
    } finally {
      setCheckoutId(null);
    }
  };

  const handleSubscribe = async (plan: KubeezSubscriptionPlan) => {
    setCheckoutId(`plan:${plan.id}`);
    try {
      const { checkoutUrl } = await startKubeezSubscriptionCheckout(plan.id, plan.tier);
      window.open(checkoutUrl, '_blank', 'noopener,noreferrer');
      close();
    } catch (e) {
      setPlansError(e instanceof Error ? e.message : 'Checkout failed.');
    } finally {
      setCheckoutId(null);
    }
  };

  const handleViewAllPlans = () => {
    window.open(KUBEEZ_BILLING_URL, '_blank', 'noopener,noreferrer');
    close();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <img
              src={KUBEEZ_BRAND_LOGO_URL}
              alt=""
              aria-hidden="true"
              className="h-7 w-7 object-contain"
            />
            <DialogTitle className="text-base">Top up your Kubeez credits</DialogTitle>
          </div>
          <DialogDescription className="text-sm">
            You&apos;ve run out of credits. Pick a one-time top-up or subscribe
            for a recurring monthly allotment — checkout opens in a new tab.
            {context && (
              <span className="mt-1 block text-xs text-muted-foreground">{context}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'topup' | 'subscribe')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="topup" className="gap-2">
              <Coins className="h-4 w-4" />
              One-time top-up
            </TabsTrigger>
            <TabsTrigger value="subscribe" className="gap-2">
              <Repeat className="h-4 w-4" />
              Monthly subscription
            </TabsTrigger>
          </TabsList>

          <TabsContent value="topup" className="mt-3">
            <PurchaseGrid
              loading={bundlesLoading}
              error={bundlesError}
              loadingLabel="Loading credit packs…"
              empty={bundles?.length === 0}
              emptyLabel="No credit packs available right now."
            >
              {bundles?.map((bundle) => {
                const style = CREDIT_TIER_STYLE[creditTierKey(bundle.slug)] ?? FALLBACK_STYLE;
                return (
                  <PurchaseCard
                    key={bundle.slug}
                    style={style}
                    eyebrow={bundle.displayName}
                    bigNumber={bundle.credits.toLocaleString()}
                    bigNumberSuffix="credits"
                    price={formatBundlePrice(bundle.amountCents, bundle.currency)}
                    priceSuffix="one-time"
                    description={bundle.description}
                    cornerRibbon={
                      bundle.volumeDiscountPercent > 0
                        ? `−${bundle.volumeDiscountPercent}%`
                        : null
                    }
                    busy={checkoutId === `bundle:${bundle.slug}`}
                    anyBusy={checkoutId !== null}
                    onClick={() => void handleBuyBundle(bundle)}
                    cta="Buy"
                  />
                );
              })}
            </PurchaseGrid>
          </TabsContent>

          <TabsContent value="subscribe" className="mt-3">
            <PurchaseGrid
              loading={plansLoading}
              error={plansError}
              loadingLabel="Loading subscription plans…"
              empty={plans?.length === 0}
              emptyLabel="No subscriptions available right now."
            >
              {plans?.map((plan) => {
                const style = SUBSCRIPTION_TIER_STYLE[plan.tier] ?? FALLBACK_STYLE;
                return (
                  <PurchaseCard
                    key={plan.id}
                    style={style}
                    eyebrow={plan.displayName}
                    bigNumber={plan.monthlyCredits.toLocaleString()}
                    bigNumberSuffix="credits / month"
                    price={formatBundlePrice(plan.monthlyPriceCents, plan.currency)}
                    priceSuffix="per month"
                    description={plan.description}
                    cornerRibbon={null}
                    busy={checkoutId === `plan:${plan.id}`}
                    anyBusy={checkoutId !== null}
                    onClick={() => void handleSubscribe(plan)}
                    cta="Subscribe"
                  />
                );
              })}
            </PurchaseGrid>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={handleViewAllPlans}
            className="gap-1.5 px-0 text-xs text-muted-foreground hover:text-foreground"
          >
            See full pricing on kubeez.com
            <ExternalLink className="h-3 w-3" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Internal building blocks
// ---------------------------------------------------------------------------

interface PurchaseGridProps {
  loading: boolean;
  error: string | null;
  loadingLabel: string;
  empty: boolean | undefined;
  emptyLabel: string;
  children: React.ReactNode;
}

function PurchaseGrid({ loading, error, loadingLabel, empty, emptyLabel, children }: PurchaseGridProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {loadingLabel}
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-2 py-2">
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {error}
        </div>
        <p className="text-xs text-muted-foreground">
          You can still purchase from kubeez.com directly via the link below.
        </p>
      </div>
    );
  }
  if (empty) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 py-1 sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}

interface PurchaseCardProps {
  style: TierStyle;
  eyebrow: string;
  bigNumber: string;
  bigNumberSuffix: string;
  price: string;
  priceSuffix: string;
  description: string | null;
  cornerRibbon: string | null;
  busy: boolean;
  anyBusy: boolean;
  cta: string;
  onClick: () => void;
}

function PurchaseCard({
  style,
  eyebrow,
  bigNumber,
  bigNumberSuffix,
  price,
  priceSuffix,
  description,
  cornerRibbon,
  busy,
  anyBusy,
  cta,
  onClick,
}: PurchaseCardProps) {
  const isLight = style.light;

  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden rounded-xl border bg-gradient-to-b p-4 shadow-sm transition-transform duration-200 hover:-translate-y-0.5',
        style.gradient,
        isLight ? 'text-foreground' : 'text-white'
      )}
    >
      {cornerRibbon && (
        <div className="pointer-events-none absolute right-0 top-0 z-20 h-[80px] w-[80px] overflow-hidden">
          <div className="absolute -right-[28px] top-[18px] w-[124px] rotate-45 bg-amber-400 py-1 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-amber-950 shadow-md">
            {cornerRibbon}
          </div>
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <div
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md',
            isLight ? 'bg-foreground/10' : 'bg-white/15'
          )}
        >
          <Coins className="h-4 w-4" />
        </div>
        <p className={cn('text-xs font-semibold uppercase tracking-wide', isLight ? 'text-muted-foreground' : 'text-white/70')}>
          {eyebrow}
        </p>
      </div>

      <div className="mb-3">
        <p className="text-2xl font-bold leading-none tracking-tight">{bigNumber}</p>
        <p className={cn('mt-1 text-[11px] uppercase tracking-wide', isLight ? 'text-muted-foreground' : 'text-white/60')}>
          {bigNumberSuffix}
        </p>
      </div>

      <div className="mb-4 flex-1">
        <p className="text-xl font-semibold leading-none tracking-tight">{price}</p>
        <p className={cn('mt-1 text-[11px]', isLight ? 'text-muted-foreground' : 'text-white/60')}>
          {priceSuffix}
        </p>
        {description && (
          <p className={cn('mt-2 line-clamp-2 text-[11px] leading-snug', isLight ? 'text-muted-foreground' : 'text-white/70')}>
            {description}
          </p>
        )}
      </div>

      <Button
        type="button"
        size="sm"
        onClick={onClick}
        disabled={busy || anyBusy}
        className={cn(
          'w-full font-semibold',
          isLight
            ? 'bg-foreground text-background hover:bg-foreground/90'
            : 'bg-white text-zinc-950 hover:bg-white/90'
        )}
      >
        {busy ? (
          <>
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            Starting…
          </>
        ) : (
          <>
            <CreditCard className="mr-2 h-3.5 w-3.5" />
            {cta}
          </>
        )}
      </Button>
    </div>
  );
}
