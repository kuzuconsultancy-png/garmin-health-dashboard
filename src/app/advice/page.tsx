'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import {
  ArrowLeft, Sparkles, RefreshCw, AlertCircle, AlertTriangle,
  Loader2, ShieldCheck, ShieldAlert, Shield, Activity, Heart, Moon, Flame, UserRound,
} from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import { useLang, detectLocale, type Locale } from '@/lib/i18n';
import { useProfile } from '@/lib/useProfile';
import type { AdvicePayload, AdviceFocus, CoachFlag, CoachFlagId, CoachMetrics } from '@/lib/types';

// ── LocalStorage cache (last good advice; regenerated on a new day or language) ──
const CACHE_KEY = 'training_ai_advice_v2';

type CachedAdvice = AdvicePayload & { lang: Locale };

function loadCached(): CachedAdvice | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as CachedAdvice : null;
  } catch { return null; }
}

function saveCache(c: CachedAdvice): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

const localToday = () => format(new Date(), 'yyyy-MM-dd');

const SEVERITY_COLOR: Record<CoachFlag['severity'], string> = {
  alert: '#f87171',
  warning: '#facc15',
  positive: '#4ade80',
};

const FOCUS_COLOR: Record<AdviceFocus, string> = {
  rest: '#94a3b8',
  recovery: '#38bdf8',
  easy: '#4ade80',
  moderate: '#facc15',
  hard: '#f87171',
  long: '#c084fc',
};

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

type Status = 'idle' | 'loading' | 'done' | 'error' | 'no_key';

