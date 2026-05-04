import type { KubeezMediaModelKind } from './kubeez-models';

/**
 * Strategy for mapping UI "card" + settings → concrete Kubeez `model` on POST /v1/generate/media.
 *
 * - `parameterized`: No extra API fields documented for resolution tier; we resolve to composite
 *   model_ids (e.g. nano-banana-2-2K) before POST. Same effective behavior as kubeez-website when
 *   the edge is absent.
 * - `composed`: Build or pick variant id from video axes (resolution, duration, audio).
 * - `toggle`: Discrete API ids selected via one dimension (e.g. Imagen tier).
 */
export type KubeezFamilyStrategy = 'parameterized' | 'composed' | 'toggle';

export interface KubeezModelFamilyRegistryEntry {
  /** Stable card id (may not exist as a single API row). */
  baseCardId: string;
  mediaKind: Extract<KubeezMediaModelKind, 'image' | 'video' | 'music'>;
  strategy: KubeezFamilyStrategy;
  /** Shown on the grid card when using registry (API display names may duplicate). */
  displayName: string;
  /** First matching entry wins — list more specific prefixes before looser ones. */
  matchModelId: (modelId: string) => boolean;
}

/** Ordered: specific prefixes before broader ones (e.g. nano-banana-2 before any future nano-banana-*). */
export const KUBEEZ_MODEL_FAMILY_REGISTRY: KubeezModelFamilyRegistryEntry[] = [
  {
    baseCardId: 'seedance-1-5-pro',
    mediaKind: 'video',
    strategy: 'composed',
    displayName: 'Seedance 1.5 Pro',
    matchModelId: (id) => id.startsWith('seedance-1-5-pro-'),
  },
  {
    baseCardId: 'v1-pro-fast-i2v',
    mediaKind: 'video',
    strategy: 'composed',
    displayName: 'Seedance 1.0',
    matchModelId: (id) => id.startsWith('v1-pro-fast-i2v-'),
  },
  {
    baseCardId: 'kling-2-6',
    mediaKind: 'video',
    strategy: 'composed',
    displayName: 'Kling 2.6',
    matchModelId: (id) =>
      id.startsWith('kling-2-6-text-to-video') || id.startsWith('kling-2-6-image-to-video'),
  },
  {
    baseCardId: 'kling-2-6-motion',
    mediaKind: 'video',
    strategy: 'composed',
    displayName: 'Kling 2.6 Motion',
    matchModelId: (id) => id.startsWith('kling-2-6-motion-control-'),
  },
  {
    baseCardId: 'kling-3-0',
    mediaKind: 'video',
    strategy: 'composed',
    displayName: 'Kling 3.0',
    matchModelId: (id) => id.startsWith('kling-3-0-'),
  },
  {
    baseCardId: 'sora-2',
    mediaKind: 'video',
    strategy: 'composed',
    displayName: 'Sora 2',
    matchModelId: (id) =>
      id.startsWith('sora-2-text-to-video') ||
      id.startsWith('sora-2-image-to-video') ||
      id.startsWith('sora-2-pro-'),
  },
  {
    baseCardId: 'veo3-1',
    mediaKind: 'video',
    strategy: 'composed',
    displayName: 'Veo 3.1',
    matchModelId: (id) => id.startsWith('veo3-1-'),
  },
  {
    baseCardId: 'wan-2-5',
    mediaKind: 'video',
    strategy: 'composed',
    displayName: 'Wan 2.5',
    matchModelId: (id) => id === 'wan-2-5' || id.startsWith('wan-2-5-'),
  },
  {
    baseCardId: 'kling-2-5-i2v',
    mediaKind: 'video',
    strategy: 'toggle',
    displayName: 'Kling 2.5 Image-to-Video',
    matchModelId: (id) =>
      id === 'kling-2-5-image-to-video-pro' || id === 'kling-2-5-image-to-video-pro-10s',
  },
  {
    baseCardId: 'grok-video',
    mediaKind: 'video',
    strategy: 'composed',
    displayName: 'Grok Video',
    matchModelId: (id) => id === 'grok-image-to-video' || id.startsWith('grok-text-to-video'),
  },
  {
    baseCardId: 'nano-banana-2',
    mediaKind: 'image',
    strategy: 'parameterized',
    displayName: 'Nano Banana 2',
    matchModelId: (id) => id === 'nano-banana-2' || id.startsWith('nano-banana-2-'),
  },
  {
    baseCardId: 'nano-banana-pro',
    mediaKind: 'image',
    strategy: 'parameterized',
    displayName: 'Nano Banana Pro',
    matchModelId: (id) => id === 'nano-banana-pro' || id.startsWith('nano-banana-pro-'),
  },
  {
    baseCardId: 'imagen-4',
    mediaKind: 'image',
    strategy: 'toggle',
    displayName: 'Imagen 4',
    matchModelId: (id) => id === 'imagen-4' || id === 'imagen-4-fast' || id === 'imagen-4-ultra',
  },
  {
    baseCardId: 'z-image',
    mediaKind: 'image',
    strategy: 'toggle',
    displayName: 'Z-Image',
    matchModelId: (id) => id === 'z-image' || id === 'z-image-hd',
  },
  {
    baseCardId: 'gpt-1.5-image',
    mediaKind: 'image',
    strategy: 'toggle',
    displayName: 'GPT 1.5 Image',
    matchModelId: (id) => id === 'gpt-1.5-image-medium' || id === 'gpt-1.5-image-high',
  },
  {
    // GPT Image 2 is a single model_id; the 1K / 2K / 4K choice is a body param
    // (`resolution`), not a separate model_id. The toggle is purely a UI affordance.
    baseCardId: 'gpt-image-2',
    mediaKind: 'image',
    strategy: 'toggle',
    displayName: 'GPT Image 2',
    matchModelId: (id) => id === 'gpt-image-2',
  },
  {
    baseCardId: 'suno-music',
    mediaKind: 'music',
    strategy: 'toggle',
    displayName: 'Music',
    matchModelId: (id) =>
      id === 'V4' || id === 'V4_5' || id === 'V4_5PLUS' || id === 'V5' || id === 'V5_5',
  },
];

