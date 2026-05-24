import type { KubeezMediaModelOption } from './kubeez-models';
import {
  defaultModelSettings,
  findRegistryEntryByBaseCardId,
  findRegistryEntryForModelId,
  inferGpt15ImageQualityFromModelId,
  inferGrokVideoModeFromModelId,
  inferImageResolutionFromModelId,
  inferImagenTierFromModelId,
  inferKling25ClipFromModelId,
  inferKling26MotionFromModelId,
  inferMusicEngineFromModelId,
  inferZImageTierFromModelId,
  mapGpt15ImageQualityToModelId,
  mapGrokVideoToModelId,
  mapImageResolutionToModelId,
  mapImagenTierToModelId,
  mapKling25ClipToModelId,
  mapKling26MotionToModelId,
  mapKling26ToModelId,
  mapKling30ToModelId,
  mapMusicEngineToModelId,
  mapSeedance2ToModelId,
  mapVeo31ToModelId,
  mapGeminiOmniToModelId,
  mapWan25ToModelId,
  mapZImageTierToModelId,
  parseKling26Variant,
  parseKling30Variant,
  parseSeedance2Variant,
  parseVeo31Variant,
  parseGeminiOmniVariant,
  parseWan25Variant,
  type KubeezModelFamilyRegistryEntry,
  type KubeezModelSettings,
} from './model-family-registry';
import {
  parseSelectionFromVideoVariantId,
  pickDefaultVariant,
  resolveVideoFamilySelection,
} from './kubeez-video-model-variants';

export interface ResolveGenerationParams {
  baseCardId: string;
  settings: KubeezModelSettings;
  /** Variants returned by the API for this logical family (composed video / toggle / parameterized). */
  variants: KubeezMediaModelOption[];
}

/**
 * POST /v1/generate/media accepts `model` as the concrete provider id. Parameterized image families
 * map UI tiers to composite ids (no separate resolution field in this client).
 */
