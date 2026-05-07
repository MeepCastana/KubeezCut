/**
 * Maps KubeezCut generate-dialog selection to KubeezWebsite `fileRestrictions` inputs
 * (`generationType`, `getFileLimitForModel` options).
 */

import type { KubeezModelSettings, KubeezVeo31Tier } from './model-family-registry';

export type KubeezCutFileLimitOptions = {
  multiShot?: boolean;
  veo31Tier?: KubeezVeo31Tier;
};

/**
 * Full generation context from UI settings (preferred over id-only inference).
 */
export function inferGenerationTypeForKubeezCut(params: {
  baseCardId: string;
  settings: KubeezModelSettings;
}): string | undefined {
  const { baseCardId, settings } = params;

  if (baseCardId === 'veo3-1') {
    const mode = settings.veo31?.mode ?? 'text-to-video';
    if (mode === 'first-and-last-frames') return 'FIRST_AND_LAST_FRAMES_2_VIDEO';
    if (mode === 'reference-to-video') return 'REFERENCE_2_VIDEO';
    return 'TEXT_2_VIDEO';
  }

  if (baseCardId === 'kling-2-6') {
    const mode = settings.kling26?.mode ?? 'text-to-video';
    return mode === 'image-to-video' ? 'IMAGE_2_VIDEO' : 'TEXT_2_VIDEO';
  }

  if (baseCardId === 'wan-2-5') {
    const src = settings.wan25?.source ?? 'text';
    return src === 'image' ? 'IMAGE_2_VIDEO' : 'TEXT_2_VIDEO';
  }

  if (baseCardId === 'grok-video') {
    const mode = settings.grokVideoMode ?? 'text-to-video';
    return mode === 'image-to-video' ? 'IMAGE_2_VIDEO' : 'TEXT_2_VIDEO';
  }

  return undefined;
}

export function inferKubeezCutFileLimitOptions(settings: KubeezModelSettings): KubeezCutFileLimitOptions {
  return {
    multiShot: false,
    veo31Tier: settings.veo31?.tier,
  };
}

/**
 * When only `model_id` is known (catalog merge), infer generation type so
 * `getFileLimitForModel` matches website behavior for concrete variant ids.
 */
export function inferGenerationTypeFromConcreteModelId(modelId: string): string | undefined {
  if (!modelId) return undefined;

  // Wan NSFW (website uses lowercase `image-to-image` / `image-to-video`, not TEXT_2_VIDEO)
  if (modelId.startsWith('wan-nsfw-video')) return 'image-to-video';
  if (modelId.startsWith('wan-nsfw-i2v') || modelId.startsWith('wan-nsfw-i2i')) return undefined;
  if (modelId.startsWith('wan-nsfw')) return 'image-to-image';

  // Veo 3.1 variant ids
  if (modelId.includes('reference-to-video')) return 'REFERENCE_2_VIDEO';
  if (modelId.includes('first-and-last')) return 'FIRST_AND_LAST_FRAMES_2_VIDEO';
  if (modelId.startsWith('veo3-1-') && modelId.includes('text-to-video')) return 'TEXT_2_VIDEO';

  // Kling 2.6 / 3.0 motion (IMAGE_2_VIDEO triggers motion-control special case in website)
  if (modelId.startsWith('kling-2-6-motion-control') || modelId.startsWith('kling-3-0-motion-control')) {
    return 'IMAGE_2_VIDEO';
  }
  if (modelId.includes('kling-2-6-image-to-video') || modelId.includes('kling-2-6-text-to-video')) {
    return modelId.includes('image-to-video') ? 'IMAGE_2_VIDEO' : 'TEXT_2_VIDEO';
  }

  // Wan 2.5
  if (modelId.startsWith('wan-2-5-')) {
    if (modelId.includes('image-to-video')) return 'IMAGE_2_VIDEO';
    if (modelId.includes('text-to-video')) return 'TEXT_2_VIDEO';
  }

  // Seedance 1.5 Pro: id does not encode I2V vs T2V — default branch in website (max 1)
  if (modelId.startsWith('seedance-1-5-pro-')) return undefined;

  // Kling 3.0 std/pro: default TEXT_2_VIDEO (max 1) until Cut adds I2V toggle
  if (modelId === 'kling-3-0-std' || modelId === 'kling-3-0-pro') return undefined;

  return undefined;
}
