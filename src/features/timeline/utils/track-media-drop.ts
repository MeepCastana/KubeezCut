import type { TimelineTrack } from '@/types/timeline';
import { findNearestAvailableSpace, type CollisionRect } from './collision-utils';
import {
  createClassicTrack,
  findNearestTrackByKind,
  getAdjacentTrackOrder,
  getTrackKind,
  renameTrackForKind,
  type TrackKind,
} from './classic-tracks';
import type { DroppableMediaType } from './dropped-media';
import { resolveLinkedDragTrackTargets } from './linked-drag-targeting';

export interface TrackMediaDropPlanEntry<T> {
  payload: T;
  label: string;
  mediaType: DroppableMediaType;
  durationInFrames: number;
  hasLinkedAudio?: boolean;
}

export interface TrackMediaDropPlacement {
  trackId: string;
  from: number;
  durationInFrames: number;
  mediaType: DroppableMediaType;
}

export interface TrackMediaDropPlannedItem<T> {
  entry: TrackMediaDropPlanEntry<T>;
  placements: TrackMediaDropPlacement[];
  linkVideoAudio: boolean;
}

export interface TrackMediaGhostPreview {
  left: number;
  width: number;
  label: string;
  type: DroppableMediaType;
  targetTrackId: string;
  /**
   * New V/image lane not committed yet — render ghost row **above** the row being hovered (e.g. spawn V1 over A1).
   */
  previewAboveTrackId?: string;
  /**
   * Placement is on a track that does not exist in the store until drop (e.g. first A1).
   * Render this ghost lane directly under this classic track row.
   */
  previewBelowTrackId?: string;
}

/**
 * Returns true when none of the given track IDs have any item rect in `itemsToCheck`.
 * Used to "snap to frame 0" when a user drops the very first clip onto an empty lane —
 * the cursor frame is intentionally ignored so a fresh sequence starts at the timeline origin.
 */
function areAllTracksEmpty(
  trackIds: string[],
  itemsToCheck: CollisionRect[]
): boolean {
  return !itemsToCheck.some((rect) => trackIds.includes(rect.trackId));
}

function resolveSyncedDropFrame(
  proposedFrom: number,
  durationInFrames: number,
  trackIds: string[],
  itemsToCheck: CollisionRect[]
): number | null {
  let candidate = Math.max(0, proposedFrom);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const positions = trackIds.map((trackId) => findNearestAvailableSpace(
      candidate,
      durationInFrames,
      trackId,
      itemsToCheck
    ));

    if (positions.some((position) => position === null)) {
      return null;
    }

    const normalized = positions as number[];
    const alignedFrom = Math.max(...normalized);
    if (normalized.every((position) => position === alignedFrom)) {
      return alignedFrom;
    }

    candidate = alignedFrom;
  }

  return null;
}

function ensureTrackForKind(
  currentTracks: TimelineTrack[],
  targetTrack: TimelineTrack,
  kind: TrackKind,
  directionWhenCreating: 'above' | 'below',
  preferTarget = false
): { tracks: TimelineTrack[]; trackId: string } {
  const targetKind = getTrackKind(targetTrack);

  if (preferTarget || targetKind === kind || targetKind === null) {
    const upgradedTrack = renameTrackForKind(targetTrack, currentTracks, kind);
    if (upgradedTrack === targetTrack) {
      return { tracks: currentTracks, trackId: targetTrack.id };
    }
    return {
      tracks: currentTracks.map((track) => track.id === targetTrack.id ? upgradedTrack : track),
      trackId: targetTrack.id,
    };
  }

  const existingTrack = findNearestTrackByKind({
    tracks: currentTracks,
    targetTrack,
    kind,
    direction: directionWhenCreating,
  });
  if (existingTrack) {
    return { tracks: currentTracks, trackId: existingTrack.id };
  }

  const createdTrack = createClassicTrack({
    tracks: currentTracks,
    kind,
    order: getAdjacentTrackOrder(currentTracks, targetTrack, directionWhenCreating),
  });
  return { tracks: [...currentTracks, createdTrack], trackId: createdTrack.id };
}

