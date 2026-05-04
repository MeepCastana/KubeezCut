import { mediaLibraryService } from '@/features/media-library/services/media-library-service';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { placeKubeezGeneratedMediaOnTrack } from '@/features/timeline/utils/place-imported-image-on-track';
import {
  audioExtensionFromMime,
  generateKubeezDialogueBlob,
  generateKubeezMusicFiles,
  KUBEEZ_DEFAULT_DIALOGUE_VOICE_ID,
} from '@/infrastructure/kubeez/kubeez-audio-generations';
import { extensionFromMime, generateKubeezMediaBlob } from '@/infrastructure/kubeez/kubeez-text-to-image';
import { uploadKubeezMediaFile } from '@/infrastructure/kubeez/kubeez-upload-media';
import { videoModelIdEncodesVariantParams } from '@/infrastructure/kubeez/kubeez-video-model-variants';
import { createLogger } from '@/shared/logging/logger';
import type { MediaMetadata } from '@/types/storage';
import { toast } from 'sonner';

const logger = createLogger('KubeezGenerateJob');

/**
 * Maps a base image model to its edit counterpart when the user attaches reference media.
 * Models that already are edit variants or have no edit pair are returned as-is.
 */
const EDIT_MODEL_MAP: Record<string, string> = {
  'flux-2-1K': 'flux-2-edit-1K',
  'flux-2-2K': 'flux-2-edit-2K',
  'seedream-v4': 'seedream-v4-edit',
  'seedream-v4-5': 'seedream-v4-5-edit',
  'grok-text-to-image': 'grok-image-to-image',
  'qwen-text-to-image': 'qwen-image-to-image',
};

function resolveEditModelId(modelId: string): string {
  return EDIT_MODEL_MAP[modelId] ?? modelId;
}

export type KubeezGenerateJobSnapshot = {
  apiKey: string;
  baseUrl: string | undefined;
  projectId: string;
  prompt: string;
  mode: 'music' | 'speech' | 'image_video';
  mediaGenModelId: string;
  musicInstrumental?: boolean;
  speechVoice?: string;
  speechLanguage?: string;
  speechStability?: number;
  imageVideo?: {
    isVideo: boolean;
    aspectRatio: string;
    videoDuration: string | undefined;
    includeAspectRatio: boolean;
    referenceFiles: File[];
    /** POST /v1/generate/media `quality` when applicable (e.g. P Image Edit turbo). */
    quality?: string;
    /** POST /v1/generate/media `resolution` when applicable (e.g. GPT Image 2 1K/2K/4K). */
    resolution?: string;
  };
  timelinePlacement?: { trackId: string };
  playheadFrame: number;
  fps: number;
  canvasWidth: number;
  canvasHeight: number;
};

function projectStillMatches(projectId: string): boolean {
  return useMediaLibraryStore.getState().currentProjectId === projectId;
}

/**
 * Runs after the generate dialog closes: completes Kubeez request, imports into the library,
 * optionally places on the timeline. Updates or removes the pending grid card via `jobId`.
 */
