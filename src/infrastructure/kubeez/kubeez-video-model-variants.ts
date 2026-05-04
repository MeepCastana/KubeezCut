import { filterKubeezCutCatalogModels, type KubeezMediaModelOption } from './kubeez-models';
import { findRegistryEntryByBaseCardId, KUBEEZ_MODEL_FAMILY_REGISTRY } from './model-family-registry';

/**
 * Matches trailing `-720p-8s`, `-1080p-12s-audio`, `-5s-audio`, etc.
 * Base id uses `.+?` (non-greedy) so ids like `seedance-1-5-pro-720p-8s` parse as
 * base `seedance-1-5-pro` + res `720p` + dur `8s`. A greedy `.+` would swallow `720p`
 * and leave resolution empty (breaking the Quality row).
 */
const VIDEO_VARIANT_SUFFIX_RE = /^(.+?)-(?:(\d+p)-)?(\d+)s(-audio)?$/;

/**
 * Extended duration-encoded ids whose tail is `-Ns-<res|tier>` rather than `-Ns` / `-res-Ns`:
 *
 *  - Wan 2.5: `wan-2-5-{text,image}-to-video-{5s,10s}-{720p,1080p}`
 *  - Sora 2 Pro: `sora-2-pro-{text,image}-to-video-{10s,15s}-{hd,standard}`
 *
 * Only used by `videoModelIdEncodesVariantParams` to keep the POST body from appending a
 * conflicting `duration` field. The grid-merge parser (above) stays strict.
 */
const VIDEO_VARIANT_TAIL_RES_OR_TIER_RE = /^(.+?)-(\d+)s-(\d+p|hd|standard)(-audio)?$/;

export type ParsedVideoVariantSuffix = {
  baseId: string;
  resolution: string | null;
  durationLabel: string;
  withAudio: boolean;
};

export function parseVideoModelVariantSuffix(modelId: string): ParsedVideoVariantSuffix | null {
  const m = modelId.match(VIDEO_VARIANT_SUFFIX_RE);
  if (!m || !m[1] || m[3] === undefined) return null;
  return {
    baseId: m[1],
    resolution: m[2] ?? null,
    durationLabel: `${m[3]}s`,
    withAudio: Boolean(m[4]),
  };
}

export function videoModelIdEncodesVariantParams(modelId: string): boolean {
  if (parseVideoModelVariantSuffix(modelId) !== null) return true;
  return VIDEO_VARIANT_TAIL_RES_OR_TIER_RE.test(modelId);
}

export type KubeezModelFamilyGridItem = {
  kind: 'model-family';
  mediaKind: 'image' | 'video' | 'music';
  familyKey: string;
  /** Registry logical id when this row comes from `KUBEEZ_MODEL_FAMILY_REGISTRY`; heuristic merges omit it. */
  baseCardId?: string;
  displayName: string;
  provider?: string;
  variants: KubeezMediaModelOption[];
};

export type KubeezModelGridItem =
  | { kind: 'model'; m: KubeezMediaModelOption }
  | KubeezModelFamilyGridItem;

