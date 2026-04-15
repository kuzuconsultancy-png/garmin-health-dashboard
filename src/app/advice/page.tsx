'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Sparkles, RefreshCw, AlertCircle, AlertTriangle,
  Loader2, ShieldCheck, ShieldAlert, Shield,
} from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import type { AdviceResponse } from '@/lib/types';

// ── LocalStorage cache key (keeps last good advice between visits) ──────────
const CACHE_KEY = 'training_ai_advice_v1';

interface CachedAdvice {
  advice: AdviceResponse;
  generatedAt: string;
  isDemo: boolean;
  activityCount: number;
}

function loadCached(): CachedAdvice | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) as CachedAdvice : null;
  } catch { return null; }
}

function saveCache(c: CachedAdvice): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

type Status = 'idle' | 'loading' | 'done' | 'error' | 'no_key';

export default function AdvicePage() {
  const [cached, setCached]     = useState<CachedAdvice | null>(null);
  const [status, setStatus]     = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Hydrate cached result on mount; otherwise fetch fresh
  useEffect(() => {
    const c = loadCached();
    if (c) {
      setCached(c);
      setStatus('done');
    } else {
      fetchAdvice();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAdvice = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/advice', { method: 'GET' });
      if (res.status === 503) {
        setStatus('no_key');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error || `HTTP ${res.status}`);
        setStatus('error');
        return;
      }
      const data = await res.json() as CachedAdvice;
      setCached(data);
      saveCache(data);
      setStatus('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Network error');
      setStatus('error');
    }
  }, []);

  const advice = cached?.advice ?? null;
  const conf   = advice?.confidence;

  // Confidence → color + icon mapping
  const confMeta = {
    high:   { label: 'High confidence',   color: '#4ade80', Icon: ShieldCheck },
    medium: { label: 'Medium confidence', color: '#facc15', Icon: Shield       },
    low:    { label: 'Low confidence',    color: '#f87171', Icon: ShieldAlert  },
  } as const;

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
          <h1 className="text-sm font-bold text-primary">Training Advice</h1>
          <button
            onClick={fetchAdvice}
            disabled={status === 'loading'}
            className="ml-auto p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-surface transition-colors disabled:opacity-40"
            title="Refresh advice"
          >
            <RefreshCw size={15} className={status === 'loading' ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-4">
        {/* No API key */}
        {status === 'no_key' && (
          <div className="card border-dashed">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-primary">
                  Anthropic API key not configured
                </p>
                <p className="text-xs text-secondary mt-1">
                  Add <code className="text-primary">ANTHROPIC_API_KEY</code> to your
                  <code className="text-primary"> .env.local</code> file and restart the app.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {status === 'loading' && !advice && (
          <div className="card flex flex-col items-center gap-3 py-10">
            <Loader2 size={22} className="text-purple-400 animate-spin" />
            <p className="text-sm text-secondary">Analyzing your last 14 days…</p>
            <p className="text-[10px] text-muted">This may take 10-20 seconds</p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && !advice && (
          <div className="card border-dashed">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="text-recovery-red flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-primary">
                  Advice unavailable, try refreshing
                </p>
                {errorMsg && (
                  <p className="text-xs text-muted mt-1">{errorMsg}</p>
                )}
                <button
                  onClick={fetchAdvice}
                  className="mt-3 text-xs font-semibold text-purple-400 hover:text-purple-300 transition-colors underline"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main content */}
        {advice && (
          <>
            {/* Demo banner */}
            {cached?.isDemo && (
              <div className="card border-yellow-400/20 bg-yellow-400/5">
                <p className="text-[11px] text-yellow-400">
                  Demo data — advice is based on a simulated 14-day training pattern.
                  Add Garmin credentials to <code>.env.local</code> for real advice.
                </p>
              </div>
            )}

            {/* Summary */}
            <div className="card">
              <div className="card-header mb-3 flex items-center">
                <Sparkles size={14} className="text-purple-400" />
                <span className="text-purple-400">Summary</span>
                {conf && (
                  <span
                    className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      color: confMeta[conf].color,
                      backgroundColor: `${confMeta[conf].color}18`,
                    }}
                  >
                    {(() => {
                      const C = confMeta[conf].Icon;
                      return <C size={10} />;
                    })()}
                    {confMeta[conf].label}
                  </span>
                )}
              </div>
              <p className="text-sm text-secondary leading-relaxed whitespace-pre-line">
                {advice.summary}
              </p>
            </div>

            {/* Warnings */}
            {advice.warnings.length > 0 && (
              <div className="card border-yellow-400/30 bg-yellow-400/5">
                <div className="card-header mb-3">
                  <AlertTriangle size={14} className="text-yellow-400" />
                  <span className="text-yellow-400">
                    {advice.warnings.length === 1 ? 'Warning' : 'Warnings'}
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
            <div className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold text-secondary uppercase tracking-widest px-1">
                Next 3 days
              </h2>
              {advice.next3days.map((d, i) => (
                <div key={i} className="card">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-400/10 border border-purple-400/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-purple-400">
                        {i + 1}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-primary">{d.day}</p>
                      <p className="text-xs text-secondary mt-1 leading-relaxed whitespace-pre-line">
                        {d.advice}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Meta footer */}
            {cached && (
              <div className="flex justify-between items-center text-[10px] text-muted pt-2">
                <span>
                  Based on {cached.activityCount} activit{cached.activityCount === 1 ? 'y' : 'ies'}
                </span>
                <span>
                  Updated {formatTimestamp(cached.generatedAt)}
                </span>
              </div>
            )}

            {/* Refresh button (bottom) */}
            <button
              onClick={fetchAdvice}
              disabled={status === 'loading'}
              className="mt-2 py-3 rounded-xl text-sm font-bold bg-purple-400/10 text-purple-400 border border-purple-400/20 hover:bg-purple-400/20 flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
            >
              {status === 'loading' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {status === 'loading' ? 'Generating…' : 'Generate fresh advice'}
            </button>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
