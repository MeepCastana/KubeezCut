import { useEffect, useLayoutEffect, useRef, useState, memo, useCallback, useMemo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { TimelineHeader } from './timeline-header';
import { TimelineContent } from './timeline-content';
import { TimelineNavigator } from './timeline-navigator';
import { TrackHeader } from './track-header';
import { TransitionDragTooltip } from './transition-drag-tooltip';
import { TrackRowFrame, TrackSectionDivider } from './track-row-frame';
import { useTimelineTracks } from '../hooks/use-timeline-tracks';
import { useItemsStore } from '../stores/items-store';
import { useSelectionStore } from '@/shared/state/selection';
import { useEditorStore } from '@/shared/state/editor';
import { useTimelineStore } from '../stores/timeline-store';
import { usePlaybackStore } from '@/shared/state/playback';
import { HOTKEY_OPTIONS } from '@/config/hotkeys';
import { useSettingsStore, useResolvedHotkeys } from '@/features/timeline/deps/settings';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus } from 'lucide-react';
import { CompositionBreadcrumbs } from './composition-breadcrumbs';
import { useCompositionNavigationStore } from '../stores/composition-navigation-store';
import { trackDropIndexRef, trackDragOffsetRef, trackDragJustDroppedRef } from '../hooks/use-track-drag';
import { createClassicTrack, getAdjacentTrackOrder, getTrackKind } from '../utils/classic-tracks';
import { getEmptyTrackIdsForRemoval } from '../utils/track-removal';
import { createLogger } from '@/shared/logging/logger';
import { EDITOR_LAYOUT_CSS_VALUES, getEditorLayout } from '@/shared/ui/editor-layout';
import { useTrackHeightResize } from '../hooks/use-track-height-resize';
import { useTimelineSettingsStore } from '../stores/timeline-settings-store';
import {
  clampSectionDividerPosition,
  computeNewTrackZoneHeight,
  getTrackSectionLayout,
  resizeTracksOfKindByDelta,
} from '../utils/track-resize';
import { MIN_TOP_VIDEO_NEW_TRACK_DROP_ZONE_PX } from '../constants';
import { useNewTrackZonePreviewStore } from '../stores/new-track-zone-preview-store';
import { useTimelineViewportStore } from '../stores/timeline-viewport-store';

const VideoTopNewLaneHeaderSpacer = memo(function VideoTopNewLaneHeaderSpacer() {
  const show = useNewTrackZonePreviewStore((s) => s.topVideoNewLaneDropActive);
  return (
    <div
      aria-hidden
      data-track-header-new-zone="video-top"
      className="relative shrink-0"
      style={{ height: `${MIN_TOP_VIDEO_NEW_TRACK_DROP_ZONE_PX}px` }}
    >
      {show && (
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-[35] h-[3px] bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.65)]"
          aria-hidden
        />
      )}
    </div>
  );
});

const logger = createLogger('Timeline');

interface TimelineProps {
  duration: number; // Total timeline duration in seconds
}

/**
 * Complete Timeline Component
 *
 * Combines:
 * - TimelineHeader (controls, zoom, snap)
 * - Track Headers Sidebar (track labels and controls)
 * - TimelineContent (markers, playhead, tracks, items)
 *
 * Follows modular architecture with granular Zustand selectors
 */
