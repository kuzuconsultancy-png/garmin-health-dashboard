'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SPORTS, type ActivitySummary, type HrRef, type Sport } from '@/lib/training/types';
import { buildTrainingLog } from '@/lib/training/log';
import { formatHours, formatKm } from '@/lib/training/format';
import { useLang } from '@/lib/i18n';
import { SPORT_META, useDateFormat } from './shared';

/** Bubble diameter: area ∝ effort (sqrt), clamped 14–40 px. Sessions without HR get the minimum. */
const bubbleSize = (effort: number | null) => Math.max(14, Math.min(40, Math.sqrt(effort ?? 0) * 2.6));

export default function LogTab({ activities, zones, today }: { activities: ActivitySummary[]; zones: HrRef; today: string }) {
  const { t } = useLang();
  const fmt = useDateFormat();
  const [weeks, setWeeks] = useState(12);
  const log = useMemo(() => buildTrainingLog(activities, zones, today, weeks), [activities, zones, today, weeks]);
  const sportsPresent = useMemo(() => SPORTS.filter(s => activities.some(a => a.sport === s)), [activities]);
  const dayLetters = log[0]?.days.map(d => fmt(d.date, { weekday: 'narrow' })) ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* legend */}
      <div className="flex flex-wrap gap-3 px-1">
        {sportsPresent.map(s => {
          const { color, Icon } = SPORT_META[s];
          return (
            <span key={s} className="flex items-center gap-1 text-[10px] text-secondary">
              <Icon size={11} style={{ color }} /> {t(`training.sports.${s}`)}
            </span>
          );
        })}
      </div>

      <div className="grid grid-cols-7 px-3 text-center">
        {dayLetters.map((l, i) => <span key={i} className="text-[10px] text-muted uppercase">{l}</span>)}
      </div>

      {log.map(w => (
        <div key={w.weekStart} className="card !p-3">
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[11px] font-semibold text-secondary">{t('training.log.week', { date: fmt(w.weekStart) })}</span>
            <span className="text-[11px] text-secondary">
              {w.totals.count > 0
                ? <>{formatHours(w.totals.durationSec)} · {formatKm(w.totals.distanceM)} km · <span className="text-strain font-semibold">{w.totals.effort}</span></>
                : t('training.log.rest')}
            </span>
          </div>
          <div className="grid grid-cols-7 items-center min-h-[44px]">
            {w.days.map(d => (
              <div key={d.date} className={`flex flex-col items-center justify-center gap-0.5 ${d.date > today ? 'opacity-30' : ''}`}>
                {d.sessions.length === 0 && <span className="w-1 h-1 rounded-full bg-muted" />}
                {d.sessions.map(s => {
                  const { color, Icon } = SPORT_META[s.sport];
                  const size = bubbleSize(s.effort);
                  return (
                    <Link key={s.id} href={`/activity/${s.id}`} title={`${s.name} · ${s.effort ?? '–'}`}
                      className="rounded-full flex items-center justify-center ring-2 ring-surface"
                      style={{ width: size, height: size, background: color }}>
                      {size >= 22 && <Icon size={Math.round(size * 0.45)} className="text-white/90" />}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
          {Object.keys(w.bySport).length > 1 && (
            <div className="flex gap-3 mt-2 pt-2 border-t border-border">
              {(Object.entries(w.bySport) as [Sport, NonNullable<typeof w.bySport[Sport]>][]).map(([sport, tot]) => (
                <span key={sport} className="text-[10px] text-secondary flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: SPORT_META[sport].color }} />
                  {t(`training.sports.${sport}`)} {formatHours(tot.durationSec)}
                  {tot.distanceM > 0 && ` · ${formatKm(tot.distanceM)} km`}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      <button onClick={() => setWeeks(w => w + 12)}
        className="py-2.5 rounded-xl text-xs font-semibold text-secondary border border-border hover:text-primary hover:bg-surface transition-colors">
        {t('training.log.more')}
      </button>
    </div>
  );
}
