import { ZOOM_MAX, ZOOM_MIN } from '../constants';

export const TIMELINE_ZOOM_TO_FIT_RIGHT_PADDING_PX = 50;

const TIMELINE_RIGHT_SCROLL_ROOM_MIN_PX = 240;
const TIMELINE_RIGHT_SCROLL_ROOM_MAX_PX = 480;
const TIMELINE_RIGHT_SCROLL_ROOM_VIEWPORT_RATIO = 0.35;

interface TimelineWidthInput {
  contentWidth: number;
  viewportWidth: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Floor for short/empty projects so fit doesn't crank zoom up to a useless extreme. */
const ZOOM_TO_FIT_MIN_SECONDS = 10;

interface ZoomToFitOptions {
  /** Cap the framed duration (seconds). Use only for the initial-load fit; omit to fit all content. */
  maxDurationSeconds?: number;
}

export function getZoomToFitLevel(
  containerWidth: number,
  contentDurationSeconds: number,
  options: ZoomToFitOptions = {}
): number {
  const floored = Math.max(ZOOM_TO_FIT_MIN_SECONDS, contentDurationSeconds);
  const duration = options.maxDurationSeconds !== undefined
    ? Math.min(options.maxDurationSeconds, floored)
    : floored;
  const targetWidth = Math.max(0, containerWidth - TIMELINE_ZOOM_TO_FIT_RIGHT_PADDING_PX);
  return clamp(targetWidth / (duration * 100), ZOOM_MIN, ZOOM_MAX);
}

export function getTimelineRightScrollRoom(viewportWidth: number): number {
  if (viewportWidth <= 0) {
    return TIMELINE_RIGHT_SCROLL_ROOM_MIN_PX;
  }

  return clamp(
    viewportWidth * TIMELINE_RIGHT_SCROLL_ROOM_VIEWPORT_RATIO,
    TIMELINE_RIGHT_SCROLL_ROOM_MIN_PX,
    TIMELINE_RIGHT_SCROLL_ROOM_MAX_PX
  );
}

export function getTimelineWidth({ contentWidth, viewportWidth }: TimelineWidthInput): number {
  if (viewportWidth <= 0) {
    return Math.max(0, contentWidth);
  }

  // When content already fits in the viewport, do not add trailing scroll room — avoids a redundant
  // horizontal scrollbar for typical 0–30s edits. Extra room only applies once content exceeds width.
  if (contentWidth <= viewportWidth) {
    return viewportWidth;
  }

  return Math.max(viewportWidth, contentWidth + getTimelineRightScrollRoom(viewportWidth));
}
