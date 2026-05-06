import { createLogger } from '@/shared/logging/logger';
import {
  mergeWithCacheAugment,
  readKubeezGroupedModelsCache,
  writeKubeezGroupedModelsCache,
  writeModelEtaCache,
} from './kubeez-models-cache';
import { documentedMaxReferenceFilesForModelId } from './kubeez-documented-reference-limits';
import { applyModelRequirementFallbacks } from './kubeez-model-requirements-fallback';
import { applyVideoCapabilityOverrides } from './kubeez-video-model-capability-overrides';
import { resolveKubeezApiBaseUrl } from './kubeez-text-to-image';

const logger = createLogger('KubeezModels');

export type KubeezMediaModelKind = 'image' | 'video' | 'music' | 'speech';

/**
 * Models returned by Kubeez `GET /v1/models` that KubeezCut does not surface (e.g. KubeezWebsite-only flows).
 * Dropped during normalization and again in `finalizeModels` so cached snapshots cannot resurrect them.
 */
const KUBEEZ_CUT_EXCLUDED_CATALOG_MODEL_IDS = new Set<string>([
  'ad-copy',
  // KubeezWebsite-only Suno tools — no REST endpoint accepts these as `model`,
  // so surfacing them in the generate-media modal leads users to a dead form.
  'suno-add-instrumental',
  'suno-add-vocals',
  'suno-lyrics-generation',
]);

function isExcludedFromKubeezCutCatalog(modelId: string): boolean {
  return KUBEEZ_CUT_EXCLUDED_CATALOG_MODEL_IDS.has(modelId);
}

/** Drop KubeezWebsite-only / unsupported rows so they never appear in pickers or caches. */
export function filterKubeezCutCatalogModels(models: KubeezMediaModelOption[]): KubeezMediaModelOption[] {
  return models.filter((m) => !isExcludedFromKubeezCutCatalog(m.model_id));
}

export interface KubeezMediaModelOption {
  model_id: string;
  display_name: string;
  provider?: string;
  cost_per_generation?: number;
  prompt_max_chars?: number;
  /**
   * Optional hero image for model picker cards when returned by the Kubeez models API
   * (`card_image_url`, `thumbnail_url`, etc.).
   */
  cardImageUrl?: string;
  mediaKind: KubeezMediaModelKind;
  /**
   * When false, aspect ratio is hidden and omitted from the generate request.
   * Video models default to false; image models follow API `capabilities`.
   */
  showAspectRatio?: boolean;
  /** When set, aspect ratio dropdown is limited to these values (e.g. from API). */
  aspectRatioOptions?: string[];
  /** Video duration strings accepted by the API (e.g. "5s", "10s"). */
  durationOptions?: string[];
  /** When true, API supports generated/native audio (may still use separate `-audio` model ids). */
  supports_sound?: boolean;
  /** Model accepts text-to-video without reference uploads. */
  supportsTextToVideo?: boolean;
  /** Model accepts image-to-video (reference media). */
  supportsImageToVideo?: boolean;
  /**
   * Max reference / source media files for this model (from API `capabilities`, e.g. `max_input_images`).
   * When omitted, clients may use a conservative default.
   */
  maxReferenceFiles?: number;
  /** Estimated generation time in seconds (from API `estimated_time_seconds`). */
  estimatedTimeSeconds?: number;
}

/** Shown in Speech tab — uses POST /v1/generate/dialogue (no per-voice model row from API). */
export const KUBEEZ_SPEECH_DIALOGUE_MODEL: KubeezMediaModelOption = {
  model_id: '__kubeez_dialogue__',
  display_name: 'Text to speech (dialogue)',
  provider: 'ElevenLabs',
  mediaKind: 'speech',
  showAspectRatio: false,
};

const FALLBACK_MUSIC_MODELS_RAW: KubeezMediaModelOption[] = [
  { model_id: 'V5_5', display_name: 'V5.5', provider: 'Kubeez', mediaKind: 'music', showAspectRatio: false },
  { model_id: 'V5', display_name: 'V5', provider: 'Kubeez', mediaKind: 'music', showAspectRatio: false },
  { model_id: 'V4_5PLUS', display_name: 'V4.5+', provider: 'Kubeez', mediaKind: 'music', showAspectRatio: false },
  { model_id: 'V4_5', display_name: 'V4.5', provider: 'Kubeez', mediaKind: 'music', showAspectRatio: false },
  { model_id: 'V4', display_name: 'V4', provider: 'Kubeez', mediaKind: 'music', showAspectRatio: false },
];

