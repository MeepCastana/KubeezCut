/**
 * Global "out of credits" modal state.
 *
 * Lives apart from the modal component so background jobs (like
 * `kubeez-generate-job-runner`) can call `.getState().open()` from
 * non-React code paths, and the React component file stays
 * fast-refresh-friendly.
 */

import { create } from 'zustand';

interface InsufficientCreditsState {
  isOpen: boolean;
  /** Optional context line — e.g. the model the user tried to use. */
  context: string | null;
  open: (opts?: { context?: string }) => void;
  close: () => void;
}

export const useInsufficientCreditsModal = create<InsufficientCreditsState>((set) => ({
  isOpen: false,
  context: null,
  open: (opts) => set({ isOpen: true, context: opts?.context ?? null }),
  close: () => set({ isOpen: false, context: null }),
}));
