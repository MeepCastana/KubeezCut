import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getAudioTargetTimeSeconds } from '../utils/video-timing';
import {
  getOrDecodeAudio,
  getOrDecodeAudioForPlayback,
  isPreviewAudioDecodePending,
} from '../utils/audio-decode-cache';
import { createLogger } from '@/shared/logging/logger';
import type { AudioPlaybackProps } from './audio-playback-props';
import { useAudioPlaybackState } from './hooks/use-audio-playback-state';
import { getOrEnhanceAudio } from '../deps/audio-enhance';
import { useTimelineStore } from '../deps/stores';
import { useClock } from '@/features/composition-runtime/deps/player';

const log = createLogger('CustomDecoderBufferedAudio');
const GAIN_RAMP_SECONDS = 0.008;
const STOP_GRACE_SECONDS = 0.002;
const PARTIAL_BUFFER_HEADROOM_SECONDS = 0.25;
const DRIFT_RESYNC_MIN_ELAPSED_SECONDS = 1.0;
const DRIFT_RESYNC_POSITIVE_THRESHOLD_SECONDS = 1.25;
const DRIFT_RESYNC_NEGATIVE_THRESHOLD_SECONDS = -0.75;
const BACKGROUND_RESYNC_GRACE_MS = 250;
const WAIT_FOR_FULL_DECODE_BEFORE_PLAYBACK = true;

let sharedCtx: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  const Ctor = window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  if (sharedCtx === null || sharedCtx.state === 'closed') {
    sharedCtx = new Ctor();
  }
  return sharedCtx;
}

interface CustomDecoderBufferedAudioProps extends AudioPlaybackProps {
  src: string;
  mediaId: string;
}

