import { useEffect, useState } from 'react';
import type { KubeezPendingGeneration } from '@/features/media-library/types';
import { cn } from '@/shared/ui/cn';
import { Loader2 } from 'lucide-react';

function useElapsed(createdAt: number): number {
  const [elapsed, setElapsed] = useState(() => Math.max(0, (Date.now() - createdAt) / 1000));
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.max(0, (Date.now() - createdAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [createdAt]);
  return elapsed;
}

export function KubeezPendingGenerationCard({
  pending,
  viewMode = 'grid',
}: {
  pending: KubeezPendingGeneration;
  viewMode?: 'grid' | 'list';
}) {
  const elapsed = useElapsed(pending.createdAt);
  const eta = pending.estimatedTimeSeconds;
  const progress = eta && eta > 0 ? Math.min(0.95, elapsed / eta) : null;

  if (viewMode === 'list') {
    return (
      <div
        data-kubeez-pending-id={pending.id}
        className="panel-bg flex min-h-[3.25rem] items-stretch gap-3 overflow-hidden rounded-lg border border-dashed border-primary/35"
      >
        <div className="flex w-12 shrink-0 items-center justify-center border-r border-border/50 bg-muted/40">
          <Loader2 className="h-5 w-5 animate-spin text-primary/50" aria-hidden />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pr-2">
          <p className="truncate text-xs font-medium text-foreground">{pending.modelDisplayName}</p>
          <p className="text-[10px] text-muted-foreground">Generating…</p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-kubeez-pending-id={pending.id}
      className="panel-bg relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-primary/30 bg-muted/10"
    >
      {/* Progress ring */}
      <div className="relative mb-2 flex items-center justify-center">
        <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44">
          <circle
            cx="22" cy="22" r="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-muted/30"
          />
          {progress != null && (
            <circle
              cx="22" cy="22" r="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 18}`}
              strokeDashoffset={`${2 * Math.PI * 18 * (1 - progress)}`}
              className="text-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
            />
          )}
        </svg>
        <span className={cn(
          'absolute text-[10px] font-bold tabular-nums',
          progress != null ? 'text-foreground' : 'text-muted-foreground'
        )}>
          {progress != null ? `${Math.round(progress * 100)}%` : <Loader2 className="h-4 w-4 animate-spin text-primary/50" />}
        </span>
      </div>

      {/* Model name */}
      <p className="max-w-full truncate px-2 text-[10px] font-medium text-foreground/70">
        {pending.modelDisplayName}
      </p>
    </div>
  );
}
