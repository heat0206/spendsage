import { prisma } from '../lib/prisma.js';
import {
  allocateAnnual,
  annualEnvelope,
  applyOverrides,
  buildWeightTable,
  monthlyBase,
  type AnnualAllocation,
} from './budgetEngine.js';
import { getWeightSources } from './festivalService.js';
import { resolveSpendingLevel, type SpendingLevel } from './spendingLevelService.js';

/**
 * Phase 2 has no auth yet, so every request acts as this single demo user,
 * seeded to the profile agreed in the build plan (₹60k take-home, tier-1).
 * Phase 1 replaces `ensureDemoUser()` with the session user — nothing else in
 * this file needs to change.
 */
export const DEMO_USER_EMAIL = 'demo@spendsage.app';

export async function ensureDemoUser() {
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    create: { email: DEMO_USER_EMAIL, passwordHash: 'demo-not-a-real-hash', name: 'Demo Saver' },
    update: {},
  });

  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });

  if (!profile) {
    await prisma.profile.create({
      data: {
        userId: user.id,
        monthlyTakeHome: 60_000_00, // ₹60,000 in paise
        savingsFloor: 10_000_00, // ₹10,000
        cityTier: 'tier1',
        householdSize: 2,
      },
    });

    await prisma.commitment.create({
      data: { userId: user.id, label: 'Rent + bills', amount: 20_000_00, category: 'Housing' },
    });
  }

  return user;
}

export interface CommitmentInput {
  label: string;
  amount: number;
  category?: string;
}

export interface GeneratePlanInput {
  year: number;
  monthlyTakeHome: number;
  savingsFloor: number;
  /** Either itemised commitments or a single total. */
  commitments?: CommitmentInput[];
  fixedCommitments?: number;
}

export interface MonthView {
  month: number;
  budget: number;
  overrideAmount: number | null;
  isPinned: boolean;
  carryIn: number;
  effectiveBudget: number;
  actualSpend: number;
  status: string;
  /** Festival names in this month (no weights or multipliers). */
  festivalNames: string[];
  /** Human spending level chosen by the user, null if using festival default. */
  spendingLevel: SpendingLevel | null;
  /** Plain-English explanation of the budget for this month. */
  spendingReason: string | null;
}

export interface PlanView {
  id: string;
  year: number;
  envelope: number;
  savingsFloor: number;
  monthlyBase: number;
  rationale: string | null;
  months: MonthView[];
}

export async function generatePlan(userId: string, input: GeneratePlanInput): Promise<PlanView> {
  if (input.commitments && input.commitments.length > 0) {
    await prisma.commitment.deleteMany({ where: { userId } });
    for (const commitment of input.commitments) {
      await prisma.commitment.create({
        data: {
          userId,
          label: commitment.label,
          amount: commitment.amount,
          category: commitment.category ?? 'Bills',
        },
      });
    }
  } else if (typeof input.fixedCommitments === 'number') {
    await prisma.commitment.deleteMany({ where: { userId } });
    if (input.fixedCommitments > 0) {
      await prisma.commitment.create({
        data: {
          userId,
          label: 'Fixed commitments',
          amount: input.fixedCommitments,
          category: 'Bills',
        },
      });
    }
  }

  await prisma.profile.upsert({
    where: { userId },
    create: {
      userId,
      monthlyTakeHome: input.monthlyTakeHome,
      savingsFloor: input.savingsFloor,
    },
    update: {
      monthlyTakeHome: input.monthlyTakeHome,
      savingsFloor: input.savingsFloor,
    },
  });

  const fixedCommitments = await sumCommitments(userId);
  const sources = await getWeightSources(userId);

  const envelope = annualEnvelope({
    monthlyTakeHome: input.monthlyTakeHome,
    fixedCommitments,
    savingsFloor: input.savingsFloor,
  });

  const table = buildWeightTable(sources);
  const allocation = allocateAnnual(
    envelope,
    table,
    monthlyBase({
      monthlyTakeHome: input.monthlyTakeHome,
      fixedCommitments,
      savingsFloor: input.savingsFloor,
    }),
  );

  return persistPlan(userId, input.year, allocation);
}

