import { geminiJSON } from './aiService.js';

export const CATEGORIES = [
  'Food',
  'Groceries',
  'Transport',
  'Entertainment',
  'Clothing',
  'Health',
  'Home',
  'Gifts',
  'Travel',
  'Utilities',
  'Education',
  'Personal Care',
  'Subscriptions',
  'Gold',
  'Sweets',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface ParsedExpense {
  amount: number;
  merchantRaw: string;
  merchantClean: string;
  category: Category;
  occurredAt: string;
  note: string;
  aiConfidence: number;
}

const KEYWORD_MAP: Record<string, Category> = {
  swiggy: 'Food',
  zomato: 'Food',
  mcdonald: 'Food',
  domino: 'Food',
  kfc: 'Food',
  pizza: 'Food',
  cafe: 'Food',
  chai: 'Food',
  haldiram: 'Sweets',
  mithai: 'Sweets',
  sweet: 'Sweets',
  bigbasket: 'Groceries',
  blinkit: 'Groceries',
  zepto: 'Groceries',
  dunzo: 'Groceries',
  dmart: 'Groceries',
  reliance: 'Groceries',
  uber: 'Transport',
  ola: 'Transport',
  rapido: 'Transport',
  metro: 'Transport',
  petrol: 'Transport',
  fuel: 'Transport',
  irctc: 'Travel',
  makemytrip: 'Travel',
  goibibo: 'Travel',
  hotel: 'Travel',
  flight: 'Travel',
  netflix: 'Subscriptions',
  spotify: 'Subscriptions',
  prime: 'Subscriptions',
  disney: 'Subscriptions',
  hotstar: 'Subscriptions',
  youtube: 'Subscriptions',
  amazon: 'Other',
  flipkart: 'Clothing',
  myntra: 'Clothing',
  ajio: 'Clothing',
  nykaa: 'Personal Care',
  pharmacy: 'Health',
  hospital: 'Health',
  clinic: 'Health',
  doctor: 'Health',
  electricity: 'Utilities',
  water: 'Utilities',
  gas: 'Utilities',
  rent: 'Home',
};

function keywordCategory(text: string): Category | null {
  const lower = text.toLowerCase();
  for (const [keyword, category] of Object.entries(KEYWORD_MAP)) {
    if (lower.includes(keyword)) return category;
  }
  return null;
}

function extractAmount(text: string): number | null {
  const match = text.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!match || !match[1]) return null;
  return Math.round(parseFloat(match[1].replace(/,/g, '')) * 100);
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0] ?? new Date().toISOString();
}

function validateCategory(raw: unknown): Category {
  if (typeof raw === 'string' && (CATEGORIES as readonly string[]).includes(raw)) {
    return raw as Category;
  }
  return 'Other';
}

interface AIParsedRaw {
  amount?: unknown;
  merchantRaw?: unknown;
  merchantClean?: unknown;
  category?: unknown;
  occurredAt?: unknown;
  note?: unknown;
  aiConfidence?: unknown;
}

/**
 * Parse a freeform expense string (UPI receipt text, quick note) into a
 * structured expense. Tries AI first; falls back to regex + keyword map.
 */
export async function parseExpenseText(raw: string): Promise<ParsedExpense> {
  const today = todayISO();

  const prompt = `You are a financial assistant for an Indian user. Parse this expense text into JSON.

Input: "${raw.slice(0, 600)}"

Return ONLY valid JSON with these exact fields:
{
  "amount": <integer paise, e.g. 54000 for ₹540>,
  "merchantRaw": "<original merchant name from text>",
  "merchantClean": "<cleaned merchant name, title case>",
  "category": "<one of: ${CATEGORIES.join(', ')}>",
  "occurredAt": "<ISO date YYYY-MM-DD, use today ${today} if unclear>",
  "note": "<brief note, empty string if none>",
  "aiConfidence": <0.0 to 1.0>
}`;

  const fallback = (): ParsedExpense => {
    const amount = extractAmount(raw) ?? 0;
    const category = keywordCategory(raw) ?? 'Other';
    return {
      amount,
      merchantRaw: raw.slice(0, 100),
      merchantClean: raw.slice(0, 60),
      category,
      occurredAt: today,
      note: '',
      aiConfidence: 0.3,
    };
  };

  const { result } = await geminiJSON<ParsedExpense>(
    prompt,
    (parsed) => {
      const p = parsed as AIParsedRaw;
      const amount =
        typeof p.amount === 'number' && p.amount > 0 ? Math.round(p.amount) : (extractAmount(raw) ?? 0);

      return {
        amount,
        merchantRaw: String(p.merchantRaw ?? raw.slice(0, 100)),
        merchantClean: String(p.merchantClean ?? raw.slice(0, 60)),
        category: validateCategory(p.category),
        occurredAt: typeof p.occurredAt === 'string' ? p.occurredAt : today,
        note: typeof p.note === 'string' ? p.note : '',
        aiConfidence: typeof p.aiConfidence === 'number' ? Math.max(0, Math.min(1, p.aiConfidence)) : 0.7,
      };
    },
    fallback,
  );

  return result;
}

/**
 * Categorise a single expense where we already have the merchant name.
 */
export async function categoriseExpense(merchantClean: string, amount: number): Promise<{ category: Category; confidence: number }> {
  const kwCategory = keywordCategory(merchantClean);

  const prompt = `Categorise this Indian expense.

Merchant: "${merchantClean}"
Amount: ₹${(amount / 100).toFixed(0)}

Reply with JSON only: { "category": "<one of: ${CATEGORIES.join(', ')}>", "confidence": <0.0 to 1.0> }`;

  const { result } = await geminiJSON<{ category: Category; confidence: number }>(
    prompt,
    (parsed) => {
      const p = parsed as { category?: unknown; confidence?: unknown };
      return {
        category: validateCategory(p.category),
        confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.7,
      };
    },
    () => ({ category: kwCategory ?? 'Other', confidence: kwCategory ? 0.6 : 0.3 }),
  );

  return result;
}
