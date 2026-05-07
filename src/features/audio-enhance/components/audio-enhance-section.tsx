/**
 * AudioEnhanceSection
 *
 * UI for AI voice enhancement. One-click toggle plus an "Advanced" disclosure
 * for the bake-time chain (HPF, hum, de-ess, compress, normalize). Shows
 * inline progress while the worker bakes the enhanced buffer.
 */

import { useCallback, useMemo, useState } from 'react';
import { Sparkles, ChevronDown, ChevronRight, AlertTriangle, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { PropertySection, PropertyRow } from '../deps/editor-ui';
import type { TimelineItem } from '@/types/timeline';
import {
  toggleAudioEnhance,
  setAudioEnhanceSettingsMany,
} from '../actions/enhance-actions';
import {
  useEnhanceJobsStore,
  selectErrorForMedia,
  selectJobForMedia,
} from '../stores/enhance-jobs-store';
import {
  withDefaults,
  hashBakeSettings,
  getBakeSettings,
} from '../types';

interface AudioEnhanceSectionProps {
  items: TimelineItem[];
}

/**
 * Items that can currently be enhanced.
 *
 * v1 limits enhancement to standalone audio clips because the swap to a
 * baked AudioBuffer requires the buffered Web Audio playback path. Video
 * items render their own DOM `<video>` audio (a different code path); when
 * we add support for those it'll either need a blob-URL render of the
 * enhanced buffer or a Web Audio detour, which we're keeping for v2.
 */
function getEnhanceableItems(items: TimelineItem[]): Array<TimelineItem & { mediaId?: string }> {
  return items.filter((item) => item.type === 'audio');
}

export function AudioEnhanceSection({ items }: AudioEnhanceSectionProps) {
  const enhanceable = useMemo(() => getEnhanceableItems(items), [items]);
  const itemIds = useMemo(() => enhanceable.map((i) => i.id), [enhanceable]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Resolve a representative settings object: take the first item's, since
  // a multi-select edit is cohesive. UI shows "mixed" if needed.
  const firstSettings = useMemo(() => withDefaults(enhanceable[0]?.audioEnhance), [enhanceable]);

  // For job-progress display: use the first enhanceable item's mediaId.
  const firstMediaId = enhanceable[0]?.mediaId;
  const settingsHash = useMemo(
    () => hashBakeSettings(getBakeSettings(firstSettings)),
    [firstSettings],
  );
  const job = useEnhanceJobsStore((s) =>
    firstMediaId ? selectJobForMedia(s, firstMediaId, settingsHash) : undefined,
  );
  const error = useEnhanceJobsStore((s) =>
    firstMediaId ? selectErrorForMedia(s, firstMediaId, settingsHash) : undefined,
  );
  const clearError = useEnhanceJobsStore((s) => s.clearError);

  const allEnabled = enhanceable.every((i) => i.audioEnhance?.enabled === true);
  const anyEnabled = enhanceable.some((i) => i.audioEnhance?.enabled === true);

  const handleToggle = useCallback(
    (next: boolean) => {
      // Apply per-item so each item's other settings are preserved.
      for (const id of itemIds) toggleAudioEnhance(id, next);
    },
    [itemIds],
  );

  const handleAdvanced = useCallback(
    (patch: Parameters<typeof setAudioEnhanceSettingsMany>[1]) => {
      setAudioEnhanceSettingsMany(itemIds, patch);
    },
    [itemIds],
  );

  if (enhanceable.length === 0) return null;

  return (
    <PropertySection title="Enhance Voice" icon={Sparkles} defaultOpen={true}>
      <div className="space-y-3">
        <PropertyRow label="AI Enhance">
          <div className="flex items-center gap-2 w-full">
            <Switch
              checked={allEnabled}
              onCheckedChange={handleToggle}
              aria-label="Toggle AI voice enhancement"
            />
            <span className="text-xs text-muted-foreground">
              {allEnabled ? 'On' : anyEnabled ? 'Mixed' : 'Off'}
            </span>
          </div>
        </PropertyRow>

        {/* Inline status */}
        {job && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-2 bg-muted/30 rounded">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="flex-1">Processing… {Math.round(job.progress * 100)}%</span>
            <Progress value={job.progress * 100} className="h-1 w-20" />
          </div>
        )}
        {error && firstMediaId && (
          <div className="flex items-center gap-2 text-xs text-destructive px-2 py-2 bg-destructive/10 rounded border border-destructive/20">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="flex-1 truncate" title={error}>{error}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => clearError(firstMediaId, settingsHash)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Advanced disclosure */}
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {advancedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Advanced
        </button>

        {advancedOpen && (
          <div className="space-y-2 pl-2 border-l-2 border-border">
            <PropertyRow label="Model">
              <select
                value={firstSettings.model ?? 'rnnoise'}
                onChange={(e) =>
                  handleAdvanced({ model: e.target.value as 'rnnoise' | 'dfn3' })
                }
                className="text-xs bg-background border border-input rounded px-2 py-1"
              >
                <option value="rnnoise">RNNoise (fast)</option>
                <option value="dfn3" disabled>
                  DeepFilterNet 3 — coming soon
                </option>
              </select>
            </PropertyRow>
            <PropertyRow label="Denoise">
              <Switch
                checked={firstSettings.denoise}
                onCheckedChange={(v) => handleAdvanced({ denoise: v })}
              />
            </PropertyRow>
            <PropertyRow label="Aggressive">
              <Switch
                checked={firstSettings.aggressive ?? false}
                onCheckedChange={(v) => handleAdvanced({ aggressive: v })}
              />
            </PropertyRow>
            <PropertyRow label="Rumble HPF">
              <Switch
                checked={firstSettings.highPass ?? true}
                onCheckedChange={(v) => handleAdvanced({ highPass: v })}
              />
            </PropertyRow>
            <PropertyRow label="Hum">
              <select
                value={firstSettings.hum ?? 'off'}
                onChange={(e) =>
                  handleAdvanced({ hum: e.target.value as 'off' | '50' | '60' })
                }
                className="text-xs bg-background border border-input rounded px-2 py-1"
              >
                <option value="off">Off</option>
                <option value="50">50 Hz</option>
                <option value="60">60 Hz</option>
              </select>
            </PropertyRow>
            <PropertyRow label="De-ess">
              <Switch
                checked={firstSettings.deEss ?? false}
                onCheckedChange={(v) => handleAdvanced({ deEss: v })}
              />
            </PropertyRow>
            <PropertyRow label="Voice EQ">
              <Switch
                checked={firstSettings.voiceEq ?? false}
                onCheckedChange={(v) => handleAdvanced({ voiceEq: v })}
              />
            </PropertyRow>
            <PropertyRow label="Compressor">
              <Switch
                checked={firstSettings.compress ?? true}
                onCheckedChange={(v) => handleAdvanced({ compress: v })}
              />
            </PropertyRow>
            <PropertyRow label="Normalize">
              <Switch
                checked={firstSettings.normalize ?? true}
                onCheckedChange={(v) => handleAdvanced({ normalize: v })}
              />
            </PropertyRow>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground leading-snug">
          Bakes a denoised copy of the audio with RNNoise. <strong>Aggressive</strong> adds a
          spectral-subtraction dereverb pass and runs denoise twice — best for echoey rooms or
          headphone-mic recordings; takes ~2× longer to bake. Bakes are saved to disk and reused
          on reload.
        </p>
      </div>
    </PropertySection>
  );
}
