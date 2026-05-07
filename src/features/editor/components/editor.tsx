import { useEffect, useLayoutEffect, useState, useRef, useCallback, memo, lazy, Suspense } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { createLogger } from '@/shared/logging/logger';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toolbar } from './toolbar';
import { MediaSidebar } from './media-sidebar';
import { PropertiesSidebar } from './properties-sidebar';
import { PreviewArea } from './preview-area';
import { InteractionLockRegion } from './interaction-lock-region';
import { AudioMeterPanel } from './audio-meter-panel';
import { Timeline, BentoLayoutDialog } from '@/features/editor/deps/timeline-ui';
import { ClearKeyframesDialog } from './clear-keyframes-dialog';
import { TtsGenerateDialog } from './tts-generate-dialog';
import { KubeezGenerateImageDialog } from '@/components/kubeez/kubeez-generate-image-dialog';
import { useKubeezGenerateDialogStore } from '@/shared/state/kubeez-generate-dialog';
import { toast } from 'sonner';
import { useEditorHotkeys } from '@/features/editor/hooks/use-editor-hotkeys';
import { useAutoSave } from '../hooks/use-auto-save';
import {
  useTimelineShortcuts,
  useTransitionBreakageNotifications,
} from '@/features/editor/deps/timeline-hooks';
import { initTransitionChainSubscription } from '@/features/editor/deps/timeline-subscriptions';
import { useTimelineStore, useItemsStore, useTimelineSettingsStore } from '@/features/editor/deps/timeline-store';
import { useEditorPanelLayoutStore } from '@/shared/state/editor-panel-layout-store';
import { importBundleExportDialog, BUNDLE_EXTENSION } from '@/features/editor/deps/project-bundle';
import { useMediaLibraryStore } from '@/features/editor/deps/media-library';
import { useSettingsStore } from '@/features/editor/deps/settings';
import { useMaskEditorStore } from '@/features/editor/deps/preview';
import { usePlaybackStore } from '@/shared/state/playback';
import { useEditorStore } from '@/shared/state/editor';
import { clearPreviewAudioCache } from '@/features/editor/deps/composition-runtime';
import { useProjectStore } from '@/features/editor/deps/projects';
import { importExportDialog } from '@/features/editor/deps/export-contract';
import { getEditorLayout, getEditorLayoutCssVars } from '@/shared/ui/editor-layout';
import { cn } from '@/shared/ui/cn';
import { createProjectUpgradeBackup, formatProjectUpgradeBackupName } from '@/features/editor/deps/projects';
import { ProjectUpgradeDialog } from './project-upgrade-dialog';
import { ProjectMediaMatchDialog } from './project-media-match-dialog';
import { EditorLoadingScreen } from './editor-loading-screen';
const logger = createLogger('Editor');
const EDITOR_PROJECT_ROUTE_ID = '/editor/$projectId';

/** Wider hit target for shell sidebars — library hit-testing can drop handles when the preview panel paints above a 1px strip. */
const SIDEBAR_SHELL_RESIZE_HIT_MARGINS = { coarse: 20, fine: 12 } as const;
const LazyExportDialog = lazy(() =>
  importExportDialog().then((module) => ({
    default: module.ExportDialog,
  }))
);
const LazyBundleExportDialog = lazy(() =>
  importBundleExportDialog().then((module) => ({
    default: module.BundleExportDialog,
  }))
);

function preloadExportDialog() {
  return importExportDialog();
}

function preloadBundleExportDialog() {
  return importBundleExportDialog();
}

/** Project metadata passed from route loader (timeline loaded separately via loadTimeline) */
interface EditorProps {
  projectId: string;
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    fps: number;
    backgroundColor?: string;
  };
  migration: {
    storedSchemaVersion: number;
    currentSchemaVersion: number;
    requiresUpgrade: boolean;
  };
}

/**
 * Video Editor entrypoint.
 * Shows an explicit backup-and-upgrade prompt for legacy projects before loading editor state.
 */
