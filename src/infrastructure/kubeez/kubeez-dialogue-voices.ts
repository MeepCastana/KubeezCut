/**
 * Kubeez Text-to-Dialogue V3 voices (ElevenLabs).
 *
 * Source of truth: api.kubeez.com /docs/models.json → text-to-dialogue-v3.voice_allowlist.
 * The API rejects (400) any voice id outside this 26-entry allowlist before billing.
 */

export type VoiceCategory =
  | 'Conversational'
  | 'Narration'
  | 'Characters'
  | 'Social Media'
  | 'Educational'
  | 'Entertainment'
  | 'Advertisement';

export interface TextToDialogueVoice {
  id: string;
  label: string;
  category?: VoiceCategory;
}

const FEMALE_NAMES = new Set([
  'Rachel', 'Aria', 'Domi', 'Sarah', 'Jane', 'Juniper', 'Arabella', 'Hope',
  'Blondie', 'Priyanka', 'Alexandra', 'Monika',
]);

export function getVoiceGender(voice: TextToDialogueVoice): 'female' | 'male' {
  const name = voice.label.split(' - ')[0]?.trim() || voice.label.split(/\s/)[0] || '';
  return FEMALE_NAMES.has(name) ? 'female' : 'male';
}

export const TEXT_TO_DIALOGUE_VOICES: TextToDialogueVoice[] = [
  { id: 'Rachel', label: 'Rachel' },
  { id: 'Drew', label: 'Drew' },
  { id: 'Clyde', label: 'Clyde' },
  { id: 'Paul', label: 'Paul' },
  { id: 'Aria', label: 'Aria' },
  { id: 'Domi', label: 'Domi' },
  { id: 'Dave', label: 'Dave' },
  { id: 'Roger', label: 'Roger' },
  { id: 'Fin', label: 'Fin' },
  { id: 'Sarah', label: 'Sarah' },
  { id: 'James', label: 'James' },
  { id: 'Jane', label: 'Jane' },
  { id: 'Juniper', label: 'Juniper' },
  { id: 'Arabella', label: 'Arabella' },
  { id: 'Hope', label: 'Hope' },
  { id: 'Bradford', label: 'Bradford' },
  { id: 'Reginald', label: 'Reginald' },
  { id: 'Gaming', label: 'Gaming' },
  { id: 'Austin', label: 'Austin' },
  { id: 'Kuon', label: 'Kuon' },
  { id: 'Blondie', label: 'Blondie' },
  { id: 'Priyanka', label: 'Priyanka' },
  { id: 'Alexandra', label: 'Alexandra' },
  { id: 'Monika', label: 'Monika' },
  { id: 'Mark', label: 'Mark' },
  { id: 'Grimblewood', label: 'Grimblewood' },
];

export const DEFAULT_VOICE_ID = 'Rachel';

const voiceById = new Map(TEXT_TO_DIALOGUE_VOICES.map((v) => [v.id, v]));

export function getVoiceById(id: string): TextToDialogueVoice | undefined {
  return voiceById.get(id);
}
