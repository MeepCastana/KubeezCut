/**
 * Per-model max reference uploads for `source_media_urls`, aligned with KubeezWebsite
 * `fileRestrictions.ts` (`getFileLimitForModel`).
 *
 * When the website returns no finite cap (`Infinity`), fall back to Kubeez REST docs rows
 * (same table as historical `kubeez-documented-reference-limits.ts`) for image-only / motion ids
 * not covered by `fileRestrictions.ts`.
 *
 * Merge order with `applyModelRequirementFallbacks` (see `kubeez-model-requirements-fallback.ts`):
 * finite web limit → REST docs exact/prefix → API `maxReferenceFiles` → optional explicit fallback row.
 */

import type { KubeezModelSettings } from './model-family-registry';
import {
  inferGenerationTypeForKubeezCut,
  inferGenerationTypeFromConcreteModelId,
  inferKubeezCutFileLimitOptions,
} from './kubeez-generate-generation-context';
import { getFileLimitForModel } from './kubeez-web-file-restrictions';

function finiteMaxFiles(maxFiles: number): number | undefined {
  if (!Number.isFinite(maxFiles) || maxFiles === Infinity) return undefined;
  return maxFiles;
}

/**
 * Text-to-image-only image models whose base id is NOT an edit variant.
 * Live API `max_input_images=0` for these, but the synced web file-restrictions returns a
 * positive cap (because KubeezWebsite internally routes base-id + refs through edit variants).
 * KubeezCut's generate dialog shows the base model directly, so we force 0 to match the API.
 */
const IMAGE_TEXT_TO_IMAGE_ONLY_ZERO_REF: ReadonlySet<string> = new Set([
  'nano-banana',
  'flux-2-1K',
  'flux-2-2K',
  'grok-text-to-image',
  'qwen-text-to-image',
  'imagen-4',
  'imagen-4-fast',
  'imagen-4-ultra',
  'logo-maker',
  'z-image',
  'z-image-hd',
]);

/** Kubeez REST docs (https://kubeez.com/docs/rest-api-model-requirements) — used when web returns Infinity. */
const LEGACY_REST_EXACT: Record<string, number> = {
  '5-lite-image-to-image': 10,
  '5-lite-text-to-image': 10,
  'flux-2-edit-1K': 8,
  'flux-2-edit-2K': 8,
  'gpt-1.5-image-high': 16,
  'gpt-1.5-image-medium': 16,
  'gpt-image-2': 16,
  'grok-text-to-image': 1,
  'imagen-4': 0,
  'imagen-4-fast': 0,
  'imagen-4-ultra': 0,
  'nano-banana': 10,
  'nano-banana-2': 8,
  'nano-banana-2-2K': 8,
  'nano-banana-2-4K': 8,
  'nano-banana-edit': 10,
  'nano-banana-pro': 8,
  'nano-banana-pro-2K': 8,
  'nano-banana-pro-4K': 8,
  'p-image-edit': 8,
  /** P-Video — API `max_input_images=2` (1 image + 1 audio per live capabilities block). */
  'p-video': 2,
  'seedream-v4': 10,
  'seedream-v4-edit': 10,
  'seedream-v4-5': 10,
  'seedream-v4-5-edit': 10,
  'z-image': 0,
  'z-image-hd': 0,
  'grok-image-to-video': 1,
  'grok-text-to-video-6s': 0,
  'kling-2-5-image-to-video-pro': 2,
  'kling-2-5-image-to-video-pro-10s': 2,
  'kling-2-6-motion-control-720p': 2,
  'kling-2-6-motion-control-1080p': 2,
  'kling-3-0-motion-control-720p': 2,
  'kling-3-0-motion-control-1080p': 2,
};

/** Longest prefixes first. Only consulted after web + exact legacy. */
const LEGACY_REST_PREFIX_RULES: { prefix: string; maxFiles: number }[] = [
  { prefix: 'seedance-1-5-pro-', maxFiles: 2 },
  /** Seedance 2 family — API `max_input_images=9`. */
  { prefix: 'seedance-2-', maxFiles: 9 },
  { prefix: 'kling-2-6-image-to-video-', maxFiles: 1 },
  { prefix: 'kling-2-6-text-to-video-', maxFiles: 0 },
  { prefix: 'v1-pro-fast-i2v-', maxFiles: 1 },
  { prefix: 'wan-2-5-image-to-video-', maxFiles: 1 },
  { prefix: 'wan-2-5-text-to-video-', maxFiles: 0 },
  { prefix: 'wan-2-5', maxFiles: 0 },
];

/**
 * Catalog-only inference from `model_id` (no UI settings). Used when merging `GET /v1/models` rows.
 */
export function documentedMaxReferenceFilesForModelId(modelId: string): number | undefined {
  if (!modelId) return undefined;
  if (IMAGE_TEXT_TO_IMAGE_ONLY_ZERO_REF.has(modelId)) return 0;
  const gt = inferGenerationTypeFromConcreteModelId(modelId);
  const { maxFiles } = getFileLimitForModel(modelId, gt, { multiShot: false });
  const web = finiteMaxFiles(maxFiles);
  if (web !== undefined) return web;
  if (modelId in LEGACY_REST_EXACT) return LEGACY_REST_EXACT[modelId];
  for (const { prefix, maxFiles: n } of LEGACY_REST_PREFIX_RULES) {
    if (modelId.startsWith(prefix)) return n;
  }
  return undefined;
}

/**
 * Generate dialog: uses UI `settings` so Veo / Kling / Wan / Grok modes match KubeezWebsite.
 */
export function effectiveMaxReferenceFilesForGenerateDialog(
  model: { model_id: string; maxReferenceFiles?: number } | null | undefined,
  ctx: { resolvedModelId: string; baseCardId: string; settings: KubeezModelSettings }
): number | undefined {
  if (!model) return undefined;
  if (IMAGE_TEXT_TO_IMAGE_ONLY_ZERO_REF.has(ctx.resolvedModelId)) return 0;
  const gen = inferGenerationTypeForKubeezCut({
    baseCardId: ctx.baseCardId,
    settings: ctx.settings,
  });
  const opts = { multiShot: false as const, ...inferKubeezCutFileLimitOptions(ctx.settings) };
  const { maxFiles } = getFileLimitForModel(ctx.resolvedModelId, gen, opts);
  const doc = finiteMaxFiles(maxFiles);
  if (doc !== undefined) return doc;
  const idDoc = documentedMaxReferenceFilesForModelId(ctx.resolvedModelId);
  if (idDoc !== undefined) return idDoc;
  if (typeof model.maxReferenceFiles === 'number' && Number.isFinite(model.maxReferenceFiles)) {
    const n = Math.floor(model.maxReferenceFiles);
    if (n < 0) return 0;
    return Math.min(32, n);
  }
  return undefined;
}

/** Docs table wins when defined; otherwise API `maxReferenceFiles`. */
export function effectiveMaxReferenceFilesForModel(model: {
  model_id: string;
  maxReferenceFiles?: number;
} | null | undefined): number | undefined {
  if (!model) return undefined;
  const doc = documentedMaxReferenceFilesForModelId(model.model_id);
  if (doc !== undefined) return doc;
  if (typeof model.maxReferenceFiles === 'number' && Number.isFinite(model.maxReferenceFiles)) {
    const n = Math.floor(model.maxReferenceFiles);
    if (n < 0) return 0;
    return Math.min(32, n);
  }
  return undefined;
}
