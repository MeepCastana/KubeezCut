import { describe, expect, it } from 'vitest';
import { createDefaultClassicTracks, getTrackKind } from './classic-tracks';
import {
  buildGhostPreviewsFromTrackMediaDropPlan,
  planTrackMediaDropPlacements,
} from './track-media-drop';

function makeTrack(params: {
  id: string;
  name: string;
  kind: 'video' | 'audio';
  order: number;
}) {
  return {
    id: params.id,
    name: params.name,
    kind: params.kind,
    order: params.order,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    items: [],
  };
}

describe('planTrackMediaDropPlacements', () => {
  it('plans linked video drops onto both video and audio tracks', () => {
    const tracks = createDefaultClassicTracks(72);

    const result = planTrackMediaDropPlacements({
      entries: [{
        payload: { id: 'media-1' },
        label: 'clip.mp4',
        mediaType: 'video',
        durationInFrames: 90,
        hasLinkedAudio: true,
      }],
      dropFrame: 24,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'track-1',
    });

    expect(result.plannedItems).toHaveLength(1);
    const [videoPlacement, audioPlacement] = result.plannedItems[0]!.placements;
    // First clip into an empty target lane snaps to frame 0 even though dropFrame was 24.
    expect(videoPlacement).toMatchObject({ trackId: 'track-1', mediaType: 'video', from: 0 });
    expect(audioPlacement).toMatchObject({ mediaType: 'audio', from: 0 });
    expect(audioPlacement!.trackId).not.toBe('track-1');
    expect(result.tracks.filter((track) => getTrackKind(track) === 'audio')).toHaveLength(1);
  });

  it('maps linked video dropped on V2 to A2', () => {
    const tracks = [
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
      makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
    ];

    const result = planTrackMediaDropPlacements({
      entries: [{
        payload: { id: 'media-v2' },
        label: 'clip-v2.mp4',
        mediaType: 'video',
        durationInFrames: 60,
        hasLinkedAudio: true,
      }],
      dropFrame: 30,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'v2',
    });

    expect(result.plannedItems[0]!.placements).toEqual([
      expect.objectContaining({ trackId: 'v2', mediaType: 'video', from: 0 }),
      expect.objectContaining({ trackId: 'a2', mediaType: 'audio', from: 0 }),
    ]);
  });

  it('retargets linked video dropped on an audio lane to the video row above (V2 + A2)', () => {
    const tracks = [
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
      makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 3 }),
    ];

    const result = planTrackMediaDropPlacements({
      entries: [{
        payload: { id: 'media-a2' },
        label: 'clip-a2.mp4',
        mediaType: 'video',
        durationInFrames: 60,
        hasLinkedAudio: true,
      }],
      dropFrame: 42,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'a2',
    });

    expect(result.plannedItems[0]!.placements).toEqual([
      expect.objectContaining({ trackId: 'v2', mediaType: 'video', from: 0 }),
      expect.objectContaining({ trackId: 'a2', mediaType: 'audio', from: 0 }),
    ]);
  });

  it('retargets visual media dropped on an audio lane to the nearest video track above', () => {
    const tracks = [
      ...createDefaultClassicTracks(72),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
    ];

    const result = planTrackMediaDropPlacements({
      entries: [{
        payload: { id: 'media-2' },
        label: 'still.png',
        mediaType: 'image',
        durationInFrames: 45,
      }],
      dropFrame: 12,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'a1',
    });

    expect(result.plannedItems).toHaveLength(1);
    expect(result.plannedItems[0]!.placements[0]).toMatchObject({
      trackId: 'track-1',
      mediaType: 'image',
      from: 0,
      durationInFrames: 45,
    });
  });

  it('spawns a new audio lane below A1 when preferNewAudioLane is set', () => {
    const tracks = [makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 0 })];
    const result = planTrackMediaDropPlacements({
      entries: [{
        payload: { id: 'snd' },
        label: 'bass.wav',
        mediaType: 'audio',
        durationInFrames: 120,
      }],
      dropFrame: 0,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'a1',
      preferNewAudioLane: true,
    });

    expect(result.plannedItems).toHaveLength(1);
    expect(result.tracks.filter((t) => getTrackKind(t) === 'audio')).toHaveLength(2);
    expect(result.plannedItems[0]!.placements[0]!.trackId).not.toBe('a1');
    expect(result.plannedItems[0]!.placements[0]!.mediaType).toBe('audio');
  });

  it('creates a video lane when visual media is dropped and only audio tracks exist', () => {
    const tracks = [makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 0 })];

    const result = planTrackMediaDropPlacements({
      entries: [{
        payload: { id: 'media-img' },
        label: 'solo.png',
        mediaType: 'image',
        durationInFrames: 30,
      }],
      dropFrame: 6,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'a1',
    });

    expect(result.plannedItems).toHaveLength(1);
    const vid = result.tracks.filter((t) => getTrackKind(t) === 'video');
    expect(vid).toHaveLength(1);
    expect(result.plannedItems[0]!.placements[0]!.trackId).toBe(vid[0]!.id);
  });

  it('creates an audio lane when audio is dropped on a video-only stack', () => {
    const tracks = createDefaultClassicTracks(72);

    const result = planTrackMediaDropPlacements({
      entries: [{
        payload: { id: 'media-a1' },
        label: 'voice.wav',
        mediaType: 'audio',
        durationInFrames: 90,
      }],
      dropFrame: 12,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'track-1',
    });

    expect(result.plannedItems).toHaveLength(1);
    const placement = result.plannedItems[0]!.placements[0];
    // Empty target lane snaps the first clip to frame 0.
    expect(placement).toMatchObject({ mediaType: 'audio', from: 0, durationInFrames: 90 });
    const host = result.tracks.find((t) => t.id === placement!.trackId);
    expect(getTrackKind(host!)).toBe('audio');
    expect(result.tracks.filter((t) => getTrackKind(t) === 'audio')).toHaveLength(1);
  });

  it('honors the cursor frame when the target track already has an item', () => {
    const tracks = createDefaultClassicTracks(72);

    const result = planTrackMediaDropPlacements({
      entries: [{
        payload: { id: 'media-2' },
        label: 'second.mp4',
        mediaType: 'image',
        durationInFrames: 30,
      }],
      dropFrame: 100,
      tracks,
      // Existing clip occupying [0, 60) on track-1 — no longer "empty", so snap is disabled.
      existingItems: [{ trackId: 'track-1', from: 0, durationInFrames: 60 }],
      dropTargetTrackId: 'track-1',
    });

    expect(result.plannedItems).toHaveLength(1);
    expect(result.plannedItems[0]!.placements[0]).toMatchObject({
      trackId: 'track-1',
      mediaType: 'image',
      from: 100,
    });
  });

  it('multi-entry drop onto an empty track snaps the first to 0 and chains the rest', () => {
    const tracks = createDefaultClassicTracks(72);

    const result = planTrackMediaDropPlacements({
      entries: [
        { payload: { id: 'a' }, label: 'a.png', mediaType: 'image', durationInFrames: 30 },
        { payload: { id: 'b' }, label: 'b.png', mediaType: 'image', durationInFrames: 45 },
        { payload: { id: 'c' }, label: 'c.png', mediaType: 'image', durationInFrames: 20 },
      ],
      dropFrame: 500,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'track-1',
    });

    expect(result.plannedItems).toHaveLength(3);
    expect(result.plannedItems[0]!.placements[0]).toMatchObject({ from: 0, durationInFrames: 30 });
    expect(result.plannedItems[1]!.placements[0]).toMatchObject({ from: 30, durationInFrames: 45 });
    expect(result.plannedItems[2]!.placements[0]).toMatchObject({ from: 75, durationInFrames: 20 });
  });
});

