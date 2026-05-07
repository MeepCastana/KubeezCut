import { useState, useRef, memo, useCallback, useEffect, useMemo } from 'react';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('TimelineTrack');
import type { TimelineTrack as TimelineTrackType } from '@/types/timeline';
import type { MediaMetadata } from '@/types/storage';
import { TimelineItem } from './timeline-item';
import { TransitionItem } from './transition-item';
import { TrackGapGhosts } from './track-gap-ghosts';
import { useGapHoverStore } from '../stores/gap-hover-store';
import { getLinkedItems } from '../utils/linked-items';
import { useTimelineStore } from '../stores/timeline-store';
import { useTrackDropPreviewStore, type TrackDropGhostPreview } from '../stores/track-drop-preview-store';
import { useVisibleItems } from '../hooks/use-visible-items';
import { useItemsStore } from '../stores/items-store';
import { useCompositionsStore } from '../stores/compositions-store';
import { useSelectionStore } from '@/shared/state/selection';
import { useTimelineZoomContext } from '../contexts/timeline-zoom-context';
import { useMediaLibraryStore } from '@/features/timeline/deps/media-library-store';
import {
  getMediaDragData,
  extractValidMediaFileEntriesFromDataTransfer,
} from '@/features/timeline/deps/media-library-resolver';
import { findNearestAvailableSpace } from '../utils/collision-utils';
import { resolveEffectiveTrackStates } from '../utils/group-utils';
import { useCompositionNavigationStore } from '../stores/composition-navigation-store';
import { wouldCreateCompositionCycle } from '../utils/composition-graph';
import {
  getDefaultGeneratedLayerDurationInFrames,
  isTimelineTemplateDragData,
} from '../utils/generated-layer-items';
import { findCompatibleTrackForItemType } from '../utils/track-item-compatibility';
import {
  getDroppedMediaDurationInFrames,
  type DroppableMediaType,
} from '../utils/dropped-media';
import { compositionHasOwnedAudio } from '../utils/dropped-composition';
import {
  buildGhostPreviewsFromTrackMediaDropPlan,
  planTrackMediaDropPlacements,
} from '../utils/track-media-drop';
import { executeTimelineMediaDrop } from '../utils/execute-timeline-media-drop';
import { getTimelineScrollContainer } from '../utils/timeline-scroll-container';
import { getTrackKind } from '../utils/classic-tracks';
import { AUDIO_NEW_LANE_TARGET_STRIP_FRACTION } from '../constants';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

interface TimelineTrackProps {
  track: TimelineTrackType;
  timelineWidth?: number;
}

// Type for ghost preview items during drag
type GhostPreviewItem = TrackDropGhostPreview;

interface DragMediaItem {
  mediaId: string;
  mediaType: DroppableMediaType;
  fileName: string;
  duration: number;
}

interface ExternalPreviewEntry {
  label: string;
  mediaType: DroppableMediaType;
  hasLinkedAudio?: boolean;
}

function getGhostHighlightClasses(ghostPreviews: GhostPreviewItem[]): string {
  if (ghostPreviews.some((ghost) => ghost.type === 'audio')) {
    return 'border-timeline-audio/60 bg-timeline-audio/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'video')) {
    return 'border-timeline-video/60 bg-timeline-video/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'text')) {
    return 'border-timeline-text/60 bg-timeline-text/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'shape')) {
    return 'border-timeline-shape/60 bg-timeline-shape/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'adjustment')) {
    return 'border-slate-400/60 bg-slate-400/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'image')) {
    return 'border-timeline-image/60 bg-timeline-image/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'composition')) {
    return 'border-violet-400/60 bg-violet-600/10';
  }
  if (ghostPreviews.some((ghost) => ghost.type === 'external-file')) {
    return 'border-primary/60 bg-primary/10';
  }
  return 'border-primary/50 bg-primary/10';
}

