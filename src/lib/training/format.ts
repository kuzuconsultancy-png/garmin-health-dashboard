/** 3725 → "1:02:05", 605 → "10:05". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

/** Seconds per km → "4:35 /km". */
export function formatPace(secPerKm: number | null | undefined): string {
  if (!secPerKm || !Number.isFinite(secPerKm)) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Hours with one decimal under 10 h, whole hours above. */
export function formatHours(sec: number): string {
  const h = sec / 3600;
  return h < 10 ? `${Math.round(h * 10) / 10}h` : `${Math.round(h)}h`;
}

export function formatKm(m: number): string {
  const km = m / 1000;
  return km < 100 ? (Math.round(km * 10) / 10).toString() : Math.round(km).toString();
}

export const EFFORT_LABELS: Record<number, string> = {
  400: '400 m', 1000: '1 km', 1609.34: '1 mile', 5000: '5 km', 10000: '10 km', 21097.5: 'Half', 42195: 'Marathon',
};