describe('buildGhostPreviewsFromTrackMediaDropPlan', () => {
  it('builds a companion audio ghost on the linked audio track', () => {
    const tracks = createDefaultClassicTracks(72);
    const { plannedItems } = planTrackMediaDropPlacements({
      entries: [{
        payload: { id: 'media-1' },
        label: 'clip.mp4',
        mediaType: 'video',
        durationInFrames: 90,
        hasLinkedAudio: true,
      }],
      dropFrame: 24,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'track-1',
    });

    const existingIds = new Set(tracks.map((t) => t.id));
    const ghosts = buildGhostPreviewsFromTrackMediaDropPlan({
      plannedItems,
      frameToPixels: (frame) => frame,
      existingTrackIds: existingIds,
      dropTargetTrackId: 'track-1',
    });

    const audioTrackId = plannedItems[0]!.placements.find((placement) => placement.mediaType === 'audio')?.trackId;
    expect(audioTrackId).toBeDefined();
    // Both companion ghost rectangles snap to left: 0 because the target lanes are empty.
    expect(ghosts).toEqual([
      expect.objectContaining({ targetTrackId: 'track-1', type: 'video', left: 0, width: 90 }),
      expect.objectContaining({
        targetTrackId: audioTrackId,
        type: 'audio',
        left: 0,
        width: 90,
        previewBelowTrackId: 'track-1',
      }),
    ]);
  });

  it('sets previewAboveTrackId when a new video lane is planned above an audio-only drop target', () => {
    const tracks = [makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 0 })];
    const { plannedItems } = planTrackMediaDropPlacements({
      entries: [{
        payload: { id: 'img-1' },
        label: 'still.png',
        mediaType: 'image',
        durationInFrames: 48,
      }],
      dropFrame: 6,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'a1',
    });

    expect(plannedItems).toHaveLength(1);
    const placement = plannedItems[0]!.placements[0]!;
    expect(placement.mediaType).toBe('image');

    const ghosts = buildGhostPreviewsFromTrackMediaDropPlan({
      plannedItems,
      frameToPixels: (frame) => frame,
      existingTrackIds: new Set(tracks.map((t) => t.id)),
      dropTargetTrackId: 'a1',
    });

    expect(ghosts).toEqual([
      expect.objectContaining({
        targetTrackId: placement.trackId,
        previewAboveTrackId: 'a1',
        type: 'image',
        left: 0,
        width: 48,
      }),
    ]);
  });

  it('sets previewBelowTrackId when first audio lane is planned under V1', () => {
    const tracks = createDefaultClassicTracks(72);
    const { plannedItems } = planTrackMediaDropPlacements({
      entries: [{
        payload: { id: 'm1' },
        label: 'clip.mp3',
        mediaType: 'audio',
        durationInFrames: 90,
      }],
      dropFrame: 12,
      tracks,
      existingItems: [],
      dropTargetTrackId: 'track-1',
    });

    expect(plannedItems).toHaveLength(1);
    const placement = plannedItems[0]!.placements[0]!;
    expect(placement.trackId).not.toBe('track-1');
    expect(placement.mediaType).toBe('audio');

    const ghosts = buildGhostPreviewsFromTrackMediaDropPlan({
      plannedItems,
      frameToPixels: (frame) => frame,
      existingTrackIds: new Set(tracks.map((t) => t.id)),
      dropTargetTrackId: 'track-1',
    });

    expect(ghosts).toEqual([
      expect.objectContaining({
        targetTrackId: placement.trackId,
        previewBelowTrackId: 'track-1',
        type: 'audio',
        left: 0,
        width: 90,
      }),
    ]);
  });
});
