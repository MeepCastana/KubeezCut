/// <reference lib="webworker" />
/**
 * Audio Enhance Worker
 *
 * Runs the offline enhancement chain: optional high-pass → optional notch →
 * optional RNNoise denoise → optional de-esser → optional compressor →
 * optional peak-normalize.
 *
 * Input/output is mono Float32 channel data sampled at 48 kHz. Stereo input
 * is split into two passes (L and R processed independently for denoise; this
 * is the standard approach since RNNoise is a mono model trained on speech).
 *
 * RNNoise quirk: the WASM model expects samples in the int16 range
 * (`-32768..32767`) as Float32, NOT normalized `-1..1`. Failing to scale up
 * is the most common integration bug. We scale on input and back on output.
 */

import type { BakeSettings } from '../types';

const RNNOISE_FRAME_SIZE = 480;     // 10 ms @ 48 kHz
const RNNOISE_SAMPLE_RATE = 48000;
const INT16_SCALE = 32768;

interface EnhanceJobMessage {
  type: 'enhance';
  jobId: string;
  channels: Float32Array[];   // 1 or 2 channels
  sampleRate: number;         // must be 48000 for RNNoise
  settings: BakeSettings;
}

interface EnhanceProgressMessage {
  type: 'progress';
  jobId: string;
  progress: number;           // 0..1
}

interface EnhanceDoneMessage {
  type: 'done';
  jobId: string;
  channels: Float32Array[];
  peakDb: number;
  durationMs: number;
}

interface EnhanceErrorMessage {
  type: 'error';
  jobId: string;
  error: string;
}

type WorkerOutMessage = EnhanceProgressMessage | EnhanceDoneMessage | EnhanceErrorMessage;

interface RnnoiseModule {
  _rnnoise_create: () => number;
  _rnnoise_destroy: (state: number) => void;
  _rnnoise_process_frame: (state: number, output: number, input: number) => number;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  HEAPF32: Float32Array;
}

let rnnoiseModulePromise: Promise<RnnoiseModule> | null = null;

async function loadRnnoise(): Promise<RnnoiseModule> {
  if (!rnnoiseModulePromise) {
    rnnoiseModulePromise = (async () => {
      // Vite resolves `?url` to the hashed asset URL, so Emscripten's
      // `locateFile` can hand the WASM the right path even when this worker
      // is bundled under `/assets/<hash>.js` and the WASM lives elsewhere.
      const wasmUrl = (await import('@jitsi/rnnoise-wasm/dist/rnnoise.wasm?url')).default;
      const mod = (await import('@jitsi/rnnoise-wasm')) as unknown as {
        createRNNWasmModule: (overrides?: {
          locateFile?: (path: string) => string;
        }) => Promise<RnnoiseModule>;
      };
      return mod.createRNNWasmModule({
        locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path),
      });
    })();
  }
  return rnnoiseModulePromise;
}

// ---------------------------------------------------------------------------
// Biquad filters (Robert Bristow-Johnson cookbook)
// ---------------------------------------------------------------------------

interface BiquadState {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
  z1: number; z2: number;
}

function makeHighPass(sampleRate: number, freq: number, q: number): BiquadState {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * q);
  const a0 = 1 + alpha;
  const b0 = (1 + cosw0) / 2 / a0;
  const b1 = -(1 + cosw0) / a0;
  const b2 = (1 + cosw0) / 2 / a0;
  const a1 = (-2 * cosw0) / a0;
  const a2 = (1 - alpha) / a0;
  return { b0, b1, b2, a1, a2, z1: 0, z2: 0 };
}

function makeNotch(sampleRate: number, freq: number, q: number): BiquadState {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * q);
  const a0 = 1 + alpha;
  const b0 = 1 / a0;
  const b1 = (-2 * cosw0) / a0;
  const b2 = 1 / a0;
  const a1 = (-2 * cosw0) / a0;
  const a2 = (1 - alpha) / a0;
  return { b0, b1, b2, a1, a2, z1: 0, z2: 0 };
}