export async function getPlan(userId: string, year: number): Promise<PlanView | null> {
  const plan = await prisma.annualPlan.findUnique({
    where: { userId_year: { userId, year } },
    include: { months: { orderBy: { month: 'asc' } } },
  });

  if (!plan) return null;

  const sources = await getWeightSources(userId);
  const table = buildWeightTable(sources);
  const festivalsByMonth = new Map(table.map((m) => [m.month, m.contributions.map((c) => c.name)]));

  return {
    id: plan.id,
    year: plan.year,
    envelope: plan.envelope,
    savingsFloor: plan.savingsFloor,
    monthlyBase: Math.round(plan.envelope / 12),
    rationale: plan.aiRationale,
    months: plan.months.map((month) => {
      let spendingLevel: SpendingLevel | null = null;
      let spendingReason: string | null = null;

      if (month.multiplierBreakdown) {
        try {
          const parsed = JSON.parse(month.multiplierBreakdown) as {
            spendingLevel?: string;
            spendingReason?: string;
          };
          spendingLevel = (parsed.spendingLevel as SpendingLevel) ?? null;
          spendingReason = parsed.spendingReason ?? null;
        } catch { /* ignore */ }
      }

      return {
        month: month.month,
        budget: month.plannedBudget,
        overrideAmount: month.overrideAmount,
        isPinned: month.isPinned,
        carryIn: month.carryIn,
        effectiveBudget: month.effectiveBudget,
        actualSpend: month.actualSpend,
        status: month.status,
        festivalNames: festivalsByMonth.get(month.month) ?? [],
        spendingLevel,
        spendingReason,
      };
    }),
  };
}

/**
 * Applies a complete override set (not a delta) and repersists.
 * Sending the whole map keeps the client and server from drifting apart.
 */
export async function setOverrides(
  userId: string,
  year: number,
  overrides: Record<string, number>,
): Promise<PlanView> {
  const plan = await prisma.annualPlan.findUnique({
    where: { userId_year: { userId, year } },
    include: { months: { orderBy: { month: 'asc' } } },
  });

  if (!plan) throw new Error(`No plan exists for ${year}`);

  const sources = await getWeightSources(userId);
  const table = buildWeightTable(sources);

  const base = allocateAnnual(plan.envelope, table, Math.round(plan.envelope / 12));
  const parsed = new Map<number, number>();
  for (const [month, amount] of Object.entries(overrides)) {
    const index = Number(month);
    if (!Number.isInteger(index) || index < 1 || index > 12) {
      throw new Error(`Month ${month} is out of range (1–12)`);
    }
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error(`Override for month ${month} must be a non-negative integer (paise)`);
    }
    parsed.set(index, amount);
  }

  const next = applyOverrides(base, parsed);
  return persistPlan(userId, year, next, parsed);
}

/**
 * Set the spending level for one month. AI translates the human label into a
 * weight, the engine rebalances the rest of the year, total stays fixed.
 * Multiple months can each have their own independent spending level.
 */
