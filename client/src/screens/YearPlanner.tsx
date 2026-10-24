import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getBootstrap,
  postResetAll,
  postResetMonth,
  putFestivals,
  putOverrides,
  putSpendingLevel,
  type FestivalView,
  type PlanView,
  type SpendingLevel,
  SPENDING_LEVEL_LABELS,
} from '../lib/api';
import { formatINR, MONTH_LONG, MONTH_SHORT } from '../lib/format';

const NOW = new Date();
const CURRENT_MONTH = NOW.getMonth() + 1;
const CURRENT_YEAR = NOW.getFullYear();

function pickedOverrides(plan: PlanView): Record<number, number> {
  const picked: Record<number, number> = {};
  for (const month of plan.months) {
    if (month.isPinned && month.overrideAmount !== null) {
      picked[month.month] = month.overrideAmount;
    }
  }
  return picked;
}

const LEVEL_STYLES: Record<SpendingLevel, { active: string; idle: string; dot: string }> = {
  very_high: {
    active: 'bg-clay text-white border-clay',
    idle: 'border-sage-line text-ink-soft hover:border-clay/60 hover:text-clay',
    dot: 'bg-clay',
  },
  high: {
    active: 'bg-marigold text-white border-marigold',
    idle: 'border-sage-line text-ink-soft hover:border-marigold/60 hover:text-marigold',
    dot: 'bg-marigold',
  },
  normal: {
    active: 'bg-sage text-white border-sage',
    idle: 'border-sage-line text-ink-soft hover:border-sage/60 hover:text-sage',
    dot: 'bg-sage',
  },
  low: {
    active: 'bg-ink-soft text-white border-ink-soft',
    idle: 'border-sage-line text-ink-soft hover:border-ink-soft/60',
    dot: 'bg-ink-soft',
  },
};