export function findRegistryEntryForModelId(modelId: string): KubeezModelFamilyRegistryEntry | null {
  for (const e of KUBEEZ_MODEL_FAMILY_REGISTRY) {
    if (e.matchModelId(modelId)) return e;
  }
  return null;
}

export function findRegistryEntryByBaseCardId(baseCardId: string): KubeezModelFamilyRegistryEntry | null {
  return KUBEEZ_MODEL_FAMILY_REGISTRY.find((e) => e.baseCardId === baseCardId) ?? null;
}

export type KubeezImageResolutionTier = '1k' | '2k' | '4k';

export type KubeezImagenTier = 'standard' | 'fast' | 'ultra';

export type KubeezVideoAxisSettings = {
  resolution: string | null;
  duration: string;
  withAudio: boolean;
};

/** Kling 2.6 text vs image-to-video; duration + native audio suffix on API model_id. */
export type KubeezKling26Mode = 'text-to-video' | 'image-to-video';

export type KubeezKling26Settings = {
  mode: KubeezKling26Mode;
  duration: '5s' | '10s';
  withAudio: boolean;
};

/** Grok video: image-to-video vs text-to-video (API uses fixed 6s id for text). */
export type KubeezGrokVideoMode = 'image-to-video' | 'text-to-video';

export type KubeezKling26MotionResolution = '720p' | '1080p';

/** Kling 3.0: standard / pro / motion branch + motion quality tier. */
export type KubeezKling30Line = 'std' | 'pro' | 'motion';

export type KubeezKling30Settings = {
  line: KubeezKling30Line;
  motionResolution: KubeezKling26MotionResolution;
};

export type KubeezSora2Tier = 'base' | 'pro';
export type KubeezSora2Mode = 'text-to-video' | 'image-to-video' | 'storyboard';
export type KubeezSora2Duration = '10s' | '15s' | '25s';
export type KubeezSora2ProQuality = 'hd' | 'standard';

export type KubeezSora2Settings = {
  tier: KubeezSora2Tier;
  mode: KubeezSora2Mode;
  duration: KubeezSora2Duration;
  /** Pro text/image-to-video only */
  proQuality: KubeezSora2ProQuality;
};

export type KubeezZImageTier = 'standard' | 'hd';

export type KubeezGpt15ImageQuality = 'medium' | 'high';

export type KubeezKling25Clip = '5s' | '10s';

export type KubeezVeo31Tier = 'fast' | 'lite' | 'quality';
export type KubeezVeo31Mode = 'text-to-video' | 'first-and-last-frames' | 'reference-to-video';

