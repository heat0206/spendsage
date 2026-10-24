import { geminiJSON } from './aiService.js';
import { monthName } from './planService.js';

export type SpendingLevel = 'very_high' | 'high' | 'normal' | 'low';

export const SPENDING_LEVEL_LABELS: Record<SpendingLevel, string> = {
  very_high: 'Very High',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

/**
 * Fallback multipliers when Gemini is unavailable.
 * These are relative to the festival-computed baseline weight of a month.
 * e.g. a Diwali month at "Low" still has a higher absolute budget than
 * a plain month at "Very High" — the level is context-relative.
 */
const FALLBACK_SCALE: Record<SpendingLevel, number> = {
  very_high: 1.5,
  high: 1.2,
  normal: 1.0,
  low: 0.75,
};

export interface SpendingLevelResult {
  /** Absolute month weight to feed into the budget engine. */
  weight: number;
  /** One-line plain-English reason shown to the user. */
  reason: string;
  fromFallback: boolean;
}

/**
 * Translate a human spending-level choice into a concrete budget weight
 * for a specific month, taking its festivals into account.
 *
 * The AI produces a weight on a 1.0 baseline (same scale as the festival
 * catalogue). Deterministic fallback scales the festival baseline weight.
 */
export async function resolveSpendingLevel(
  month: number,
  baseWeight: number,
  festivals: string[],
  level: SpendingLevel,
): Promise<SpendingLevelResult> {
  const monthLabel = monthName(month);
  const festivalList =
    festivals.length === 0 ? 'no major festivals' : festivals.join(', ');

  const prompt = `You are a financial planning assistant for India.

Month: ${monthLabel}
Festivals this month: ${festivalList}
Current budget weight (1.0 = flat, higher = more spending expected): ${baseWeight.toFixed(2)}
User's intended spending level: ${SPENDING_LEVEL_LABELS[level]}

The user has chosen "${SPENDING_LEVEL_LABELS[level]}" spending for ${monthLabel}.
Given the festivals present, calculate an appropriate budget weight for this month.

Rules:
- "Normal" should roughly match the festival baseline (around ${baseWeight.toFixed(2)})
- "Very High" allows generous festival spending, "Low" means cutting back even with festivals
- Weight must be between 0.5 and 2.5
- Keep the reason short (one sentence, plain English, no numbers or weights)

Return ONLY valid JSON:
{
  "weight": <number between 0.5 and 2.5>,
  "reason": "<one plain-English sentence>"
}`;

  const fallbackWeight = +(baseWeight * FALLBACK_SCALE[level]).toFixed(4);
  const fallbackReason: Record<SpendingLevel, string> = {
    very_high: `${monthLabel} gets extra room${festivals.length > 0 ? ` for ${festivals[0]}` : ''} — you plan to spend generously.`,
    high: `${monthLabel} has a comfortable budget${festivals.length > 0 ? ` with ${festivals[0]} in mind` : ''}.`,
    normal: `${monthLabel} follows the standard festival-aware plan.`,
    low: `${monthLabel} is trimmed back — savings take priority this month.`,
  };

  const { result, fromFallback } = await geminiJSON<{ weight: number; reason: string }>(
    prompt,
    (raw) => {
      const r = raw as { weight?: unknown; reason?: unknown };
      const weight = typeof r.weight === 'number'
        ? Math.max(0.5, Math.min(2.5, r.weight))
        : fallbackWeight;
      const reason = typeof r.reason === 'string' && r.reason.length > 0
        ? r.reason
        : fallbackReason[level];
      return { weight, reason };
    },
    () => ({ weight: fallbackWeight, reason: fallbackReason[level] }),
  );

  return { ...result, fromFallback };
}