export default function YearPlanner() {
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [festivals, setFestivals] = useState<FestivalView[]>([]);
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<number>(CURRENT_MONTH);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Controlled input for the custom amount box
  const [amountInput, setAmountInput] = useState('');
  const amountInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getBootstrap()
      .then((data) => {
        if (cancelled) return;
        setFestivals(data.festivals);
        if (data.plan) {
          setPlan(data.plan);
          setOverrides(pickedOverrides(data.plan));
        }
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Sync amount input when selected month changes
  useEffect(() => {
    if (!plan) return;
    const month = plan.months.find((m) => m.month === selected);
    if (month?.isPinned && month.overrideAmount !== null) {
      setAmountInput(String(Math.round(month.overrideAmount / 100)));
    } else {
      setAmountInput('');
    }
  }, [selected, plan]);

  const applyAmountInput = useCallback(() => {
    if (!plan) return;
    const rupees = parseFloat(amountInput);
    if (!amountInput.trim() || isNaN(rupees) || rupees < 0) return;
    const paise = Math.round(rupees * 100);

    const next = { ...overrides, [selected]: paise };
    setOverrides(next);
    setSaving(true);
    setError(null);

    void (async () => {
      try {
        const updated = await putOverrides(plan.year, next);
        setPlan(updated);
        setOverrides(pickedOverrides(updated));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not set amount');
        // Roll back optimistic override on failure
        setOverrides(pickedOverrides(plan));
      } finally {
        setSaving(false);
      }
    })();
  }, [amountInput, overrides, plan, selected]);

  const handleResetMonth = useCallback(async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await postResetMonth(plan.year, selected);
      setPlan(updated);
      setOverrides(pickedOverrides(updated));
      setAmountInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset month');
    } finally {
      setSaving(false);
    }
  }, [plan, selected]);

  const handleResetAll = useCallback(async () => {
    if (!plan) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await postResetAll(plan.year);
      setPlan(updated);
      setOverrides({});
      setAmountInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset all months');
    } finally {
      setSaving(false);
    }
  }, [plan]);

  const handleSpendingLevel = useCallback(
    async (level: SpendingLevel) => {
      if (!plan) return;

      // Clear any manual pin for this month — spending level replaces it
      const nextOverrides = { ...overrides };
      delete nextOverrides[selected];

      setSaving(true);
      setError(null);
      try {
        const updated = await putSpendingLevel(plan.year, selected, level);
        setPlan(updated);
        setOverrides(pickedOverrides(updated));
        setAmountInput('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update spending level');
      } finally {
        setSaving(false);
      }
    },
    [plan, selected, overrides],
  );

  const toggleFestival = useCallback(
    async (id: string, enabled: boolean) => {
      if (!plan) return;
      const optimistic = festivals.map((f) => (f.id === id ? { ...f, enabled } : f));
      setFestivals(optimistic);
      const enabledIds = optimistic.filter((f) => f.enabled).map((f) => f.id);
      setSaving(true);
      try {
        const result = await putFestivals(enabledIds, plan.year);
        if (result.plan) { setPlan(result.plan); setOverrides(pickedOverrides(result.plan)); }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update festivals');
        setFestivals(festivals);
      } finally {
        setSaving(false);
      }
    },
    [festivals, plan],
  );

  const maxBudget = plan ? Math.max(...plan.months.map((m) => m.budget), 1) : 1;
  const total = plan ? plan.months.reduce((sum, m) => sum + m.budget, 0) : 0;
  const selectedMonth = plan?.months.find((m) => m.month === selected) ?? null;
  const conserved = plan ? total === plan.envelope : false;
  const enabledCount = festivals.filter((f) => f.enabled).length;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16 space-y-4">
        <div className="h-4 w-40 animate-pulse rounded bg-sage-soft" />
        <div className="h-72 animate-pulse rounded-2xl bg-sage-soft/60" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <p className="text-ink-soft">{error ?? 'No plan yet. Set up your income to generate one.'}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-20">
      {/* Header */}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sage">
            Year planner · {plan.year}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Budget the year, not the month.
          </h1>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-ink-soft">Annual envelope</p>
          <p className="text-2xl font-semibold tabular-nums text-ink">{formatINR(plan.envelope)}</p>
        </div>
      </div>

      {plan.rationale && (
        <p className="mt-4 max-w-3xl border-l-2 border-marigold/70 pl-3 text-sm leading-relaxed text-ink-soft">
          {plan.rationale}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-clay/30 bg-clay/10 px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}

      {/* Chart */}
      <section className="mt-8 rounded-2xl border border-sage-line bg-white/70 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Monthly budget</h2>
          <p className="text-xs text-ink-soft">
            Average {formatINR(plan.monthlyBase)} · tap a month to adjust
            {saving && <span className="ml-2 animate-pulse text-sage">saving…</span>}
          </p>
        </div>

        <div className="relative mt-8">
          {/* Average reference line */}
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-soft/30"
            style={{ bottom: `${(plan.monthlyBase / maxBudget) * 78 + 2.2}rem` }}
          />

          <div className="flex items-end gap-1 sm:gap-2">
            {plan.months.map((month) => {
              const heightPct = Math.max((month.budget / maxBudget) * 78, 4);
              const isSelected = month.month === selected;
              const isPeak = month.budget === maxBudget;
              const isCurrent = month.month === CURRENT_MONTH && plan.year === CURRENT_YEAR;
              const hasLevel = month.spendingLevel !== null;

              return (
                <button
                  key={month.month}
                  type="button"
                  onClick={() => setSelected(month.month)}
                  className="group flex flex-1 cursor-pointer flex-col items-center focus:outline-none"
                  aria-pressed={isSelected}
                  aria-label={`${MONTH_LONG[month.month - 1]} ${formatINR(month.budget)}`}
                >
                  <span className="mb-1 text-[10px] font-medium tabular-nums text-ink-soft opacity-0 transition-opacity group-hover:opacity-100 sm:text-[11px]">
                    {formatINR(month.budget)}
                  </span>

                  <div className="flex h-64 w-full items-end">
                    <div
                      className={[
                        'w-full rounded-t-md transition-all duration-200 bg-sage/80',
                        isSelected ? 'ring-2 ring-ink/30 ring-offset-1 ring-offset-white' : '',
                        isCurrent ? 'outline outline-1 outline-offset-2 outline-marigold/50' : '',
                      ].join(' ')}
                      style={{
                        height: `${heightPct}%`,
                        backgroundColor: hasLevel
                          ? getLevelHex(month.spendingLevel!)
                          : isPeak ? '#E8A33D' : undefined,
                      }}
                    />
                  </div>

                  <span className={`mt-2 text-[10px] font-medium sm:text-[11px] ${isSelected ? 'text-ink' : 'text-ink-soft'}`}>
                    {MONTH_SHORT[month.month - 1]}
                  </span>

                  {month.festivalNames.length > 0 && (
                    <span className="mt-1 size-1 rounded-full bg-marigold" title={month.festivalNames.join(', ')} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Conservation footer */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-sage-line/70 pt-4">
          <p className="text-sm text-ink-soft">
            <span className="font-semibold tabular-nums text-ink">{formatINR(total)}</span> across 12 months
          </p>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
            conserved ? 'border-sage-line bg-sage-soft text-sage' : 'border-clay/30 bg-clay/10 text-clay'
          }`}>
            <span className={`size-1.5 rounded-full ${conserved ? 'bg-sage' : 'bg-clay'}`} />
            {conserved ? 'annual total unchanged' : 'total drifted — refresh'}
          </span>
        </div>
      </section>

      {/* Detail + festivals */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Month detail */}
        <section className="space-y-5 rounded-2xl border border-sage-line bg-white/70 p-6 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                {MONTH_LONG[selected - 1]} {plan.year}
              </h2>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
                {formatINR(selectedMonth?.budget ?? 0)}
              </p>
            </div>
            {selectedMonth?.spendingLevel && (
              <span
                className="rounded-full border px-3 py-1 text-xs font-medium"
                style={{ borderColor: getLevelHex(selectedMonth.spendingLevel) + '60', color: getLevelHex(selectedMonth.spendingLevel) }}
              >
                {SPENDING_LEVEL_LABELS[selectedMonth.spendingLevel]}
              </span>
            )}
          </div>

          {/* Festivals — names only, no numbers */}
          {selectedMonth && selectedMonth.festivalNames.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-ink-soft">Festivals this month</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedMonth.festivalNames.map((name) => (
                  <span key={name} className="rounded-full border border-sage-line bg-paper px-2.5 py-1 text-xs text-ink">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-soft">
              No festivals this month — it's a lean month that funds the busy ones.
            </p>
          )}

          {/* AI reason */}
          {selectedMonth?.spendingReason && (
            <p className="border-l-2 border-marigold/60 pl-3 text-sm italic leading-relaxed text-ink-soft">
              {selectedMonth.spendingReason}
            </p>
          )}

          {/* Spending level buttons */}
          <div>
            <p className="text-xs font-medium text-ink-soft">How much do you plan to spend?</p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {(Object.keys(SPENDING_LEVEL_LABELS) as SpendingLevel[]).map((level) => {
                const isActive = selectedMonth?.spendingLevel === level;
                const s = LEVEL_STYLES[level];
                return (
                  <button
                    key={level}
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSpendingLevel(level)}
                    className={[
                      'rounded-xl border py-2.5 text-xs font-semibold transition-all',
                      isActive ? s.active : s.idle,
                      saving ? 'opacity-50 cursor-not-allowed' : '',
                    ].join(' ')}
                  >
                    {SPENDING_LEVEL_LABELS[level]}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-ink-soft">
              Choosing a level adjusts this month's share of the annual budget. The total never changes.
            </p>
          </div>

          {/* Custom amount input */}
          <div>
            <p className="text-xs font-medium text-ink-soft">Or set an exact amount (₹)</p>
            <div className="mt-2 flex gap-2">
              <input
                ref={amountInputRef}
                type="number"
                min={0}
                step={100}
                placeholder={String(Math.round((selectedMonth?.budget ?? 0) / 100))}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyAmountInput(); }}
                className="w-full rounded-xl border border-sage-line bg-white px-3 py-2.5 text-sm tabular-nums text-ink placeholder-ink-soft/40 focus:border-sage focus:outline-none focus:ring-1 focus:ring-sage"
              />
              <button
                type="button"
                disabled={!amountInput.trim() || saving}
                onClick={applyAmountInput}
                className="shrink-0 rounded-xl bg-sage px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                Set
              </button>
            </div>
          </div>

          {/* Reset buttons */}
          <div className="flex flex-wrap gap-2 pt-1">
            {(selectedMonth?.isPinned || selectedMonth?.spendingLevel) && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleResetMonth()}
                className="rounded-lg border border-sage-line px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-dim disabled:opacity-50"
              >
                Reset {MONTH_LONG[selected - 1]} to standard plan
              </button>
            )}
            {plan.months.some((m) => m.isPinned || m.spendingLevel !== null) && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleResetAll()}
                className="rounded-lg border border-sage-line px-3 py-1.5 text-xs text-ink-soft hover:bg-paper-dim disabled:opacity-50"
              >
                Reset all months to standard plan
              </button>
            )}
          </div>
        </section>

        {/* Festivals sidebar */}
        <section className="rounded-2xl border border-sage-line bg-white/70 p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-ink">Your festivals</h2>
            <span className="text-xs text-ink-soft">{enabledCount}/{festivals.length} on</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            Only the ones you actually celebrate should raise a month.
          </p>

          <ul className="mt-4 max-h-80 space-y-1 overflow-y-auto pr-1">
            {festivals.map((festival) => (
              <li key={festival.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 hover:bg-paper-dim">
                  <input
                    type="checkbox"
                    checked={festival.enabled}
                    onChange={(e) => void toggleFestival(festival.id, e.target.checked)}
                    className="size-3.5 accent-[#2F5D50]"
                  />
                  <span className="w-9 shrink-0 text-[11px] text-ink-soft">
                    {MONTH_SHORT[festival.month - 1]}
                  </span>
                  <span className="flex-1 truncate text-xs text-ink">{festival.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function getLevelHex(level: SpendingLevel): string {
  return { very_high: '#b4553c', high: '#e8a33d', normal: '#2F5D50', low: '#4a5a53' }[level];
}
