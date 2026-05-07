/**
 * Public surface of the audio-enhance feature.
 */

export type { AudioEnhanceSettings, BakeSettings } from './types';
export {
  DEFAULT_ENHANCE_SETTINGS,
  withDefaults,
  getBakeSettings,
  hashBakeSettings,
} from './types';

export {
  getOrEnhanceAudio,
  peekEnhancedAudio,
  clearEnhancedAudioCache,
} from './services/enhanced-audio-cache';

export {
  toggleAudioEnhance,
  setAudioEnhanceSettings,
  setAudioEnhanceSettingsMany,
  resetAudioEnhance,
} from './actions/enhance-actions';

export {
  useEnhanceJobsStore,
  selectJobForMedia,
  selectErrorForMedia,
} from './stores/enhance-jobs-store';

export { AudioEnhanceSection } from './components/audio-enhance-section';
