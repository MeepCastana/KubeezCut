/**
 * Enhanced Audio Cache
 *
 * Returns an enhanced AudioBuffer for (mediaId, bake-settings-hash). The first
 * call for a given key triggers:
 *
 *   1. A fresh decode of the source media at 48 kHz (RNNoise's required rate).
 *   2. A worker pass that applies the bake-time chain.
 *   3. A memory-cache write keyed by `mediaId:settingsHash`.
 *
 * Concurrent callers share the same in-flight promise. The cache is in-memory
 * only for v1 — re-baking on reload is acceptable since users rarely toggle it.
 *
 * Why decode here instead of reusing the preview cache: the preview cache
 * stores audio at 22050 Hz (Int16), but RNNoise needs 48 kHz. Round-tripping
 * 22050→48000 throws away exactly the high-frequency band the model was
 * trained to clean — defeats the purpose.
 */

import { createLogger } from '@/shared/logging/logger';
import { ensureAc3DecoderRegistered, isAc3AudioCodec } from '@/shared/media/ac3-decoder';
import { getMedia } from '@/infrastructure/storage/indexeddb/media';
import {
  enhancedAudioKey,
  getEnhancedAudio,
  saveEnhancedAudio,
} from '@/infrastructure/storage/indexeddb/enhanced-audio';
import { processAudioBuffer } from '../engine/process-buffer';
import {
  hashBakeSettings,
  type AudioEnhanceSettings,
  type BakeSettings,
  getBakeSettings,
  withDefaults,
} from '../types';
import { useEnhanceJobsStore } from '../stores/enhance-jobs-store';

const log = createLogger('EnhancedAudioCache');

const TARGET_SAMPLE_RATE = 48000;
const MAX_CACHE_BYTES = 200 * 1024 * 1024; // 200 MB ceiling, separate from preview cache

interface CacheEntry {
  buffer: AudioBuffer;
  bytes: number;
  lastAccess: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<AudioBuffer>>();
let totalBytes = 0;

function entryKey(mediaId: string, settingsHash: string): string {
  return `${mediaId}:${settingsHash}`;
}

function estimateBytes(buffer: AudioBuffer): number {
  return buffer.numberOfChannels * buffer.length * 4;
}

function evictIfNeeded(): void {
  if (totalBytes <= MAX_CACHE_BYTES) return;
  const sorted = [...cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  for (const [key, entry] of sorted) {
    if (totalBytes <= MAX_CACHE_BYTES) break;
    cache.delete(key);
    totalBytes -= entry.bytes;
    log.debug('Evicted enhanced buffer', { key, freedMB: (entry.bytes / (1024 * 1024)).toFixed(1) });
  }
}

/**
 * Fetch (or produce) the enhanced AudioBuffer for the given media + settings.
 *
 * Returns the same promise across concurrent callers. The result lives in
 * memory until evicted (LRU) or `clearEnhancedAudioCache()` is called.
 */
export async function getOrEnhanceAudio(
  mediaId: string,
  src: string,
  settings: AudioEnhanceSettings,
): Promise<AudioBuffer> {
  const bake = getBakeSettings(withDefaults(settings));
  const hash = hashBakeSettings(bake);
  const key = entryKey(mediaId, hash);

  const cached = cache.get(key);
  if (cached) {
    cached.lastAccess = Date.now();
    return cached.buffer;
  }
  const inflight = pending.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    // First try IDB — bakes survive page reloads.
    const fromIdb = await loadFromIdb(mediaId, hash);
    if (fromIdb) {
      log.info('Loaded enhanced audio from IDB', {
        mediaId,
        hash,
        durationSec: (fromIdb.length / fromIdb.sampleRate).toFixed(2),
      });
      return fromIdb;
    }

    // Otherwise produce it (decode + worker), then persist.
    const buffer = await produceEnhanced(mediaId, src, bake, hash);
    void persistToIdb(mediaId, hash, buffer).catch((err: unknown) => {
      log.warn('Failed to persist enhanced audio to IDB', { mediaId, hash, err });
    });
    return buffer;
  })()
    .then((buffer) => {
      const bytes = estimateBytes(buffer);
      cache.set(key, { buffer, bytes, lastAccess: Date.now() });
      totalBytes += bytes;
      evictIfNeeded();
      return buffer;
    })
    .finally(() => {
      pending.delete(key);
    });

