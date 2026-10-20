'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, subDays } from 'date-fns';
import type { ActivitySummary, BestEffort, Goal, StoredEffort } from './types';
import { estimateHRMax } from './effort';
import { bestVdotEffort } from './predictions';
import { useProfile } from '../useProfile';

export const localToday = () => format(new Date(), 'yyyy-MM-dd');

// ── Activity history (one request per page load, shared by all components) ──

interface HistoryResponse { activities: ActivitySummary[]; isDemo: boolean; since: string; today: string }
let historyPromise: Promise<HistoryResponse> | null = null;
let historyDay = '';

function loadHistory(): Promise<HistoryResponse> {
  const today = localToday();
  if (!historyPromise || historyDay !== today) {
    historyDay = today;
    historyPromise = fetch(`/api/activities?today=${today}`).then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`);
      return r.json() as Promise<HistoryResponse>;
    });
    historyPromise.catch(() => { historyPromise = null; });
  }
  return historyPromise;
}

export function useActivities() {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    loadHistory().then(d => live && setData(d)).catch(e => live && setError(e instanceof Error ? e.message : 'Error'));
    return () => { live = false; };
  }, []);
  return {
    activities: data?.activities ?? [],
    isDemo: data?.isDemo ?? false,
    today: data?.today ?? localToday(),
    loading: !data && !error,
    error,
  };
}

/** Max HR from recorded activities and the profile's age. */
export function useHRMax(activities: ActivitySummary[]): number {
  const { profile } = useProfile();
  return useMemo(() => estimateHRMax(activities, profile?.age), [activities, profile?.age]);
}

// ── Best efforts: computed server-side per run, stored in this browser ──────

const EFFORTS_KEY = 'training_best_efforts_v1';
const BATCH = 8;
type EffortStore = Record<string, { date: string; efforts: BestEffort[] }>;

function readStore(): EffortStore {
  try { return JSON.parse(localStorage.getItem(EFFORTS_KEY) ?? '{}') as EffortStore; } catch { return {}; }
}
function writeStore(s: EffortStore) {
  try { localStorage.setItem(EFFORTS_KEY, JSON.stringify(s)); } catch { /* quota or private mode */ }
}

/**
 * Backfills best efforts for every run in the history, newest first, a batch
 * at a time. Results survive reloads, so each run is analysed once.
 */
export function useBestEfforts(activities: ActivitySummary[], today: string) {
  const [store, setStore] = useState<EffortStore>({});
  const [failed, setFailed] = useState(0);
  const running = useRef(false);

  const runs = useMemo(
    () => activities.filter(a => a.sport === 'running' && a.distanceM >= 400).sort((a, b) => b.startTimeLocal.localeCompare(a.startTimeLocal)),
    [activities],
  );

  useEffect(() => { setStore(readStore()); }, []);

  useEffect(() => {
    if (!runs.length || running.current) return;
    let cancelled = false;
    running.current = true;
    (async () => {
      let current = readStore();
      let misses = 0;
      while (!cancelled) {
        const todo = runs.filter(r => !current[r.id]).slice(0, BATCH).map(r => r.id);
        if (!todo.length) break;
        try {
          const res = await fetch('/api/best-efforts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: todo, today }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.json() as { results: EffortStore; failed: string[] };
          current = { ...current, ...body.results };
          writeStore(current);
          if (!cancelled) setStore(current);
          if (body.failed.length) {
            misses += body.failed.length;
            setFailed(misses);
            if (Object.keys(body.results).length === 0) break; // nothing works right now; retry next visit
          }
        } catch {
          break;
        }
      }
      running.current = false;
    })();
    return () => { cancelled = true; running.current = false; };
  }, [runs, today]);

  const all: StoredEffort[] = useMemo(() => Object.entries(store).flatMap(([activityId, v]) =>
    v.efforts.map(e => ({ ...e, activityId, date: v.date }))), [store]);

  const processed = runs.filter(r => store[r.id]).length;
  return { all, store, processed, total: runs.length, failed, done: processed >= runs.length };
}

export interface VdotInfo {
  vdot: number | null;
  source: 'efforts' | 'garmin' | null;
  from?: StoredEffort;       // the effort that set it (source 'efforts')
}

/** VDOT from best efforts in the last 120 days; falls back to Garmin's latest VO2max. */
export function useVdot(activities: ActivitySummary[], efforts: StoredEffort[], today: string): VdotInfo {
  return useMemo(() => {
    const since = format(subDays(new Date(`${today}T12:00:00`), 120), 'yyyy-MM-dd');
    const best = bestVdotEffort(efforts.filter(e => e.date >= since));
    if (best) return { vdot: best.vdot, source: 'efforts' as const, from: best.from };
    const latest = [...activities].reverse().find(a => a.vo2max);
    return latest?.vo2max ? { vdot: latest.vo2max, source: 'garmin' as const } : { vdot: null, source: null };
  }, [activities, efforts, today]);
}

// ── Goals (this browser only) ───────────────────────────────────────────────

const GOALS_KEY = 'training_goals_v1';

export function useGoals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  useEffect(() => {
    try { setGoals(JSON.parse(localStorage.getItem(GOALS_KEY) ?? '[]') as Goal[]); } catch { /* ignore */ }
  }, []);
  const save = useCallback((next: Goal[]) => {
    setGoals(next);
    try { localStorage.setItem(GOALS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);
  const add = useCallback((g: Omit<Goal, 'id'>) => save([...goals, { ...g, id: `${Date.now()}` }]), [goals, save]);
  const remove = useCallback((id: string) => save(goals.filter(g => g.id !== id)), [goals, save]);
  return { goals, add, remove };
}
