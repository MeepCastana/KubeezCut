/**
 * When reference uploads are considered “complete” for Generate, aligned with
 * `kubeez-web-file-restrictions.ts` / `getFileLimitForModel`.
 */

import {
  inferGenerationTypeForKubeezCut,
  inferGenerationTypeFromConcreteModelId,
  inferKubeezCutFileLimitOptions,
} from './kubeez-generate-generation-context';
import type { KubeezMediaModelOption } from './kubeez-models';
import type { KubeezModelSettings } from './model-family-registry';
import { getFileLimitForModel } from './kubeez-web-file-restrictions';

export function isKlingMotionControlModelId(modelId: string): boolean {
  return (
    modelId.startsWith('kling-2-6-motion-control-') || modelId.startsWith('kling-3-0-motion-control-')
  );
}

/** Motion control: exactly one image + one video (order preserved for `source_media_urls`). */
export function motionControlReferencesComplete(attachments: { file: File }[]): boolean {
  if (attachments.length !== 2) return false;
  const hasImage = attachments.some((a) => a.file.type.startsWith('image/'));
  const hasVideo = attachments.some((a) => a.file.type.startsWith('video/'));
  return hasImage && hasVideo;
}

/**
 * Minimum reference file count before Generate is allowed (0 = optional unless I2V-only, handled by caller).
 */
export function minReferenceFilesRequired(params: {
  resolvedModelId: string;
  baseCardId: string;
  settings: KubeezModelSettings;
  uiModel: KubeezMediaModelOption | undefined;
}): number {
  const { resolvedModelId, baseCardId, settings, uiModel } = params;

  if (isKlingMotionControlModelId(resolvedModelId)) return 2;

  if (uiModel?.mediaKind === 'video' && uiModel.supportsImageToVideo && !uiModel.supportsTextToVideo) {
    return 1;
  }

  const gen =
    inferGenerationTypeForKubeezCut({ baseCardId, settings }) ??
    inferGenerationTypeFromConcreteModelId(resolvedModelId);

  if (gen === 'FIRST_AND_LAST_FRAMES_2_VIDEO') return 2;
  if (baseCardId === 'veo3-1' && settings.veo31?.mode === 'first-and-last-frames') return 2;
  /** Gemini Omni Video — `videoRef` mode requires the source video clip. */
  if (baseCardId === 'gemini-omni-video' && settings.geminiOmni?.videoRef) return 1;

  if (resolvedModelId.startsWith('kling-2-5-image-to-video-pro')) return 2;

  const opts = { multiShot: false as const, ...inferKubeezCutFileLimitOptions(settings) };
  const { maxFiles, message } = getFileLimitForModel(resolvedModelId, gen, opts);
  const m = message.toLowerCase();
  if (maxFiles === 2 && m.includes('required') && (m.includes('2 image') || m.includes('two image'))) {
    return 2;
  }

  return 0;
}

export function referenceAttachmentsMeetMinimum(params: {
  resolvedModelId: string;
  baseCardId: string;
  settings: KubeezModelSettings;
  uiModel: KubeezMediaModelOption | undefined;
  attachments: { file: File }[];
  /** From `effectiveMaxReferenceFilesForGenerateDialog`; when `0`, no uploads allowed. */
  maxReferenceFiles: number | undefined;
}): boolean {
  if (params.maxReferenceFiles === 0) return params.attachments.length === 0;
  const min = minReferenceFilesRequired(params);
  if (params.attachments.length < min) return false;
  if (isKlingMotionControlModelId(params.resolvedModelId)) {
    return motionControlReferencesComplete(params.attachments);
  }
  return true;
}
