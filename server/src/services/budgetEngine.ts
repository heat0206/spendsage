/**
 * SpendSage budget engine.
 *
 * This module is the core IP of the product and is deliberately:
 *   * PURE      — no I/O, no database, no clock, no network
 *   * AI-FREE   — AI proposes the weights; this file computes the money
 *   * EXACT     — all amounts are integer paise, so the annual total is
 *                 conserved to the last paise, never "close enough"
 *
 * INVARIANT (the one thing to never break):
 *   sum(months[].budget) === envelope
 *
 * If a change breaks that, the Year Planner screen is lying to the user.
 */

export const MONTHS_IN_YEAR = 12;

/** Anything contributing a weight to a month. */
export interface WeightSource {
  name: string;
  /** 1–12 */
  month: number;
  /** Additive against a 1.0 baseline. 0.38 => that month costs 38% more. */
  multiplier: number;
}

export interface BudgetInputs {
  /** Net monthly take-home, paise. */
  monthlyTakeHome: number;
  /** Rent + EMI + utilities + insurance, paise. */
  fixedCommitments: number;
  /** Protected savings floor, paise. */
  savingsFloor: number;
}

export interface WeightContribution {
  name: string;
  multiplier: number;
}

export interface MonthWeight {
  /** 1–12 */
  month: number;
  weight: number;
  contributions: WeightContribution[];
}

export interface MonthAllocation extends MonthWeight {
  /** paise */
  budget: number;
}

export interface AnnualAllocation {
  /** paise */
  envelope: number;
  /** paise — the unweighted average month (S − F − G) */
  monthlyBase: number;
  totalWeight: number;
  months: MonthAllocation[];
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** Discretionary monthly spend before festival weighting, in paise. */
export function monthlyBase(input: BudgetInputs): number {
  return input.monthlyTakeHome - input.fixedCommitments - input.savingsFloor;
}

/**
 * Annual discretionary envelope: 12 × (S − F − G).
 * Savings is removed BEFORE any month is funded, which is what makes it
 * structurally protected: festival spending cannot reach it.
 */
export function annualEnvelope(input: BudgetInputs): number {
  const base = monthlyBase(input);
  if (base < 0) {
    const committed = input.fixedCommitments + input.savingsFloor;
    throw new Error(
      `Fixed commitments plus savings (${committed}) exceed take-home pay (${input.monthlyTakeHome}).`,
    );
  }
  return base * MONTHS_IN_YEAR;
}

// ---------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------

export function buildWeightTable(sources: readonly WeightSource[]): MonthWeight[] {
  const byMonth: MonthWeight[] = [];

  for (let month = 1; month <= MONTHS_IN_YEAR; month++) {
    const contributions = sources
      .filter((source) => source.month === month)
      .map((source) => ({ name: source.name, multiplier: source.multiplier }));

    const total = contributions.reduce((sum, c) => sum + c.multiplier, 0);
    byMonth.push({
      month,
      weight: 1 + total,
      contributions,
    });
  }

  return byMonth;
}

export function totalWeight(table: readonly MonthWeight[]): number {
  return table.reduce((sum, m) => sum + m.weight, 0);
}

// ---------------------------------------------------------------------------
// Allocation — exact integer split
// ---------------------------------------------------------------------------

/**
 * Split `amount` across `weights` proportionally, in integers, such that the
 * parts sum EXACTLY to `amount`.
 *
 * Uses largest-remainder apportionment: floor every share, then hand the
 * leftover paise to the months with the biggest fractional parts. Without this,
 * twelve roundings would leave the Year Planner off by a few paise and the
 * "the total never changes" claim would be visibly false.
 */
export function allocateExact(amount: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(amount)) throw new Error('allocateExact requires an integer amount');
  if (weights.length === 0) throw new Error('allocateExact requires at least one weight');

  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) throw new Error('allocateExact requires a positive total weight');

  const raw = weights.map((w) => (amount * w) / total);
  const parts = raw.map((value) => Math.floor(value));

  let remainder = amount - parts.reduce((sum, p) => sum + p, 0);

  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; i < remainder; i++) {
    parts[order[i % order.length].index] += 1;
  }

  remainder = 0;
  return parts;
}

export function allocateAnnual(
  envelope: number,
  table: readonly MonthWeight[],
  monthlyBaseValue?: number,
): AnnualAllocation {
  if (envelope < 0) throw new Error('Envelope cannot be negative');

  const weights = table.map((m) => m.weight);
  const budgets = allocateExact(envelope, weights);
  const months = table.map((month, index) => ({ ...month, budget: budgets[index] }));

  const sum = months.reduce((s, m) => s + m.budget, 0);
  if (sum !== envelope) {
    // Defensive: this should be unreachable. Better to fail loudly than to
    // ship a planner that silently loses money.
    throw new Error(`Allocation invariant violated: ${sum} !== ${envelope}`);
  }

  return {
    envelope,
    monthlyBase: monthlyBaseValue ?? Math.round(envelope / MONTHS_IN_YEAR),
    totalWeight: totalWeight(table),
    months,
  };
}

// ---------------------------------------------------------------------------
// User overrides — pin months, redistribute the rest, keep the total fixed
// ---------------------------------------------------------------------------

/**
 * Pin one or more months to specific budgets and redistribute the remainder
 * across unpinned months in proportion to their weights.
 *
 * The annual total is preserved exactly. Pinned months are excluded from
 * future renormalisation, which is what lets a user say "November is 45k,
 * figure the rest out" without the engine arguing.
 */
