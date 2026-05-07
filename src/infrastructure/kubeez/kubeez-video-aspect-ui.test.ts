import { describe, expect, it } from 'vitest';
import {
  getVideoAspectUi,
  shouldIncludeVideoAspectRatio,
  videoAspectRatioForRequest,
} from './kubeez-video-aspect-ui';

describe('getVideoAspectUi', () => {
  it('returns Veo options with Auto for text-to-video', () => {
    const ui = getVideoAspectUi('veo3-1-fast-text-to-video', { veoMode: 'text-to-video' });
    expect(ui).not.toBeNull();
    expect(ui?.force16x9).toBeUndefined();
    expect(ui?.options.map((o) => o.value)).toEqual(['16:9', '9:16', 'auto']);
    expect(ui?.defaultValue).toBe('16:9');
  });

  it('forces 16:9 for Veo reference-to-video (ctx)', () => {
    const ui = getVideoAspectUi('veo3-1-fast-text-to-video', { veoMode: 'reference-to-video' });
    expect(ui?.force16x9).toBe(true);
    expect(ui?.options).toEqual([{ value: '16:9', label: '16:9' }]);
  });

  it('forces 16:9 when model id encodes reference-to-video', () => {
    const ui = getVideoAspectUi('veo3-1-fast-reference-to-video');
    expect(ui?.force16x9).toBe(true);
    expect(ui?.options).toEqual([{ value: '16:9', label: '16:9' }]);
  });

  it('covers Veo lite ids', () => {
    const ui = getVideoAspectUi('veo3-1-lite-text-to-video');
    expect(ui?.options.map((o) => o.value)).toContain('auto');
  });

  it('excludes Kling 3 motion variants', () => {
    expect(getVideoAspectUi('kling-3-0-motion-control-720p')).toBeNull();
  });

  it('excludes Kling 2.6 motion family', () => {
    expect(getVideoAspectUi('kling-2-6-motion-control-720p')).toBeNull();
  });

  it('returns Seedance 2 full aspect options (incl. 21:9, 2:3, 3:2, adaptive) for every variant', () => {
    for (const id of [
      'seedance-2-480p',
      'seedance-2-720p',
      'seedance-2-fast-480p',
      'seedance-2-fast-720p',
      'seedance-2-720p-video-ref',
      'seedance-2-fast-720p-video-ref',
    ]) {
      const ui = getVideoAspectUi(id);
      expect(ui, id).not.toBeNull();
      expect(ui?.options.map((o) => o.value)).toEqual([
        '16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '2:3', '3:2', 'adaptive',
      ]);
      expect(ui?.defaultValue).toBe('16:9');
    }
  });

  it('returns P-Video aspect options', () => {
    const ui = getVideoAspectUi('p-video');
    expect(ui).not.toBeNull();
    expect(ui?.options.map((o) => o.value)).toEqual(['16:9', '9:16', '1:1', '4:3', '3:4']);
    expect(ui?.defaultValue).toBe('16:9');
  });
});

describe('shouldIncludeVideoAspectRatio / videoAspectRatioForRequest', () => {
  it('omits aspect for Veo Auto', () => {
    const ui = getVideoAspectUi('veo3-1-fast-text-to-video', { veoMode: 'text-to-video' })!;
    expect(shouldIncludeVideoAspectRatio(ui, 'auto')).toBe(false);
    expect(videoAspectRatioForRequest(ui, 'auto')).toBe('16:9');
  });

  it('includes explicit Veo ratio', () => {
    const ui = getVideoAspectUi('veo3-1-fast-text-to-video', { veoMode: 'text-to-video' })!;
    expect(shouldIncludeVideoAspectRatio(ui, '9:16')).toBe(true);
    expect(videoAspectRatioForRequest(ui, '9:16')).toBe('9:16');
  });

  it('always includes for reference lock', () => {
    const ui = getVideoAspectUi('veo3-1-fast-reference-to-video')!;
    expect(shouldIncludeVideoAspectRatio(ui, undefined)).toBe(true);
    expect(videoAspectRatioForRequest(ui, undefined)).toBe('16:9');
  });
});