export async function setSpendingLevel(
  userId: string,
  year: number,
  targetMonth: number,
  level: SpendingLevel,
): Promise<PlanView> {
  const plan = await prisma.annualPlan.findUnique({
    where: { userId_year: { userId, year } },
    include: { months: { orderBy: { month: 'asc' } } },
  });

  if (!plan) throw new Error(`No plan exists for ${year}`);

  const sources = await getWeightSources(userId);
  const table = buildWeightTable(sources);

  // Extract existing spending levels across all months
  const existingMeta = new Map<number, { level: SpendingLevel; reason: string }>();
  for (const mp of plan.months) {
    if (mp.multiplierBreakdown) {
      try {
        const parsed = JSON.parse(mp.multiplierBreakdown) as {
          spendingLevel?: SpendingLevel;
          spendingReason?: string;
        };
        if (parsed.spendingLevel && parsed.spendingReason) {
          existingMeta.set(mp.month, {
            level: parsed.spendingLevel,
            reason: parsed.spendingReason,
          });
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Calculate new weight and reason for the target month
  const targetBaseWeight = table.find((m) => m.month === targetMonth)?.weight ?? 1.0;
  const targetFestivals = table.find((m) => m.month === targetMonth)?.contributions.map((c) => c.name) ?? [];

  const { weight: newWeight, reason } = await resolveSpendingLevel(
    targetMonth,
    targetBaseWeight,
    targetFestivals,
    level,
  );

  existingMeta.set(targetMonth, { level, reason });

  // Build the weight table combining festival baselines and custom spending levels
  const combinedTable = table.map((m) => {
    if (m.month === targetMonth) {
      return { ...m, weight: newWeight };
    }
    const meta = existingMeta.get(m.month);
    if (meta) {
      const existingRow = plan.months.find((r) => r.month === m.month);
      return { ...m, weight: existingRow ? existingRow.weight : m.weight };
    }
    return m;
  });

  const base = allocateAnnual(plan.envelope, combinedTable, Math.round(plan.envelope / 12));

  // Preserve existing pinned months except if targetMonth was pinned (spending level replaces exact pin)
  const existingPins = new Map<number, number>();
  for (const mp of plan.months) {
    if (mp.month !== targetMonth && mp.isPinned && mp.overrideAmount !== null) {
      existingPins.set(mp.month, mp.overrideAmount);
    }
  }

  const final = existingPins.size > 0 ? applyOverrides(base, existingPins) : base;

  return persistPlan(userId, year, final, existingPins.size > 0 ? existingPins : undefined, existingMeta);
}

/**
 * Reset a single month back to standard festival defaults (clears pin and custom spending level).
 */
export async function resetMonth(
  userId: string,
  year: number,
  targetMonth: number,
): Promise<PlanView> {
  const plan = await prisma.annualPlan.findUnique({
    where: { userId_year: { userId, year } },
    include: { months: { orderBy: { month: 'asc' } } },
  });

  if (!plan) throw new Error(`No plan exists for ${year}`);

  const sources = await getWeightSources(userId);
  const table = buildWeightTable(sources);

  // Preserve spending levels of other months
  const remainingMeta = new Map<number, { level: SpendingLevel; reason: string }>();
  for (const mp of plan.months) {
    if (mp.month !== targetMonth && mp.multiplierBreakdown) {
      try {
        const parsed = JSON.parse(mp.multiplierBreakdown) as {
          spendingLevel?: SpendingLevel;
          spendingReason?: string;
        };
        if (parsed.spendingLevel && parsed.spendingReason) {
          remainingMeta.set(mp.month, {
            level: parsed.spendingLevel,
            reason: parsed.spendingReason,
          });
        }
      } catch {
        /* ignore */
      }
    }
  }

  const combinedTable = table.map((m) => {
    if (m.month === targetMonth) return m; // Reset to festival baseline
    const meta = remainingMeta.get(m.month);
    if (meta) {
      const existingRow = plan.months.find((r) => r.month === m.month);
      return { ...m, weight: existingRow ? existingRow.weight : m.weight };
    }
    return m;
  });

  const base = allocateAnnual(plan.envelope, combinedTable, Math.round(plan.envelope / 12));

  // Preserve other pins
  const remainingPins = new Map<number, number>();
  for (const mp of plan.months) {
    if (mp.month !== targetMonth && mp.isPinned && mp.overrideAmount !== null) {
      remainingPins.set(mp.month, mp.overrideAmount);
    }
  }

  const final = remainingPins.size > 0 ? applyOverrides(base, remainingPins) : base;

  // Clear metadata for targetMonth
  await prisma.monthPlan.updateMany({
    where: { annualPlanId: plan.id, month: targetMonth },
    data: { multiplierBreakdown: JSON.stringify({}), overrideAmount: null, isPinned: false },
  });

  return persistPlan(userId, year, final, remainingPins.size > 0 ? remainingPins : undefined, remainingMeta);
}

/**
 * Reset all months back to pure festival plan (clears all pins and all spending levels).
 */
export async function resetAllPlan(userId: string, year: number): Promise<PlanView> {
  const plan = await prisma.annualPlan.findUnique({
    where: { userId_year: { userId, year } },
  });

  if (!plan) throw new Error(`No plan exists for ${year}`);

  const sources = await getWeightSources(userId);
  const table = buildWeightTable(sources);

  const base = allocateAnnual(plan.envelope, table, Math.round(plan.envelope / 12));

  // Clear metadata and pins on all months
  await prisma.monthPlan.updateMany({
    where: { annualPlanId: plan.id },
    data: { multiplierBreakdown: JSON.stringify({}), overrideAmount: null, isPinned: false },
  });

  return persistPlan(userId, year, base, undefined, new Map());
}

// ---------------------------------------------------------------------------

async function sumCommitments(userId: string): Promise<number> {
  const rows = await prisma.commitment.findMany({ where: { userId }, select: { amount: true } });
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

async function persistPlan(
  userId: string,
  year: number,
  allocation: AnnualAllocation,
  overrides?: ReadonlyMap<number, number>,
  spendingLevelMeta?: Map<number, { level: SpendingLevel; reason: string }>,
): Promise<PlanView> {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  const aiRationale = buildRationale(allocation);

  const plan = await prisma.annualPlan.upsert({
    where: { userId_year: { userId, year } },
    create: {
      userId,
      year,
      envelope: allocation.envelope,
      savingsFloor: profile?.savingsFloor ?? 0,
      aiRationale,
    },
    update: {
      envelope: allocation.envelope,
      savingsFloor: profile?.savingsFloor ?? 0,
      aiRationale,
    },
  });

  // Read existing rows so we preserve spending-level metadata on months
  // that aren't being re-written.
  const existingRows = await prisma.monthPlan.findMany({
    where: { annualPlanId: plan.id },
    select: { month: true, multiplierBreakdown: true },
  });
  const existingMeta = new Map(existingRows.map((r) => [r.month, r.multiplierBreakdown]));

  for (const month of allocation.months) {
    const pinned = overrides?.has(month.month) ?? false;
    const levelMeta = spendingLevelMeta?.get(month.month);

    // Preserve existing metadata unless this month is being updated.
    let breakdown: string;
    if (levelMeta) {
      breakdown = JSON.stringify({
        spendingLevel: levelMeta.level,
        spendingReason: levelMeta.reason,
      });
    } else {
      breakdown = existingMeta.get(month.month) ?? JSON.stringify({});
    }

    const data = {
      weight: month.weight,
      multiplierBreakdown: breakdown,
      plannedBudget: month.budget,
      overrideAmount: pinned ? (overrides?.get(month.month) ?? null) : null,
      isPinned: pinned,
      effectiveBudget: month.budget,
    };

    await prisma.monthPlan.upsert({
      where: { annualPlanId_month: { annualPlanId: plan.id, month: month.month } },
      create: { ...data, annualPlanId: plan.id, month: month.month },
      update: data,
    });
  }

  const view = await getPlan(userId, year);
  if (!view) throw new Error('Failed to read back plan after writing');
  return view;
}

function buildRationale(allocation: AnnualAllocation): string {
  const peak = allocation.months.reduce((max, m) => (m.budget > max.budget ? m : max));
  const lean = allocation.months.reduce((min, m) => (m.budget < min.budget ? m : min));
  const peakNames = peak.contributions.map((c) => c.name).join(', ');
  return `Your heaviest month is ${monthName(peak.month)} (${peakNames || 'no festivals'}), funded by ${monthName(
    lean.month,
  )} at ${lean.weight.toFixed(2)}×. The year still totals the same amount.`;
}

export function monthName(month: number): string {
  return [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ][month - 1] ?? `Month ${month}`;
}
