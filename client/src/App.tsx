import { useCallback, useEffect, useState } from 'react';
import { AddExpenseSheet } from './components/AddExpenseSheet';
import { Dashboard } from './components/Dashboard';
import { getDashboard, type AddExpenseResult, type DashboardResponse } from './lib/api';
import { ToastContainer } from './lib/toast';
import YearPlanner from './screens/YearPlanner';

type Tab = 'planner' | 'dashboard';

const NOW = new Date();
const CURRENT_MONTH = NOW.getMonth() + 1;
const CURRENT_YEAR = NOW.getFullYear();

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true">
        <rect x="2" y="16" width="5" height="10" rx="1.6" fill="#2F5D50" />
        <rect x="10" y="11" width="5" height="15" rx="1.6" fill="#2F5D50" />
        <rect x="18" y="4" width="5" height="22" rx="1.6" fill="#E8A33D" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight text-ink">SpendSage</span>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('planner');
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [dashboardData, setDashboardData] = useState<DashboardResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const loadDashboard = useCallback(() => {
    setDashboardLoading(true);
    getDashboard(CURRENT_YEAR, CURRENT_MONTH)
      .then(setDashboardData)
      .catch(console.error)
      .finally(() => setDashboardLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'dashboard') loadDashboard();
  }, [tab, loadDashboard]);

  function handleExpenseAdded(result: AddExpenseResult) {
    // Refresh dashboard if visible, otherwise it'll load fresh on next switch.
    if (tab === 'dashboard') {
      loadDashboard();
    }
    // Keep the result in scope so YearPlanner can refresh too if needed.
    void result;
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Wordmark />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddSheet(true)}
            className="flex items-center gap-1.5 rounded-full bg-sage px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sage/90"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Log spend
          </button>
          <span className="rounded-full border border-sage-line bg-paper-dim px-3 py-2 text-xs font-medium text-ink-soft">
            demo · sandbox
          </span>
        </div>
      </header>

      {/* Tab bar */}
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="inline-flex gap-1 rounded-xl bg-paper-dim p-1">
          {(['planner', 'dashboard'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                'rounded-lg px-4 py-1.5 text-xs font-medium capitalize transition-colors',
                tab === t ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:text-ink',
              ].join(' ')}
            >
              {t === 'planner' ? 'Year Planner' : 'Dashboard'}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 pt-4">
        {tab === 'planner' && <YearPlanner />}

        {tab === 'dashboard' && (
          <div className="mx-auto w-full max-w-5xl px-6 pb-16">
            {dashboardLoading || !dashboardData ? (
              <div className="space-y-4 pt-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 animate-pulse rounded-2xl bg-sage-soft/60" />
                ))}
              </div>
            ) : (
              <Dashboard
                data={dashboardData}
                month={CURRENT_MONTH}
                year={CURRENT_YEAR}
              />
            )}
          </div>
        )}
      </main>

      <footer className="mx-auto w-full max-w-5xl px-6 pb-8 pt-4 text-xs text-ink-soft/70">
        SpendSage · PayPal AI Hackathon · sandbox only
      </footer>

      {showAddSheet && (
        <AddExpenseSheet
          onAdded={handleExpenseAdded}
          onClose={() => setShowAddSheet(false)}
        />
      )}

      <ToastContainer />
    </div>
  );
}