export const FALLBACK_MUSIC_MODELS: KubeezMediaModelOption[] =
  FALLBACK_MUSIC_MODELS_RAW.map((m) => applyModelRequirementFallbacks(m));

/** @deprecated Use KubeezMediaModelOption */
export type KubeezTextToImageModelOption = KubeezMediaModelOption;

function withImageKind(models: Omit<KubeezMediaModelOption, 'mediaKind'>[]): KubeezMediaModelOption[] {
  return models.map((m) =>
    applyModelRequirementFallbacks({
      ...m,
      mediaKind: 'image' as const,
      showAspectRatio: m.showAspectRatio ?? true,
    })
  );
}

/** Shown if the image models API fails (offline, bad key, etc.) */
export const FALLBACK_TEXT_TO_IMAGE_MODELS: KubeezMediaModelOption[] = withImageKind([
  { model_id: 'nano-banana-2', display_name: 'Nano Banana 2', provider: 'Google' },
  { model_id: 'nano-banana-2-2K', display_name: 'Nano Banana 2 2K', provider: 'Google' },
  { model_id: 'nano-banana-2-4K', display_name: 'Nano Banana 2 4K', provider: 'Google' },
  { model_id: 'nano-banana', display_name: 'Nano Banana', provider: 'Google' },
  { model_id: 'flux-2-1K', display_name: 'Flux 2 1K', provider: 'Black Forest Labs' },
  { model_id: 'flux-2-2K', display_name: 'Flux 2 2K', provider: 'Black Forest Labs' },
  { model_id: 'imagen-4', display_name: 'Imagen 4', provider: 'Google' },
  { model_id: 'imagen-4-fast', display_name: 'Imagen 4 Fast', provider: 'Google' },
  { model_id: 'gpt-1.5-image-medium', display_name: 'GPT 1.5 Image Medium', provider: 'OpenAI' },
  { model_id: 'gpt-1.5-image-high', display_name: 'GPT 1.5 Image High', provider: 'OpenAI' },
  { model_id: 'gpt-image-2', display_name: 'GPT Image 2', provider: 'OpenAI' },
  { model_id: 'p-image-edit', display_name: 'P Image Edit', provider: 'Pruna AI' },
]);

interface ApiCapabilities {
  prompt_max_chars?: number;
  aspect_ratio_options?: unknown;
  duration_options?: unknown;
  supports_aspect_ratio?: boolean;
  supports_sound?: boolean;
  max_input_images?: number;
  max_input_media?: number;
  max_input_videos?: number;
  max_images?: number;
  max_videos?: number;
  max_reference_files?: number;
  [key: string]: unknown;
}

interface ApiModelRow {
  model_id?: string;
  display_name?: string;
  provider?: string;
  cost_per_generation?: number;
  estimated_time_seconds?: number;
  requires_input_media?: boolean;
  generation_types?: string[];
  capabilities?: ApiCapabilities;
  card_image_url?: string;
  thumbnail_url?: string;
  preview_image_url?: string;
  hero_image_url?: string;
}

