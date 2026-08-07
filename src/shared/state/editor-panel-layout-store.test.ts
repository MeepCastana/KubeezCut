import { describe, expect, it } from 'vitest';
import { migrateEditorPanelLayout } from './editor-panel-layout-store';
import { EDITOR_LAYOUT } from '@/shared/ui/editor-layout';

const v1DefaultState = {
  panels: {
    tools: 25,
    preview: 50,
    properties: 25,
    mainContent: 50,
    timeline: 50,
  },
};

describe('migrateEditorPanelLayout', () => {
  it('moves an untouched v1 default split to the EDITOR_LAYOUT default', () => {
    const migrated = migrateEditorPanelLayout(v1DefaultState, 1);

    expect(migrated.panels?.timeline).toBe(EDITOR_LAYOUT.timelineDefaultSize);
    expect(migrated.panels?.mainContent).toBe(100 - EDITOR_LAYOUT.timelineDefaultSize);
  });

  it('keeps main/timeline summing to 100 after migration', () => {
    const migrated = migrateEditorPanelLayout(v1DefaultState, 1);

    expect((migrated.panels?.mainContent ?? 0) + (migrated.panels?.timeline ?? 0)).toBe(100);
  });

  it('preserves the untouched sidebar panel sizes', () => {
    const migrated = migrateEditorPanelLayout(v1DefaultState, 1);

    expect(migrated.panels?.tools).toBe(25);
    expect(migrated.panels?.preview).toBe(50);
    expect(migrated.panels?.properties).toBe(25);
  });

  it('leaves a user-resized v1 layout alone', () => {
    const resized = {
      panels: { ...v1DefaultState.panels, mainContent: 40, timeline: 60 },
    };

    expect(migrateEditorPanelLayout(resized, 1)).toEqual(resized);
  });

  it('passes current-version state through untouched', () => {
    expect(migrateEditorPanelLayout(v1DefaultState, 2)).toEqual(v1DefaultState);
  });
});
