import { addDays, format, getDay, parseISO, differenceInCalendarDays } from 'date-fns';
import type { ActivitySummary, ActivityStreams, Sport } from './types';
import { effortFromZones } from './effort';

// Deterministic demo data: ~2 years of a runner who also rides, with a 4-week
// build/recover cycle, a summer break last year, a 10K race every ~10 weeks
// and slowly improving fitness. Same input → same output.

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

type Kind = 'intervals' | 'tempo' | 'easy' | 'long' | 'race' | 'easyRide' | 'longRide' | 'strength';

const KIND: Record<Kind, {
  sport: Sport; sportKey: string; name: string; time: string;
  avgHR: number; zones: number[]; aerobicTE: number; anaerobicTE: number;
}> = {
  intervals: { sport: 'running', sportKey: 'running', name: 'Intervals', time: '07:10', avgHR: 156, zones: [0.15, 0.2, 0.15, 0.3, 0.2], aerobicTE: 3.6, anaerobicTE: 2.8 },
  tempo:     { sport: 'running', sportKey: 'running', name: 'Tempo run', time: '07:10', avgHR: 161, zones: [0.1, 0.15, 0.25, 0.5, 0], aerobicTE: 3.8, anaerobicTE: 1.2 },
  easy:      { sport: 'running', sportKey: 'running', name: 'Easy run', time: '07:15', avgHR: 138, zones: [0.15, 0.7, 0.15, 0, 0], aerobicTE: 2.6, anaerobicTE: 0.2 },
  long:      { sport: 'running', sportKey: 'running', name: 'Long run', time: '08:30', avgHR: 146, zones: [0.05, 0.55, 0.35, 0.05, 0], aerobicTE: 4.0, anaerobicTE: 0.5 },
  race:      { sport: 'running', sportKey: 'running', name: '10K race', time: '09:30', avgHR: 174, zones: [0, 0.05, 0.1, 0.45, 0.4], aerobicTE: 4.8, anaerobicTE: 2.4 },
  easyRide:  { sport: 'cycling', sportKey: 'road_biking', name: 'Easy ride', time: '17:45', avgHR: 128, zones: [0.3, 0.55, 0.15, 0, 0], aerobicTE: 2.4, anaerobicTE: 0.1 },
  longRide:  { sport: 'cycling', sportKey: 'road_biking', name: 'Long ride', time: '09:00', avgHR: 134, zones: [0.2, 0.55, 0.22, 0.03, 0], aerobicTE: 3.4, anaerobicTE: 0.3 },
  strength:  { sport: 'strength', sportKey: 'strength_training', name: 'Strength', time: '18:30', avgHR: 112, zones: [0.6, 0.3, 0.1, 0, 0], aerobicTE: 1.5, anaerobicTE: 1.0 },
};

function sessionsFor(date: string, dayIndex: number, breakYear: number, rnd: () => number): { kind: Kind; minutes: number }[] {
  const d = parseISO(date);
  const dow = getDay(d); // 0 = Sun
  const week = Math.floor(dayIndex / 7);
  const cycleWeek = week % 4;          // 0–2 build, 3 recovery
  const vol = cycleWeek === 3 ? 0.75 : 1 + cycleWeek * 0.06;
  const isRaceWeek = week % 10 === 9;

  // summer break last year (2 weeks), and ~8 % random missed sessions
  const md = date.slice(5);
  if (Number(date.slice(0, 4)) === breakYear && md >= '07-20' && md <= '08-03') return [];
  if (rnd() < 0.08) return [];

  switch (dow) {
    case 1: return rnd() < 0.3 ? [{ kind: 'strength', minutes: 40 }] : [];
    case 2: return [{ kind: 'intervals', minutes: Math.round(55 * vol) }];
    case 3: return [{ kind: 'easyRide', minutes: Math.round((60 + rnd() * 20) * vol) }];
    case 4: return isRaceWeek ? [{ kind: 'easy', minutes: 35 }] : [{ kind: 'tempo', minutes: Math.round(45 * vol) }];
    case 5: return rnd() < 0.5 ? [{ kind: 'strength', minutes: 45 }] : [];
    case 6: return isRaceWeek ? [{ kind: 'easy', minutes: 25 }] : [{ kind: 'long', minutes: Math.round((75 + (dayIndex % 120) / 4) * vol) }];
    default: // Sunday
      if (isRaceWeek) return [{ kind: 'race', minutes: 0 }];
      return week % 2 ? [{ kind: 'longRide', minutes: Math.round(120 * vol) }] : [{ kind: 'easy', minutes: Math.round(40 * vol) }];
  }
}

/** Seconds per km for a kind, improving ~6 % over the whole history. */
function paceFor(kind: Kind, progress: number): number {
  const base: Partial<Record<Kind, number>> = { intervals: 300, tempo: 285, easy: 340, long: 330, race: 258 };
  return (base[kind] ?? 300) * (1 - 0.06 * progress);
}