function parseOptionalCardImageUrl(m: ApiModelRow): string | undefined {
  const directKeys = ['card_image_url', 'thumbnail_url', 'preview_image_url', 'hero_image_url'] as const;
  for (const k of directKeys) {
    const v = m[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  const cap = m.capabilities;
  if (cap && typeof cap === 'object') {
    const c = cap as Record<string, unknown>;
    for (const k of ['card_image_url', 'thumbnail_url', 'preview_image_url', 'hero_image_url'] as const) {
      const v = c[k];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
  }
  return undefined;
}

function parseStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
  return out.length > 0 ? out : undefined;
}

/** Match Kubeez `generation_types` entries (API may use `image-to-image`, `IMAGE_TO_IMAGE`, etc.). */
function generationTypesInclude(types: unknown[], needle: string): boolean {
  const n = needle.toLowerCase().replace(/_/g, '-');
  return types.some((t) => typeof t === 'string' && t.toLowerCase().replace(/_/g, '-') === n);
}

function parseAspectRatioUi(cap: ApiCapabilities | undefined): {
  showAspectRatio: boolean;
  aspectRatioOptions?: string[];
} {
  if (!cap) {
    return { showAspectRatio: true };
  }
  if (cap.supports_aspect_ratio === false) {
    return { showAspectRatio: false };
  }
  const opts = parseStringArray(cap.aspect_ratio_options);
  if (Array.isArray(cap.aspect_ratio_options) && cap.aspect_ratio_options.length === 0) {
    return { showAspectRatio: false };
  }
  if (opts?.length) {
    return { showAspectRatio: true, aspectRatioOptions: opts };
  }
  return { showAspectRatio: true };
}

function parseMaxReferenceFiles(cap: ApiCapabilities | undefined): number | undefined {
  if (!cap) return undefined;
  const maxImgRaw =
    typeof cap.max_input_images === 'number'
      ? cap.max_input_images
      : typeof cap.max_images === 'number'
        ? cap.max_images
        : undefined;
  const maxVidRaw =
    typeof cap.max_input_videos === 'number'
      ? cap.max_input_videos
      : typeof cap.max_videos === 'number'
        ? cap.max_videos
        : undefined;
  if (
    typeof maxImgRaw === 'number' &&
    Number.isFinite(maxImgRaw) &&
    maxImgRaw >= 0 &&
    typeof maxVidRaw === 'number' &&
    Number.isFinite(maxVidRaw) &&
    maxVidRaw >= 0
  ) {
    return Math.min(32, Math.floor(maxImgRaw + maxVidRaw));
  }
  const single = maxImgRaw ?? cap.max_input_media ?? cap.max_reference_files;
  if (typeof single === 'number' && Number.isFinite(single) && single >= 0) {
    return Math.min(32, Math.floor(single));
  }
  return undefined;
}

function normalizeImageModel(m: ApiModelRow): KubeezMediaModelOption | null {
  const id = typeof m.model_id === 'string' ? m.model_id.trim() : '';
  const name = typeof m.display_name === 'string' ? m.display_name.trim() : '';
  if (!id) return null;
  if (isExcludedFromKubeezCutCatalog(id)) return null;
  const cap = m.capabilities;
  const pm =
    cap && typeof cap.prompt_max_chars === 'number' ? cap.prompt_max_chars : undefined;
  const { showAspectRatio, aspectRatioOptions } = parseAspectRatioUi(cap);
  const maxReferenceFiles =
    parseMaxReferenceFiles(cap) ?? documentedMaxReferenceFilesForModelId(id);
  return {
    model_id: id,
    display_name: name || id,
    provider: typeof m.provider === 'string' ? m.provider : undefined,
    cost_per_generation: typeof m.cost_per_generation === 'number' ? m.cost_per_generation : undefined,
    estimatedTimeSeconds: typeof m.estimated_time_seconds === 'number' ? m.estimated_time_seconds : undefined,
    prompt_max_chars: pm,
    mediaKind: 'image',
    showAspectRatio,
    aspectRatioOptions,
    maxReferenceFiles,
    cardImageUrl: parseOptionalCardImageUrl(m),
  };
}

function normalizeVideoModel(m: ApiModelRow, hasT2V: boolean, hasI2V: boolean): KubeezMediaModelOption | null {
  const id = typeof m.model_id === 'string' ? m.model_id.trim() : '';
  const name = typeof m.display_name === 'string' ? m.display_name.trim() : '';
  if (!id) return null;
  if (isExcludedFromKubeezCutCatalog(id)) return null;

  const requiresInput = m.requires_input_media === true;
  const canT2V = hasT2V && !requiresInput;
  const canI2V = hasI2V;

  const cap = m.capabilities;
  const pm =
    cap && typeof cap.prompt_max_chars === 'number' ? cap.prompt_max_chars : undefined;
  const durationOptions = parseStringArray(cap?.duration_options);
  const supports_sound = cap?.supports_sound === true ? true : undefined;
  const maxReferenceFiles =
    parseMaxReferenceFiles(cap) ?? documentedMaxReferenceFilesForModelId(id);

  return {
    model_id: id,
    display_name: name || id,
    provider: typeof m.provider === 'string' ? m.provider : undefined,
    cost_per_generation: typeof m.cost_per_generation === 'number' ? m.cost_per_generation : undefined,
    estimatedTimeSeconds: typeof m.estimated_time_seconds === 'number' ? m.estimated_time_seconds : undefined,
    prompt_max_chars: pm,
    mediaKind: 'video',
    showAspectRatio: false,
    durationOptions,
    supports_sound,
    supportsTextToVideo: canT2V,
    supportsImageToVideo: canI2V,
    maxReferenceFiles,
    cardImageUrl: parseOptionalCardImageUrl(m),
  };
}

function sortByDisplayName(models: KubeezMediaModelOption[]): KubeezMediaModelOption[] {
  return [...models].sort((a, b) =>
    a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' })
  );
}

function finalizeModels(models: KubeezMediaModelOption[]): KubeezMediaModelOption[] {
  return filterKubeezCutCatalogModels(models).map((m) =>
    applyModelRequirementFallbacks(applyVideoCapabilityOverrides(m))
  );
}

/** Ensure every music engine id the UI can pick exists in the catalog (live API lists may omit some). */
function mergeMusicCatalogWithEngineStubs(models: KubeezMediaModelOption[]): KubeezMediaModelOption[] {
  const have = new Set(models.map((m) => m.model_id));
  const merged = [...models];
  for (const stub of FALLBACK_MUSIC_MODELS) {
    if (!have.has(stub.model_id)) {
      merged.push(stub);
      have.add(stub.model_id);
    }
  }
  return sortByDisplayName(merged);
}

/**
 * Image models the public catalog should always offer; `GET /v1/models` may omit rows (same idea as music stubs).
 */
function mergeImageCatalogWithStubs(models: KubeezMediaModelOption[]): KubeezMediaModelOption[] {
  if (models.some((m) => m.model_id === 'p-image-edit')) return models;
  const [stub] = finalizeModels(
    withImageKind([{ model_id: 'p-image-edit', display_name: 'P Image Edit', provider: 'Pruna AI' }])
  );
  return stub ? sortByDisplayName([...models, stub]) : models;
}

/**
 * Image rows from `GET /v1/models?model_type=image`.
 *
 * - `generate-catalog`: include text-to-image and image-to-image models (edit / I2I-only rows like
 *   `p-image-edit` often omit `text-to-image` or set `requires_input_media`). Mirrors video parsing:
 *   keep a model if it supports image-to-image, or text-to-image without mandatory reference uploads.
 * - `text-to-image-only`: legacy filter for callers that only want pure T2I rows.
 */
function parseImageModelsFromResponse(
  body: unknown,
  mode: 'generate-catalog' | 'text-to-image-only'
): KubeezMediaModelOption[] {
  const rawModels =
    body && typeof body === 'object' && 'models' in body && Array.isArray((body as { models: unknown }).models)
      ? ((body as { models: ApiModelRow[] }).models)
      : [];

  const out: KubeezMediaModelOption[] = [];
  for (const row of rawModels) {
    if (!row || typeof row !== 'object') continue;
    const types = row.generation_types;
    if (!Array.isArray(types)) continue;

    if (mode === 'text-to-image-only') {
      if (!generationTypesInclude(types, 'text-to-image')) continue;
      if (row.requires_input_media) continue;
    } else {
      const hasT2I = generationTypesInclude(types, 'text-to-image');
      const hasI2I = generationTypesInclude(types, 'image-to-image');
      if (!hasT2I && !hasI2I) continue;
      const requiresInput = row.requires_input_media === true;
      const usable = hasI2I || (hasT2I && !requiresInput);
      if (!usable) continue;
    }

    const n = normalizeImageModel(row);
    if (n) out.push(n);
  }
  return sortByDisplayName(out);
}

function parseVideoModelsFromResponse(body: unknown): KubeezMediaModelOption[] {
  const rawModels =
    body && typeof body === 'object' && 'models' in body && Array.isArray((body as { models: unknown }).models)
      ? ((body as { models: ApiModelRow[] }).models)
      : [];

  const out: KubeezMediaModelOption[] = [];
  for (const row of rawModels) {
    if (!row || typeof row !== 'object') continue;
    const types = row.generation_types;
    if (!Array.isArray(types)) continue;
    const hasT2V = types.includes('text-to-video');
    const hasI2V = types.includes('image-to-video');
    if (!hasT2V && !hasI2V) continue;

    const requiresInput = row.requires_input_media === true;
    const usable = hasI2V || (hasT2V && !requiresInput);
    if (!usable) continue;

    const n = normalizeVideoModel(row, hasT2V, hasI2V);
    if (n) out.push(n);
  }
  return sortByDisplayName(out);
}

function normalizeMusicModel(m: ApiModelRow): KubeezMediaModelOption | null {
  const id = typeof m.model_id === 'string' ? m.model_id.trim() : '';
  const name = typeof m.display_name === 'string' ? m.display_name.trim() : '';
  if (!id) return null;
  if (isExcludedFromKubeezCutCatalog(id)) return null;
  const cap = m.capabilities;
  const pm =
    cap && typeof cap.prompt_max_chars === 'number' ? cap.prompt_max_chars : undefined;
  const types = m.generation_types;
  if (Array.isArray(types) && types.length > 0) {
    const ok = types.some(
      (t) =>
        typeof t === 'string' &&
        (t === 'text-to-music' ||
          t === 'music' ||
          t === 'generate-music' ||
          t.toLowerCase().includes('music'))
    );
    if (!ok) return null;
  }
  const maxReferenceFiles =
    parseMaxReferenceFiles(cap) ?? documentedMaxReferenceFilesForModelId(id);
  return {
    model_id: id,
    display_name: name || id,
    provider: typeof m.provider === 'string' ? m.provider : undefined,
    cost_per_generation: typeof m.cost_per_generation === 'number' ? m.cost_per_generation : undefined,
    estimatedTimeSeconds: typeof m.estimated_time_seconds === 'number' ? m.estimated_time_seconds : undefined,
    prompt_max_chars: pm,
    mediaKind: 'music',
    showAspectRatio: false,
    maxReferenceFiles,
    cardImageUrl: parseOptionalCardImageUrl(m),
  };
}

function parseMusicModelsFromResponse(body: unknown): KubeezMediaModelOption[] {
  const rawModels =
    body && typeof body === 'object' && 'models' in body && Array.isArray((body as { models: unknown }).models)
      ? ((body as { models: ApiModelRow[] }).models)
      : [];

  const out: KubeezMediaModelOption[] = [];
  for (const row of rawModels) {
    if (!row || typeof row !== 'object') continue;
    const n = normalizeMusicModel(row);
    if (n) out.push(n);
  }
  return sortByDisplayName(out);
}

async function fetchModelsForType(params: {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
  modelType: 'image' | 'video' | 'music';
}): Promise<unknown> {
  const root = resolveKubeezApiBaseUrl(params.baseUrl);
  const url = `${root}/v1/models?model_type=${encodeURIComponent(params.modelType)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.apiKey}` },
    signal: params.signal,
  });

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (import.meta.env.DEV) {
      logger.debug('Kubeez models request failed', { modelType: params.modelType, status: res.status, body });
    }
    throw new Error(`Could not load ${params.modelType} models from Kubeez.`);
  }
  return body;
}

