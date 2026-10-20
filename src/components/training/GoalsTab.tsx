'use client';

import { useState } from 'react';
import { Target, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import type { ActivitySummary, Goal, GoalMetric, GoalPeriod, Sport } from '@/lib/training/types';
import { goalProgress } from '@/lib/training/goals';
import { useGoals } from '@/lib/training/hooks';
import { useLang } from '@/lib/i18n';
import { SPORT_META } from './shared';

const METRIC_UNIT: Record<GoalMetric, string> = { distance: 'km', time: 'h', elevation: 'm', count: 'sessions' };
const SPORT_CHOICES: (Sport | 'all')[] = ['all', 'running', 'cycling', 'swimming', 'walking', 'hiking', 'strength'];

function fmtValue(v: number, metric: GoalMetric): string {
  if (metric === 'count') return String(Math.round(v));
  if (metric === 'elevation') return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

export default function GoalsTab({ activities, today }: { activities: ActivitySummary[]; today: string }) {
  const { t } = useLang();
  const { goals, add, remove } = useGoals();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Omit<Goal, 'id'>>({ sport: 'running', metric: 'distance', period: 'week', target: 30 });

  const unit = (m: GoalMetric) => t(`training.units.${METRIC_UNIT[m]}`);
  const select = 'bg-bg border border-border rounded-lg px-2 py-2 text-xs text-primary w-full';

  return (
    <div className="flex flex-col gap-3">
      {goals.length === 0 && !editing && (
        <div className="card text-center py-8">
          <Target size={22} className="mx-auto text-secondary mb-2" />
          <p className="text-sm text-secondary">{t('training.goals.empty')}</p>
        </div>
      )}

      {goals.map(g => {
        const p = goalProgress(g, activities, today);
        const done = p.current >= p.target;
        const color = done || p.onPace ? '#4ade80' : '#facc15';
        const sportColor = g.sport === 'all' ? '#a3a3a3' : SPORT_META[g.sport].color;
        return (
          <div key={g.id} className="card">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full" style={{ background: sportColor }} />
              <span className="text-sm font-semibold text-primary">
                {t(`training.sports.${g.sport}`)} · {t(`training.goals.metric.${g.metric}`)}
              </span>
              <span className="text-[11px] text-secondary">{t(`training.goals.period.${g.period}`)}</span>
              <button onClick={() => remove(g.id)} className="ml-auto p-1 text-muted hover:text-recovery-red" title={t('training.goals.delete')}>
                <Trash2 size={13} />
              </button>
            </div>
            <div className="flex items-baseline gap-1 mb-2">
              <span className="text-2xl font-bold text-primary">{fmtValue(p.current, g.metric)}</span>
              <span className="text-xs text-secondary">/ {fmtValue(p.target, g.metric)} {unit(g.metric)}</span>
              <span className="ml-auto text-xs font-semibold text-primary">{p.pct}%</span>
            </div>
            {/* progress bar with a tick at "where you should be by today" */}
            <div className="relative h-2 rounded-full bg-bg border border-border overflow-hidden">
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, p.pct)}%`, background: color }} />
              <div className="absolute inset-y-0 w-0.5 bg-primary/60" style={{ left: `${p.elapsedPct}%` }} />
            </div>
            <p className="text-[11px] mt-2 flex items-center gap-1" style={{ color }}>
              {done
                ? <><CheckCircle2 size={12} /> {t('training.goals.done')}</>
                : p.onPace
                  ? t('training.goals.onPace', { projected: `${fmtValue(p.projected, g.metric)} ${unit(g.metric)}` })
                  : t('training.goals.behind', {
                      projected: `${fmtValue(p.projected, g.metric)} ${unit(g.metric)}`,
                      perDay: `${fmtValue(p.perDayNeeded, g.metric)} ${unit(g.metric)}`,
                    })}
            </p>
            <p className="text-[10px] text-muted mt-0.5">{t('training.goals.daysLeft', { n: p.daysLeft })}</p>
          </div>
        );
      })}

      {editing ? (
        <div className="card flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <select className={select} value={draft.sport} onChange={e => setDraft({ ...draft, sport: e.target.value as Sport | 'all' })}>
              {SPORT_CHOICES.map(s => <option key={s} value={s}>{t(`training.sports.${s}`)}</option>)}
            </select>
            <select className={select} value={draft.metric} onChange={e => setDraft({ ...draft, metric: e.target.value as GoalMetric })}>
              {(['distance', 'time', 'elevation', 'count'] as GoalMetric[]).map(m => <option key={m} value={m}>{t(`training.goals.metric.${m}`)}</option>)}
            </select>
            <select className={select} value={draft.period} onChange={e => setDraft({ ...draft, period: e.target.value as GoalPeriod })}>
              {(['week', 'month', 'year'] as GoalPeriod[]).map(p => <option key={p} value={p}>{t(`training.goals.periodShort.${p}`)}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-secondary">
            {t('training.goals.target')}
            <input type="number" min={1} step="any" value={draft.target}
              onChange={e => setDraft({ ...draft, target: Number(e.target.value) })}
              className="flex-1 bg-bg border border-border rounded-lg px-2 py-2 text-sm text-primary" />
            {unit(draft.metric)}
          </label>
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="flex-1 py-2 rounded-lg text-xs font-semibold text-secondary border border-border">
              {t('training.goals.cancel')}
            </button>
            <button
              disabled={!(draft.target > 0)}
              onClick={() => { add(draft); setEditing(false); }}
              className="flex-1 py-2 rounded-lg text-xs font-bold bg-strain/15 text-strain border border-strain/30 disabled:opacity-40">
              {t('training.goals.save')}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(true)}
          className="py-2.5 rounded-xl text-xs font-semibold text-strain border border-strain/30 bg-strain/10 flex items-center justify-center gap-1.5">
          <Plus size={14} /> {t('training.goals.add')}
        </button>
      )}
    </div>
  );
}
