/**
 * OpenCut-style resizable panel percentages for the editor shell.
 * Persisted so layout matches OpenCut behavior (tools / preview / properties / main vs timeline).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { EDITOR_LAYOUT } from '@/shared/ui/editor-layout';

export interface EditorPanelSizes {
  tools: number;
  preview: number;
  properties: number;
  mainContent: number;
  timeline: number;
}

export type EditorPanelId = keyof EditorPanelSizes;

const DEFAULT_PANELS: EditorPanelSizes = {
  tools: 25,
  preview: 50,
  properties: 25,
  mainContent: 100 - EDITOR_LAYOUT.timelineDefaultSize,
  timeline: EDITOR_LAYOUT.timelineDefaultSize,
};

/** The main/timeline split that version 1 of this store shipped with. */
const V1_DEFAULT_SPLIT = { mainContent: 50, timeline: 50 };

interface PersistedPanelLayout {
  panels?: EditorPanelSizes;
}

/**
 * Version 1 shipped a 50/50 main/timeline split. Layouts still sitting on
 * that untouched default follow the new default from EDITOR_LAYOUT; anything
 * the user resized themselves is left alone.
 */
export function migrateEditorPanelLayout(
  persistedState: unknown,
  version: number
): PersistedPanelLayout {
  const state = persistedState as PersistedPanelLayout;
  if (version >= 2) return state;
  if (
    state?.panels &&
    state.panels.mainContent === V1_DEFAULT_SPLIT.mainContent &&
    state.panels.timeline === V1_DEFAULT_SPLIT.timeline
  ) {
    return {
      ...state,
      panels: {
        ...state.panels,
        mainContent: DEFAULT_PANELS.mainContent,
        timeline: DEFAULT_PANELS.timeline,
      },
    };
  }
  return state;
}

interface EditorPanelLayoutState {
  panels: EditorPanelSizes;
  setPanel: (panel: EditorPanelId, size: number) => void;
  resetPanels: () => void;
}

export const useEditorPanelLayoutStore = create<EditorPanelLayoutState>()(
  persist(
    (set) => ({
      panels: { ...DEFAULT_PANELS },
      setPanel: (panel, size) =>
        set((state) => ({
          panels: {
            ...state.panels,
            [panel]: size,
          },
        })),
      resetPanels: () => set({ panels: { ...DEFAULT_PANELS } }),
    }),
    {
      name: 'kubeez-editor-panel-sizes',
      version: 2,
      partialize: (state) => ({ panels: state.panels }),
      migrate: migrateEditorPanelLayout,
    }
  )
);
