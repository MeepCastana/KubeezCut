/**
 * Hero images for Kubeez generate model cards, ported from the Kubeez web app
 * (`modelCatalog` + `src/assets/model-backgrounds`). Bundled under `src/assets/kubeez-model-cards/`
 * so KubeezCut does not depend on a local KubeezWebsite tree.
 */
import flux2 from '@/assets/kubeez-model-cards/flux2.webp';
import gpt15 from '@/assets/kubeez-model-cards/gpt1.5.webp';
import gptImage2 from '@/assets/kubeez-model-cards/gpt-image-2.webp';
import grokimage from '@/assets/kubeez-model-cards/grokimage.webp';
import grokvideo from '@/assets/kubeez-model-cards/grokvideo.webp';
import imagen from '@/assets/kubeez-model-cards/imagen.webp';
import kling25 from '@/assets/kubeez-model-cards/kling2.5.webp';
import kling26 from '@/assets/kubeez-model-cards/kling2.6.webp';
import kling30 from '@/assets/kubeez-model-cards/kling3.0.webp';
import logomaker from '@/assets/kubeez-model-cards/logomaker.webp';
import nanobanana from '@/assets/kubeez-model-cards/nanobanana.webp';
import nanobanana2 from '@/assets/kubeez-model-cards/nanobanana2.webp';
import nanobananapro from '@/assets/kubeez-model-cards/nanobananapro.webp';
import pImageEdit from '@/assets/kubeez-model-cards/p-image-edit.webp';
import pVideo from '@/assets/kubeez-model-cards/p-video.webp';
import qwenimage2 from '@/assets/kubeez-model-cards/qwenimage2.webp';
import seedance from '@/assets/kubeez-model-cards/seedance.webp';
import seedance15 from '@/assets/kubeez-model-cards/seedance1.5.webp';
import seedreamV45 from '@/assets/kubeez-model-cards/seedreamv4-5.webp';
import seedreamV4 from '@/assets/kubeez-model-cards/seedreamv4.webp';
import seedreamV5Lite from '@/assets/kubeez-model-cards/seedreamv5-lite.webp';
import sora2 from '@/assets/kubeez-model-cards/sora2.webp';
import sora2Storyboard from '@/assets/kubeez-model-cards/sora2storyboard.webp';
import veo31 from '@/assets/kubeez-model-cards/veo3.1.webp';
import wan from '@/assets/kubeez-model-cards/wan.webp';
import zimage from '@/assets/kubeez-model-cards/zimage.webp';

import { findRegistryEntryForModelId } from './model-family-registry';

const BY_BASE_CARD_ID: Record<string, string> = {
  'seedance-1-5-pro': seedance15,
  'v1-pro-fast-i2v': seedance,
  'kling-2-6': kling26,
  'kling-2-6-motion': kling26,
  'kling-3-0': kling30,
  'sora-2': sora2,
  'veo3-1': veo31,
  'wan-2-5': wan,
  'kling-2-5-i2v': kling25,
  'grok-video': grokvideo,
  'nano-banana-2': nanobanana2,
  'nano-banana-pro': nanobananapro,
  'imagen-4': imagen,
  'z-image': zimage,
  'gpt-1.5-image': gpt15,
};

function imageForRegistryBase(baseCardId: string, modelId: string): string | undefined {
  if (baseCardId === 'sora-2' && modelId.includes('storyboard')) {
    return sora2Storyboard;
  }
  return BY_BASE_CARD_ID[baseCardId];
}

function resolveByPrefixHeuristics(id: string): string | undefined {
  const lower = id.toLowerCase();

  if (lower.includes('storyboard') && lower.startsWith('sora-2')) {
    return sora2Storyboard;
  }

  /** ByteDance "5 Lite" ids use `5-lite-*` (no `seedream-` prefix); same hero as Seedream V5 Lite on kubeez.com */
  if (lower.startsWith('5-lite-')) {
    return seedreamV5Lite;
  }

  if (lower.startsWith('nano-banana-2')) return nanobanana2;
  if (lower.startsWith('nano-banana-pro')) return nanobananapro;
  if (lower === 'nano-banana' || lower.startsWith('nano-banana-edit')) return nanobanana;

  if (lower.startsWith('qwen-')) return qwenimage2;

  if (lower.startsWith('flux-2') || lower.startsWith('flux-2-')) return flux2;

  if (lower.startsWith('imagen-4') || lower.startsWith('imagen-')) return imagen;
  if (lower.startsWith('z-image')) return zimage;
  if (lower.startsWith('gpt-1.5-image')) return gpt15;
  if (lower === 'gpt-image-2' || lower.startsWith('gpt-image-2')) return gptImage2;

  if (lower.startsWith('grok-text-to-image') || lower.startsWith('grok-image-to-image')) return grokimage;
  if (
    lower.startsWith('grok-text-to-video') ||
    lower === 'grok-image-to-video' ||
    lower.startsWith('grok-image-to-video')
  ) {
    return grokvideo;
  }

  if (lower.startsWith('seedream')) {
    /** v4.5 before v5 so `seedream-v4-5*` never matches v5-lite artwork */
    if (lower.includes('v4-5') || lower.includes('4_5') || lower.includes('45')) return seedreamV45;
    if (
      lower.includes('v5-lite') ||
      lower.includes('v5lite') ||
      lower.includes('-v5-') ||
      lower.endsWith('-v5') ||
      lower.includes('v5')
    ) {
      return seedreamV5Lite;
    }
    return seedreamV4;
  }

  if (lower.startsWith('seedance-1-5')) return seedance15;
  if (lower.startsWith('seedance')) return seedance;
  if (lower.startsWith('v1-pro-fast')) return seedance;

  if (lower.startsWith('kling-3-0')) return kling30;
  if (lower.startsWith('kling-2-6-motion')) return kling26;
  if (lower.startsWith('kling-2-6')) return kling26;
  if (lower.startsWith('kling-2-5')) return kling25;

  if (lower.startsWith('sora-2')) return sora2;
  if (lower.startsWith('veo3-1')) return veo31;
  if (lower.startsWith('wan-2-5') || lower === 'wan-2-5') return wan;

  if (lower.includes('logo-maker') || lower.startsWith('logo-maker')) return logomaker;
  if (lower === 'p-video' || lower.startsWith('p-video')) return pVideo;
  if (lower.includes('p-image-edit') || lower.startsWith('p-image')) return pImageEdit;

  return undefined;
}

/**
 * Returns a bundled image URL for the model picker hero when the API does not send `cardImageUrl`.
 * Maps `KUBEEZ_MODEL_FAMILY_REGISTRY` base cards and common API `model_id` prefixes to the same
 * artwork as the Kubeez website model catalog.
 */
export function resolveLocalKubeezModelCardImage(modelId: string, baseCardId?: string | null): string | undefined {
  const id = modelId.trim();
  if (!id) return undefined;

  if (baseCardId) {
    const fromBase = imageForRegistryBase(baseCardId, id);
    if (fromBase) return fromBase;
  }

  const entry = findRegistryEntryForModelId(id);
  if (entry) {
    const fromReg = imageForRegistryBase(entry.baseCardId, id);
    if (fromReg) return fromReg;
  }

  return resolveByPrefixHeuristics(id);
}
