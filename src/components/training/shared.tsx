'use client';

import Link from 'next/link';
import { parseISO } from 'date-fns';
import { Activity, Bike, Dumbbell, Footprints, Mountain, PersonStanding, Waves, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ActivitySummary, Sport } from '@/lib/training/types';
import { formatDuration, formatKm, formatPace } from '@/lib/training/format';
import { useLang } from '@/lib/i18n';

// Validated dark-surface palette (dataviz skill): only 3 hues stay distinguishable
// all-pairs for colour-blind readers, so other sports share a neutral and rely on
// their icon as the second cue.
const NEUTRAL = '#8a8a8a';
export const SPORT_META: Record<Sport, { color: string; Icon: LucideIcon }> = {
  running:  { color: '#d95926', Icon: Footprints },
  cycling:  { color: '#3987e5', Icon: Bike },
  swimming: { color: '#199e70', Icon: Waves },
  walking:  { color: NEUTRAL, Icon: PersonStanding },
  hiking:   { color: NEUTRAL, Icon: Mountain },
  strength: { color: NEUTRAL, Icon: Dumbbell },
  other:    { color: NEUTRAL, Icon: Activity },
};

/** Two-series chart colours (validated pair, dark surface). */
export const SERIES = { a: '#3987e5', b: '#d55181', c: '#d95926' } as const;

export function useDateFormat() {
  const { locale } = useLang();
  const loc = locale === 'es' ? 'es-ES' : 'en-GB';
  return (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
    parseISO(iso).toLocaleDateString(loc, opts);
}

/** Pace for runs/walks/hikes, speed for rides. */
export function speedLabel(a: Pick<ActivitySummary, 'sport' | 'distanceM' | 'durationSec'>): string {
  if (!a.distanceM || !a.durationSec) return '';
  if (a.sport === 'cycling') return `${Math.round((a.distanceM / a.durationSec) * 36) / 10} km/h`;
  if (a.sport === 'swimming') return `${formatPace((a.durationSec / a.distanceM) * 100)} /100m`;
  return `${formatPace((a.durationSec / a.distanceM) * 1000)} /km`;
}

export function ActivityRow({ a, effort }: { a: ActivitySummary; effort?: number | null }) {
  const { t } = useLang();
  const fmt = useDateFormat();
  const { color, Icon } = SPORT_META[a.sport];
  return (
    <Link href={`/activity/${a.id}`} className="flex items-center gap-3 py-2.5 border-b border-border last:border-0 group">
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${color}1f` }}>
        <Icon size={15} style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-primary truncate">{a.name}</p>
        <p className="text-[11px] text-secondary">
          {fmt(a.date, { weekday: 'short', day: 'numeric', month: 'short' })}
          {' · '}{formatDuration(a.durationSec)}
          {a.distanceM > 0 && <> · {formatKm(a.distanceM)} km · {speedLabel(a)}</>}
        </p>
      </div>
      {effort != null && (
        <div className="text-right">
          <p className="text-sm font-bold text-strain">{effort}</p>
          <p className="text-[9px] text-muted uppercase tracking-wider">{t('training.effort')}</p>
        </div>
      )}
      <ChevronRight size={14} className="text-muted group-hover:text-secondary" />
    </Link>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-bg border border-border rounded-xl p-0.5 gap-0.5">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
            value === o.value ? 'bg-surface text-primary' : 'text-secondary hover:text-primary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-bg border border-border px-3 py-2">
      <p className="text-[10px] text-muted uppercase tracking-widest">{label}</p>
      <p className={`text-lg font-bold ${color ? '' : 'text-primary'}`} style={color ? { color } : undefined}>{value}</p>
      {sub && <p className="text-[10px] text-secondary">{sub}</p>}
    </div>
  );
}

export const tooltipStyle = {
  contentStyle: { background: '#111111', border: '1px solid #1f1f1f', borderRadius: 8, fontSize: 11 },
  labelStyle: { color: '#737373' },
};