function makeLowShelf(sampleRate: number, freq: number, gainDb: number, q: number): BiquadState {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * q);
  const ap1 = A + 1;
  const am1 = A - 1;
  const sqrtAalpha2 = 2 * Math.sqrt(A) * alpha;
  const a0 = ap1 + am1 * cosw0 + sqrtAalpha2;
  const b0 = (A * (ap1 - am1 * cosw0 + sqrtAalpha2)) / a0;
  const b1 = (2 * A * (am1 - ap1 * cosw0)) / a0;
  const b2 = (A * (ap1 - am1 * cosw0 - sqrtAalpha2)) / a0;
  const a1 = (-2 * (am1 + ap1 * cosw0)) / a0;
  const a2 = (ap1 + am1 * cosw0 - sqrtAalpha2) / a0;
  return { b0, b1, b2, a1, a2, z1: 0, z2: 0 };
}

function makePeaking(sampleRate: number, freq: number, gainDb: number, q: number): BiquadState {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * q);
  const a0 = 1 + alpha / A;
  const b0 = (1 + alpha * A) / a0;
  const b1 = (-2 * cosw0) / a0;
  const b2 = (1 - alpha * A) / a0;
  const a1 = (-2 * cosw0) / a0;
  const a2 = (1 - alpha / A) / a0;
  return { b0, b1, b2, a1, a2, z1: 0, z2: 0 };
}

function makeHighShelf(sampleRate: number, freq: number, gainDb: number, q: number): BiquadState {
  // Used for de-esser as a side-chain detector emphasis filter.
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * q);
  const ap1 = A + 1;
  const am1 = A - 1;
  const sqrtAalpha2 = 2 * Math.sqrt(A) * alpha;
  const a0 = ap1 - am1 * cosw0 + sqrtAalpha2;
  const b0 = (A * (ap1 + am1 * cosw0 + sqrtAalpha2)) / a0;
  const b1 = (-2 * A * (am1 + ap1 * cosw0)) / a0;
  const b2 = (A * (ap1 + am1 * cosw0 - sqrtAalpha2)) / a0;
  const a1 = (2 * (am1 - ap1 * cosw0)) / a0;
  const a2 = (ap1 - am1 * cosw0 - sqrtAalpha2) / a0;
  return { b0, b1, b2, a1, a2, z1: 0, z2: 0 };
}

function processBiquadInPlace(buf: Float32Array, s: BiquadState): void {
  // Transposed Direct-Form II. Stable for fixed coefficients.
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const y = s.b0 * x + s.z1;
    s.z1 = s.b1 * x - s.a1 * y + s.z2;
    s.z2 = s.b2 * x - s.a2 * y;
    buf[i] = y;
  }
}

// ---------------------------------------------------------------------------
// FFT (Cooley–Tukey radix-2, in-place) for spectral subtraction dereverb.
// ---------------------------------------------------------------------------

function fftRadix2(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  // Bit-reverse permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = real[i]!; real[i] = real[j]!; real[j] = tmp;
      tmp = imag[i]!; imag[i] = imag[j]!; imag[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wReal = Math.cos(ang);
    const wImag = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curReal = 1, curImag = 0;
      for (let k = 0; k < halfLen; k++) {
        const aIdx = i + k;
        const bIdx = i + k + halfLen;
        const tReal = curReal * real[bIdx]! - curImag * imag[bIdx]!;
        const tImag = curReal * imag[bIdx]! + curImag * real[bIdx]!;
        real[bIdx] = real[aIdx]! - tReal;
        imag[bIdx] = imag[aIdx]! - tImag;
        real[aIdx] = real[aIdx]! + tReal;
        imag[aIdx] = imag[aIdx]! + tImag;
        const nextCurReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextCurReal;
      }
    }
  }
}

function ifftRadix2(real: Float32Array, imag: Float32Array): void {
  // IFFT via: ifft(x) = conj(fft(conj(x))) / N
  const n = real.length;
  for (let i = 0; i < n; i++) imag[i] = -imag[i]!;
  fftRadix2(real, imag);
  const invN = 1 / n;
  for (let i = 0; i < n; i++) {
    real[i] = real[i]! * invN;
    imag[i] = -imag[i]! * invN;
  }
}

/**
 * Spectral-subtraction dereverb / residual-noise attenuator.
 *
 * Estimates a noise floor magnitude per frequency bin from the lowest 10%
 * of magnitudes seen across the clip (a robust proxy for the room/late-reverb
 * tail level), then subtracts an over-estimate of that floor from each frame's
 * magnitude. Phase is preserved. Uses 50% overlap with a Hann window.
 *
 * Helps with: room reverb tail, broadband room tone, residual fan/AC noise
 * that RNNoise leaves behind. Does not magically remove echo of nearby
 * surfaces — for that you really do need a dereverb model.
 */
