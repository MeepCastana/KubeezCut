/**
 * Adapter for the audio-enhance feature.
 * Composition-runtime modules import from here, not from `@/features/audio-enhance` directly.
 */

export { getOrEnhanceAudio, peekEnhancedAudio } from '@/features/audio-enhance';
export type { AudioEnhanceSettings } from '@/features/audio-enhance';
