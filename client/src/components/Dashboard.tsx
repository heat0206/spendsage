import type {
  ExpenseView,
  MonthSummary,
  PlanView,
} from '../lib/api';
import { formatCompact, formatINR, MONTH_LONG, MONTH_SHORT } from '../lib/format';

interface CategoryRow { name: string; total: number }

interface DashboardData {
  plan: PlanView | null;
  monthly: MonthSummary;
  recent: ExpenseView[];
  categories: CategoryRow[];
}

const CATEGORY_COLORS: Record<string, string> = {
  Food: '#e8a33d',
  Groceries: '#6ab187',
  Transport: '#4a90d9',
  Entertainment: '#9b59b6',
  Clothing: '#e74c3c',
  Health: '#1abc9c',
  Home: '#2F5D50',
  Gifts: '#f39c12',
  Travel: '#3498db',
  Utilities: '#95a5a6',
  Education: '#27ae60',
  'Personal Care': '#e91e63',
  Subscriptions: '#607d8b',
  Gold: '#ffc107',
  Sweets: '#ff7043',
  Other: '#bdc3c7',
};

function categoryColor(name: string) {
  return CATEGORY_COLORS[name] ?? '#bdc3c7';
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    on_track: { label: 'On track', cls: 'border-sage-line bg-sage-soft text-sage' },
    not_started: { label: 'No spends yet', cls: 'border-sage-line bg-paper-dim text-ink-soft' },
    ahead_of_pace: { label: 'Ahead of pace', cls: 'border-marigold/40 bg-marigold/10 text-marigold' },
    over_budget: { label: 'Over budget', cls: 'border-clay/30 bg-clay/10 text-clay' },
    unknown: { label: 'No plan', cls: 'border-sage-line bg-paper-dim text-ink-soft' },
  };
  const { label, cls } = map[status] ?? map.unknown!;
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function Dashboard({ data, month, year }: { data: DashboardData; month: number; year: number }) {
  const { monthly, recent, categories } = data;
  const currentMonthPlan = data.plan?.months.find((m) => m.month === month);

  const spentPct = monthly.effectiveBudget > 0
    ? Math.min((monthly.actualSpend / monthly.effectiveBudget) * 100, 100)
    : 0;

  const categoryTotal = categories.reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-6">
      {/* Month summary row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-sage-line bg-white/70 p-5">
          <p className="text-xs uppercase tracking-wide text-ink-soft">Spent this month</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
            {formatINR(monthly.actualSpend)}
          </p>
          <p className="mt-1 text-xs text-ink-soft">of {formatINR(monthly.effectiveBudget)}</p>
        </div>

        <div className="rounded-2xl border border-sage-line bg-white/70 p-5">
          <p className="text-xs uppercase tracking-wide text-ink-soft">Remaining</p>
          <p className={`mt-1 text-3xl font-semibold tabular-nums ${monthly.remaining < 0 ? 'text-clay' : 'text-ink'}`}>
            {monthly.remaining < 0 ? '−' : ''}{formatINR(Math.abs(monthly.remaining))}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            {monthly.daysLeft > 0 ? `${formatINR(monthly.safeDailySpend)}/day · ${monthly.daysLeft} days left` : 'Month ended'}
          </p>
        </div>

        <div className="rounded-2xl border border-sage-line bg-white/70 p-5">
          <div className="flex items-start justify-between">
            <p className="text-xs uppercase tracking-wide text-ink-soft">Pace</p>
            <StatusBadge status={monthly.status} />
          </div>
          {currentMonthPlan && currentMonthPlan.festivalNames.length > 0 && (
            <p className="mt-3 text-xs text-ink-soft">
              <span className="font-medium text-ink">Festival month</span>
              <span className="ml-1">· {currentMonthPlan.festivalNames.join(', ')}</span>
            </p>
          )}
          {monthly.willBreach && (
            <p className="mt-2 text-xs text-clay">Projected to exceed budget at current pace.</p>
          )}
        </div>
      </div>

      {/* Spend progress bar */}
      <div className="rounded-2xl border border-sage-line bg-white/70 p-5">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-ink">
            {MONTH_LONG[month - 1]} {year}
          </p>
          <p className="text-xs tabular-nums text-ink-soft">{spentPct.toFixed(0)}% used</p>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-sage-soft">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              monthly.status === 'over_budget' ? 'bg-clay' :
              monthly.status === 'ahead_of_pace' ? 'bg-marigold' : 'bg-sage'
            }`}
            style={{ width: `${spentPct}%` }}
          />
        </div>
        {monthly.toastLine && (
          <p className="mt-3 text-xs leading-relaxed text-ink-soft">{monthly.toastLine}</p>
        )}
      </div>

      {/* Categories + recent */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Category breakdown */}
        <div className="rounded-2xl border border-sage-line bg-white/70 p-5">
          <h3 className="text-sm font-semibold text-ink">Spending by category</h3>
          {categories.length === 0 ? (
            <p className="mt-4 text-xs text-ink-soft">No expenses logged yet.</p>
          ) : (
            <ul className="mt-4 space-y-2.5">
              {categories.map((cat) => {
                const pct = categoryTotal > 0 ? (cat.total / categoryTotal) * 100 : 0;
                return (
                  <li key={cat.name}>
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs font-medium text-ink">{cat.name}</span>
                      <span className="text-xs tabular-nums text-ink-soft">{formatINR(cat.total)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sage-soft">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: categoryColor(cat.name) }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Recent expenses */}
        <div className="rounded-2xl border border-sage-line bg-white/70 p-5">
          <h3 className="text-sm font-semibold text-ink">Recent expenses</h3>
          {recent.length === 0 ? (
            <p className="mt-4 text-xs text-ink-soft">No expenses logged yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-sage-line/50">
              {recent.map((expense) => (
                <li key={expense.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: categoryColor(expense.category) }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink">{expense.merchantClean || expense.merchantRaw}</p>
                    <p className="text-[11px] text-ink-soft">
                      {expense.category} · {MONTH_SHORT[new Date(expense.occurredAt).getMonth()]} {new Date(expense.occurredAt).getDate()}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-ink">
                    {formatCompact(expense.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
