'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { ArrowLeft, Sparkles, Loader2, AlertCircle, Trophy, RefreshCw } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { SPORT_META, SERIES, StatTile, speedLabel, tooltipStyle, useDateFormat } from '@/components/training/shared';
import { useActivities, useBestEfforts, useHRMax, useVdot } from '@/lib/training/hooks';
import { activityEffort } from '@/lib/training/effort';
import { prRank } from '@/lib/training/bestEfforts';
import { EFFORT_LABELS, formatDuration, formatKm, formatPace } from '@/lib/training/format';
import type { ActivityAnalysis, ActivitySummary, StoredEffort } from '@/lib/training/types';
import { useLang, detectLocale } from '@/lib/i18n';

// Zone colours match the profile's training-zones card; zone numbers are always labelled
const ZONE_COLORS = ['#818cf8', '#38bdf8', '#4ade80', '#fb923c', '#f87171'];
const HR_COLOR = '#e66767';

interface ActivityResponse { summary: ActivitySummary; analysis: ActivityAnalysis | null; isDemo: boolean }
interface Insight { headline: string; body: string; generatedAt: string }

const INSIGHT_KEY = 'activity_insights_v1';
function readInsights(): Record<string, Insight> {
  try { return JSON.parse(localStorage.getItem(INSIGHT_KEY) ?? '{}'); } catch { return {}; }
}
function saveInsight(key: string, v: Insight) {
  try {
    const all = readInsights();
    all[key] = v;
    const keys = Object.keys(all);
    if (keys.length > 200) delete all[keys[0]]; // keep storage bounded
    localStorage.setItem(INSIGHT_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

function ZoneBars({ title, seconds, labels }: { title: string; seconds: number[]; labels: string[] }) {
  const total = seconds.reduce((s, v) => s + v, 0) || 1;
  return (
    <div className="card">
      <div className="card-header"><span>{title}</span></div>
      <div className="flex flex-col gap-1.5">
        {seconds.map((sec, i) => (
          <div key={i} className="flex items-center gap-2" title={formatDuration(sec)}>
            <span className="w-20 text-[11px] text-secondary truncate">{labels[i]}</span>
            <div className="flex-1 h-3 rounded bg-bg overflow-hidden">
              <div className="h-full rounded-r" style={{ width: `${(sec / total) * 100}%`, background: ZONE_COLORS[i] }} />
            </div>
            <span className="w-10 text-right text-[11px] text-primary tabular-nums">{Math.round((sec / total) * 100)}%</span>
            <span className="w-12 text-right text-[10px] text-muted tabular-nums">{formatDuration(sec)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ActivityPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useLang();
  const fmt = useDateFormat();
  const { activities, today, loading: historyLoading } = useActivities();
  const hrMax = useHRMax(activities);
  const efforts = useBestEfforts(activities, today);
  const vdot = useVdot(activities, efforts.all, today);

  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState('');
  const [insight, setInsight] = useState<Insight | null>(null);
  const [insightState, setInsightState] = useState<'idle' | 'loading' | 'error' | 'no_key'>('idle');
  const [insightError, setInsightError] = useState('');

  // Activity + analysis (waits for history so HRmax / VDOT match the rest of the app)
  useEffect(() => {
    if (historyLoading || data) return;
    const q = new URLSearchParams({ today, hrMax: String(hrMax), ...(vdot.vdot ? { vdot: String(vdot.vdot) } : {}) });
    fetch(`/api/activities/${encodeURIComponent(id)}?${q}`)
      .then(async r => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`))))
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Error'));
  }, [id, historyLoading, today, hrMax, vdot.vdot, data]);

  const summary = data?.summary;
  const analysis = data?.analysis ?? null;

  // PR ranks of this activity's efforts against everything stored (incl. this one)
  const prs = useMemo(() => {
    if (!summary || !analysis?.bestEfforts.length) return [];
    const mine: StoredEffort[] = analysis.bestEfforts.map(e => ({ ...e, activityId: summary.id, date: summary.date }));
    const all = [...efforts.all.filter(e => e.activityId !== summary.id), ...mine];
    // Ranks only mean something once every run has been checked
    return mine.map(e => ({ ...e, rank: efforts.done ? prRank(e, all) : null }));
  }, [summary, analysis, efforts.all, efforts.done]);

  const insightKey = `${id}|${locale}`;
  const generateInsight = async (force = false) => {
    if (!summary) return;
    if (!force) {
      const cached = readInsights()[insightKey];
      if (cached) { setInsight(cached); return; }
    }
    setInsightState('loading');
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(id)}/insight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          today, lang: detectLocale(), hrMax, vdot: vdot.vdot,
          prs: prs.filter(p => p.rank).map(p => ({ distM: p.distM, timeSec: p.timeSec, rank: p.rank })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 503) { setInsightState('no_key'); return; }
      if (!res.ok) { setInsightError(body.error ?? `HTTP ${res.status}`); setInsightState('error'); return; }
      setInsight(body as Insight);
      saveInsight(insightKey, body as Insight);
      setInsightState('idle');
    } catch (e) {
      setInsightError(e instanceof Error ? e.message : 'Error');
      setInsightState('error');
    }
  };

  // Auto-generate once the analysis (and best-effort ranks) are ready
  useEffect(() => {
    if (summary && insightState === 'idle' && !insight) generateInsight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, insightKey]);

  const meta = summary ? SPORT_META[summary.sport] : null;
  const isRun = summary?.sport === 'running';
  const isRide = summary?.sport === 'cycling';
  const effort = summary ? activityEffort(summary, hrMax).effort : null;
  const chart = analysis?.chart ?? [];
  const hasHR = chart.some(p => p.hr);
  const hasEle = chart.some(p => p.ele !== null);
  const rideChart = isRide ? chart.map(p => ({ ...p, speed: p.pace ? Math.round((3600 / p.pace) * 10) / 10 : null })) : chart;

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 bg-bg/95 backdrop-blur border-b border-border">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/training" className="p-1.5 rounded-lg hover:bg-surface text-secondary hover:text-primary transition-colors">
            <ArrowLeft size={18} />
          </Link>
          {meta && <meta.Icon size={16} style={{ color: meta.color }} />}
          <h1 className="text-sm font-bold text-primary truncate">{summary?.name ?? t('activity.title')}</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-4">
        {error && (
          <div className="card border-dashed flex items-start gap-3">
            <AlertCircle size={18} className="text-recovery-red flex-shrink-0 mt-0.5" />
            <p className="text-sm text-primary">{error}</p>
          </div>
        )}
        {!data && !error && (
          <div className="card flex flex-col items-center gap-3 py-10">
            <Loader2 size={22} className="text-strain animate-spin" />
            <p className="text-sm text-secondary">{t('activity.loading')}</p>
          </div>
        )}

        {summary && (
          <>
            <p className="text-[11px] text-secondary -mb-2 px-1">
              {fmt(summary.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {summary.startTimeLocal.slice(11, 16)}
            </p>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              {summary.distanceM > 0 && <StatTile label={t('activity.distance')} value={`${formatKm(summary.distanceM)} km`} />}
              <StatTile label={t('activity.time')} value={formatDuration(summary.durationSec)} />
              {summary.distanceM > 0 && <StatTile label={isRide ? t('activity.speed') : t('activity.pace')} value={speedLabel(summary).replace(' /km', '')} />}
              {isRun && analysis?.gapSecPerKm && <StatTile label={t('activity.gap')} value={formatPace(analysis.gapSecPerKm)} />}
              {summary.elevationGainM > 0 && <StatTile label={t('activity.elevation')} value={`${summary.elevationGainM} m`} />}
              {summary.avgHR > 0 && <StatTile label={t('activity.avgHR')} value={`${summary.avgHR}`} sub={`max ${summary.maxHR}`} />}
              {effort !== null && <StatTile label={t('training.effort')} value={String(effort)} color="#fb923c" />}
              {summary.trainingLoad && <StatTile label={t('activity.load')} value={String(summary.trainingLoad)} />}
              {summary.calories > 0 && <StatTile label="kcal" value={String(summary.calories)} />}
            </div>

            {/* AI insight */}
            {insightState !== 'no_key' && (
              <div className="card">
                <div className="card-header">
                  <Sparkles size={14} className="text-purple-400" />
                  <span className="text-purple-400">{t('activity.insight')}</span>
                  {insight && (
                    <button onClick={() => generateInsight(true)} className="ml-auto p-1 text-muted hover:text-secondary" title={t('activity.regenerate')}>
                      <RefreshCw size={12} />
                    </button>
                  )}
                </div>
                {insightState === 'loading' && (
                  <p className="text-xs text-secondary flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> {t('activity.insightLoading')}</p>
                )}
                {insightState === 'error' && (
                  <p className="text-xs text-muted">
                    {insightError}{' '}
                    <button onClick={() => generateInsight(true)} className="text-purple-400 underline">{t('common.retry')}</button>
                  </p>
                )}
                {insight && insightState !== 'loading' && (
                  <>
                    <p className="text-sm font-bold text-primary">{insight.headline}</p>
                    <p className="text-xs text-secondary mt-1 leading-relaxed">{insight.body}</p>
                  </>
                )}
              </div>
            )}

            {/* Best efforts in this activity */}
            {prs.length > 0 && (
              <div className="card">
                <div className="card-header">
                  <Trophy size={14} /><span>{t('activity.bestEfforts')}</span>
                  {!efforts.done && (
                    <span className="ml-auto normal-case tracking-normal text-[10px] text-muted">
                      {t('activity.ranksPending', { done: efforts.processed, total: efforts.total })}
                    </span>
                  )}
                </div>
                {prs.map(e => (
                  <div key={e.distM} className="flex items-center py-1.5 border-b border-border last:border-0">
                    <span className="text-sm text-secondary flex-1">{EFFORT_LABELS[e.distM]}</span>
                    {e.rank && (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mr-3 ${
                        e.rank === 1 ? 'bg-yellow-400/15 text-yellow-400' : 'bg-white/5 text-secondary'}`}>
                        {e.rank === 1 ? 'PR' : t(`activity.rank${e.rank}`)}
                      </span>
                    )}
                    <span className="text-sm font-bold text-primary tabular-nums">{formatDuration(e.timeSec)}</span>
                    <span className="w-16 text-right text-[10px] text-muted tabular-nums">{formatPace((e.timeSec / e.distM) * 1000)} /km</span>
                  </div>
                ))}
              </div>
            )}

            {/* Pace / speed chart */}
            {chart.length > 0 && summary.distanceM > 0 && (
              <div className="card">
                <div className="card-header"><span>{isRide ? t('activity.speed') : t('activity.pace')}</span></div>
                {isRun && (
                  <div className="flex gap-4 text-[10px] text-secondary mb-1">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: SERIES.c }} />{t('activity.pace')}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: SERIES.a }} />{t('activity.gap')}</span>
                  </div>
                )}
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rideChart} margin={{ top: 4, right: 6, bottom: 0, left: -12 }}>
                      <CartesianGrid stroke="#1f1f1f" vertical={false} />
                      <XAxis dataKey="km" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: '#737373', fontSize: 9 }}
                        tickLine={false} axisLine={false} tickFormatter={v => `${Math.round(v)}`} unit=" km" />
                      {isRide ? (
                        <YAxis domain={[(min: number) => Math.max(0, Math.floor(min - 3)), (max: number) => Math.ceil(max + 3)]} tick={{ fill: '#737373', fontSize: 9 }} tickLine={false} axisLine={false} width={44} />
                      ) : (
                        <YAxis reversed domain={['dataMin - 15', 'dataMax + 15']} tick={{ fill: '#737373', fontSize: 9 }}
                          tickLine={false} axisLine={false} width={44} tickFormatter={v => formatPace(v)} />
                      )}
                      <Tooltip {...tooltipStyle} labelFormatter={v => `${v} km`}
                        formatter={(v: number, k: string) => (k === 'speed' ? [`${v} km/h`, t('activity.speed')] : [`${formatPace(v)} /km`, k === 'gap' ? t('activity.gap') : t('activity.pace')])} />
                      {isRide
                        ? <Line dataKey="speed" stroke={SERIES.a} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                        : <Line dataKey="pace" stroke={SERIES.c} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                      {isRun && <Line dataKey="gap" stroke={SERIES.a} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Heart rate */}
            {hasHR && (
              <div className="card">
                <div className="card-header">
                  <span>{t('activity.heartRate')}</span>
                  {analysis?.hrDriftPct != null && (
                    <span className={`ml-auto normal-case tracking-normal text-[10px] ${analysis.hrDriftPct > 5 ? 'text-recovery-yellow' : 'text-secondary'}`}>
                      {t('activity.drift', { pct: analysis.hrDriftPct })}
                    </span>
                  )}
                </div>
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chart} margin={{ top: 4, right: 6, bottom: 0, left: -12 }}>
                      <CartesianGrid stroke="#1f1f1f" vertical={false} />
                      <XAxis dataKey="km" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: '#737373', fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `${Math.round(v)}`} unit=" km" />
                      <YAxis domain={['dataMin - 5', 'dataMax + 5']} tick={{ fill: '#737373', fontSize: 9 }} tickLine={false} axisLine={false} width={44} />
                      <Tooltip {...tooltipStyle} labelFormatter={v => `${v} km`} formatter={(v: number) => [`${v} bpm`, t('activity.heartRate')]} />
                      <Line dataKey="hr" stroke={HR_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Elevation */}
            {hasEle && summary.elevationGainM > 0 && (
              <div className="card">
                <div className="card-header"><span>{t('activity.elevation')}</span></div>
                <div className="h-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chart} margin={{ top: 4, right: 6, bottom: 0, left: -12 }}>
                      <XAxis dataKey="km" type="number" domain={['dataMin', 'dataMax']} hide />
                      <YAxis domain={['dataMin - 5', 'dataMax + 5']} tick={{ fill: '#737373', fontSize: 9 }} tickLine={false} axisLine={false} width={44} />
                      <Tooltip {...tooltipStyle} labelFormatter={v => `${v} km`} formatter={(v: number) => [`${v} m`, t('activity.elevation')]} />
                      <Area dataKey="ele" stroke="#8a8a8a" fill="#8a8a8a" fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Splits */}
            {analysis && analysis.splits.length > 1 && (
              <div className="card">
                <div className="card-header"><span>{t('activity.splits')}</span></div>
                <table className="w-full text-[11px] tabular-nums">
                  <thead>
                    <tr className="text-muted text-[10px] uppercase tracking-wider">
                      <th className="text-left font-normal pb-1">{isRide ? 'km' : 'km'}</th>
                      <th className="text-right font-normal pb-1">{isRide ? t('activity.speed') : t('activity.pace')}</th>
                      {isRun && <th className="text-right font-normal pb-1">{t('activity.gap')}</th>}
                      <th className="text-right font-normal pb-1">HR</th>
                      <th className="text-right font-normal pb-1">{t('activity.elevShort')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const fastest = Math.min(...analysis.splits.map(s => s.paceSecPerKm));
                      const slowest = Math.max(...analysis.splits.map(s => s.paceSecPerKm));
                      let cumulative = 0;
                      return analysis.splits.map(s => {
                        cumulative += s.distM;
                        const w = slowest > fastest ? 30 + 70 * ((slowest - s.paceSecPerKm) / (slowest - fastest)) : 100;
                        return (
                          <tr key={s.index} className="border-t border-border">
                            <td className="py-1 text-secondary">{formatKm(cumulative)}</td>
                            <td className="py-1 text-right">
                              <span className="inline-flex items-center gap-2 justify-end w-full">
                                <span className="h-1.5 rounded-full hidden sm:block" style={{ width: `${w * 0.5}px`, background: isRide ? SERIES.a : SERIES.c, opacity: 0.6 }} />
                                <span className="text-primary">{isRide ? `${Math.round((3600 / s.paceSecPerKm) * 10) / 10}` : formatPace(s.paceSecPerKm)}</span>
                              </span>
                            </td>
                            {isRun && <td className="py-1 text-right text-secondary">{formatPace(s.gapSecPerKm)}</td>}
                            <td className="py-1 text-right text-secondary">{s.avgHR || '—'}</td>
                            <td className="py-1 text-right text-secondary">{s.elevGainM - s.elevLossM > 0 ? '+' : ''}{s.elevGainM - s.elevLossM}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}

            {analysis?.hrZoneSec && (
              <ZoneBars title={t('activity.hrZones')} seconds={analysis.hrZoneSec} labels={[1, 2, 3, 4, 5].map(z => `Z${z} ${t(`activity.hrZoneNames.z${z}`)}`)} />
            )}
            {analysis?.paceZoneSec && (
              <ZoneBars title={t('activity.paceZones')} seconds={analysis.paceZoneSec}
                labels={['easy', 'marathon', 'threshold', 'interval', 'repetition'].map(k => t(`training.records.paceNames.${k}`))} />
            )}

            {!analysis && <p className="text-[11px] text-muted px-1">{t('activity.noStreams')}</p>}
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