export function applyOverrides(
  plan: AnnualAllocation,
  overrides: ReadonlyMap<number, number>,
): AnnualAllocation {
  for (const [month, amount] of overrides) {
    if (!Number.isInteger(month) || month < 1 || month > MONTHS_IN_YEAR) {
      throw new Error(`Month ${month} is out of range (1–12)`);
    }
    if (!Number.isInteger(amount)) throw new Error(`Override for month ${month} must be integer paise`);
    if (amount < 0) throw new Error(`Override for month ${month} cannot be negative`);
  }

  const pinnedTotal = [...overrides.values()].reduce((sum, v) => sum + v, 0);
  const remaining = plan.envelope - pinnedTotal;

  if (remaining < 0) {
    throw new Error(
      `Pinned months total ${pinnedTotal}, which exceeds the annual envelope of ${plan.envelope}.`,
    );
  }

  const adjustable = plan.months.filter((m) => !overrides.has(m.month));

  if (adjustable.length === 0) {
    if (remaining !== 0) {
      throw new Error('Every month is pinned, so the total cannot be reconciled with the envelope');
    }
    return {
      ...plan,
      months: plan.months.map((m) => ({ ...m, budget: overrides.get(m.month) ?? m.budget })),
    };
  }

  const redistributed = allocateExact(
    remaining,
    adjustable.map((m) => m.weight),
  );
  const byMonth = new Map<number, number>();
  adjustable.forEach((m, i) => byMonth.set(m.month, redistributed[i]));

  const months = plan.months.map((m) => ({
    ...m,
    budget: overrides.get(m.month) ?? byMonth.get(m.month) ?? m.budget,
  }));

  const sum = months.reduce((s, m) => s + m.budget, 0);
  if (sum !== plan.envelope) {
    throw new Error(`Override invariant violated: ${sum} !== ${plan.envelope}`);
  }

  return { ...plan, months };
}

// ---------------------------------------------------------------------------
// Month close — the 50/50 rule
// ---------------------------------------------------------------------------

export interface MonthCloseResult {
  /** paise */
  spent: number;
  /** paise — negative when overspent */
  unspent: number;
  /** paise — added to next month's budget */
  carryIn: number;
  /** paise — swept into the PayPal vault (never negative) */
  vaultDeposit: number;
}

/**
 * Close a month and split the outcome.
 *
 *   underspend: 50% carries into next month, 50% sweeps to the vault
 *   overspend:  the WHOLE deficit carries forward — no discount on debt
 *
 * carryIn + vaultDeposit === unspent always, so nothing is created or lost.
 */
export function closeMonth(effectiveBudget: number, actualSpend: number): MonthCloseResult {
  const unspent = effectiveBudget - actualSpend;

  if (unspent > 0) {
    const vaultDeposit = Math.floor(unspent / 2);
    return { spent: actualSpend, unspent, carryIn: unspent - vaultDeposit, vaultDeposit };
  }

  return { spent: actualSpend, unspent, carryIn: unspent, vaultDeposit: 0 };
}

/** Next month's spending ceiling. */
export function effectiveBudget(plannedBudget: number, carryIn: number): number {
  return plannedBudget + carryIn;
}

// ---------------------------------------------------------------------------
// Pace — "am I going to make it to the end of the month?"
// ---------------------------------------------------------------------------

export type PaceStatus = 'not_started' | 'on_track' | 'ahead_of_pace' | 'over_budget';

export interface PaceInput {
  /** paise */
  effectiveBudget: number;
  /** paise */
  actualSpend: number;
  /** 1-based */
  dayOfMonth: number;
  daysInMonth: number;
  /** Fractional band before "ahead of pace" triggers. Default 0.05. */
  tolerance?: number;
}

export interface PaceResult {
  remaining: number;
  /** days including today */
  daysLeft: number;
  safeDailySpend: number;
  /** 0..1 */
  monthProgress: number;
  /** spend as a fraction of budget; can exceed 1 */
  spentRate: number;
  projectedSpend: number;
  willBreach: boolean;
  status: PaceStatus;
}

export function pace(input: PaceInput): PaceResult {
  const { effectiveBudget: budget, actualSpend, dayOfMonth, daysInMonth } = input;
  const tolerance = input.tolerance ?? 0.05;

  const remaining = budget - actualSpend;
  const daysLeft = Math.max(daysInMonth - dayOfMonth + 1, 0);
  const monthProgress = daysInMonth > 0 ? Math.min(dayOfMonth / daysInMonth, 1) : 0;
  const spentRate = budget > 0 ? actualSpend / budget : 0;
  const safeDailySpend = daysLeft > 0 ? Math.max(Math.floor(remaining / daysLeft), 0) : 0;
  const projectedSpend = dayOfMonth > 0 ? Math.round((actualSpend / dayOfMonth) * daysInMonth) : 0;

  let status: PaceStatus;
  if (remaining < 0) status = 'over_budget';
  else if (actualSpend === 0) status = 'not_started';
  else if (spentRate > monthProgress + tolerance) status = 'ahead_of_pace';
  else status = 'on_track';

  return {
    remaining,
    daysLeft,
    safeDailySpend,
    monthProgress,
    spentRate,
    projectedSpend,
    willBreach: projectedSpend > budget,
    status,
  };
}
