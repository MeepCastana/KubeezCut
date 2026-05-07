/**
 * Synced from KubeezWebsite `src/components/video/config/fileRestrictions.ts`.
 * Do not edit behavior by hand — port changes from that file when limits change.
 *
 * Types: `AIModel` → `string`; `Veo31Tier` → `KubeezVeo31Tier` from model-family-registry.
 */

import type { KubeezVeo31Tier } from './model-family-registry';

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-matroska'];
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes (final compressed size limit)
export const MAX_INPUT_FILE_SIZE = 50 * 1024 * 1024; // 50MB in bytes (maximum input file size before compression)

/** Kling 2.6 / 3.0 Motion Control: reference video length bounds (seconds), aligned with media generation. */
export const KLING_MOTION_MIN_VIDEO_DURATION_SEC = 3;
export const KLING_MOTION_MAX_VIDEO_DURATION_SEC = 30;

/** Kling 3.0 Elements: image constraints (JPG/PNG, min 300x300px, max 10MB). */
export const KLING_ELEMENT_IMAGE_MAX_SIZE = 10 * 1024 * 1024;
export const KLING_ELEMENT_VIDEO_MAX_SIZE = 50 * 1024 * 1024;
export const KLING_ELEMENT_IMAGE_MIN_DIM = 300;
/** Per-element reference image count (API: 2–4 URLs per element). */
export const KLING_ELEMENT_MIN_IMAGES = 2;
export const KLING_ELEMENT_MAX_IMAGES = 4;
/** Max number of named elements in Kling 3.0 settings (matches validateGeneration). */
export const KLING_ELEMENTS_MAX_COUNT = 3;
export const ACCEPTED_KLING_ELEMENT_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
export const ACCEPTED_KLING_ELEMENT_VIDEO_TYPES = ['video/mp4', 'video/quicktime'] as const;

export interface KubeezWebFileLimit {
  maxFiles: number;
  message: string;
  translationKey?: string;
}

