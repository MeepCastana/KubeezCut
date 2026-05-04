import { describe, expect, it } from 'vitest';

import { getTimelineWidth, getZoomToFitLevel } from './timeline-layout';

describe('timeline layout helpers', () => {
  it('keeps zoom-to-fit framing unchanged', () => {
    expect(getZoomToFitLevel(1000, 10)).toBeCloseTo(0.95);
  });

  it('fits all content by default so long timelines do not need a horizontal scrollbar', () => {
    // 1000px viewport - 50px right padding = 950 / (120s * 100) = 0.0791...
    expect(getZoomToFitLevel(1000, 120)).toBeCloseTo(950 / (120 * 100));
  });

  it('honors maxDurationSeconds for the initial-load fit', () => {
    expect(getZoomToFitLevel(1000, 120, { maxDurationSeconds: 30 })).toBeCloseTo(
      getZoomToFitLevel(1000, 30)
    );
  });

  it('does not add trailing scroll room when content already fits the viewport', () => {
    expect(getTimelineWidth({ contentWidth: 950, viewportWidth: 1000 })).toBe(1000);
  });

  it('preserves the same tail room when content already exceeds the viewport', () => {
    expect(getTimelineWidth({ contentWidth: 1500, viewportWidth: 1000 })).toBe(1850);
  });
});
