import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('ProjectsIndex');
import { Button } from '@/components/ui/button';
import { Plus, Upload, FolderOpen, File, Copy, Check } from 'lucide-react';
import { KubeezCutLogo } from '@/components/brand/kubeez-cut-logo';
import { ProjectList } from '@/features/projects/components/project-list';
import { ProjectForm } from '@/features/projects/components/project-form';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { useProjectActions } from '@/features/projects/hooks/use-project-actions';
import { useProjectsLoading, useProjectsError } from '@/features/projects/hooks/use-project-selectors';
import { cleanupBlobUrls } from '@/features/media-library/utils/media-resolver';
import type { Project } from '@/types/project';
import type { ProjectFormData } from '@/features/projects/utils/validation';
import type { ImportProgress } from '@/features/project-bundle/types/bundle';
import {
  BUNDLE_EXTENSION,
  isBundleFileName,
  stripBundleStemFromFileStem,
} from '@/features/project-bundle/types/bundle';
import { getFilePickerUnavailableHelp } from '@/shared/utils/browser-file-system-access';

function ImportFlagCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center justify-center h-5 w-5 rounded hover:bg-muted transition-colors shrink-0"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
    </button>
  );
}

export const Route = createFileRoute('/projects/')({
  component: ProjectsIndex,
  // Clean up any media blob URLs when returning to projects page
  beforeLoad: async () => {
    cleanupBlobUrls();
    // Always reload projects from IndexedDB to get fresh data (thumbnails may have changed)
    const { loadProjects } = useProjectStore.getState();
    await loadProjects();
  },
});