export function getFileLimitForModel(
  model: string,
  generationType?: string,
  options?: { multiShot?: boolean; veo31Tier?: KubeezVeo31Tier }
): KubeezWebFileLimit {
  // Nano Banana models
  if (model === 'nano-banana' || model === 'nano-banana-edit') {
    return {
      maxFiles: 10,
      message: 'Nano Banana: Max 10 images',
    };
  }
  // Nano Banana Pro has different limits (including variants like nano-banana-pro-2K, nano-banana-pro-4K)
  if (model === 'nano-banana-pro' || model.startsWith('nano-banana-pro-')) {
    return {
      maxFiles: 8,
      message: 'Nano Banana Pro: Max 8 images',
      translationKey: 'errors.maxImagesExceededNanoBananaPro',
    };
  }
  // Nano Banana 2 (including variants nano-banana-2-2K, nano-banana-2-4K)
  if (model === 'nano-banana-2' || model.startsWith('nano-banana-2-')) {
    return {
      maxFiles: 8,
      message: 'Nano Banana 2: Max 8 images',
    };
  }

  // Kling 2.6 / 3.0 Motion Control: requires 1 image + 1 video (must be before mode-specific blocks)
  if (model?.startsWith('kling-2-6-motion-control') || model?.startsWith('kling-3-0-motion-control')) {
    return {
      maxFiles: 2,
      message: 'Motion Control requires 1 image and 1 video.',
    };
  }

  // Veo 3.1 Lite tier (standalone lite IDs or Lite selected on the unified card)
  if (
    model === 'veo3-1-lite' ||
    model.startsWith('veo3-1-lite-') ||
    (options?.veo31Tier === 'lite' && model.startsWith('veo3-1-'))
  ) {
    if (generationType === 'FIRST_AND_LAST_FRAMES_2_VIDEO') {
      return {
        maxFiles: 2,
        message: 'Image to Video mode: Max 2 images (start frame and end frame)',
        translationKey: 'errors.maxImagesExceededVeo31ImageToVideo',
      };
    }
    return {
      maxFiles: 1,
      message: 'Text to Video mode: Max 1 image',
      translationKey: 'errors.maxImagesExceededVeo31TextToVideo',
    };
  }

  // Veo 3.1 (both quality and fast variants, and all mode-specific variants like veo3-1-fast-text-to-video)
  if (model === 'veo3-1' || model === 'veo3-1-fast' || model.startsWith('veo3-1-')) {
    if (generationType === 'FIRST_AND_LAST_FRAMES_2_VIDEO') {
      return {
        maxFiles: 2,
        message: 'Image to Video mode: Max 2 images (start frame and end frame)',
        translationKey: 'errors.maxImagesExceededVeo31ImageToVideo',
      };
    } else if (generationType === 'REFERENCE_2_VIDEO') {
      return {
        maxFiles: 3,
        message: 'Reference to Video mode: Max 3 reference images',
        translationKey: 'errors.maxImagesExceededVeo31Reference',
      };
    } else {
      // Default for Veo 3.1 (TEXT_2_VIDEO or unset)
      return {
        maxFiles: 1,
        message: 'Text to Video mode: Max 1 image',
        translationKey: 'errors.maxImagesExceededVeo31TextToVideo',
      };
    }
  }

  // Kling 2.6: Image-to-Video mode requires exactly 1 image
  if (
    (model === 'kling-2-6-text-to-video' ||
      model === 'kling-2-6-image-to-video' ||
      model.startsWith('kling-2-6-')) &&
    generationType === 'IMAGE_2_VIDEO'
  ) {
    return {
      maxFiles: 1,
      message: 'Kling 2.6 Image-to-Video requires exactly 1 image.',
    };
  }

  // Kling 2.6: Text-to-Video mode (no images allowed)
  if (
    (model === 'kling-2-6-text-to-video' ||
      model === 'kling-2-6-image-to-video' ||
      model.startsWith('kling-2-6-')) &&
    generationType === 'TEXT_2_VIDEO'
  ) {
    return {
      maxFiles: 0,
      message: 'Kling 2.6 Text-to-Video does not support image attachments',
    };
  }

  // Wan 2.5
  if (model === 'wan-2-5' || model.startsWith('wan-2-5-')) {
    return {
      maxFiles: 1,
      message: 'Image to Video mode: Max 1 image',
    };
  }

  // Seedream V4
  if (model === 'seedream-v4' || model === 'seedream-v4-edit' || model.startsWith('seedream-v4-')) {
    return {
      maxFiles: 10,
      message: 'Seedream V4 Edit: Max 10 images for editing',
    };
  }

  // Seedream 5 Lite
  if (model === '5-lite-text-to-image' || model === '5-lite-image-to-image') {
    return {
      maxFiles: 10,
      message: 'Seedream 5 Lite Edit: Max 10 images for editing',
    };
  }

  // Wan NSFW: image-to-image mode supports multiple images
  if ((model === 'wan-nsfw' || model.startsWith('wan-nsfw-')) && generationType === 'image-to-image') {
    return {
      maxFiles: 10,
      message: 'Image to Image mode: Max 10 images',
    };
  }

  // Wan NSFW Video: image-to-video mode supports 1 image
  if (
    (model === 'wan-nsfw-video' || model.startsWith('wan-nsfw-video-')) &&
    generationType === 'image-to-video'
  ) {
    return {
      maxFiles: 1,
      message: 'Image to Video mode: Max 1 image',
    };
  }

  // Wan NSFW I2V: always requires 1 image
  if (model === 'wan-nsfw-i2v' || model.startsWith('wan-nsfw-i2v-')) {
    return {
      maxFiles: 1,
      message: 'Image to Video mode: Max 1 image',
    };
  }

  // Wan NSFW I2I: always supports multiple images
  if (model === 'wan-nsfw-i2i' || model.startsWith('wan-nsfw-i2i-')) {
    return {
      maxFiles: 10,
      message: 'Image to Image mode: Max 10 images',
    };
  }

  // Grok Image-to-Video: requires exactly 1 image
  if (model === 'grok-image-to-video' || model.startsWith('grok-image-to-video-')) {
    return {
      maxFiles: 1,
      message: 'Grok Image-to-Video requires exactly 1 image (max 10MB, JPEG/PNG/WebP)',
      translationKey: 'errors.maxImagesExceededGrokImageToVideo',
    };
  }

  // Qwen Image 2 (reference edit): max 1 image
  if (model === 'qwen-text-to-image' || model === 'qwen-image-to-image') {
    return {
      maxFiles: 1,
      message: 'Qwen Image 2 edit: Max 1 reference image',
      translationKey: 'errors.maxImagesExceededQwenImageEdit',
    };
  }

  if (model === 'p-image-edit') {
    return {
      maxFiles: 8,
      message: 'P Image Edit: Up to 8 reference images',
    };
  }

  // V1 Pro Fast Image To Video: requires exactly 1 image (base model and all variants)
  if (model === 'v1-pro-fast-i2v' || model.startsWith('v1-pro-fast-i2v-')) {
    return {
      maxFiles: 1,
      message: 'Seedance 1.0 requires exactly 1 image (max 10MB, JPEG/PNG/WebP)',
      translationKey: 'errors.maxImagesExceededSeedance',
    };
  }

  // Seedance 1.5 Pro: mode-dependent limits
  if (model === 'seedance-1-5-pro' || model.startsWith('seedance-1-5-pro-')) {
    if (generationType === 'IMAGE_2_VIDEO') {
      return {
        maxFiles: 2,
        message: 'Image to Video mode: 2 images required (start frame and end frame)',
        translationKey: 'errors.maxImagesExceededSeedance15ImageToVideo',
      };
    }
    // TEXT_2_VIDEO or default: up to 1 image optional
    return {
      maxFiles: 1,
      message: 'Text to Video: Max 1 image to animate',
      translationKey: 'errors.maxImagesExceededSeedance15TextToVideo',
    };
  }

  // Kling 2.5 Image To Video Pro: requires exactly 2 images (start frame and end frame)
  if (model === 'kling-2-5-image-to-video-pro' || model.startsWith('kling-2-5-image-to-video-pro-')) {
    return {
      maxFiles: 2,
      message: 'Image to Video mode: Max 2 images (start frame and end frame)',
    };
  }

  // Kling 3.0: mode-aware limits
  if (model === 'kling-3-0-std' || model === 'kling-3-0-pro') {
    // Multi-shot: max 1 optional image (like storyboard)
    if (options?.multiShot) {
      return {
        maxFiles: 1,
        message: 'Multi-shot: Max 1 image',
        translationKey: 'fileLimit.kling3MultiShot',
      };
    }
    if (generationType === 'IMAGE_2_VIDEO') {
      return {
        maxFiles: 2,
        message: 'Image to Video: 2 images required (start frame and end frame)',
        translationKey: 'fileLimit.kling3ImageToVideo',
      };
    }
    // TEXT_2_VIDEO or default: optional 0-1 image
    return {
      maxFiles: 1,
      message: 'Text to Video: Max 1 image',
      translationKey: 'fileLimit.kling3TextToVideo',
    };
  }

  // Flux 2 Edit: supports up to 8 images for image-to-image mode (regardless of resolution)
  if (model === 'flux-2-edit' || model === 'flux-2-edit-1K' || model === 'flux-2-edit-2K') {
    return {
      maxFiles: 8,
      message: 'Flux 2 Edit: Max 8 images for image-to-image mode',
      translationKey: 'errors.maxImagesExceededFlux2Edit',
    };
  }

  // GPT 1.5 Image: supports up to 16 images for image-to-image mode
  if (model === 'gpt-1.5-image-medium' || model === 'gpt-1.5-image-high') {
    return {
      maxFiles: 16,
      message: 'GPT 1.5 Image: Max 16 images for image-to-image mode',
      translationKey: 'errors.maxImagesExceededGPT15Image',
    };
  }

  // GPT Image 2: supports up to 16 images for image-to-image mode
  if (model === 'gpt-image-2') {
    return {
      maxFiles: 16,
      message: 'GPT Image 2: Max 16 images for image-to-image mode',
    };
  }

  // Default: no limit
  return {
    maxFiles: Infinity,
    message: '',
  };
}