export const Editor = memo(function Editor({ projectId, project, migration }: EditorProps) {
  const navigate = useNavigate();
  const [upgradeApproved, setUpgradeApproved] = useState(!migration.requiresUpgrade);
  const [isPreparingUpgrade, setIsPreparingUpgrade] = useState(false);
  const backupName = formatProjectUpgradeBackupName(
    project.name,
    migration.storedSchemaVersion,
    migration.currentSchemaVersion
  );

  useEffect(() => {
    setUpgradeApproved(!migration.requiresUpgrade);
    setIsPreparingUpgrade(false);
  }, [migration.requiresUpgrade, projectId]);

  const handleCancelUpgrade = useCallback(() => {
    navigate({ to: '/projects' });
  }, [navigate]);

  const handleConfirmUpgrade = useCallback(async () => {
    setIsPreparingUpgrade(true);

    try {
      const backup = await createProjectUpgradeBackup(projectId, {
        fromVersion: migration.storedSchemaVersion,
        toVersion: migration.currentSchemaVersion,
        backupName,
      });
      toast.success('Backup created before upgrade', {
        description: backup.name,
      });
      setUpgradeApproved(true);
    } catch (error) {
      logger.error('Failed to create upgrade backup:', error);
      toast.error('Failed to create backup before upgrade', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setIsPreparingUpgrade(false);
    }
  }, [
    backupName,
    migration.currentSchemaVersion,
    migration.storedSchemaVersion,
    projectId,
  ]);

  if (!upgradeApproved) {
    return (
      <div className="min-h-screen bg-background">
        <ProjectUpgradeDialog
          open
          projectName={project.name}
          storedSchemaVersion={migration.storedSchemaVersion}
          currentSchemaVersion={migration.currentSchemaVersion}
          backupName={backupName}
          isUpgrading={isPreparingUpgrade}
          onCancel={handleCancelUpgrade}
          onConfirm={handleConfirmUpgrade}
        />
      </div>
    );
  }

  return <LoadedEditor projectId={projectId} project={project} migration={migration} />;
});

export const LoadedEditor = memo(function LoadedEditor({
  projectId,
  project,
  migration,
}: EditorProps) {
  const router = useRouter();
  const isTimelineLoading = useTimelineSettingsStore((s) => s.isTimelineLoading);
  const mediaLibraryProjectId = useMediaLibraryStore((s) => s.currentProjectId);
  const mediaLibraryLoading = useMediaLibraryStore((s) => s.isLoading);
  const showProjectLoading =
    isTimelineLoading || (mediaLibraryLoading && mediaLibraryProjectId === projectId);

  useLayoutEffect(() => {
    useTimelineSettingsStore.getState().setTimelineLoading(true);
  }, [projectId]);

  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [bundleExportDialogOpen, setBundleExportDialogOpen] = useState(false);
  const [bundleFileHandle, setBundleFileHandle] = useState<FileSystemFileHandle | undefined>();
  const editorDensity = useSettingsStore((s) => s.editorDensity);
  const snapEnabledPreference = useSettingsStore((s) => s.snapEnabled);
  const editorLayout = getEditorLayout(editorDensity);
  const editorLayoutCssVars = getEditorLayoutCssVars(editorLayout);
  const syncSidebarLayout = useEditorStore((s) => s.syncSidebarLayout);
  const leftSidebarOpen = useEditorStore((s) => s.leftSidebarOpen);
  const rightSidebarOpen = useEditorStore((s) => s.rightSidebarOpen);
  const setLeftSidebarOpen = useEditorStore((s) => s.setLeftSidebarOpen);
  const setRightSidebarOpen = useEditorStore((s) => s.setRightSidebarOpen);
  const isMaskEditingActive = useMaskEditorStore((s) => s.isEditing);
  const { panels, setPanel } = useEditorPanelLayoutStore();
  const fps = useTimelineStore((s) => s.fps);
  const maxItemEndFrame = useItemsStore((s) => s.maxItemEndFrame);
  const timelineDurationSeconds = Math.max(maxItemEndFrame / Math.max(fps, 1), 10);
  const kubeezGenerateOpen = useKubeezGenerateDialogStore((s) => s.isOpen);
  const closeKubeezGenerate = useKubeezGenerateDialogStore((s) => s.close);
  const hasRefreshedMigrationStateRef = useRef(false);
  const toolsPanelRef = useRef<ImperativePanelHandle>(null);
  const propertiesPanelRef = useRef<ImperativePanelHandle>(null);

  // Keep shell layout in sync: closing a sidebar collapses the ResizablePanel to 0,
  // not only hide inner content (otherwise an empty bordered column remains).
  useLayoutEffect(() => {
    const tools = toolsPanelRef.current;
    if (tools) {
      if (leftSidebarOpen) tools.expand();
      else tools.collapse();
    }
    const propsPanel = propertiesPanelRef.current;
    if (propsPanel) {
      if (rightSidebarOpen) propsPanel.expand();
      else propsPanel.collapse();
    }
  }, [leftSidebarOpen, rightSidebarOpen]);

  const syncToolsOpenFromResize = useCallback((size: number) => {
    const next = size > 0.5;
    if (useEditorStore.getState().leftSidebarOpen !== next) {
      useEditorStore.getState().setLeftSidebarOpen(next);
    }
  }, []);

  const syncPropertiesOpenFromResize = useCallback((size: number) => {
    const next = size > 0.5;
    if (useEditorStore.getState().rightSidebarOpen !== next) {
      useEditorStore.getState().setRightSidebarOpen(next);
    }
  }, []);

  // Guard against concurrent saves (e.g., spamming Ctrl+S)
  const isSavingRef = useRef(false);

  useEffect(() => {
    hasRefreshedMigrationStateRef.current = false;
  }, [projectId]);

  // Initialize transition chain subscription (pre-computes chains from timeline data)
  // This subscription recomputes chains when items/transitions change - deferred to idle
  // time so it doesn't compete with the initial editor render.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const id = requestIdleCallback(() => {
      unsubscribe = initTransitionChainSubscription();
    });
    return () => {
      cancelIdleCallback(id);
      unsubscribe?.();
    };
  }, []);

  // Preload export dialogs during idle time so they open instantly.
  useEffect(() => {
    const id = requestIdleCallback(() => {
      preloadExportDialog();
      preloadBundleExportDialog();
    });
    return () => cancelIdleCallback(id);
  }, []);

  // Initialize timeline from project data (or create default tracks for new projects).
  useEffect(() => {
    const {
      setCurrentProject: setMediaProject,
      loadMediaItems,
    } = useMediaLibraryStore.getState();
    const { setCurrentProject } = useProjectStore.getState();
    const playbackStore = usePlaybackStore.getState();

    // Clear stale scrub preview from previous editor sessions.
    // A non-null previewFrame puts preview into "scrubbing" mode, which can
    // defer media URL resolution during project open.
    playbackStore.setPreviewFrame(null);

    // Set current project context for media library (v3: project-scoped media)
    setMediaProject(projectId);
    void loadMediaItems().catch((error) => {
      logger.error('Failed to load media library:', error);
    });

    // Set current project in project store for properties panel
    setCurrentProject({
      id: project.id,
      name: project.name,
      description: '',
      duration: 0,
      schemaVersion: migration.currentSchemaVersion,
      metadata: {
        width: project.width,
        height: project.height,
        fps: project.fps,
        backgroundColor: project.backgroundColor,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Load timeline from IndexedDB - single source of truth for all timeline state
    const { loadTimeline } = useTimelineStore.getState();
    let cancelled = false;

    void (async () => {
      try {
        await loadTimeline(projectId, { allowProjectUpgrade: migration.requiresUpgrade });

        if (cancelled || !migration.requiresUpgrade || hasRefreshedMigrationStateRef.current) {
          return;
        }

        hasRefreshedMigrationStateRef.current = true;

        // Refresh the editor route metadata once the approved legacy project has
        // opened successfully so future reopens do not briefly show the upgrade prompt.
        await router.invalidate({
          filter: (match) =>
            match.routeId === EDITOR_PROJECT_ROUTE_ID &&
            match.params.projectId === projectId,
        });
      } catch (error) {
        logger.error('Failed to load timeline:', error);
      }
    })();

    // Cleanup: clear project context, stop playback, and release blob URLs when leaving editor
    return () => {
      cancelled = true;
      const cleanupPlaybackStore = usePlaybackStore.getState();
      cleanupPlaybackStore.setPreviewFrame(null);
      useMediaLibraryStore.getState().setCurrentProject(null);
      useProjectStore.getState().setCurrentProject(null);
      cleanupPlaybackStore.pause();
      clearPreviewAudioCache();
    };
  }, [
    migration.currentSchemaVersion,
    migration.requiresUpgrade,
    project.backgroundColor,
    project.fps,
    project.height,
    project.id,
    project.name,
    project.width,
    projectId,
    router,
  ]);

  // Track unsaved changes
  const isDirty = useTimelineStore((s: { isDirty: boolean }) => s.isDirty);

  useEffect(() => {
    syncSidebarLayout(editorLayout);
  }, [editorLayout, syncSidebarLayout]);

  useEffect(() => {
    const timelineState = useTimelineStore.getState();
    if (timelineState.snapEnabled !== snapEnabledPreference) {
      timelineState.toggleSnap();
    }
  }, [snapEnabledPreference]);

  useEffect(() => {
    if (!isMaskEditingActive) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }, [isMaskEditingActive]);

  // Save timeline to project (with guard against concurrent saves)
  const handleSave = useCallback(async () => {
    // Prevent concurrent saves (e.g., spamming Ctrl+S)
    if (isSavingRef.current) {
      return;
    }

    isSavingRef.current = true;
    const { saveTimeline } = useTimelineStore.getState();

    try {
      await saveTimeline(projectId);
      logger.debug('Project saved successfully');
      toast.success('Project saved');
    } catch (error) {
      logger.error('Failed to save project:', error);
      toast.error('Failed to save project');
      throw error; // Re-throw so callers know save failed
    } finally {
      isSavingRef.current = false;
    }
  }, [projectId]);

  const handleExport = useCallback(() => {
    // Pause playback when opening export dialog
    usePlaybackStore.getState().pause();
    void preloadExportDialog();
    setExportDialogOpen(true);
  }, []);

  const handleExportBundle = useCallback(async () => {
    void preloadBundleExportDialog();

    // Show native save picker BEFORE opening the modal dialog to avoid
    // focus-loss conflicts between the native picker and Radix Dialog.
    if (typeof window.showSaveFilePicker === 'function') {
      const safeName = project.name
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '_')
        .substring(0, 100);
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: `${safeName}${BUNDLE_EXTENSION}`,
          types: [
            {
              description: 'KubeezCut Project Bundle',
              accept: {
                'application/zip': [BUNDLE_EXTENSION],
              },
            },
          ],
        });
        setBundleFileHandle(handle);
      } catch {
        // User cancelled the picker - don't open the dialog
        return;
      }
    } else {
      setBundleFileHandle(undefined);
    }

    setBundleExportDialogOpen(true);
  }, [project.name]);

  // Enable keyboard shortcuts
  useEditorHotkeys({
    onSave: handleSave,
    onExport: handleExport,
  });

  // Enable auto-save based on settings interval
  useAutoSave({
    isDirty,
    onSave: handleSave,
  });

  // Enable timeline shortcuts (space, cut tool, rate tool, etc.)
  useTimelineShortcuts();

  // Enable transition breakage notifications
  useTransitionBreakageNotifications();

  return (
    <div
      className="bg-background relative flex h-screen w-screen flex-col overflow-hidden"
      style={editorLayoutCssVars as import('react').CSSProperties}
      role="application"
      aria-label="KubeezCut Video Editor"
    >
      {showProjectLoading ? (
        <div className="absolute inset-0 z-[200] flex items-center justify-center bg-background/85 backdrop-blur-sm">
          <EditorLoadingScreen subtitle={project.name} />
        </div>
      ) : null}

      {/* Kubeez feature bar (project, save, export, settings) — above OpenCut-style shell */}
      <InteractionLockRegion locked={isMaskEditingActive}>
        <Toolbar
          projectId={projectId}
          project={project}
          isDirty={isDirty}
          onSave={handleSave}
          onExport={handleExport}
          onExportBundle={handleExportBundle}
        />
      </InteractionLockRegion>

      {/* OpenCut editor shell: vertical split (main | timeline), main = tools | preview | properties */}
      <div className="min-h-0 min-w-0 flex-1">
        <ResizablePanelGroup
          direction="vertical"
          className="size-full gap-1"
          onLayout={(sizes) => {
            setPanel('mainContent', sizes[0] ?? panels.mainContent);
            setPanel('timeline', sizes[1] ?? panels.timeline);
          }}
        >
          <ResizablePanel
            defaultSize={panels.mainContent}
            minSize={30}
            maxSize={85}
            className="min-h-0"
          >
            <div className="relative z-0 min-h-0 h-full w-full">
              <ResizablePanelGroup
                direction="horizontal"
                className="size-full gap-[0.19rem] px-3"
                onLayout={(sizes) => {
                  const toolsSize = sizes[0];
                  if (toolsSize !== undefined && useEditorStore.getState().leftSidebarOpen) {
                    setPanel('tools', toolsSize);
                  }
                  setPanel('preview', sizes[1] ?? panels.preview);
                  const propSize = sizes[2];
                  if (propSize !== undefined && useEditorStore.getState().rightSidebarOpen) {
                    setPanel('properties', propSize);
                  }
                }}
              >
              <ResizablePanel
                ref={toolsPanelRef}
                collapsible
                collapsedSize={0}
                defaultSize={panels.tools}
                minSize={15}
                maxSize={40}
                className="min-h-0 min-w-0"
                onResize={syncToolsOpenFromResize}
              >
                <div
                  className={cn(
                    'panel bg-background flex h-full min-h-0 flex-col rounded-sm border',
                    leftSidebarOpen ? 'overflow-hidden' : 'overflow-visible border-0 bg-transparent shadow-none'
                  )}
                >
                  <InteractionLockRegion locked={isMaskEditingActive} fillHeight>
                    <ErrorBoundary level="feature">
                      <MediaSidebar fillContainer />
                    </ErrorBoundary>
                  </InteractionLockRegion>
                </div>
              </ResizablePanel>

              <ResizableHandle
                variant="ghost"
                hitAreaMargins={SIDEBAR_SHELL_RESIZE_HIT_MARGINS}
                className={cn(
                  'relative z-30 w-[3px] min-w-[3px] shrink-0 after:z-30',
                  !leftSidebarOpen && 'bg-border/45 hover:bg-border/70',
                  isMaskEditingActive && 'pointer-events-none opacity-60'
                )}
              />

              <ResizablePanel defaultSize={panels.preview} minSize={30} className="min-h-0 min-w-0 flex-1">
                <div className="panel bg-background flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-sm border">
                  <ErrorBoundary level="feature">
                    <PreviewArea project={project} />
                  </ErrorBoundary>
                </div>
              </ResizablePanel>

              <ResizableHandle
                variant="ghost"
                hitAreaMargins={SIDEBAR_SHELL_RESIZE_HIT_MARGINS}
                className={cn(
                  'relative z-30 w-[3px] min-w-[3px] shrink-0 after:z-30',
                  !rightSidebarOpen && 'bg-border/45 hover:bg-border/70',
                  isMaskEditingActive && 'pointer-events-none opacity-60'
                )}
              />

              <ResizablePanel
                ref={propertiesPanelRef}
                collapsible
                collapsedSize={0}
                defaultSize={panels.properties}
                minSize={15}
                maxSize={40}
                className="min-w-0"
                onResize={syncPropertiesOpenFromResize}
              >
                <div
                  className={cn(
                    'panel bg-background flex h-full flex-col rounded-sm border',
                    rightSidebarOpen ? 'overflow-hidden' : 'overflow-visible border-0 bg-transparent shadow-none'
                  )}
                >
                  <InteractionLockRegion locked={isMaskEditingActive} fillHeight>
                    <ErrorBoundary level="feature">
                      <PropertiesSidebar fillContainer />
                    </ErrorBoundary>
                  </InteractionLockRegion>
                </div>
              </ResizablePanel>
              </ResizablePanelGroup>

              {!leftSidebarOpen && (
                <button
                  type="button"
                  title="Show media panel"
                  aria-label="Expand media panel"
                  disabled={isMaskEditingActive}
                  onClick={() => setLeftSidebarOpen(true)}
                  className={cn(
                    'absolute left-3 top-1/2 z-40 flex h-20 w-9 -translate-y-1/2 flex-col items-center justify-center rounded-r-lg border border-border bg-muted/90 shadow-md backdrop-blur-sm',
                    'text-muted-foreground hover:bg-muted hover:text-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    isMaskEditingActive && 'pointer-events-none opacity-60'
                  )}
                >
                  <ChevronRight className="size-4 shrink-0" aria-hidden />
                </button>
              )}
              {!rightSidebarOpen && (
                <button
                  type="button"
                  title="Show properties panel"
                  aria-label="Expand properties panel"
                  disabled={isMaskEditingActive}
                  onClick={() => setRightSidebarOpen(true)}
                  className={cn(
                    'absolute right-3 top-1/2 z-40 flex h-20 w-9 -translate-y-1/2 flex-col items-center justify-center rounded-l-lg border border-border bg-muted/90 shadow-md backdrop-blur-sm',
                    'text-muted-foreground hover:bg-muted hover:text-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    isMaskEditingActive && 'pointer-events-none opacity-60'
                  )}
                >
                  <ChevronLeft className="size-4 shrink-0" aria-hidden />
                </button>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle
            variant="ghost"
            className={isMaskEditingActive ? 'pointer-events-none opacity-60' : undefined}
          />

          <ResizablePanel
            defaultSize={panels.timeline}
            minSize={15}
            maxSize={70}
            className="min-h-0 px-3 pb-3"
          >
            <InteractionLockRegion locked={isMaskEditingActive} fillHeight>
              <ErrorBoundary level="feature">
                <div className="panel bg-background flex h-full min-h-0 flex-col overflow-hidden rounded-sm border">
                  <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
                    <div className="min-w-0 flex-1 min-h-0">
                      <Timeline duration={timelineDurationSeconds} />
                    </div>
                    <AudioMeterPanel />
                  </div>
                </div>
              </ErrorBoundary>
            </InteractionLockRegion>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <Suspense fallback={null}>
        {/* Export Dialog */}
        {exportDialogOpen && (
          <LazyExportDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} />
        )}

        {/* Bundle Export Dialog */}
        {bundleExportDialogOpen && (
          <LazyBundleExportDialog
            open={bundleExportDialogOpen}
            onClose={() => {
              setBundleExportDialogOpen(false);
              setBundleFileHandle(undefined);
            }}
            projectId={projectId}
            onBeforeExport={handleSave}
            fileHandle={bundleFileHandle}
          />
        )}
      </Suspense>

      {/* Clear Keyframes Confirmation Dialog */}
      <ClearKeyframesDialog />

      <ProjectMediaMatchDialog projectId={projectId} />

      {/* Bento Layout Preset Dialog */}
      <BentoLayoutDialog />

      {/* TTS Generate from Text Dialog */}
      <TtsGenerateDialog />

      {/* Kubeez — generate image/video/music/speech into media library */}
      <KubeezGenerateImageDialog
        open={kubeezGenerateOpen}
        onOpenChange={(open) => {
          if (!open) closeKubeezGenerate();
        }}
      />

    </div>
  );
});