export async function runKubeezGenerateJobInBackground(
  jobId: string,
  snapshot: KubeezGenerateJobSnapshot
): Promise<void> {
  const {
    apiKey,
    baseUrl,
    projectId,
    prompt,
    mode,
    mediaGenModelId,
    timelinePlacement,
    playheadFrame,
    fps,
    canvasWidth,
    canvasHeight,
  } = snapshot;

  const dismissPending = () => {
    useMediaLibraryStore.getState().removeKubeezPendingGeneration(jobId);
  };

  try {
    if (mode === 'music') {
      const musicFiles = await generateKubeezMusicFiles({
        apiKey,
        baseUrl,
        prompt,
        instrumental: snapshot.musicInstrumental ?? false,
        model: mediaGenModelId,
      });
      if (!projectStillMatches(projectId)) {
        dismissPending();
        return;
      }
      if (musicFiles.length === 0) {
        throw new Error('No music tracks were returned.');
      }

      const importedMusic: MediaMetadata[] = [];
      for (const { blob: trackBlob, suggestedFileName } of musicFiles) {
        const mime = trackBlob.type || 'audio/mpeg';
        const fileForLib = new File([trackBlob], suggestedFileName, { type: mime });
        const media = await mediaLibraryService.importGeneratedMedia(fileForLib, projectId, {
          tags: ['kubeez', 'music', mediaGenModelId],
        });
        importedMusic.push(media);
      }

      if (!projectStillMatches(projectId)) {
        dismissPending();
        return;
      }

      dismissPending();
      useMediaLibraryStore.setState((state) => ({
        mediaItems: [...[...importedMusic].reverse(), ...state.mediaItems],
      }));

      if (timelinePlacement && importedMusic[0]) {
        await placeKubeezGeneratedMediaOnTrack({
          trackId: timelinePlacement.trackId,
          dropFrame: playheadFrame,
          media: importedMusic[0],
          fps,
          canvasWidth,
          canvasHeight,
        });
      }

      toast.success(
        timelinePlacement
          ? importedMusic.length > 1
            ? `First of ${importedMusic.length} tracks added to timeline; all saved to library.`
            : 'Media added to timeline'
          : importedMusic.length > 1
            ? `${importedMusic.length} tracks added to library`
            : 'Media added to library'
      );
      return;
    }

    if (mode === 'speech') {
      const stability = Math.min(
        1,
        Math.max(0, Number.parseFloat(String(snapshot.speechStability ?? 0.5)) || 0.5)
      );
      const blob = await generateKubeezDialogueBlob({
        apiKey,
        baseUrl,
        dialogue: [{ text: prompt, voice: snapshot.speechVoice ?? KUBEEZ_DEFAULT_DIALOGUE_VOICE_ID }],
        stability,
        language_code: snapshot.speechLanguage ?? 'auto',
      });

      if (!projectStillMatches(projectId)) {
        dismissPending();
        return;
      }

      const ext = audioExtensionFromMime(blob.type || 'audio/mpeg');
      const mime = blob.type || 'audio/mpeg';
      const voice = snapshot.speechVoice ?? KUBEEZ_DEFAULT_DIALOGUE_VOICE_ID;
      const file = new File([blob], `kubeez-speech-${Date.now()}.${ext}`, { type: mime });
      const media = await mediaLibraryService.importGeneratedMedia(file, projectId, {
        tags: ['kubeez', 'tts', voice],
      });

      if (!projectStillMatches(projectId)) {
        dismissPending();
        return;
      }

      dismissPending();
      useMediaLibraryStore.setState((state) => ({
        mediaItems: [media, ...state.mediaItems],
      }));

      if (timelinePlacement) {
        await placeKubeezGeneratedMediaOnTrack({
          trackId: timelinePlacement.trackId,
          dropFrame: playheadFrame,
          media,
          fps,
          canvasWidth,
          canvasHeight,
        });
        toast.success('Media added to timeline');
      } else {
        toast.success('Media added to library');
      }
      return;
    }

    const iv = snapshot.imageVideo;
    if (!iv) {
      throw new Error('Missing image/video generation parameters.');
    }

    const sourceMediaUrls: string[] = [];
    for (const file of iv.referenceFiles) {
      const urls = await uploadKubeezMediaFile({
        apiKey,
        baseUrl,
        file,
      });
      sourceMediaUrls.push(...urls);
    }

    if (!projectStillMatches(projectId)) {
      dismissPending();
      return;
    }

    const hasSources = sourceMediaUrls.length > 0;
    let generationType: string;
    if (iv.isVideo) {
      generationType = hasSources ? 'image-to-video' : 'text-to-video';
    } else {
      generationType = hasSources ? 'image-to-image' : 'text-to-image';
    }

    // When the user attaches reference media, route to the edit variant of the model
    // (e.g. flux-2-1K → flux-2-edit-1K, seedream-v4 → seedream-v4-edit).
    const actualModelId = hasSources && !iv.isVideo
      ? resolveEditModelId(mediaGenModelId)
      : mediaGenModelId;

    const blob = await generateKubeezMediaBlob({
      apiKey,
      baseUrl,
      prompt,
      aspectRatio: iv.aspectRatio,
      model: actualModelId,
      generationType,
      includeAspectRatio: iv.includeAspectRatio,
      duration:
        iv.isVideo && iv.videoDuration && !videoModelIdEncodesVariantParams(mediaGenModelId)
          ? iv.videoDuration
          : undefined,
      preferVideoOutput: iv.isVideo,
      ...(iv.quality !== undefined && iv.quality !== '' ? { quality: iv.quality } : {}),
      ...(iv.resolution !== undefined && iv.resolution !== '' ? { resolution: iv.resolution } : {}),
      ...(hasSources ? { sourceMediaUrls } : {}),
    });

    if (!projectStillMatches(projectId)) {
      dismissPending();
      return;
    }

    const ext = extensionFromMime(blob.type || (iv.isVideo ? 'video/mp4' : 'image/png'));
    const file = new File([blob], `kubeez-${Date.now()}.${ext}`, {
      type: blob.type || (iv.isVideo ? 'video/mp4' : 'image/png'),
    });
    const media = await mediaLibraryService.importGeneratedMedia(file, projectId, {
      tags: ['kubeez', mediaGenModelId],
    });

    if (!projectStillMatches(projectId)) {
      dismissPending();
      return;
    }

    dismissPending();
    useMediaLibraryStore.setState((state) => ({
      mediaItems: [media, ...state.mediaItems],
    }));

    if (timelinePlacement) {
      await placeKubeezGeneratedMediaOnTrack({
        trackId: timelinePlacement.trackId,
        dropFrame: playheadFrame,
        media,
        fps,
        canvasWidth,
        canvasHeight,
      });
      toast.success('Media added to timeline');
    } else {
      toast.success('Media added to library');
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      dismissPending();
      return;
    }
    const message = e instanceof Error ? e.message : 'Generation failed';
    logger.error('Kubeez generate failed', e);
    dismissPending();
    toast.error(message);
  }
}