function ProjectsIndex() {
  const navigate = useNavigate();
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Import state - two-step flow
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [projectNameFromFile, setProjectNameFromFile] = useState<string | null>(null);
  const [destinationDir, setDestinationDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [destinationName, setDestinationName] = useState<string | null>(null);
  const [useProjectsFolder, setUseProjectsFolder] = useState(true); // Create KubeezCutProjects subfolder
  const [storageMode, setStorageMode] = useState<'browser' | 'folder'>('browser');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importErrorLink, setImportErrorLink] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const PROJECTS_FOLDER_NAME = 'KubeezCutProjects';

  // Extract project name from bundle filename (supports .kubeez.zip)
  const extractProjectName = (fileName: string): string => {
    let name = fileName.replace(/\.zip$/i, '');
    name = name.replace(/\s*\(\d+\)$/, '');
    return stripBundleStemFromFileStem(name);
  };

  const isValidBundleFile = (fileName: string): boolean => isBundleFileName(fileName);

  const isLoading = useProjectsLoading();
  const error = useProjectsError();
  const { loadProjects, updateProject } = useProjectActions();

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Handle import file selection
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  // Step 1: File selected - show destination selection dialog
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset file input for next selection
    event.target.value = '';

    // Validate file extension (handles browser-renamed files like "project.kubeez (1).zip")
    if (!isValidBundleFile(file.name)) {
      setImportError(`Please select a valid ${BUNDLE_EXTENSION} file`);
      setImportErrorLink(null);
      setImportDialogOpen(true);
      return;
    }

    // Store file and extract project name, then show destination selection dialog
    setPendingImportFile(file);
    setProjectNameFromFile(extractProjectName(file.name));
    setDestinationDir(null);
    setDestinationName(null);
    setStorageMode('browser');
    setImportError(null);
    setImportErrorLink(null);
    setImportProgress(null);
    setIsImporting(false);
    setImportDialogOpen(true);
  };

  // Step 2: User clicks to select destination folder (fresh user gesture!)
  const handleSelectDestination = async () => {
    const fsHelp = getFilePickerUnavailableHelp('directory');
    if (fsHelp) {
      setImportError(fsHelp.message);
      setImportErrorLink(fsHelp.flagUrl);
      return;
    }

    try {
      const dirHandle = await window.showDirectoryPicker({
        id: 'kubeezcut-import',
        mode: 'readwrite',
        startIn: 'documents',
      });
      setDestinationDir(dirHandle);
      setDestinationName(dirHandle.name);
      setImportError(null);
      setImportErrorLink(null);
    } catch (err) {
      // User cancelled - ignore
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      // Handle "contains system files" or permission errors
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setImportError(
          'Cannot select system folders directly. Use "New Folder" in the picker to create a folder first, then select it.'
        );
        setImportErrorLink(null);
        return;
      }
      logger.error('Failed to select directory:', err);
      setImportError('Failed to select destination folder. Please try a different location.');
      setImportErrorLink(null);
    }
  };

  // Step 3: User clicks "Start Import" - begin actual import
  const handleStartImport = async () => {
    if (!pendingImportFile) return;
    if (storageMode === 'folder' && !destinationDir) return;

    setIsImporting(true);
    setImportProgress({ percent: 0, stage: 'validating' });

    try {
      // Resolve destination based on storage mode.
      // - 'browser': null → bundle-import-service writes to OPFS.
      // - 'folder': use the picked directory, optionally nested under KubeezCutProjects.
      let finalDestination: FileSystemDirectoryHandle | null = null;
      if (storageMode === 'folder' && destinationDir) {
        finalDestination = destinationDir;
        if (useProjectsFolder) {
          try {
            finalDestination = await destinationDir.getDirectoryHandle(PROJECTS_FOLDER_NAME, { create: true });
          } catch (err) {
            logger.error('Failed to create KubeezCutProjects folder:', err);
            throw new Error(`Failed to create ${PROJECTS_FOLDER_NAME} folder. Try selecting a different location.`);
          }
        }
      }

      const { importProjectBundle } = await import(
        '@/features/project-bundle/services/bundle-import-service'
      );

      const result = await importProjectBundle(
        pendingImportFile,
        finalDestination,
        {},
        (progress) => {
          setImportProgress(progress);
        }
      );

      // Reload projects list
      await loadProjects();

      // Close dialog and navigate to the imported project
      handleCloseImportDialog();
      navigate({ to: '/editor/$projectId', params: { projectId: result.project.id } });
    } catch (err) {
      logger.error('Import failed:', err);
      setImportError(err instanceof Error ? err.message : 'Import failed');
      setImportErrorLink(null);
      setImportProgress(null);
      setIsImporting(false);
    }
  };

  // Reset import dialog state
  const handleCloseImportDialog = () => {
    if (isImporting) return; // Don't close while importing
    setImportDialogOpen(false);
    setPendingImportFile(null);
    setProjectNameFromFile(null);
    setDestinationDir(null);
    setDestinationName(null);
    setStorageMode('browser');
    setImportError(null);
    setImportErrorLink(null);
    setImportProgress(null);
    setIsImporting(false);
  };

  // Compute full destination path for display
  const getFullDestinationPath = (): string => {
    if (!destinationName) return '';
    const parts = [destinationName];
    if (useProjectsFolder) parts.push(PROJECTS_FOLDER_NAME);
    if (projectNameFromFile) parts.push(projectNameFromFile);
    return parts.join('/');
  };

  // Format file size for display
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleEditProject = (project: Project) => {
    setEditingProject(project);
  };

  const handleEditSubmit = async (data: ProjectFormData) => {
    if (!editingProject) return;

    setIsSubmitting(true);
    try {
      await updateProject(editingProject.id, data);
      setEditingProject(null);
    } catch (error) {
      logger.error('Failed to update project:', error);
      toast.error('Failed to update project', { description: 'Please try again' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="panel-header border-b border-border">
          <div className="max-w-[1920px] mx-auto px-6 py-5 flex items-center justify-between">
            <Link to="/projects">
              <KubeezCutLogo withWordmark size="md" className="hover:opacity-80 transition-opacity" />
            </Link>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="lg" className="gap-2" onClick={handleImportClick}>
                <Upload className="w-4 h-4" />
                Import Project
              </Button>
              <Link to="/projects/new">
                <Button size="lg" className="gap-2">
                  <Plus className="w-4 h-4" />
                  New Project
                </Button>
              </Link>
            </div>

            {/* Hidden file input for import */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="max-w-[1920px] mx-auto px-6 py-4">
            <div className="panel-bg border border-destructive/50 rounded-lg p-4 text-destructive">
              <p className="font-medium">Error loading projects</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading ? (
          <div className="max-w-[1920px] mx-auto px-6 py-16 flex items-center justify-center">
            <div className="text-center">
              <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading projects...</p>
            </div>
          </div>
        ) : (
          /* Projects List */
          <div className="max-w-[1920px] mx-auto px-6 py-8">
            <ProjectList onEditProject={handleEditProject} />
          </div>
        )}
      </div>

      {/* Edit Project Dialog */}
      <Dialog open={!!editingProject} onOpenChange={(open) => !open && setEditingProject(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Project Settings</DialogTitle>
          </DialogHeader>
          {editingProject && (
            <ProjectForm
              onSubmit={handleEditSubmit}
              onCancel={() => setEditingProject(null)}
              defaultValues={{
                name: editingProject.name,
                description: editingProject.description,
                width: editingProject.metadata.width,
                height: editingProject.metadata.height,
                fps: editingProject.metadata.fps,
              }}
              isEditing={true}
              isSubmitting={isSubmitting}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Import Project Dialog - Two Step Flow */}
      <Dialog open={importDialogOpen} onOpenChange={(open) => {
        if (!open) handleCloseImportDialog();
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {importError ? 'Import Failed' : isImporting ? 'Importing Project' : 'Import Project'}
            </DialogTitle>
            {!importError && !isImporting && pendingImportFile && (
              <DialogDescription>
                Choose where to store media files
              </DialogDescription>
            )}
            {!importError && isImporting && importProgress && (
              <DialogDescription>
                {importProgress.stage === 'validating' && 'Validating bundle...'}
                {importProgress.stage === 'extracting' && `Extracting${importProgress.currentFile ? `: ${importProgress.currentFile}` : '...'}`}
                {importProgress.stage === 'importing_media' && `Importing${importProgress.currentFile ? `: ${importProgress.currentFile}` : '...'}`}
                {importProgress.stage === 'linking' && 'Creating project...'}
                {importProgress.stage === 'complete' && 'Import complete!'}
              </DialogDescription>
            )}
          </DialogHeader>

          {importError && !pendingImportFile ? (
            /* Fatal error state - no file */
            <div className="space-y-4">
              <div>
                <p className="text-sm text-destructive">{importError}</p>
                {importErrorLink && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground select-text break-all">
                      {importErrorLink}
                    </code>
                    <ImportFlagCopyButton text={importErrorLink} />
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleCloseImportDialog}
              >
                Close
              </Button>
            </div>
          ) : isImporting && importProgress ? (
            /* Importing state - show progress */
            <div className="space-y-4">
              <Progress value={importProgress.percent} className="h-2" />
              <p className="text-sm text-muted-foreground text-center">
                {Math.round(importProgress.percent)}%
              </p>
            </div>
          ) : pendingImportFile ? (
            /* Destination selection state */
            <div className="space-y-4">
              {/* File info */}
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                <File className="w-8 h-8 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{pendingImportFile.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(pendingImportFile.size)}</p>
                </div>
              </div>

              {/* Storage mode selection */}
              <div className="space-y-3">
                <p className="text-sm font-medium">Where to store media</p>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 cursor-pointer p-2 rounded border border-border hover:bg-muted/50">
                    <input
                      type="radio"
                      name="storage-mode"
                      value="browser"
                      checked={storageMode === 'browser'}
                      onChange={() => setStorageMode('browser')}
                      className="mt-0.5 w-4 h-4 accent-primary"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">Browser storage</p>
                      <p className="text-xs text-muted-foreground">
                        Keep media inside the app. No folder needed.
                      </p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer p-2 rounded border border-border hover:bg-muted/50">
                    <input
                      type="radio"
                      name="storage-mode"
                      value="folder"
                      checked={storageMode === 'folder'}
                      onChange={() => setStorageMode('folder')}
                      className="mt-0.5 w-4 h-4 accent-primary"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">External folder</p>
                      <p className="text-xs text-muted-foreground">
                        Extract media to a folder on your computer.
                      </p>
                    </div>
                  </label>
                </div>

                {storageMode === 'folder' && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Destination Folder</p>
                      {!destinationDir && (
                        <p className="text-xs text-muted-foreground">Use "New Folder" in picker if needed</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                      onClick={handleSelectDestination}
                    >
                      <FolderOpen className="w-4 h-4" />
                      {destinationName ? (
                        <span className="truncate">{destinationName}</span>
                      ) : (
                        <span className="text-muted-foreground">Select or create folder...</span>
                      )}
                    </Button>

                    {/* KubeezCutProjects subfolder option */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useProjectsFolder}
                        onChange={(e) => setUseProjectsFolder(e.target.checked)}
                        className="w-4 h-4 rounded border-border accent-primary"
                      />
                      <span className="text-sm">
                        Create in <code className="text-xs bg-muted px-1 py-0.5 rounded">{PROJECTS_FOLDER_NAME}</code> subfolder
                      </span>
                    </label>

                    {destinationDir && !importError && (
                      <div className="p-3 bg-muted/50 rounded-lg border border-border">
                        <p className="text-xs text-muted-foreground mb-1">Media will be saved to:</p>
                        <p className="text-sm font-semibold text-foreground break-all">
                          {getFullDestinationPath()}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {importError && (
                  <div>
                    <p className="text-xs text-destructive">{importError}</p>
                    {importErrorLink && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground select-text break-all">
                          {importErrorLink}
                        </code>
                        <ImportFlagCopyButton text={importErrorLink} />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={handleCloseImportDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleStartImport}
                  disabled={storageMode === 'folder' && !destinationDir}
                >
                  Start Import
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

