import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getBootstrap,
  putFestivals,
  putOverrides,
  type FestivalView,
  type PlanView,
} from '../lib/api';
import { formatCompact, formatINR, formatMultiplier, MONTH_LONG, MONTH_SHORT } from '../lib/format';

const NOW = new Date();
const CURRENT_MONTH = NOW.getMonth() + 1;
const CURRENT_YEAR = NOW.getFullYear();

function pickedOverrides(plan: PlanView): Record<number, number> {
  const picked: Record<number, number> = {};
  for (const month of plan.months) {
    if (month.isPinned) picked[month.month] = month.budget;
  }
  return picked;
}

export default function YearPlanner() {
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [festivals, setFestivals] = useState<FestivalView[]>([]);
  const [overrides, setOverrides] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<number>(CURRENT_MONTH);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commitTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    getBootstrap()
      .then((data) => {
        if (cancelled) return;
        setFestivals(data.festivals);
        setPlan(data.plan);
        if (data.plan) setOverrides(pickedOverrides(data.plan));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const commit = useCallback(
    (next: Record<number, number>) => {
      setOverrides(next);
      if (!plan) return;

      window.clearTimeout(commitTimer.current);
      commitTimer.current = window.setTimeout(() => {
        void (async () => {
          setSaving(true);
          try {
            const updated = await putOverrides(plan.year, next);
            setPlan(updated);
            setOverrides(pickedOverrides(updated));
            setError(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save that change');
          } finally {
            setSaving(false);
          }
        })();
      }, 160);
    },
    [plan],
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
        if (result.plan) {
          setPlan(result.plan);
          setOverrides(pickedOverrides(result.plan));
        }
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

  const maxBudget = useMemo(
    () => (plan ? Math.max(...plan.months.map((m) => m.budget), 1) : 1),
    [plan],
  );

  const total = useMemo(
    () => (plan ? plan.months.reduce((sum, m) => sum + m.budget, 0) : 0),
    [plan],
  );

  const selectedMonth = plan?.months.find((m) => m.month === selected) ?? null;

  const otherPinnedTotal = useMemo(
    () =>
      Object.entries(overrides)
        .filter(([key]) => Number(key) !== selected)
        .reduce((sum, [, value]) => sum + value, 0),
    [overrides, selected],
  );

  const sliderMax = plan ? Math.max(plan.envelope - otherPinnedTotal, 0) : 0;
  const sliderValue = selectedMonth ? (overrides[selected] ?? selectedMonth.budget) : 0;
  const conserved = plan ? total === plan.envelope : false;

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <div className="h-4 w-40 animate-pulse rounded bg-sage-soft" />
        <div className="mt-6 h-64 animate-pulse rounded-2xl bg-sage-soft/60" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <p className="text-ink-soft">
          No plan yet. {error ?? 'Set up your income to generate one.'}
        </p>
      </div>
    );
  }

  const enabledCount = festivals.filter((f) => f.enabled).length;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-20">
      {/* Header ------------------------------------------------------------ */}
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
        <p className="mt-5 max-w-3xl border-l-2 border-marigold/70 pl-3 text-sm leading-relaxed text-ink-soft">
          {plan.rationale}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-clay/30 bg-clay/10 px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}

      {/* Chart ------------------------------------------------------------- */}
      <section className="mt-8 rounded-2xl border border-sage-line bg-white/70 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Monthly budget</h2>
          <p className="text-xs text-ink-soft">
            Dashed line = flat-month average of {formatINR(plan.monthlyBase)}
            {saving && <span className="ml-2 text-sage">saving…</span>}
          </p>
        </div>

        <div className="relative mt-8">
          {/* Flat-month reference */}
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-soft/35"
            style={{ bottom: `${(plan.monthlyBase / maxBudget) * 100 * 0.78 + 2.2}rem` }}
          />

          <div className="flex items-end gap-1 sm:gap-2">
            {plan.months.map((month) => {
              const heightPct = Math.max((month.budget / maxBudget) * 78, 4); // % of 16rem (h-64)
              const isSelected = month.month === selected;
              const isPeak = month.budget === maxBudget;
              const isCurrent = month.month === CURRENT_MONTH && plan.year === CURRENT_YEAR;

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
                    {formatCompact(month.budget)}
                  </span>

                  <div className="flex h-64 w-full items-end">
                    <div
                      className={[
                        'w-full rounded-t-md transition-all duration-200',
                        isPeak ? 'bg-marigold' : 'bg-sage/80',
                        isSelected ? 'ring-2 ring-ink/40 ring-offset-1 ring-offset-white' : '',
                        isCurrent ? 'outline outline-1 outline-offset-2 outline-marigold/60' : '',
                      ].join(' ')}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>

                  <span
                    className={`mt-2 text-[10px] font-medium sm:text-[11px] ${
                      isSelected ? 'text-ink' : 'text-ink-soft'
                    }`}
                  >
                    {MONTH_SHORT[month.month - 1]}
                  </span>

                  {month.contributions.length > 0 && (
                    <span
                      className="mt-1 size-1 rounded-full bg-marigold"
                      title={month.contributions.map((c) => `${c.name} +${c.multiplier}`).join(', ')}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Conservation footer — the claim, stated plainly */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-sage-line/70 pt-4">
          <p className="text-sm text-ink-soft">
            <span className="font-semibold tabular-nums text-ink">{formatINR(total)}</span> across 12
            months
          </p>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
              conserved
                ? 'border-sage-line bg-sage-soft text-sage'
                : 'border-clay/30 bg-clay/10 text-clay'
            }`}
          >
            <span className={`size-1.5 rounded-full ${conserved ? 'bg-sage' : 'bg-clay'}`} />
            {conserved ? 'annual total unchanged' : 'total drifted'}
          </span>
        </div>
      </section>

      {/* Detail + festivals ------------------------------------------------- */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-sage-line bg-white/70 p-6 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">
                {MONTH_LONG[selected - 1]} {plan.year}
              </h2>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
                {formatINR(selectedMonth?.budget ?? 0)}
              </p>
            </div>
            <span className="rounded-full border border-sage-line bg-paper-dim px-3 py-1 text-xs font-medium text-ink-soft">
              weight {formatMultiplier(selectedMonth?.weight ?? 1)}
            </span>
          </div>

          {selectedMonth && selectedMonth.contributions.length > 0 ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {selectedMonth.contributions.map((c) => (
                <li
                  key={c.name}
                  className="rounded-full border border-sage-line bg-paper px-2.5 py-1 text-xs text-ink-soft"
                >
                  {c.name}{' '}
                  <span className="font-medium text-sage">+{c.multiplier.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-xs text-ink-soft">
              No festivals this month — it stays at the 1.00× baseline and funds the heavier months.
            </p>
          )}

          <label className="mt-6 block text-xs font-medium text-ink-soft" htmlFor="month-budget">
            Pin {MONTH_LONG[selected - 1]} to a custom amount
          </label>
          <input
            id="month-budget"
            type="range"
            min={0}
            max={sliderMax}
            step={10_000}
            value={Math.min(sliderValue, sliderMax)}
            onChange={(event) => commit({ ...overrides, [selected]: Number(event.target.value) })}
            className="mt-2 w-full accent-[#2F5D50]"
          />
          <div className="mt-1 flex justify-between text-[11px] text-ink-soft">
            <span>₹0</span>
            <span>{formatINR(sliderMax)}</span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {selectedMonth?.isPinned && (
              <button
                type="button"
                onClick={() => {
                  const next = { ...overrides };
                  delete next[selected];
                  commit(next);
                }}
                className="rounded-lg border border-sage-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-paper-dim"
              >
                Unpin this month
              </button>
            )}
            {Object.keys(overrides).length > 0 && (
              <button
                type="button"
                onClick={() => commit({})}
                className="rounded-lg border border-sage-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-paper-dim"
              >
                Reset all to festival weights
              </button>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-sage-line bg-white/70 p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-ink">Your festivals</h2>
            <span className="text-xs text-ink-soft">
              {enabledCount}/{festivals.length} on
            </span>
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
                    onChange={(event) => void toggleFestival(festival.id, event.target.checked)}
                    className="size-3.5 accent-[#2F5D50]"
                  />
                  <span className="w-9 shrink-0 text-[11px] text-ink-soft">
                    {MONTH_SHORT[festival.month - 1]}
                  </span>
                  <span className="flex-1 truncate text-xs text-ink">{festival.name}</span>
                  <span className="text-[11px] tabular-nums text-ink-soft">
                    +{festival.multiplier.toFixed(2)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
