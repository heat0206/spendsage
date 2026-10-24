/**
 * Money helpers.
 *
 * Everything in SpendSage is stored and computed in PAISE (integer).
 * Floats are only used at the formatting edge or for ratios.
 */

export const PAISE_PER_RUPEE = 100;

/** Rupees (possibly fractional) -> paise. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * PAISE_PER_RUPEE);
}

/** Paise -> rupees (may be fractional; use only for display or ratios). */
export function fromPaise(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

export function formatINR(paise: number, options: { decimals?: boolean } = {}): string {
  const digits = options.decimals ? 2 : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(paise / PAISE_PER_RUPEE);
}

/** Compact form for tight UI: ₹38.3k, ₹3.6L */
export function formatINRCompact(paise: number): string {
  const rupees = paise / PAISE_PER_RUPEE;
  const abs = Math.abs(rupees);
  if (abs >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(1)}L`;
  if (abs >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}k`;
  return `₹${Math.round(rupees)}`;
}