export type KubeezModelVideoSource = 'api' | 'empty' | 'failed' | 'cached';

export type KubeezModelMusicSource = 'api' | 'fallback' | 'failed';

export interface KubeezGroupedMediaModelsResult {
  imageModels: KubeezMediaModelOption[];
  videoModels: KubeezMediaModelOption[];
  musicModels: KubeezMediaModelOption[];
  /** Live list from API (non-empty) */
  imageFromApi: boolean;
  /** How video models were resolved */
  videoSource: KubeezModelVideoSource;
  musicSource: KubeezModelMusicSource;
  /** True when cached catalog rows were merged into the live response */
  catalogAugmentedFromCache: boolean;
}

/**
 * Loads image, video, and music models in parallel.
 * Image failures fall back to built-in list; video failures yield []; music falls back to engine ids (V5…).
 */
export async function fetchKubeezGroupedMediaModels(params: {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<KubeezGroupedMediaModelsResult> {
  const { apiKey, baseUrl, signal } = params;

  const cacheRaw = readKubeezGroupedModelsCache();
  const cache = cacheRaw
    ? {
        ...cacheRaw,
        imageModels: filterKubeezCutCatalogModels(cacheRaw.imageModels),
        videoModels: filterKubeezCutCatalogModels(cacheRaw.videoModels),
        musicModels: filterKubeezCutCatalogModels(cacheRaw.musicModels),
      }
    : null;

  const [imageSettled, videoSettled, musicSettled] = await Promise.allSettled([
    fetchModelsForType({ apiKey, baseUrl, signal, modelType: 'image' }).then((body) =>
      parseImageModelsFromResponse(body, 'generate-catalog')
    ),
    fetchModelsForType({ apiKey, baseUrl, signal, modelType: 'video' }).then((body) =>
      parseVideoModelsFromResponse(body)
    ),
    fetchModelsForType({ apiKey, baseUrl, signal, modelType: 'music' }).then((body) =>
      parseMusicModelsFromResponse(body)
    ),
  ]);

  const hadApiImage = imageSettled.status === 'fulfilled' && imageSettled.value.length > 0;
  const hadApiVideo = videoSettled.status === 'fulfilled' && videoSettled.value.length > 0;
  const hadApiMusic = musicSettled.status === 'fulfilled' && musicSettled.value.length > 0;

  let imageModels: KubeezMediaModelOption[];
  let imageFromApi = false;
  if (hadApiImage) {
    imageModels = imageSettled.value;
    imageFromApi = true;
  } else if (imageSettled.status === 'fulfilled') {
    imageModels = [...FALLBACK_TEXT_TO_IMAGE_MODELS];
    imageFromApi = false;
  } else {
    imageModels = [...FALLBACK_TEXT_TO_IMAGE_MODELS];
    imageFromApi = false;
  }

  let videoModels: KubeezMediaModelOption[];
  if (videoSettled.status === 'fulfilled') {
    videoModels = videoSettled.value;
  } else {
    videoModels = [];
  }

  let musicModels: KubeezMediaModelOption[];
  let musicSource: KubeezModelMusicSource;
  if (hadApiMusic) {
    musicModels = musicSettled.value;
    musicSource = 'api';
  } else if (musicSettled.status === 'fulfilled') {
    musicModels = [...FALLBACK_MUSIC_MODELS];
    musicSource = 'fallback';
  } else {
    musicModels = [...FALLBACK_MUSIC_MODELS];
    musicSource = 'failed';
  }

  let catalogAugmentedFromCache = false;

  const imgMerge = mergeWithCacheAugment(imageModels, cache?.imageModels);
  imageModels = mergeImageCatalogWithStubs(finalizeModels(imgMerge.list));
  catalogAugmentedFromCache ||= imgMerge.addedFromCache;

  const vidMerge = mergeWithCacheAugment(videoModels, cache?.videoModels);
  videoModels = finalizeModels(vidMerge.list);
  catalogAugmentedFromCache ||= vidMerge.addedFromCache;

  const musMerge = mergeWithCacheAugment(musicModels, cache?.musicModels);
  musicModels = mergeMusicCatalogWithEngineStubs(finalizeModels(musMerge.list));
  catalogAugmentedFromCache ||= musMerge.addedFromCache;

  let videoSource: KubeezModelVideoSource;
  if (videoModels.length === 0) {
    videoSource = videoSettled.status === 'rejected' ? 'failed' : 'empty';
  } else if (hadApiVideo) {
    videoSource = 'api';
  } else {
    videoSource = 'cached';
  }

  if (hadApiImage || hadApiVideo || hadApiMusic) {
    writeKubeezGroupedModelsCache({ imageModels, videoModels, musicModels });
    writeModelEtaCache([...imageModels, ...videoModels, ...musicModels]);
  }

  return {
    imageModels,
    videoModels,
    musicModels,
    imageFromApi,
    videoSource,
    musicSource,
    catalogAugmentedFromCache,
  };
}

/**
 * Lists image models from Kubeez that support text-to-image without reference uploads.
 */
export async function fetchKubeezTextToImageModels(params: {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<KubeezMediaModelOption[]> {
  const body = await fetchModelsForType({ ...params, modelType: 'image' });
  return finalizeModels(parseImageModelsFromResponse(body, 'text-to-image-only'));
}
