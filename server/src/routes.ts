import { Router } from 'express';
import { z } from 'zod';
import { prisma } from './lib/prisma.js';
import {
  ensureFestivalSelections,
  listFestivals,
  setFestivalSelections,
} from './services/festivalService.js';
import {
  ensureDemoUser,
  generatePlan,
  getPlan,
  resetAllPlan,
  resetMonth,
  setOverrides,
  setSpendingLevel,
} from './services/planService.js';
import { addExpense, listExpenses, getMonthSummary } from './services/expenseService.js';
import { CATEGORIES } from './services/expenseParser.js';
import { SPENDING_LEVEL_LABELS } from './services/spendingLevelService.js';
import type { SpendingLevel } from './services/spendingLevelService.js';

export const router = Router();

const YEAR = () => new Date().getFullYear();

const yearSchema = z.number().int().min(2020).max(2100).optional();

const generateSchema = z.object({
  year: yearSchema,
  monthlyTakeHome: z.number().int().positive(),
  savingsFloor: z.number().int().min(0),
  fixedCommitments: z.number().int().min(0).optional(),
  commitments: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        amount: z.number().int().min(0),
        category: z.string().max(40).optional(),
      }),
    )
    .optional(),
});

const overridesSchema = z.object({
  year: yearSchema,
  overrides: z.record(z.string(), z.number().int().min(0)),
});

const festivalsSchema = z.object({
  enabledIds: z.array(z.string()),
});

const eventSchema = z.object({
  name: z.string().min(1).max(80),
  month: z.number().int().min(1).max(12),
  multiplier: z.number().min(0).max(3),
  categoryAffinity: z.array(z.string().max(40)).max(8).optional(),
});

const addExpenseSchema = z.union([
  z.object({
    rawText: z.string().min(1).max(2000),
    source: z.enum(['MANUAL', 'SHARE', 'DEMO']).optional(),
  }),
  z.object({
    amount: z.number().int().positive(),
    merchantRaw: z.string().max(200).optional(),
    merchantClean: z.string().max(100).optional(),
    category: z.enum(CATEGORIES).optional(),
    occurredAt: z.string().optional(),
    note: z.string().max(300).optional(),
    source: z.enum(['MANUAL', 'SHARE', 'DEMO']).optional(),
  }),
]);