function resolutionSortKey(res: string): number {
  const n = Number.parseInt(res.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function durationSortKey(label: string): number {
  const n = Number.parseInt(label.replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export function pickDefaultVariant(variants: KubeezMediaModelOption[]): KubeezMediaModelOption {
  if (variants.length === 0) {
    throw new Error('pickDefaultVariant: empty variants');
  }
  const sorted = [...variants].sort(
    (a, b) => (a.cost_per_generation ?? Infinity) - (b.cost_per_generation ?? Infinity)
  );
  return sorted[0]!;
}

export function collectVideoFamilyAxes(variants: KubeezMediaModelOption[]): {
  resolutions: string[];
  durations: string[];
  audioOptions: { off: boolean; on: boolean };
} {
  const resSet = new Set<string>();
  const durSet = new Set<string>();
  let anyNoAudio = false;
  let anyAudio = false;
  for (const v of variants) {
    const p = parseVideoModelVariantSuffix(v.model_id);
    if (!p) continue;
    if (p.resolution) resSet.add(p.resolution);
    durSet.add(p.durationLabel);
    if (p.withAudio) anyAudio = true;
    else anyNoAudio = true;
  }
  const resolutions = [...resSet].sort((a, b) => resolutionSortKey(a) - resolutionSortKey(b));
  const durations = [...durSet].sort((a, b) => durationSortKey(a) - durationSortKey(b));
  return {
    resolutions,
    durations,
    audioOptions: { off: anyNoAudio, on: anyAudio },
  };
}

export function findVideoFamilyVariant(
  variants: KubeezMediaModelOption[],
  choice: { resolution: string | null; duration: string; withAudio: boolean }
): KubeezMediaModelOption | null {
  for (const v of variants) {
    const p = parseVideoModelVariantSuffix(v.model_id);
    if (!p) continue;
    const resMatch = (p.resolution ?? null) === (choice.resolution ?? null);
    const durMatch = p.durationLabel === choice.duration;
    const audioMatch = p.withAudio === choice.withAudio;
    if (resMatch && durMatch && audioMatch) return v;
  }
  return null;
}

/** When the current axes are invalid, fall back to the nearest matching combo, then cheapest. */
export function resolveVideoFamilySelection(
  variants: KubeezMediaModelOption[],
  choice: { resolution: string | null; duration: string; withAudio: boolean }
): KubeezMediaModelOption {
  const direct = findVideoFamilyVariant(variants, choice);
  if (direct) return direct;

  const axes = collectVideoFamilyAxes(variants);
  const tryAudio = [choice.withAudio, !choice.withAudio];

  for (const withAudio of tryAudio) {
    const durCandidates = [choice.duration, ...axes.durations];
    for (const duration of durCandidates) {
      const resCandidates: (string | null)[] =
        axes.resolutions.length > 0 ? [choice.resolution, ...axes.resolutions] : [null];
      const seen = new Set<string>();
      for (const resolution of resCandidates) {
        const k = resolution ?? '__null__';
        if (seen.has(k)) continue;
        seen.add(k);
        const v = findVideoFamilyVariant(variants, { resolution, duration, withAudio });
        if (v) return v;
      }
    }
  }

  return pickDefaultVariant(variants);
}

export function parseSelectionFromVideoVariantId(modelId: string): {
  resolution: string | null;
  duration: string;
  withAudio: boolean;
} | null {
  const p = parseVideoModelVariantSuffix(modelId);
  if (!p) return null;
  return {
    resolution: p.resolution,
    duration: p.durationLabel,
    withAudio: p.withAudio,
  };
}

/** Groups image rows whose display names only differ by trailing 1K / 2K / 4K (Kubeez catalog pattern). */
export function stripTrailingImageResolutionLabel(displayName: string): string {
  return displayName.replace(/\s+(?:[124]\s*)K(?=\s*$)/i, '').trim();
}

function imageModelFamilyMergeKey(m: KubeezMediaModelOption): string {
  const p = (m.provider ?? '').trim().toLowerCase();
  const base = stripTrailingImageResolutionLabel(m.display_name).toLowerCase();
  return `${p}\0${base}`;
}

/**
 * Maps `model_id` to a stable family slug for image rows that are not covered by
 * `KUBEEZ_MODEL_FAMILY_REGISTRY` (those are partitioned out before this runs).
 * Mirrors Kubeez web / videoaichat: one card per logical product; variants are chosen in the panel.
 */
function computeImageHeuristicFamilySlug(modelId: string): string | null {
  const id = modelId.trim().toLowerCase();

  if (id.startsWith('flux-2')) return 'base:flux-2';

  if (id.startsWith('seedream-v4-5')) return 'base:seedream-v4-5';
  if (id.startsWith('seedream-v4')) return 'base:seedream-v4';
  /** ByteDance uses both `5-lite-*` and `seedream-v5-*` ids for the same product — one card (see kubeez.com). */
  if (id.startsWith('5-lite-') || id.startsWith('seedream-v5') || id.includes('seedream-v5')) {
    return 'base:seedream-5-lite';
  }

  if (id.startsWith('grok-text-to-image') || id.startsWith('grok-image-to-image')) return 'base:grok-image';
  if (id.startsWith('qwen-')) return 'base:qwen-image';

  if (id.startsWith('nano-banana')) {
    if (id.startsWith('nano-banana-2') || id.startsWith('nano-banana-pro')) return null;
    return 'base:nano-banana-legacy';
  }

  if (id.startsWith('p-image')) return 'base:p-image';
  if (id.includes('logo-maker') || id.startsWith('logo-maker')) return 'base:logo-maker';

  return null;
}

const IMAGE_HEURISTIC_FAMILY_LABEL: Record<string, string> = {
  'base:flux-2': 'Flux 2',
  'base:seedream-v4': 'Seedream V4',
  'base:seedream-v4-5': 'Seedream V4.5',
  'base:seedream-5-lite': 'Seedream 5 Lite',
  'base:grok-image': 'Grok Image',
  'base:qwen-image': 'Qwen Image',
  'base:nano-banana-legacy': 'Nano Banana',
  'base:p-image': 'P-Image Edit',
  'base:logo-maker': 'Logo Maker',
};

function imageFamilyGroupKey(m: KubeezMediaModelOption): string {
  const p = (m.provider ?? '').trim().toLowerCase();
  const slug = computeImageHeuristicFamilySlug(m.model_id);
  if (slug) return `${p}\0${slug}`;
  return imageModelFamilyMergeKey(m);
}

function deriveImageFamilyCardTitle(groupKey: string, variants: KubeezMediaModelOption[]): string {
  const slug = groupKey.includes('\0') ? groupKey.split('\0')[1]! : '';
  if (slug && IMAGE_HEURISTIC_FAMILY_LABEL[slug]) {
    return IMAGE_HEURISTIC_FAMILY_LABEL[slug]!;
  }
  if (variants.length === 1) return variants[0]!.display_name;
  const sorted = [...variants].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const firstParts = sorted.map((v) => (v.display_name.split(/\s*·\s*/)[0] ?? v.display_name).trim());
  const unique = [...new Set(firstParts)];
  if (unique.length === 1) return unique[0]!;
  const head = sorted[0]!;
  return stripTrailingImageResolutionLabel(head.display_name) || head.display_name;
}

function videoModelDisplayMergeKey(m: KubeezMediaModelOption): string {
  const p = (m.provider ?? '').trim().toLowerCase();
  const n = m.display_name.trim().toLowerCase();
  return `${p}\0${n}`;
}

function dedupeModelsById(models: KubeezMediaModelOption[]): KubeezMediaModelOption[] {
  const seen = new Set<string>();
  const out: KubeezMediaModelOption[] = [];
  for (const m of models) {
    if (seen.has(m.model_id)) continue;
    seen.add(m.model_id);
    out.push(m);
  }
  return out;
}

type RegistryFamilyBucket = {
  baseCardId: string;
  displayName: string;
  mediaKind: 'image' | 'video' | 'music';
  variants: KubeezMediaModelOption[];
};

/** Assign models to curated registry families first; leftover rows are for heuristic grouping. */
function partitionRegistryFamiliesFromList(list: KubeezMediaModelOption[]): {
  families: RegistryFamilyBucket[];
  remainder: KubeezMediaModelOption[];
} {
  const used = new Set<string>();
  const families: RegistryFamilyBucket[] = [];
  for (const entry of KUBEEZ_MODEL_FAMILY_REGISTRY) {
    const variants = list.filter((m) => m.mediaKind === entry.mediaKind && entry.matchModelId(m.model_id));
    if (variants.length === 0) continue;
    for (const v of variants) used.add(v.model_id);
    families.push({
      baseCardId: entry.baseCardId,
      displayName: entry.displayName,
      mediaKind: entry.mediaKind,
      variants,
    });
  }
  const remainder = list.filter((m) => !used.has(m.model_id));
  return { families, remainder };
}

function buildImageFamilyGridItems(images: KubeezMediaModelOption[]): KubeezModelGridItem[] {
  const groups = new Map<string, KubeezMediaModelOption[]>();
  for (const m of images) {
    const k = imageFamilyGroupKey(m);
    const arr = groups.get(k) ?? [];
    arr.push(m);
    groups.set(k, arr);
  }

  const out: KubeezModelGridItem[] = [];
  for (const [groupKey, variants] of groups) {
    const deduped = dedupeModelsById(variants);
    deduped.sort((a, b) => a.model_id.localeCompare(b.model_id));
    if (deduped.length === 1) {
      out.push({ kind: 'model', m: deduped[0]! });
      continue;
    }
    const head = deduped[0]!;
    out.push({
      kind: 'model-family',
      mediaKind: 'image',
      familyKey: `img:${groupKey}`,
      displayName: deriveImageFamilyCardTitle(groupKey, deduped),
      provider: head.provider,
      variants: deduped,
    });
  }
  return out;
}

function buildMergedVideoGridItems(videos: KubeezMediaModelOption[]): KubeezModelGridItem[] {
  const singles: KubeezMediaModelOption[] = [];
  const byBase = new Map<string, KubeezMediaModelOption[]>();
  for (const m of videos) {
    const p = parseVideoModelVariantSuffix(m.model_id);
    if (!p) {
      singles.push(m);
      continue;
    }
    const arr = byBase.get(p.baseId) ?? [];
    arr.push(m);
    byBase.set(p.baseId, arr);
  }

  type RawGroup = { variants: KubeezMediaModelOption[] };
  const raw: RawGroup[] = [];
  for (const m of singles) {
    raw.push({ variants: [m] });
  }
  for (const variants of byBase.values()) {
    raw.push({ variants });
  }

  const mergeMap = new Map<string, KubeezMediaModelOption[]>();
  for (const { variants } of raw) {
    for (const m of variants) {
      const k = videoModelDisplayMergeKey(m);
      const arr = mergeMap.get(k) ?? [];
      arr.push(m);
      mergeMap.set(k, arr);
    }
  }

  const out: KubeezModelGridItem[] = [];
  for (const merged of mergeMap.values()) {
    const deduped = dedupeModelsById(merged);
    if (deduped.length === 1) {
      out.push({ kind: 'model', m: deduped[0]! });
      continue;
    }
    deduped.sort((a, b) => a.model_id.localeCompare(b.model_id));
    const head = deduped[0]!;
    out.push({
      kind: 'model-family',
      mediaKind: 'video',
      familyKey: `vid:${videoModelDisplayMergeKey(head)}`,
      displayName: head.display_name,
      provider: head.provider,
      variants: deduped,
    });
  }
  return out;
}

function registryFamiliesToGridItems(families: RegistryFamilyBucket[]): KubeezModelGridItem[] {
  const out: KubeezModelGridItem[] = [];
  for (const f of families) {
    const deduped = dedupeModelsById(f.variants).sort((a, b) => a.model_id.localeCompare(b.model_id));
    if (deduped.length === 0) continue;
    // Keep single-variant families as `model-family` so the dialog still receives the
    // baseCardId and can render dedicated UI (e.g. gpt-image-2's 1K/2K/4K toggle —
    // the model_id is the same for all resolutions, so the family always has 1 variant).
    out.push({
      kind: 'model-family',
      mediaKind: f.mediaKind,
      familyKey: `reg:${f.baseCardId}`,
      baseCardId: f.baseCardId,
      displayName: f.displayName,
      provider: deduped[0]?.provider,
      variants: deduped,
    });
  }
  return out;
}

export function buildKubeezModelGridItems(list: KubeezMediaModelOption[]): KubeezModelGridItem[] {
  const listFiltered = filterKubeezCutCatalogModels(list);
  const images = listFiltered.filter((m) => m.mediaKind === 'image');
  const videos = listFiltered.filter((m) => m.mediaKind === 'video');
  const music = listFiltered.filter((m) => m.mediaKind === 'music');
  const speech = listFiltered.filter((m) => m.mediaKind === 'speech');

  const regImg = partitionRegistryFamiliesFromList(images);
  const regVid = partitionRegistryFamiliesFromList(videos);
  const regMusic = partitionRegistryFamiliesFromList(music);
  const registryItems = registryFamiliesToGridItems([
    ...regImg.families,
    ...regVid.families,
    ...regMusic.families,
  ]);

  const imageItems = buildImageFamilyGridItems(regImg.remainder);
  const videoItems = buildMergedVideoGridItems(regVid.remainder);
  const musicItems = regMusic.remainder.map((m) => ({ kind: 'model' as const, m }));
  const speechItems = speech.map((m) => ({ kind: 'model' as const, m }));

  const out: KubeezModelGridItem[] = [
    ...registryItems,
    ...imageItems,
    ...musicItems,
    ...speechItems,
    ...videoItems,
  ];
  out.sort((a, b) => {
    const nameA = a.kind === 'model' ? a.m.display_name : a.displayName;
    const nameB = b.kind === 'model' ? b.m.display_name : b.displayName;
    const c = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    if (c !== 0) return c;
    const idA = a.kind === 'model' ? a.m.model_id : a.familyKey;
    const idB = b.kind === 'model' ? b.m.model_id : b.familyKey;
    return idA.localeCompare(idB);
  });

  return out;
}

export function kubeezModelGridItemContainsModelId(item: KubeezModelGridItem, modelId: string): boolean {
  if (item.kind === 'model') return item.m.model_id === modelId;
  if (item.baseCardId) {
    if (modelId === item.baseCardId) return true;
    const reg = findRegistryEntryByBaseCardId(item.baseCardId);
    if (reg?.matchModelId(modelId)) return true;
  }
  if (item.variants.some((v) => v.model_id === modelId)) return true;
  const sel = parseVideoModelVariantSuffix(modelId);
  if (sel && item.variants.some((v) => parseVideoModelVariantSuffix(v.model_id)?.baseId === sel.baseId)) {
    return true;
  }
  return false;
}

/** When `modelId` belongs to a grouped model family in this list, returns that grid item. */
export function findModelFamilyGridItemForModelId(
  modelsOfKind: KubeezMediaModelOption[],
  modelId: string
): KubeezModelFamilyGridItem | null {
  const items = buildKubeezModelGridItems(modelsOfKind);
  for (const item of items) {
    if (item.kind === 'model-family' && kubeezModelGridItemContainsModelId(item, modelId)) {
      return item;
    }
  }
  return null;
}