function spectralSubtractInPlace(
  channel: Float32Array,
  fftSize = 1024,
  overSubtract = 1.6,
  noiseFloor = 0.1,
): void {
  const hop = fftSize / 2;
  const totalFrames = Math.ceil(channel.length / hop);
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
  }

  // Pass 1: collect magnitude per bin per frame to estimate the noise floor.
  // Storing all magnitudes would be huge; instead track a running per-bin
  // 10th-percentile via a histogram per bin.
  const halfBins = fftSize / 2 + 1;
  const noiseEstimate = new Float32Array(halfBins);
  // Use a rolling minimum-tracker as a cheap noise-floor proxy.
  noiseEstimate.fill(Infinity);

  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);

  // First sweep — estimate noise floor (rolling minimum).
  for (let f = 0; f < totalFrames; f++) {
    const start = f * hop;
    real.fill(0);
    imag.fill(0);
    for (let i = 0; i < fftSize; i++) {
      const src = start + i;
      if (src < channel.length) real[i] = channel[src]! * window[i]!;
    }
    fftRadix2(real, imag);
    for (let k = 0; k < halfBins; k++) {
      const m = Math.hypot(real[k]!, imag[k]!);
      if (m < noiseEstimate[k]!) noiseEstimate[k] = m;
    }
  }

  // Smooth the noise estimate across bins to avoid musical-noise artefacts.
  const smoothed = new Float32Array(halfBins);
  const radius = 4;
  for (let k = 0; k < halfBins; k++) {
    let sum = 0, count = 0;
    for (let dk = -radius; dk <= radius; dk++) {
      const j = k + dk;
      if (j >= 0 && j < halfBins) { sum += noiseEstimate[j]!; count++; }
    }
    smoothed[k] = sum / count;
  }

  // Pass 2: subtract the smoothed noise estimate, OLA back into the output.
  const output = new Float32Array(channel.length);
  const norm = new Float32Array(channel.length);
  for (let f = 0; f < totalFrames; f++) {
    const start = f * hop;
    real.fill(0);
    imag.fill(0);
    for (let i = 0; i < fftSize; i++) {
      const src = start + i;
      if (src < channel.length) real[i] = channel[src]! * window[i]!;
    }
    fftRadix2(real, imag);
    // Subtract noise floor from magnitude, preserve phase.
    for (let k = 0; k < halfBins; k++) {
      const re = real[k]!;
      const im = imag[k]!;
      const mag = Math.hypot(re, im);
      const floor = smoothed[k]! * overSubtract;
      const newMag = Math.max(noiseFloor * mag, mag - floor);
      const scale = mag > 1e-9 ? newMag / mag : 0;
      real[k] = re * scale;
      imag[k] = im * scale;
      // Mirror for negative frequencies (real signal symmetry).
      if (k > 0 && k < halfBins - 1) {
        const mIdx = fftSize - k;
        real[mIdx] = real[k]!;
        imag[mIdx] = -imag[k]!;
      }
    }
    ifftRadix2(real, imag);
    for (let i = 0; i < fftSize; i++) {
      const dst = start + i;
      if (dst < channel.length) {
        const w = window[i]!;
        output[dst] = output[dst]! + real[i]! * w;
        norm[dst] = norm[dst]! + w * w;
      }
    }
  }

  for (let i = 0; i < channel.length; i++) {
    channel[i] = norm[i]! > 1e-6 ? output[i]! / norm[i]! : 0;
  }
}

// ---------------------------------------------------------------------------
// RNNoise pass (mono, 48 kHz, 480-sample frames, int16-scaled Float32)
// ---------------------------------------------------------------------------

