'use client';

import { useMemo, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import { TrendingUp, Flame } from 'lucide-react';
import type { ActivitySummary, HrRef } from '@/lib/training/types';
import { dailyLoads, fitnessSeries, weeklyEfforts } from '@/lib/training/fitness';
import { activityEffort } from '@/lib/training/effort';
import { useLang } from '@/lib/i18n';
import { ActivityRow, Segmented, StatTile, SERIES, tooltipStyle, useDateFormat } from './shared';

const WARMUP_DAYS = 126; // 3 × 42 so the 42-day average has converged

/** TrainingPeaks-style form zones. */
function formZone(form: number): { key: 'fresh' | 'neutral' | 'optimal' | 'risk'; color: string } {
  if (form > 5) return { key: 'fresh', color: '#4ade80' };
  if (form >= -10) return { key: 'neutral', color: '#a3a3a3' };
  if (form >= -30) return { key: 'optimal', color: '#facc15' };
  return { key: 'risk', color: '#f87171' };
}

const STATUS_COLOR = { recovery: '#a3a3a3', maintain: '#4ade80', build: '#facc15', spike: '#f87171', none: '#525252', inProgress: '#a3a3a3' } as const;

export default function FitnessTab({ activities, zones, today }: { activities: ActivitySummary[]; zones: HrRef; today: string }) {
  const { t } = useLang();
  const fmt = useDateFormat();
  const [range, setRange] = useState<'90' | '180'>('90');

  const series = useMemo(() => {
    const days = Number(range);
    const end = parseISO(today);
    const from = format(subDays(end, days - 1 + WARMUP_DAYS), 'yyyy-MM-dd');
    return fitnessSeries(dailyLoads(activities, zones, from, today)).slice(-days);
  }, [activities, zones, today, range]);

  const weeks = useMemo(() => weeklyEfforts(activities, zones, today, 12), [activities, zones, today]);
  const recent = useMemo(() => [...activities].reverse().slice(0, 8), [activities]);
  const noHR = useMemo(
    () => activities.filter(a => a.date >= format(subDays(parseISO(today), 89), 'yyyy-MM-dd') && activityEffort(a, zones).effort === null).length,
    [activities, zones, today],
  );

  const now = series[series.length - 1];
  const weekAgo = series[series.length - 8];
  const zone = now ? formZone(now.form) : null;
  const thisWeek = weeks[weeks.length - 1];
  // A week in progress below its range isn't a recovery week (yet)
  const thisWeekStatus = thisWeek && thisWeek.status === 'recovery' ? 'inProgress' : thisWeek?.status;
  const maxWeek = Math.max(1, ...weeks.map(w => Math.max(w.effort, w.high)));
  const tickEvery = Math.ceil(series.length / 5);

  return (
    <div className="flex flex-col gap-4">
      {/* Fitness & Freshness */}
      <div className="card">
        <div className="card-header">
          <TrendingUp size={14} />
          <span>{t('training.fitness.chartTitle')}</span>
          <div className="ml-auto w-28">
            <Segmented value={range} onChange={setRange} options={[{ value: '90', label: '90d' }, { value: '180', label: '180d' }]} />
          </div>
        </div>

        {now && zone && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <StatTile
              label={t('training.fitness.fitness')}
              value={String(Math.round(now.fitness))}
              sub={weekAgo ? `${now.fitness - weekAgo.fitness >= 0 ? '+' : ''}${Math.round(now.fitness - weekAgo.fitness)} / 7d` : undefined}
            />
            <StatTile label={t('training.fitness.fatigue')} value={String(Math.round(now.fatigue))} />
            <StatTile
              label={t('training.fitness.form')}
              value={`${now.form > 0 ? '+' : ''}${Math.round(now.form)}`}
              sub={t(`training.fitness.formZones.${zone.key}`)}
              color={zone.color}
            />
          </div>
        )}

        {/* legend (2 series) */}
        <div className="flex gap-4 text-[10px] text-secondary mb-1">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: SERIES.a }} />{t('training.fitness.fitness')}</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: SERIES.b }} />{t('training.fitness.fatigue')}</span>
        </div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#1f1f1f" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#737373', fontSize: 9 }} tickLine={false} axisLine={false}
                interval={tickEvery - 1} tickFormatter={d => fmt(d)} />
              <YAxis tick={{ fill: '#737373', fontSize: 9 }} tickLine={false} axisLine={false} width={40}
                domain={[(min: number) => Math.max(0, Math.floor((min - 10) / 10) * 10), (max: number) => Math.ceil((max + 10) / 10) * 10]} />
              <Tooltip {...tooltipStyle} labelFormatter={d => fmt(String(d), { weekday: 'short', day: 'numeric', month: 'short' })}
                formatter={(v: number, name: string) => [Math.round(v), t(`training.fitness.${name}`)]} />
              <Line type="monotone" dataKey="fitness" stroke={SERIES.a} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="fatigue" stroke={SERIES.b} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* form: own chart, own scale (no dual axis) */}
        <p className="text-[10px] text-secondary mt-3 mb-1">{t('training.fitness.form')}</p>
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
              <XAxis dataKey="date" hide />
              <YAxis tick={{ fill: '#737373', fontSize: 9 }} tickLine={false} axisLine={false} width={40} />
              <ReferenceLine y={0} stroke="#404040" />
              <ReferenceLine y={-30} stroke="#f87171" strokeDasharray="3 3" strokeOpacity={0.5} />
              <Tooltip {...tooltipStyle} labelFormatter={d => fmt(String(d))} formatter={(v: number) => [Math.round(v), t('training.fitness.form')]} />
              <Line type="monotone" dataKey="form" stroke="#a3a3a3" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-muted mt-2 leading-relaxed">{t('training.fitness.explain')}</p>
        {noHR > 0 && <p className="text-[10px] text-muted mt-1">{t('training.fitness.noHR', { n: noHR })}</p>}
      </div>

      {/* Weekly effort with range */}
      <div className="card">
        <div className="card-header">
          <Flame size={14} />
          <span>{t('training.fitness.weekly')}</span>
        </div>
        {thisWeek && (
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl font-bold text-primary">{thisWeek.effort}</span>
            <span className="text-[11px] text-secondary">{t('training.fitness.thisWeek')}</span>
            <span className="ml-auto text-[11px] font-semibold" style={{ color: STATUS_COLOR[thisWeekStatus ?? 'none'] }}>
              {t(`training.fitness.weekStatus.${thisWeekStatus}`)}
            </span>
          </div>
        )}
        <div className="flex items-end gap-1.5 h-28">
          {weeks.map(w => {
            const isNow = w === thisWeek;
            return (
              <div key={w.weekStart} className="flex-1 h-full relative group" title={`${fmt(w.weekStart)} · ${w.effort} (${w.low}–${w.high})`}>
                {w.high > 0 && (
                  <div className="absolute inset-x-0 rounded-sm bg-white/5 border-y border-white/10"
                    style={{ bottom: `${(w.low / maxWeek) * 100}%`, height: `${((w.high - w.low) / maxWeek) * 100}%` }} />
                )}
                <div className="absolute inset-x-1 bottom-0 rounded-t"
                  style={{ height: `${Math.max(2, (w.effort / maxWeek) * 100)}%`, background: STATUS_COLOR[isNow ? thisWeekStatus ?? 'none' : w.status], opacity: isNow ? 1 : 0.7 }} />
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-surface border border-border rounded px-1.5 py-0.5 text-[10px] text-primary whitespace-nowrap z-10">
                  {w.effort}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-1.5 mt-1">
          {weeks.map((w, i) => (
            <span key={w.weekStart} className="flex-1 text-center text-[8px] text-muted">{i % 3 === 0 ? fmt(w.weekStart) : ''}</span>
          ))}
        </div>
        {thisWeek && thisWeek.high > 0 && (
          <p className="text-[10px] text-muted mt-2">{t('training.fitness.range', { low: thisWeek.low, high: thisWeek.high })}</p>
        )}
      </div>

      {/* Recent activities */}
      <div className="card">
        <div className="card-header"><span>{t('training.fitness.recent')}</span></div>
        {recent.map(a => <ActivityRow key={a.id} a={a} effort={activityEffort(a, zones).effort} />)}
      </div>
    </div>
  );
}