export const CustomDecoderBufferedAudio: React.FC<CustomDecoderBufferedAudioProps> = React.memo(({
  src,
  mediaId,
  itemId,
  trimBefore = 0,
  sourceFps,
  volume = 0,
  playbackRate = 1,
  muted = false,
  durationInFrames,
  audioFadeIn = 0,
  audioFadeOut = 0,
  audioFadeInCurve = 0,
  audioFadeOutCurve = 0,
  audioFadeInCurveX = 0.52,
  audioFadeOutCurveX = 0.52,
  clipFadeSpans,
  contentStartOffsetFrames = 0,
  contentEndOffsetFrames = 0,
  fadeInDelayFrames = 0,
  fadeOutLeadFrames = 0,
  crossfadeFadeIn,
  crossfadeFadeOut,
  liveGainItemIds,
  volumeMultiplier = 1,
}) => {
  // Read enhance settings directly from the items store so we don't have to
  // thread them through the audio-scene segment plumbing. Item identity is
  // stable per segment, and audioEnhance object identity is stable until the
  // user actually toggles or edits it.
  const audioEnhance = useTimelineStore(
    useCallback((s) => s.items.find((i) => i.id === itemId)?.audioEnhance, [itemId]),
  );
  const enhanceEnabled = audioEnhance?.enabled === true;
  const enhanceKey = enhanceEnabled
    ? JSON.stringify({
        M: audioEnhance?.model ?? 'rnnoise',
        d: audioEnhance?.denoise ?? true,
        a: audioEnhance?.aggressive ?? false,
        h: audioEnhance?.highPass ?? true,
        n: audioEnhance?.hum ?? 'off',
        e: audioEnhance?.deEss ?? false,
        v: audioEnhance?.voiceEq ?? false,
        c: audioEnhance?.compress ?? true,
        m: audioEnhance?.normalize ?? true,
      })
    : '';
  const { frame, fps, playing, resolvedVolume: audioVolume } = useAudioPlaybackState({
    itemId,
    liveGainItemIds,
    volume,
    muted,
    durationInFrames,
    audioFadeIn,
    audioFadeOut,
    audioFadeInCurve,
    audioFadeOutCurve,
    audioFadeInCurveX,
    audioFadeOutCurveX,
    clipFadeSpans,
    contentStartOffsetFrames,
    contentEndOffsetFrames,
    fadeInDelayFrames,
    fadeOutLeadFrames,
    crossfadeFadeIn,
    crossfadeFadeOut,
    volumeMultiplier,
  });

  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  // Bumped on every Clock 'seek' event so the playback effect can force a
  // re-sync regardless of frame-delta size. Without this, small playhead
  // clicks (< frameSeekJumpThreshold ≈ 0.5s) leave the buffered source
  // playing from the old offset — audio appears to "pause" at the click.
  const [seekEpoch, setSeekEpoch] = useState<number>(0);

  const clock = useClock();

  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioVolumeRef = useRef<number>(audioVolume);
  const startRequestIdRef = useRef<number>(0);
  const lastObservedFrameRef = useRef<number>(frame);
  const lastSeekEpochRef = useRef<number>(seekEpoch);
  const wasBackgroundedRef = useRef<boolean>(false);
  const backgroundResyncGraceUntilRef = useRef<number>(0);

  const lastSyncContextTimeRef = useRef<number>(0);
  const lastStartOffsetRef = useRef<number>(0);
  const lastStartRateRef = useRef<number>(playbackRate);
  const needsInitialSyncRef = useRef<boolean>(true);

  useEffect(() => {
    const onSeek = () => setSeekEpoch((e) => e + 1);
    clock.addEventListener('seek', onSeek);
    return () => clock.removeEventListener('seek', onSeek);
  }, [clock]);

  useEffect(() => {
    if (!mediaId || !src) return;

    let cancelled = false;

    // When audio-enhance is enabled, fetch (or kick off) the enhanced buffer.
    // While it processes, fall through to the raw buffer so playback isn't
    // silenced — the enhanced one swaps in via the second .then() below.
    if (enhanceEnabled && audioEnhance) {
      getOrEnhanceAudio(mediaId, src, audioEnhance)
        .then((buffer) => {
          if (!cancelled) {
            setAudioBuffer((current) => {
              // Only swap if we don't already have this enhanced buffer.
              if (current === buffer) return current;
              return buffer;
            });
            log.info('Enhanced audio ready', {
              mediaId,
              duration: buffer.duration.toFixed(2),
              sampleRate: buffer.sampleRate,
              channels: buffer.numberOfChannels,
            });
          }
        })
        .catch((err) => {
          if (!cancelled) {
            log.warn('Enhance failed, falling back to raw audio', { mediaId, err });
          }
        });
      // Continue to raw decode below so we always show *something* during processing.
    }

    if (WAIT_FOR_FULL_DECODE_BEFORE_PLAYBACK) {
      getOrDecodeAudio(mediaId, src)
        .then((buffer) => {
          if (!cancelled) {
            // Only set raw buffer if enhanced isn't already applied. We compare
            // by sample-rate: enhanced is 48 kHz, preview cache is 22 kHz.
            setAudioBuffer((current) => {
              if (current && current.sampleRate >= 48000 && enhanceEnabled) {
                return current;
              }
              return buffer;
            });
            log.info('Full buffered audio ready', {
              mediaId,
              duration: buffer.duration.toFixed(2),
              sampleRate: buffer.sampleRate,
              channels: buffer.numberOfChannels,
            });
          }
        })
        .catch((err) => {
          if (!cancelled) {
            log.error('Failed to decode buffered audio', { mediaId, err });
          }
        });
    } else {
      // Legacy low-latency path: start from partial bins, then upgrade to full decode.
      getOrDecodeAudioForPlayback(mediaId, src, {
        minReadySeconds: 8,
        waitTimeoutMs: 6000,
      })
        .then((buffer) => {
          if (!cancelled) {
            setAudioBuffer(buffer);
            log.info('Initial buffered audio ready', {
              mediaId,
              duration: buffer.duration.toFixed(2),
              sampleRate: buffer.sampleRate,
              channels: buffer.numberOfChannels,
            });
          }
        })
        .catch((err) => {
          if (!cancelled) {
            log.error('Failed to decode buffered audio', { mediaId, err });
          }
        });

      // Upgrade to full decoded buffer when background decode/reassembly completes.
      getOrDecodeAudio(mediaId, src)
        .then((buffer) => {
          if (!cancelled) {
            setAudioBuffer((current) => {
              if (current && current.length === buffer.length && current.sampleRate === buffer.sampleRate) {
                return current;
              }
              return buffer;
            });
          }
        })
        .catch((err) => {
          if (!cancelled) {
            log.error('Failed to finalize buffered audio decode', { mediaId, err });
          }
        });
    }

    return () => { cancelled = true; };
    // `audioEnhance` is read inside but not in deps — its identity changes on
    // intensity edits (play-time), but only `enhanceKey` (bake-time fields)
    // actually invalidates the cached buffer.
  }, [mediaId, src, enhanceEnabled, enhanceKey]);

  useEffect(() => {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    gainNodeRef.current = gain;

    return () => {
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch { /* already stopped */ }
        sourceRef.current.disconnect();
        sourceRef.current = null;
      }
      gain.disconnect();
      gainNodeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const resume = () => {
      const ctx = getSharedAudioContext();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
    };

    window.addEventListener('pointerdown', resume, { capture: true });
    window.addEventListener('keydown', resume, { capture: true });

    return () => {
      window.removeEventListener('pointerdown', resume, { capture: true });
      window.removeEventListener('keydown', resume, { capture: true });
    };
  }, []);

  useEffect(() => {
    const markBackgrounded = () => {
      backgroundResyncGraceUntilRef.current = 0;
      wasBackgroundedRef.current = true;
    };
    const markForegrounded = () => {
      if (!wasBackgroundedRef.current) return;
      backgroundResyncGraceUntilRef.current = performance.now() + BACKGROUND_RESYNC_GRACE_MS;
      const ctx = getSharedAudioContext();
      if (ctx?.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        markBackgrounded();
      } else {
        markForegrounded();
      }
    };

    const handleWindowBlur = () => {
      if (document.hidden) return;
      markBackgrounded();
    };
    const handleWindowFocus = () => {
      markForegrounded();
    };
    const handlePageHide = () => {
      markBackgrounded();
    };
    const handlePageShow = () => {
      markForegrounded();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  useEffect(() => {
    const ctx = getSharedAudioContext();
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    const safeVolume = Number.isFinite(audioVolume) ? Math.max(0, audioVolume) : 0;
    audioVolumeRef.current = safeVolume;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(safeVolume, now + GAIN_RAMP_SECONDS);
  }, [audioVolume]);

  const stopSource = useCallback((fadeOut: boolean = true) => {
    startRequestIdRef.current += 1;

    const source = sourceRef.current;
    if (!source) return;
    sourceRef.current = null;

    const ctx = getSharedAudioContext();
    const gain = gainNodeRef.current;

    if (fadeOut && ctx && gain) {
      const now = ctx.currentTime;
      const stopAt = now + GAIN_RAMP_SECONDS;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, stopAt);
      try {
        source.stop(stopAt + STOP_GRACE_SECONDS);
      } catch {
        try { source.stop(); } catch { /* already stopped */ }
      }
      return;
    }

    try { source.stop(); } catch { /* already stopped */ }
  }, []);

  useEffect(() => {
    if (!audioBuffer) return;

    const ctx = getSharedAudioContext();
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    const isPremounted = frame < 0;
    const effectiveSourceFps = sourceFps ?? fps;
    // IMPORTANT: trimBefore is in source FPS frames â€” must use effectiveSourceFps, not fps
    const targetTime = getAudioTargetTimeSeconds(trimBefore, effectiveSourceFps, frame, playbackRate, fps);
    const frameDelta = frame - lastObservedFrameRef.current;
    lastObservedFrameRef.current = frame;
    const seekEpochChanged = seekEpoch !== lastSeekEpochRef.current;
    lastSeekEpochRef.current = seekEpoch;
    const frameSeekJumpThreshold = Math.max(8, Math.round(fps * 0.5));
    const isBackgrounded =
      document.hidden
      || (typeof document.hasFocus === 'function' && !document.hasFocus());
    const backgroundGraceActive = performance.now() < backgroundResyncGraceUntilRef.current;
    const shouldIgnoreBackgroundResync = isBackgrounded || backgroundGraceActive;

    if (isPremounted) {
      stopSource(false);
      needsInitialSyncRef.current = true;
      return;
    }

    if (playing) {
      let shouldStart = false;
      let startReason: string = '';
      const currentSource = sourceRef.current;

      if (needsInitialSyncRef.current) {
        shouldStart = true;
        startReason = 'initial-sync';
      } else if (!currentSource) {
        shouldStart = true;
        startReason = 'no-current-source';
      } else if (Math.abs(playbackRate - lastStartRateRef.current) > 0.0001) {
        shouldStart = true;
        startReason = 'rate-change';
      } else if (seekEpochChanged) {
        // Clock emitted a 'seek' event — user-initiated seek, regardless of
        // distance. Always re-sync. Without this branch, sub-threshold clicks
        // (e.g. clicking 0.3s ahead) leave the buffer source playing from the
        // old offset and audio appears stuck at the previous position.
        shouldStart = true;
        startReason = 'clock-seek';
        log.info('Audio re-sync triggered by clock seek event', {
          mediaId,
          frameDelta,
          targetTimeSec: targetTime.toFixed(3),
          bufferDurationSec: audioBuffer.duration.toFixed(3),
          decodePending: isPreviewAudioDecodePending(mediaId),
          ctxState: ctx.state,
        });
      } else if (!shouldIgnoreBackgroundResync && Math.abs(frameDelta) > frameSeekJumpThreshold) {
        // Treat large frame jumps as explicit seeks and re-sync immediately.
        shouldStart = true;
        startReason = 'frame-jump';
        log.info('Audio re-sync triggered by playhead jump', {
          mediaId,
          frameDelta,
          frameSeekJumpThreshold,
          targetTimeSec: targetTime.toFixed(3),
          bufferDurationSec: audioBuffer.duration.toFixed(3),
          decodePending: isPreviewAudioDecodePending(mediaId),
          ctxState: ctx.state,
        });
      } else if (currentSource.buffer !== audioBuffer) {
        // Buffer changed (partial -> full). Avoid immediate restart thrash;
        // only re-sync if current source is close to running out.
        const sourceDuration = currentSource.buffer?.duration ?? 0;
        const remainingCoverage = sourceDuration - targetTime;
        if (remainingCoverage <= PARTIAL_BUFFER_HEADROOM_SECONDS) {
          shouldStart = true;
          startReason = 'buffer-upgrade';
        }
      } else {
        // While decode is pending, avoid drift-driven seeks because frame cadence
        // can be jittery during warm-up and causes audible restart clicks.
        if (!shouldIgnoreBackgroundResync && !isPreviewAudioDecodePending(mediaId)) {
          const elapsedSec = ctx.currentTime - lastSyncContextTimeRef.current;
          const estimatedPosition = lastStartOffsetRef.current + elapsedSec * lastStartRateRef.current;
          const drift = estimatedPosition - targetTime;

          if (
            elapsedSec > DRIFT_RESYNC_MIN_ELAPSED_SECONDS
            && (drift > DRIFT_RESYNC_POSITIVE_THRESHOLD_SECONDS || drift < DRIFT_RESYNC_NEGATIVE_THRESHOLD_SECONDS)
          ) {
            shouldStart = true;
            startReason = 'drift-resync';
          }
        }
      }

      if (shouldStart) {
        const decisionWallMs = performance.now();
        // If we only have a partial decode and timeline position is beyond its duration,
        // wait for more bins/full decode instead of repeatedly starting at partial tail.
        if (targetTime >= audioBuffer.duration - PARTIAL_BUFFER_HEADROOM_SECONDS && isPreviewAudioDecodePending(mediaId)) {
          log.info('Audio start aborted — target past partial-buffer tail, decode still pending', {
            mediaId,
            startReason,
            targetTimeSec: targetTime.toFixed(3),
            bufferDurationSec: audioBuffer.duration.toFixed(3),
            headroomSec: PARTIAL_BUFFER_HEADROOM_SECONDS,
          });
          stopSource();
          return;
        }

        stopSource();
        const startRequestId = ++startRequestIdRef.current;

        const ctxResumeNeeded = ctx.state === 'suspended';
        const resumePromise = ctxResumeNeeded ? ctx.resume() : Promise.resolve();
        resumePromise.then(() => {
          if (startRequestId !== startRequestIdRef.current) return;

          const liveGain = gainNodeRef.current;
          if (ctx.state !== 'running' || !liveGain) return;

          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.playbackRate.value = playbackRate;
          source.connect(liveGain);
          source.onended = () => {
            source.disconnect();
            if (sourceRef.current === source) {
              sourceRef.current = null;
            }
          };

          const clampedOffset = Math.max(0, Math.min(targetTime, audioBuffer.duration - 0.01));
          const startAt = ctx.currentTime;
          const startVolume = Math.max(0, audioVolumeRef.current);
          liveGain.gain.cancelScheduledValues(startAt);
          liveGain.gain.setValueAtTime(0, startAt);
          liveGain.gain.linearRampToValueAtTime(startVolume, startAt + GAIN_RAMP_SECONDS);

          source.start(startAt, clampedOffset);
          sourceRef.current = source;

          lastSyncContextTimeRef.current = startAt;
          lastStartOffsetRef.current = clampedOffset;
          lastStartRateRef.current = playbackRate;
          needsInitialSyncRef.current = false;

          const totalLatencyMs = performance.now() - decisionWallMs;
          if (startReason === 'frame-jump' || totalLatencyMs > 20) {
            log.info('Audio source started', {
              mediaId,
              startReason,
              ctxResumeNeeded,
              decisionToStartLatencyMs: totalLatencyMs.toFixed(1),
              clampedOffsetSec: clampedOffset.toFixed(3),
              gainRampMs: (GAIN_RAMP_SECONDS * 1000).toFixed(1),
              ctxBaseLatencySec: typeof ctx.baseLatency === 'number' ? ctx.baseLatency.toFixed(4) : 'n/a',
              ctxOutputLatencySec: typeof ctx.outputLatency === 'number' ? ctx.outputLatency.toFixed(4) : 'n/a',
            });
          }
        }).catch((err) => {
          log.warn('Failed to resume/start buffered custom decoder audio context', {
            mediaId,
            err,
          });
        });
      }
    } else {
      stopSource();
      needsInitialSyncRef.current = true;
    }

    if (!isBackgrounded && !backgroundGraceActive && wasBackgroundedRef.current) {
      wasBackgroundedRef.current = false;
    }
  }, [frame, fps, playing, playbackRate, trimBefore, audioBuffer, mediaId, sourceFps, seekEpoch, stopSource]);

  return null;
});