async function rnnoisePass(
  channel: Float32Array,
  onProgress?: (p: number) => void,
): Promise<Float32Array> {
  const mod = await loadRnnoise();
  const state = mod._rnnoise_create();
  const inPtr = mod._malloc(RNNOISE_FRAME_SIZE * 4);
  const outPtr = mod._malloc(RNNOISE_FRAME_SIZE * 4);
  try {
    const out = new Float32Array(channel.length);
    const frames = Math.ceil(channel.length / RNNOISE_FRAME_SIZE);
    const heap = mod.HEAPF32;
    const inIdx = inPtr >> 2;
    const outIdx = outPtr >> 2;

    let lastProgress = -1;
    const buf = new Float32Array(RNNOISE_FRAME_SIZE);

    for (let f = 0; f < frames; f++) {
      const start = f * RNNOISE_FRAME_SIZE;
      const end = Math.min(start + RNNOISE_FRAME_SIZE, channel.length);
      const filled = end - start;

      // Copy + scale to int16 range; zero-pad final frame.
      for (let i = 0; i < filled; i++) buf[i] = channel[start + i]! * INT16_SCALE;
      for (let i = filled; i < RNNOISE_FRAME_SIZE; i++) buf[i] = 0;

      heap.set(buf, inIdx);
      mod._rnnoise_process_frame(state, outPtr, inPtr);

      for (let i = 0; i < filled; i++) {
        out[start + i] = heap[outIdx + i]! / INT16_SCALE;
      }

      if (onProgress) {
        const p = (f + 1) / frames;
        const tenth = Math.floor(p * 20);
        if (tenth !== lastProgress) {
          lastProgress = tenth;
          onProgress(p);
        }
      }
    }

    return out;
  } finally {
    mod._free(inPtr);
    mod._free(outPtr);
    mod._rnnoise_destroy(state);
  }
}

// ---------------------------------------------------------------------------
// Soft-knee compressor (single-band, sample-by-sample, voice-tuned defaults)
// ---------------------------------------------------------------------------

function compressInPlace(
  buf: Float32Array,
  sampleRate: number,
  thresholdDb = -20,
  ratio = 3,
  attackMs = 5,
  releaseMs = 80,
  makeupDb = 3,
): void {
  const attCoef = Math.exp(-1 / ((attackMs / 1000) * sampleRate));
  const relCoef = Math.exp(-1 / ((releaseMs / 1000) * sampleRate));
  const makeup = Math.pow(10, makeupDb / 20);
  let env = 0;

  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const ax = Math.abs(x);
    const coef = ax > env ? attCoef : relCoef;
    env = ax + coef * (env - ax);

    const envDb = 20 * Math.log10(Math.max(env, 1e-9));
    const overshoot = envDb - thresholdDb;
    let gainDb = 0;
    if (overshoot > 0) gainDb = -overshoot * (1 - 1 / ratio);
    const gain = Math.pow(10, gainDb / 20);
    buf[i] = x * gain * makeup;
  }
}

// ---------------------------------------------------------------------------
// De-esser: detect high-frequency energy via shelving filter, attenuate when
// it exceeds threshold. Cheap dynamic single-band approach.
// ---------------------------------------------------------------------------

function deEssInPlace(
  buf: Float32Array,
  sampleRate: number,
  thresholdDb = -22,
  ratio = 4,
  detectorFreq = 6500,
): void {
  const detector = makeHighShelf(sampleRate, detectorFreq, 12, 0.7);
  const attCoef = Math.exp(-1 / (0.001 * sampleRate));
  const relCoef = Math.exp(-1 / (0.04 * sampleRate));
  let env = 0;

  // Run detector on a copy.
  const detect = new Float32Array(buf.length);
  detect.set(buf);
  processBiquadInPlace(detect, detector);

  for (let i = 0; i < buf.length; i++) {
    const ax = Math.abs(detect[i]!);
    const coef = ax > env ? attCoef : relCoef;
    env = ax + coef * (env - ax);
    const envDb = 20 * Math.log10(Math.max(env, 1e-9));
    const overshoot = envDb - thresholdDb;
    if (overshoot > 0) {
      const gainDb = -overshoot * (1 - 1 / ratio);
      buf[i] = buf[i]! * Math.pow(10, gainDb / 20);
    }
  }
}

// ---------------------------------------------------------------------------
// Peak normalization
// ---------------------------------------------------------------------------

function peakNormalizeInPlace(channels: Float32Array[], targetDbfs = -1): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]!);
      if (v > peak) peak = v;
    }
  }
  if (peak < 1e-6) return 0;
  const targetLin = Math.pow(10, targetDbfs / 20);
  const gain = targetLin / peak;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) ch[i] = ch[i]! * gain;
  }
  return 20 * Math.log10(peak * gain);
}

function peakDb(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]!);
      if (v > peak) peak = v;
    }
  }
  return 20 * Math.log10(Math.max(peak, 1e-9));
}