export type KubeezVeo31Settings = {
  tier: KubeezVeo31Tier;
  mode: KubeezVeo31Mode;
};

export type KubeezWan25Source = 'text' | 'image';
export type KubeezWan25Duration = '5s' | '10s';
export type KubeezWan25Resolution = '720p' | '1080p';

export type KubeezWan25Settings = {
  /** API row `wan-2-5` without suffix axes */
  useSimpleCatalogId: boolean;
  source: KubeezWan25Source;
  duration: KubeezWan25Duration;
  resolution: KubeezWan25Resolution;
};

export type KubeezMusicEngine = 'V4' | 'V4_5' | 'V4_5PLUS' | 'V5' | 'V5_5';

export type KubeezModelSettings = {
  /**
   * Video aspect for POST `aspect_ratio` when not encoded in `model_id`.
   * The generate dialog currently keeps this in local React state; reserved for future persistence.
   */
  videoAspectRatio?: string;
  imageResolution?: KubeezImageResolutionTier;
  imagenTier?: KubeezImagenTier;
  videoAxes?: KubeezVideoAxisSettings;
  kling26?: KubeezKling26Settings;
  grokVideoMode?: KubeezGrokVideoMode;
  kling26MotionResolution?: KubeezKling26MotionResolution;
  kling30?: KubeezKling30Settings;
  sora2?: KubeezSora2Settings;
  zImageTier?: KubeezZImageTier;
  gpt15ImageQuality?: KubeezGpt15ImageQuality;
  kling25Clip?: KubeezKling25Clip;
  veo31?: KubeezVeo31Settings;
  wan25?: KubeezWan25Settings;
  sunoEngine?: KubeezMusicEngine;
  /** P Image Edit: when true (default), maps to `quality: 'turbo'` on POST /v1/generate/media */
  pImageEditTurbo?: boolean;
};

const KLING26_VARIANT_RE =
  /^kling-2-6-(text-to-video|image-to-video)-(5s|10s)(-audio)?$/;

export function parseKling26Variant(modelId: string): KubeezKling26Settings | null {
  const m = modelId.match(KLING26_VARIANT_RE);
  if (!m || !m[1] || !m[2]) return null;
  return {
    mode: m[1] as KubeezKling26Mode,
    duration: m[2] as '5s' | '10s',
    withAudio: Boolean(m[3]),
  };
}

export function mapKling26ToModelId(s: KubeezKling26Settings): string {
  const prefix = s.mode === 'text-to-video' ? 'kling-2-6-text-to-video' : 'kling-2-6-image-to-video';
  return `${prefix}-${s.duration}${s.withAudio ? '-audio' : ''}`;
}

export function inferGrokVideoModeFromModelId(modelId: string): KubeezGrokVideoMode {
  if (modelId === 'grok-image-to-video') return 'image-to-video';
  return 'text-to-video';
}

export function mapGrokVideoToModelId(mode: KubeezGrokVideoMode): string {
  return mode === 'image-to-video' ? 'grok-image-to-video' : 'grok-text-to-video-6s';
}

export function mapKling26MotionToModelId(res: KubeezKling26MotionResolution): string {
  return res === '720p' ? 'kling-2-6-motion-control-720p' : 'kling-2-6-motion-control-1080p';
}

export function inferKling26MotionFromModelId(modelId: string): KubeezKling26MotionResolution {
  return modelId.includes('1080p') ? '1080p' : '720p';
}

export function parseKling30Variant(modelId: string): KubeezKling30Settings | null {
  if (modelId === 'kling-3-0-std') return { line: 'std', motionResolution: '720p' };
  if (modelId === 'kling-3-0-pro') return { line: 'pro', motionResolution: '720p' };
  if (modelId === 'kling-3-0-motion-control-720p') return { line: 'motion', motionResolution: '720p' };
  if (modelId === 'kling-3-0-motion-control-1080p') return { line: 'motion', motionResolution: '1080p' };
  return null;
}

export function mapKling30ToModelId(s: KubeezKling30Settings): string {
  if (s.line === 'std') return 'kling-3-0-std';
  if (s.line === 'pro') return 'kling-3-0-pro';
  return s.motionResolution === '720p'
    ? 'kling-3-0-motion-control-720p'
    : 'kling-3-0-motion-control-1080p';
}