  pending.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// IDB persistence (Int16 quantization to halve size vs Float32)
// ---------------------------------------------------------------------------

function float32ToInt16Buffer(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

function int16BufferToFloat32(buf: ArrayBuffer): Float32Array {
  const view = new Int16Array(buf);
  const out = new Float32Array(view.length);
  for (let i = 0; i < view.length; i++) {
    const s = view[i]!;
    out[i] = s / (s < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

async function loadFromIdb(mediaId: string, hash: string): Promise<AudioBuffer | null> {
  try {
    const record = await getEnhancedAudio(enhancedAudioKey(mediaId, hash));
    if (!record) return null;
    const ctx = new OfflineAudioContext(
      record.channels.length,
      record.numberOfFrames,
      record.sampleRate,
    );
    const buffer = ctx.createBuffer(
      record.channels.length,
      record.numberOfFrames,
      record.sampleRate,
    );
    for (let c = 0; c < record.channels.length; c++) {
      const channelData = int16BufferToFloat32(record.channels[c]!);
      buffer.getChannelData(c).set(channelData);
    }
    return buffer;
  } catch (err) {
    log.warn('IDB read failed; will re-bake', { mediaId, hash, err });
    return null;
  }
}

async function persistToIdb(mediaId: string, hash: string, buffer: AudioBuffer): Promise<void> {
  const channels: ArrayBuffer[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(float32ToInt16Buffer(buffer.getChannelData(c)));
  }
  await saveEnhancedAudio({
    id: enhancedAudioKey(mediaId, hash),
    mediaId,
    settingsHash: hash,
    sampleRate: buffer.sampleRate,
    numberOfFrames: buffer.length,
    channels,
    createdAt: Date.now(),
  });
  log.info('Persisted enhanced audio to IDB', {
    mediaId,
    hash,
    sizeMB: (channels.reduce((s, c) => s + c.byteLength, 0) / (1024 * 1024)).toFixed(2),
  });
}

/** Synchronously check whether a cached enhanced buffer exists. */
export function peekEnhancedAudio(mediaId: string, settings: AudioEnhanceSettings): AudioBuffer | null {
  const bake = getBakeSettings(withDefaults(settings));
  const hash = hashBakeSettings(bake);
  const entry = cache.get(entryKey(mediaId, hash));
  if (!entry) return null;
  entry.lastAccess = Date.now();
  return entry.buffer;
}

/** Drop everything (e.g. on project unload). */
export function clearEnhancedAudioCache(): void {
  cache.clear();
  pending.clear();
  totalBytes = 0;
}

// ---------------------------------------------------------------------------
// Decode + process
// ---------------------------------------------------------------------------

async function produceEnhanced(
  mediaId: string,
  src: string,
  bake: BakeSettings,
  hash: string,
): Promise<AudioBuffer> {
  const { startJob, setProgress, finishJob, failJob } = useEnhanceJobsStore.getState();
  startJob(mediaId, hash);
  try {
    const decoded = await decodeAt48k(mediaId, src);
    log.info('Decoded for enhance', {
      mediaId,
      duration: decoded.duration.toFixed(2),
      channels: decoded.numberOfChannels,
      sampleRate: decoded.sampleRate,
    });

    const processed = await processAudioBuffer(decoded, bake, {
      onProgress: (p) => setProgress(mediaId, hash, p),
    });
    finishJob(mediaId, hash);
    return processed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failJob(mediaId, hash, message);
    log.warn('Enhance failed', { mediaId, error: message });
    throw err;
  }
}

/**
 * Decode the source media to a 48 kHz AudioBuffer using mediabunny + WebAudio.
 * Mirrors the decode path in `audio-decode-cache.ts` but skips the
 * 22 kHz Int16 downsampling step.
 */
async function decodeAt48k(mediaId: string, src: string): Promise<AudioBuffer> {
  const shouldRegisterAc3 = await needsAc3Decoder(mediaId);
  if (shouldRegisterAc3) {
    await ensureAc3DecoderRegistered();
  }

  const mb = await import('mediabunny');
  const input = new mb.Input({
    formats: mb.ALL_FORMATS,
    source: new mb.UrlSource(src),
  });
  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) {
      throw new Error(`No audio track found for media ${mediaId}`);
    }
    const duration = await input.computeDuration();
    const sink = new mb.AudioSampleSink(audioTrack);

    let sourceSampleRate = 48000;
    const leftChunks: Float32Array[] = [];
    const rightChunks: Float32Array[] = [];
    let totalFrames = 0;

    for await (const sample of sink.samples(0, duration)) {
      try {
        const sampleData = sample as {
          numberOfFrames?: number;
          numberOfChannels?: number;
          sampleRate?: number;
          copyTo: (destination: Float32Array, options: { planeIndex: number; format: 'f32-planar' }) => void;
        };
        const frames = Math.max(0, sampleData.numberOfFrames ?? 0);
        if (frames === 0) continue;
        const channelCount = Math.max(1, sampleData.numberOfChannels ?? 1);
        if (sampleData.sampleRate && sampleData.sampleRate > 0) {
          sourceSampleRate = sampleData.sampleRate;
        }

        const channels: Float32Array[] = [];
        for (let c = 0; c < channelCount; c++) {
          const data = new Float32Array(frames);
          sampleData.copyTo(data, { planeIndex: c, format: 'f32-planar' });
          channels.push(data);
        }
        const { left, right } = downmixToStereo(channels, frames);
        leftChunks.push(left);
        rightChunks.push(right);
        totalFrames += frames;
      } finally {
        sample.close();
      }
    }

    if (totalFrames === 0) {
      throw new Error(`Audio decode produced no output for media ${mediaId}`);
    }

    const sourceCtx = new OfflineAudioContext(2, totalFrames, sourceSampleRate);
    const sourceBuffer = sourceCtx.createBuffer(2, totalFrames, sourceSampleRate);
    const leftOut = sourceBuffer.getChannelData(0);
    const rightOut = sourceBuffer.getChannelData(1);
    let offset = 0;
    for (let i = 0; i < leftChunks.length; i++) {
      const l = leftChunks[i]!;
      const r = rightChunks[i]!;
      leftOut.set(l, offset);
      rightOut.set(r, offset);
      offset += l.length;
    }

    if (sourceSampleRate === TARGET_SAMPLE_RATE) {
      return sourceBuffer;
    }

    return await resampleViaOfflineCtx(sourceBuffer, TARGET_SAMPLE_RATE);
  } finally {
    input.dispose();
  }
}

async function resampleViaOfflineCtx(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  const targetFrames = Math.ceil((buffer.length * targetRate) / buffer.sampleRate);
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, targetFrames, targetRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  return await ctx.startRendering();
}

async function needsAc3Decoder(mediaId: string): Promise<boolean> {
  try {
    const media = await getMedia(mediaId);
    if (!media) return false;
    const codec = media.mimeType.startsWith('audio/') ? media.codec : media.audioCodec;
    return isAc3AudioCodec(codec);
  } catch {
    return false;
  }
}

function downmixToStereo(
  channels: Float32Array[],
  totalFrames: number,
): { left: Float32Array; right: Float32Array } {
  const numCh = channels.length;
  if (numCh === 1) {
    const mono = channels[0]!;
    return { left: mono, right: mono };
  }
  if (numCh === 2) {
    return { left: channels[0]!, right: channels[1]! };
  }

  // ITU-R BS.775 5.1/7.1 downmix
  const cGain = 0.7071;
  const sGain = 0.7071;
  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);
  const L = channels[0]!;
  const R = channels[1]!;
  const C = channels[2];
  const Ls = channels[4];
  const Rs = channels[5];
  const Lrs = channels[6];
  const Rrs = channels[7];
  for (let i = 0; i < totalFrames; i++) {
    let l = L[i]!;
    let r = R[i]!;
    if (C) { const c = C[i]! * cGain; l += c; r += c; }
    if (Ls) l += Ls[i]! * sGain;
    if (Rs) r += Rs[i]! * sGain;
    if (Lrs) l += Lrs[i]! * sGain;
    if (Rrs) r += Rrs[i]! * sGain;
    left[i] = l;
    right[i] = r;
  }
  return { left, right };
}