// ---------------------------------------------------------------------------
// Pipeline driver
// ---------------------------------------------------------------------------

async function runEnhance(msg: EnhanceJobMessage, post: (m: WorkerOutMessage) => void): Promise<void> {
  const { jobId, channels, sampleRate, settings } = msg;
  if (sampleRate !== RNNOISE_SAMPLE_RATE && settings.denoise) {
    throw new Error(`Denoise requires ${RNNOISE_SAMPLE_RATE} Hz input, got ${sampleRate}`);
  }
  if (channels.length === 0) throw new Error('No input channels');

  const start = performance.now();
  const out: Float32Array[] = channels.map((c) => new Float32Array(c)); // copies

  // Pre-filters
  if (settings.highPass) {
    for (const ch of out) processBiquadInPlace(ch, makeHighPass(sampleRate, 80, 0.707));
  }
  if (settings.hum && settings.hum !== 'off') {
    const f = settings.hum === '50' ? 50 : 60;
    for (const ch of out) {
      // Notch fundamental + 2nd & 3rd harmonics (most common hum content).
      processBiquadInPlace(ch, makeNotch(sampleRate, f, 30));
      processBiquadInPlace(ch, makeNotch(sampleRate, f * 2, 30));
      processBiquadInPlace(ch, makeNotch(sampleRate, f * 3, 30));
    }
  }

  // Aggressive pre-pass: dereverb / spectral noise floor subtraction.
  // Runs BEFORE denoise so RNNoise sees a cleaner residual.
  if (settings.aggressive) {
    for (const ch of out) spectralSubtractInPlace(ch);
  }

  // Denoise (per channel; track combined progress).
  if (settings.denoise) {
    const passes = settings.aggressive ? 2 : 1;
    const totalUnits = out.length * passes;
    let unitsDone = 0;
    for (let pass = 0; pass < passes; pass++) {
      for (let i = 0; i < out.length; i++) {
        const channelIndex = i;
        const result = await rnnoisePass(out[channelIndex]!, (p) => {
          const overall = (unitsDone + p) / totalUnits;
          post({ type: 'progress', jobId, progress: overall });
        });
        out[channelIndex] = result;
        unitsDone++;
      }
    }
  }

  // Post-filters
  if (settings.voiceEq) {
    // Headphone-mic / boomy-room cleanup:
    //   • Low-shelf cut at 200 Hz (-4 dB) — kills "muddy / boxy" room tone.
    //   • Peaking cut at 400 Hz (-2 dB)  — clears chest-resonance honk.
    //   • Peaking boost at 2.5 kHz (+3 dB) — adds intelligibility / presence.
    //   • Subtle high-shelf boost at 8 kHz (+2 dB) — restores air RNNoise tends to dull.
    for (const ch of out) {
      processBiquadInPlace(ch, makeLowShelf(sampleRate, 200, -4, 0.707));
      processBiquadInPlace(ch, makePeaking(sampleRate, 400, -2, 1.0));
      processBiquadInPlace(ch, makePeaking(sampleRate, 2500, 3, 1.0));
      processBiquadInPlace(ch, makeHighShelf(sampleRate, 8000, 2, 0.707));
    }
  }
  if (settings.deEss) {
    for (const ch of out) deEssInPlace(ch, sampleRate);
  }
  if (settings.compress) {
    for (const ch of out) compressInPlace(ch, sampleRate);
  }
  let finalPeakDb: number;
  if (settings.normalize) {
    finalPeakDb = peakNormalizeInPlace(out, -1);
  } else {
    finalPeakDb = peakDb(out);
  }

  const transferList = out.map((c) => c.buffer);
  const done: EnhanceDoneMessage = {
    type: 'done',
    jobId,
    channels: out,
    peakDb: finalPeakDb,
    durationMs: performance.now() - start,
  };
  (self as DedicatedWorkerGlobalScope).postMessage(done, transferList);
}

self.addEventListener('message', (event: MessageEvent<EnhanceJobMessage>) => {
  const msg = event.data;
  if (msg.type !== 'enhance') return;
  runEnhance(msg, (out) => {
    (self as DedicatedWorkerGlobalScope).postMessage(out);
  }).catch((err: unknown) => {
    const errorMsg: EnhanceErrorMessage = {
      type: 'error',
      jobId: msg.jobId,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as DedicatedWorkerGlobalScope).postMessage(errorMsg);
  });
});

export {};