export function planTrackMediaDropPlacements<T>(params: {
  entries: Array<TrackMediaDropPlanEntry<T>>;
  dropFrame: number;
  tracks: TimelineTrack[];
  existingItems: CollisionRect[];
  dropTargetTrackId: string;
  /**
   * True when the pointer is in the bottom strip of an audio row: create/use a fresh audio lane
   * below that row (multi-entry drops share one spawned lane).
   */
  preferNewAudioLane?: boolean;
}): { plannedItems: Array<TrackMediaDropPlannedItem<T>>; tracks: TimelineTrack[] } {
  let currentPosition = Math.max(0, params.dropFrame);
  const reservedRanges: CollisionRect[] = [];
  const plannedItems: Array<TrackMediaDropPlannedItem<T>> = [];
  let workingTracks = [...params.tracks];
  let preferNewAudioSpawnedId: string | null = null;

  for (const entry of params.entries) {
    const targetTrack = workingTracks.find((candidate) => candidate.id === params.dropTargetTrackId);
    if (!targetTrack) {
      continue;
    }

    const itemsToCheck: CollisionRect[] = [...params.existingItems, ...reservedRanges];
    const isVideoWithAudio = entry.mediaType === 'video' && !!entry.hasLinkedAudio;
    const isVisualMedia = entry.mediaType === 'video' || entry.mediaType === 'image';

    /**
     * Drops often resolve to the active/hovered track. If that lane is audio but the payload is
     * video/image, retarget to the nearest video row above (same stack) or create a video lane —
     * otherwise the plan was empty and nothing appeared on drop.
     */
    let resolvedTargetTrack = targetTrack;
    if (isVisualMedia && getTrackKind(resolvedTargetTrack) === 'audio') {
      const videoPeer = findNearestTrackByKind({
        tracks: workingTracks,
        targetTrack: resolvedTargetTrack,
        kind: 'video',
        direction: 'above',
      });
      if (videoPeer) {
        resolvedTargetTrack = videoPeer;
      } else {
        const createdVideo = createClassicTrack({
          tracks: workingTracks,
          kind: 'video',
          order: getAdjacentTrackOrder(workingTracks, resolvedTargetTrack, 'above'),
          height: resolvedTargetTrack.height,
        });
        workingTracks = [...workingTracks, createdVideo];
        resolvedTargetTrack = createdVideo;
      }
    }

    if (
      !isVisualMedia
      && entry.mediaType === 'audio'
      && getTrackKind(resolvedTargetTrack) === 'audio'
    ) {
      if (preferNewAudioSpawnedId) {
        const reuse = workingTracks.find((t) => t.id === preferNewAudioSpawnedId);
        if (reuse) {
          resolvedTargetTrack = reuse;
        }
      } else if (params.preferNewAudioLane) {
        const createdAudio = createClassicTrack({
          tracks: workingTracks,
          kind: 'audio',
          order: getAdjacentTrackOrder(workingTracks, resolvedTargetTrack, 'below'),
          height: resolvedTargetTrack.height,
        });
        workingTracks = [...workingTracks, createdAudio];
        resolvedTargetTrack = createdAudio;
        preferNewAudioSpawnedId = createdAudio.id;
      }
    }

    const primaryTrackState = ensureTrackForKind(
      workingTracks,
      resolvedTargetTrack,
      isVisualMedia ? 'video' : 'audio',
      isVisualMedia ? 'above' : 'below',
      getTrackKind(resolvedTargetTrack) === null
    );
    workingTracks = primaryTrackState.tracks;

    let placements: TrackMediaDropPlacement[];

    if (isVideoWithAudio) {
      const hoveredKind = getTrackKind(resolvedTargetTrack);
      const linkedTrackTargets = resolveLinkedDragTrackTargets({
        tracks: workingTracks,
        hoveredTrackId: resolvedTargetTrack.id,
        zone: hoveredKind === 'audio' ? 'audio' : 'video',
        preferredTrackHeight: resolvedTargetTrack.height,
      });

      if (!linkedTrackTargets) {
        continue;
      }
      workingTracks = linkedTrackTargets.tracks;

      /**
       * First clip into a brand-new (empty) lane snaps to frame 0 so users don't end up with a big
       * gap before their first clip. Both the video and the audio companion must be empty for the
       * linked drop, otherwise honor the cursor.
       */
      const linkedTargetIds = [linkedTrackTargets.videoTrackId, linkedTrackTargets.audioTrackId];
      const proposedLinkedFrom = areAllTracksEmpty(linkedTargetIds, itemsToCheck)
        ? 0
        : currentPosition;
      const syncFrom = resolveSyncedDropFrame(
        proposedLinkedFrom,
        entry.durationInFrames,
        linkedTargetIds,
        itemsToCheck,
      );

      if (syncFrom === null) {
        continue;
      }

      placements = [
        {
          trackId: linkedTrackTargets.videoTrackId,
          from: syncFrom,
          durationInFrames: entry.durationInFrames,
          mediaType: 'video',
        },
        {
          trackId: linkedTrackTargets.audioTrackId,
          from: syncFrom,
          durationInFrames: entry.durationInFrames,
          mediaType: 'audio',
        },
      ];
    } else {
      /**
       * First clip into a brand-new (empty) lane snaps to frame 0 — see linked branch comment.
       * After placement, `currentPosition` chains to `0 + duration`, so subsequent multi-file
       * entries onto the same empty lane stack right after the first with no gap.
       */
      const proposedFrom = areAllTracksEmpty([primaryTrackState.trackId], itemsToCheck)
        ? 0
        : currentPosition;
      const finalPosition = findNearestAvailableSpace(
        proposedFrom,
        entry.durationInFrames,
        primaryTrackState.trackId,
        itemsToCheck,
      );

      if (finalPosition === null) {
        continue;
      }

      placements = [{
        trackId: primaryTrackState.trackId,
        from: finalPosition,
        durationInFrames: entry.durationInFrames,
        mediaType: entry.mediaType,
      }];
    }

    plannedItems.push({
      entry,
      placements,
      linkVideoAudio: isVideoWithAudio,
    });
    for (const placement of placements) {
      reservedRanges.push({
        from: placement.from,
        durationInFrames: placement.durationInFrames,
        trackId: placement.trackId,
      });
    }
    currentPosition = placements[0]!.from + entry.durationInFrames;
  }

  return {
    plannedItems,
    tracks: workingTracks,
  };
}

