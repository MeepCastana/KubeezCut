/**
 * Smart duration control for the generate dialog.
 *
 * - When the model exposes many contiguous integer-second options (≥ 5
 *   sequential values like 4s,5s,…,15s — Seedance 2, Kling 3.0, etc.),
 *   render a slider so picking a duration is one drag instead of opening
 *   a dropdown and scrolling through 13 entries.
 * - When the options are sparse / non-integer / few (e.g. Seedance 1.5 Pro
 *   = 4s/8s/12s, Sora-style 10s/15s, Kling 2.6 = 5s/10s) — render the
 *   existing Select dropdown. Discrete picks read better as a list.
 *
 * Both modes round-trip the same string format (`"<int>s"`) through
 * `value` / `onChange`, so the parent dialog doesn't care which UI
 * renders.
 */

import * as React from 'react';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface KubeezDurationPickerProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

interface ParsedOption {
  raw: string;
  seconds: number;
}

function parseOptions(options: readonly string[]): ParsedOption[] {
  const out: ParsedOption[] = [];
  for (const raw of options) {
    const m = /^(\d+)s$/.exec(raw.trim());
    if (!m) continue;
    out.push({ raw, seconds: Number(m[1]) });
  }
  return out.sort((a, b) => a.seconds - b.seconds);
}

function isContiguousIntegerRange(parsed: ParsedOption[]): boolean {
  if (parsed.length < 5) return false;
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i]!.seconds !== parsed[i - 1]!.seconds + 1) return false;
  }
  return true;
}

export function KubeezDurationPicker({
  options,
  value,
  onChange,
  disabled,
}: KubeezDurationPickerProps) {
  const parsed = React.useMemo(() => parseOptions(options), [options]);
  const useSlider = isContiguousIntegerRange(parsed);

  if (useSlider) {
    const min = parsed[0]!.seconds;
    const max = parsed[parsed.length - 1]!.seconds;
    const currentSeconds = (() => {
      const m = /^(\d+)s$/.exec(value.trim());
      const n = m ? Number(m[1]) : NaN;
      if (!Number.isFinite(n)) return min;
      return Math.min(max, Math.max(min, n));
    })();

    return (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] tabular-nums text-muted-foreground">{min}s</span>
          <span className="text-sm font-semibold tabular-nums text-foreground">{currentSeconds}s</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">{max}s</span>
        </div>
        <Slider
          min={min}
          max={max}
          step={1}
          value={[currentSeconds]}
          onValueChange={(v) => {
            const n = v[0];
            if (typeof n === 'number') onChange(`${n}s`);
          }}
          disabled={disabled}
        />
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="border-border/70 bg-card/50 shadow-sm">
        <SelectValue placeholder="Select duration" />
      </SelectTrigger>
      <SelectContent>
        {options.map((d) => (
          <SelectItem key={d} value={d}>
            {d}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
