'use client';

import { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { SPORTS, type ActivitySummary, type GoalMetric, type Sport } from '@/lib/training/types';
import { monthlyTotals, yearComparison } from '@/lib/training/progress';
import { useLang } from '@/lib/i18n';
import { SERIES, Segmented, tooltipStyle } from './shared';

const UNIT: Record<GoalMetric, string> = { distance: 'km', time: 'h', elevation: 'm', count: 'sessions' };
const LAST_YEAR = '#737373';

export default function ProgressTab({ activities, today }: { activities: ActivitySummary[]; today: string }) {
  const { t, locale } = useLang();
  const sportsPresent = useMemo(() => SPORTS.filter(s => activities.some(a => a.sport === s)), [activities]);
  const [sport, setSport] = useState<Sport | 'all'>(sportsPresent.includes('running') ? 'running' : 'all');
  const [metric, setMetric] = useState<GoalMetric>('distance');
  const year = Number(today.slice(0, 4));
  const unit = t(`training.units.${UNIT[metric]}`);

  const cmp = useMemo(() => yearComparison(activities, sport, metric, today), [activities, sport, metric, today]);
  const cumulative = useMemo(() => cmp.lastYear.map((v, i) => ({ day: i + 1, last: v, now: cmp.thisYear[i] ?? null })), [cmp]);
  const monthly = useMemo(() => {
    const now = monthlyTotals(activities, sport, metric, year);
    const last = monthlyTotals(activities, sport, metric, year - 1);
    const names = Array.from({ length: 12 }, (_, m) =>
      new Date(year, m, 1).toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-GB', { month: 'narrow' }));
    return names.map((name, m) => ({ name, now: now[m], last: last[m] }));
  }, [activities, sport, metric, year, locale]);

  // month starts as x ticks for the day-of-year chart
  const monthTicks = Array.from({ length: 12 }, (_, m) => Math.round((Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 864e5) + 1);
  const fmtV = (v: number) => (metric === 'time' ? Math.round(v * 10) / 10 : Math.round(v));
  const label = (k: 'now' | 'last') => (k === 'now' ? `${year}` : `${year - 1}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Segmented<Sport | 'all'> value={sport} onChange={setSport}
          options={(['all', ...sportsPresent.filter(s => s !== 'other')] as (Sport | 'all')[]).slice(0, 5)
            .map(s => ({ value: s, label: t(`training.sports.${s}`) }))} />
        <Segmented<GoalMetric> value={metric} onChange={setMetric}
          options={(['distance', 'time', 'elevation', 'count'] as GoalMetric[]).map(m => ({ value: m, label: t(`training.goals.metric.${m}`) }))} />
      </div>

      <div className="card">
        <div className="card-header"><span>{t('training.progress.ytd')}</span></div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-primary">{fmtV(cmp.thisYearToDate)}</span>
          <span className="text-sm text-secondary">{unit}</span>
          {cmp.deltaPct !== null && (
            <span className={`ml-auto text-xs font-semibold ${cmp.deltaPct >= 0 ? 'text-recovery-green' : 'text-recovery-yellow'}`}>
              {cmp.deltaPct >= 0 ? '+' : ''}{cmp.deltaPct}%
            </span>
          )}
        </div>
        <p className="text-[11px] text-secondary">
          {t('training.progress.vsLast', { value: `${fmtV(cmp.lastYearToDate)} ${unit}`, year: year - 1 })}
        </p>

        <div className="flex gap-4 text-[10px] text-secondary mt-3 mb-1">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: SERIES.a }} />{year}</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: LAST_YEAR }} />{year - 1}</span>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={cumulative} margin={{ top: 6, right: 6, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#1f1f1f" vertical={false} />
              <XAxis dataKey="day" type="number" domain={[1, cmp.lastYear.length]} ticks={monthTicks}
                tickFormatter={d => monthly[monthTicks.indexOf(d)]?.name ?? ''} tick={{ fill: '#737373', fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#737373', fontSize: 9 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip {...tooltipStyle}
                labelFormatter={d => new Date(Date.UTC(year, 0, Number(d))).toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                formatter={(v: number, k: string) => [`${fmtV(v)} ${unit}`, label(k as 'now' | 'last')]} />
              <Line dataKey="last" stroke={LAST_YEAR} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="now" stroke={SERIES.a} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><span>{t('training.progress.monthly')}</span></div>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 6, right: 6, bottom: 0, left: -12 }} barGap={2}>
              <CartesianGrid stroke="#1f1f1f" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#737373', fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: '#737373', fontSize: 9 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#ffffff08' }}
                formatter={(v: number, k: string) => [`${fmtV(v)} ${unit}`, label(k as 'now' | 'last')]} />
              <Bar dataKey="last" fill={LAST_YEAR} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="now" fill={SERIES.a} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
