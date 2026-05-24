/**
 * Offline / missing-API fallbacks for per-model generation limits (prompt length, aspect hints, etc.).
 *
 * **Merge policy:** `applyModelRequirementFallbacks` only fills fields that are still `undefined` after
 * `GET /v1/models` normalization. Live API capabilities always win.
 *
 * **Prompt `prompt_max_chars`:** aligned with Kubeez web `getMaxPromptLength` in `modelDefaults.ts`
 * (VideoAIChat). Reference counts: `kubeez-documented-reference-limits.ts`. Regenerate when the web app changes.
 *
 * Matrix (model_id → prompt_max_chars, notes):
 * - Seedream V4 / V4 edit: 2500; V4.5 / V4.5 edit: 3000; 5 Lite: 2995
 * - Flux 2 variants: 5000; Logo Maker: 10000
 * - Nano Banana / edit / Imagen 4 / Grok / Qwen / P-Image / Z-Image: 5000 (web bucket)
 * - Nano Banana Pro / Nano Banana 2 families: 20000
 * - GPT 1.5 Image: 3000
 * - Grok T2I aspects: 1:1, 2:3, 3:2
 * - Kling 2.5 / 2.6 / 3.0: 2500; Seedance 1.5 Pro: 2500; V1 Pro Fast I2V: 5000; Wan 2.5: 800
 * - Veo 3.1 variant ids: 5000
 * - Music (built-in tool ids): 400
 */

import type { KubeezMediaModelOption } from './kubeez-models';
import { documentedMaxReferenceFilesForModelId } from './kubeez-documented-reference-limits';

export type KubeezModelRequirementRow = {
  model_id?: string;
  /** Longest-prefix wins after exact `model_id` match. */
  idPrefix?: string;
  prompt_max_chars?: number;
  aspectRatioOptions?: string[];
  showAspectRatio?: boolean;
  durationOptions?: string[];
  supports_sound?: boolean;
  maxReferenceFiles?: number;
  /** Short note for future maintainers (not shown in UI). */
  notes?: string;
};

const DEFAULT_IMAGE_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;

