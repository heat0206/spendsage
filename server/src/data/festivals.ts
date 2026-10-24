/**
 * Festival catalogue for the 2026–27 planning year.
 *
 * DESIGN NOTES
 *  * Month-level, not date-level. A monthly budget planner does not need day
 *    precision, and pretending to precise dates across regions invites errors.
 *  * Multipliers are ADDITIVE against a baseline of 1.0 (see buildWeightTable).
 *  * These are PLAN defaults, not measurements. The AI layer (AI-2) adjusts
 *    them per user; this table is also the deterministic fallback.
 *  * Month assignments are planning-year specific: Diwali falls in Nov 2026 but
 *    Oct 2027. Refresh this table per year — do not compute it.
 *  * The monthly sums here intentionally reproduce the weight table in the
 *    build plan, so the worked example and tests stay stable.
 */

export interface FestivalDef {
  name: string;
  /** 1–12 */
  month: number;
  /** Additive against a 1.0 baseline. 0.10 => that month costs 10% more. */
  multiplier: number;
  categoryAffinity: string[];
  region?: string;
  note?: string;
}

export const FESTIVALS_2026: FestivalDef[] = [
  // January — weight 1.10
  {
    name: 'Makar Sankranti / Pongal',
    month: 1,
    multiplier: 0.05,
    categoryAffinity: ['Food', 'Travel'],
    region: 'pan-india',
  },
  {
    name: 'New Year',
    month: 1,
    multiplier: 0.05,
    categoryAffinity: ['Travel', 'Food', 'Entertainment'],
    region: 'pan-india',
  },

  // February — weight 1.08
  {
    name: 'Wedding season',
    month: 2,
    multiplier: 0.08,
    categoryAffinity: ['Travel', 'Gifts', 'Clothing'],
    region: 'pan-india',
    note: 'Season spans Nov–Feb; weight is split across months rather than applied once.',
  },

  // March — weight 1.10
  {
    name: 'Holi',
    month: 3,
    multiplier: 0.1,
    categoryAffinity: ['Food', 'Clothing'],
    region: 'north',
  },

  // April — weight 1.15
  {
    name: 'Akshaya Tritiya',
    month: 4,
    multiplier: 0.08,
    categoryAffinity: ['Gold', 'Gifts'],
    region: 'pan-india',
  },
  {
    name: 'Gudi Padwa / Ugadi',
    month: 4,
    multiplier: 0.07,
    categoryAffinity: ['Food', 'Home'],
    region: 'west-south',
  },

  // August — weight 1.15
  {
    name: 'Raksha Bandhan',
    month: 8,
    multiplier: 0.1,
    categoryAffinity: ['Gifts', 'Food'],
    region: 'north-west',
  },
  {
    name: 'Janmashtami',
    month: 8,
    multiplier: 0.05,
    categoryAffinity: ['Food', 'Home'],
    region: 'pan-india',
  },

  // September — weight 1.15
  {
    name: 'Ganesh Chaturthi',
    month: 9,
    multiplier: 0.07,
    categoryAffinity: ['Food', 'Home'],
    region: 'west',
  },
  {
    name: 'Onam',
    month: 9,
    multiplier: 0.08,
    categoryAffinity: ['Food', 'Clothing'],
    region: 'south',
  },

  // October — weight 1.20
  {
    name: 'Navratri / Durga Puja',
    month: 10,
    multiplier: 0.15,
    categoryAffinity: ['Food', 'Clothing', 'Entertainment'],
    region: 'pan-india',
  },
  {
    name: 'Dussehra',
    month: 10,
    multiplier: 0.05,
    categoryAffinity: ['Food', 'Travel'],
    region: 'pan-india',
  },

  // November — weight 1.45 (the biggest month of the year)
  {
    name: 'Diwali',
    month: 11,
    multiplier: 0.38,
    categoryAffinity: ['Gifts', 'Sweets', 'Home', 'Clothing'],
    region: 'pan-india',
  },
  {
    name: 'Bhai Dooj',
    month: 11,
    multiplier: 0.07,
    categoryAffinity: ['Gifts', 'Food'],
    region: 'north',
  },

  // December — weight 1.25
  {
    name: 'Christmas',
    month: 12,
    multiplier: 0.1,
    categoryAffinity: ['Gifts', 'Food', 'Entertainment'],
    region: 'pan-india',
  },
  {
    name: "New Year's Eve",
    month: 12,
    multiplier: 0.15,
    categoryAffinity: ['Travel', 'Entertainment', 'Food'],
    region: 'pan-india',
  },
];

/**
 * Festivals that do not belong to the fixed catalogue but are commonly
 * budget-relevant in India. Surfaced in onboarding as "you may also want to add".
 */
export const SUGGESTED_EXTRA_EVENTS = [
  'Eid al-Fitr',
  'Eid al-Adha',
  'Baisakhi',
  'Bihu',
  'Chhath Puja',
  'Muharram',
  'Christmas Eve dinner',
  'Family wedding',
  'Annual family trip',
];
