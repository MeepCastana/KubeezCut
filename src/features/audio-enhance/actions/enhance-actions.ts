/**
 * Audio enhance actions — toggle, set settings, applied with undo/redo.
 *
 * Mutations go through `execute()` so they're undoable. The actual
 * enhancement work (decode + worker) is kicked off lazily by the cache
 * when playback or export needs the buffer; toggling here is a cheap
 * settings flip.
 */

import { useItemsStore, useTimelineSettingsStore, execute } from '../deps/timeline';
import type { AudioEnhanceSettings } from '@/types/timeline';
import { withDefaults, DEFAULT_ENHANCE_SETTINGS } from '../types';

function readCurrent(itemId: string): AudioEnhanceSettings {
  const item = useItemsStore.getState().itemById[itemId];
  return withDefaults(item?.audioEnhance);
}

export function toggleAudioEnhance(itemId: string, enabled: boolean): void {
  execute('TOGGLE_AUDIO_ENHANCE', () => {
    const current = readCurrent(itemId);
    const next: AudioEnhanceSettings = { ...current, enabled };
    useItemsStore.getState()._updateItem(itemId, { audioEnhance: next });
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId, enabled });
}

export function setAudioEnhanceSettings(
  itemId: string,
  patch: Partial<AudioEnhanceSettings>,
): void {
  execute('UPDATE_AUDIO_ENHANCE', () => {
    const current = readCurrent(itemId);
    const next: AudioEnhanceSettings = { ...current, ...patch };
    useItemsStore.getState()._updateItem(itemId, { audioEnhance: next });
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId, patch });
}

export function setAudioEnhanceSettingsMany(
  itemIds: string[],
  patch: Partial<AudioEnhanceSettings>,
): void {
  execute('UPDATE_AUDIO_ENHANCE_MANY', () => {
    const items = useItemsStore.getState();
    for (const id of itemIds) {
      const current = withDefaults(items.itemById[id]?.audioEnhance);
      const next: AudioEnhanceSettings = { ...current, ...patch };
      items._updateItem(id, { audioEnhance: next });
    }
    useTimelineSettingsStore.getState().markDirty();
  }, { count: itemIds.length, patch });
}

export function resetAudioEnhance(itemId: string): void {
  execute('RESET_AUDIO_ENHANCE', () => {
    useItemsStore.getState()._updateItem(itemId, { audioEnhance: { ...DEFAULT_ENHANCE_SETTINGS } });
    useTimelineSettingsStore.getState().markDirty();
  }, { itemId });
}
