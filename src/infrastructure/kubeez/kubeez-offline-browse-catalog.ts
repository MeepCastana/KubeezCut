import { applyModelRequirementFallbacks } from './kubeez-model-requirements-fallback';
import { filterKubeezCutCatalogModels, type KubeezMediaModelOption } from './kubeez-models';

/**
 * Static model rows for browsing when no API key is configured. Aligned with Kubeez public docs
 * (`kubeez.com/docs`) and the same registry/card artwork as the Kubeez web app. Live `GET /v1/models`
 * responses replace this list once an API key is set.
 */

function sortByDisplayName(models: KubeezMediaModelOption[]): KubeezMediaModelOption[] {
  return [...models].sort((a, b) =>
    a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' })
  );
}

function img(p: Omit<KubeezMediaModelOption, 'mediaKind'>): KubeezMediaModelOption {
  return { ...p, mediaKind: 'image', showAspectRatio: p.showAspectRatio ?? true };
}

function vid(p: Omit<KubeezMediaModelOption, 'mediaKind'>): KubeezMediaModelOption {
  return { ...p, mediaKind: 'video', showAspectRatio: false };
}

function mus(p: Omit<KubeezMediaModelOption, 'mediaKind'>): KubeezMediaModelOption {
  return { ...p, mediaKind: 'music', showAspectRatio: false };
}

/** One representative row per video family in `KUBEEZ_MODEL_FAMILY_REGISTRY` (ids match Kubeez API shapes). */
const OFFLINE_BROWSE_VIDEO_MODELS: KubeezMediaModelOption[] = [
  vid({
    model_id: 'seedance-1-5-pro-720p-8s',
    display_name: 'Seedance 1.5 Pro',
    provider: 'ByteDance',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
  }),
  vid({
    model_id: 'v1-pro-fast-i2v-720p-5s',
    display_name: 'Seedance 1.0',
    provider: 'ByteDance',
    // API `generation_types=["image-to-video"]` — T2V is not supported.
    supportsTextToVideo: false,
    supportsImageToVideo: true,
  }),
  vid({
    model_id: 'seedance-2-720p',
    display_name: 'Seedance 2',
    provider: 'ByteDance',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
  }),
  vid({
    model_id: 'p-video',
    display_name: 'P-Video',
    provider: 'Pruna AI',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
  }),
  vid({
    model_id: 'kling-2-6-text-to-video-5s',
    display_name: 'Kling 2.6',
    provider: 'Kuaishou',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
  }),
  vid({
    model_id: 'kling-2-6-motion-control-720p',
    display_name: 'Kling 2.6 Motion',
    provider: 'Kuaishou',
    supportsTextToVideo: false,
    supportsImageToVideo: true,
  }),
  vid({
    model_id: 'kling-3-0-std',
    display_name: 'Kling 3.0',
    provider: 'Kuaishou',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
  }),
  vid({
    model_id: 'sora-2-text-to-video-10s',
    display_name: 'Sora 2',
    provider: 'OpenAI',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
  }),
  vid({
    model_id: 'veo3-1-fast-text-to-video',
    display_name: 'Veo 3.1',
    provider: 'Google',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
  }),
  vid({
    model_id: 'wan-2-5',
    display_name: 'Wan 2.5',
    provider: 'Alibaba',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
  }),
  vid({
    model_id: 'kling-2-5-image-to-video-pro',
    display_name: 'Kling 2.5 Image-to-Video',
    provider: 'Kuaishou',
    supportsTextToVideo: false,
    supportsImageToVideo: true,
  }),
  vid({
    model_id: 'grok-text-to-video-6s',
    display_name: 'Grok Video',
    provider: 'xAI',
    supportsTextToVideo: true,
    supportsImageToVideo: true,
  }),
];

