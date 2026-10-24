import { describe, expect, it } from 'vitest';
import { FESTIVALS_2026 } from '../data/festivals.js';
import { toPaise } from '../lib/money.js';
import {
  allocateAnnual,
  allocateExact,
  annualEnvelope,
  applyOverrides,
  buildWeightTable,
  closeMonth,
  effectiveBudget,
  monthlyBase,
  MONTHS_IN_YEAR,
  pace,
  type BudgetInputs,
} from './budgetEngine.js';

// The worked example from the build plan: ₹60,000 take-home, ₹20,000 fixed,
// ₹10,000 savings floor => ₹3,60,000 discretionary envelope.
const income: BudgetInputs = {
  monthlyTakeHome: toPaise(60_000),
  fixedCommitments: toPaise(20_000),
  savingsFloor: toPaise(10_000),
};

const weights = buildWeightTable(FESTIVALS_2026);
const envelope = annualEnvelope(income);
const plan = allocateAnnual(envelope, weights);

describe('envelope', () => {
  it('is 12 x (take-home - fixed - savings)', () => {
    expect(monthlyBase(income)).toBe(toPaise(30_000));
    expect(envelope).toBe(toPaise(3_60_000));
    expect(envelope).toBe(toPaise(30_000) * MONTHS_IN_YEAR);
  });

  it('throws when commitments plus savings exceed take-home', () => {
    expect(() =>
      annualEnvelope({
        monthlyTakeHome: toPaise(30_000),
        fixedCommitments: toPaise(20_000),
        savingsFloor: toPaise(15_000),
      }),
    ).toThrow(/exceed take-home/);
  });
});

describe('weights', () => {
  it('reproduces the weight table from the plan', () => {
    const byMonth = new Map(weights.map((m) => [m.month, m.weight]));

    expect(byMonth.get(1)).toBeCloseTo(1.1, 10);
    expect(byMonth.get(2)).toBeCloseTo(1.08, 10);
    expect(byMonth.get(3)).toBeCloseTo(1.1, 10);
    expect(byMonth.get(4)).toBeCloseTo(1.15, 10);
    expect(byMonth.get(5)).toBeCloseTo(1.0, 10);
    expect(byMonth.get(6)).toBeCloseTo(1.0, 10);
    expect(byMonth.get(7)).toBeCloseTo(1.0, 10);
    expect(byMonth.get(8)).toBeCloseTo(1.15, 10);
    expect(byMonth.get(9)).toBeCloseTo(1.15, 10);
    expect(byMonth.get(10)).toBeCloseTo(1.2, 10);
    expect(byMonth.get(11)).toBeCloseTo(1.45, 10);
    expect(byMonth.get(12)).toBeCloseTo(1.25, 10);
  });

  it('totals 13.63', () => {
    const total = weights.reduce((sum, m) => sum + m.weight, 0);
    expect(total).toBeCloseTo(13.63, 10);
  });

  it('gives every month a baseline of 1.0 when nothing is selected', () => {
    const bare = buildWeightTable([]);
    expect(bare).toHaveLength(MONTHS_IN_YEAR);
    expect(bare.every((m) => m.weight === 1)).toBe(true);
  });

  it('attributes each festival to exactly one month', () => {
    const attributed = weights.flatMap((m) => m.contributions);
    expect(attributed).toHaveLength(FESTIVALS_2026.length);
    expect(attributed.map((c) => c.name)).toContain('Diwali');
    expect(weights.find((m) => m.month === 11)?.contributions.map((c) => c.name)).toEqual([
      'Diwali',
      'Bhai Dooj',
    ]);
  });
});

describe('allocation', () => {
  it('conserves the envelope exactly', () => {
    const sum = plan.months.reduce((s, m) => s + m.budget, 0);
    expect(sum).toBe(envelope);
  });

  it('conserves the envelope exactly even for awkward amounts', () => {
    for (const awkward of [toPaise(3_60_000) + 1, 999_999, 1, 12_345_679]) {
      const result = allocateAnnual(awkward, weights);
      const sum = result.months.reduce((s, m) => s + m.budget, 0);
      expect(sum).toBe(awkward);
    }
  });

  it('gives November more than June, matching the worked example', () => {
    const nov = plan.months.find((m) => m.month === 11)!;
    const jun = plan.months.find((m) => m.month === 6)!;

    // 360000 * 1.45 / 13.63 = 38297.87 ; 360000 * 1.0 / 13.63 = 26412.33
    expect(Math.abs(nov.budget - toPaise(38_297.87))).toBeLessThanOrEqual(2);
    expect(Math.abs(jun.budget - toPaise(26_412.33))).toBeLessThanOrEqual(2);
    expect(nov.budget - jun.budget).toBeGreaterThan(toPaise(11_000));
  });

  it('splits evenly when no festivals are selected', () => {
    const flat = allocateAnnual(envelope, buildWeightTable([]));
    const budgets = flat.months.map((m) => m.budget);
    expect(Math.max(...budgets) - Math.min(...budgets)).toBeLessThanOrEqual(1);
    expect(budgets.reduce((a, b) => a + b, 0)).toBe(envelope);
  });

  it('rejects negative envelopes', () => {
    expect(() => allocateAnnual(-1, weights)).toThrow(/negative/);
  });
});

