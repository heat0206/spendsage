import { prisma } from '../lib/prisma.js';
import { FESTIVALS_2026 } from '../data/festivals.js';
import type { WeightSource } from './budgetEngine.js';

/**
 * Seeds the festival catalogue. Idempotent — safe to call on every boot.
 * The catalogue is code-owned data (see data/festivals.ts); the database copy
 * exists so users can hold per-festival selections against a stable id.
 */
export async function ensureFestivalCatalogue(): Promise<number> {
  let written = 0;

  for (const festival of FESTIVALS_2026) {
    await prisma.festival.upsert({
      where: { name_month: { name: festival.name, month: festival.month } },
      create: {
        name: festival.name,
        month: festival.month,
        region: festival.region ?? 'pan-india',
        defaultMultiplier: festival.multiplier,
        categoryAffinity: JSON.stringify(festival.categoryAffinity),
        note: festival.note ?? null,
      },
      update: {
        defaultMultiplier: festival.multiplier,
        categoryAffinity: JSON.stringify(festival.categoryAffinity),
        note: festival.note ?? null,
      },
    });
    written += 1;
  }

  return written;
}

/**
 * Every user starts with all festivals enabled; onboarding lets them untick.
 */
export async function ensureFestivalSelections(userId: string): Promise<void> {
  const [festivals, existing] = await Promise.all([
    prisma.festival.findMany({ select: { id: true } }),
    prisma.festivalSelection.findMany({ where: { userId }, select: { festivalId: true } }),
  ]);

  const already = new Set(existing.map((row) => row.festivalId));

  for (const festival of festivals) {
    if (already.has(festival.id)) continue;
    await prisma.festivalSelection.create({
      data: { userId, festivalId: festival.id, enabled: true },
    });
  }
}

export interface FestivalView {
  id: string;
  name: string;
  month: number;
  multiplier: number;
  categoryAffinity: string[];
  region: string;
  enabled: boolean;
  note: string | null;
}

export async function listFestivals(userId: string): Promise<FestivalView[]> {
  const selections = await prisma.festivalSelection.findMany({
    where: { userId },
    include: { festival: true },
  });

  return selections
    .map((selection) => ({
      id: selection.festivalId,
      name: selection.festival.name,
      month: selection.festival.month,
      multiplier: selection.festival.defaultMultiplier,
      categoryAffinity: parseAffinity(selection.festival.categoryAffinity),
      region: selection.festival.region,
      enabled: selection.enabled,
      note: selection.festival.note,
    }))
    .sort((a, b) => a.month - b.month || b.multiplier - a.multiplier);
}

export async function setFestivalSelections(
  userId: string,
  enabledIds: readonly string[],
): Promise<number> {
  const enabled = new Set(enabledIds);
  const selections = await prisma.festivalSelection.findMany({ where: { userId } });

  let changed = 0;
  for (const selection of selections) {
    const shouldEnable = enabled.has(selection.festivalId);
    if (selection.enabled !== shouldEnable) {
      await prisma.festivalSelection.update({
        where: { id: selection.id },
        data: { enabled: shouldEnable },
      });
      changed += 1;
    }
  }

  return changed;
}

/** Enabled festivals + custom events, in the shape the budget engine wants. */
export async function getWeightSources(userId: string): Promise<WeightSource[]> {
  const [selections, events] = await Promise.all([
    prisma.festivalSelection.findMany({
      where: { userId, enabled: true },
      include: { festival: true },
    }),
    prisma.customEvent.findMany({ where: { userId } }),
  ]);

  return [
    ...selections.map((selection) => ({
      name: selection.festival.name,
      month: selection.festival.month,
      multiplier: selection.festival.defaultMultiplier,
    })),
    ...events.map((event) => ({
      name: event.name,
      month: event.month,
      multiplier: event.multiplier,
    })),
  ];
}

function parseAffinity(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