// ---------------------------------------------------------------------------
// Bootstrap: everything the planner needs in one round trip.
// ---------------------------------------------------------------------------
router.get('/bootstrap', async (req, res, next) => {
  try {
    const user = await ensureDemoUser();
    await ensureFestivalSelections(user.id);

    const year = Number(req.query.year) || YEAR();
    let profile = await prisma.profile.findUnique({ where: { userId: user.id } });

    let plan = await getPlan(user.id, year);
    if (!plan && profile) {
      plan = await generatePlan(user.id, {
        year,
        monthlyTakeHome: profile.monthlyTakeHome,
        savingsFloor: profile.savingsFloor,
      });
    }

    profile = await prisma.profile.findUnique({ where: { userId: user.id } });
    const aggregate = await prisma.commitment.aggregate({
      where: { userId: user.id },
      _sum: { amount: true },
    });

    res.json({
      year,
      profile: profile
        ? {
            monthlyTakeHome: profile.monthlyTakeHome,
            savingsFloor: profile.savingsFloor,
            fixedCommitments: aggregate._sum.amount ?? 0,
            cityTier: profile.cityTier,
            householdSize: profile.householdSize,
          }
        : null,
      festivals: await listFestivals(user.id),
      plan,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
router.post('/plan/generate', async (req, res, next) => {
  try {
    const input = generateSchema.parse(req.body);
    const user = await ensureDemoUser();
    const plan = await generatePlan(user.id, {
      year: input.year ?? YEAR(),
      monthlyTakeHome: input.monthlyTakeHome,
      savingsFloor: input.savingsFloor,
      fixedCommitments: input.fixedCommitments,
      commitments: input.commitments,
    });
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.put('/plan/overrides', async (req, res, next) => {
  try {
    const body = overridesSchema.parse(req.body);
    const user = await ensureDemoUser();
    const plan = await setOverrides(user.id, body.year ?? YEAR(), body.overrides);
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

// Set spending level for one month (Very High / High / Normal / Low).
// AI translates the label into a weight; engine rebalances; total stays fixed.
router.put('/plan/spending-level', async (req, res, next) => {
  try {
    const body = z
      .object({
        year: yearSchema,
        month: z.number().int().min(1).max(12),
        level: z.enum(Object.keys(SPENDING_LEVEL_LABELS) as [SpendingLevel, ...SpendingLevel[]]),
      })
      .parse(req.body);

    const user = await ensureDemoUser();
    const plan = await setSpendingLevel(user.id, body.year ?? YEAR(), body.month, body.level);
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.post('/plan/reset-month', async (req, res, next) => {
  try {
    const body = z
      .object({
        year: yearSchema,
        month: z.number().int().min(1).max(12),
      })
      .parse(req.body);

    const user = await ensureDemoUser();
    const plan = await resetMonth(user.id, body.year ?? YEAR(), body.month);
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

router.post('/plan/reset-all', async (req, res, next) => {
  try {
    const body = z.object({ year: yearSchema }).parse(req.body);
    const user = await ensureDemoUser();
    const plan = await resetAllPlan(user.id, body.year ?? YEAR());
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Festivals
// ---------------------------------------------------------------------------
router.get('/festivals', async (_req, res, next) => {
  try {
    const user = await ensureDemoUser();
    await ensureFestivalSelections(user.id);
    res.json({ festivals: await listFestivals(user.id) });
  } catch (err) {
    next(err);
  }
});

router.put('/festivals', async (req, res, next) => {
  try {
    const { enabledIds } = festivalsSchema.parse(req.body);
    const year = Number(req.query.year) || YEAR();
    const user = await ensureDemoUser();

    const changed = await setFestivalSelections(user.id, enabledIds);
    const plan = await regenerate(user.id, year);

    res.json({ changed, plan });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Custom events (weddings, one-off trips)
// ---------------------------------------------------------------------------
router.post('/events', async (req, res, next) => {
  try {
    const body = eventSchema.parse(req.body);
    const year = Number(req.query.year) || YEAR();
    const user = await ensureDemoUser();

    const event = await prisma.customEvent.create({
      data: {
        userId: user.id,
        name: body.name,
        month: body.month,
        multiplier: body.multiplier,
        categoryAffinity: JSON.stringify(body.categoryAffinity ?? []),
      },
    });

    res.status(201).json({ event, plan: await regenerate(user.id, year) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------

/** Recompute weights after the festival set changed. Commitments are untouched. */
async function regenerate(userId: string, year: number) {
  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return null;

  return generatePlan(userId, {
    year,
    monthlyTakeHome: profile.monthlyTakeHome,
    savingsFloor: profile.savingsFloor,
  });
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
router.post('/expenses', async (req, res, next) => {
  try {
    const body = addExpenseSchema.parse(req.body);
    const user = await ensureDemoUser();
    const result = await addExpense(user.id, body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/expenses/parse', async (req, res, next) => {
  try {
    const { rawText } = z.object({ rawText: z.string().min(1).max(2000) }).parse(req.body);
    const user = await ensureDemoUser();
    const result = await addExpense(user.id, { rawText, source: 'SHARE' });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/expenses', async (req, res, next) => {
  try {
    const user = await ensureDemoUser();
    const year = req.query.year ? Number(req.query.year) : undefined;
    const month = req.query.month ? Number(req.query.month) : undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
    const expenses = await listExpenses(user.id, { year, month, limit });
    res.json({ expenses });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
router.get('/dashboard', async (req, res, next) => {
  try {
    const user = await ensureDemoUser();
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;

    const [plan, summary, recent] = await Promise.all([
      getPlan(user.id, year),
      getMonthSummary(user.id, year, month),
      listExpenses(user.id, { year, month, limit: 10 }),
    ]);

    // Category breakdown for the current month
    const expenses = await listExpenses(user.id, { year, month, limit: 500 });
    const byCategory: Record<string, number> = {};
    for (const expense of expenses) {
      byCategory[expense.category] = (byCategory[expense.category] ?? 0) + expense.amount;
    }
    const categories = Object.entries(byCategory)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);

    res.json({ plan, monthly: summary, recent, categories });
  } catch (err) {
    next(err);
  }
});
