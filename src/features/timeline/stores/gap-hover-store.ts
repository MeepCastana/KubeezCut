import { create } from 'zustand';

export interface ActiveGapHover {
  /** Tracks the ghost should appear on (origin track + linked-counterpart tracks). */
  trackIds: string[];
  /** Gap start frame (inclusive). */
  gapStart: number;
  /** Gap end frame (exclusive — i.e. the `from` of the next clip). */
  gapEnd: number;
  /** The track currently under the mouse cursor — used to scope leave events. */
  hoveredTrackId: string;
}

interface GapHoverState {
  active: ActiveGapHover | null;
  setActive: (active: ActiveGapHover | null) => void;
  /** Clear only if the currently-active hover originated from `trackId`. */
  clearForTrack: (trackId: string) => void;
}

export const useGapHoverStore = create<GapHoverState>((set, get) => ({
  active: null,
  setActive: (active) => set({ active }),
  clearForTrack: (trackId) => {
    if (get().active?.hoveredTrackId === trackId) {
      set({ active: null });
    }
  },
}));
