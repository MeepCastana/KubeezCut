import type { CompositionInputProps } from '@/types/export';
import type { ItemKeyframes } from '@/types/keyframe';
import type { TextItem, TimelineItem } from '@/types/timeline';
import {
  normalizeFrameRanges,
  type FrameRange,
} from '@/shared/utils/frame-invalidation';

// Timeline items / keyframes are treated as immutable refs in this codebase (Zustand pattern:
// any mutation produces a new ref). Caching the canonical form keyed on the input ref turns
// what was an O(n) per-tick string build into an O(1) lookup once the form is materialized.
const canonicalJsonCache = new WeakMap<object, string>();

/** Canonical JSON-like string for structural compare (key order–independent). */
function canonicalJsonStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  const t = typeof value;
  if (t !== 'object') {
    return JSON.stringify(value);
  }
  const obj = value as object;
  const cached = canonicalJsonCache.get(obj);
  if (cached !== undefined) {
    return cached;
  }
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((v) => canonicalJsonStringify(v)).join(',')}]`;
  } else {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    result = `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(o[k])}`).join(',')}}`;
  }
  canonicalJsonCache.set(obj, result);
  return result;
}

export function areKeyframesDataEqual(
  a: ItemKeyframes[] | undefined,
  b: ItemKeyframes[] | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  const aArr = a ?? [];
  const bArr = b ?? [];
  if (aArr.length !== bArr.length) {
    return false;
  }
  const byId = new Map(bArr.map((ik) => [ik.itemId, ik]));
  if (byId.size !== bArr.length) {
    return false;
  }
  for (const ik of aArr) {
    const other = byId.get(ik.itemId);
    if (!other) {
      return false;
    }
    // Shared ref => guaranteed equal; skip the serialize-and-compare entirely.
    if (ik === other) {
      continue;
    }
    if (canonicalJsonStringify(ik) !== canonicalJsonStringify(other)) {
      return false;
    }
  }
  return true;
}

/** True when every timeline item id maps to the same object reference in both track lists. */
export function areTrackTimelineItemRefsEqual(
  a: CompositionInputProps['tracks'],
  b: CompositionInputProps['tracks'],
): boolean {
  const am = indexItemsById(a);
  const bm = indexItemsById(b);
  if (am.size !== bm.size) {
    return false;
  }
  for (const [id, item] of am) {
    if (bm.get(id) !== item) {
      return false;
    }
  }
  return true;
}

function indexItemsById(tracks: CompositionInputProps['tracks']): Map<string, TimelineItem> {
  const itemsById = new Map<string, TimelineItem>();
  for (const track of tracks) {
    for (const item of track.items as TimelineItem[]) {
      itemsById.set(item.id, item);
    }
  }
  return itemsById;
}

function indexKeyframesByItemId(keyframes: ItemKeyframes[] | undefined): Map<string, ItemKeyframes> {
  if (!keyframes || keyframes.length === 0) return new Map();
  return new Map(keyframes.map((entry) => [entry.itemId, entry]));
}

function getItemFrameRange(item: TimelineItem | undefined): FrameRange | null {
  if (!item) return null;
  const startFrame = Math.trunc(item.from);
  const endFrame = Math.trunc(item.from + item.durationInFrames);
  if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame) || endFrame <= startFrame) {
    return null;
  }
  return { startFrame, endFrame };
}

export function collectVisualInvalidationRanges({
  previousTracks,
  nextTracks,
  previousKeyframes,
  nextKeyframes,
}: {
  previousTracks: CompositionInputProps['tracks'];
  nextTracks: CompositionInputProps['tracks'];
  previousKeyframes?: ItemKeyframes[];
  nextKeyframes?: ItemKeyframes[];
}): FrameRange[] {
  if (previousTracks === nextTracks && previousKeyframes === nextKeyframes) {
    return [];
  }

  const previousItemsById = indexItemsById(previousTracks);
  const nextItemsById = indexItemsById(nextTracks);
  const previousKeyframesByItemId = indexKeyframesByItemId(previousKeyframes);
  const nextKeyframesByItemId = indexKeyframesByItemId(nextKeyframes);
  const changedItemIds = new Set<string>();

  for (const [itemId, previousItem] of previousItemsById) {
    if (nextItemsById.get(itemId) !== previousItem) {
      changedItemIds.add(itemId);
    }
  }
  for (const [itemId, nextItem] of nextItemsById) {
    if (previousItemsById.get(itemId) !== nextItem) {
      changedItemIds.add(itemId);
    }
  }
  for (const [itemId, previousKeyframe] of previousKeyframesByItemId) {
    if (nextKeyframesByItemId.get(itemId) !== previousKeyframe) {
      changedItemIds.add(itemId);
    }
  }
  for (const [itemId, nextKeyframe] of nextKeyframesByItemId) {
    if (previousKeyframesByItemId.get(itemId) !== nextKeyframe) {
      changedItemIds.add(itemId);
    }
  }

  const ranges: FrameRange[] = [];
  for (const itemId of changedItemIds) {
    const previousRange = getItemFrameRange(previousItemsById.get(itemId));
    if (previousRange) {
      ranges.push(previousRange);
    }
    const nextRange = getItemFrameRange(nextItemsById.get(itemId));
    if (nextRange) {
      ranges.push(nextRange);
    }
  }

  return normalizeFrameRanges(ranges);
}