export function parseSora2Variant(modelId: string): KubeezSora2Settings | null {
  switch (modelId) {
    case 'sora-2-text-to-video-10s':
      return { tier: 'base', mode: 'text-to-video', duration: '10s', proQuality: 'standard' };
    case 'sora-2-text-to-video-15s':
      return { tier: 'base', mode: 'text-to-video', duration: '15s', proQuality: 'standard' };
    case 'sora-2-image-to-video-10s':
      return { tier: 'base', mode: 'image-to-video', duration: '10s', proQuality: 'standard' };
    case 'sora-2-image-to-video-15s':
      return { tier: 'base', mode: 'image-to-video', duration: '15s', proQuality: 'standard' };
    case 'sora-2-pro-storyboard-10s':
      return { tier: 'pro', mode: 'storyboard', duration: '10s', proQuality: 'standard' };
    case 'sora-2-pro-storyboard-15s':
      return { tier: 'pro', mode: 'storyboard', duration: '15s', proQuality: 'standard' };
    case 'sora-2-pro-storyboard-25s':
      return { tier: 'pro', mode: 'storyboard', duration: '25s', proQuality: 'standard' };
    case 'sora-2-pro-text-to-video-10s-hd':
      return { tier: 'pro', mode: 'text-to-video', duration: '10s', proQuality: 'hd' };
    case 'sora-2-pro-text-to-video-10s-standard':
      return { tier: 'pro', mode: 'text-to-video', duration: '10s', proQuality: 'standard' };
    case 'sora-2-pro-text-to-video-15s-hd':
      return { tier: 'pro', mode: 'text-to-video', duration: '15s', proQuality: 'hd' };
    case 'sora-2-pro-text-to-video-15s-standard':
      return { tier: 'pro', mode: 'text-to-video', duration: '15s', proQuality: 'standard' };
    case 'sora-2-pro-image-to-video-10s-hd':
      return { tier: 'pro', mode: 'image-to-video', duration: '10s', proQuality: 'hd' };
    case 'sora-2-pro-image-to-video-10s-standard':
      return { tier: 'pro', mode: 'image-to-video', duration: '10s', proQuality: 'standard' };
    case 'sora-2-pro-image-to-video-15s-hd':
      return { tier: 'pro', mode: 'image-to-video', duration: '15s', proQuality: 'hd' };
    case 'sora-2-pro-image-to-video-15s-standard':
      return { tier: 'pro', mode: 'image-to-video', duration: '15s', proQuality: 'standard' };
    default:
      return null;
  }
}

export function mapSora2ToModelId(s: KubeezSora2Settings): string {
  if (s.tier === 'base') {
    if (s.mode === 'image-to-video') {
      return s.duration === '15s' ? 'sora-2-image-to-video-15s' : 'sora-2-image-to-video-10s';
    }
    if (s.mode === 'text-to-video') {
      return s.duration === '15s' ? 'sora-2-text-to-video-15s' : 'sora-2-text-to-video-10s';
    }
    return 'sora-2-text-to-video-10s';
  }
  if (s.mode === 'storyboard') {
    if (s.duration === '25s') return 'sora-2-pro-storyboard-25s';
    if (s.duration === '15s') return 'sora-2-pro-storyboard-15s';
    return 'sora-2-pro-storyboard-10s';
  }
  const q = s.proQuality === 'hd' ? 'hd' : 'standard';
  const dur15 = s.duration === '15s';
  if (s.mode === 'text-to-video') {
    if (dur15) {
      return q === 'hd' ? 'sora-2-pro-text-to-video-15s-hd' : 'sora-2-pro-text-to-video-15s-standard';
    }
    return q === 'hd' ? 'sora-2-pro-text-to-video-10s-hd' : 'sora-2-pro-text-to-video-10s-standard';
  }
  if (dur15) {
    return q === 'hd' ? 'sora-2-pro-image-to-video-15s-hd' : 'sora-2-pro-image-to-video-15s-standard';
  }
  return q === 'hd' ? 'sora-2-pro-image-to-video-10s-hd' : 'sora-2-pro-image-to-video-10s-standard';
}

const NANO2_RESOLUTION_IDS: Record<KubeezImageResolutionTier, string> = {
  '1k': 'nano-banana-2',
  '2k': 'nano-banana-2-2K',
  '4k': 'nano-banana-2-4K',
};

const NANOPRO_RESOLUTION_IDS: Record<KubeezImageResolutionTier, string> = {
  '1k': 'nano-banana-pro',
  '2k': 'nano-banana-pro-2K',
  '4k': 'nano-banana-pro-4K',
};

