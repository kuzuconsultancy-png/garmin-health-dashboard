'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { format, parseISO, subDays } from 'date-fns';
import { Trophy, Timer, Gauge, Loader2 } from 'lucide-react';
import type { ActivitySummary, StoredEffort } from '@/lib/training/types';
import { RACES, raceTimeFromVdot, speedAtFraction } from '@/lib/training/predictions';
import type { VdotInfo } from '@/lib/training/hooks';
import { EFFORT_DISTANCES, personalRecords } from '@/lib/training/bestEfforts';
import { EFFORT_LABELS, formatDuration, formatPace } from '@/lib/training/format';
import { useLang } from '@/lib/i18n';
import { useDateFormat } from './shared';

// Daniels' training intensities as fractions of VO2max (range shown as slow–fast pace)
const PACES = [
  { key: 'easy', lo: 0.59, hi: 0.74 },
  { key: 'marathon', lo: 0.75, hi: 0.84 },
  { key: 'threshold', lo: 0.83, hi: 0.88 },
  { key: 'interval', lo: 0.95, hi: 1.0 },
  { key: 'repetition', lo: 1.05, hi: 1.1 },
] as const;

interface Props {
  activities: ActivitySummary[];
  today: string;
  efforts: StoredEffort[];
  progress: { processed: number; total: number; done: boolean; failed: number };
  vdot: VdotInfo;
}

export default function RecordsTab({ activities, today, efforts, progress, vdot }: Props) {
  const { t } = useLang();
  const fmt = useDateFormat();
  const since56 = format(subDays(parseISO(today), 56), 'yyyy-MM-dd');
  const since365 = format(subDays(parseISO(today), 365), 'yyyy-MM-dd');

  const allTime = useMemo(() => personalRecords(efforts), [efforts]);
  const lastYear = useMemo(() => personalRecords(efforts, since365), [efforts, since365]);
  const runs = activities.filter(a => a.sport === 'running');

  const predictions = useMemo(
    () => RACES.map(r => ({ ...r, timeSec: vdot.vdot ? raceTimeFromVdot(vdot.vdot, r.distM) : null })),
    [vdot.vdot],
  );
  // Long-race predictions assume long-run training; say so when recent long runs are short
  const longestKm = Math.round(Math.max(0, ...runs.filter(r => r.date >= since56).map(r => r.distanceM)) / 100) / 10;
  const caveat = longestKm < 28 ? 'marathon' : null;
  const halfCaveat = longestKm < 14;

  if (!runs.length) {
    return <div className="card text-center py-8 text-sm text-secondary">{t('training.records.noRuns')}</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {!progress.done && (
        <div className="card flex items-center gap-2 !py-2.5">
          <Loader2 size={14} className="animate-spin text-strain" />
          <span className="text-[11px] text-secondary">{t('training.records.analyzing', { done: progress.processed, total: progress.total })}</span>
        </div>
      )}

      {/* Race predictions */}
      <div className="card">
        <div className="card-header"><Timer size={14} /><span>{t('training.records.predictions')}</span></div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 gap-y-2 items-baseline">
          <span />
          <span className="text-[10px] text-muted uppercase tracking-wider text-right">{t('training.records.predicted')}</span>
          <span className="text-[10px] text-muted uppercase tracking-wider text-right">{t('training.records.pace')}</span>
          {predictions.map(p => (
            <div key={p.key} className="contents">
              <span className="text-sm text-secondary">{t(`training.records.races.${p.key}`)}</span>
              <span className="text-sm font-bold text-primary text-right tabular-nums">{p.timeSec ? formatDuration(p.timeSec) : '—'}</span>
              <span className="text-sm text-secondary text-right tabular-nums">{p.timeSec ? `${formatPace((p.timeSec / p.distM) * 1000)} /km` : ''}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted mt-3 leading-relaxed">
          {vdot.source === 'efforts' && vdot.from
            ? t('training.records.basedOnEffort', {
                dist: EFFORT_LABELS[vdot.from.distM] ?? `${Math.round(vdot.from.distM)} m`,
                time: formatDuration(vdot.from.timeSec),
                date: fmt(vdot.from.date),
                vdot: vdot.vdot ?? '',
              })
            : vdot.source === 'garmin'
              ? t('training.records.basedOnGarmin', { vdot: vdot.vdot ?? '' })
              : t('training.records.basedOnNothing')}
        </p>
        {vdot.vdot && (caveat || halfCaveat) && (
          <p className="text-[10px] text-recovery-yellow mt-1 leading-relaxed">
            {t('training.records.longRunNote', {
              km: longestKm,
              race: halfCaveat ? `${t('training.records.races.half')} / ${t('training.records.races.marathon')}` : t('training.records.races.marathon'),
            })}
          </p>
        )}
      </div>

      {/* Training paces */}
      {vdot.vdot && (
        <div className="card">
          <div className="card-header"><Gauge size={14} /><span>{t('training.records.paces')}</span></div>
          {PACES.map(p => (
            <div key={p.key} className="flex justify-between py-1.5 border-b border-border last:border-0">
              <span className="text-sm text-secondary">{t(`training.records.paceNames.${p.key}`)}</span>
              <span className="text-sm text-primary tabular-nums">
                {formatPace(1000 / speedAtFraction(vdot.vdot!, p.lo))}–{formatPace(1000 / speedAtFraction(vdot.vdot!, p.hi))} /km
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Best efforts */}
      <div className="card">
        <div className="card-header"><Trophy size={14} /><span>{t('training.records.bestEfforts')}</span></div>
        <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0">
          <span />
          <span className="text-[10px] text-muted uppercase tracking-wider pb-1">{t('training.records.allTime')}</span>
          <span className="text-[10px] text-muted uppercase tracking-wider pb-1">{t('training.records.last365')}</span>
          {EFFORT_DISTANCES.map(d => {
            const pr = allTime.get(d);
            const recent = lastYear.get(d);
            return (
              <div key={d} className="contents">
                <span className="text-sm text-secondary py-2 border-t border-border">{EFFORT_LABELS[d]}</span>
                <EffortCell e={pr} fmt={fmt} />
                <EffortCell e={recent} fmt={fmt} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EffortCell({ e, fmt }: { e?: StoredEffort; fmt: ReturnType<typeof useDateFormat> }) {
  if (!e) return <span className="text-sm text-muted py-2 border-t border-border">—</span>;
  return (
    <Link href={`/activity/${e.activityId}`} className="py-2 border-t border-border">
      <span className="block text-sm font-bold text-primary tabular-nums">{formatDuration(e.timeSec)}</span>
      <span className="block text-[10px] text-secondary">{fmt(e.date, { day: 'numeric', month: 'short', year: '2-digit' })}</span>
    </Link>
  );
}
