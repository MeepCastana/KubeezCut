import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KUBEEZ_BRAND_LOGO_URL } from '@/components/brand/kubeez-cut-logo';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AspectRatioIcon,
  KubeezGenerateModelsColumn,
  KubeezGeneratePromptField,
  KubeezGenerateSelectedModelPanel,
  type ModelTab,
} from '@/components/kubeez/kubeez-generate-dialog-fragments';
import { useSettingsStore } from '@/features/settings/stores/settings-store';
import { useEffectiveKubeezToken } from '@/shared/state/kubeez-account';
import { useProjectStore } from '@/features/projects/stores/project-store';
import { usePlaybackStore } from '@/shared/state/playback';
import { useTimelineStore } from '@/features/timeline/stores/timeline-store';
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store';
import { MediaPickerDialog } from '@/features/media-library/components/media-picker-dialog';
import {
  FileAccessError,
  mediaLibraryService,
} from '@/features/media-library/services/media-library-service';
import { runKubeezGenerateJobInBackground } from '@/components/kubeez/kubeez-generate-job-runner';
import { effectiveMaxReferenceFilesForGenerateDialog } from '@/infrastructure/kubeez/kubeez-documented-reference-limits';
import {
  getFileSizeInMB,
  getMaxFileSizeForModel,
  isKubeezReferenceFileSizeAllowedForModel,
  isKubeezReferenceMimeAllowed,
  isKubeezReferenceMimeTypeStringAllowed,
  KUBEEZ_ACCEPTED_REFERENCE_IMAGE_TYPES,
  KUBEEZ_ACCEPTED_REFERENCE_VIDEO_TYPES,
  KUBEEZ_REFERENCE_FILE_ACCEPT,
  MAX_INPUT_FILE_SIZE,
} from '@/infrastructure/kubeez/kubeez-file-restrictions';
import {
  isKlingMotionControlModelId,
  referenceAttachmentsMeetMinimum,
} from '@/infrastructure/kubeez/kubeez-reference-readiness';
import { getKubeezOfflineBrowseCatalog } from '@/infrastructure/kubeez/kubeez-offline-browse-catalog';
import {
  FALLBACK_MUSIC_MODELS,
  fetchKubeezGroupedMediaModels,
  filterKubeezCutCatalogModels,
  KUBEEZ_SPEECH_DIALOGUE_MODEL,
  type KubeezMediaModelOption,
} from '@/infrastructure/kubeez/kubeez-models';
import { readKubeezGroupedModelsCache, isModelsCacheFresh } from '@/infrastructure/kubeez/kubeez-models-cache';
import { useKubeezCredits } from '@/infrastructure/kubeez/kubeez-credits';

const KUBEEZ_OFFLINE_BROWSE = getKubeezOfflineBrowseCatalog();
import type { KubeezModelSettings } from '@/infrastructure/kubeez/model-family-registry';
import {
  getVariantsForBaseCardId,
  resolveGenerationModelId,
  resolveSelectionFromConcreteModelId,
} from '@/infrastructure/kubeez/model-resolve';
import {
  getVideoAspectUi,
  shouldIncludeVideoAspectRatio,
  videoAspectRatioForRequest,
} from '@/infrastructure/kubeez/kubeez-video-aspect-ui';
import {
  findModelFamilyGridItemForModelId,
  videoModelIdEncodesVariantParams,
} from '@/infrastructure/kubeez/kubeez-video-model-variants';
import {
  KUBEEZ_DEFAULT_DIALOGUE_VOICE_ID,
  KUBEEZ_DIALOGUE_LANGUAGE_OPTIONS,
  KUBEEZ_DIALOGUE_VOICE_OPTIONS,
} from '@/infrastructure/kubeez/kubeez-audio-generations';
import type { MediaMetadata } from '@/types/storage';
import { toast } from 'sonner';
import { createLogger } from '@/shared/logging/logger';
import { Film, Image as ImageIcon, Info, Paperclip, Video, X } from 'lucide-react';
import { cn } from '@/shared/ui/cn';
import { Link, useNavigate } from '@tanstack/react-router';
import { SETTINGS_KUBEEZ_API_LINK_PROPS } from '@/config/settings-kubeez-api';
import { markKubeezGenerateReopenAfterSettings } from '@/shared/state/kubeez-generate-dialog';

const logger = createLogger('KubeezGenerateDialog');

const ASPECT_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;

const DEFAULT_MODEL_ID = 'nano-banana-2';

function pickSelectedModelIdAfterGroupedLoad(
  prev: string,
  imageModels: KubeezMediaModelOption[],
  videoModels: KubeezMediaModelOption[],
  musicModels: KubeezMediaModelOption[]
): string {
  const flat = [...imageModels, ...videoModels, ...musicModels, KUBEEZ_SPEECH_DIALOGUE_MODEL];
  if (flat.some((m) => m.model_id === prev)) return prev;
  const preferred = imageModels.find((m) => m.model_id === DEFAULT_MODEL_ID);
  return (
    preferred?.model_id ??
    imageModels[0]?.model_id ??
    videoModels[0]?.model_id ??
    musicModels[0]?.model_id ??
    KUBEEZ_SPEECH_DIALOGUE_MODEL.model_id ??
    prev
  );
}

const MOTION_IMAGE_ACCEPT = KUBEEZ_ACCEPTED_REFERENCE_IMAGE_TYPES.join(',');
const MOTION_VIDEO_ACCEPT = KUBEEZ_ACCEPTED_REFERENCE_VIDEO_TYPES.join(',');

type ReferenceAttachment = {
  id: string;
  file: File;
  previewUrl: string | null;
};

/** Models that accept a `quality` POST body field (basic = standard res, high = max res). */
const SEEDREAM_QUALITY_MODEL_IDS = new Set([
  'seedream-v4-5', 'seedream-v4-5-edit',
  '5-lite-text-to-image', '5-lite-image-to-image',
]);

function isSeedreamQualityModel(modelId: string): boolean {
  return SEEDREAM_QUALITY_MODEL_IDS.has(modelId);
}

/** Label for the quality tiers per model family. */
function getQualityOptions(modelId: string): { value: 'basic' | 'high'; label: string }[] {
  if (modelId.startsWith('5-lite')) {
    return [
      { value: 'basic', label: '2K' },
      { value: 'high', label: '3K' },
    ];
  }
  // seedream-v4-5
  return [
    { value: 'basic', label: '2K' },
    { value: 'high', label: '4K' },
  ];
}

export interface KubeezGenerateImageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timelinePlacement?: { trackId: string; trackName: string };
}