export function resolveGenerationModelId(params: ResolveGenerationParams): string {
  const { baseCardId, settings, variants } = params;
  const entry = findRegistryEntryByBaseCardId(baseCardId);

  if (!entry) {
    const hit = variants.find((v) => v.model_id === baseCardId);
    return hit?.model_id ?? baseCardId;
  }

  if (entry.strategy === 'parameterized') {
    if (entry.baseCardId === 'nano-banana-2') {
      const tier = settings.imageResolution ?? '1k';
      const id = mapImageResolutionToModelId('nano-banana-2', tier);
      return variants.some((v) => v.model_id === id) ? id : pickFallbackVariantId(variants, id);
    }
    if (entry.baseCardId === 'nano-banana-pro') {
      const tier = settings.imageResolution ?? '1k';
      const id = mapImageResolutionToModelId('nano-banana-pro', tier);
      return variants.some((v) => v.model_id === id) ? id : pickFallbackVariantId(variants, id);
    }
  }

  if (entry.strategy === 'toggle' && entry.baseCardId === 'imagen-4') {
    const tier = settings.imagenTier ?? 'standard';
    const id = mapImagenTierToModelId(tier);
    return variants.some((v) => v.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.strategy === 'toggle' && entry.baseCardId === 'z-image') {
    const tier = settings.zImageTier ?? 'standard';
    const id = mapZImageTierToModelId(tier);
    return variants.some((v) => v.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.strategy === 'toggle' && entry.baseCardId === 'gpt-1.5-image') {
    const q = settings.gpt15ImageQuality ?? 'medium';
    const id = mapGpt15ImageQualityToModelId(q);
    return variants.some((v) => v.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.strategy === 'toggle' && entry.baseCardId === 'gpt-image-2') {
    // model_id is fixed; resolution is sent as a body param at request time.
    return 'gpt-image-2';
  }

  if (entry.strategy === 'toggle' && entry.baseCardId === 'kling-2-5-i2v') {
    const clip = settings.kling25Clip ?? '5s';
    const id = mapKling25ClipToModelId(clip);
    return variants.some((v) => v.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.strategy === 'toggle' && entry.baseCardId === 'suno-music') {
    const engine = settings.sunoEngine ?? 'V5_5';
    // Engine ids are fixed in the UI; the models list may omit some rows but the API still accepts them.
    return mapMusicEngineToModelId(engine);
  }

  if (entry.baseCardId === 'veo3-1') {
    const v = settings.veo31 ?? { tier: 'fast' as const, mode: 'text-to-video' as const };
    const id = mapVeo31ToModelId(v);
    return variants.some((x) => x.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.baseCardId === 'gemini-omni-video') {
    const g = settings.geminiOmni ?? {
      resolution: 'hd' as const,
      duration: '6s' as const,
      videoRef: false,
    };
    const id = mapGeminiOmniToModelId(g);
    return variants.some((x) => x.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.baseCardId === 'wan-2-5') {
    const w =
      settings.wan25 ?? {
        useSimpleCatalogId: true,
        source: 'text' as const,
        duration: '5s' as const,
        resolution: '1080p' as const,
      };
    const id = mapWan25ToModelId(w);
    return variants.some((x) => x.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.baseCardId === 'grok-video') {
    const mode = settings.grokVideoMode ?? 'text-to-video';
    const id = mapGrokVideoToModelId(mode);
    return variants.some((v) => v.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.baseCardId === 'kling-2-6') {
    const k = settings.kling26 ?? {
      mode: 'text-to-video' as const,
      duration: '5s' as const,
      withAudio: false,
    };
    const id = mapKling26ToModelId(k);
    return variants.some((v) => v.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.baseCardId === 'kling-2-6-motion') {
    const res = settings.kling26MotionResolution ?? '720p';
    const id = mapKling26MotionToModelId(res);
    return variants.some((v) => v.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.baseCardId === 'kling-3-0') {
    const k = settings.kling30 ?? { line: 'std' as const, motionResolution: '720p' as const };
    const id = mapKling30ToModelId(k);
    return variants.some((v) => v.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.baseCardId === 'seedance-2-fast') {
    const s = settings.seedance2 ?? {
      tier: 'fast' as const,
      resolution: '720p' as const,
      videoRef: false,
      withAudio: true,
    };
    const id = mapSeedance2ToModelId(s);
    return variants.some((v) => v.model_id === id) ? id : pickFallbackVariantId(variants, id);
  }

  if (entry.strategy === 'composed' && settings.videoAxes) {
    const v = resolveVideoFamilySelection(variants, {
      resolution: settings.videoAxes.resolution,
      duration: settings.videoAxes.duration,
      withAudio: settings.videoAxes.withAudio,
    });
    return v.model_id;
  }

  return pickDefaultVariant(variants).model_id;
}

function pickFallbackVariantId(variants: KubeezMediaModelOption[], preferred: string): string {
  if (variants.some((v) => v.model_id === preferred)) return preferred;
  return pickDefaultVariant(variants).model_id;
}

/** Pick a variant row suitable for showing ~credits when the card uses a virtual base id. */
export function resolvePriceModelId(params: ResolveGenerationParams): string {
  return resolveGenerationModelId(params);
}

export interface SelectionFromConcreteResult {
  baseCardId: string;
  settings: KubeezModelSettings;
  resolvedModelId: string;
  registryEntry: KubeezModelFamilyRegistryEntry | null;
}

export function collectVariantsForEntry(
  entry: KubeezModelFamilyRegistryEntry,
  imageModels: KubeezMediaModelOption[],
  videoModels: KubeezMediaModelOption[],
  musicModels: KubeezMediaModelOption[] = []
): KubeezMediaModelOption[] {
  const list =
    entry.mediaKind === 'image'
      ? imageModels
      : entry.mediaKind === 'video'
        ? videoModels
        : musicModels;
  return list.filter((m) => entry.matchModelId(m.model_id));
}

/** Variants in the loaded catalog for a base card id (registry or single flat model). */
export function getVariantsForBaseCardId(
  baseCardId: string,
  imageModels: KubeezMediaModelOption[],
  videoModels: KubeezMediaModelOption[],
  musicModels: KubeezMediaModelOption[] = []
): KubeezMediaModelOption[] {
  const entry = findRegistryEntryByBaseCardId(baseCardId);
  if (entry) {
    return collectVariantsForEntry(entry, imageModels, videoModels, musicModels);
  }
  const flat = [...imageModels, ...videoModels, ...musicModels];
  const hit = flat.find((m) => m.model_id === baseCardId);
  return hit ? [hit] : [];
}

export function resolveSelectionFromConcreteModelId(
  concreteModelId: string,
  imageModels: KubeezMediaModelOption[],
  videoModels: KubeezMediaModelOption[],
  musicModels: KubeezMediaModelOption[]
): SelectionFromConcreteResult {
  const entry = findRegistryEntryForModelId(concreteModelId);
  if (!entry) {
    return {
      baseCardId: concreteModelId,
      settings: {},
      resolvedModelId: concreteModelId,
      registryEntry: null,
    };
  }

  const variants = collectVariantsForEntry(entry, imageModels, videoModels, musicModels);
  if (variants.length === 0) {
    return {
      baseCardId: entry.baseCardId,
      settings: defaultModelSettings(entry),
      resolvedModelId: concreteModelId,
      registryEntry: entry,
    };
  }

  let settings = defaultModelSettings(entry);

  if (entry.strategy === 'parameterized' && entry.baseCardId === 'nano-banana-2') {
    settings = { imageResolution: inferImageResolutionFromModelId(concreteModelId, 'nano-banana-2') };
  } else if (entry.strategy === 'parameterized' && entry.baseCardId === 'nano-banana-pro') {
    settings = { imageResolution: inferImageResolutionFromModelId(concreteModelId, 'nano-banana-pro') };
  } else if (entry.strategy === 'toggle' && entry.baseCardId === 'imagen-4') {
    settings = { imagenTier: inferImagenTierFromModelId(concreteModelId) };
  } else if (entry.strategy === 'toggle' && entry.baseCardId === 'z-image') {
    settings = { zImageTier: inferZImageTierFromModelId(concreteModelId) };
  } else if (entry.strategy === 'toggle' && entry.baseCardId === 'gpt-1.5-image') {
    settings = { gpt15ImageQuality: inferGpt15ImageQualityFromModelId(concreteModelId) };
  } else if (entry.strategy === 'toggle' && entry.baseCardId === 'kling-2-5-i2v') {
    settings = { kling25Clip: inferKling25ClipFromModelId(concreteModelId) };
  } else if (entry.strategy === 'toggle' && entry.baseCardId === 'suno-music') {
    settings = { sunoEngine: inferMusicEngineFromModelId(concreteModelId) };
  } else if (entry.baseCardId === 'veo3-1') {
    const parsed =
      parseVeo31Variant(concreteModelId) ?? parseVeo31Variant(pickDefaultVariant(variants).model_id);
    if (parsed) settings = { veo31: parsed };
  } else if (entry.baseCardId === 'gemini-omni-video') {
    const parsed =
      parseGeminiOmniVariant(concreteModelId) ??
      parseGeminiOmniVariant(pickDefaultVariant(variants).model_id);
    if (parsed) settings = { geminiOmni: parsed };
  } else if (entry.baseCardId === 'wan-2-5') {
    const parsed =
      parseWan25Variant(concreteModelId) ?? parseWan25Variant(pickDefaultVariant(variants).model_id);
    if (parsed) settings = { wan25: parsed };
  } else if (entry.baseCardId === 'kling-2-6') {
    const parsed =
      parseKling26Variant(concreteModelId) ?? parseKling26Variant(pickDefaultVariant(variants).model_id);
    if (parsed) {
      settings = { kling26: parsed };
    }
  } else if (entry.baseCardId === 'grok-video') {
    settings = { grokVideoMode: inferGrokVideoModeFromModelId(concreteModelId) };
  } else if (entry.baseCardId === 'kling-2-6-motion') {
    settings = { kling26MotionResolution: inferKling26MotionFromModelId(concreteModelId) };
  } else if (entry.baseCardId === 'kling-3-0') {
    const parsed =
      parseKling30Variant(concreteModelId) ?? parseKling30Variant(pickDefaultVariant(variants).model_id);
    if (parsed) settings = { kling30: parsed };
  } else if (entry.baseCardId === 'seedance-2-fast') {
    const parsed =
      parseSeedance2Variant(concreteModelId) ?? parseSeedance2Variant(pickDefaultVariant(variants).model_id);
    if (parsed) settings = { seedance2: parsed };
  } else if (entry.strategy === 'composed') {
    const parsed =
      parseSelectionFromVideoVariantId(concreteModelId) ??
      parseSelectionFromVideoVariantId(pickDefaultVariant(variants).model_id);
    if (parsed) {
      settings = {
        videoAxes: {
          resolution: parsed.resolution,
          duration: parsed.duration,
          withAudio: parsed.withAudio,
        },
      };
    }
  }

  const resolvedModelId = resolveGenerationModelId({
    baseCardId: entry.baseCardId,
    settings,
    variants,
  });

  return {
    baseCardId: entry.baseCardId,
    settings,
    resolvedModelId,
    registryEntry: entry,
  };
}