/** Image models from Kubeez REST model tables + common catalog ids (card art maps via `resolveLocalKubeezModelCardImage`). */
const OFFLINE_BROWSE_IMAGE_MODELS: KubeezMediaModelOption[] = [
  img({ model_id: '5-lite-image-to-image', display_name: 'Seedream 5 Lite · Image to image', provider: 'ByteDance' }),
  img({ model_id: '5-lite-text-to-image', display_name: 'Seedream 5 Lite · Text to image', provider: 'ByteDance' }),
  img({ model_id: 'flux-2-1K', display_name: 'Flux 2 1K', provider: 'Black Forest Labs' }),
  img({ model_id: 'flux-2-2K', display_name: 'Flux 2 2K', provider: 'Black Forest Labs' }),
  img({ model_id: 'flux-2-edit-1K', display_name: 'Flux 2 Edit 1K', provider: 'Black Forest Labs' }),
  img({ model_id: 'flux-2-edit-2K', display_name: 'Flux 2 Edit 2K', provider: 'Black Forest Labs' }),
  img({ model_id: 'gpt-1.5-image-high', display_name: 'GPT 1.5 Image High', provider: 'OpenAI' }),
  img({ model_id: 'gpt-1.5-image-medium', display_name: 'GPT 1.5 Image Medium', provider: 'OpenAI' }),
  img({ model_id: 'gpt-image-2', display_name: 'GPT Image 2', provider: 'OpenAI' }),
  img({ model_id: 'grok-image-to-image', display_name: 'Grok Image to image', provider: 'xAI' }),
  img({ model_id: 'grok-text-to-image', display_name: 'Grok Text to image', provider: 'xAI' }),
  img({ model_id: 'imagen-4', display_name: 'Imagen 4', provider: 'Google' }),
  img({ model_id: 'imagen-4-fast', display_name: 'Imagen 4 Fast', provider: 'Google' }),
  img({ model_id: 'imagen-4-ultra', display_name: 'Imagen 4 Ultra', provider: 'Google' }),
  img({ model_id: 'logo-maker', display_name: 'Logo Maker', provider: 'Kubeez' }),
  img({ model_id: 'nano-banana', display_name: 'Nano Banana', provider: 'Google' }),
  img({ model_id: 'nano-banana-2', display_name: 'Nano Banana 2', provider: 'Google' }),
  img({ model_id: 'nano-banana-2-2K', display_name: 'Nano Banana 2 2K', provider: 'Google' }),
  img({ model_id: 'nano-banana-2-4K', display_name: 'Nano Banana 2 4K', provider: 'Google' }),
  img({ model_id: 'nano-banana-edit', display_name: 'Nano Banana Edit', provider: 'Google' }),
  img({ model_id: 'nano-banana-pro', display_name: 'Nano Banana Pro', provider: 'Google' }),
  img({ model_id: 'nano-banana-pro-2K', display_name: 'Nano Banana Pro 2K', provider: 'Google' }),
  img({ model_id: 'nano-banana-pro-4K', display_name: 'Nano Banana Pro 4K', provider: 'Google' }),
  img({ model_id: 'p-image-edit', display_name: 'P-Image Edit', provider: 'ByteDance' }),
  img({ model_id: 'qwen-text-to-image', display_name: 'Qwen Image 2 · Text to image', provider: 'Alibaba' }),
  img({ model_id: 'qwen-image-to-image', display_name: 'Qwen Image 2 · Image to image', provider: 'Alibaba' }),
  img({ model_id: 'seedream-v4', display_name: 'Seedream V4', provider: 'ByteDance' }),
  img({ model_id: 'seedream-v4-5', display_name: 'Seedream V4.5', provider: 'ByteDance' }),
  img({ model_id: 'seedream-v4-5-edit', display_name: 'Seedream V4.5 Edit', provider: 'ByteDance' }),
  img({ model_id: 'seedream-v4-edit', display_name: 'Seedream V4 Edit', provider: 'ByteDance' }),
  img({ model_id: 'z-image', display_name: 'Z-Image', provider: 'ByteDance' }),
  img({ model_id: 'z-image-hd', display_name: 'Z-Image HD', provider: 'ByteDance' }),
];

const OFFLINE_BROWSE_MUSIC_MODELS: KubeezMediaModelOption[] = [
  mus({ model_id: 'V4', display_name: 'V4', provider: 'Kubeez' }),
  mus({ model_id: 'V4_5', display_name: 'V4.5', provider: 'Kubeez' }),
  mus({ model_id: 'V4_5PLUS', display_name: 'V4.5+', provider: 'Kubeez' }),
  mus({ model_id: 'V5', display_name: 'V5', provider: 'Kubeez' }),
  mus({ model_id: 'V5_5', display_name: 'V5.5', provider: 'Kubeez' }),
];

export function getKubeezOfflineBrowseCatalog(): {
  imageModels: KubeezMediaModelOption[];
  videoModels: KubeezMediaModelOption[];
  musicModels: KubeezMediaModelOption[];
} {
  return {
    imageModels: sortByDisplayName(
      filterKubeezCutCatalogModels(OFFLINE_BROWSE_IMAGE_MODELS.map(applyModelRequirementFallbacks))
    ),
    videoModels: sortByDisplayName(
      filterKubeezCutCatalogModels(OFFLINE_BROWSE_VIDEO_MODELS.map(applyModelRequirementFallbacks))
    ),
    musicModels: sortByDisplayName(
      filterKubeezCutCatalogModels(OFFLINE_BROWSE_MUSIC_MODELS.map(applyModelRequirementFallbacks))
    ),
  };
}
