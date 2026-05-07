/**
 * Credit bundle catalog + checkout launcher for the editor.
 *
 * Mirrors `kubeez-website/src/services/credits/{publicCreditBundles,creditTopUp}.ts`
 * but talks to the same Supabase project from this codebase. Bundle list is
 * read straight from `credit_bundles` (RLS allows anon read of active rows).
 * Checkout is started via the `stripe-credit-checkout` edge function which
 * already accepts `Authorization: Bearer <session-jwt>` and CORS-allows
 * `*.kubeez.com` origins.
 *
 * Editor-side note: subscription discounts are not applied here — the
 * surfaced prices match what a non-subscriber would pay. Subscribers will
 * see their actual discount on the Stripe checkout page (the function
 * recomputes server-side using the JWT).
 */

import { supabase } from '@/infrastructure/supabase/client';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('KubeezCreditBundles');

export interface KubeezCreditBundle {
  slug: string;
  displayName: string;
  description: string | null;
  credits: number;
  /** ISO-4217 currency code (e.g. `USD`, `EUR`). */
  currency: string;
  /** Final amount the user will be charged, in the smallest currency unit (cents). */
  amountCents: number;
  /** Savings vs. the base small-bundle rate (rounded to nearest %). 0 when none. */
  volumeDiscountPercent: number;
  sortOrder: number;
}

interface CreditBundleRow {
  slug: string;
  display_name: string;
  description: string | null;
  credits: number;
  amount_cents: number;
  currency: string;
  metadata: Record<string, unknown> | null;
  sort_order: number;
}

export async function fetchKubeezCreditBundles(): Promise<KubeezCreditBundle[]> {
  if (!supabase) {
    throw new Error('Kubeez account not configured — cannot load credit bundles.');
  }

  const { data, error } = await supabase
    .from('credit_bundles')
    .select('slug, display_name, description, credits, amount_cents, currency, metadata, sort_order')
    .eq('is_active', true)
    .like('slug', 'topup-%')
    .order('sort_order', { ascending: true });

  if (error) {
    logger.warn('Bundle fetch failed', { message: error.message });
    throw new Error(error.message || 'Unable to load credit bundles.');
  }

  const rows = (data ?? []) as CreditBundleRow[];
  return rows.map((row) => {
    const volumePct =
      typeof row.metadata?.volume_discount_percent === 'number'
        ? Math.round(row.metadata.volume_discount_percent as number)
        : 0;
    return {
      slug: row.slug,
      displayName: row.display_name,
      description: row.description,
      credits: row.credits,
      currency: row.currency,
      amountCents: row.amount_cents,
      volumeDiscountPercent: volumePct,
      sortOrder: row.sort_order,
    };
  });
}

export interface StartCreditCheckoutResult {
  sessionId: string;
  /** URL to open in the browser to complete the Stripe checkout. */
  checkoutUrl: string;
}

export async function startKubeezCreditCheckout(
  bundleSlug: string
): Promise<StartCreditCheckoutResult> {
  if (!supabase) {
    throw new Error('Kubeez account not configured — sign in to buy credits.');
  }

  const { data, error } = await supabase.functions.invoke<{
    sessionId: string;
    checkoutUrl: string | null;
  }>('stripe-credit-checkout', {
    // Omit successUrl/cancelUrl so the function falls back to kubeez.com/billing
    // (the function's allow-list rejects non-`*.kubeez.com` redirects anyway).
    body: { bundleSlug },
  });

  if (error) {
    logger.warn('Checkout start failed', { bundleSlug, message: error.message });
    throw new Error(error.message || 'Could not start checkout.');
  }
  if (!data?.sessionId || !data.checkoutUrl) {
    throw new Error('Checkout response missing session — try again from kubeez.com/billing.');
  }

  return { sessionId: data.sessionId, checkoutUrl: data.checkoutUrl };
}

/** Format `amountCents` as a localized currency string (e.g. `$11.88`). */
export function formatBundlePrice(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amountCents / 100);
  } catch {
    // Fallback when currency code isn't recognized by Intl.
    return `${(amountCents / 100).toFixed(2)} ${currency}`;
  }
}

// ---------------------------------------------------------------------------
// Subscriptions (parallel surface to credit bundles)
// ---------------------------------------------------------------------------

export interface KubeezSubscriptionPlan {
  id: string;
  /** DB tier slug — `creator`, `pro`, `enterprise`, `agency_plus`, etc. */
  tier: string;
  /** Human-readable plan name (often pulled from tier label by the website; we display tier directly when null). */
  displayName: string;
  description: string | null;
  monthlyCredits: number;
  monthlyPriceCents: number;
  currency: string;
  billingInterval: 'month' | 'year';
}

interface SubscriptionPlanRow {
  id: string;
  tier: string;
  monthly_price_cents: number;
  monthly_credits: number;
  currency: string | null;
  description: string | null;
  billing_interval: string | null;
}

export async function fetchKubeezSubscriptionPlans(): Promise<KubeezSubscriptionPlan[]> {
  if (!supabase) {
    throw new Error('Kubeez account not configured — cannot load subscription plans.');
  }

  const { data, error } = await supabase
    .from('subscription_plans')
    .select('id, tier, monthly_price_cents, monthly_credits, currency, description, billing_interval')
    .eq('is_active', true)
    .eq('is_visible', true)
    .order('monthly_price_cents', { ascending: true });

  if (error) {
    logger.warn('Subscription fetch failed', { message: error.message });
    throw new Error(error.message || 'Unable to load subscription plans.');
  }

  const rows = (data ?? []) as SubscriptionPlanRow[];
  return rows
    // The editor's quick-purchase flow only handles monthly plans for now;
    // yearly tiers send users to /billing for the full picker.
    .filter((row) => (row.billing_interval ?? 'month') === 'month')
    .map((row) => ({
      id: row.id,
      tier: row.tier,
      displayName: prettifyTier(row.tier),
      description: row.description,
      monthlyCredits: row.monthly_credits,
      monthlyPriceCents: row.monthly_price_cents,
      currency: (row.currency ?? 'eur').toUpperCase(),
      billingInterval: 'month' as const,
    }));
}

function prettifyTier(tier: string): string {
  const map: Record<string, string> = {
    creator: 'Starter',
    advanced: 'Starter',
    pro: 'Pro',
    enterprise: 'Studio Pro',
    agency_plus: 'Powerhouse',
    powerhouse: 'Powerhouse',
  };
  return map[tier] ?? tier.split('_').map((s) => s[0]?.toUpperCase() + s.slice(1)).join(' ');
}

export async function startKubeezSubscriptionCheckout(
  planId: string,
  planTier: string
): Promise<StartCreditCheckoutResult> {
  if (!supabase) {
    throw new Error('Kubeez account not configured — sign in to subscribe.');
  }

  const { data, error } = await supabase.functions.invoke<{
    sessionId?: string;
    checkoutUrl?: string | null;
  }>('stripe-subscription-checkout', {
    body: { planId, planTier, billingInterval: 'month' },
  });

  if (error) {
    logger.warn('Subscription checkout failed', { planId, message: error.message });
    throw new Error(error.message || 'Could not start subscription checkout.');
  }
  if (!data?.sessionId || !data.checkoutUrl) {
    throw new Error('Checkout response missing session — try again from kubeez.com/billing.');
  }

  return { sessionId: data.sessionId, checkoutUrl: data.checkoutUrl };
}
