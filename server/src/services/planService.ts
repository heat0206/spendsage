import { prisma } from '../lib/prisma.js';
import {
  allocateAnnual,
  annualEnvelope,
  applyOverrides,
  buildWeightTable,
  monthlyBase,
  type AnnualAllocation,
  type WeightSource,
} from './budgetEngine.js';
import { getWeightSources } from './festivalService.js';

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
  weight: number;
  budget: number;
  overrideAmount: number | null;
  isPinned: boolean;
  carryIn: number;
  effectiveBudget: number;
  actualSpend: number;
  status: string;
  contributions: { name: string; multiplier: number }[];
}

export interface PlanView {
  id: string;
  year: number;
  envelope: number;
  savingsFloor: number;
  monthlyBase: number;
  totalWeight: number;
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
  const weightsByMonth = new Map(table.map((m) => [m.month, m]));

  return {
    id: plan.id,
    year: plan.year,
    envelope: plan.envelope,
    savingsFloor: plan.savingsFloor,
    monthlyBase: Math.round(plan.envelope / 12),
    totalWeight: table.reduce((sum, m) => sum + m.weight, 0),
    rationale: plan.aiRationale,
    months: plan.months.map((month) => ({
      month: month.month,
      weight: month.weight,
      budget: month.plannedBudget,
      overrideAmount: month.overrideAmount,
      isPinned: month.isPinned,
      carryIn: month.carryIn,
      effectiveBudget: month.effectiveBudget,
      actualSpend: month.actualSpend,
      status: month.status,
      contributions: weightsByMonth.get(month.month)?.contributions ?? [],
    })),
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

  for (const month of allocation.months) {
    const pinned = overrides?.has(month.month) ?? false;

    const data = {
      weight: month.weight,
      multiplierBreakdown: JSON.stringify(month.contributions),
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