/** Treat empty optional arrays like “unset” so `{}` and `{ effects: [] }` compare equal. */
function normalizeSparseTimelineRest(rest: Record<string, unknown>): Record<string, unknown> {
  const o = { ...rest };
  for (const key of ['effects', 'waveformData'] as const) {
    const v = o[key];
    if (Array.isArray(v) && v.length === 0) {
      delete o[key];
    }
  }
  return o;
}

function stripTextContentFields(item: TextItem): Record<string, unknown> {
  const { text, label, ...rest } = item;
  void text;
  void label;
  return normalizeSparseTimelineRest(rest as Record<string, unknown>);
}

function textItemStructureEqualsIgnoringTextAndLabel(a: TextItem, b: TextItem): boolean {
  return canonicalJsonStringify(stripTextContentFields(a)) === canonicalJsonStringify(stripTextContentFields(b));
}

export type TextContentOnlyInvalidationDiag =
  | { ok: true }
  | {
    ok: false;
    reason: 'same_refs' | 'keyframes_mismatch' | 'no_item_ref_change' | 'item_added_or_removed'
      | 'non_text_item' | 'text_body_mismatch_other_fields';
  };

function diagnoseTextContentOnlyInvalidation(
  previousTracks: CompositionInputProps['tracks'],
  nextTracks: CompositionInputProps['tracks'],
  previousKeyframes: ItemKeyframes[] | undefined,
  nextKeyframes: ItemKeyframes[] | undefined,
): TextContentOnlyInvalidationDiag {
  if (previousTracks === nextTracks && previousKeyframes === nextKeyframes) {
    return { ok: false, reason: 'same_refs' };
  }

  const previousItemsById = indexItemsById(previousTracks);
  const nextItemsById = indexItemsById(nextTracks);

  if (!areKeyframesDataEqual(previousKeyframes, nextKeyframes)) {
    return { ok: false, reason: 'keyframes_mismatch' };
  }

  const changedItemIds = new Set<string>();
  for (const [itemId, previousItem] of previousItemsById) {
    if (nextItemsById.get(itemId) !== previousItem) {
      changedItemIds.add(itemId);
    }
  }
  for (const [itemId, nextItem] of nextItemsById) {
    if (previousItemsById.get(itemId) !== nextItem) {
      changedItemIds.add(itemId);
    }
  }

  if (changedItemIds.size === 0) {
    return { ok: false, reason: 'no_item_ref_change' };
  }

  for (const itemId of changedItemIds) {
    const prevItem = previousItemsById.get(itemId);
    const nextItem = nextItemsById.get(itemId);
    if (!prevItem || !nextItem) {
      return { ok: false, reason: 'item_added_or_removed' };
    }
    if (prevItem.type !== 'text' || nextItem.type !== 'text') {
      return { ok: false, reason: 'non_text_item' };
    }
    if (!textItemStructureEqualsIgnoringTextAndLabel(prevItem, nextItem)) {
      return { ok: false, reason: 'text_body_mismatch_other_fields' };
    }
  }

  return { ok: true };
}

/**
 * True when the only visual deltas are text clips whose `text` / `label` changed (typing in the
 * inspector). Used to skip the fast-scrub resume pump — it synchronously toggles overlay React
 * state and can exceed max update depth when keyed at high frequency.
 */
export function isTextContentOnlyInvalidation(
  previousTracks: CompositionInputProps['tracks'],
  nextTracks: CompositionInputProps['tracks'],
  previousKeyframes: ItemKeyframes[] | undefined,
  nextKeyframes: ItemKeyframes[] | undefined,
): boolean {
  return diagnoseTextContentOnlyInvalidation(
    previousTracks,
    nextTracks,
    previousKeyframes,
    nextKeyframes,
  ).ok;
}

/** For debug instrumentation: why we did or did not treat this update as text-only typing. */
export function getTextContentOnlyInvalidationDiag(
  previousTracks: CompositionInputProps['tracks'],
  nextTracks: CompositionInputProps['tracks'],
  previousKeyframes: ItemKeyframes[] | undefined,
  nextKeyframes: ItemKeyframes[] | undefined,
): TextContentOnlyInvalidationDiag {
  return diagnoseTextContentOnlyInvalidation(
    previousTracks,
    nextTracks,
    previousKeyframes,
    nextKeyframes,
  );
}
