'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Dumbbell, Loader2, AlertCircle } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import FitnessTab from '@/components/training/FitnessTab';
import LogTab from '@/components/training/LogTab';
import GoalsTab from '@/components/training/GoalsTab';
import ProgressTab from '@/components/training/ProgressTab';
import RecordsTab from '@/components/training/RecordsTab';
import { Segmented } from '@/components/training/shared';
import { useActivities, useBestEfforts, useHRMax, useVdot } from '@/lib/training/hooks';
import { useLang } from '@/lib/i18n';

type Tab = 'fitness' | 'log' | 'goals' | 'progress' | 'records';
const TABS: Tab[] = ['fitness', 'log', 'goals', 'progress', 'records'];
const TAB_KEY = 'training_tab';

export default function TrainingPage() {
  const { t } = useLang();
  const { activities, isDemo, today, loading, error } = useActivities();
  const hrMax = useHRMax(activities);
  const efforts = useBestEfforts(activities, today);
  const vdot = useVdot(activities, efforts.all, today);
  const [tab, setTab] = useState<Tab>('fitness');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as Tab | null;
      if (saved && TABS.includes(saved)) setTab(saved);
    } catch { /* ignore */ }
  }, []);
  const choose = (v: Tab) => {
    setTab(v);
    try { localStorage.setItem(TAB_KEY, v); } catch { /* ignore */ }
  };

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 bg-bg/95 backdrop-blur border-b border-border">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/" className="p-1.5 rounded-lg hover:bg-surface text-secondary hover:text-primary transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <Dumbbell size={16} className="text-strain" />
          <h1 className="text-sm font-bold text-primary">{t('training.title')}</h1>
        </div>
        <div className="max-w-md mx-auto px-4 pb-3">
          <Segmented value={tab} onChange={choose} options={TABS.map(v => ({ value: v, label: t(`training.tabs.${v}`) }))} />
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pb-28 pt-4 flex flex-col gap-4">
        {isDemo && (
          <div className="card border-yellow-400/20 bg-yellow-400/5">
            <p className="text-[11px] text-yellow-400">{t('training.demo')}</p>
          </div>
        )}
        {loading && (
          <div className="card flex flex-col items-center gap-3 py-10">
            <Loader2 size={22} className="text-strain animate-spin" />
            <p className="text-sm text-secondary">{t('training.loading')}</p>
          </div>
        )}
        {error && (
          <div className="card border-dashed flex items-start gap-3">
            <AlertCircle size={18} className="text-recovery-red flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-primary">{t('training.error')}</p>
              <p className="text-xs text-muted mt-1">{error}</p>
            </div>
          </div>
        )}
        {!loading && !error && (
          <>
            {tab === 'fitness' && <FitnessTab activities={activities} hrMax={hrMax} today={today} />}
            {tab === 'log' && <LogTab activities={activities} hrMax={hrMax} today={today} />}
            {tab === 'goals' && <GoalsTab activities={activities} today={today} />}
            {tab === 'progress' && <ProgressTab activities={activities} today={today} />}
            {tab === 'records' && <RecordsTab activities={activities} today={today} efforts={efforts.all} progress={efforts} vdot={vdot} />}
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
