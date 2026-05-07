import type { EnhancedAudioRecord } from '@/types/storage';
import { getDB, reconnectDB } from './connection';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('IndexedDB:EnhancedAudio');

async function getStore() {
  let db = await getDB();
  if (!db.objectStoreNames.contains('enhancedAudio')) {
    logger.warn('enhancedAudio store not found, attempting reconnection...');
    db = await reconnectDB();
    if (!db.objectStoreNames.contains('enhancedAudio')) {
      throw new Error('enhancedAudio store not found after reconnection');
    }
  }
  return db;
}

export function enhancedAudioKey(mediaId: string, settingsHash: string): string {
  return `${mediaId}:${settingsHash}`;
}

export async function getEnhancedAudio(
  id: string,
): Promise<EnhancedAudioRecord | undefined> {
  try {
    const db = await getStore();
    return await db.get('enhancedAudio', id);
  } catch (error) {
    logger.error(`Failed to get enhanced audio ${id}:`, error);
    return undefined;
  }
}

export async function saveEnhancedAudio(record: EnhancedAudioRecord): Promise<void> {
  const db = await getStore();
  try {
    await db.put('enhancedAudio', record);
  } catch (error) {
    logger.error(`Failed to save enhanced audio ${record.id}:`, error);
    throw error;
  }
}

/** Drop every enhanced-audio record for a given media (e.g. on media delete). */
export async function deleteEnhancedAudioForMedia(mediaId: string): Promise<void> {
  try {
    const db = await getStore();
    const tx = db.transaction('enhancedAudio', 'readwrite');
    const index = tx.store.index('mediaId');
    let cursor = await index.openCursor(mediaId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch (error) {
    logger.error(`Failed to delete enhanced audio for media ${mediaId}:`, error);
  }
}