export function buildGhostPreviewsFromTrackMediaDropPlan<T>(params: {
  plannedItems: Array<TrackMediaDropPlannedItem<T>>;
  frameToPixels: (frame: number) => number;
  /** IDs of tracks currently in the timeline store (excludes planned-but-uncommitted lanes). */
  existingTrackIds: ReadonlySet<string>;
  /** Track under the pointer; anchors ephemeral lanes (`previewAboveTrackId` / `previewBelowTrackId`). */
  dropTargetTrackId: string;
}): TrackMediaGhostPreview[] {
  return params.plannedItems.flatMap((plannedItem) => (
    plannedItem.placements.map((placement) => {
      const inStore = params.existingTrackIds.has(placement.trackId);
      const isVisualPlacement =
        placement.mediaType === 'video' || placement.mediaType === 'image';
      const previewAboveTrackId =
        !inStore && isVisualPlacement ? params.dropTargetTrackId : undefined;
      const previewBelowTrackId =
        !inStore && placement.mediaType === 'audio'
          ? params.dropTargetTrackId
          : undefined;

      return {
        left: params.frameToPixels(placement.from),
        width: params.frameToPixels(placement.durationInFrames),
        label: plannedItem.entry.label,
        type: placement.mediaType,
        targetTrackId: placement.trackId,
        ...(previewAboveTrackId !== undefined ? { previewAboveTrackId } : {}),
        ...(previewBelowTrackId !== undefined ? { previewBelowTrackId } : {}),
      };
    })
  ));
}