// ── Readiness tiles: deterministic numbers, shown independently of the LLM text ──
function ReadinessCard({ metrics }: { metrics: CoachMetrics }) {
  const { t } = useLang();
  const { recovery: r, load: l, flags } = metrics;

  const colorFor = (ids: CoachFlagId[]) => {
    const f = flags.find(x => ids.includes(x.id));
    return f ? SEVERITY_COLOR[f.severity] : undefined;
  };

  const tiles = [
    {
      Icon: Activity, label: t('advice.hrv'),
      value: r.hrvLastNight ? `${r.hrvLastNight} ms` : '—',
      sub: r.hrvDeltaPct !== null ? `${signed(r.hrvDeltaPct)}% ${t('advice.vsBaseline')}` : '',
      color: colorFor(['hrv_suppressed', 'well_recovered']),
    },
    {
      Icon: Heart, label: t('advice.rhr'),
      value: r.rhrToday ? `${r.rhrToday} bpm` : '—',
      sub: r.rhrDelta !== null ? `${signed(r.rhrDelta)} bpm ${t('advice.vsBaseline')}` : '',
      color: colorFor(['rhr_elevated']),
    },
    {
      Icon: Moon, label: t('advice.sleep'),
      value: r.sleepLastNight ? `${r.sleepLastNight} h` : '—',
      sub: r.sleepDebt7d > 0 ? t('advice.debt7d', { debt: r.sleepDebt7d }) : '',
      color: colorFor(['short_sleep', 'sleep_debt']),
    },
    {
      Icon: Flame, label: t('advice.load'),
      value: `${l.last7}${l.unit === 'minutes' ? ` ${t('advice.minutesUnit')}` : ''}`,
      sub: l.rampPct !== null ? `${signed(l.rampPct)}% ${t('advice.vsPrevWeek')}` : '',
      color: colorFor(['load_spike', 'no_rest']),
    },
  ];

  return (
    <div className="card">
      <div className="card-header mb-3">
        <Activity size={14} className="text-secondary" />
        <span>{t('advice.readiness')}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(({ Icon, label, value, sub, color }) => (
          <div key={label} className="rounded-xl bg-bg border border-border px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] text-muted uppercase tracking-widest">
              <Icon size={11} /> {label}
            </div>
            <p
              className={`text-base font-bold mt-0.5 ${color ? '' : 'text-primary'}`}
              style={color ? { color } : undefined}
            >
              {value}
            </p>
            {sub && <p className="text-[10px] text-secondary">{sub}</p>}
          </div>
        ))}
      </div>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {flags.map(f => (
            <span
              key={f.id}
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ color: SEVERITY_COLOR[f.severity], backgroundColor: `${SEVERITY_COLOR[f.severity]}18` }}
            >
              {t(`advice.flags.${f.id}`, { value: f.value })}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdvicePage() {
  const { t, locale } = useLang();
  const { profile, loaded: profileLoaded } = useProfile();
  const [cached, setCached]     = useState<CachedAdvice | null>(null);
  const [status, setStatus]     = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const fetchAdvice = useCallback(async (refresh: boolean) => {
    const lang = detectLocale();
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ today: localToday(), lang, profile, refresh }),
      });
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error ?? '');
        setStatus('no_key');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error || `HTTP ${res.status}`);
        setStatus('error');
        return;
      }
      const data = { ...(await res.json() as AdvicePayload), lang };
      setCached(data);
      saveCache(data);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Network error');
      setStatus('error');
    }
  }, [profile]);

  // Show cached advice only if it's for today and in the current language
  useEffect(() => {
    if (!profileLoaded) return;
    const c = loadCached();
    if (c?.metrics?.today === localToday() && c.lang === detectLocale()) {
      setCached(c);
      setStatus('done');
    } else {
      if (c?.metrics) setCached(c); // keep showing the old plan while the new one loads
      fetchAdvice(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoaded]);

  // Language toggled while on the page → regenerate in the new language
  useEffect(() => {
    if (status === 'done' && cached && cached.lang !== locale) fetchAdvice(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const advice  = cached?.advice ?? null;
  const metrics = cached?.metrics ?? null;
  const conf    = advice?.confidence;
  const dateLocale = locale === 'es' ? 'es-ES' : 'en-GB';

  const confMeta = {
    high:   { color: '#4ade80', Icon: ShieldCheck },
    medium: { color: '#facc15', Icon: Shield      },
    low:    { color: '#f87171', Icon: ShieldAlert },
  } as const;

  const formatDay = (iso: string) =>
    parseISO(iso).toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-bg/95 backdrop-blur border-b border-border">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-lg hover:bg-surface text-secondary hover:text-primary transition-colors"
          >
            <ArrowLeft size={18} />
          </Link>
          <Sparkles size={16} className="text-purple-400" />
          <h1 className="text-sm font-bold text-primary">{t('advice.title')}</h1>
          <button
            onClick={() => fetchAdvice(true)}
            disabled={status === 'loading'}
            className="ml-auto p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface transition-colors disabled:opacity-40"
            title={t('advice.refresh')}
          >
            <RefreshCw size={15} className={status === 'loading' ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-4">
        {/* No / rejected API key */}
        {status === 'no_key' && (
          <div className="card border-dashed">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-primary">{t('advice.noKeyTitle')}</p>
                <p className="text-xs text-secondary mt-1">{t('advice.noKeyBody')}</p>
                {errorMsg && <p className="text-[10px] text-muted mt-1">{errorMsg}</p>}
              </div>
            </div>
          </div>
        )}

        {/* Loading (first time) */}
        {status === 'loading' && !advice && (
          <div className="card flex flex-col items-center gap-3 py-10">
            <Loader2 size={22} className="text-purple-400 animate-spin" />
            <p className="text-sm text-secondary">{t('advice.loading')}</p>
            <p className="text-[10px] text-muted">{t('advice.loadingHint')}</p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="card border-dashed">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="text-recovery-red flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-primary">{t('advice.errorTitle')}</p>
                {errorMsg && <p className="text-xs text-muted mt-1">{errorMsg}</p>}
                <button
                  onClick={() => fetchAdvice(true)}
                  className="mt-3 text-xs font-semibold text-purple-400 hover:text-purple-300 transition-colors underline"
                >
                  {t('common.retry')}
                </button>
              </div>
            </div>
          </div>
        )}

        {advice && metrics && (
          <>
            {cached?.isDemo && (
              <div className="card border-yellow-400/20 bg-yellow-400/5">
                <p className="text-[11px] text-yellow-400">{t('advice.demo')}</p>
              </div>
            )}

            {profileLoaded && !profile?.setupCompleted && (
              <div className="card flex items-center gap-3">
                <UserRound size={16} className="text-secondary flex-shrink-0" />
                <p className="text-[11px] text-secondary flex-1">{t('advice.noProfile')}</p>
                <Link href="/profile" className="text-[11px] font-semibold text-purple-400 whitespace-nowrap">
                  {t('advice.setProfile')}
                </Link>
              </div>
            )}

            <ReadinessCard metrics={metrics} />

            {/* Summary */}
            <div className={`card ${status === 'loading' ? 'opacity-60' : ''}`}>
              <div className="card-header mb-3 flex items-center">
                <Sparkles size={14} className="text-purple-400" />
                <span className="text-purple-400">{t('advice.summary')}</span>
                {conf && (
                  <span
                    className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{ color: confMeta[conf].color, backgroundColor: `${confMeta[conf].color}18` }}
                    title={t('advice.confidenceHint', { days: metrics.coverage.recoveryDays, window: metrics.coverage.windowDays })}
                  >
                    {(() => { const C = confMeta[conf].Icon; return <C size={10} />; })()}
                    {t(`advice.confidence.${conf}`)}
                  </span>
                )}
              </div>
              <p className="text-sm text-secondary leading-relaxed whitespace-pre-line">{advice.summary}</p>
              <p className="text-[10px] text-muted mt-2">
                {t('advice.confidenceHint', { days: metrics.coverage.recoveryDays, window: metrics.coverage.windowDays })}
              </p>
            </div>

            {/* Warnings */}
            {advice.warnings.length > 0 && (
              <div className="card border-yellow-400/30 bg-yellow-400/5">
                <div className="card-header mb-3">
                  <AlertTriangle size={14} className="text-yellow-400" />
                  <span className="text-yellow-400">
                    {advice.warnings.length === 1 ? t('advice.warning') : t('advice.warnings')}
                  </span>
                </div>
                <ul className="flex flex-col gap-2">
                  {advice.warnings.map((w, i) => (
                    <li key={i} className="text-xs text-secondary leading-relaxed flex gap-2">
                      <span className="text-yellow-400 mt-0.5">•</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Next 3 days */}
            <div className={`flex flex-col gap-3 ${status === 'loading' ? 'opacity-60' : ''}`}>
              <h2 className="text-xs font-semibold text-secondary uppercase tracking-widest px-1">
                {t('advice.next3')}
              </h2>
              {advice.next3days.map(d => (
                <div key={d.date} className="card">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-primary capitalize">{formatDay(d.date)}</p>
                    <span
                      className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ color: FOCUS_COLOR[d.focus], backgroundColor: `${FOCUS_COLOR[d.focus]}18` }}
                    >
                      {t(`advice.focus.${d.focus}`)}
                    </span>
                  </div>
                  <p className="text-sm text-primary mt-2 leading-relaxed">{d.session}</p>
                  <p className="text-xs text-secondary mt-1 leading-relaxed">{d.why}</p>
                </div>
              ))}
            </div>

            {/* Meta footer */}
            <div className="flex justify-between items-center text-[10px] text-muted pt-2">
              <span>{t('advice.basedOn', { count: cached!.activityCount })}</span>
              <span>
                {t('advice.updated', {
                  time: new Date(cached!.generatedAt).toLocaleString(dateLocale, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  }),
                })}
              </span>
            </div>

            <button
              onClick={() => fetchAdvice(true)}
              disabled={status === 'loading'}
              className="mt-2 py-3 rounded-xl text-sm font-bold bg-purple-400/10 text-purple-400 border border-purple-400/20 hover:bg-purple-400/20 flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              {status === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {status === 'loading' ? t('advice.generating') : t('advice.generate')}
            </button>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
