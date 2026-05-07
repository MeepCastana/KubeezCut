/**
 * Public entry point: run the enhance worker against an AudioBuffer.
 *
 * Returns a new AudioBuffer of the same sample-rate / channel count.
 * The caller is responsible for caching the result.
 */

import { createLogger } from '@/shared/logging/logger';
import { createManagedWorker } from '@/shared/utils/managed-worker';
import type { BakeSettings } from '../types';

const log = createLogger('AudioEnhance');

let nextJobId = 1;

interface PendingJob {
  resolve: (channels: Float32Array[]) => void;
  reject: (err: Error) => void;
  onProgress?: (progress: number) => void;
}

const pendingJobs = new Map<string, PendingJob>();

const managedWorker = createManagedWorker<Worker>({
  createWorker: () =>
    new Worker(new URL('../workers/audio-enhance.worker.ts', import.meta.url), {
      type: 'module',
    }),
  setupWorker: (worker) => {
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as
        | { type: 'progress'; jobId: string; progress: number }
        | { type: 'done'; jobId: string; channels: Float32Array[]; peakDb: number; durationMs: number }
        | { type: 'error'; jobId: string; error: string };

      const job = pendingJobs.get(msg.jobId);
      if (!job) return;

      if (msg.type === 'progress') {
        job.onProgress?.(msg.progress);
      } else if (msg.type === 'done') {
        pendingJobs.delete(msg.jobId);
        log.info('Enhance job completed', {
          jobId: msg.jobId,
          peakDb: msg.peakDb.toFixed(1),
          durationMs: Math.round(msg.durationMs),
        });
        job.resolve(msg.channels);
      } else {
        pendingJobs.delete(msg.jobId);
        log.warn('Enhance job failed', { jobId: msg.jobId, error: msg.error });
        job.reject(new Error(msg.error));
      }
    };
    worker.onerror = (err) => {
      log.error('Enhance worker errored', { message: err.message });
    };
    return undefined;
  },
});

export interface ProcessOptions {
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export async function processAudioBuffer(
  buffer: AudioBuffer,
  settings: BakeSettings,
  options: ProcessOptions = {},
): Promise<AudioBuffer> {
  if (buffer.sampleRate !== 48000 && settings.denoise) {
    throw new Error(
      `RNNoise requires a 48 kHz buffer; got ${buffer.sampleRate} Hz. Decode at 48 kHz before calling processAudioBuffer.`,
    );
  }

  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(new Float32Array(buffer.getChannelData(c))); // copy: worker takes ownership
  }
  const transferList = channels.map((c) => c.buffer);

  const jobId = `enh-${nextJobId++}`;
  const worker = managedWorker.getWorker();

  const processed = await new Promise<Float32Array[]>((resolve, reject) => {
    pendingJobs.set(jobId, {
      resolve,
      reject,
      onProgress: options.onProgress,
    });

    if (options.signal) {
      options.signal.addEventListener(
        'abort',
        () => {
          pendingJobs.delete(jobId);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    }

    worker.postMessage(
      {
        type: 'enhance',
        jobId,
        channels,
        sampleRate: buffer.sampleRate,
        settings,
      },
      transferList,
    );
  });

  // Build a fresh AudioBuffer holding the processed channels.
  const length = processed[0]!.length;
  const ctx = new OfflineAudioContext(processed.length, length, buffer.sampleRate);
  const out = ctx.createBuffer(processed.length, length, buffer.sampleRate);
  for (let c = 0; c < processed.length; c++) {
    // Avoid `copyToChannel` typing strictness around ArrayBufferLike vs ArrayBuffer
    // by writing into the channel's view directly.
    out.getChannelData(c).set(processed[c]!);
  }
  return out;
}

export function terminateEnhanceWorker(): void {
  managedWorker.terminate();
}
