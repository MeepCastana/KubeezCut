import { memo, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { KubeezMediaModelOption } from '@/infrastructure/kubeez/kubeez-models';
import {
  kubeezModelCardGradientBackground,
  pickFirstCardImageUrl,
  resolveKubeezModelCardHeroUrl,
} from '@/infrastructure/kubeez/kubeez-model-card-visual';
import { areModelsEquivalent } from '@/infrastructure/kubeez/model-equivalence';
import {
  defaultModelSettings,
  findRegistryEntryByBaseCardId,
  type KubeezModelSettings,
} from '@/infrastructure/kubeez/model-family-registry';
import { resolveGenerationModelId } from '@/infrastructure/kubeez/model-resolve';
import { getVideoAspectUi } from '@/infrastructure/kubeez/kubeez-video-aspect-ui';
import {
  buildKubeezModelGridItems,
  collectVideoFamilyAxes,
  kubeezModelGridItemContainsModelId,
  parseSelectionFromVideoVariantId,
  pickDefaultVariant,
  resolveVideoFamilySelection,
  type KubeezModelFamilyGridItem,
  type KubeezModelGridItem,
} from '@/infrastructure/kubeez/kubeez-video-model-variants';
import { Check, Clapperboard, ImageIcon, LayoutGrid, Loader2, Mic, Music2, Search } from 'lucide-react';
import { cn } from '@/shared/ui/cn';

export type ModelTab = 'all' | 'image' | 'video' | 'music' | 'speech';

const MODEL_GRID_CLASS =
  'grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3';

/** Visual rectangle icon showing the aspect ratio shape. */
export function AspectRatioIcon({ ratio, active }: { ratio: string; active: boolean }) {
  if (ratio === 'auto') return null;
  const parts = ratio.split(':').map(Number);
  const w = parts[0] ?? 1;
  const h = parts[1] ?? 1;
  const isSquare = w === h;
  const isPortrait = h > w;
  const style: React.CSSProperties = isSquare
    ? { width: 12, height: 12, borderRadius: 2 }
    : isPortrait
      ? { width: 9, height: 14, borderRadius: 2 }
      : { width: 14, height: 9, borderRadius: 2 };
  return (
    <div
      className={cn(
        'shrink-0 border-[1.5px]',
        active
          ? 'border-primary-foreground bg-primary-foreground/20'
          : 'border-foreground/40 bg-foreground/10',
      )}
      style={style}
    />
  );
}

/** Edit variants that are auto-routed when the user attaches media — hide from the variant picker. */
const AUTO_ROUTED_EDIT_IDS = new Set([
  'flux-2-edit-1K',
  'flux-2-edit-2K',
  'seedream-v4-edit',
  'seedream-v4-5-edit',
  'grok-image-to-image',
  'qwen-image-to-image',
]);

function isAutoRoutedEditVariant(modelId: string): boolean {
  return AUTO_ROUTED_EDIT_IDS.has(modelId);
}

function modelMatchesSearch(m: KubeezMediaModelOption, needle: string): boolean {
  if (!needle) return true;
  const n = needle.toLowerCase();
  const parts = [m.display_name, m.model_id, m.provider ?? ''].join(' ').toLowerCase();
  return parts.includes(n);
}

export interface KubeezGenerateModelsColumnProps {
  missingKey: boolean;
  imageModels: KubeezMediaModelOption[];
  videoModels: KubeezMediaModelOption[];
  musicModels: KubeezMediaModelOption[];
  speechModels: KubeezMediaModelOption[];
  allModelsSorted: KubeezMediaModelOption[];
  modelTab: ModelTab;
  onModelTabChange: (tab: ModelTab) => void;
  selectedModelId: string;
  onSelectModelId: (id: string) => void;
  busy: boolean;
  modelsLoading: boolean;
}

function accentForKind(k: KubeezMediaModelOption['mediaKind']) {
  if (k === 'video') return 'video' as const;
  if (k === 'music') return 'music' as const;
  if (k === 'speech') return 'speech' as const;
  return 'image' as const;
}

function kindLabelText(kind: KubeezMediaModelOption['mediaKind']) {
  if (kind === 'video') return 'Video';
  if (kind === 'music') return 'Music';
  if (kind === 'speech') return 'Speech';
  return 'Image';
}

/** First segment before " · " so cards don’t repeat long catalog subtitles in the title. */
function modelCardPrimaryTitle(m: KubeezMediaModelOption): string {
  const raw = m.display_name.trim();
  const head = raw.split(/\s*·\s*/)[0]?.trim();
  return head && head.length > 0 ? head : raw;
}

function isEditLikeImageModel(m: KubeezMediaModelOption): boolean {
  const s = `${m.model_id} ${m.display_name}`.toLowerCase();
  return /\b(edit|image-to-image|image to image|p-image-edit)\b/.test(s);
}

/** One short line: what the user does next (not resolution lists or provider marketing). */
function modelTaskHint(m: KubeezMediaModelOption): string {
  const k = m.mediaKind;
  if (k === 'speech') return 'Type dialogue and pick voices';
  if (k === 'music') return 'Describe your track';
  if (k === 'video') {
    const t2v = m.supportsTextToVideo === true;
    const i2v = m.supportsImageToVideo === true;
    if (t2v && i2v) return 'Prompt or start from an image';
    if (i2v && !t2v) return 'Animate from an image';
    return 'Describe the motion';
  }
  if (isEditLikeImageModel(m)) return 'Edit with prompt and image';
  return 'Write a prompt';
}

function familyTaskHint(item: KubeezModelFamilyGridItem): string {
  if (item.variants.length === 0) return 'Write a prompt';
  if (item.variants.length === 1) return modelTaskHint(item.variants[0]!);
  if (item.mediaKind === 'image') {
    const anyEdit = item.variants.some(isEditLikeImageModel);
    const anyNotEdit = item.variants.some((v) => !isEditLikeImageModel(v));
    if (anyEdit && anyNotEdit) return 'Create new images or edit shots';
  }
  return modelTaskHint(pickDefaultVariant(item.variants));
}

function ModelCardShell(props: {
  accent: 'video' | 'music' | 'speech' | 'image';
  kindLabel: string;
  title: string;
  /** Single short line under the title — user-facing “what to do”. */
  taskHint: string;
  /** Optional e.g. `3 cr` or `2–8 cr` (tilde added by shell). */
  costLabel?: string | null;
  heroImageUrl?: string | null;
  gradientKey: string;
  selected: boolean;
  onSelect?: () => void;
  disabled: boolean;
  ariaSelected?: boolean;
}) {
  const {
    accent,
    kindLabel,
    title,
    taskHint,
    costLabel,
    heroImageUrl,
    gradientKey,
    selected,
    onSelect,
    disabled,
    ariaSelected,
  } = props;
  const isVideo = accent === 'video';
  const isMusic = accent === 'music';
  const isSpeech = accent === 'speech';
  const isImage = accent === 'image';

  const heroIcon = isVideo ? (
    <Clapperboard className="h-6 w-6" strokeWidth={1.25} />
  ) : isMusic ? (
    <Music2 className="h-6 w-6" strokeWidth={1.25} />
  ) : isSpeech ? (
    <Mic className="h-6 w-6" strokeWidth={1.25} />
  ) : (
    <ImageIcon className="h-6 w-6" strokeWidth={1.25} />
  );

  const body = (
    <>
      <div className="relative aspect-[2/1] w-full shrink-0 overflow-hidden bg-muted/50">
        {heroImageUrl ? (
          <img
            src={heroImageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: kubeezModelCardGradientBackground(gradientKey) }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/30 to-transparent" />
        {!heroImageUrl && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/35">
            {heroIcon}
          </div>
        )}
        <span
          className={cn(
            'absolute left-1.5 top-1.5 z-10 rounded-full border px-1.5 py-px text-[8px] font-bold uppercase tracking-wider shadow-sm backdrop-blur-sm',
            isVideo && 'border-primary/30 bg-primary/10 text-primary-foreground',
            isMusic && 'border-primary/30 bg-primary/10 text-primary-foreground',
            isSpeech && 'border-primary/30 bg-primary/10 text-primary-foreground',
            isImage && 'border-primary/30 bg-primary/10 text-primary-foreground'
          )}
        >
          {kindLabel}
        </span>
        {selected && (
          <span
            className={cn(
              'absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full shadow-md ring-2 ring-background',
              isVideo && 'bg-primary text-primary-foreground',
              isMusic && 'bg-primary text-primary-foreground',
              isSpeech && 'bg-primary text-primary-foreground',
              isImage && 'bg-primary text-primary-foreground'
            )}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="relative z-0 flex min-h-0 flex-1 flex-col justify-center gap-0.5 bg-gradient-to-b from-card/98 to-muted/20 px-2 pb-1.5 pt-1">
        <span className="line-clamp-1 text-left text-[12px] font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </span>
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 min-w-0 flex-1 text-[10px] leading-snug text-muted-foreground">{taskHint}</p>
          {costLabel ? (
            <span className="shrink-0 pt-px text-[9px] tabular-nums text-muted-foreground/85" title="Approx. credits">
              ~{costLabel}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );

  const frameClass = cn(
    'group relative flex w-full min-h-0 flex-col overflow-hidden rounded-lg border text-left',
    'border-border/60 bg-card',
    'shadow-[inset_0_1px_0_0_oklch(1_0_0_/0.06),0_10px_36px_-14px_rgba(0,0,0,0.48)]',
    'transition-[transform,box-shadow,border-color,background] duration-200',
    onSelect && 'hover:-translate-y-px hover:border-border/90 hover:shadow-[inset_0_1px_0_0_oklch(1_0_0_/0.07),0_14px_44px_-12px_rgba(0,0,0,0.52)]',
    onSelect &&
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    disabled && 'pointer-events-none opacity-50',
    selected && 'border-primary/50 shadow-lg shadow-primary/20 ring-1 ring-primary/40',
    !selected && 'border-border/50'
  );

  if (onSelect) {
    return (
      <button
        type="button"
        role="option"
        aria-selected={ariaSelected ?? selected}
        disabled={disabled}
        onClick={onSelect}
        className={frameClass}
      >
        {body}
      </button>
    );
  }

  return (
    <div role="group" className={frameClass} aria-selected={ariaSelected ?? selected}>
      {body}
    </div>
  );
}

function FamilyModelCard(props: {
  item: KubeezModelFamilyGridItem;
  selectedModelId: string;
  onSelectModelId: (id: string) => void;
  busy: boolean;
  modelsLoading: boolean;
}) {
  const { item, selectedModelId, onSelectModelId, busy, modelsLoading } = props;
  const disabled = busy || modelsLoading;
  const selected = kubeezModelGridItemContainsModelId(item, selectedModelId);
  const costs = item.variants
    .map((v) => v.cost_per_generation)
    .filter((c): c is number => typeof c === 'number');
  const rangeLabel =
    costs.length > 1
      ? `${Math.min(...costs)}–${Math.max(...costs)} cr`
      : costs.length === 1
        ? `${costs[0]} cr`
        : null;

  const accent = accentForKind(item.mediaKind);
  const kindLabel = kindLabelText(item.mediaKind);

  return (
    <ModelCardShell
      accent={accent}
      kindLabel={kindLabel}
      title={item.displayName}
      taskHint={familyTaskHint(item)}
      costLabel={rangeLabel}
      heroImageUrl={resolveKubeezModelCardHeroUrl(pickDefaultVariant(item.variants).model_id, {
        baseCardId: item.baseCardId,
        apiCardImageUrl: pickFirstCardImageUrl(item.variants),
      })}
      gradientKey={item.baseCardId ?? item.familyKey}
      selected={selected}
      ariaSelected={selected}
      onSelect={() => {
        if (!selected) {
          const entry = item.baseCardId ? findRegistryEntryByBaseCardId(item.baseCardId) : null;
          if (entry) {
            const settings = defaultModelSettings(entry);
            onSelectModelId(
              resolveGenerationModelId({
                baseCardId: entry.baseCardId,
                settings,
                variants: item.variants,
              })
            );
          } else {
            onSelectModelId(pickDefaultVariant(item.variants).model_id);
          }
        }
      }}
      disabled={disabled}
    />
  );
}

/** `720p` → `720` for compact quality toggles (API still uses full `model_id`). */
function videoResolutionChipLabel(resolution: string): string {
  return resolution.replace(/p$/i, '');
}

function kindBadgeClass(kind: KubeezMediaModelOption['mediaKind']) {
  return cn(
    'rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
    kind === 'video' && 'bg-primary/15 text-primary',
    kind === 'image' && 'bg-primary/15 text-primary',
    kind === 'music' && 'bg-primary/15 text-primary',
    kind === 'speech' && 'bg-primary/15 text-primary'
  );
}

export interface KubeezGenerateSelectedModelPanelProps {
  model: KubeezMediaModelOption | null;
  selectedModelId: string;
  /** Concrete `model_id` used for POST /v1/generate/media (may differ from selection when a family resolves). */
  resolvedModelId: string;
  onSelectModelId: (id: string) => void;
  modelSettings: KubeezModelSettings;
  onPatchModelSettings: (patch: Partial<KubeezModelSettings>) => void;
  /** Local dialog state — not encoded in `model_id`. */
  videoAspectRatio?: string;
  onVideoAspectRatioChange: (next: string) => void;
  modelFamilyItem: KubeezModelFamilyGridItem | null;
  videoFooterHint: string | null;
  busy: boolean;
  modelsLoading: boolean;
  /** Resolved cost for the concrete variant that will be used on generate. */
  generationCost?: number;
}

export const KubeezGenerateSelectedModelPanel = memo(function KubeezGenerateSelectedModelPanel({
  model,
  selectedModelId,
  resolvedModelId,
  onSelectModelId,
  modelSettings,
  onPatchModelSettings,
  videoAspectRatio: videoAspectRatioProp,
  onVideoAspectRatioChange,
  modelFamilyItem,
  videoFooterHint,
  busy,
  modelsLoading,
  generationCost,
}: KubeezGenerateSelectedModelPanelProps) {
  const disabled = busy || modelsLoading;

  const costLabel =
    typeof generationCost === 'number'
      ? `${generationCost} cr`
      : model && typeof model.cost_per_generation === 'number'
        ? `${model.cost_per_generation} cr`
        : null;

  const familyVariant = modelFamilyItem
    ? (modelFamilyItem.variants.find((v) => v.model_id === selectedModelId) ??
      pickDefaultVariant(modelFamilyItem.variants))
    : null;
  const axes =
    modelFamilyItem?.mediaKind === 'video' ? collectVideoFamilyAxes(modelFamilyItem.variants) : null;
  const hasVideoAxisUi = Boolean(
    modelFamilyItem?.mediaKind === 'video' &&
      axes &&
      (axes.resolutions.length > 0 ||
        axes.durations.length > 0 ||
        (axes.audioOptions.off && axes.audioOptions.on))
  );
  const parsed =
    familyVariant && axes && hasVideoAxisUi
      ? (parseSelectionFromVideoVariantId(familyVariant.model_id) ?? {
          resolution: axes.resolutions[0] ?? null,
          duration: axes.durations[0] ?? '4s',
          withAudio: false,
        })
      : null;
  const showSoundRow = axes ? axes.audioOptions.off && axes.audioOptions.on : false;

  const selectFamilyWith = modelFamilyItem
    ? (next: { resolution: string | null; duration: string; withAudio: boolean }) => {
        const v = resolveVideoFamilySelection(modelFamilyItem.variants, next);
        onSelectModelId(v.model_id);
      }
    : null;

  const registryDedicatedImageUi =
    modelFamilyItem?.baseCardId === 'nano-banana-2' ||
    modelFamilyItem?.baseCardId === 'nano-banana-pro' ||
    modelFamilyItem?.baseCardId === 'imagen-4' ||
    modelFamilyItem?.baseCardId === 'z-image' ||
    modelFamilyItem?.baseCardId === 'gpt-1.5-image';

  const registryDedicatedCustomVideoUi =
    modelFamilyItem?.baseCardId === 'grok-video' ||
    modelFamilyItem?.baseCardId === 'kling-2-5-i2v' ||
    modelFamilyItem?.baseCardId === 'kling-2-6' ||
    modelFamilyItem?.baseCardId === 'kling-2-6-motion' ||
    modelFamilyItem?.baseCardId === 'kling-3-0' ||
    modelFamilyItem?.baseCardId === 'sora-2' ||
    modelFamilyItem?.baseCardId === 'veo3-1' ||
    modelFamilyItem?.baseCardId === 'wan-2-5';

  const registryDedicatedMusicUi = modelFamilyItem?.baseCardId === 'suno-music';

  const showSimpleVariantRow = Boolean(
    modelFamilyItem &&
      modelFamilyItem.variants.length > 1 &&
      (modelFamilyItem.mediaKind === 'image' ||
        modelFamilyItem.mediaKind === 'music' ||
        !hasVideoAxisUi) &&
      !registryDedicatedImageUi &&
      !registryDedicatedCustomVideoUi &&
      !registryDedicatedMusicUi
  );

  const imageRes = modelSettings.imageResolution ?? '1k';
  const imagenTier = modelSettings.imagenTier ?? 'standard';
  const grokVideoMode = modelSettings.grokVideoMode ?? 'text-to-video';
  const kling26 = modelSettings.kling26 ?? {
    mode: 'text-to-video' as const,
    duration: '5s' as const,
    withAudio: false,
  };
  const kling26MotionRes = modelSettings.kling26MotionResolution ?? '720p';
  const kling30 = modelSettings.kling30 ?? {
    line: 'std' as const,
    motionResolution: '720p' as const,
  };
  const sora2 = modelSettings.sora2 ?? {
    tier: 'base' as const,
    mode: 'text-to-video' as const,
    duration: '10s' as const,
    proQuality: 'standard' as const,
  };
  const zImageTier = modelSettings.zImageTier ?? 'standard';
  const gpt15ImageQuality = modelSettings.gpt15ImageQuality ?? 'medium';
  const kling25Clip = modelSettings.kling25Clip ?? '5s';
  const veo31 = modelSettings.veo31 ?? {
    tier: 'fast' as const,
    mode: 'text-to-video' as const,
  };

  const wan25 = modelSettings.wan25 ?? {
    useSimpleCatalogId: true,
    source: 'text' as const,
    duration: '5s' as const,
    resolution: '1080p' as const,
  };
  const musicEngine = modelSettings.sunoEngine ?? 'V5_5';

  const videoAspectUi = useMemo(() => {
    if (model?.mediaKind !== 'video') return null;
    return getVideoAspectUi(resolvedModelId, { veoMode: veo31.mode });
  }, [model?.mediaKind, resolvedModelId, veo31.mode]);
  const videoAspectValue = videoAspectRatioProp ?? videoAspectUi?.defaultValue;
  const sora2ModeRows =
    sora2.tier === 'pro'
      ? ([
          { mode: 'text-to-video' as const, label: 'Text-to-video' },
          { mode: 'image-to-video' as const, label: 'Image-to-video' },
          { mode: 'storyboard' as const, label: 'Storyboard' },
        ] as const)
      : ([
          { mode: 'text-to-video' as const, label: 'Text-to-video' },
          { mode: 'image-to-video' as const, label: 'Image-to-video' },
        ] as const);
  const simpleVariantsSorted = modelFamilyItem
    ? [...modelFamilyItem.variants]
        .filter((v) => !isAutoRoutedEditVariant(v.model_id))
        .sort((a, b) => (a.cost_per_generation ?? Infinity) - (b.cost_per_generation ?? Infinity))
    : [];
  const simpleVariantTitle = (v: KubeezMediaModelOption) => {
    const dup =
      simpleVariantsSorted.filter((s) => s.display_name === v.display_name).length > 1;
    return dup ? `${v.display_name} · ${v.model_id}` : v.display_name;
  };

  if (!model) {
    return null;
  }

  return (
    <div className="shrink-0 space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-tight text-foreground">{model.display_name}</p>
          <p className="text-[10px] text-muted-foreground">
            {model.provider}
            {costLabel && <> · <span className="tabular-nums text-foreground/70">{costLabel}</span></>}
          </p>
        </div>
        <span className={cn(kindBadgeClass(model.mediaKind), 'shrink-0')}>{kindLabelText(model.mediaKind)}</span>
      </div>

      {modelFamilyItem?.baseCardId === 'nano-banana-2'
        || modelFamilyItem?.baseCardId === 'nano-banana-pro'
        || modelFamilyItem?.baseCardId === 'gpt-image-2' ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Resolution</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: '1k' as const, label: '1K' },
                { id: '2k' as const, label: '2K' },
                { id: '4k' as const, label: '4K' },
              ] as const
            ).map(({ id, label }) => {
              const active = imageRes === id;
              return (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled}
                  className="h-7 min-w-[2.75rem] px-2 text-[11px]"
                  onClick={() => onPatchModelSettings({ imageResolution: id })}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          {modelFamilyItem?.baseCardId === 'gpt-image-2' && imageRes !== '1k' ? (
            <p className="text-[10px] leading-snug text-muted-foreground">
              At 2K / 4K, the API requires a non‑square aspect ratio (16:9, 9:16, 4:3, or 3:4).
            </p>
          ) : null}
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'imagen-4' ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Tier</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: 'standard' as const, label: 'Standard' },
                { id: 'fast' as const, label: 'Fast' },
                { id: 'ultra' as const, label: 'Ultra' },
              ] as const
            ).map(({ id, label }) => {
              const active = imagenTier === id;
              return (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled}
                  className="h-7 min-w-[4.5rem] px-2 text-[11px]"
                  onClick={() => onPatchModelSettings({ imagenTier: id })}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'z-image' ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Quality</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: 'standard' as const, label: 'Standard' },
                { id: 'hd' as const, label: 'HD' },
              ] as const
            ).map(({ id, label }) => {
              const active = zImageTier === id;
              return (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled}
                  className="h-7 min-w-[4.5rem] px-2 text-[11px]"
                  onClick={() => onPatchModelSettings({ zImageTier: id })}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'gpt-1.5-image' ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Quality</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: 'medium' as const, label: 'Medium' },
                { id: 'high' as const, label: 'High' },
              ] as const
            ).map(({ id, label }) => {
              const active = gpt15ImageQuality === id;
              return (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled}
                  className="h-7 min-w-[4.5rem] px-2 text-[11px]"
                  onClick={() => onPatchModelSettings({ gpt15ImageQuality: id })}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {resolvedModelId === 'p-image-edit' ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Speed</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: true as const, label: 'Turbo' },
                { id: false as const, label: 'Standard' },
              ] as const
            ).map(({ id, label }) => {
              const active = (modelSettings.pImageEditTurbo ?? true) === id;
              return (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled}
                  className="h-7 min-w-[4.5rem] px-2 text-[11px]"
                  onClick={() => onPatchModelSettings({ pImageEditTurbo: id })}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Turbo maps to <span className="font-mono text-foreground/80">quality: turbo</span> on the Kubeez API.
          </p>
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'grok-video' ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Generation</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: 'text-to-video' as const, label: 'Text-to-video' },
                { id: 'image-to-video' as const, label: 'Image-to-video' },
              ] as const
            ).map(({ id, label }) => {
              const active = grokVideoMode === id;
              return (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled}
                  className="h-7 min-w-[7.5rem] px-2 text-[11px]"
                  onClick={() => onPatchModelSettings({ grokVideoMode: id })}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Text-to-video uses the 6s catalog entry; image-to-video needs reference media when required.
          </p>
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'kling-2-5-i2v' ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Clip length</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: '5s' as const, label: '5s' },
                { id: '10s' as const, label: '10s' },
              ] as const
            ).map(({ id, label }) => {
              const active = kling25Clip === id;
              return (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled}
                  className="h-7 min-w-[2.75rem] px-2 text-[11px]"
                  onClick={() => onPatchModelSettings({ kling25Clip: id })}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'kling-2-6' ? (
        <div className="space-y-2.5 border-t border-border/50 pt-3">
          <div className="space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Mode</p>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { id: 'text-to-video' as const, label: 'Text-to-video' },
                  { id: 'image-to-video' as const, label: 'Image-to-video' },
                ] as const
              ).map(({ id, label }) => {
                const active = kling26.mode === id;
                return (
                  <Button
                    key={id}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    disabled={disabled}
                    className="h-7 min-w-[7.5rem] px-2 text-[11px]"
                    onClick={() => onPatchModelSettings({ kling26: { ...kling26, mode: id } })}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Duration</p>
            <div className="flex flex-wrap gap-1">
              {(['5s', '10s'] as const).map((dur) => {
                const active = kling26.duration === dur;
                return (
                  <Button
                    key={dur}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    disabled={disabled}
                    className="h-7 min-w-[2.75rem] px-2 text-[11px]"
                    onClick={() => onPatchModelSettings({ kling26: { ...kling26, duration: dur } })}
                  >
                    {dur}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Audio</p>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { id: false, label: 'Off' },
                  { id: true, label: 'On' },
                ] as const
              ).map(({ id, label }) => {
                const active = kling26.withAudio === id;
                return (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    disabled={disabled}
                    className="h-7 px-3 text-[11px]"
                    onClick={() => onPatchModelSettings({ kling26: { ...kling26, withAudio: id } })}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'kling-2-6-motion' ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Quality</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: '720p' as const, label: '720' },
                { id: '1080p' as const, label: '1080' },
              ] as const
            ).map(({ id, label }) => {
              const active = kling26MotionRes === id;
              return (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled}
                  className="h-7 min-w-[3.25rem] px-2 text-[11px]"
                  onClick={() => onPatchModelSettings({ kling26MotionResolution: id })}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'kling-3-0' ? (
        <div className="space-y-2.5 border-t border-border/50 pt-3">
          <div className="space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Model</p>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { line: 'std' as const, label: 'Standard' },
                  { line: 'pro' as const, label: 'Pro' },
                  { line: 'motion' as const, label: 'Motion' },
                ] as const
              ).map(({ line, label }) => {
                const active = kling30.line === line;
                return (
                  <Button
                    key={line}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    disabled={disabled}
                    className="h-7 min-w-[5.5rem] px-2 text-[11px]"
                    onClick={() =>
                      onPatchModelSettings({
                        kling30: { ...kling30, line, motionResolution: kling30.motionResolution },
                      })
                    }
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
          {kling30.line === 'motion' ? (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Motion quality</p>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { id: '720p' as const, label: '720' },
                    { id: '1080p' as const, label: '1080' },
                  ] as const
                ).map(({ id, label }) => {
                  const active = kling30.motionResolution === id;
                  return (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      disabled={disabled}
                      className="h-7 min-w-[3.25rem] px-2 text-[11px]"
                      onClick={() => onPatchModelSettings({ kling30: { ...kling30, motionResolution: id } })}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'sora-2' ? (
        <div className="space-y-2.5 border-t border-border/50 pt-3">
          <div className="space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Tier</p>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  {
                    tier: 'base' as const,
                    label: 'Base',
                    patch: {
                      tier: 'base' as const,
                      mode: sora2.mode === 'storyboard' ? ('text-to-video' as const) : sora2.mode,
                      duration: (sora2.duration === '25s' ? '10s' : sora2.duration) as '10s' | '15s',
                      proQuality: 'standard' as const,
                    },
                  },
                  {
                    tier: 'pro' as const,
                    label: 'Pro',
                    patch: {
                      tier: 'pro' as const,
                      mode: sora2.mode === 'storyboard' ? 'storyboard' : sora2.mode,
                      duration: sora2.duration,
                      proQuality: sora2.proQuality,
                    },
                  },
                ] as const
              ).map(({ tier, label, patch }) => {
                const active = sora2.tier === tier;
                return (
                  <Button
                    key={tier}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    disabled={disabled}
                    className="h-7 min-w-[4.5rem] px-2 text-[11px]"
                    onClick={() => onPatchModelSettings({ sora2: { ...sora2, ...patch } })}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Mode</p>
            <div className="flex flex-wrap gap-1">
              {sora2ModeRows.map(({ mode, label }) => {
                const active = sora2.mode === mode;
                return (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    disabled={disabled}
                    className="h-7 min-w-[7rem] px-2 text-[11px]"
                    onClick={() => {
                      let duration = sora2.duration;
                      if (mode === 'storyboard') {
                        if (duration !== '10s' && duration !== '15s' && duration !== '25s') {
                          duration = '10s';
                        }
                      } else if (duration === '25s') {
                        duration = '10s';
                      }
                      onPatchModelSettings({ sora2: { ...sora2, mode, duration } });
                    }}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Duration</p>
            <div className="flex flex-wrap gap-1">
              {(sora2.mode === 'storyboard'
                ? (['10s', '15s', '25s'] as const)
                : (['10s', '15s'] as const)
              ).map((dur) => {
                const active = sora2.duration === dur;
                return (
                  <Button
                    key={dur}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    disabled={disabled}
                    className="h-7 min-w-[2.75rem] px-2 text-[11px]"
                    onClick={() => onPatchModelSettings({ sora2: { ...sora2, duration: dur } })}
                  >
                    {dur}
                  </Button>
                );
              })}
            </div>
          </div>
          {sora2.tier === 'pro' && sora2.mode !== 'storyboard' ? (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Quality</p>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { id: 'hd' as const, label: 'HD' },
                    { id: 'standard' as const, label: 'Standard' },
                  ] as const
                ).map(({ id, label }) => {
                  const active = sora2.proQuality === id;
                  return (
                    <Button
                      key={id}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      disabled={disabled}
                      className="h-7 min-w-[5rem] px-2 text-[11px]"
                      onClick={() => onPatchModelSettings({ sora2: { ...sora2, proQuality: id } })}
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'veo3-1' ? (
        <div className="space-y-2.5 border-t border-border/50 pt-3">
          <div className="space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Tier</p>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { tier: 'fast' as const, label: 'Fast' },
                  { tier: 'lite' as const, label: 'Lite' },
                  { tier: 'quality' as const, label: 'Quality' },
                ] as const
              ).map(({ tier, label }) => {
                const active = veo31.tier === tier;
                return (
                  <Button
                    key={tier}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    disabled={disabled}
                    className="h-7 min-w-[4.5rem] px-2 text-[11px]"
                    onClick={() => {
                      let mode = veo31.mode;
                      if ((tier === 'quality' || tier === 'lite') && mode === 'reference-to-video') {
                        mode = 'text-to-video';
                      }
                      onVideoAspectRatioChange('16:9');
                      onPatchModelSettings({ veo31: { ...veo31, tier, mode } });
                    }}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Mode</p>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  { mode: 'text-to-video' as const, label: 'Text' },
                  { mode: 'first-and-last-frames' as const, label: 'First & last' },
                ] as const
              ).map(({ mode, label }) => {
                const active = veo31.mode === mode;
                return (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    disabled={disabled}
                    className="h-7 min-w-[5rem] px-2 text-[11px]"
                    onClick={() => {
                      onVideoAspectRatioChange('16:9');
                      onPatchModelSettings({ veo31: { ...veo31, mode } });
                    }}
                  >
                    {label}
                  </Button>
                );
              })}
              {veo31.tier === 'fast' ? (
                <Button
                  type="button"
                  size="sm"
                  variant={veo31.mode === 'reference-to-video' ? 'default' : 'outline'}
                  disabled={disabled}
                  className="h-7 min-w-[5rem] px-2 text-[11px]"
                  onClick={() => {
                    onVideoAspectRatioChange('16:9');
                    onPatchModelSettings({ veo31: { ...veo31, mode: 'reference-to-video' } });
                  }}
                >
                  Reference
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'wan-2-5' ? (
        <div className="space-y-2.5 border-t border-border/50 pt-3">
          <div className="space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Variant</p>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                size="sm"
                variant={wan25.useSimpleCatalogId ? 'default' : 'outline'}
                disabled={disabled}
                className="h-7 px-2 text-[11px]"
                onClick={() => onPatchModelSettings({ wan25: { ...wan25, useSimpleCatalogId: true } })}
              >
                Catalog default
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!wan25.useSimpleCatalogId ? 'default' : 'outline'}
                disabled={disabled}
                className="h-7 px-2 text-[11px]"
                onClick={() => onPatchModelSettings({ wan25: { ...wan25, useSimpleCatalogId: false } })}
              >
                Full id
              </Button>
            </div>
          </div>
          {!wan25.useSimpleCatalogId ? (
            <>
              <div className="space-y-1">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Source</p>
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      { id: 'text' as const, label: 'Text-to-video' },
                      { id: 'image' as const, label: 'Image-to-video' },
                    ] as const
                  ).map(({ id, label }) => {
                    const active = wan25.source === id;
                    return (
                      <Button
                        key={id}
                        type="button"
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        disabled={disabled}
                        className="h-7 min-w-[7rem] px-2 text-[11px]"
                        onClick={() => onPatchModelSettings({ wan25: { ...wan25, source: id } })}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Duration</p>
                <div className="flex flex-wrap gap-1">
                  {(['5s', '10s'] as const).map((dur) => {
                    const active = wan25.duration === dur;
                    return (
                      <Button
                        key={dur}
                        type="button"
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        disabled={disabled}
                        className="h-7 min-w-[2.75rem] px-2 text-[11px]"
                        onClick={() => onPatchModelSettings({ wan25: { ...wan25, duration: dur } })}
                      >
                        {dur}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Resolution</p>
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      { id: '720p' as const, label: '720p' },
                      { id: '1080p' as const, label: '1080p' },
                    ] as const
                  ).map(({ id, label }) => {
                    const active = wan25.resolution === id;
                    return (
                      <Button
                        key={id}
                        type="button"
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        disabled={disabled}
                        className="h-7 min-w-[3.25rem] px-2 text-[11px]"
                        onClick={() => onPatchModelSettings({ wan25: { ...wan25, resolution: id } })}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <p className="text-[10px] leading-snug text-muted-foreground">
              Uses the single catalog model id <span className="font-mono text-foreground/80">wan-2-5</span>. Switch
              to Full id for text vs image, duration, and resolution variants.
            </p>
          )}
        </div>
      ) : null}

      {modelFamilyItem?.baseCardId === 'suno-music' ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Engine</p>
          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: 'V4' as const, label: 'V4' },
                { id: 'V4_5' as const, label: 'V4.5' },
                { id: 'V4_5PLUS' as const, label: 'V4.5+' },
                { id: 'V5' as const, label: 'V5' },
                { id: 'V5_5' as const, label: 'V5.5' },
              ] as const
            ).map(({ id, label }) => {
              const active = musicEngine === id;
              return (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled}
                  className="h-7 min-w-[2.75rem] px-2 text-[11px]"
                  onClick={() => onPatchModelSettings({ sunoEngine: id })}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}

      {modelFamilyItem && hasVideoAxisUi && parsed && selectFamilyWith && axes && (
        <div className="space-y-2.5 border-t border-border/50 pt-3">
          {axes.resolutions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Quality</p>
              <div className="flex flex-wrap gap-1">
                {axes.resolutions.map((r) => {
                  const active = (parsed.resolution ?? null) === r;
                  return (
                    <Button
                      key={r}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      disabled={disabled}
                      className="h-7 min-w-[3.25rem] px-2 text-[11px]"
                      onClick={() =>
                        selectFamilyWith({ resolution: r, duration: parsed.duration, withAudio: parsed.withAudio })
                      }
                    >
                      {videoResolutionChipLabel(r)}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
          {axes.durations.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Duration</p>
              <div className="flex flex-wrap gap-1">
                {axes.durations.map((d) => {
                  const active = parsed.duration === d;
                  return (
                    <Button
                      key={d}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      disabled={disabled}
                      className="h-7 min-w-[2.75rem] px-2 text-[11px]"
                      onClick={() =>
                        selectFamilyWith({
                          resolution: parsed.resolution,
                          duration: d,
                          withAudio: parsed.withAudio,
                        })
                      }
                    >
                      {d}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
          {showSoundRow && (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Audio</p>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { id: false, label: 'Off' },
                    { id: true, label: 'On' },
                  ] as const
                ).map(({ id, label }) => {
                  const active = parsed.withAudio === id;
                  return (
                    <Button
                      key={label}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      disabled={disabled}
                      className="h-7 px-3 text-[11px]"
                      onClick={() =>
                        selectFamilyWith({
                          resolution: parsed.resolution,
                          duration: parsed.duration,
                          withAudio: id,
                        })
                      }
                    >
                      {label}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {videoAspectUi && model.mediaKind === 'video' ? (
        <div className="space-y-2 border-t border-border/50 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Aspect ratio</p>
          <div className="flex flex-wrap gap-1">
            {videoAspectUi.options.map((opt) => {
              const active = videoAspectValue === opt.value;
              return (
                <Button
                  key={String(opt.value)}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled || videoAspectUi.force16x9}
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() =>
                    onVideoAspectRatioChange(opt.value === 'auto' ? 'auto' : opt.value)
                  }
                >
                  <AspectRatioIcon ratio={opt.value} active={active} />
                  {opt.label}
                </Button>
              );
            })}
          </div>
          {videoAspectUi.force16x9 ? (
            <p className="text-[10px] leading-snug text-muted-foreground">
              Reference mode requires 16:9 (Kubeez API).
            </p>
          ) : null}
        </div>
      ) : null}

      {showSimpleVariantRow && (
        <div className="space-y-1.5 border-t border-border/50 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Variant</p>
          <div className="flex flex-wrap gap-1">
            {simpleVariantsSorted.map((v) => {
              const active = v.model_id === selectedModelId || areModelsEquivalent(v.model_id, selectedModelId);
              const vCost = typeof v.cost_per_generation === 'number' ? `~${v.cost_per_generation} cr` : null;
              return (
                <Button
                  key={v.model_id}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  disabled={disabled}
                  className="h-auto min-h-7 max-w-full whitespace-normal px-2 py-1 text-left text-[11px] leading-snug"
                  onClick={() => onSelectModelId(v.model_id)}
                >
                  <span className="block font-medium">{simpleVariantTitle(v)}</span>
                  {vCost ? (
                    <span className="block tabular-nums text-[10px] opacity-80">{vCost}</span>
                  ) : null}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {videoFooterHint && (
        <p className="text-xs leading-snug text-primary/80">{videoFooterHint}</p>
      )}
    </div>
  );
});

function ModelGrid(props: {
  items: KubeezModelGridItem[];
  emptyTitle?: string;
  emptyHint?: string;
  selectedModelId: string;
  onSelectModelId: (id: string) => void;
  busy: boolean;
  modelsLoading: boolean;
}) {
  const { items, emptyTitle, emptyHint, selectedModelId, onSelectModelId, busy, modelsLoading } = props;
  if (items.length === 0) {
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/15 px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">{emptyTitle ?? 'No models in this tab.'}</p>
        {emptyHint ? (
          <p className="mt-1 max-w-md text-xs text-muted-foreground/85">{emptyHint}</p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground/80">Try another tab or check your API key.</p>
        )}
      </div>
    );
  }
  return (
    <div
      role="listbox"
      aria-label="Models"
      aria-multiselectable={false}
      className={MODEL_GRID_CLASS}
    >
      {items.map((entry) => {
        if (entry.kind === 'model-family') {
          return (
            <FamilyModelCard
              key={entry.familyKey}
              item={entry}
              selectedModelId={selectedModelId}
              onSelectModelId={onSelectModelId}
              busy={busy}
              modelsLoading={modelsLoading}
            />
          );
        }

        const m = entry.m;
        const selected = m.model_id === selectedModelId || areModelsEquivalent(m.model_id, selectedModelId);
        const costLabel = typeof m.cost_per_generation === 'number' ? `${m.cost_per_generation} cr` : null;
        const accent = accentForKind(m.mediaKind);
        const kindLabel =
          m.mediaKind === 'video'
            ? 'Video'
            : m.mediaKind === 'music'
              ? 'Music'
              : m.mediaKind === 'speech'
                ? 'Speech'
                : 'Image';

        return (
          <ModelCardShell
            key={m.model_id}
            accent={accent}
            kindLabel={kindLabel}
            title={modelCardPrimaryTitle(m)}
            taskHint={modelTaskHint(m)}
            costLabel={costLabel}
            heroImageUrl={resolveKubeezModelCardHeroUrl(m.model_id, { apiCardImageUrl: m.cardImageUrl })}
            gradientKey={m.model_id}
            selected={selected}
            ariaSelected={selected}
            onSelect={() => onSelectModelId(m.model_id)}
            disabled={busy || modelsLoading}
          />
        );
      })}
    </div>
  );
}

export const KubeezGenerateModelsColumn = memo(function KubeezGenerateModelsColumn({
  imageModels,
  videoModels,
  musicModels,
  speechModels,
  allModelsSorted,
  modelTab,
  onModelTabChange,
  selectedModelId,
  onSelectModelId,
  busy,
  modelsLoading,
}: KubeezGenerateModelsColumnProps) {
  const [modelSearch, setModelSearch] = useState('');
  const searchNeedle = modelSearch.trim();

  const filteredLists = useMemo(() => {
    const f = (list: KubeezMediaModelOption[]) =>
      searchNeedle ? list.filter((m) => modelMatchesSearch(m, searchNeedle)) : list;
    return {
      all: f(allModelsSorted),
      image: f(imageModels),
      video: f(videoModels),
      music: f(musicModels),
      speech: f(speechModels),
    };
  }, [allModelsSorted, imageModels, videoModels, musicModels, speechModels, searchNeedle]);

  const gridItemsByTab = useMemo(
    () => ({
      all: buildKubeezModelGridItems(filteredLists.all),
      image: buildKubeezModelGridItems(filteredLists.image),
      video: buildKubeezModelGridItems(filteredLists.video),
      music: buildKubeezModelGridItems(filteredLists.music),
      speech: buildKubeezModelGridItems(filteredLists.speech),
    }),
    [filteredLists]
  );

  return (
    <div className="flex min-h-0 max-h-[min(42vh,300px)] flex-1 flex-col border-b border-border/50 pb-3 lg:max-h-none lg:min-h-0 lg:min-w-0 lg:border-b-0 lg:border-r lg:border-border/40 lg:pb-0 lg:pr-3">
      <div className="flex min-h-0 flex-1 flex-col space-y-1.5 overflow-hidden">
        {modelsLoading && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </span>
          </div>
        )}

        <Tabs
          value={modelTab}
          onValueChange={(v) => onModelTabChange(v as ModelTab)}
          className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
        >
          <TabsList className="flex h-auto w-full shrink-0 justify-start gap-0.5 rounded-lg bg-muted/40 p-0.5">
            <TabsTrigger value="all" className="gap-1 rounded-md px-2.5 py-1 text-xs">
              <LayoutGrid className="h-3 w-3 opacity-70" />
              All
            </TabsTrigger>
            <TabsTrigger value="image" className="gap-1 rounded-md px-2.5 py-1 text-xs">
              <ImageIcon className="h-3 w-3 text-primary/70" />
              Image
            </TabsTrigger>
            <TabsTrigger value="video" className="gap-1 rounded-md px-2.5 py-1 text-xs">
              <Clapperboard className="h-3 w-3 text-primary/70" />
              Video
            </TabsTrigger>
            <TabsTrigger value="music" className="gap-1 rounded-md px-2.5 py-1 text-xs">
              <Music2 className="h-3 w-3 text-primary/70" />
              Music
            </TabsTrigger>
            <TabsTrigger value="speech" className="gap-1 rounded-md px-2.5 py-1 text-xs">
              <Mic className="h-3 w-3 text-primary/70" />
              Speech
            </TabsTrigger>
          </TabsList>

          <div className="relative mt-1.5 shrink-0">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder="Search models…"
              disabled={busy || modelsLoading}
              className="h-7 rounded-md border-border/50 bg-card/30 pl-7 text-xs"
              aria-label="Search models"
              autoComplete="off"
            />
          </div>

          <TabsContent value="all" className="mt-2 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
            <div className="h-full max-h-full overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
              <ModelGrid
                items={gridItemsByTab.all}
                emptyHint={
                  searchNeedle && allModelsSorted.length > 0
                    ? 'No models match your search. Try another term or clear the filter.'
                    : undefined
                }
                selectedModelId={selectedModelId}
                onSelectModelId={onSelectModelId}
                busy={busy}
                modelsLoading={modelsLoading}
              />
            </div>
          </TabsContent>
          <TabsContent value="image" className="mt-2 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
            <div className="h-full max-h-full overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
              <ModelGrid
                items={gridItemsByTab.image}
                emptyTitle={searchNeedle && imageModels.length > 0 ? 'No matching models' : undefined}
                emptyHint={
                  searchNeedle && imageModels.length > 0
                    ? 'Try another search term or clear the filter.'
                    : undefined
                }
                selectedModelId={selectedModelId}
                onSelectModelId={onSelectModelId}
                busy={busy}
                modelsLoading={modelsLoading}
              />
            </div>
          </TabsContent>
          <TabsContent value="video" className="mt-2 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
            <div className="h-full max-h-full overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
              <ModelGrid
                items={gridItemsByTab.video}
                emptyTitle={searchNeedle && videoModels.length > 0 ? 'No matching models' : undefined}
                emptyHint={
                  searchNeedle && videoModels.length > 0
                    ? 'Try another search term or clear the filter.'
                    : 'No video models from the API, or the catalog failed to load. Image-to-video models need reference uploads.'
                }
                selectedModelId={selectedModelId}
                onSelectModelId={onSelectModelId}
                busy={busy}
                modelsLoading={modelsLoading}
              />
            </div>
          </TabsContent>
          <TabsContent value="music" className="mt-2 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
            <div className="h-full max-h-full overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
              <ModelGrid
                items={gridItemsByTab.music}
                emptyHint={
                  searchNeedle && musicModels.length > 0
                    ? 'No models match your search. Try another term or clear the filter.'
                    : 'No music models from the API; built-in engine ids (V5, V4…) are used instead.'
                }
                selectedModelId={selectedModelId}
                onSelectModelId={onSelectModelId}
                busy={busy}
                modelsLoading={modelsLoading}
              />
            </div>
          </TabsContent>
          <TabsContent value="speech" className="mt-2 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
            <div className="h-full max-h-full overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">
              <ModelGrid
                items={gridItemsByTab.speech}
                emptyTitle={searchNeedle && speechModels.length > 0 ? 'No matching models' : undefined}
                emptyHint={
                  searchNeedle && speechModels.length > 0
                    ? 'Try another search term or clear the filter.'
                    : 'Text-to-speech uses Kubeez dialogue generation (ElevenLabs).'
                }
                selectedModelId={selectedModelId}
                onSelectModelId={onSelectModelId}
                busy={busy}
                modelsLoading={modelsLoading}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
});

export interface KubeezGeneratePromptFieldProps {
  disabled: boolean;
  maxChars?: number;
  resetKey: number;
  promptRef: MutableRefObject<string>;
  /** Visible label (e.g. Prompt, Music prompt, Script). */
  label?: string;
  placeholder?: string;
  fieldId?: string;
}

/** Local prompt state so parent does not re-render the model grid on every keystroke. */
export function KubeezGeneratePromptField({
  disabled,
  maxChars,
  resetKey,
  promptRef,
  label = 'Prompt',
  placeholder = 'Describe what to generate…',
  fieldId = 'kubeez-prompt',
}: KubeezGeneratePromptFieldProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue('');
    promptRef.current = '';
  }, [resetKey, promptRef]);

  return (
    <div className="shrink-0 space-y-2">
      <Label htmlFor={fieldId} className="text-foreground/90">
        {label}
      </Label>
      <Textarea
        id={fieldId}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          promptRef.current = v;
        }}
        placeholder={placeholder}
        rows={4}
        disabled={disabled}
        className="max-h-40 min-h-[5.25rem] resize-y border-border/70 bg-card/50 text-sm shadow-inner shadow-black/10"
      />
      {maxChars !== undefined && (
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {value.length} / {maxChars} characters
        </p>
      )}
    </div>
  );
}