describe('allocateExact', () => {
  it('never loses or invents a paise', () => {
    for (const amount of [1, 7, 100, 12_345_677, 36_000_001]) {
      const parts = allocateExact(amount, [1.1, 1.0, 1.45, 0.93]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(amount);
      expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
    }
  });

  it('rejects non-integer amounts', () => {
    expect(() => allocateExact(10.5, [1, 1])).toThrow(/integer/);
  });
});

describe('overrides', () => {
  it('pins a month and keeps the annual total fixed', () => {
    const pinned = applyOverrides(plan, new Map([[11, toPaise(45_000)]]));

    expect(pinned.months.find((m) => m.month === 11)!.budget).toBe(toPaise(45_000));
    expect(pinned.months.reduce((s, m) => s + m.budget, 0)).toBe(envelope);

    // November went up, so the other months must have come down.
    const novBefore = plan.months.find((m) => m.month === 11)!.budget;
    expect(pinned.months.find((m) => m.month === 11)!.budget).toBeGreaterThan(novBefore);
    expect(pinned.months.find((m) => m.month === 6)!.budget).toBeLessThan(
      plan.months.find((m) => m.month === 6)!.budget,
    );
  });

  it('handles multiple pinned months', () => {
    const pinned = applyOverrides(
      plan,
      new Map([
        [11, toPaise(45_000)],
        [6, toPaise(20_000)],
      ]),
    );
    expect(pinned.months.reduce((s, m) => s + m.budget, 0)).toBe(envelope);
    expect(pinned.months.find((m) => m.month === 11)!.budget).toBe(toPaise(45_000));
    expect(pinned.months.find((m) => m.month === 6)!.budget).toBe(toPaise(20_000));
  });

  it('refuses overrides that exceed the envelope', () => {
    expect(() => applyOverrides(plan, new Map([[1, toPaise(4_00_000)]]))).toThrow(
      /exceeds the annual envelope/,
    );
  });

  it('refuses negative overrides', () => {
    expect(() => applyOverrides(plan, new Map([[1, -1]]))).toThrow(/negative/);
  });
});

describe('month close (50/50 rule)', () => {
  it('splits an underspend in half', () => {
    const result = closeMonth(toPaise(30_000), toPaise(20_000));
    expect(result.unspent).toBe(toPaise(10_000));
    expect(result.vaultDeposit).toBe(toPaise(5_000));
    expect(result.carryIn).toBe(toPaise(5_000));
  });

  it('never creates or loses money when splitting', () => {
    for (const spent of [0, 1, 9_999, 20_001, 29_999]) {
      const result = closeMonth(toPaise(30_000), spent);
      expect(result.carryIn + result.vaultDeposit).toBe(result.unspent);
    }
  });

  it('carries the whole deficit when overspent', () => {
    const result = closeMonth(toPaise(30_000), toPaise(32_000));
    expect(result.unspent).toBe(toPaise(-2_000));
    expect(result.carryIn).toBe(toPaise(-2_000));
    expect(result.vaultDeposit).toBe(0);
  });

  it('sweeps nothing when exactly on budget', () => {
    const result = closeMonth(toPaise(30_000), toPaise(30_000));
    expect(result.vaultDeposit).toBe(0);
    expect(result.carryIn).toBe(0);
  });

  it('feeds carry-in into next month', () => {
    expect(effectiveBudget(toPaise(26_412), toPaise(5_000))).toBe(toPaise(31_412));
    expect(effectiveBudget(toPaise(26_412), toPaise(-2_000))).toBe(toPaise(24_412));
  });
});

describe('pace', () => {
  const daysInMonth = 30;
  const budget = toPaise(30_000);

  it('is not_started before any spend', () => {
    const result = pace({ effectiveBudget: budget, actualSpend: 0, dayOfMonth: 1, daysInMonth });
    expect(result.status).toBe('not_started');
    expect(result.safeDailySpend).toBe(toPaise(1_000));
    expect(result.daysLeft).toBe(30);
  });

  it('reports on_track when spend lags the calendar', () => {
    const result = pace({
      effectiveBudget: budget,
      actualSpend: toPaise(9_000),
      dayOfMonth: 10,
      daysInMonth,
    });
    expect(result.status).toBe('on_track');
    expect(result.remaining).toBe(toPaise(21_000));
    expect(result.daysLeft).toBe(21);
    expect(result.safeDailySpend).toBe(Math.floor(toPaise(21_000) / 21));
  });

  it('reports ahead_of_pace when spend outruns the calendar', () => {
    const result = pace({
      effectiveBudget: budget,
      actualSpend: toPaise(15_000),
      dayOfMonth: 10,
      daysInMonth,
    });
    expect(result.status).toBe('ahead_of_pace');
    expect(result.willBreach).toBe(true);
    expect(result.projectedSpend).toBe(toPaise(45_000));
  });

  it('reports over_budget once the ceiling is passed', () => {
    const result = pace({
      effectiveBudget: budget,
      actualSpend: toPaise(31_000),
      dayOfMonth: 20,
      daysInMonth,
    });
    expect(result.status).toBe('over_budget');
    expect(result.remaining).toBe(toPaise(-1_000));
    expect(result.safeDailySpend).toBe(0);
  });
});