export function KubeezGenerateImageDialog({
  open,
  onOpenChange,
  timelinePlacement,
}: KubeezGenerateImageDialogProps) {
  const navigate = useNavigate();
  // Effective auth token: live Supabase session JWT (preferred) → stored
  // pasted API key (fallback for OSS / standalone). Existing call sites
  // keep the `apiKey` parameter name; it's a Bearer-style token now.
  const { token: kubeezApiKey, hasAuth: hasKubeezAuth } = useEffectiveKubeezToken();
  const kubeezApiBaseUrl = useSettingsStore((s) => s.kubeezApiBaseUrl);
  const currentProject = useProjectStore((s) => s.currentProject);
  const markReopenGenerateAfterSettings = () => {
    const id = currentProject?.id;
    if (id) markKubeezGenerateReopenAfterSettings(id);
  };
  const fps = useTimelineStore((s) => s.fps);

  const { credits: userCredits, refresh: refreshCredits, deduct: deductCredits } = useKubeezCredits({
    apiKey: kubeezApiKey,
    baseUrl: kubeezApiBaseUrl ?? undefined,
    enabled: open && hasKubeezAuth,
  });

  const promptRef = useRef('');
  const [promptResetKey, setPromptResetKey] = useState(0);
  const openWasFalse = useRef(true);

  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  /** Not encoded in `model_id`; kept in dialog state only (see `resolveSelectionFromConcreteModelId`). */
  const [videoAspectRatio, setVideoAspectRatio] = useState<string | undefined>(undefined);
  const [videoDuration, setVideoDuration] = useState('');
  /** Brief lock while enqueueing a background job (avoid double submit) */
  const [isStartingJob, setIsStartingJob] = useState(false);
  const [imageModels, setImageModels] = useState<KubeezMediaModelOption[]>(KUBEEZ_OFFLINE_BROWSE.imageModels);
  const [videoModels, setVideoModels] = useState<KubeezMediaModelOption[]>(KUBEEZ_OFFLINE_BROWSE.videoModels);
  const [musicModels, setMusicModels] = useState<KubeezMediaModelOption[]>(KUBEEZ_OFFLINE_BROWSE.musicModels);
  const [selectedModelId, setSelectedModelId] = useState<string>(DEFAULT_MODEL_ID);
  const [musicInstrumental, setMusicInstrumental] = useState(false);
  const [dialogueVoice, setDialogueVoice] = useState(KUBEEZ_DEFAULT_DIALOGUE_VOICE_ID);
  const [dialogueLanguage, setDialogueLanguage] = useState('auto');
  const [dialogueStability, setDialogueStability] = useState('0.5');
  const [imageQuality, setImageQuality] = useState<'basic' | 'high'>('basic');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelTab, setModelTab] = useState<ModelTab>('all');
  const [referenceAttachments, setReferenceAttachments] = useState<ReferenceAttachment[]>([]);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);
  const motionImageInputRef = useRef<HTMLInputElement>(null);
  const motionVideoInputRef = useRef<HTMLInputElement>(null);
  /** Kling 2.6 / 3.0 motion: separate slots (API expects image then video in `source_media_urls`). */
  const [motionRefImage, setMotionRefImage] = useState<ReferenceAttachment | null>(null);
  const [motionRefVideo, setMotionRefVideo] = useState<ReferenceAttachment | null>(null);
  const [referenceLibraryPickerOpen, setReferenceLibraryPickerOpen] = useState(false);
  const [motionImageLibraryPickerOpen, setMotionImageLibraryPickerOpen] = useState(false);
  const [motionVideoLibraryPickerOpen, setMotionVideoLibraryPickerOpen] = useState(false);
  /** Settings for models not in the family registry (not encoded in `selectedModelId`), e.g. P Image Edit turbo. */
  const [dialogModelSettings, setDialogModelSettings] = useState<Partial<KubeezModelSettings>>({});

  const speechModels = useMemo(() => [KUBEEZ_SPEECH_DIALOGUE_MODEL], []);

  const allModels = useMemo(
    () =>
      filterKubeezCutCatalogModels([...imageModels, ...videoModels, ...musicModels, ...speechModels]),
    [imageModels, musicModels, speechModels, videoModels]
  );

  const allModelsSorted = useMemo(
    () =>
      [...allModels].sort((a, b) =>
        a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' })
      ),
    [allModels]
  );

  useEffect(() => {
    if (allModels.some((m) => m.model_id === selectedModelId)) return;
    setSelectedModelId(
      imageModels.find((m) => m.model_id === DEFAULT_MODEL_ID)?.model_id ??
        imageModels[0]?.model_id ??
        videoModels[0]?.model_id ??
        musicModels[0]?.model_id ??
        KUBEEZ_SPEECH_DIALOGUE_MODEL.model_id
    );
  }, [allModels, imageModels, musicModels, selectedModelId, videoModels]);

  const resolvedSelection = useMemo(
    () =>
      resolveSelectionFromConcreteModelId(
        selectedModelId,
        imageModels,
        videoModels,
        musicModels
      ),
    [selectedModelId, imageModels, videoModels, musicModels]
  );

  useEffect(() => {
    setDialogModelSettings({});
  }, [selectedModelId]);

  const effectiveSettings = useMemo(
    (): KubeezModelSettings => ({ ...resolvedSelection.settings, ...dialogModelSettings }),
    [resolvedSelection.settings, dialogModelSettings]
  );

  useEffect(() => {
    const mid = resolvedSelection.resolvedModelId;
    if (isKlingMotionControlModelId(mid)) {
      setReferenceAttachments((prev) => {
        for (const r of prev) {
          if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
        }
        return [];
      });
    } else {
      setMotionRefImage((p) => {
        if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
        return null;
      });
      setMotionRefVideo((p) => {
        if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
        return null;
      });
    }
  }, [resolvedSelection.resolvedModelId]);

  const patchModelSettings = useCallback(
    (patch: Partial<KubeezModelSettings>) => {
      setSelectedModelId((prev) => {
        const cur = resolveSelectionFromConcreteModelId(
          prev,
          imageModels,
          videoModels,
          musicModels
        );
        if (!cur.registryEntry && patch.pImageEditTurbo !== undefined) {
          setDialogModelSettings((s) => ({ ...s, pImageEditTurbo: patch.pImageEditTurbo }));
          return prev;
        }
        const nextSettings: KubeezModelSettings = { ...cur.settings, ...patch };
        if (patch.kling26 != null || cur.settings.kling26 != null) {
          nextSettings.kling26 = {
            mode: 'text-to-video',
            duration: '5s',
            withAudio: false,
            ...cur.settings.kling26,
            ...patch.kling26,
          };
        }
        if (patch.videoAxes != null || cur.settings.videoAxes != null) {
          nextSettings.videoAxes = {
            resolution: null,
            duration: '4s',
            withAudio: false,
            ...cur.settings.videoAxes,
            ...patch.videoAxes,
          };
        }
        if (patch.kling30 != null || cur.settings.kling30 != null) {
          nextSettings.kling30 = {
            line: 'std',
            motionResolution: '720p',
            ...cur.settings.kling30,
            ...patch.kling30,
          };
        }
        if (patch.sora2 != null || cur.settings.sora2 != null) {
          nextSettings.sora2 = {
            tier: 'base',
            mode: 'text-to-video',
            duration: '10s',
            proQuality: 'standard',
            ...cur.settings.sora2,
            ...patch.sora2,
          };
        }
        if (patch.veo31 != null || cur.settings.veo31 != null) {
          nextSettings.veo31 = {
            tier: 'fast',
            mode: 'text-to-video',
            ...cur.settings.veo31,
            ...patch.veo31,
          };
        }
        if (patch.wan25 != null || cur.settings.wan25 != null) {
          nextSettings.wan25 = {
            useSimpleCatalogId: true,
            source: 'text',
            duration: '5s',
            resolution: '1080p',
            ...cur.settings.wan25,
            ...patch.wan25,
          };
        }
        let variants = getVariantsForBaseCardId(
          cur.baseCardId,
          imageModels,
          videoModels,
          musicModels
        );
        if (variants.length === 0) {
          const hit =
            [...imageModels, ...videoModels, ...musicModels, ...speechModels].find(
              (m) => m.model_id === prev
            ) ?? null;
          variants = hit ? [hit] : [];
        }

        const resolvedId = resolveGenerationModelId({
          baseCardId: cur.baseCardId,
          settings: nextSettings,
          variants,
        });

        // General fallback guard: if the resolved model ID round-trips back
        // to different settings than the user intended, a variant-not-found
        // fallback occurred. Preserve the user's intended settings in
        // dialogModelSettings so the UI reflects their choice, and keep
        // selectedModelId unchanged.
        if (cur.registryEntry) {
          const parsed = resolveSelectionFromConcreteModelId(
            resolvedId, imageModels, videoModels, musicModels
          );
          const patchKeys = Object.keys(patch) as Array<keyof KubeezModelSettings>;
          const fallbackChanged = patchKeys.some((key) =>
            JSON.stringify(nextSettings[key]) !== JSON.stringify(parsed.settings[key])
          );

          if (fallbackChanged) {
            const override: Partial<KubeezModelSettings> = {};
            for (const key of patchKeys) {
              (override as Record<string, unknown>)[key] = nextSettings[key];
            }
            setDialogModelSettings((s) => ({ ...s, ...override }));
            return prev;
          }

          // Exact match — clear any previous overrides for the patched keys
          setDialogModelSettings((s) => {
            const next = { ...s };
            let changed = false;
            for (const key of patchKeys) {
              if (key in next) {
                delete (next as Record<string, unknown>)[key];
                changed = true;
              }
            }
            return changed ? next : s;
          });
        }

        return resolvedId;
      });
    },
    [imageModels, videoModels, musicModels, speechModels]
  );

  const selectedModel = useMemo(
    () => allModels.find((m) => m.model_id === selectedModelId) ?? null,
    [allModels, selectedModelId]
  );

  /** Catalog row for the resolved concrete model (correct limits when a family card applies). */
  const uiModel = useMemo(() => {
    const rid = resolvedSelection.resolvedModelId;
    const byResolved = allModels.find((m) => m.model_id === rid);
    if (byResolved) return byResolved;
    const bySelected = allModels.find((m) => m.model_id === selectedModelId);
    if (bySelected) return bySelected;
    // Never fall back to an image model when a music/speech id is selected but missing from the live list.
    const musicStub =
      FALLBACK_MUSIC_MODELS.find((m) => m.model_id === rid) ??
      FALLBACK_MUSIC_MODELS.find((m) => m.model_id === selectedModelId) ??
      KUBEEZ_OFFLINE_BROWSE.musicModels.find((m) => m.model_id === rid) ??
      KUBEEZ_OFFLINE_BROWSE.musicModels.find((m) => m.model_id === selectedModelId);
    if (musicStub) return musicStub;
    if (rid === KUBEEZ_SPEECH_DIALOGUE_MODEL.model_id || selectedModelId === KUBEEZ_SPEECH_DIALOGUE_MODEL.model_id) {
      return KUBEEZ_SPEECH_DIALOGUE_MODEL;
    }
    return selectedModel ?? undefined;
  }, [allModels, resolvedSelection.resolvedModelId, selectedModelId, selectedModel]);

  const isVideoModel = uiModel?.mediaKind === 'video';
  const isMusicModel = uiModel?.mediaKind === 'music';
  const isSpeechModel = uiModel?.mediaKind === 'speech';

  const jobGenerationVariants = useMemo(() => {
    let variants = getVariantsForBaseCardId(
      resolvedSelection.baseCardId,
      imageModels,
      videoModels,
      musicModels
    );
    if (variants.length === 0 && uiModel) variants = [uiModel];
    return variants;
  }, [resolvedSelection.baseCardId, imageModels, videoModels, musicModels, uiModel]);

  /** Concrete `model_id` sent on generate — keep UI readiness in sync with submit validation. */
  const mediaGenModelIdForDialog = useMemo(() => {
    if (!uiModel) return resolvedSelection.resolvedModelId;
    if (uiModel.mediaKind === 'speech') return selectedModelId || uiModel.model_id;
    return resolveGenerationModelId({
      baseCardId: resolvedSelection.baseCardId,
      settings: effectiveSettings,
      variants: jobGenerationVariants,
    });
  }, [
    uiModel,
    resolvedSelection.baseCardId,
    resolvedSelection.resolvedModelId,
    selectedModelId,
    effectiveSettings,
    jobGenerationVariants,
  ]);

  /** Cost for the concrete model variant that will be used on generate. */
  const generationCost = useMemo((): number | undefined => {
    const genModel = allModels.find((m) => m.model_id === mediaGenModelIdForDialog);
    if (typeof genModel?.cost_per_generation === 'number') return genModel.cost_per_generation;
    return uiModel?.cost_per_generation;
  }, [allModels, mediaGenModelIdForDialog, uiModel?.cost_per_generation]);

  const referenceFileLimit = useMemo(
    () =>
      effectiveMaxReferenceFilesForGenerateDialog(uiModel ?? null, {
        resolvedModelId: resolvedSelection.resolvedModelId,
        baseCardId: resolvedSelection.baseCardId,
        settings: effectiveSettings,
      }),
    [uiModel, resolvedSelection.baseCardId, resolvedSelection.resolvedModelId, effectiveSettings]
  );

  const effectiveReferenceAttachments = useMemo((): ReferenceAttachment[] => {
    if (isKlingMotionControlModelId(mediaGenModelIdForDialog)) {
      const out: ReferenceAttachment[] = [];
      if (motionRefImage) out.push(motionRefImage);
      if (motionRefVideo) out.push(motionRefVideo);
      return out;
    }
    return referenceAttachments;
  }, [mediaGenModelIdForDialog, motionRefImage, motionRefVideo, referenceAttachments]);

  /** Hide entirely when model accepts no reference files (e.g. z-image). Still show when limit is unknown. */
  const showReferenceSection =
    !isMusicModel && !isSpeechModel && referenceFileLimit !== 0;

  const promptFieldGroup = isMusicModel ? 'music' : isSpeechModel ? 'speech' : 'media';

  const promptMaxChars = useMemo(() => {
    if (!uiModel) return undefined;
    if (uiModel.mediaKind === 'music') return uiModel.prompt_max_chars ?? 400;
    if (uiModel.mediaKind === 'speech') return 5000;
    return uiModel.prompt_max_chars;
  }, [uiModel]);

  const promptLabel = isSpeechModel ? 'Script' : isMusicModel ? 'Music prompt' : 'Prompt';
  const promptPlaceholder = isSpeechModel
    ? 'What should the voice say? (single-speaker; use Kubeez for multi-line dialogue in the app.)'
    : isMusicModel
      ? 'Genre, mood, instruments, tempo…'
      : 'Describe what to generate…';

  const showAspectRatioControl =
    uiModel?.mediaKind === 'image' && uiModel.showAspectRatio !== false;
  const aspectChoices = useMemo(() => {
    if (!showAspectRatioControl) return [];
    const o = uiModel?.aspectRatioOptions;
    return o?.length ? o : [...ASPECT_OPTIONS];
  }, [showAspectRatioControl, uiModel?.aspectRatioOptions]);

  const resolvedModelId = resolvedSelection.resolvedModelId;

  const videoVariantEncodedInModelId = useMemo(
    () => Boolean(isVideoModel && videoModelIdEncodesVariantParams(resolvedModelId)),
    [isVideoModel, resolvedModelId]
  );

  const showDurationControl = Boolean(
    isVideoModel &&
      !videoVariantEncodedInModelId &&
      (uiModel?.durationOptions?.length ?? 0) > 0
  );

  const referenceRequirementBlocked = useMemo(() => {
    if (isMusicModel || isSpeechModel || !uiModel) return false;
    return !referenceAttachmentsMeetMinimum({
      resolvedModelId: mediaGenModelIdForDialog,
      baseCardId: resolvedSelection.baseCardId,
      settings: effectiveSettings,
      uiModel,
      attachments: effectiveReferenceAttachments,
      maxReferenceFiles: referenceFileLimit,
    });
  }, [
    isMusicModel,
    isSpeechModel,
    uiModel,
    mediaGenModelIdForDialog,
    resolvedSelection.baseCardId,
    effectiveSettings,
    effectiveReferenceAttachments,
    referenceFileLimit,
  ]);

  const isMotionControlUi = isKlingMotionControlModelId(mediaGenModelIdForDialog);

  const videoFooterHint = useMemo(() => {
    const m = uiModel;
    if (!m || m.mediaKind !== 'video') return null;
    if (m.supportsImageToVideo && !m.supportsTextToVideo) {
      return 'This model requires reference media (e.g. first frame). Upload under Reference media, then generate.';
    }
    if (m.supportsImageToVideo && m.supportsTextToVideo) {
      return 'Text-to-video without uploads, or add reference media for image-to-video. Duration applies when the model supports it.';
    }
    return null;
  }, [uiModel]);

  const modelFamilyForSelection = useMemo(() => {
    if (!uiModel) return null;
    if (uiModel.mediaKind === 'image') {
      return findModelFamilyGridItemForModelId(imageModels, selectedModelId);
    }
    if (uiModel.mediaKind === 'video') {
      return findModelFamilyGridItemForModelId(videoModels, selectedModelId);
    }
    if (uiModel.mediaKind === 'music') {
      return findModelFamilyGridItemForModelId(musicModels, selectedModelId);
    }
    return null;
  }, [uiModel, imageModels, videoModels, musicModels, selectedModelId]);

  useEffect(() => {
    if (open && openWasFalse.current) {
      setPromptResetKey((k) => k + 1);
    }
    openWasFalse.current = !open;
  }, [open]);

  useEffect(() => {
    if (!uiModel || !showAspectRatioControl) return;
    const opts = uiModel.aspectRatioOptions;
    if (opts?.length) {
      setAspectRatio((prev) => (opts.includes(prev) ? prev : opts[0]!));
    }
  }, [selectedModelId, uiModel, showAspectRatioControl]);

  useEffect(() => {
    const opts = uiModel?.durationOptions;
    if (opts?.length) {
      setVideoDuration((prev) => {
        if (opts.includes(prev)) return prev;
        // For wide duration ranges (Kling 3.0 std/pro: 3s..15s, p-video: 1s..20s) the cheapest
        // option is usually too short — prefer a sensible default so users don't silently pay
        // for 3s clips when they meant 5s.
        if (opts.length > 3) {
          for (const preferred of ['5s', '4s', '6s', '8s']) {
            if (opts.includes(preferred)) return preferred;
          }
        }
        return opts[0]!;
      });
    } else {
      setVideoDuration('');
    }
  }, [selectedModelId, uiModel?.durationOptions]);

  useEffect(() => {
    if (!isVideoModel) {
      setVideoAspectRatio(undefined);
      return;
    }
    const ui = getVideoAspectUi(resolvedModelId, {
      veoMode: effectiveSettings.veo31?.mode,
    });
    if (!ui) {
      setVideoAspectRatio(undefined);
      return;
    }
    if (ui.force16x9) {
      setVideoAspectRatio('16:9');
      return;
    }
    setVideoAspectRatio((prev) => {
      const allowed = new Set(ui.options.map((o) => o.value));
      if (prev === undefined || !allowed.has(prev)) return ui.defaultValue;
      return prev;
    });
  }, [isVideoModel, resolvedModelId, effectiveSettings.veo31?.mode]);

  useEffect(() => {
    if (referenceFileLimit !== 0) return;
    setReferenceAttachments((prev) => {
      if (prev.length === 0) return prev;
      for (const r of prev) {
        if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
      }
      return [];
    });
  }, [referenceFileLimit, selectedModelId]);

  useEffect(() => {
    if (!open) {
      setIsStartingJob(false);
      setReferenceLibraryPickerOpen(false);
      setMotionImageLibraryPickerOpen(false);
      setMotionVideoLibraryPickerOpen(false);
      setReferenceAttachments((prev) => {
        for (const r of prev) {
          if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
        }
        return [];
      });
      return;
    }
    setModelTab('all');

    const apiKey = kubeezApiKey?.trim() ?? '';
    if (!apiKey) {
      setImageModels([...KUBEEZ_OFFLINE_BROWSE.imageModels]);
      setVideoModels([...KUBEEZ_OFFLINE_BROWSE.videoModels]);
      setMusicModels([...KUBEEZ_OFFLINE_BROWSE.musicModels]);
      setSelectedModelId((prev) => {
        const flat = [
          ...KUBEEZ_OFFLINE_BROWSE.imageModels,
          ...KUBEEZ_OFFLINE_BROWSE.videoModels,
          ...KUBEEZ_OFFLINE_BROWSE.musicModels,
          KUBEEZ_SPEECH_DIALOGUE_MODEL,
        ];
        return flat.some((m) => m.model_id === prev) ? prev : DEFAULT_MODEL_ID;
      });
      setModelsLoading(false);
      return;
    }

    const ac = new AbortController();
    let cancelled = false;

    let hydratedFromCache = false;
    const rawCache = readKubeezGroupedModelsCache();
    if (rawCache) {
      const filteredImage = filterKubeezCutCatalogModels(rawCache.imageModels);
      const filteredVideo = filterKubeezCutCatalogModels(rawCache.videoModels);
      const filteredMusic = filterKubeezCutCatalogModels(rawCache.musicModels);
      const hasAnyModels =
        filteredImage.length > 0 || filteredVideo.length > 0 || filteredMusic.length > 0;
      if (hasAnyModels) {
        hydratedFromCache = true;
        const imageModels =
          filteredImage.length > 0 ? filteredImage : [...KUBEEZ_OFFLINE_BROWSE.imageModels];
        const videoModels = filteredVideo;
        const musicModels =
          filteredMusic.length > 0 ? filteredMusic : [...KUBEEZ_OFFLINE_BROWSE.musicModels];
        setImageModels(imageModels);
        setVideoModels(videoModels);
        setMusicModels(musicModels);
        setSelectedModelId((prev) =>
          pickSelectedModelIdAfterGroupedLoad(prev, imageModels, videoModels, musicModels)
        );
      }
    }

    // Instant UI from localStorage cache; only block the grid on first load with no cache.
    setModelsLoading(!hydratedFromCache);

    // If cache is fresh (< 5 min), skip the live API call entirely.
    // Prices rarely change — this prevents unnecessary fetches on every dialog open.
    if (hydratedFromCache && isModelsCacheFresh()) {
      setModelsLoading(false);
      return () => { cancelled = true; ac.abort(); };
    }

    fetchKubeezGroupedMediaModels({
      apiKey,
      baseUrl: kubeezApiBaseUrl?.trim() || undefined,
      signal: ac.signal,
    })
      .then((result) => {
        if (cancelled) return;
        setImageModels(result.imageModels);
        setVideoModels(result.videoModels);
        setMusicModels(result.musicModels);

        setMusicInstrumental(false);
        setDialogueVoice(KUBEEZ_DEFAULT_DIALOGUE_VOICE_ID);
        setDialogueLanguage('auto');
        setDialogueStability('0.5');

        setSelectedModelId((prev) =>
          pickSelectedModelIdAfterGroupedLoad(
            prev,
            result.imageModels,
            result.videoModels,
            result.musicModels
          )
        );
      })
      .catch((e) => {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        if (import.meta.env.DEV) {
          logger.debug('Kubeez grouped models fetch failed', e);
        }
        setImageModels([...KUBEEZ_OFFLINE_BROWSE.imageModels]);
        setVideoModels([...KUBEEZ_OFFLINE_BROWSE.videoModels]);
        setMusicModels([...KUBEEZ_OFFLINE_BROWSE.musicModels]);
        setSelectedModelId((prev) => {
          const flat = [
            ...KUBEEZ_OFFLINE_BROWSE.imageModels,
            ...KUBEEZ_OFFLINE_BROWSE.videoModels,
            ...KUBEEZ_OFFLINE_BROWSE.musicModels,
            KUBEEZ_SPEECH_DIALOGUE_MODEL,
          ];
          return flat.some((m) => m.model_id === prev) ? prev : DEFAULT_MODEL_ID;
        });
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [open, kubeezApiKey, kubeezApiBaseUrl]);

  const handleSubmit = useCallback(async () => {
    const trimmed = promptRef.current.trim();
    if (!trimmed) {
      toast.error(
        uiModel?.mediaKind === 'speech'
          ? 'Enter the script to speak.'
          : uiModel?.mediaKind === 'music'
            ? 'Enter a music prompt.'
            : 'Enter a prompt.'
      );
      return;
    }

    const apiKey = kubeezApiKey?.trim() ?? '';
    if (!apiKey) {
      toast.error('Add your Kubeez API key in Settings.', {
        action: {
          label: 'Open Settings',
          onClick: () => {
            markReopenGenerateAfterSettings();
            void navigate({ ...SETTINGS_KUBEEZ_API_LINK_PROPS });
          },
        },
      });
      return;
    }

    const modelId = selectedModelId || uiModel?.model_id;
    if (!modelId || !uiModel) {
      toast.error('Select a model.');
      return;
    }

    const isMusic = uiModel.mediaKind === 'music';
    const isSpeech = uiModel.mediaKind === 'speech';

    const resolved = resolveSelectionFromConcreteModelId(
      selectedModelId,
      imageModels,
      videoModels,
      musicModels
    );
    const submitSettings: KubeezModelSettings = { ...resolved.settings, ...dialogModelSettings };
    let variants = getVariantsForBaseCardId(
      resolved.baseCardId,
      imageModels,
      videoModels,
      musicModels
    );
    if (variants.length === 0 && uiModel) {
      variants = [uiModel];
    }
    const mediaGenModelId = isSpeech
      ? modelId
      : resolveGenerationModelId({
          baseCardId: resolved.baseCardId,
          settings: submitSettings,
          variants,
        });

    if (!isMusic && !isSpeech && uiModel) {
      if (
        !referenceAttachmentsMeetMinimum({
          resolvedModelId: mediaGenModelId,
          baseCardId: resolved.baseCardId,
          settings: submitSettings,
          uiModel,
          attachments: effectiveReferenceAttachments,
          maxReferenceFiles: referenceFileLimit,
        })
      ) {
        toast.error('Add the required reference files for this model before generating.');
        return;
      }
    }

    if (!isMusic && !isSpeech && referenceFileLimit !== undefined) {
      if (referenceFileLimit === 0 && effectiveReferenceAttachments.length > 0) {
        toast.error('This model does not accept reference files.');
        return;
      }
      if (referenceFileLimit > 0 && effectiveReferenceAttachments.length > referenceFileLimit) {
        toast.error(
          `This model allows at most ${referenceFileLimit} reference file(s). Remove extras and try again.`
        );
        return;
      }
      const maxChars = uiModel.prompt_max_chars;
      if (maxChars !== undefined && trimmed.length > maxChars) {
        toast.error(`Prompt is too long for this model (max ${maxChars} characters).`);
        return;
      }
    }

    if (isMusic) {
      const maxM = uiModel.prompt_max_chars ?? 400;
      if (trimmed.length > maxM) {
        toast.error(`Music prompt is too long (max ${maxM} characters).`);
        return;
      }
    }

    if (isSpeech && trimmed.length > 5000) {
      toast.error('Script is too long (max 5000 characters).');
      return;
    }

    const projectId = currentProject?.id;
    if (!projectId) {
      toast.error('No project loaded.');
      return;
    }

    const canvasWidth = currentProject?.metadata.width ?? 1920;
    const canvasHeight = currentProject?.metadata.height ?? 1080;

    const isVideo = uiModel.mediaKind === 'video';
    const baseUrl = kubeezApiBaseUrl?.trim() || undefined;

    const videoAspectUi = isVideo
      ? getVideoAspectUi(mediaGenModelId, { veoMode: submitSettings.veo31?.mode })
      : null;
    const includeAspectRatioForVideo = shouldIncludeVideoAspectRatio(videoAspectUi, videoAspectRatio);
    const aspectRatioForMedia = isVideo
      ? videoAspectRatioForRequest(videoAspectUi, videoAspectRatio)
      : aspectRatio;

    setIsStartingJob(true);
    try {
      const jobId = crypto.randomUUID();
      const filterMimeCategory: 'image' | 'video' | 'audio' =
        uiModel.mediaKind === 'video'
          ? 'video'
          : uiModel.mediaKind === 'image'
            ? 'image'
            : 'audio';

      useMediaLibraryStore.getState().registerKubeezPendingGeneration({
        id: jobId,
        projectId,
        label: trimmed.length > 200 ? `${trimmed.slice(0, 197)}…` : trimmed,
        modelDisplayName: uiModel.display_name,
        filterMimeCategory,
        createdAt: Date.now(),
        status: 'generating',
        estimatedTimeSeconds: uiModel.estimatedTimeSeconds,
      });

      const playheadFrame = Math.max(0, Math.round(usePlaybackStore.getState().currentFrame));

      if (isMusic) {
        void runKubeezGenerateJobInBackground(jobId, {
          apiKey,
          baseUrl,
          projectId,
          prompt: trimmed,
          mode: 'music',
          mediaGenModelId,
          musicInstrumental,
          timelinePlacement,
          playheadFrame,
          fps,
          canvasWidth,
          canvasHeight,
        });
      } else if (isSpeech) {
        const stability = Math.min(1, Math.max(0, Number.parseFloat(dialogueStability) || 0.5));
        void runKubeezGenerateJobInBackground(jobId, {
          apiKey,
          baseUrl,
          projectId,
          prompt: trimmed,
          mode: 'speech',
          mediaGenModelId,
          speechVoice: dialogueVoice,
          speechLanguage: dialogueLanguage,
          speechStability: stability,
          timelinePlacement,
          playheadFrame,
          fps,
          canvasWidth,
          canvasHeight,
        });
      } else {
        void runKubeezGenerateJobInBackground(jobId, {
          apiKey,
          baseUrl,
          projectId,
          prompt: trimmed,
          mode: 'image_video',
          mediaGenModelId,
          imageVideo: {
            isVideo,
            aspectRatio: aspectRatioForMedia,
            videoDuration:
              isVideo && videoDuration && !videoModelIdEncodesVariantParams(mediaGenModelId)
                ? videoDuration
                : undefined,
            includeAspectRatio: isVideo
              ? includeAspectRatioForVideo
              : uiModel.showAspectRatio !== false,
            referenceFiles: effectiveReferenceAttachments.map((r) => r.file),
            quality:
              mediaGenModelId === 'p-image-edit' && (submitSettings.pImageEditTurbo ?? true)
                ? 'turbo'
                : isSeedreamQualityModel(mediaGenModelId)
                  ? imageQuality
                  : undefined,
            resolution:
              mediaGenModelId === 'gpt-image-2'
                ? ({ '1k': '1K', '2k': '2K', '4k': '4K' } as const)[submitSettings.imageResolution ?? '1k']
                : undefined,
          },
          timelinePlacement,
          playheadFrame,
          fps,
          canvasWidth,
          canvasHeight,
        });
      }

      toast.message('Generating in background — watch the library for progress.');
      if (typeof generationCost === 'number') {
        deductCredits(generationCost);
      } else {
        refreshCredits();
      }
      setPromptResetKey((k) => k + 1);
      setReferenceAttachments((prev) => {
        for (const r of prev) {
          if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
        }
        return [];
      });
      setMotionRefImage((p) => {
        if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
        return null;
      });
      setMotionRefVideo((p) => {
        if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
        return null;
      });
    } finally {
      setIsStartingJob(false);
    }
  }, [
    aspectRatio,
    videoAspectRatio,
    currentProject?.id,
    currentProject?.metadata.height,
    currentProject?.metadata.width,
    dialogueLanguage,
    dialogueStability,
    dialogueVoice,
    fps,
    imageQuality,
    imageModels,
    kubeezApiBaseUrl,
    kubeezApiKey,
    musicInstrumental,
    musicModels,
    onOpenChange,
    effectiveReferenceAttachments,
    referenceFileLimit,
    uiModel,
    selectedModelId,
    speechModels,
    timelinePlacement,
    videoDuration,
    videoModels,
    referenceRequirementBlocked,
    dialogModelSettings,
    generationCost,
    deductCredits,
    refreshCredits,
  ]);

  const addReferenceFiles = useCallback((fileList: FileList | File[]) => {
    if (isKlingMotionControlModelId(mediaGenModelIdForDialog)) {
      toast.message('Use Ref image and Ref video for this model.');
      return;
    }
    const raw = Array.from(fileList);
    const mid = resolvedSelection.resolvedModelId;
    const allowed = raw.filter(
      (file) =>
        isKubeezReferenceMimeAllowed(file) && isKubeezReferenceFileSizeAllowedForModel(file, mid)
    );
    const droppedMime = raw.filter((f) => !isKubeezReferenceMimeAllowed(f));
    const droppedSize = raw.filter(
      (f) => isKubeezReferenceMimeAllowed(f) && !isKubeezReferenceFileSizeAllowedForModel(f, mid)
    );
    if (droppedMime.length > 0) {
      toast.error('Some files were skipped (type not allowed)', {
        description: 'Allowed: JPEG, PNG, WebP, MP4, QuickTime, Matroska, or audio files.',
      });
    }
    if (droppedSize.length > 0) {
      const capBytes = Math.min(getMaxFileSizeForModel(mid, droppedSize[0]?.type), MAX_INPUT_FILE_SIZE);
      toast.error('Some files were skipped (too large)', {
        description: `Max ${getFileSizeInMB(capBytes)} MB per file for this model (Kubeez web file limits).`,
      });
    }
    const incoming = allowed;
    if (incoming.length === 0) return;
    setReferenceAttachments((prev) => {
      const cap = referenceFileLimit;
      if (cap === undefined) {
        toast.error(
          'Reference upload limit is unknown for this model. Load models from Kubeez or see https://kubeez.com/docs/rest-api-model-requirements.'
        );
        return prev;
      }
      const room = cap - prev.length;
      if (cap <= 0) {
        toast.error('This model does not accept reference files.');
        return prev;
      }
      if (room <= 0) {
        toast.error(`You can attach at most ${cap} file(s) for this model.`);
        return prev;
      }
      const take = incoming.slice(0, room);
      if (incoming.length > room) {
        toast.message(`Only the first ${room} file(s) were added (max ${cap} for this model).`);
      }
      const added: ReferenceAttachment[] = take.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      }));
      return [...prev, ...added];
    });
  }, [referenceFileLimit, resolvedSelection.resolvedModelId, mediaGenModelIdForDialog]);

  const removeMotionRefImage = useCallback(() => {
    setMotionRefImage((p) => {
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return null;
    });
  }, []);

  const removeMotionRefVideo = useCallback(() => {
    setMotionRefVideo((p) => {
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
      return null;
    });
  }, []);

  const addMotionRefImage = useCallback(
    (fileList: FileList | File[]) => {
      const file = Array.from(fileList)[0];
      if (!file) return;
      const mid = mediaGenModelIdForDialog;
      if (!file.type.startsWith('image/') || !isKubeezReferenceMimeAllowed(file)) {
        toast.error('Choose a reference image (JPEG, PNG, or WebP).');
        return;
      }
      if (!isKubeezReferenceFileSizeAllowedForModel(file, mid)) {
        const capBytes = Math.min(getMaxFileSizeForModel(mid, file.type), MAX_INPUT_FILE_SIZE);
        toast.error('Image is too large for this model.', {
          description: `Max ${getFileSizeInMB(capBytes)} MB per file (Kubeez web limits).`,
        });
        return;
      }
      setMotionRefImage((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return {
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
        };
      });
    },
    [mediaGenModelIdForDialog]
  );

  const addMotionRefVideo = useCallback(
    (fileList: FileList | File[]) => {
      const file = Array.from(fileList)[0];
      if (!file) return;
      const mid = mediaGenModelIdForDialog;
      if (!file.type.startsWith('video/') || !isKubeezReferenceMimeAllowed(file)) {
        toast.error('Choose a reference video (MP4, QuickTime, or Matroska).');
        return;
      }
      if (!isKubeezReferenceFileSizeAllowedForModel(file, mid)) {
        const capBytes = Math.min(getMaxFileSizeForModel(mid, file.type), MAX_INPUT_FILE_SIZE);
        toast.error('Video is too large for this model.', {
          description: `Max ${getFileSizeInMB(capBytes)} MB per file (Kubeez web limits).`,
        });
        return;
      }
      setMotionRefVideo((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return {
          id: crypto.randomUUID(),
          file,
          previewUrl: null,
        };
      });
    },
    [mediaGenModelIdForDialog]
  );

  const removeReferenceAttachment = useCallback((id: string) => {
    setReferenceAttachments((prev) => {
      const item = prev.find((r) => r.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  const libraryMediaToReferenceFile = useCallback((meta: MediaMetadata, blob: Blob): File => {
    if (blob instanceof File) return blob;
    return new File([blob], meta.fileName, { type: meta.mimeType });
  }, []);

  const addReferenceFromLibrary = useCallback(
    async (mediaId: string) => {
      const meta = useMediaLibraryStore.getState().mediaItems.find((m) => m.id === mediaId);
      if (!meta) {
        toast.error('That media item is no longer in the library.');
        return;
      }
      try {
        const blob = await mediaLibraryService.getMediaFile(mediaId);
        if (!blob) {
          toast.error('Could not read the file from the library.');
          return;
        }
        const file = libraryMediaToReferenceFile(meta, blob);
        addReferenceFiles([file]);
      } catch (e) {
        if (e instanceof FileAccessError) {
          toast.error(e.message);
          return;
        }
        logger.error('Reference from library failed', e);
        toast.error('Could not load media from the library.');
      }
    },
    [addReferenceFiles, libraryMediaToReferenceFile]
  );

  const addMotionRefImageFromLibrary = useCallback(
    async (mediaId: string) => {
      const meta = useMediaLibraryStore.getState().mediaItems.find((m) => m.id === mediaId);
      if (!meta) {
        toast.error('That media item is no longer in the library.');
        return;
      }
      if (!meta.mimeType.startsWith('image/')) {
        toast.error('Choose an image from the library.');
        return;
      }
      try {
        const blob = await mediaLibraryService.getMediaFile(mediaId);
        if (!blob) {
          toast.error('Could not read the file from the library.');
          return;
        }
        const file = libraryMediaToReferenceFile(meta, blob);
        addMotionRefImage([file]);
      } catch (e) {
        if (e instanceof FileAccessError) {
          toast.error(e.message);
          return;
        }
        logger.error('Motion reference image from library failed', e);
        toast.error('Could not load media from the library.');
      }
    },
    [addMotionRefImage, libraryMediaToReferenceFile]
  );

  const addMotionRefVideoFromLibrary = useCallback(
    async (mediaId: string) => {
      const meta = useMediaLibraryStore.getState().mediaItems.find((m) => m.id === mediaId);
      if (!meta) {
        toast.error('That media item is no longer in the library.');
        return;
      }
      if (!meta.mimeType.startsWith('video/')) {
        toast.error('Choose a video from the library.');
        return;
      }
      try {
        const blob = await mediaLibraryService.getMediaFile(mediaId);
        if (!blob) {
          toast.error('Could not read the file from the library.');
          return;
        }
        const file = libraryMediaToReferenceFile(meta, blob);
        addMotionRefVideo([file]);
      } catch (e) {
        if (e instanceof FileAccessError) {
          toast.error(e.message);
          return;
        }
        logger.error('Motion reference video from library failed', e);
        toast.error('Could not load media from the library.');
      }
    },
    [addMotionRefVideo, libraryMediaToReferenceFile]
  );

  const missingKey = !hasKubeezAuth;
  const libraryOnly = !timelinePlacement;

  const referenceLabel =
    isVideoModel && uiModel?.supportsImageToVideo && !uiModel?.supportsTextToVideo
      ? 'Reference media (required)'
      : 'Reference media';

  const referenceHelperText =
    referenceFileLimit === undefined
      ? 'Reference limits follow each model in the Kubeez API/docs. If uploads stay disabled, sync models from your API key or see kubeez.com/docs/rest-api-model-requirements.'
      : isVideoModel && uiModel?.supportsImageToVideo
        ? 'Upload reference frame(s) or clip for image-to-video when required by the model.'
        : 'Optional for image models — sent as source_media_urls for image-to-image/editing.';

  const canPickReferenceFromLibrary =
    !isStartingJob &&
    !missingKey &&
    referenceFileLimit !== undefined &&
    referenceFileLimit > 0 &&
    referenceAttachments.length < referenceFileLimit;

  const motionRefLibraryDisabled = isStartingJob || missingKey;

  const libraryFilterKubeezReference = useCallback(
    (m: MediaMetadata) => isKubeezReferenceMimeTypeStringAllowed(m.mimeType),
    []
  );

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="duration-300 ease-out motion-reduce:duration-100"
        className="flex h-[min(94vh,860px)] w-[min(96vw,64rem)] max-w-[min(96vw,64rem)] flex-col gap-0 overflow-hidden border-border/80 bg-background p-0 shadow-2xl shadow-black/50 sm:rounded-2xl
          duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
          data-[state=open]:zoom-in-[0.98] data-[state=closed]:zoom-out-[0.98]
          data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-3
          motion-reduce:duration-150 motion-reduce:data-[state=open]:slide-in-from-bottom-0 motion-reduce:data-[state=closed]:slide-out-to-bottom-0 motion-reduce:data-[state=open]:zoom-in-100 motion-reduce:data-[state=closed]:zoom-out-100"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/80 bg-muted/15 px-4 py-2 sm:px-5">
          <div className="flex items-center gap-2.5">
            <img
              src={KUBEEZ_BRAND_LOGO_URL}
              alt="Kubeez"
              width={28}
              height={28}
              decoding="async"
              className="h-7 w-7 shrink-0 rounded-lg object-contain"
            />
            <DialogHeader className="space-y-0 text-left">
              <DialogTitle className="text-sm font-semibold leading-tight">Generate media</DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground">
                {libraryOnly ? 'Saved to library' : `Track \u201c${timelinePlacement.trackName}\u201d`}
                {' \u00b7 Powered by Kubeez'}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="flex items-center gap-2" />
        </div>

        {missingKey && (
          <div className="mx-4 mt-3 sm:mx-5">
            <div
              className="flex gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs"
              role="status"
              aria-live="polite"
            >
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-muted-foreground">
                Add a Kubeez API key in{' '}
                <Link
                  {...SETTINGS_KUBEEZ_API_LINK_PROPS}
                  onClick={markReopenGenerateAfterSettings}
                  className="text-foreground underline underline-offset-2 hover:text-primary"
                >
                  Settings
                </Link>{' '}
                to generate. Get one at{' '}
                <a href="https://kubeez.com" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2 hover:text-primary">
                  kubeez.com
                </a>.
              </p>
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden px-3 py-2.5 sm:px-4 lg:flex-row lg:items-stretch">
          <KubeezGenerateModelsColumn
            missingKey={missingKey}
            imageModels={imageModels}
            videoModels={videoModels}
            musicModels={musicModels}
            speechModels={speechModels}
            allModelsSorted={allModelsSorted}
            modelTab={modelTab}
            onModelTabChange={setModelTab}
            selectedModelId={selectedModelId}
            onSelectModelId={setSelectedModelId}
            busy={isStartingJob}
            modelsLoading={modelsLoading}
          />

          <div className="mt-3 flex min-h-0 w-full min-w-0 flex-1 flex-col border-t border-border/50 pt-3 lg:mt-0 lg:w-72 lg:flex-none lg:self-stretch lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <KubeezGenerateSelectedModelPanel
              model={uiModel ?? null}
              selectedModelId={selectedModelId}
              resolvedModelId={resolvedSelection.resolvedModelId}
              onSelectModelId={setSelectedModelId}
              modelSettings={effectiveSettings}
              onPatchModelSettings={patchModelSettings}
              videoAspectRatio={videoAspectRatio}
              onVideoAspectRatioChange={setVideoAspectRatio}
              modelFamilyItem={modelFamilyForSelection}
              videoFooterHint={videoFooterHint}
              busy={isStartingJob}
              modelsLoading={modelsLoading}
              generationCost={generationCost}
            />
            <KubeezGeneratePromptField
              key={`${promptFieldGroup}-${promptResetKey}`}
              disabled={isStartingJob}
              maxChars={promptMaxChars}
              resetKey={promptResetKey}
              promptRef={promptRef}
              label={promptLabel}
              placeholder={promptPlaceholder}
              fieldId={`kubeez-prompt-${promptFieldGroup}`}
            />

            {isMusicModel && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/15 px-3 py-2.5">
                <div className="min-w-0 space-y-0.5">
                  <Label htmlFor="kubeez-music-instrumental" className="text-foreground/90">
                    Instrumental
                  </Label>
                  <p className="text-[11px] text-muted-foreground">No vocals — matches Kubeez music API.</p>
                </div>
                <Switch
                  id="kubeez-music-instrumental"
                  checked={musicInstrumental}
                  onCheckedChange={setMusicInstrumental}
                  disabled={isStartingJob}
                  aria-label="Instrumental music only"
                />
              </div>
            )}

            {isSpeechModel && (
              <div className="grid min-h-0 gap-3 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-1">
                  <Label className="text-foreground/90">Voice</Label>
                  <Select value={dialogueVoice} onValueChange={setDialogueVoice} disabled={isStartingJob}>
                    <SelectTrigger className="border-border/70 bg-card/50 shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[min(340px,50vh)]">
                      {KUBEEZ_DIALOGUE_VOICE_OPTIONS.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-1">
                  <Label className="text-foreground/90">Language</Label>
                  <Select value={dialogueLanguage} onValueChange={setDialogueLanguage} disabled={isStartingJob}>
                    <SelectTrigger className="border-border/70 bg-card/50 shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[min(280px,50vh)]">
                      {KUBEEZ_DIALOGUE_LANGUAGE_OPTIONS.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label className="text-foreground/90">Stability</Label>
                  <Select value={dialogueStability} onValueChange={setDialogueStability} disabled={isStartingJob}>
                    <SelectTrigger className="border-border/70 bg-card/50 shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[min(280px,50vh)]">
                      <SelectItem value="0">0 (more expressive)</SelectItem>
                      <SelectItem value="0.25">0.25</SelectItem>
                      <SelectItem value="0.5">0.5 (default)</SelectItem>
                      <SelectItem value="0.75">0.75</SelectItem>
                      <SelectItem value="1">1 (most stable)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {showReferenceSection &&
              (isMotionControlUi ? (
                <div className="shrink-0 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-foreground/90">Motion references</Label>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {referenceFileLimit === undefined
                        ? '—'
                        : `${effectiveReferenceAttachments.length}/${referenceFileLimit}`}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:gap-4">
                      <div className="min-w-0 space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/90">
                          Ref image
                        </p>
                        <input
                          ref={motionImageInputRef}
                          type="file"
                          className="sr-only"
                          accept={MOTION_IMAGE_ACCEPT}
                          disabled={isStartingJob || missingKey}
                          onChange={(e) => {
                            const list = e.target.files;
                            if (list?.length) addMotionRefImage(list);
                            e.target.value = '';
                          }}
                        />
                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isStartingJob || missingKey) return;
                            const files = e.dataTransfer.files;
                            if (files?.length) addMotionRefImage(files);
                          }}
                          className={cn(
                            'rounded-xl border border-dashed border-border/80 bg-muted/15 px-2 py-3 transition-colors',
                            'hover:border-foreground/20 hover:bg-muted/25',
                            (isStartingJob || missingKey) && 'pointer-events-none opacity-50'
                          )}
                        >
                          {!motionRefImage ? (
                            <button
                              type="button"
                              className="flex min-h-[7.5rem] w-full flex-col items-center justify-center gap-2 text-center"
                              disabled={isStartingJob || missingKey}
                              onClick={() => motionImageInputRef.current?.click()}
                            >
                              <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
                              <span className="text-xs text-muted-foreground">Add image</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 py-1.5 pl-1.5 pr-2">
                              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                                {motionRefImage.previewUrl ? (
                                  <img
                                    src={motionRefImage.previewUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                    <ImageIcon className="h-5 w-5" aria-hidden />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-foreground">
                                  {motionRefImage.file.name}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {(motionRefImage.file.size / 1024).toFixed(0)} KB
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                                disabled={isStartingJob}
                                onClick={removeMotionRefImage}
                                aria-label={`Remove ${motionRefImage.file.name}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-full text-xs text-primary hover:text-primary"
                          disabled={motionRefLibraryDisabled}
                          onClick={() => setMotionImageLibraryPickerOpen(true)}
                        >
                          From library
                        </Button>
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/90">
                          Ref video
                        </p>
                        <input
                          ref={motionVideoInputRef}
                          type="file"
                          className="sr-only"
                          accept={MOTION_VIDEO_ACCEPT}
                          disabled={isStartingJob || missingKey}
                          onChange={(e) => {
                            const list = e.target.files;
                            if (list?.length) addMotionRefVideo(list);
                            e.target.value = '';
                          }}
                        />
                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (isStartingJob || missingKey) return;
                            const files = e.dataTransfer.files;
                            if (files?.length) addMotionRefVideo(files);
                          }}
                          className={cn(
                            'rounded-xl border border-dashed border-border/80 bg-muted/15 px-2 py-3 transition-colors',
                            'hover:border-foreground/20 hover:bg-muted/25',
                            (isStartingJob || missingKey) && 'pointer-events-none opacity-50'
                          )}
                        >
                          {!motionRefVideo ? (
                            <button
                              type="button"
                              className="flex min-h-[7.5rem] w-full flex-col items-center justify-center gap-2 text-center"
                              disabled={isStartingJob || missingKey}
                              onClick={() => motionVideoInputRef.current?.click()}
                            >
                              <Video className="h-6 w-6 text-muted-foreground" aria-hidden />
                              <span className="text-xs text-muted-foreground">Add video</span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 py-1.5 pl-1.5 pr-2">
                              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                                <Film className="h-6 w-6 text-muted-foreground" aria-hidden />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-foreground">
                                  {motionRefVideo.file.name}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {(motionRefVideo.file.size / 1024).toFixed(0)} KB
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                                disabled={isStartingJob}
                                onClick={removeMotionRefVideo}
                                aria-label={`Remove ${motionRefVideo.file.name}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-full text-xs text-primary hover:text-primary"
                          disabled={motionRefLibraryDisabled}
                          onClick={() => setMotionVideoLibraryPickerOpen(true)}
                        >
                          From library
                        </Button>
                      </div>
                    </div>
                    {typeof generationCost === 'number' && (
                      <div className="shrink-0 self-center rounded-full border border-border/70 bg-muted/35 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        <span className="text-sm font-bold leading-none text-foreground tabular-nums">
                          {generationCost}
                        </span>{' '}
                        credits
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Add a still to match and a source clip for movement. Both are required before Generate
                    (sent as image then video).
                  </p>
                </div>
              ) : (
                <div className="shrink-0 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-foreground/90">{referenceLabel}</Label>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {referenceFileLimit === undefined
                        ? '—'
                        : `${effectiveReferenceAttachments.length}/${referenceFileLimit}`}
                    </span>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">{referenceHelperText}</p>
                  <input
                    ref={referenceFileInputRef}
                    type="file"
                    className="sr-only"
                    accept={KUBEEZ_REFERENCE_FILE_ACCEPT}
                    multiple
                    disabled={
                      isStartingJob ||
                      missingKey ||
                      referenceFileLimit === undefined ||
                      (referenceFileLimit > 0 && referenceAttachments.length >= referenceFileLimit)
                    }
                    onChange={(e) => {
                      const list = e.target.files;
                      if (list?.length) addReferenceFiles(list);
                      e.target.value = '';
                    }}
                  />
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isStartingJob || missingKey || referenceFileLimit === undefined) return;
                      const files = e.dataTransfer.files;
                      if (files?.length) addReferenceFiles(files);
                    }}
                    className={cn(
                      'rounded-xl border border-dashed border-border/70 bg-muted/15 px-3 py-3 transition-colors',
                      'hover:border-border hover:bg-muted/25',
                      (isStartingJob || missingKey || referenceFileLimit === undefined) &&
                        'pointer-events-none opacity-50'
                    )}
                  >
                    {referenceAttachments.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 text-center">
                        <Paperclip className="h-5 w-5 text-muted-foreground" aria-hidden />
                        <p className="text-xs text-muted-foreground">
                          Drop files here,{' '}
                          <button
                            type="button"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                            disabled={isStartingJob || missingKey || referenceFileLimit === undefined}
                            onClick={() => referenceFileInputRef.current?.click()}
                          >
                            browse
                          </button>
                          , or{' '}
                          <button
                            type="button"
                            className="font-medium text-primary underline-offset-2 hover:underline"
                            disabled={!canPickReferenceFromLibrary}
                            onClick={() => setReferenceLibraryPickerOpen(true)}
                          >
                            pick from library
                          </button>
                        </p>
                      </div>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {referenceAttachments.map((r) => (
                          <li
                            key={r.id}
                            className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 py-1.5 pl-1.5 pr-2"
                          >
                            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-md bg-muted">
                              {r.previewUrl ? (
                                <img src={r.previewUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                  <Film className="h-5 w-5" aria-hidden />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-foreground">{r.file.name}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {(r.file.size / 1024).toFixed(0)} KB
                                {r.file.type ? ` · ${r.file.type}` : ''}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                              disabled={isStartingJob}
                              onClick={() => removeReferenceAttachment(r.id)}
                              aria-label={`Remove ${r.file.name}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                        {referenceFileLimit != null &&
                          referenceFileLimit > 0 &&
                          referenceAttachments.length < referenceFileLimit && (
                            <div className="flex flex-col gap-1.5 sm:flex-row">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 flex-1 border-dashed"
                                disabled={isStartingJob || missingKey}
                                onClick={() => referenceFileInputRef.current?.click()}
                              >
                                <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                                Add more
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 flex-1 border-dashed"
                                disabled={!canPickReferenceFromLibrary}
                                onClick={() => setReferenceLibraryPickerOpen(true)}
                              >
                                From library
                              </Button>
                            </div>
                          )}
                      </ul>
                    )}
                  </div>
                </div>
              ))}

            {showDurationControl && uiModel?.durationOptions && (
              <div className="shrink-0 space-y-2">
                <Label className="text-foreground/90">Duration</Label>
                <Select value={videoDuration} onValueChange={setVideoDuration} disabled={isStartingJob}>
                  <SelectTrigger className="border-border/70 bg-card/50 shadow-sm">
                    <SelectValue placeholder="Select duration" />
                  </SelectTrigger>
                  <SelectContent>
                    {uiModel.durationOptions.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showAspectRatioControl && aspectChoices.length > 0 && (
              <div className="shrink-0 space-y-2">
                <Label className="text-foreground/90">Aspect ratio</Label>
                <div className="flex flex-wrap gap-1">
                  {aspectChoices.map((ar) => {
                    const active = aspectRatio === ar;
                    return (
                      <Button
                        key={ar}
                        type="button"
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        disabled={isStartingJob}
                        className="h-7 gap-1.5 px-2 text-[11px]"
                        onClick={() => setAspectRatio(ar)}
                      >
                        <AspectRatioIcon ratio={ar} active={active} />
                        {ar}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            {!isVideoModel && !isMusicModel && !isSpeechModel && uiModel && isSeedreamQualityModel(mediaGenModelIdForDialog) && (
              <div className="shrink-0 space-y-2">
                <Label className="text-foreground/90">Quality</Label>
                <div className="flex flex-wrap gap-1">
                  {getQualityOptions(mediaGenModelIdForDialog).map((opt) => {
                    const active = imageQuality === opt.value;
                    return (
                      <Button
                        key={opt.value}
                        type="button"
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        disabled={isStartingJob}
                        className="h-7 min-w-[3rem] px-2 text-[11px]"
                        onClick={() => setImageQuality(opt.value)}
                      >
                        {opt.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 items-center gap-2 border-t border-border bg-muted/10 px-4 py-2 sm:px-5">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={isStartingJob}>
            Cancel
          </Button>

          {typeof userCredits === 'number' && (
            <div className="flex items-center gap-1.5 rounded-full border border-border/50 bg-card/40 px-2.5 py-0.5">
              <span className="text-xs font-bold tabular-nums text-foreground">{Math.floor(userCredits).toLocaleString()}</span>
              <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">credits</span>
            </div>
          )}

          <div className="flex-1" />
          <Button type="button" size="sm" onClick={() => void handleSubmit()} disabled={isStartingJob || missingKey || referenceRequirementBlocked}>
            {isStartingJob
              ? 'Starting…'
              : libraryOnly
                ? 'Generate & add to library'
                : 'Generate'}
            {!isStartingJob && typeof generationCost === 'number' && (
              <span className="ml-1.5 rounded-md bg-primary-foreground/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                {generationCost} cr
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <MediaPickerDialog
      open={referenceLibraryPickerOpen}
      onClose={() => setReferenceLibraryPickerOpen(false)}
      onSelect={(id) => {
        void addReferenceFromLibrary(id);
      }}
      filterItem={libraryFilterKubeezReference}
      title="Reference from library"
      description="Choose an image or video already in this project's media library."
    />
    <MediaPickerDialog
      open={motionImageLibraryPickerOpen}
      onClose={() => setMotionImageLibraryPickerOpen(false)}
      onSelect={(id) => {
        void addMotionRefImageFromLibrary(id);
      }}
      filterType="image"
      filterItem={libraryFilterKubeezReference}
      title="Reference image from library"
      description="Choose a still image from your library for motion control."
    />
    <MediaPickerDialog
      open={motionVideoLibraryPickerOpen}
      onClose={() => setMotionVideoLibraryPickerOpen(false)}
      onSelect={(id) => {
        void addMotionRefVideoFromLibrary(id);
      }}
      filterType="video"
      filterItem={libraryFilterKubeezReference}
      title="Reference video from library"
      description="Choose a video clip from your library for motion control."
    />
    </>
  );
}
