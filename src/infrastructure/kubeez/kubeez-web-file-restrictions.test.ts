/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { getFileLimitForModel, getMaxFileSizeForModel, MAX_FILE_SIZE, MAX_INPUT_FILE_SIZE } from './kubeez-web-file-restrictions';
import {
  documentedMaxReferenceFilesForModelId,
  effectiveMaxReferenceFilesForGenerateDialog,
} from './kubeez-documented-reference-limits';

describe('kubeez-web-file-restrictions (KubeezWebsite parity)', () => {
  it('Veo 3.1 variant ids: 1 / 2 / 3 caps from generation type', () => {
    expect(getFileLimitForModel('veo3-1-fast-text-to-video', 'TEXT_2_VIDEO').maxFiles).toBe(1);
    expect(getFileLimitForModel('veo3-1-fast-reference-to-video', 'REFERENCE_2_VIDEO').maxFiles).toBe(3);
    expect(getFileLimitForModel('veo3-1-fast-first-and-last-frames', 'FIRST_AND_LAST_FRAMES_2_VIDEO').maxFiles).toBe(
      2
    );
    expect(getFileLimitForModel('veo3-1-lite-text-to-video', 'TEXT_2_VIDEO').maxFiles).toBe(1);
    expect(getFileLimitForModel('veo3-1-lite-first-and-last-frames', 'FIRST_AND_LAST_FRAMES_2_VIDEO').maxFiles).toBe(2);
  });

  it('Kling 3.0 std/pro: default 1; IMAGE_2_VIDEO 2', () => {
    expect(getFileLimitForModel('kling-3-0-std', undefined).maxFiles).toBe(1);
    expect(getFileLimitForModel('kling-3-0-std', 'IMAGE_2_VIDEO').maxFiles).toBe(2);
    expect(getFileLimitForModel('kling-3-0-pro', 'TEXT_2_VIDEO').maxFiles).toBe(1);
  });

  it('Kling 2.6 T2V: 0 refs; I2V: 1', () => {
    expect(getFileLimitForModel('kling-2-6-text-to-video-5s', 'TEXT_2_VIDEO').maxFiles).toBe(0);
    expect(getFileLimitForModel('kling-2-6-image-to-video-5s', 'IMAGE_2_VIDEO').maxFiles).toBe(1);
  });

  it('getMaxFileSizeForModel: motion control video 100MB cap', () => {
    expect(getMaxFileSizeForModel('kling-3-0-motion-control-720p', 'video/mp4')).toBe(100 * 1024 * 1024);
    expect(getMaxFileSizeForModel('kling-3-0-motion-control-720p', 'image/jpeg')).toBe(MAX_FILE_SIZE);
  });

  it('effective per-model cap min with input ceiling', () => {
    expect(Math.min(getMaxFileSizeForModel('kling-3-0-motion-control-720p', 'video/mp4'), MAX_INPUT_FILE_SIZE)).toBe(
      MAX_INPUT_FILE_SIZE
    );
  });
});

describe('documentedMaxReferenceFilesForModelId (concrete id inference)', () => {
  it('infers Veo modes from id suffix', () => {
    expect(documentedMaxReferenceFilesForModelId('veo3-1-fast-text-to-video')).toBe(1);
    expect(documentedMaxReferenceFilesForModelId('veo3-1-fast-reference-to-video')).toBe(3);
    expect(documentedMaxReferenceFilesForModelId('veo3-1-fast-first-and-last-frames')).toBe(2);
    expect(documentedMaxReferenceFilesForModelId('veo3-1-lite-text-to-video')).toBe(1);
  });

  it('Seedance default branch is 1 when generation type unknown from id', () => {
    expect(documentedMaxReferenceFilesForModelId('seedance-1-5-pro-720p-8s')).toBe(1);
  });

  it('returns undefined when website has no finite cap', () => {
    expect(documentedMaxReferenceFilesForModelId('unknown-model-xyz-123')).toBeUndefined();
  });
});

describe('effectiveMaxReferenceFilesForGenerateDialog', () => {
  it('falls back to REST legacy when web has no cap (z-image → 0)', () => {
    expect(
      effectiveMaxReferenceFilesForGenerateDialog(
        { model_id: 'z-image', maxReferenceFiles: 99 },
        {
          resolvedModelId: 'z-image',
          baseCardId: 'z-image',
          settings: {},
        }
      )
    ).toBe(0);
  });

  it('uses UI settings for Veo mode (reference vs text)', () => {
    expect(
      effectiveMaxReferenceFilesForGenerateDialog(
        { model_id: 'veo3-1-fast-text-to-video', maxReferenceFiles: 99 },
        {
          resolvedModelId: 'veo3-1-fast-reference-to-video',
          baseCardId: 'veo3-1',
          settings: {
            veo31: { tier: 'fast', mode: 'reference-to-video' },
          },
        }
      )
    ).toBe(3);
    expect(
      effectiveMaxReferenceFilesForGenerateDialog(
        { model_id: 'veo3-1-fast-text-to-video', maxReferenceFiles: 99 },
        {
          resolvedModelId: 'veo3-1-fast-text-to-video',
          baseCardId: 'veo3-1',
          settings: {
            veo31: { tier: 'fast', mode: 'text-to-video' },
          },
        }
      )
    ).toBe(1);
  });
});
