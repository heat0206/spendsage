import { prisma } from '../lib/prisma.js';
import { pace } from './budgetEngine.js';
import { categoriseExpense, parseExpenseText } from './expenseParser.js';

export interface AddExpenseInput {
  /** Paise. Must be positive. */
  amount?: number;
  /** Raw text to parse (UPI receipt paste, quick note). */
  rawText?: string;
  merchantRaw?: string;
  merchantClean?: string;
  category?: string;
  occurredAt?: string;
  note?: string;
  source?: 'MANUAL' | 'SHARE' | 'DEMO';
}

export interface ExpenseView {
  id: string;
  amount: number;
  merchantRaw: string;
  merchantClean: string;
  category: string;
  source: string;
  occurredAt: string;
  note: string;
  aiConfidence: number | null;
  createdAt: string;
}

export interface AddExpenseResult {
  expense: ExpenseView;
  monthly: MonthSummary;
}

export interface MonthSummary {
  month: number;
  year: number;
  effectiveBudget: number;
  actualSpend: number;
  remaining: number;
  daysLeft: number;
  safeDailySpend: number;
  status: string;
  willBreach: boolean;
  /** Human-readable toast line ready for the client. */
  toastLine: string;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export async function addExpense(userId: string, input: AddExpenseInput): Promise<AddExpenseResult> {
  // ----- Parse ---------------------------------------------------------------
  let parsed: {
    amount: number;
    merchantRaw: string;
    merchantClean: string;
    category: string;
    occurredAt: string;
    note: string;
    aiConfidence: number;
  };

  if (input.rawText) {
    parsed = await parseExpenseText(input.rawText);
  } else {
    const amount = input.amount;
    if (!amount || amount <= 0) throw new Error('amount must be a positive integer (paise)');

    let category = input.category ?? 'Other';
    let confidence = 0.0;

    if (!input.category && input.merchantClean) {
      const cat = await categoriseExpense(input.merchantClean, amount);
      category = cat.category;
      confidence = cat.confidence;
    }

    parsed = {
      amount,
      merchantRaw: input.merchantRaw ?? input.merchantClean ?? '',
      merchantClean: input.merchantClean ?? input.merchantRaw ?? '',
      category,
      occurredAt: input.occurredAt ?? new Date().toISOString().split('T')[0]!,
      note: input.note ?? '',
      aiConfidence: confidence,
    };
  }

  if (parsed.amount <= 0) throw new Error('Parsed amount must be positive');

  // ----- Resolve to a month plan ---------------------------------------------
  const occurredDate = new Date(parsed.occurredAt);
  const year = occurredDate.getFullYear();
  const month = occurredDate.getMonth() + 1;

  const annualPlan = await prisma.annualPlan.findUnique({
    where: { userId_year: { userId, year } },
  });

  let monthPlanId: string | null = null;
  if (annualPlan) {
    const mp = await prisma.monthPlan.findUnique({
      where: { annualPlanId_month: { annualPlanId: annualPlan.id, month } },
    });
    if (mp) monthPlanId = mp.id;
  }

  // ----- Persist expense -----------------------------------------------------
  const expense = await prisma.expense.create({
    data: {
      userId,
      monthPlanId,
      amount: parsed.amount,
      merchantRaw: parsed.merchantRaw,
      merchantClean: parsed.merchantClean,
      category: parsed.category,
      source: input.source ?? 'MANUAL',
      occurredAt: occurredDate,
      note: parsed.note,
      aiConfidence: parsed.aiConfidence || null,
    },
  });

  // ----- Update actualSpend on the month plan --------------------------------
  if (monthPlanId) {
    await prisma.monthPlan.update({
      where: { id: monthPlanId },
      data: { actualSpend: { increment: parsed.amount } },
    });
  }

  // ----- Compute pace --------------------------------------------------------
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  let monthly: MonthSummary;

  if (annualPlan && monthPlanId && year === currentYear && month === currentMonth) {
    const mp = await prisma.monthPlan.findUnique({ where: { id: monthPlanId } });

    if (mp) {
      const dayOfMonth = now.getDate();
      const totalDays = daysInMonth(year, month);

      const paceResult = pace({
        effectiveBudget: mp.effectiveBudget,
        actualSpend: mp.actualSpend,
        dayOfMonth,
        daysInMonth: totalDays,
      });

      monthly = buildMonthSummary(month, year, mp.effectiveBudget, mp.actualSpend, paceResult);
    } else {
      monthly = unknownSummary(month, year);
    }
  } else {
    monthly = unknownSummary(month, year);
  }

  return {
    expense: toView(expense),
    monthly,
  };
}

export async function listExpenses(
  userId: string,
  opts: { year?: number; month?: number; limit?: number } = {},
): Promise<ExpenseView[]> {
  const conditions: { userId: string; occurredAt?: { gte: Date; lte: Date } } = { userId };

  if (opts.year && opts.month) {
    const start = new Date(opts.year, opts.month - 1, 1);
    const end = new Date(opts.year, opts.month, 0, 23, 59, 59, 999);
    conditions.occurredAt = { gte: start, lte: end };
  }

  const rows = await prisma.expense.findMany({
    where: conditions,
    orderBy: { occurredAt: 'desc' },
    take: opts.limit ?? 50,
  });

  return rows.map(toView);
}

export async function getMonthSummary(userId: string, year: number, month: number): Promise<MonthSummary> {
  const annualPlan = await prisma.annualPlan.findUnique({
    where: { userId_year: { userId, year } },
  });

  if (!annualPlan) return unknownSummary(month, year);

  const mp = await prisma.monthPlan.findUnique({
    where: { annualPlanId_month: { annualPlanId: annualPlan.id, month } },
  });

  if (!mp) return unknownSummary(month, year);

  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const dayOfMonth = isCurrentMonth ? now.getDate() : daysInMonth(year, month);
  const totalDays = daysInMonth(year, month);

  const paceResult = pace({
    effectiveBudget: mp.effectiveBudget,
    actualSpend: mp.actualSpend,
    dayOfMonth,
    daysInMonth: totalDays,
  });

  return buildMonthSummary(month, year, mp.effectiveBudget, mp.actualSpend, paceResult);
}

// ---------------------------------------------------------------------------

function buildMonthSummary(
  month: number,
  year: number,
  effectiveBudget: number,
  actualSpend: number,
  paceResult: ReturnType<typeof pace>,
): MonthSummary {
  const remaining = paceResult.remaining;
  const fmt = (paise: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
      Math.abs(Math.round(paise)) / 100,
    );

  let toastLine: string;
  if (paceResult.status === 'over_budget') {
    toastLine = `Over budget by ${fmt(Math.abs(remaining))} — you went past the month's ceiling.`;
  } else if (paceResult.status === 'ahead_of_pace') {
    toastLine = `${fmt(remaining)} left · ${fmt(paceResult.safeDailySpend)}/day for ${paceResult.daysLeft} days — you're spending faster than pace.`;
  } else {
    toastLine = `${fmt(remaining)} left · ${fmt(paceResult.safeDailySpend)}/day for ${paceResult.daysLeft} days.`;
  }

  return {
    month,
    year,
    effectiveBudget,
    actualSpend,
    remaining,
    daysLeft: paceResult.daysLeft,
    safeDailySpend: paceResult.safeDailySpend,
    status: paceResult.status,
    willBreach: paceResult.willBreach,
    toastLine,
  };
}

function unknownSummary(month: number, year: number): MonthSummary {
  return {
    month,
    year,
    effectiveBudget: 0,
    actualSpend: 0,
    remaining: 0,
    daysLeft: 0,
    safeDailySpend: 0,
    status: 'unknown',
    willBreach: false,
    toastLine: 'Expense logged.',
  };
}

function toView(expense: {
  id: string;
  amount: number;
  merchantRaw: string;
  merchantClean: string | null;
  category: string;
  source: string;
  occurredAt: Date;
  note: string | null;
  aiConfidence: number | null;
  createdAt: Date;
}): ExpenseView {
  return {
    id: expense.id,
    amount: expense.amount,
    merchantRaw: expense.merchantRaw,
    merchantClean: expense.merchantClean ?? expense.merchantRaw,
    category: expense.category,
    source: expense.source,
    occurredAt: expense.occurredAt.toISOString(),
    note: expense.note ?? '',
    aiConfidence: expense.aiConfidence,
    createdAt: expense.createdAt.toISOString(),
  };
}
