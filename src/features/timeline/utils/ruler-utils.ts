/**
 * Timeline ruler intervals and label formatting (OpenCut-style).
 *
 * - Labels scale with zoom via minimum pixel spacing (readable density).
 * - Second boundaries show `MM:SS` (or `H:MM:SS` from 1h+); sub-second marks show `Nf`.
 */

/**
 * Frame intervals for labels — starts at 2 so there's always at least one tick
 * between labels even at max zoom. Pattern: 2, 3, 5, 10, 15 (matches CapCut / OpenCut).
 */
const LABEL_FRAME_INTERVALS = [2, 3, 5, 10, 15] as const;

/** Frame intervals for ticks — can go down to 1 for max granularity. */
const TICK_FRAME_INTERVALS = [1, 2, 3, 5, 10, 15] as const;

/** Second intervals when zoomed out past frame-level detail. Extends to 24h to support
 *  multi-hour timelines being zoomed out far enough to fit the viewport. */
const SECOND_MULTIPLIERS = [
  1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
  7200, 10800, 21600, 43200, 86400,
] as const;

/** Minimum pixel spacing between labels to keep them readable. */
const MIN_LABEL_SPACING_PX = 120;

/** Minimum pixel spacing between ticks (denser than labels). */
const MIN_TICK_SPACING_PX = 18;

/** Below this px spacing, skip drawing fine (non-major) canvas ticks to avoid noise (OpenCut-style). */
export const RULER_MIN_FINE_TICK_SPACING_PX = 8;

export interface RulerConfig {
  /** Time in seconds between each label */
  labelIntervalSeconds: number;
  /** Time in seconds between each tick */
  tickIntervalSeconds: number;
}

/**
 * Optimal label and tick intervals from zoom (pixels per second) and project FPS.
 * Labels and ticks scale independently: labels stay wide; ticks can be finer.
 */
export function getRulerConfig({
  pixelsPerSecond,
  fps,
}: {
  pixelsPerSecond: number;
  fps: number;
}): RulerConfig {
  const safeFps = Math.max(1, fps);
  const pixelsPerFrame = pixelsPerSecond / safeFps;

  // Prefer whole-second label steps (MM:SS timecode) before frame-based labels — matches OpenCut-style rulers.
  const labelIntervalSeconds = findOptimalLabelIntervalSeconds({
    pixelsPerFrame,
    pixelsPerSecond,
    fps: safeFps,
  });

  const rawTickIntervalSeconds = findOptimalInterval({
    pixelsPerFrame,
    pixelsPerSecond,
    fps: safeFps,
    minSpacingPx: MIN_TICK_SPACING_PX,
    frameIntervals: TICK_FRAME_INTERVALS,
  });

  const tickIntervalSeconds = ensureTickDividesLabel({
    tickIntervalSeconds: rawTickIntervalSeconds,
    labelIntervalSeconds,
    pixelsPerFrame,
    pixelsPerSecond,
    fps: safeFps,
  });

  return { labelIntervalSeconds, tickIntervalSeconds };
}

/**
 * Label interval: try second-based steps first (1s, 2s, 3s, …) for readable MM:SS,
 * then fall back to frame-based intervals when zoomed in extremely far.
 */
function findOptimalLabelIntervalSeconds({
  pixelsPerFrame,
  pixelsPerSecond,
  fps,
}: {
  pixelsPerFrame: number;
  pixelsPerSecond: number;
  fps: number;
}): number {
  for (const secondMultiplier of SECOND_MULTIPLIERS) {
    const pixelSpacing = pixelsPerSecond * secondMultiplier;
    if (pixelSpacing >= MIN_LABEL_SPACING_PX) {
      return secondMultiplier;
    }
  }

  return findOptimalInterval({
    pixelsPerFrame,
    pixelsPerSecond,
    fps,
    minSpacingPx: MIN_LABEL_SPACING_PX,
    frameIntervals: LABEL_FRAME_INTERVALS,
  });
}

/** True for the two one-third subdivisions between major labels (e.g. 1s & 2s when majors are every 3s). */
export function isRulerThirdGridTick(
  timeInSeconds: number,
  labelIntervalSeconds: number
): boolean {
  if (labelIntervalSeconds < 3 - 1e-5) return false;
  const prevMajor = Math.floor(timeInSeconds / labelIntervalSeconds) * labelIntervalSeconds;
  const offset = timeInSeconds - prevMajor;
  const a = labelIntervalSeconds / 3;
  const b = (2 * labelIntervalSeconds) / 3;
  const eps = 1e-3;
  return Math.abs(offset - a) < eps || Math.abs(offset - b) < eps;
}