/** Exact `model_id` → patch (highest precedence after API). */
const EXACT: Record<string, Partial<KubeezMediaModelOption>> = {
  // Seedream / ByteDance (web service validation)
  'seedream-v4': { prompt_max_chars: 2500, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'seedream-v4-edit': { prompt_max_chars: 2500, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'seedream-v4-5': { prompt_max_chars: 3000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'seedream-v4-5-edit': { prompt_max_chars: 3000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'seedream-v5-lite': { prompt_max_chars: 2995, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  '5-lite-text-to-image': { prompt_max_chars: 2995, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  '5-lite-image-to-image': { prompt_max_chars: 2995, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },

  // Flux (FluxProService)
  'flux-2': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'flux-2-1K': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'flux-2-2K': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'flux-2-edit-1K': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'flux-2-edit-2K': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },

  // Grok image (GrokTextToImageService aspect allow-list)
  'grok-text-to-image': {
    prompt_max_chars: 5000,
    aspectRatioOptions: ['1:1', '2:3', '3:2'],
    showAspectRatio: true,
  },
  'grok-image-to-image': {
    prompt_max_chars: 5000,
    aspectRatioOptions: ['1:1', '2:3', '3:2'],
    showAspectRatio: true,
  },

  // Z-Image (ReplicateZImageService) — live API reports 5000.
  'z-image': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'z-image-hd': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },

  // Imagen 4 (getMaxPromptLength: 5000 for `imagen-4`; prefix covers -fast/-ultra)
  'imagen-4': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'imagen-4-fast': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'imagen-4-ultra': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },

  // Nano Banana — base/edit: 5000; NB2 / NB Pro: 20000
  'nano-banana': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'nano-banana-edit': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'nano-banana-2': { prompt_max_chars: 20_000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'nano-banana-2-2K': { prompt_max_chars: 20_000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'nano-banana-2-4K': { prompt_max_chars: 20_000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'nano-banana-pro': { prompt_max_chars: 20_000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'nano-banana-pro-2K': { prompt_max_chars: 20_000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'nano-banana-pro-4K': { prompt_max_chars: 20_000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },

  // GPT-1.5 Image — API accepts ONLY 1:1, 2:3, 3:2 (not 16:9 / 9:16 / 4:3 / 3:4).
  'gpt-1.5-image-medium': { prompt_max_chars: 3000, aspectRatioOptions: ['1:1', '2:3', '3:2'] },
  'gpt-1.5-image-high': { prompt_max_chars: 3000, aspectRatioOptions: ['1:1', '2:3', '3:2'] },

  // GPT Image 2 — API also accepts 'auto' but the picker uses the default set.
  'gpt-image-2': { prompt_max_chars: 20_000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },

  'qwen-text-to-image': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },
  'qwen-image-to-image': { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },

  /** Image edit: output aspect follows input — hide ratio picker (website: aspect_ratio auto). */
  'p-image-edit': { prompt_max_chars: 5000, showAspectRatio: false },

  'logo-maker': { prompt_max_chars: 10_000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] },

  // Video — from web services
  'kling-2-5-image-to-video-pro': { prompt_max_chars: 2500 },
  'kling-2-5-image-to-video-pro-10s': { prompt_max_chars: 2500 },
  'kling-2-6-text-to-video-5s': { prompt_max_chars: 2500 },
  'kling-2-6-image-to-video-5s': { prompt_max_chars: 2500 },
  'kling-2-6-motion-control-720p': { prompt_max_chars: 2500 },
  'kling-2-6-motion-control-1080p': { prompt_max_chars: 2500 },
  'kling-3-0-std': { prompt_max_chars: 2500 },
  'kling-3-0-pro': { prompt_max_chars: 2500 },
  'kling-3-0-motion-control-720p': { prompt_max_chars: 2500 },
  'kling-3-0-motion-control-1080p': { prompt_max_chars: 2500 },

  // Seedance 1.5 Pro — live API reports 2500, not 5000.
  'seedance-1-5-pro-720p-8s': { prompt_max_chars: 2500 },
  'seedance-1-5-pro-1080p-8s': { prompt_max_chars: 2500 },

  // Seedance 2 (all resolution + fast + video-ref variants) — live API reports 2500.
  'seedance-2-480p': { prompt_max_chars: 2500 },
  'seedance-2-720p': { prompt_max_chars: 2500 },
  'seedance-2-480p-video-ref': { prompt_max_chars: 2500 },
  'seedance-2-720p-video-ref': { prompt_max_chars: 2500 },
  'seedance-2-fast-480p': { prompt_max_chars: 2500 },
  'seedance-2-fast-720p': { prompt_max_chars: 2500 },
  'seedance-2-fast-480p-video-ref': { prompt_max_chars: 2500 },
  'seedance-2-fast-720p-video-ref': { prompt_max_chars: 2500 },

  // P-Video (Pruna AI) — accepts 1 image + 1 audio reference. Duration is a body field
  // (1s..20s integer seconds). Aspect is a body field (`aspect_ratio`). Native audio is
  // present in the output (driven by the audio reference / scene).
  'p-video': {
    prompt_max_chars: 2000,
    aspectRatioOptions: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    durationOptions: [
      '1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s',
      '11s', '12s', '13s', '14s', '15s', '16s', '17s', '18s', '19s', '20s',
    ],
    supports_sound: true,
  },

  'v1-pro-fast-i2v-720p-5s': { prompt_max_chars: 5000 },
  'v1-pro-fast-i2v-1080p-5s': { prompt_max_chars: 5000 },

  'wan-2-5': { prompt_max_chars: 800 },

  'grok-text-to-video-6s': { prompt_max_chars: 5000 },
  'grok-image-to-video': { prompt_max_chars: 5000 },

  'veo3-1-fast-text-to-video': { prompt_max_chars: 5000 },
  'veo3-1-text-to-video': { prompt_max_chars: 5000 },

  // Gemini Omni Video — multimodal (text/image/video → video + native voice). API enums
  // for the 10 priced variants. Duration is encoded in model_id; aspect/voice/seed are body
  // fields. `durationOptions` exposed for the dialog.
  'gemini-omni-video-hd-4s': { prompt_max_chars: 5000, supports_sound: true },
  'gemini-omni-video-hd-6s': { prompt_max_chars: 5000, supports_sound: true },
  'gemini-omni-video-hd-8s': { prompt_max_chars: 5000, supports_sound: true },
  'gemini-omni-video-hd-10s': { prompt_max_chars: 5000, supports_sound: true },
  'gemini-omni-video-4k-4s': { prompt_max_chars: 5000, supports_sound: true },
  'gemini-omni-video-4k-6s': { prompt_max_chars: 5000, supports_sound: true },
  'gemini-omni-video-4k-8s': { prompt_max_chars: 5000, supports_sound: true },
  'gemini-omni-video-4k-10s': { prompt_max_chars: 5000, supports_sound: true },
  'gemini-omni-video-hd-video-ref': { prompt_max_chars: 5000, supports_sound: true },
  'gemini-omni-video-4k-video-ref': { prompt_max_chars: 5000, supports_sound: true },

  // Music — form validation (non-custom prompt cap)
  V4: { prompt_max_chars: 400 },
  V4_5: { prompt_max_chars: 400 },
  V4_5PLUS: { prompt_max_chars: 400 },
  V5: { prompt_max_chars: 400 },
  V5_5: { prompt_max_chars: 400 },
};

/**
 * Longest `idPrefix` wins (sort descending by length before matching).
 * Listed in arbitrary order; sorted at module init.
 */
const PREFIX_RULES: { idPrefix: string; patch: Partial<KubeezMediaModelOption> }[] = [
  { idPrefix: 'kling-2-6-', patch: { prompt_max_chars: 2500 } },
  { idPrefix: 'kling-2-5-', patch: { prompt_max_chars: 2500 } },
  { idPrefix: 'kling-3-0-', patch: { prompt_max_chars: 2500 } },
  /** Seedance 1.5 Pro — live API reports 2500. */
  { idPrefix: 'seedance-1-5-pro-', patch: { prompt_max_chars: 2500 } },
  /** Seedance 2 family — live API reports 2500 across all variants. */
  { idPrefix: 'seedance-2-', patch: { prompt_max_chars: 2500 } },
  { idPrefix: 'v1-pro-fast-i2v-', patch: { prompt_max_chars: 5000 } },
  { idPrefix: 'wan-2-5-', patch: { prompt_max_chars: 800 } },
  { idPrefix: 'wan-2-5', patch: { prompt_max_chars: 800 } },
  { idPrefix: 'grok-', patch: { prompt_max_chars: 5000 } },
  { idPrefix: 'veo3-1-', patch: { prompt_max_chars: 5000 } },
  { idPrefix: 'veo3-', patch: { prompt_max_chars: 5000 } },
  { idPrefix: 'gemini-omni-video-', patch: { prompt_max_chars: 5000, supports_sound: true } },
  { idPrefix: 'flux-2-', patch: { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] } },
  { idPrefix: 'nano-banana-2-', patch: { prompt_max_chars: 20_000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] } },
  { idPrefix: 'nano-banana-pro-', patch: { prompt_max_chars: 20_000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] } },
  { idPrefix: 'imagen-4', patch: { prompt_max_chars: 5000, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] } },
  { idPrefix: 'seedream-', patch: { prompt_max_chars: 2500, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] } },
  { idPrefix: '5-lite-', patch: { prompt_max_chars: 2995, aspectRatioOptions: [...DEFAULT_IMAGE_ASPECTS] } },
];

const PREFIX_RULES_SORTED = [...PREFIX_RULES].sort((a, b) => b.idPrefix.length - a.idPrefix.length);

/** Resolve static requirement patch for a model id (exact → longest prefix). Exported for tests. */
export function getRequirementFallbackForModelId(modelId: string): Partial<KubeezMediaModelOption> | null {
  if (!modelId) return null;
  const exact = EXACT[modelId];
  if (exact) return { ...exact };

  for (const { idPrefix, patch } of PREFIX_RULES_SORTED) {
    if (modelId.startsWith(idPrefix)) return { ...patch };
  }
  return null;
}

function pickDefined<T>(api: T | undefined, fb: T | undefined): T | undefined {
  return api !== undefined ? api : fb;
}

/**
 * Fills missing requirement fields from static tables and `documentedMaxReferenceFilesForModelId`.
 * Safe to call multiple times (idempotent when API data is complete).
 */
export function applyModelRequirementFallbacks(model: KubeezMediaModelOption): KubeezMediaModelOption {
  const merged = getRequirementFallbackForModelId(model.model_id) ?? {};
  const docMax = documentedMaxReferenceFilesForModelId(model.model_id);

  return {
    ...model,
    prompt_max_chars: pickDefined(model.prompt_max_chars, merged.prompt_max_chars),
    aspectRatioOptions: model.aspectRatioOptions ?? merged.aspectRatioOptions,
    showAspectRatio: pickDefined(model.showAspectRatio, merged.showAspectRatio),
    durationOptions: model.durationOptions ?? merged.durationOptions,
    supports_sound: model.supports_sound ?? merged.supports_sound,
    /** REST/docs table wins over API when we have a row (Kubeez web parity). */
    maxReferenceFiles: docMax !== undefined ? docMax : model.maxReferenceFiles ?? merged.maxReferenceFiles,
  };
}