function ghostPreviewPillClassName(type: GhostPreviewItem['type']): string {
  const base =
    'absolute inset-y-0 rounded border-2 border-dashed pointer-events-none z-20 flex items-center px-2';
  if (type === 'composition') return `${base} border-violet-400 bg-violet-600/20`;
  if (type === 'external-file') return `${base} border-primary bg-primary/15`;
  if (type === 'video') return `${base} border-timeline-video bg-timeline-video/20`;
  if (type === 'audio') return `${base} border-timeline-audio bg-timeline-audio/20`;
  if (type === 'text') return `${base} border-timeline-text bg-timeline-text/20`;
  if (type === 'shape') return `${base} border-timeline-shape bg-timeline-shape/20`;
  if (type === 'adjustment') return `${base} border-slate-400 bg-slate-400/15`;
  return `${base} border-timeline-image bg-timeline-image/20`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDroppableMediaType(value: unknown): value is DroppableMediaType {
  return value === 'video' || value === 'audio' || value === 'image';
}

function computePreferNewAudioLaneFromPointer(
  clientY: number,
  trackRow: TimelineTrackType,
  trackRowEl: HTMLElement | null,
  treatAsAudioOnly: boolean,
): boolean {
  if (!treatAsAudioOnly || getTrackKind(trackRow) !== 'audio' || !trackRowEl) {
    return false;
  }
  const rect = trackRowEl.getBoundingClientRect();
  if (rect.height <= 0) {
    return false;
  }
  const ratioFromTop = (clientY - rect.top) / rect.height;
  return ratioFromTop >= (1 - AUDIO_NEW_LANE_TARGET_STRIP_FRACTION);
}

function dataTransferLooksAudioOnlyFiles(dataTransfer: DataTransfer): boolean {
  const fileItems = Array.from(dataTransfer.items).filter((item) => item.kind === 'file');
  if (fileItems.length === 0) {
    return false;
  }
  return fileItems.every((item) => typeof item.type === 'string' && item.type.startsWith('audio/'));
}

function isValidDragMediaItem(value: unknown): value is DragMediaItem {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DragMediaItem>;
  return isNonEmptyString(candidate.mediaId)
    && isDroppableMediaType(candidate.mediaType)
    && isNonEmptyString(candidate.fileName)
    && typeof candidate.duration === 'number'
    && Number.isFinite(candidate.duration);
}

/**
 * Custom equality for TimelineTrack memo - compares track and width only
 * Items are fetched from store internally, so we don't compare them here
 */
function areTrackPropsEqual(
  prev: TimelineTrackProps,
  next: TimelineTrackProps
): boolean {
  return prev.track === next.track && prev.timelineWidth === next.timelineWidth;
}

/**
 * Timeline Track Component
 *
 * Renders a single timeline track with:
 * - All items belonging to this track
 * - Appropriate height based on track settings
 * - Generic container that accepts any item types
 * - Drag-and-drop support for media from library
 */

export const TimelineTrack = memo(function TimelineTrack({ track }: TimelineTrackProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isExternalDragOver, setIsExternalDragOver] = useState(false);
  const [contextMenuFrame, setContextMenuFrame] = useState<number | null>(null);
  const [menuKey, setMenuKey] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const gapHoverRafRef = useRef<number | null>(null);
  const gapHoverLastClientXRef = useRef(0);
  const externalPreviewItemsRef = useRef<ExternalPreviewEntry[] | null>(null);
  const externalPreviewSignatureRef = useRef<string | null>(null);
  const externalPreviewPromiseRef = useRef<Promise<void> | null>(null);
  const externalPreviewTokenRef = useRef(0);
  const lastDragFrameRef = useRef(0);
  const lastDragPointerYRef = useRef(0);
  const preferNewAudioLaneRef = useRef(false);

  // Resolve whether this track is effectively disabled for drops.
  // Uses the shared resolveEffectiveTrackStates helper so group-inherited
  // locked/visible/muted flags are consistent with the rest of the codebase.
  const isDropDisabled = useTimelineStore((s) => {
    const effective = resolveEffectiveTrackStates(s.tracks).find((t) => t.id === track.id);
    if (!effective) return track.locked;
    if (effective.locked) return true;
    const kind = effective.kind;
    if (kind === 'audio') return effective.muted;
    if (kind === 'video') return effective.visible === false;
    return effective.visible === false || effective.muted;
  });

  // Virtualized items/transitions â€” only those overlapping the visible viewport + buffer
  const { visibleItems: trackItems, visibleTransitions: trackTransitions } = useVisibleItems(track.id);
  // Full item count â€” used for context menu guard (must not depend on virtualized subset)
  const hasAnyItems = useItemsStore((s) => (s.itemsByTrackId[track.id]?.length ?? 0) > 0);
  const fps = useTimelineStore((s) => s.fps);
  const closeGapOnTrackAtPosition = useTimelineStore((s) => s.closeGapOnTrackAtPosition);
  const allGhostPreviews = useTrackDropPreviewStore((s) => s.ghostPreviews);
  const setTrackGhostPreviews = useTrackDropPreviewStore((s) => s.setGhostPreviews);
  const clearTrackGhostPreviews = useTrackDropPreviewStore((s) => s.clearGhostPreviews);
  const getMedia = useMediaLibraryStore((s) => s.mediaItems);

  // Zoom utilities for position calculation
  const { pixelsToFrame, frameToPixels } = useTimelineZoomContext();
  const ghostPreviews = useMemo(
    () => allGhostPreviews.filter((ghost) => ghost.targetTrackId === track.id),
    [allGhostPreviews, track.id]
  );
  const previewAboveGhosts = useMemo(
    () => allGhostPreviews.filter((ghost) => ghost.previewAboveTrackId === track.id),
    [allGhostPreviews, track.id]
  );
  const previewBelowGhosts = useMemo(
    () => allGhostPreviews.filter((ghost) => ghost.previewBelowTrackId === track.id),
    [allGhostPreviews, track.id]
  );
  /** Drop lands on another lane (e.g. audio planned below while pointer is over V1) — avoid video lane “empty” highlight. */
  const activeGhostsTargetOnlyOtherTracks =
    allGhostPreviews.length > 0 &&
    allGhostPreviews.every((ghost) =>
      ghost.targetTrackId !== track.id
      && ghost.previewBelowTrackId !== track.id
      && ghost.previewAboveTrackId !== track.id
    );
  const ghostHighlightClasses = useMemo(
    () => getGhostHighlightClasses(ghostPreviews),
    [ghostPreviews]
  );

  const getDropFrame = useCallback((event: React.DragEvent): number | null => {
    const timelineContainer = getTimelineScrollContainer(trackRef.current);
    if (!timelineContainer) {
      return null;
    }

    const scrollLeft = timelineContainer.scrollLeft || 0;
    const containerRect = timelineContainer.getBoundingClientRect();
    const offsetX = (event.clientX - containerRect.left) + scrollLeft;
    return pixelsToFrame(offsetX);
  }, [pixelsToFrame]);

  const buildGhostPreviewsForEntries = useCallback((
    entries: Array<{ label: string; mediaType: DroppableMediaType; duration?: number; hasLinkedAudio?: boolean }>,
    dropFrame: number,
    preferNewAudioLane: boolean,
  ): GhostPreviewItem[] => {
    const { plannedItems } = planTrackMediaDropPlacements({
      entries: entries.map((entry) => ({
        payload: entry,
        label: entry.label,
        mediaType: entry.mediaType,
        durationInFrames: getDroppedMediaDurationInFrames(
          { duration: entry.duration ?? 0 } as Pick<MediaMetadata, 'duration'>,
          entry.mediaType,
          fps
        ),
        hasLinkedAudio: entry.hasLinkedAudio,
      })),
      dropFrame,
      tracks: useTimelineStore.getState().tracks,
      existingItems: useTimelineStore.getState().items,
      dropTargetTrackId: track.id,
      preferNewAudioLane,
    });

    const store = useTimelineStore.getState();
    const existingTrackIds = new Set(store.tracks.map((t) => t.id));
    return buildGhostPreviewsFromTrackMediaDropPlan({
      plannedItems,
      frameToPixels,
      existingTrackIds,
      dropTargetTrackId: track.id,
    });
  }, [fps, frameToPixels, track.id]);

  const buildGenericExternalGhostPreviews = useCallback((
    dropFrame: number,
    itemCount: number
  ): GhostPreviewItem[] => {
    const placeholderDuration = fps * 3;
    const finalPosition = findNearestAvailableSpace(
      Math.max(0, dropFrame),
      placeholderDuration,
      track.id,
      useTimelineStore.getState().items
    );

    if (finalPosition === null) {
      return [];
    }

    return [{
      left: frameToPixels(finalPosition),
      width: frameToPixels(placeholderDuration),
      label: itemCount > 1 ? `${itemCount} files` : 'Drop media',
      type: 'external-file',
      targetTrackId: track.id,
    }];
  }, [fps, frameToPixels, track.id]);

  const buildGhostPreviewForTemplate = useCallback((
    template: unknown,
    dropFrame: number,
  ): GhostPreviewItem[] => {
    if (!isTimelineTemplateDragData(template)) {
      return [];
    }

    const store = useTimelineStore.getState();
    const durationInFrames = getDefaultGeneratedLayerDurationInFrames(fps);
    const targetTrack = findCompatibleTrackForItemType({
      tracks: store.tracks,
      items: store.items,
      itemType: template.itemType,
      preferredTrackId: track.id,
      allowPreferredTrackFallback: false,
    });
    if (!targetTrack) {
      return [];
    }

    const finalPosition = findNearestAvailableSpace(
      Math.max(0, dropFrame),
      durationInFrames,
      targetTrack.id,
      store.items,
    );
    if (finalPosition === null) {
      return [];
    }

    return [{
      left: frameToPixels(finalPosition),
      width: frameToPixels(durationInFrames),
      label: template.label,
      type: template.itemType,
      targetTrackId: targetTrack.id,
    }];
  }, [fps, frameToPixels, track.id]);

  const clearExternalPreviewSession = useCallback(() => {
    externalPreviewItemsRef.current = null;
    externalPreviewSignatureRef.current = null;
    externalPreviewPromiseRef.current = null;
    externalPreviewTokenRef.current += 1;
  }, []);

  const primeExternalPreviewEntries = useCallback((dataTransfer: DataTransfer) => {
    const signature = `${dataTransfer.items.length}:${Array.from(dataTransfer.items)
      .map((item) => `${item.kind}:${item.type || 'unknown'}`)
      .join('|')}`;

    if (externalPreviewSignatureRef.current === signature && externalPreviewItemsRef.current) {
      return;
    }

    if (externalPreviewSignatureRef.current === signature && externalPreviewPromiseRef.current) {
      return;
    }

    clearExternalPreviewSession();
    externalPreviewSignatureRef.current = signature;
    const token = externalPreviewTokenRef.current;

    const previewPromise = (async () => {
      const { supported, entries } = await extractValidMediaFileEntriesFromDataTransfer(dataTransfer);
      if (!supported || token !== externalPreviewTokenRef.current) {
        return;
      }

      const previewEntries = entries.flatMap((entry) => (
        entry.mediaType === 'video' || entry.mediaType === 'audio' || entry.mediaType === 'image'
          ? [{
            label: entry.file.name,
            mediaType: entry.mediaType,
          }]
          : []
      ));

      externalPreviewItemsRef.current = previewEntries;
      externalPreviewPromiseRef.current = null;

      if (previewEntries.length > 0) {
        const audioOnly = previewEntries.every((p) => p.mediaType === 'audio');
        const preferNew = computePreferNewAudioLaneFromPointer(
          lastDragPointerYRef.current,
          track,
          trackRef.current,
          audioOnly,
        );
        preferNewAudioLaneRef.current = preferNew;
        setTrackGhostPreviews(
          buildGhostPreviewsForEntries(previewEntries, lastDragFrameRef.current, preferNew),
        );
      }
    })().catch((error) => {
      if (token === externalPreviewTokenRef.current) {
        externalPreviewPromiseRef.current = null;
        logger.warn('Failed to build external drag preview:', error);
      }
    });

    externalPreviewPromiseRef.current = previewPromise;
  }, [buildGhostPreviewsForEntries, clearExternalPreviewSession, setTrackGhostPreviews, track]);

  // Get item IDs from the full store (not virtualized subset) so drag detection
  // works even if the source item scrolls out of the visible buffer mid-drag.
  const allTrackItems = useItemsStore((s) => s.itemsByTrackId[track.id]);
  const trackItemIds = useMemo(() => allTrackItems?.map(item => item.id) ?? [], [allTrackItems]);

  // Check if any item on this track is being dragged (granular selector)
  const hasItemBeingDragged = useSelectionStore(
    useCallback(
      (s) => s.dragState?.isDragging && s.dragState.draggedItemIds.some(id => trackItemIds.includes(id)),
      [trackItemIds]
    )
  );

  // Check if a frame position is inside a real gap (between clips, not after the last clip).
  // Reads full item list from store (not the virtualized subset) so gaps near viewport edges
  // are detected correctly even when the clip after the gap is outside the visible buffer.
  const isFrameInGap = useCallback((frame: number) => {
    const allTrackItems = useItemsStore.getState().itemsByTrackId[track.id];
    if (!allTrackItems || allTrackItems.length === 0) return false;

    const sortedItems = allTrackItems.toSorted((a, b) => a.from - b.from);

    // Check if frame is inside any clip
    for (const item of sortedItems) {
      if (frame >= item.from && frame < item.from + item.durationInFrames) {
        return false; // Inside a clip
      }
    }

    // Check if there's a clip AFTER this frame (otherwise it's just empty space, not a gap)
    const hasClipAfter = sortedItems.some((item) => item.from > frame);
    return hasClipAfter;
  }, [track.id]);

  // Handle context menu on track (for empty space)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // Check if clicking on a clip (has data-item-id ancestor)
    const target = e.target as HTMLElement;
    if (target.closest('[data-item-id]')) {
      // Let the clip's context menu handle it
      return;
    }

    // Calculate clicked frame position
    const timelineContainer = getTimelineScrollContainer(trackRef.current);
    if (!timelineContainer) return;

    const scrollLeft = timelineContainer.scrollLeft || 0;
    const containerRect = timelineContainer.getBoundingClientRect();
    const offsetX = (e.clientX - containerRect.left) + scrollLeft;
    const clickedFrame = pixelsToFrame(offsetX);

    // Check if this frame is in a gap - just track the frame, let Radix handle menu
    if (isFrameInGap(clickedFrame)) {
      setContextMenuFrame(clickedFrame);
    } else {
      // Clicked on a clip area, prevent track menu so clip menu can show
      e.preventDefault();
      setContextMenuFrame(null);
    }
  }, [pixelsToFrame, isFrameInGap]);

  // Handle closing the gap
  const handleCloseGap = useCallback(() => {
    if (contextMenuFrame !== null) {
      closeGapOnTrackAtPosition(track.id, contextMenuFrame);
      setContextMenuFrame(null);
    }
  }, [contextMenuFrame, closeGapOnTrackAtPosition, track.id]);

  // Force menu remount on right-click to fix positioning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) { // Right click
      setMenuKey((k) => k + 1);
    }
  }, []);

  const handleGapHoverMove = useCallback((e: React.MouseEvent) => {
    gapHoverLastClientXRef.current = e.clientX;
    if (gapHoverRafRef.current !== null) return;
    gapHoverRafRef.current = requestAnimationFrame(() => {
      gapHoverRafRef.current = null;
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return;
      const localX = gapHoverLastClientXRef.current - rect.left;

      const trackItems = useItemsStore.getState().itemsByTrackId[track.id];
      if (!trackItems || trackItems.length === 0) {
        useGapHoverStore.getState().clearForTrack(track.id);
        return;
      }
      const sorted = [...trackItems].sort((a, b) => a.from - b.from);

      // Find the gap whose extended hit-region (proximity radius) contains the cursor.
      // Considers the leading gap [0, first-clip-from] in addition to the gaps
      // between adjacent clip pairs — context-menu ripple-delete already supports
      // leading gaps, so the ghost-delete UI should match.
      const HOVER_RADIUS_PX = 90;
      const MIN_GAP_PX = 14;
      type BestGap = { gapStart: number; gapEnd: number; distance: number; rightItemId: string };
      const bestGapRef: { current: BestGap | null } = { current: null };

      const considerGap = (gapStart: number, gapEnd: number, rightItemId: string) => {
        if (gapEnd <= gapStart) return;
        const left = frameToPixels(gapStart);
        const right = frameToPixels(gapEnd);
        if (right - left < MIN_GAP_PX) return;
        const distance = localX < left ? left - localX : localX > right ? localX - right : 0;
        if (distance > HOVER_RADIUS_PX) return;
        if (!bestGapRef.current || distance < bestGapRef.current.distance) {
          bestGapRef.current = { gapStart, gapEnd, distance, rightItemId };
        }
      };

      // Leading gap: timeline start (frame 0) to the first clip on this track.
      const first = sorted[0]!;
      if (first.from > 0) {
        considerGap(0, first.from, first.id);
      }

      // Gaps between adjacent clip pairs.
      for (let i = 0; i < sorted.length - 1; i++) {
        const cur = sorted[i]!;
        const next = sorted[i + 1]!;
        considerGap(cur.from + cur.durationInFrames, next.from, next.id);
      }

      const bestGap = bestGapRef.current;
      if (!bestGap) {
        useGapHoverStore.getState().clearForTrack(track.id);
        return;
      }

      // Compute mirror tracks: linked counterparts of the right-bordering clip
      // whose own gap aligns (no clips overlap [gapStart, gapEnd) on that track).
      const mirrorTrackIds: string[] = [];
      const allItems = useItemsStore.getState().items;
      const linked = getLinkedItems(allItems, bestGap.rightItemId);
      const itemsByTrackId = useItemsStore.getState().itemsByTrackId;
      for (const counterpart of linked) {
        if (counterpart.id === bestGap.rightItemId) continue;
        if (counterpart.trackId === track.id) continue;
        if (counterpart.from !== bestGap.gapEnd) continue;
        const counterpartTrackItems = itemsByTrackId[counterpart.trackId];
        if (!counterpartTrackItems) continue;
        // Verify no clip on the counterpart track intersects the gap range.
        const blocked = counterpartTrackItems.some((item) => {
          const itemEnd = item.from + item.durationInFrames;
          return item.from < bestGap.gapEnd && itemEnd > bestGap.gapStart;
        });
        if (!blocked) {
          mirrorTrackIds.push(counterpart.trackId);
        }
      }

      useGapHoverStore.getState().setActive({
        trackIds: [track.id, ...mirrorTrackIds],
        gapStart: bestGap.gapStart,
        gapEnd: bestGap.gapEnd,
        hoveredTrackId: track.id,
      });
    });
  }, [track.id, frameToPixels]);

  const handleGapHoverLeave = useCallback(() => {
    if (gapHoverRafRef.current !== null) {
      cancelAnimationFrame(gapHoverRafRef.current);
      gapHoverRafRef.current = null;
    }
    useGapHoverStore.getState().clearForTrack(track.id);
  }, [track.id]);

  useEffect(() => {
    return () => {
      if (gapHoverRafRef.current !== null) {
        cancelAnimationFrame(gapHoverRafRef.current);
        gapHoverRafRef.current = null;
      }
      useGapHoverStore.getState().clearForTrack(track.id);
    };
  }, [track.id]);

  const handleDragOver = (e: React.DragEvent) => {
    if (isDropDisabled) {
      preferNewAudioLaneRef.current = false;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    const data = getMediaDragData();
    const hasExternalFiles = !data && e.dataTransfer.types.includes('Files');
    if (!data && !hasExternalFiles) {
      preferNewAudioLaneRef.current = false;
      setIsExternalDragOver(false);
      clearTrackGhostPreviews();
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsDragOver(true);
    setIsExternalDragOver(hasExternalFiles);
    lastDragPointerYRef.current = e.clientY;

    const dropFrame = getDropFrame(e);
    if (dropFrame === null) {
      preferNewAudioLaneRef.current = false;
      clearTrackGhostPreviews();
      return;
    }
    lastDragFrameRef.current = dropFrame;

    if (hasExternalFiles) {
      if (externalPreviewItemsRef.current && externalPreviewItemsRef.current.length > 0) {
        const audioOnly = externalPreviewItemsRef.current.every((p) => p.mediaType === 'audio');
        const preferNew = computePreferNewAudioLaneFromPointer(e.clientY, track, trackRef.current, audioOnly);
        preferNewAudioLaneRef.current = preferNew;
        const previews = buildGhostPreviewsForEntries(externalPreviewItemsRef.current, dropFrame, preferNew);
        if (previews.length === 0) {
          e.dataTransfer.dropEffect = 'none';
          setIsDragOver(false);
          setIsExternalDragOver(false);
        }
        setTrackGhostPreviews(previews);
      } else {
        const fileItemCount = Array.from(e.dataTransfer.items).filter((item) => item.kind === 'file').length;
        const audioHint = dataTransferLooksAudioOnlyFiles(e.dataTransfer);
        const preferNew = computePreferNewAudioLaneFromPointer(e.clientY, track, trackRef.current, audioHint);
        preferNewAudioLaneRef.current = preferNew;
        const previews = audioHint
          ? buildGhostPreviewsForEntries(
            [{ label: fileItemCount > 1 ? `${fileItemCount} files` : 'Drop media', mediaType: 'audio', duration: 3 }],
            dropFrame,
            preferNew,
          )
          : buildGenericExternalGhostPreviews(dropFrame, Math.max(1, fileItemCount));
        setTrackGhostPreviews(previews);
        primeExternalPreviewEntries(e.dataTransfer);
      }
      return;
    }

    if (!data) {
      preferNewAudioLaneRef.current = false;
      clearTrackGhostPreviews();
      return;
    }

    const previews: GhostPreviewItem[] = [];

    if (data.type === 'composition') {
      const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId;
      if (wouldCreateCompositionCycle({
        parentCompositionId: activeCompositionId,
        insertedCompositionId: data.compositionId,
        compositionById: useCompositionsStore.getState().compositionById,
      })) {
        preferNewAudioLaneRef.current = false;
        e.dataTransfer.dropEffect = 'none';
        clearTrackGhostPreviews();
        return;
      }

      preferNewAudioLaneRef.current = false;
      const store = useTimelineStore.getState();
      const compositionById = useCompositionsStore.getState().compositionById;
      const composition = compositionById[data.compositionId];
      if (!composition) {
        e.dataTransfer.dropEffect = 'none';
        clearTrackGhostPreviews();
        return;
      }
      const hasOwnedAudio = compositionHasOwnedAudio({ composition, compositionById });
      const { plannedItems } = planTrackMediaDropPlacements({
        entries: [{
          payload: data,
          label: data.name,
          mediaType: 'video',
          durationInFrames: data.durationInFrames,
          hasLinkedAudio: hasOwnedAudio,
        }],
        dropFrame,
        tracks: store.tracks,
        existingItems: store.items,
        dropTargetTrackId: track.id,
      });
      const plannedItem = plannedItems[0];
      if (!plannedItem) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
        clearTrackGhostPreviews();
        return;
      }
      const existingIds = new Set(store.tracks.map((t) => t.id));
      previews.push(
        ...buildGhostPreviewsFromTrackMediaDropPlan({
          plannedItems: [plannedItem],
          frameToPixels,
          existingTrackIds: existingIds,
          dropTargetTrackId: track.id,
        }).map((preview) => ({
          ...preview,
          label: data.name,
          type: preview.type === 'video' ? 'composition' as const : preview.type,
        }))
      );
      setTrackGhostPreviews(previews);
      return;
    }

    if (data.type === 'timeline-template') {
      preferNewAudioLaneRef.current = false;
      const previews = buildGhostPreviewForTemplate(data, dropFrame);
      if (previews.length === 0) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
      }
      setTrackGhostPreviews(previews);
      return;
    }

    if (data.type === 'media-items' && data.items) {
      const rawItems = Array.isArray(data.items) ? data.items : [];
      const validItems = rawItems.filter(isValidDragMediaItem);
      if (validItems.length !== rawItems.length) {
        logger.warn('Skipping invalid media-items preview payload entries', {
          invalidCount: rawItems.length - validItems.length,
        });
      }

      const mediaById = new Map(getMedia.map((media) => [media.id, media]));
      const audioOnlyBatch = validItems.length > 0 && validItems.every((item) => item.mediaType === 'audio');
      const preferNew = computePreferNewAudioLaneFromPointer(e.clientY, track, trackRef.current, audioOnlyBatch);
      preferNewAudioLaneRef.current = preferNew;
      const nextPreviews = buildGhostPreviewsForEntries(
        validItems.map((item) => ({
          label: item.fileName,
          mediaType: item.mediaType,
          duration: item.duration,
          hasLinkedAudio: item.mediaType === 'video' && !!mediaById.get(item.mediaId)?.audioCodec,
        })),
        dropFrame,
        preferNew,
      );
      if (nextPreviews.length === 0) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
      }
      previews.push(...nextPreviews);
      setTrackGhostPreviews(previews);
      return;
    }

    if (data.type === 'media-item' && data.mediaId && data.mediaType && data.fileName) {
      const media = getMedia.find((entry) => entry.id === data.mediaId);
      if (!media || !isDroppableMediaType(data.mediaType)) {
        clearTrackGhostPreviews();
        return;
      }

      const itemDuration = getDroppedMediaDurationInFrames(media, data.mediaType, fps);
      const preferNew = computePreferNewAudioLaneFromPointer(
        e.clientY,
        track,
        trackRef.current,
        data.mediaType === 'audio',
      );
      preferNewAudioLaneRef.current = preferNew;
      const nextPreviews = buildGhostPreviewsForEntries([
        {
          label: data.fileName,
          mediaType: data.mediaType,
          duration: itemDuration / fps,
          hasLinkedAudio: data.mediaType === 'video' && !!media.audioCodec,
        },
      ], dropFrame, preferNew);
      if (nextPreviews.length === 0) {
        e.dataTransfer.dropEffect = 'none';
        setIsDragOver(false);
      }
      previews.push(...nextPreviews);
    }

    setTrackGhostPreviews(previews);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    preferNewAudioLaneRef.current = false;
    setIsDragOver(false);
    setIsExternalDragOver(false);
    clearTrackGhostPreviews();
    clearExternalPreviewSession();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const preferNewAudioLane = preferNewAudioLaneRef.current;
    preferNewAudioLaneRef.current = false;
    setIsDragOver(false);
    setIsExternalDragOver(false);
    clearTrackGhostPreviews();
    clearExternalPreviewSession();

    if (isDropDisabled) {
      return;
    }

    const dropFrame = getDropFrame(e);
    if (dropFrame === null) {
      return;
    }

    await executeTimelineMediaDrop({
      dataTransfer: e.dataTransfer,
      dropFrame,
      dropTargetTrackId: track.id,
      preferNewAudioLane,
    });
  };

  return (
    <div
      className="flex min-w-0 flex-col"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
    {!isDropDisabled && previewAboveGhosts.length > 0 && (
      <div
        data-ephemeral-video-lane
        className="relative"
        style={{
          height: `${track.height}px`,
          contain: 'layout style',
        }}
      >
        <div className="pointer-events-none absolute inset-0 z-10 rounded border border-dashed border-timeline-video/60 bg-timeline-video/10" />
        {previewAboveGhosts.map((ghost, index) => (
          <div
            key={`above-${index}`}
            className={ghostPreviewPillClassName(ghost.type)}
            style={{
              left: `${ghost.left}px`,
              width: `${ghost.width}px`,
            }}
          >
            <span className="text-xs text-foreground/70 truncate">{ghost.label}</span>
          </div>
        ))}
      </div>
    )}
    <ContextMenu key={menuKey} modal={false}>
      <ContextMenuTrigger asChild disabled={track.locked}>
        <div
          ref={trackRef}
          data-track-id={track.id}
          className="relative"
          style={{
            height: `${track.height}px`,
            // CSS containment tells browser this element's layout is independent
            // This significantly improves scroll/paint performance for large timelines
            contain: 'layout style',
            // Elevate track above others when it contains a dragging clip
            zIndex: hasItemBeingDragged ? 100 : undefined,
          }}
          onMouseDown={handleMouseDown}
          onContextMenu={handleContextMenu}
          onMouseMove={track.locked ? undefined : handleGapHoverMove}
          onMouseLeave={track.locked ? undefined : handleGapHoverLeave}
        >
          {isDragOver &&
            !isDropDisabled &&
            !isExternalDragOver &&
            ghostPreviews.length === 0 &&
            previewBelowGhosts.length === 0 &&
            previewAboveGhosts.length === 0 &&
            !activeGhostsTargetOnlyOtherTracks && (
            <div className="absolute inset-0 pointer-events-none z-10 rounded border border-dashed border-primary/50 bg-primary/10" />
          )}

          {!isDropDisabled && ghostPreviews.length > 0 && (
            <div className={`absolute inset-0 pointer-events-none z-10 rounded border border-dashed ${ghostHighlightClasses}`} />
          )}

          {/* Ghost preview clips during drag */}
          {!isDropDisabled && ghostPreviews.map((ghost, index) => (
            <div
              key={index}
              className={ghostPreviewPillClassName(ghost.type)}
              style={{
                left: `${ghost.left}px`,
                width: `${ghost.width}px`,
              }}
            >
              <span className="text-xs text-foreground/70 truncate">{ghost.label}</span>
            </div>
          ))}

          {/* Render all items for this track - dimmed when track is hidden */}
          {trackItems.map((item) => (
            <TimelineItem key={item.id} item={item} timelineDuration={30} trackLocked={track.locked} trackHidden={!track.visible} />
          ))}

          {/* Render transitions for this track */}
          {track.kind !== 'audio' && trackTransitions.map((transition) => (
            <TransitionItem key={transition.id} transition={transition} trackHidden={!track.visible} />
          ))}

          {/* Proximity-triggered ghost overlays for empty gaps between clips */}
          {!track.locked
            && !isDragOver
            && !isExternalDragOver
            && !hasItemBeingDragged
            && ghostPreviews.length === 0
            && previewBelowGhosts.length === 0
            && previewAboveGhosts.length === 0 && (
            <TrackGapGhosts trackId={track.id} trackHeight={track.height} />
          )}

          {/* Locked track overlay indicator */}
          {track.locked && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="text-xs text-muted-foreground/50 font-mono">LOCKED</div>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      {hasAnyItems && contextMenuFrame !== null && (
        <ContextMenuContent>
          <ContextMenuItem onClick={handleCloseGap}>
            Ripple Delete
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>

    {!isDropDisabled && previewBelowGhosts.length > 0 && (
      <div
        data-ephemeral-audio-lane
        className="relative"
        style={{
          height: `${track.height}px`,
          contain: 'layout style',
        }}
      >
        <div className="pointer-events-none absolute inset-0 z-10 rounded border border-dashed border-timeline-audio/60 bg-timeline-audio/10" />
        {previewBelowGhosts.map((ghost, index) => (
          <div
            key={`below-${index}`}
            className={ghostPreviewPillClassName(ghost.type)}
            style={{
              left: `${ghost.left}px`,
              width: `${ghost.width}px`,
            }}
          >
            <span className="text-xs text-foreground/70 truncate">{ghost.label}</span>
          </div>
        ))}
      </div>
    )}
    </div>
  );
}, areTrackPropsEqual);