const IMAGEN_TIER_IDS: Record<KubeezImagenTier, string> = {
  standard: 'imagen-4',
  fast: 'imagen-4-fast',
  ultra: 'imagen-4-ultra',
};

export function defaultModelSettings(
  entry: KubeezModelFamilyRegistryEntry | null
): KubeezModelSettings {
  if (!entry) return {};
  if (entry.strategy === 'parameterized' && entry.baseCardId === 'nano-banana-2') {
    return { imageResolution: '1k' };
  }
  if (entry.strategy === 'parameterized' && entry.baseCardId === 'nano-banana-pro') {
    return { imageResolution: '1k' };
  }
  if (entry.strategy === 'toggle' && entry.baseCardId === 'imagen-4') {
    return { imagenTier: 'standard' };
  }
  if (entry.strategy === 'toggle' && entry.baseCardId === 'gpt-image-2') {
    return { imageResolution: '1k' };
  }
  if (entry.baseCardId === 'kling-2-6') {
    return {
      kling26: { mode: 'text-to-video', duration: '5s', withAudio: false },
    };
  }
  if (entry.baseCardId === 'grok-video') {
    return { grokVideoMode: 'text-to-video' };
  }
  if (entry.baseCardId === 'kling-2-6-motion') {
    return { kling26MotionResolution: '720p' };
  }
  if (entry.baseCardId === 'kling-3-0') {
    return { kling30: { line: 'std', motionResolution: '720p' } };
  }
  if (entry.baseCardId === 'sora-2') {
    return {
      sora2: {
        tier: 'base',
        mode: 'text-to-video',
        duration: '10s',
        proQuality: 'standard',
      },
    };
  }
  if (entry.baseCardId === 'veo3-1') {
    return { veo31: { tier: 'fast', mode: 'text-to-video' } };
  }
  if (entry.baseCardId === 'wan-2-5') {
    return {
      wan25: { useSimpleCatalogId: true, source: 'text', duration: '5s', resolution: '1080p' },
    };
  }
  if (entry.baseCardId === 'kling-2-5-i2v') {
    return { kling25Clip: '5s' };
  }
  if (entry.strategy === 'toggle' && entry.baseCardId === 'z-image') {
    return { zImageTier: 'standard' };
  }
  if (entry.strategy === 'toggle' && entry.baseCardId === 'gpt-1.5-image') {
    return { gpt15ImageQuality: 'medium' };
  }
  if (entry.strategy === 'toggle' && entry.baseCardId === 'suno-music') {
    return { sunoEngine: 'V5_5' };
  }
  if (
    entry.strategy === 'composed' &&
    entry.baseCardId !== 'veo3-1' &&
    entry.baseCardId !== 'wan-2-5'
  ) {
    return {
      videoAxes: { resolution: null, duration: '4s', withAudio: false },
    };
  }
  return {};
}

export function mapImageResolutionToModelId(
  baseCardId: 'nano-banana-2' | 'nano-banana-pro',
  tier: KubeezImageResolutionTier
): string {
  return baseCardId === 'nano-banana-2'
    ? NANO2_RESOLUTION_IDS[tier]
    : NANOPRO_RESOLUTION_IDS[tier];
}

export function mapImagenTierToModelId(tier: KubeezImagenTier): string {
  return IMAGEN_TIER_IDS[tier];
}

export function inferImageResolutionFromModelId(
  modelId: string,
  baseCardId: 'nano-banana-2' | 'nano-banana-pro'
): KubeezImageResolutionTier {
  const expected2k = baseCardId === 'nano-banana-2' ? 'nano-banana-2-2K' : 'nano-banana-pro-2K';
  const expected4k = baseCardId === 'nano-banana-2' ? 'nano-banana-2-4K' : 'nano-banana-pro-4K';
  if (modelId === expected2k) return '2k';
  if (modelId === expected4k) return '4k';
  return '1k';
}

export function inferImagenTierFromModelId(modelId: string): KubeezImagenTier {
  if (modelId === 'imagen-4-fast') return 'fast';
  if (modelId === 'imagen-4-ultra') return 'ultra';
  return 'standard';
}

const Z_IMAGE_TIER_IDS: Record<KubeezZImageTier, string> = {
  standard: 'z-image',
  hd: 'z-image-hd',
};

const GPT15_QUALITY_IDS: Record<KubeezGpt15ImageQuality, string> = {
  medium: 'gpt-1.5-image-medium',
  high: 'gpt-1.5-image-high',
};