export function generateDemoHistory(since: string, today: string): ActivitySummary[] {
  const start = parseISO(since);
  const total = differenceInCalendarDays(parseISO(today), start) + 1;
  const out: ActivitySummary[] = [];
  const breakYear = Number(today.slice(0, 4)) - 1;

  for (let i = 0; i < total; i++) {
    const date = format(addDays(start, i), 'yyyy-MM-dd');
    const rnd = mulberry32(hash(date));
    const progress = i / Math.max(1, total - 1);
    sessionsFor(date, i, breakYear, rnd).forEach((s, n) => {
      const k = KIND[s.kind];
      let durationSec: number;
      let distanceM: number;
      if (k.sport === 'running') {
        const pace = paceFor(s.kind, progress) * (0.97 + rnd() * 0.06);
        distanceM = s.kind === 'race' ? 10000 : (s.minutes * 60 / pace) * 1000;
        durationSec = s.kind === 'race' ? pace * 10 : s.minutes * 60;
      } else if (k.sport === 'cycling') {
        durationSec = s.minutes * 60;
        distanceM = durationSec * (7.2 + rnd() * 1.0 + progress * 0.4);
      } else {
        durationSec = s.minutes * 60;
        distanceM = 0;
      }
      const zones = k.zones.map(f => Math.round(f * durationSec));
      const avgHR = Math.round(k.avgHR + (rnd() - 0.5) * 6);
      out.push({
        id: `demo-${date}-${n}`,
        name: k.name,
        date,
        startTimeLocal: `${date} ${k.time}:00`,
        sport: k.sport,
        sportKey: k.sportKey,
        durationSec: Math.round(durationSec),
        distanceM: Math.round(distanceM),
        elevationGainM: k.sport === 'cycling' ? Math.round(200 + rnd() * 500) : k.sport === 'running' ? Math.round(20 + rnd() * 110) : 0,
        avgHR,
        maxHR: Math.min(192, avgHR + 12 + Math.round(rnd() * 14)),
        avgSpeed: durationSec > 0 ? Math.round((distanceM / durationSec) * 100) / 100 : 0,
        calories: Math.round(durationSec / 60 * (k.sport === 'strength' ? 6 : 11)),
        trainingLoad: Math.round(effortFromZones(zones) * 0.9),
        aerobicTE: Math.round((k.aerobicTE + (rnd() - 0.5) * 0.4) * 10) / 10,
        anaerobicTE: Math.round((k.anaerobicTE + (rnd() - 0.5) * 0.4) * 10) / 10,
        vo2max: k.sport === 'running' ? Math.round(47 + 4 * progress) : undefined,
        hrZoneSec: zones,
      });
    });
  }
  return out;
}

/** Plausible 1 Hz-ish streams that match the summary's distance, duration and HR. */
export function generateDemoStreams(a: ActivitySummary): ActivityStreams {
  const rnd = mulberry32(hash(a.id));
  const step = Math.max(1, Math.ceil(a.durationSec / 6000));
  const n = Math.floor(a.durationSec / step) + 1;
  const t = Array.from({ length: n }, (_, i) => i * step);
  const base = a.durationSec > 0 ? a.distanceM / a.durationSec : 0;

  // relative speed profile by workout type
  const rel = t.map(sec => {
    const m = sec / 60;
    const noise = 1 + (rnd() - 0.5) * 0.06;
    if (a.name === 'Intervals') {
      if (m < 15 || m > a.durationSec / 60 - 10) return 0.85 * noise;
      return ((m - 15) % 5) < 3 ? 1.25 * noise : 0.75 * noise;
    }
    if (a.name === 'Tempo run') return (m < 10 || m > a.durationSec / 60 - 10 ? 0.85 : 1.1) * noise;
    if (a.name === '10K race') return (1.02 - 0.04 * (sec / a.durationSec)) * noise;
    return (0.98 + 0.04 * (sec / Math.max(1, a.durationSec))) * noise; // slight negative split
  });

  const speed = rel.map(r => r * base);
  const dist: number[] = [0];
  for (let i = 1; i < n; i++) dist.push(dist[i - 1] + speed[i] * step);
  // rescale so the total distance matches the summary exactly
  const scale = dist[n - 1] > 0 ? a.distanceM / dist[n - 1] : 0;
  for (let i = 0; i < n; i++) { dist[i] *= scale; speed[i] *= scale; }

  // rolling terrain sized to the summary's elevation gain
  const amp = Math.max(2, a.elevationGainM / 8);
  const phase = rnd() * Math.PI * 2;
  const ele = dist.map(d => 30 + amp * Math.sin(d / 900 + phase) + (amp / 3) * Math.sin(d / 230));

  // HR follows effort with lag, plus slow cardiac drift
  const rest = 55;
  const hr: number[] = [];
  let cur = rest + 30;
  for (let i = 0; i < n; i++) {
    const target = rest + (a.avgHR - rest) * Math.pow(Math.max(0.3, rel[i]), 0.9) * (1 + 0.04 * (t[i] / Math.max(1, a.durationSec)));
    cur += (target - cur) * Math.min(1, 0.04 * step);
    hr.push(Math.round(Math.min(a.maxHR || 200, cur)));
  }

  return a.distanceM > 0 ? { t, dist, speed, ele, hr } : { t, dist: t.map(() => 0), hr };
}