function ensureTickDividesLabel({
  tickIntervalSeconds,
  labelIntervalSeconds,
  pixelsPerFrame,
  pixelsPerSecond,
  fps,
}: {
  tickIntervalSeconds: number;
  labelIntervalSeconds: number;
  pixelsPerFrame: number;
  pixelsPerSecond: number;
  fps: number;
}): number {
  const labelFrames = Math.round(labelIntervalSeconds * fps);
  const tickFrames = Math.round(tickIntervalSeconds * fps);

  if (labelFrames % tickFrames === 0) {
    return tickIntervalSeconds;
  }

  for (const candidateFrames of TICK_FRAME_INTERVALS) {
    if (labelFrames % candidateFrames === 0) {
      const candidateSpacing = pixelsPerFrame * candidateFrames;
      if (candidateSpacing >= MIN_TICK_SPACING_PX) {
        return candidateFrames / fps;
      }
    }
  }

  for (const candidateSeconds of SECOND_MULTIPLIERS) {
    const ratio = labelIntervalSeconds / candidateSeconds;
    const isDivisor = Math.abs(ratio - Math.round(ratio)) < 0.0001;
    if (isDivisor) {
      const candidateSpacing = pixelsPerSecond * candidateSeconds;
      if (candidateSpacing >= MIN_TICK_SPACING_PX) {
        return candidateSeconds;
      }
    }
  }

  return labelIntervalSeconds;
}

function findOptimalInterval({
  pixelsPerFrame,
  pixelsPerSecond,
  fps,
  minSpacingPx,
  frameIntervals,
}: {
  pixelsPerFrame: number;
  pixelsPerSecond: number;
  fps: number;
  minSpacingPx: number;
  frameIntervals: readonly number[];
}): number {
  for (const frameInterval of frameIntervals) {
    const pixelSpacing = pixelsPerFrame * frameInterval;
    if (pixelSpacing >= minSpacingPx) {
      return frameInterval / fps;
    }
  }

  for (const secondMultiplier of SECOND_MULTIPLIERS) {
    const pixelSpacing = pixelsPerSecond * secondMultiplier;
    if (pixelSpacing >= minSpacingPx) {
      return secondMultiplier;
    }
  }

  // At extreme zoom-out, no preset multiplier hits the spacing target — return the largest
  // multiplier so labels stay sparse (few overlapping ticks) instead of falling back to 60s.
  return SECOND_MULTIPLIERS[SECOND_MULTIPLIERS.length - 1] ?? 3600;
}

export function shouldShowLabel({
  time,
  labelIntervalSeconds,
}: {
  time: number;
  labelIntervalSeconds: number;
}): boolean {
  const epsilon = 0.0001;
  const remainder = time % labelIntervalSeconds;
  return remainder < epsilon || remainder > labelIntervalSeconds - epsilon;
}

/**
 * Ruler tick label: second boundaries → `MM:SS` or `H:MM:SS`; otherwise `Nf`.
 */
export function formatRulerLabel({
  timeInSeconds,
  fps,
}: {
  timeInSeconds: number;
  fps: number;
}): string {
  if (isSecondBoundary({ timeInSeconds })) {
    return formatTimestamp({ timeInSeconds });
  }

  const frameWithinSecond = getFrameWithinSecond({ timeInSeconds, fps });
  return `${frameWithinSecond}f`;
}

function isSecondBoundary({ timeInSeconds }: { timeInSeconds: number }): boolean {
  const epsilon = 0.0001;
  const remainder = timeInSeconds % 1;
  return remainder < epsilon || remainder > 1 - epsilon;
}

function getFrameWithinSecond({
  timeInSeconds,
  fps,
}: {
  timeInSeconds: number;
  fps: number;
}): number {
  const fractionalPart = timeInSeconds % 1;
  return Math.round(fractionalPart * fps);
}

/** `MM:SS`, or `H:MM:SS` when >= 1 hour (OpenCut-style, no frames in ruler). */
function formatTimestamp({ timeInSeconds }: { timeInSeconds: number }): string {
  const totalSeconds = Math.round(timeInSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');

  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }

  return `${mm}:${ss}`;
}
