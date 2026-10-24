import { Router } from 'express';
import { z } from 'zod';
import { prisma } from './lib/prisma.js';
import {
  ensureFestivalSelections,
  listFestivals,
  setFestivalSelections,
} from './services/festivalService.js';
import { ensureDemoUser, generatePlan, getPlan, setOverrides } from './services/planService.js';

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