const KLING25_CLIP_IDS: Record<KubeezKling25Clip, string> = {
  '5s': 'kling-2-5-image-to-video-pro',
  '10s': 'kling-2-5-image-to-video-pro-10s',
};

const VEO31_ID_TO_SETTINGS: Record<string, KubeezVeo31Settings> = {
  'veo3-1-fast-text-to-video': { tier: 'fast', mode: 'text-to-video' },
  'veo3-1-fast-reference-to-video': { tier: 'fast', mode: 'reference-to-video' },
  'veo3-1-fast-first-and-last-frames': { tier: 'fast', mode: 'first-and-last-frames' },
  'veo3-1-lite-text-to-video': { tier: 'lite', mode: 'text-to-video' },
  'veo3-1-lite-first-and-last-frames': { tier: 'lite', mode: 'first-and-last-frames' },
  'veo3-1-text-to-video': { tier: 'quality', mode: 'text-to-video' },
  'veo3-1-first-and-last-frames': { tier: 'quality', mode: 'first-and-last-frames' },
};

export function mapZImageTierToModelId(tier: KubeezZImageTier): string {
  return Z_IMAGE_TIER_IDS[tier];
}

export function inferZImageTierFromModelId(modelId: string): KubeezZImageTier {
  return modelId === 'z-image-hd' ? 'hd' : 'standard';
}

export function mapGpt15ImageQualityToModelId(q: KubeezGpt15ImageQuality): string {
  return GPT15_QUALITY_IDS[q];
}

export function inferGpt15ImageQualityFromModelId(modelId: string): KubeezGpt15ImageQuality {
  return modelId === 'gpt-1.5-image-high' ? 'high' : 'medium';
}

export function mapKling25ClipToModelId(clip: KubeezKling25Clip): string {
  return KLING25_CLIP_IDS[clip];
}

export function inferKling25ClipFromModelId(modelId: string): KubeezKling25Clip {
  return modelId.includes('-10s') ? '10s' : '5s';
}

export function mapVeo31ToModelId(s: KubeezVeo31Settings): string {
  let mode = s.mode;
  if ((s.tier === 'quality' || s.tier === 'lite') && mode === 'reference-to-video') {
    mode = 'text-to-video';
  }
  if (s.tier === 'fast') {
    if (mode === 'text-to-video') return 'veo3-1-fast-text-to-video';
    if (mode === 'reference-to-video') return 'veo3-1-fast-reference-to-video';
    return 'veo3-1-fast-first-and-last-frames';
  }
  if (s.tier === 'lite') {
    if (mode === 'text-to-video') return 'veo3-1-lite-text-to-video';
    return 'veo3-1-lite-first-and-last-frames';
  }
  if (mode === 'text-to-video') return 'veo3-1-text-to-video';
  return 'veo3-1-first-and-last-frames';
}

export function parseVeo31Variant(modelId: string): KubeezVeo31Settings | null {
  return VEO31_ID_TO_SETTINGS[modelId] ?? null;
}

export function mapWan25ToModelId(s: KubeezWan25Settings): string {
  if (s.useSimpleCatalogId) return 'wan-2-5';
  const branch = s.source === 'text' ? 'text-to-video' : 'image-to-video';
  return `wan-2-5-${branch}-${s.duration}-${s.resolution}`;
}

export function parseWan25Variant(modelId: string): KubeezWan25Settings | null {
  if (modelId === 'wan-2-5') {
    return { useSimpleCatalogId: true, source: 'text', duration: '5s', resolution: '1080p' };
  }
  const m = modelId.match(/^wan-2-5-(text-to-video|image-to-video)-(5s|10s)-(720p|1080p)$/);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return {
    useSimpleCatalogId: false,
    source: m[1] === 'text-to-video' ? 'text' : 'image',
    duration: m[2] as KubeezWan25Duration,
    resolution: m[3] as KubeezWan25Resolution,
  };
}

export function mapMusicEngineToModelId(engine: KubeezMusicEngine): string {
  return engine;
}

export function inferMusicEngineFromModelId(modelId: string): KubeezMusicEngine {
  if (
    modelId === 'V4' ||
    modelId === 'V4_5' ||
    modelId === 'V4_5PLUS' ||
    modelId === 'V5' ||
    modelId === 'V5_5'
  ) {
    return modelId;
  }
  return 'V5_5';
}