export function validateFileType(fileType: string): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(fileType);
}

export function validateFileSize(fileSize: number): boolean {
  return fileSize <= MAX_FILE_SIZE;
}

export function getFileSizeInMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2);
}

export function getMaxFileSizeForModel(model: string, fileType?: string): number {
  const isVideo = fileType?.startsWith('video/');
  if (isVideo && (model?.startsWith('kling-2-6-motion-control') || model?.startsWith('kling-3-0-motion-control'))) {
    return 100 * 1024 * 1024; // 100MB for Motion Control videos
  }
  return MAX_FILE_SIZE; // Default 10MB
}

/** Validate Kling 3.0 element image: JPG/PNG, min 300x300px, max 10MB. */
export async function validateKlingElementImage(file: File): Promise<{ valid: boolean; error?: string }> {
  if (
    !ACCEPTED_KLING_ELEMENT_IMAGE_TYPES.includes(
      file.type as (typeof ACCEPTED_KLING_ELEMENT_IMAGE_TYPES)[number]
    )
  ) {
    return { valid: false, error: 'Element images must be JPG or PNG' };
  }
  if (file.size > KLING_ELEMENT_IMAGE_MAX_SIZE) {
    return {
      valid: false,
      error: `Element image must be max 10MB (current: ${getFileSizeInMB(file.size)}MB)`,
    };
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w < KLING_ELEMENT_IMAGE_MIN_DIM || h < KLING_ELEMENT_IMAGE_MIN_DIM) {
        resolve({
          valid: false,
          error: `Element image must be at least 300×300px (current: ${w}×${h})`,
        });
      } else {
        resolve({ valid: true });
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ valid: false, error: 'Could not load image' });
    };
    img.src = url;
  });
}

/** Validate Kling 3.0 element video: MP4/MOV, max 50MB. */
export function validateKlingElementVideo(file: File): { valid: boolean; error?: string } {
  if (
    !ACCEPTED_KLING_ELEMENT_VIDEO_TYPES.includes(
      file.type as (typeof ACCEPTED_KLING_ELEMENT_VIDEO_TYPES)[number]
    )
  ) {
    return { valid: false, error: 'Element videos must be MP4 or MOV' };
  }
  if (file.size > KLING_ELEMENT_VIDEO_MAX_SIZE) {
    return {
      valid: false,
      error: `Element video must be max 50MB (current: ${getFileSizeInMB(file.size)}MB)`,
    };
  }
  return { valid: true };
}
