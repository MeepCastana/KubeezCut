/**
 * Tracks in-flight enhance jobs by mediaId for spinner / progress UI.
 *
 * Keyed by `mediaId:settingsHash` — multiple items sharing the same media+settings
 * see one job's progress. Errors are kept until cleared so users can retry.
 */

import { create } from 'zustand';

export interface EnhanceJobState {
  mediaId: string;
  settingsHash: string;
  progress: number;        // 0..1
  startedAt: number;
  lastError?: string;
}

interface EnhanceJobsStore {
  jobs: Record<string, EnhanceJobState>;
  errors: Record<string, string>;
  startJob(mediaId: string, settingsHash: string): void;
  setProgress(mediaId: string, settingsHash: string, progress: number): void;
  finishJob(mediaId: string, settingsHash: string): void;
  failJob(mediaId: string, settingsHash: string, error: string): void;
  clearError(mediaId: string, settingsHash: string): void;
}

function jobKey(mediaId: string, settingsHash: string): string {
  return `${mediaId}:${settingsHash}`;
}

export const useEnhanceJobsStore = create<EnhanceJobsStore>((set) => ({
  jobs: {},
  errors: {},

  startJob: (mediaId, settingsHash) =>
    set((state) => {
      const key = jobKey(mediaId, settingsHash);
      const errors = { ...state.errors };
      delete errors[key];
      return {
        jobs: {
          ...state.jobs,
          [key]: { mediaId, settingsHash, progress: 0, startedAt: Date.now() },
        },
        errors,
      };
    }),

  setProgress: (mediaId, settingsHash, progress) =>
    set((state) => {
      const key = jobKey(mediaId, settingsHash);
      const existing = state.jobs[key];
      if (!existing) return state;
      return {
        ...state,
        jobs: { ...state.jobs, [key]: { ...existing, progress } },
      };
    }),

  finishJob: (mediaId, settingsHash) =>
    set((state) => {
      const key = jobKey(mediaId, settingsHash);
      const next = { ...state.jobs };
      delete next[key];
      return { ...state, jobs: next };
    }),

  failJob: (mediaId, settingsHash, error) =>
    set((state) => {
      const key = jobKey(mediaId, settingsHash);
      const nextJobs = { ...state.jobs };
      delete nextJobs[key];
      return {
        jobs: nextJobs,
        errors: { ...state.errors, [key]: error },
      };
    }),

  clearError: (mediaId, settingsHash) =>
    set((state) => {
      const key = jobKey(mediaId, settingsHash);
      const errors = { ...state.errors };
      delete errors[key];
      return { ...state, errors };
    }),
}));

export function selectJobForMedia(
  state: EnhanceJobsStore,
  mediaId: string,
  settingsHash: string,
): EnhanceJobState | undefined {
  return state.jobs[jobKey(mediaId, settingsHash)];
}

export function selectErrorForMedia(
  state: EnhanceJobsStore,
  mediaId: string,
  settingsHash: string,
): string | undefined {
  return state.errors[jobKey(mediaId, settingsHash)];
}