export const Timeline = memo(function Timeline({ duration }: TimelineProps) {
  const hotkeys = useResolvedHotkeys();
  const colorScopesOpen = useEditorStore((s) => s.colorScopesOpen);
  const toggleColorScopesOpen = useEditorStore((s) => s.toggleColorScopesOpen);
  const editorDensity = useSettingsStore((s) => s.editorDensity);
  const editorLayout = getEditorLayout(editorDensity);
  const {
    tracks,
    addTrack,
    removeTracks,
    toggleTrackMute,
    toggleTrackVisibility,
    toggleTrackLock,
  } = useTimelineTracks();
  // Selection state - use granular selectors
  const activeTrackId = useSelectionStore((s) => s.activeTrackId);
  const selectedTrackIds = useSelectionStore((s) => s.selectedTrackIds);
  const setActiveTrack = useSelectionStore((s) => s.setActiveTrack);
  const toggleTrackSelection = useSelectionStore((s) => s.toggleTrackSelection);
  const selectTracks = useSelectionStore((s) => s.selectTracks);
  const selectedTrackIdsSet = useMemo(() => new Set(selectedTrackIds), [selectedTrackIds]);

  const visibleTracks = tracks;
  const canDeleteEmptyTracks = useItemsStore(
    useCallback((s) => {
      let emptyTrackCount = 0;

      for (const track of tracks) {
        if ((s.itemsByTrackId[track.id]?.length ?? 0) === 0) {
          emptyTrackCount += 1;
        }
      }

      if (emptyTrackCount === 0) return false;
      if (emptyTrackCount < tracks.length) return true;
      return tracks.length > 1;
    }, [tracks])
  );
  const videoTracks = useMemo(
    () => visibleTracks.filter((track) => getTrackKind(track) === 'video'),
    [visibleTracks]
  );
  const audioTracks = useMemo(
    () => visibleTracks.filter((track) => getTrackKind(track) === 'audio'),
    [visibleTracks]
  );
  const hasTrackSections = videoTracks.length > 0 && audioTracks.length > 0;

  const timelinePanelRef = useRef<HTMLDivElement>(null);
  const trackHeadersColumnRef = useRef<HTMLDivElement>(null);

  // Refs for syncing scroll between track headers and timeline content
  const trackHeadersViewportRef = useRef<HTMLDivElement>(null);
  const trackHeadersRootRef = useRef<HTMLDivElement>(null);
  const timelineContentRef = useRef<HTMLDivElement>(null);
  const allTrackHeadersScrollRef = useRef<HTMLDivElement>(null);
  const videoTrackHeadersScrollRef = useRef<HTMLDivElement>(null);
  const audioTrackHeadersScrollRef = useRef<HTMLDivElement>(null);
  const allTrackContentScrollRef = useRef<HTMLDivElement>(null);
  const videoTrackContentScrollRef = useRef<HTMLDivElement>(null);
  const audioTrackContentScrollRef = useRef<HTMLDivElement>(null);
  const sectionDividerDragRef = useRef<{ startY: number; startDividerPosition: number } | null>(null);

  // Store zoom handlers from TimelineContent
  const [zoomHandlers, setZoomHandlers] = useState<{
    handleZoomChange: (newZoom: number) => void;
    handleZoomIn: () => void;
    handleZoomOut: () => void;
    handleZoomToFit: () => void;
  } | null>(null);
  const [timelineMetrics, setTimelineMetrics] = useState({
    actualDuration: Math.max(duration, 10),
    timelineWidth: 0,
  });
  const viewportWidth = useTimelineViewportStore((s) => s.viewportWidth);
  const needsHorizontalScroll = useMemo(
    () =>
      timelineMetrics.timelineWidth > 0 &&
      viewportWidth > 0 &&
      timelineMetrics.timelineWidth > viewportWidth,
    [timelineMetrics.timelineWidth, viewportWidth]
  );
  const [trackRowsViewportHeight, setTrackRowsViewportHeight] = useState(0);
  const [sectionDividerPosition, setSectionDividerPosition] = useState<number | null>(null);

  const toggleKeyframeEditorOpen = useEditorStore((s) => s.toggleKeyframeEditorOpen);
  const setTimelineTracks = useTimelineStore((s) => s.setTracks);

  // Keyboard shortcut: Ctrl/Cmd+Shift+A to toggle keyframe editor
  useHotkeys(
    hotkeys.TOGGLE_KEYFRAME_EDITOR,
    (event) => {
      event.preventDefault();
      toggleKeyframeEditorOpen();
    },
    HOTKEY_OPTIONS,
    [toggleKeyframeEditorOpen]
  );

  // State for drop indicator (updated via RAF from drag hook)
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState(-1);

  // Granular selector: only re-render when track dragging state actually changes
  const isTrackDragging = useSelectionStore(
    (s) => (s.dragState?.isDragging && s.dragState.draggedTrackIds && s.dragState.draggedTrackIds.length > 0) ?? false
  );

  const trackSectionLayout = useMemo(() => getTrackSectionLayout({
    viewportHeight: trackRowsViewportHeight,
    tracks: visibleTracks,
    sectionDividerPosition,
    trackTitleBarHeight: editorLayout.timelineClipLabelRowHeight,
  }), [editorLayout.timelineClipLabelRowHeight, sectionDividerPosition, trackRowsViewportHeight, visibleTracks]);
  const {
    clampedSectionDividerPosition,
    videoPaneHeight,
    audioPaneHeight,
    videoSectionHeight,
    audioSectionHeight,
  } = trackSectionLayout;
  const { handleTrackResizeStart, handleTrackResizeReset } = useTrackHeightResize();
  const videoZoneHeight = useMemo(
    () => computeNewTrackZoneHeight(videoPaneHeight, videoSectionHeight),
    [videoPaneHeight, videoSectionHeight]
  );
  const audioZoneHeight = useMemo(
    () => computeNewTrackZoneHeight(audioPaneHeight, audioSectionHeight),
    [audioPaneHeight, audioSectionHeight]
  );

  const getTrackStackOffset = useCallback((sectionTracks: typeof visibleTracks, dropIndex: number, leadingOffset = 0) => {
    return leadingOffset + sectionTracks
      .slice(0, Math.max(0, Math.min(dropIndex, sectionTracks.length)))
      .reduce((sum, track) => sum + track.height, 0);
  }, []);

  // Measure before paint so the first painted frame never uses viewportHeight=0 (which clamps the
  // section divider to 0 and collapses both panes until a later useEffect + paint — visible gap/glitch).
  useLayoutEffect(() => {
    const element = trackHeadersViewportRef.current;
    if (!element) return;

    const updateHeight = () => {
      setTrackRowsViewportHeight(element.clientHeight);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Alt+scroll in track headers = resize track heights (mirrors timeline-content behavior)
  // OpenCut-style: wheel over the track-label column forwards to the timeline canvas so
  // horizontal/vertical scroll and pinch-zoom feel the same as over the tracks.
  useEffect(() => {
    const panel = timelinePanelRef.current;
    if (!panel) return;

    const forwardHeaderWheelToCanvas = (event: WheelEvent) => {
      const canvas = timelineContentRef.current;
      const headerCol = trackHeadersColumnRef.current;
      if (!canvas || !headerCol) return;
      if (canvas.contains(event.target as Node)) return;
      if (!headerCol.contains(event.target as Node)) return;

      event.preventDefault();
      event.stopPropagation();
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaZ: event.deltaZ,
          deltaMode: event.deltaMode,
          clientX: event.clientX,
          clientY: event.clientY,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          view: window,
        }),
      );
    };

    panel.addEventListener('wheel', forwardHeaderWheelToCanvas, { capture: true, passive: false });
    return () => {
      panel.removeEventListener('wheel', forwardHeaderWheelToCanvas, { capture: true });
    };
  }, []);

  // Match OpenCut: block browser page zoom when Ctrl/Cmd+wheel is used over the timeline panel
  useEffect(() => {
    const preventBrowserZoom = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const panel = timelinePanelRef.current;
      if (!panel?.contains(event.target as Node)) return;
      event.preventDefault();
    };

    document.addEventListener('wheel', preventBrowserZoom, { capture: true, passive: false });
    return () => {
      document.removeEventListener('wheel', preventBrowserZoom, { capture: true });
    };
  }, []);

  useEffect(() => {
    const el = trackHeadersViewportRef.current;
    if (!el) return;

    const handler = (event: WheelEvent) => {
      if (!event.altKey) return;
      event.preventDefault();

      const sectionEl = (event.target instanceof Element)
        ? event.target.closest('[data-track-section-scroll]') as HTMLElement | null
        : null;
      const zone = sectionEl?.dataset.trackSectionScroll as 'video' | 'audio' | undefined;
      if (!zone) return;

      const delta = event.deltaY > 0 ? -4 : 4;
      const currentTracks = useItemsStore.getState().tracks;
      const nextTracks = resizeTracksOfKindByDelta(currentTracks, zone, delta);
      if (nextTracks !== currentTracks) {
        useItemsStore.getState().setTracks(nextTracks);
        useTimelineSettingsStore.getState().markDirty();
      }
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const handleSectionDividerMouseDown = useCallback((event: React.MouseEvent) => {
    if (!hasTrackSections) return;

    event.preventDefault();
    event.stopPropagation();
    sectionDividerDragRef.current = {
      startY: event.clientY,
      startDividerPosition: clampedSectionDividerPosition,
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dragState = sectionDividerDragRef.current;
      if (!dragState) return;

      const deltaY = moveEvent.clientY - dragState.startY;
      setSectionDividerPosition(clampSectionDividerPosition({
        viewportHeight: trackRowsViewportHeight,
        tracks: visibleTracks,
        requestedDividerPosition: dragState.startDividerPosition + deltaY,
        trackTitleBarHeight: editorLayout.timelineClipLabelRowHeight,
      }));
    };

    const handleMouseUp = () => {
      sectionDividerDragRef.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [
    clampedSectionDividerPosition,
    editorLayout.timelineClipLabelRowHeight,
    hasTrackSections,
    trackRowsViewportHeight,
    visibleTracks,
  ]);

  // Set first track as active on mount
  // Use primitive dependencies to avoid re-running on unrelated track changes
  const tracksLength = tracks.length;
  const firstTrackId = tracks[0]?.id;
  useEffect(() => {
    if (tracksLength > 0 && !activeTrackId && firstTrackId) {
      setActiveTrack(firstTrackId);
    }
  }, [tracksLength, activeTrackId, firstTrackId, setActiveTrack]);

  useEffect(() => {
    const syncPairs = [
      {
        source: allTrackContentScrollRef.current,
        target: allTrackHeadersScrollRef.current,
      },
      {
        source: videoTrackContentScrollRef.current,
        target: videoTrackHeadersScrollRef.current,
      },
      {
        source: audioTrackContentScrollRef.current,
        target: audioTrackHeadersScrollRef.current,
      },
    ].filter((pair): pair is { source: HTMLDivElement; target: HTMLDivElement } => {
      return pair.source !== null && pair.target !== null;
    });

    const cleanups = syncPairs.map(({ source, target }) => {
      const handleScroll = () => {
        if (target.scrollTop !== source.scrollTop) {
          target.scrollTop = source.scrollTop;
        }
      };

      handleScroll();
      source.addEventListener('scroll', handleScroll, { passive: true });
      return () => source.removeEventListener('scroll', handleScroll);
    });

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }, [audioTracks.length, hasTrackSections, tracksLength, videoTracks.length]);

  useLayoutEffect(() => {
    const content = hasTrackSections
      ? videoTrackContentScrollRef.current
      : videoTracks.length > 0
        ? allTrackContentScrollRef.current
        : null;
    const header = hasTrackSections
      ? videoTrackHeadersScrollRef.current
      : videoTracks.length > 0
        ? allTrackHeadersScrollRef.current
        : null;

    const anchorToDivider = (element: HTMLDivElement | null) => {
      if (!element) {
        return;
      }

      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    };

    anchorToDivider(content);
    anchorToDivider(header);
  }, [allTrackContentScrollRef, allTrackHeadersScrollRef, hasTrackSections, videoPaneHeight, videoSectionHeight, videoTracks.length]);

  // Update drop indicator from shared ref (only during drag)
  // Only runs RAF loop when track dragging is active to avoid unnecessary renders
  useEffect(() => {
    if (!isTrackDragging) {
      setDropIndicatorIndex(-1);
      return;
    }

    let rafId: number;
    const updateDropIndicator = () => {
      const newIndex = trackDropIndexRef.current;
      setDropIndicatorIndex((prev) => (prev !== newIndex ? newIndex : prev));
      rafId = requestAnimationFrame(updateDropIndicator);
    };

    rafId = requestAnimationFrame(updateDropIndicator);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isTrackDragging]);

  // Drag visuals: move all dragged track headers together via direct DOM manipulation.
  // This handles groups (header + children move as one) and multi-select drag.
  useEffect(() => {
    if (!isTrackDragging) return;

    const dragState = useSelectionStore.getState().dragState;
    if (!dragState?.draggedTrackIds?.length) return;

    const draggedIds = new Set(dragState.draggedTrackIds);
    const container = trackHeadersRootRef.current;
    if (!container) return;

    let rafId: number;
    const updateDragVisuals = () => {
      const offset = trackDragOffsetRef.current;
      const elements = container.querySelectorAll<HTMLElement>('[data-track-id]');
      for (const el of elements) {
        const trackId = el.getAttribute('data-track-id');
        if (trackId && draggedIds.has(trackId)) {
          el.style.transform = `translateY(${offset}px) scale(1.02)`;
          el.style.zIndex = '100';
          el.style.opacity = '0.5';
          el.style.transition = 'none';
          el.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)';
        }
      }
      rafId = requestAnimationFrame(updateDragVisuals);
    };

    rafId = requestAnimationFrame(updateDragVisuals);
    return () => {
      cancelAnimationFrame(rafId);
      // Reset styles on all track headers
      if (container) {
        const elements = container.querySelectorAll<HTMLElement>('[data-track-id]');
        for (const el of elements) {
          el.style.transform = '';
          el.style.zIndex = '';
          el.style.opacity = '';
          el.style.transition = '';
          el.style.boxShadow = '';
        }
      }
    };
  }, [isTrackDragging]);

  // Keyboard shortcuts for in/out markers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Another focused panel (e.g. Source Monitor) already handled this key.
      if (e.defaultPrevented) return;

      // Ignore if typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const key = e.key.toLowerCase();

      // Escape - exit composition if inside one
      if (key === 'escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        const navStore = useCompositionNavigationStore.getState();
        if (navStore.activeCompositionId !== null) {
          e.preventDefault();
          navStore.exitComposition();
          return;
        }
      }

      // 'I' key - Set in-point at main playhead
      if (key === 'i' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { currentFrame } = usePlaybackStore.getState();
        useTimelineStore.getState().setInPoint(currentFrame);
      }

      // 'Shift+I' key - Set in-point at skimmer (ghost) playhead when hovering
      else if (key === 'i' && !e.metaKey && !e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { hoverFrame, currentFrame } = usePlaybackStore.getState();
        useTimelineStore.getState().setInPoint(hoverFrame ?? currentFrame);
      }

      // 'O' key - Set out-point at main playhead
      if (key === 'o' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { currentFrame } = usePlaybackStore.getState();
        useTimelineStore.getState().setOutPoint(currentFrame);
      }

      // 'Shift+O' key - Set out-point at skimmer (ghost) playhead when hovering
      else if (key === 'o' && !e.metaKey && !e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        const { hoverFrame, currentFrame } = usePlaybackStore.getState();
        useTimelineStore.getState().setOutPoint(hoverFrame ?? currentFrame);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const syncTrackSelectionAfterRemoval = useCallback((removedTrackIds: string[], fallbackTrackId: string | null) => {
    const removedTrackIdsSet = new Set(removedTrackIds);
    const selectionState = useSelectionStore.getState();
    const remainingSelectedTrackIds = selectionState.selectedTrackIds.filter(
      (trackId) => !removedTrackIdsSet.has(trackId)
    );

    if (remainingSelectedTrackIds.length > 0) {
      selectionState.selectTracks(remainingSelectedTrackIds);
      return;
    }

    if (selectionState.activeTrackId && !removedTrackIdsSet.has(selectionState.activeTrackId)) {
      return;
    }

    selectionState.setActiveTrack(fallbackTrackId);
  }, []);

  const addVideoTrackToTop = useCallback(() => {
    const newTrack = createClassicTrack({
      tracks,
      kind: 'video',
      order: 0,
      height: editorLayout.timelineTrackHeight,
    });

    addTrack(newTrack);

    setTimeout(() => {
      setActiveTrack(newTrack.id);
    }, 0);
  }, [addTrack, editorLayout.timelineTrackHeight, setActiveTrack, tracks]);

  const appendAudioTrackToSection = useCallback(() => {
    const audioAnchorTrack = audioTracks[audioTracks.length - 1]
      ?? videoTracks[videoTracks.length - 1]
      ?? tracks[tracks.length - 1]
      ?? null;

    const newTrack = createClassicTrack({
      tracks,
      kind: 'audio',
      order: audioAnchorTrack ? getAdjacentTrackOrder(tracks, audioAnchorTrack, 'below') : 0,
      height: editorLayout.timelineTrackHeight,
    });

    setTimelineTracks([...tracks, newTrack]);

    setTimeout(() => {
      setActiveTrack(newTrack.id);
    }, 0);
  }, [audioTracks, editorLayout.timelineTrackHeight, setActiveTrack, setTimelineTracks, tracks, videoTracks]);

  const handleDeleteTrack = useCallback((trackId: string) => {
    if (tracks.length <= 1) {
      logger.warn('Cannot remove all tracks');
      return;
    }

    const track = tracks.find((t) => t.id === trackId);
    if (track?.locked) {
      return;
    }

    const itemIdsOnTrack = useItemsStore.getState().items
      .filter((item) => item.trackId === trackId)
      .map((item) => item.id);

    if (itemIdsOnTrack.length > 0) {
      useTimelineStore.getState().removeItems(itemIdsOnTrack);
    }

    const selection = useSelectionStore.getState();
    const surviving = useItemsStore.getState().itemById;
    const prunedSelection = selection.selectedItemIds.filter((id) => id in surviving);
    if (prunedSelection.length !== selection.selectedItemIds.length) {
      selection.selectItems(prunedSelection);
    }

    removeTracks([trackId]);

    const remainingTracks = tracks.filter((t) => t.id !== trackId);
    syncTrackSelectionAfterRemoval([trackId], remainingTracks[0]?.id ?? null);
  }, [removeTracks, syncTrackSelectionAfterRemoval, tracks]);

  const handleDeleteEmptyTracks = useCallback((contextTrackId: string) => {
    const emptyTrackIds = getEmptyTrackIdsForRemoval(
      tracks,
      useItemsStore.getState().itemsByTrackId,
      contextTrackId
    );
    if (emptyTrackIds.length === 0) return;

    const removedTrackIdsSet = new Set(emptyTrackIds);
    removeTracks(emptyTrackIds);

    const remainingTracks = tracks.filter((track) => !removedTrackIdsSet.has(track.id));
    syncTrackSelectionAfterRemoval(emptyTrackIds, remainingTracks[0]?.id ?? null);
  }, [removeTracks, syncTrackSelectionAfterRemoval, tracks]);

  const videoDropIndicatorIndex = isTrackDragging && dropIndicatorIndex >= 0 && dropIndicatorIndex <= videoTracks.length
    ? dropIndicatorIndex
    : -1;
  const audioDropIndicatorIndex = isTrackDragging && dropIndicatorIndex >= videoTracks.length && dropIndicatorIndex <= visibleTracks.length
    ? dropIndicatorIndex - videoTracks.length
    : -1;
  const singleSectionKind = videoTracks.length > 0 ? 'video' : 'audio';
  const singleSectionTracks = videoTracks.length > 0 ? videoTracks : audioTracks;
  const singleSectionHeight = videoTracks.length > 0 ? videoPaneHeight : audioPaneHeight;
  const singleSectionZoneHeight = videoTracks.length > 0 ? videoZoneHeight : audioZoneHeight;
  const singleDropIndicatorIndex = !hasTrackSections && isTrackDragging && dropIndicatorIndex >= 0 && dropIndicatorIndex <= visibleTracks.length
    ? dropIndicatorIndex
    : -1;

  const renderTrackHeadersSection = (
    sectionTracks: typeof visibleTracks,
    options: {
      section: 'video' | 'audio';
      height: number;
      zoneHeight: number;
      scrollRef: React.RefObject<HTMLDivElement | null>;
      dropIndicatorLocalIndex: number;
      showTopDividerForFirstTrack: boolean;
    }
  ) => (
    <div className="relative min-h-0 overflow-hidden" style={{ height: `${options.height}px` }} data-track-section-scroll={options.section}>
      <div ref={options.scrollRef} className="h-full overflow-hidden">
        <div className="relative flex min-h-full min-w-0 flex-col">
          <div className="relative flex w-full min-w-0 flex-col">
            {options.section === 'video' && <VideoTopNewLaneHeaderSpacer />}
            {sectionTracks.map((track, index) => {
              return (
                <TrackRowFrame
                  key={track.id}
                  multipleLanes={sectionTracks.length > 1}
                  showTopDivider={options.showTopDividerForFirstTrack && index === 0}
                  onResizeMouseDown={(event) => handleTrackResizeStart(event, track.id)}
                  onResizeDoubleClick={(event) => handleTrackResizeReset(event, track.id)}
                  resizeHandleLabel={`Resize ${track.name} height`}
                  resizeHandlePosition={getTrackKind(track) === 'video' ? 'top' : 'bottom'}
                >
                  <TrackHeader
                    track={track}
                    isActive={activeTrackId === track.id}
                    isSelected={selectedTrackIdsSet.has(track.id)}
                    canDeleteTrack={tracks.length > 1}
                    canDeleteEmptyTracks={canDeleteEmptyTracks}
                    onToggleMute={() => toggleTrackMute(track.id)}
                    onToggleVisibility={() => toggleTrackVisibility(track.id)}
                    onToggleLock={() => toggleTrackLock(track.id)}
                    onAddVideoTrack={addVideoTrackToTop}
                    onAddAudioTrack={appendAudioTrackToSection}
                    onDeleteTrack={() => handleDeleteTrack(track.id)}
                    onDeleteEmptyTracks={() => handleDeleteEmptyTracks(track.id)}
                    onSelect={(e) => {
                      if (trackDragJustDroppedRef.current) return;
                      if (e.shiftKey && activeTrackId) {
                        const startIdx = visibleTracks.findIndex((t) => t.id === activeTrackId);
                        const endIdx = visibleTracks.findIndex((t) => t.id === track.id);
                        if (startIdx !== -1 && endIdx !== -1) {
                          const lo = Math.min(startIdx, endIdx);
                          const hi = Math.max(startIdx, endIdx);
                          const rangeIds = visibleTracks.slice(lo, hi + 1).map((t) => t.id);
                          selectTracks(rangeIds);
                        }
                      } else if (e.metaKey || e.ctrlKey) {
                        toggleTrackSelection(track.id);
                      } else {
                        setActiveTrack(track.id);
                      }
                    }}
                  />
                </TrackRowFrame>
              );
            })}

            {options.section === 'video' && (
              <div
                aria-hidden="true"
                data-track-header-new-zone="video"
                style={{ height: `${options.zoneHeight}px` }}
              />
            )}

            {options.section === 'audio' && (
              <div
                aria-hidden="true"
                data-track-header-new-zone="audio"
                style={{ height: `${options.zoneHeight}px` }}
              />
            )}

            {options.dropIndicatorLocalIndex >= 0 && (
              <div
                className="absolute left-0 right-0 h-0.5 pointer-events-none z-50 shadow-lg bg-primary"
                style={{
                  top: getTrackStackOffset(
                    sectionTracks,
                    options.dropIndicatorLocalIndex,
                    options.section === 'video' ? MIN_TOP_VIDEO_NEW_TRACK_DROP_ZONE_PX : 0
                  ),
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (

      <div
        className="timeline-bg panel h-full border-t border-border flex flex-col overflow-hidden rounded-sm"
        role="region"
        aria-label="Timeline"
      >
        {/* Timeline Header */}
        <TimelineHeader
          onZoomChange={zoomHandlers?.handleZoomChange}
          onZoomIn={zoomHandlers?.handleZoomIn}
          onZoomOut={zoomHandlers?.handleZoomOut}
          isScopesPanelOpen={colorScopesOpen}
          onToggleScopesPanel={toggleColorScopesOpen}
        />

        {/* Composition Breadcrumbs - shown when inside a sub-composition */}
        <CompositionBreadcrumbs />

      {/* Timeline Content */}
      <div ref={timelinePanelRef} className="flex-1 flex overflow-hidden min-h-0">
        {/* Track Headers Sidebar */}
        <div
          ref={trackHeadersColumnRef}
          className="panel-bg flex flex-shrink-0 flex-col overflow-x-hidden"
          style={{ width: EDITOR_LAYOUT_CSS_VALUES.timelineSidebarWidth }}
        >
          {/* OpenCut-style: spacer aligned with ruler; add track via menu only */}
          <div
            className="flex flex-shrink-0 items-center justify-end border-b border-border bg-secondary/20 px-2"
            style={{ height: EDITOR_LAYOUT_CSS_VALUES.timelineTracksHeaderHeight }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  aria-label="Add track"
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={addVideoTrackToTop}>Add video track</DropdownMenuItem>
                <DropdownMenuItem onClick={appendAudioTrackToSection}>Add audio track</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Track labels - synced scroll (no scrollbar) */}
          <div
            ref={trackHeadersViewportRef}
            className="relative flex-1 overflow-hidden border-r border-border"
          >
            <div ref={trackHeadersRootRef} className="flex h-full min-h-0 flex-col">
              {hasTrackSections ? (
                <>
                  {renderTrackHeadersSection(videoTracks, {
                    section: 'video',
                    height: videoPaneHeight,
                    zoneHeight: 0,
                    scrollRef: videoTrackHeadersScrollRef,
                    dropIndicatorLocalIndex: videoDropIndicatorIndex,
                    showTopDividerForFirstTrack: true,
                  })}
                  <TrackSectionDivider onMouseDown={handleSectionDividerMouseDown} />
                  {renderTrackHeadersSection(audioTracks, {
                    section: 'audio',
                    height: audioPaneHeight,
                    zoneHeight: audioZoneHeight,
                    scrollRef: audioTrackHeadersScrollRef,
                    dropIndicatorLocalIndex: audioDropIndicatorIndex,
                    showTopDividerForFirstTrack: false,
                  })}
                </>
              ) : (
                renderTrackHeadersSection(singleSectionTracks, {
                  section: singleSectionKind,
                  height: singleSectionHeight,
                  zoneHeight: singleSectionZoneHeight,
                  scrollRef: allTrackHeadersScrollRef,
                  dropIndicatorLocalIndex: singleDropIndicatorIndex,
                  showTopDividerForFirstTrack: true,
                })
              )}
            </div>
          </div>
        </div>

        {/* Timeline Canvas */}
        <TimelineContent
          duration={duration}
          tracks={visibleTracks}
          scrollRef={timelineContentRef}
          allTracksScrollRef={allTrackContentScrollRef}
          videoTracksScrollRef={videoTrackContentScrollRef}
          audioTracksScrollRef={audioTrackContentScrollRef}
          videoPaneHeight={videoPaneHeight}
          audioPaneHeight={audioPaneHeight}
          onSectionDividerMouseDown={hasTrackSections ? handleSectionDividerMouseDown : undefined}
          onZoomHandlersReady={setZoomHandlers}
          onMetricsChange={setTimelineMetrics}
        />
      </div>

      {needsHorizontalScroll && (
        <div className="flex flex-shrink-0 overflow-hidden">
          <div
            className="panel-bg flex-shrink-0 border-r border-border"
            style={{ width: EDITOR_LAYOUT_CSS_VALUES.timelineSidebarWidth }}
          />
          <div className="min-w-0 flex-1">
            <TimelineNavigator
              actualDuration={timelineMetrics.actualDuration}
              timelineWidth={timelineMetrics.timelineWidth}
              scrollContainerRef={timelineContentRef}
            />
          </div>
        </div>
      )}
      <TransitionDragTooltip />
    </div>

  );
});
