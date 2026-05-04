import { memo, useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { useTimelineStore } from '../stores/timeline-store';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { useGapHoverStore } from '../stores/gap-hover-store';

interface TrackGapGhostsProps {
  trackId: string;
  trackHeight: number;
}

export const TrackGapGhosts = memo(function TrackGapGhosts({
  trackId,
  trackHeight,
}: TrackGapGhostsProps) {
  const { frameToPixels } = useTimelineZoomContext();
  const closeGapOnTrackAtPosition = useTimelineStore((s) => s.closeGapOnTrackAtPosition);
  const active = useGapHoverStore((s) => s.active);

  const handleClick = useCallback(() => {
    if (!active) return;
    const midFrame = Math.round((active.gapStart + active.gapEnd) / 2);
    // Always anchor the ripple-close to the originally hovered track so the
    // shift origin matches what the user pointed at; linked counterparts on
    // mirrored tracks come along via buildLinkedLeftShiftUpdates.
    closeGapOnTrackAtPosition(active.hoveredTrackId, midFrame);
    // Cursor may stay still after the click — clear so the ghost doesn't
    // linger over the now-closed region until the next mousemove.
    useGapHoverStore.getState().setActive(null);
  }, [active, closeGapOnTrackAtPosition]);

  if (!active || !active.trackIds.includes(trackId)) return null;

  const left = frameToPixels(active.gapStart);
  const right = frameToPixels(active.gapEnd);
  const width = right - left;
  if (width < 14) return null;

  const buttonSize = Math.min(26, Math.max(16, trackHeight - 10));
  const buttonWidth = Math.min(buttonSize, Math.max(14, width - 4));

  return (
    <div
      className="absolute top-0 bottom-0 z-20 pointer-events-none flex items-center justify-center rounded-sm border border-dashed border-destructive/50 bg-destructive/10"
      style={{
        left: `${left}px`,
        width: `${width}px`,
      }}
    >
      <button
        type="button"
        aria-label="Ripple delete gap"
        title="Ripple delete gap"
        className="pointer-events-auto flex items-center justify-center rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm"
        style={{
          width: buttonWidth,
          height: buttonSize,
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          handleClick();
        }}
      >
        <Trash2 size={Math.max(10, Math.min(14, buttonSize - 8))} />
      </button>
    </div>
  );
});
