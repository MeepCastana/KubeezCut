/**
 * Audio enhancement types & helpers.
 *
 * Bake-time settings flow through the worker and are baked into the cached
 * AudioBuffer. Play-time settings (intensity) are applied during playback.
 */

import type { AudioEnhanceSettings } from '@/types/timeline';

export type { AudioEnhanceSettings };

export type EnhanceModel = 'rnnoise' | 'dfn3';

export interface BakeSettings {
  model: EnhanceModel;
  denoise: boolean;
  aggressive: boolean;
  highPass: boolean;
  hum: 'off' | '50' | '60';
  deEss: boolean;
  voiceEq: boolean;
  compress: boolean;
  normalize: boolean;
}

export const DEFAULT_ENHANCE_SETTINGS: AudioEnhanceSettings = {
  enabled: false,
  intensity: 1,
  model: 'rnnoise',
  denoise: true,
  aggressive: false,
  highPass: true,
  hum: 'off',
  deEss: false,
  voiceEq: false,
  compress: true,
  normalize: true,
};

export function withDefaults(s: AudioEnhanceSettings | undefined): AudioEnhanceSettings {
  if (!s) return DEFAULT_ENHANCE_SETTINGS;
  return {
    enabled: s.enabled,
    intensity: clamp01(s.intensity ?? 1),
    model: s.model ?? 'rnnoise',
    denoise: s.denoise ?? true,
    aggressive: s.aggressive ?? false,
    highPass: s.highPass ?? true,
    hum: s.hum ?? 'off',
    deEss: s.deEss ?? false,
    voiceEq: s.voiceEq ?? false,
    compress: s.compress ?? true,
    normalize: s.normalize ?? true,
  };
}

export function getBakeSettings(s: AudioEnhanceSettings): BakeSettings {
  return {
    model: s.model ?? 'rnnoise',
    denoise: s.denoise,
    aggressive: s.aggressive ?? false,
    highPass: s.highPass ?? true,
    hum: s.hum ?? 'off',
    deEss: s.deEss ?? false,
    voiceEq: s.voiceEq ?? false,
    compress: s.compress ?? true,
    normalize: s.normalize ?? true,
  };
}

/**
 * Stable hash of the bake-time settings. Two settings objects with the same
 * bake-time parameters share the same enhanced AudioBuffer in the cache.
 *
 * Note: `enabled` and `intensity` are NOT part of the hash — those are
 * play-time switches that don't change the rendered buffer.
 */
export function hashBakeSettings(s: BakeSettings): string {
  // Deterministic key order (compact, debuggable).
  return [
    `M${s.model}`,
    s.denoise ? 'd1' : 'd0',
    s.aggressive ? 'a1' : 'a0',
    s.highPass ? 'h1' : 'h0',
    `n${s.hum}`,
    s.deEss ? 'e1' : 'e0',
    s.voiceEq ? 'v1' : 'v0',
    s.compress ? 'c1' : 'c0',
    s.normalize ? 'm1' : 'm0',
  ].join('-');
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
