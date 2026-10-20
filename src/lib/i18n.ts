'use client';

import { createContext, useContext, useState, useEffect, createElement } from 'react';
import type { ReactNode } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
export type Locale = 'es' | 'en';

// ── Simple nested-key resolver with {var} interpolation ──────────────────────
function resolve(obj: Record<string, unknown>, key: string): string {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p];
    else return key;
  }
  return typeof cur === 'string' ? cur : key;
}

export function interpolate(
  str: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return str;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
    str,
  );
}

function resolveArr(obj: Record<string, unknown>, key: string): string[] {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[p];
    else return [];
  }
  return Array.isArray(cur) ? cur.map(String) : [];
}

/**
 * Saved preference, else browser language. Usable outside React state — child
 * effects run before the provider's, so they can't rely on `locale` on mount.
 */
export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem('garmin_lang');
    if (saved === 'en' || saved === 'es') return saved;
  } catch { /* storage unavailable */ }
  return typeof navigator !== 'undefined' && navigator.language.startsWith('es') ? 'es' : 'en';
}

// ── Context ───────────────────────────────────────────────────────────────────
interface LangContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  tArr: (key: string) => string[];
}

const LangContext = createContext<LangContextType>({
  locale: 'es',
  setLocale: () => {},
  t: (key) => key,
  tArr: () => [],
});

// ── Provider ─────────────────────────────────────────────────────────────────
export function LangProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('es');
  const [messages, setMessages] = useState<Record<string, unknown>>({});

  // Load locale file + apply saved preference
  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  useEffect(() => {
    import(`@/locales/${locale}`)
      .then((mod) => setMessages(mod.default))
      .catch(() => {});
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('garmin_lang', l);
  };

  const t = (key: string, vars?: Record<string, string | number>) =>
    interpolate(resolve(messages, key) || key, vars);

  const tArr = (key: string): string[] => resolveArr(messages, key);

  return createElement(LangContext.Provider, { value: { locale, setLocale, t, tArr } }, children);
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useLang() {
  return useContext(LangContext);
}
