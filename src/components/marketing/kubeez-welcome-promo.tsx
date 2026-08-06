import { useCallback, useEffect, useState } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { ExternalLink, Images, Check, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/ui/cn';

const STORAGE_KEY = 'kubeezcut.kubeezPromo.v1.dismissed';
const KUBEEZ_HOME = 'https://kubeez.com/';

/**
 * Task surfaces the promo must not interrupt: creating a project and the
 * editor itself. The promo waits for the next visit to any other route.
 */
const EXCLUDED_PATH_PREFIXES = ['/projects/new', '/editor'];

const FEATURES = [
  'AI video, images & music in one workspace',
  'Creator-ready models (Kling, Veo, Flux & more)',
  'Optional MCP integration for AI IDEs',
  'Pairs perfectly with KubeezCut for editing',
] as const;

function hasDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

function markDismissed(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * First-visit promo: Kubeez.com is the AI media platform; KubeezCut is the free browser editor.
 * Shown once per browser until dismissed.
 */
export function KubeezWelcomePromo() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isExcludedRoute = EXCLUDED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  useEffect(() => {
    if (!isExcludedRoute && !hasDismissed()) {
      setOpen(true);
    }
  }, [isExcludedRoute]);

  const dismiss = useCallback(() => {
    markDismissed();
    setOpen(false);
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) {
      dismiss();
    }
  }, [dismiss]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'gap-0 overflow-hidden rounded-2xl border border-border/80 p-0 shadow-2xl sm:rounded-2xl',
          'sm:max-w-[min(56rem,calc(100vw-1.5rem))] md:max-w-4xl',
          'bg-zinc-950 text-foreground',
        )}
        overlayClassName="bg-black/75 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out"
        hideCloseButton
      >
        <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:min-h-[min(420px,70vh)]">
          {/* Visual */}
          <div className="relative min-h-[200px] md:min-h-full overflow-hidden bg-zinc-900">
            <img
              src="/assets/landing/kubeez-models-grid.png"
              alt=""
              className="absolute inset-0 h-full w-full object-cover object-top"
              loading="eager"
              decoding="async"
            />
            <div
              className="absolute inset-0 bg-zinc-950/75 md:bg-zinc-950/80"
              aria-hidden
            />
            <div className="absolute bottom-4 left-4 right-4 md:bottom-8 md:left-6 md:right-auto md:max-w-[85%]">
              <p className="text-xs font-medium uppercase tracking-widest text-[#4E50BE]">
                Kubeez ecosystem
              </p>
              <p className="mt-1 text-lg font-semibold leading-snug text-white drop-shadow-md md:text-xl">
                Create with AI. Edit in the browser — free & open source.
              </p>
            </div>
          </div>

          {/* Copy */}
          <div className="relative flex flex-col justify-center gap-5 px-6 py-8 md:px-8 md:py-10">
            <button
              type="button"
              onClick={dismiss}
              className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/40 text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex flex-wrap items-center gap-2 pr-10">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4E50BE]/45 bg-[#4E50BE]/12 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#B4B5EE]">
                <Images className="h-3 w-3 text-[#4E50BE]" aria-hidden />
                AI media
              </span>
              <span className="inline-flex items-center rounded-full border border-[#4E50BE]/40 bg-[#4E50BE]/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#C8C9F2]">
                kubeez.com
              </span>
            </div>

            <div>
              <DialogTitle className="text-left text-2xl font-bold tracking-tight text-white md:text-3xl">
                <span className="text-[#4E50BE]">
                  Kubeez
                </span>
                <span className="text-white"> — video, images & music</span>
              </DialogTitle>
              <DialogDescription className="mt-3 text-left text-sm leading-relaxed text-zinc-400">
                KubeezCut is your free timeline editor. For generation and a full creative workspace,
                visit{' '}
                <span className="font-medium text-zinc-300">Kubeez.com</span>
                — professional AI tools used by creators and marketers worldwide.
              </DialogDescription>
            </div>

            <ul className="space-y-2.5" role="list">
              {FEATURES.map((line) => (
                <li key={line} className="flex gap-3 text-sm text-zinc-200">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#4E50BE]/18 text-[#4E50BE]">
                    <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
              <Button
                asChild
                className="w-full rounded-xl bg-[#4E50BE] px-6 text-base font-semibold text-white shadow-md shadow-[#4E50BE]/25 hover:bg-[#5F61C9] sm:w-auto"
              >
                <a href={KUBEEZ_HOME} target="_blank" rel="noopener noreferrer">
                  Explore Kubeez.com
                  <ExternalLink className="ml-2 h-4 w-4 opacity-90" aria-hidden />
                </a>
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full rounded-xl text-zinc-400 hover:bg-white/5 hover:text-zinc-200 sm:w-auto"
                onClick={dismiss}
              >
                Continue to KubeezCut
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
