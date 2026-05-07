import { ExternalLink } from 'lucide-react';
import { KubeezCutLogo } from '@/components/brand/kubeez-cut-logo';
import { MobileGateCanvasBackground } from '@/components/shell/mobile-gate-canvas-background';

/**
 * Full-viewport gate for viewports under 1000px wide.
 * The app shell is not rendered — only this screen.
 */
export function MobileNotAvailableScreen() {
  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="kubeezcut-mobile-gate-title"
      aria-describedby="kubeezcut-mobile-gate-desc"
    >
      <MobileGateCanvasBackground />
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-background/35 via-background/88 to-background"
        aria-hidden
      />

      <div className="relative z-10 flex max-w-md flex-col items-center gap-8">
        <KubeezCutLogo withWordmark size="lg" className="opacity-95 drop-shadow-sm" />

        <div className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#4E50BE]">
            Desktop today · Mobile coming soon
          </p>
          <h1
            id="kubeezcut-mobile-gate-title"
            className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
          >
            Open KubeezCut on a bigger stage
          </h1>
          <p
            id="kubeezcut-mobile-gate-desc"
            className="text-pretty text-sm leading-relaxed text-muted-foreground"
          >
            The editor is built for timelines and panels — it shines on a{' '}
            <span className="font-medium text-foreground">desktop-sized</span> window. Aim for at least{' '}
            <span className="whitespace-nowrap font-semibold text-foreground">1000px</span> width, then
            dive back in. We&apos;re actively working to bring the full editor to mobile —{' '}
            <span className="font-medium text-foreground">stay tuned</span>.
          </p>
        </div>

        <div className="w-full max-w-sm rounded-2xl border border-[#4E50BE]/45 bg-[#4E50BE]/14 px-4 py-4 shadow-lg shadow-[#4E50BE]/15 ring-1 ring-inset ring-white/5">
          <p className="text-sm font-medium leading-snug text-foreground">
            AI video, images & music on your phone
          </p>
          <a
            href="https://kubeez.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#4E50BE] px-4 py-3 text-center text-base font-semibold text-white shadow-md shadow-[#4E50BE]/35 transition-colors hover:bg-[#5F61C9] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4E50BE]"
          >
            Visit kubeez.com
            <ExternalLink className="h-4 w-4 shrink-0 opacity-95" aria-hidden />
          </a>
          <p className="mt-2.5 text-center text-xs text-muted-foreground">
            Full KubeezCut editor still needs a wide window. A mobile build is on the way.
          </p>
        </div>
      </div>
    </div>
  );
}
