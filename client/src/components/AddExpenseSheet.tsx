import { useState } from 'react';
import { formatINR } from '../lib/format';
import { toast } from '../lib/toast';
import type { AddExpenseResult } from '../lib/api';

interface AddExpenseSheetProps {
  onAdded: (result: AddExpenseResult) => void;
  onClose: () => void;
}

async function submitExpense(body: object): Promise<AddExpenseResult> {
  const res = await fetch('/api/expenses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  return (await res.json()) as AddExpenseResult;
}

export function AddExpenseSheet({ onAdded, onClose }: AddExpenseSheetProps) {
  const [mode, setMode] = useState<'quick' | 'paste'>('quick');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick-add fields
  const [amountStr, setAmountStr] = useState('');
  const [merchant, setMerchant] = useState('');
  const [note, setNote] = useState('');

  // Paste-text field
  const [rawText, setRawText] = useState('');

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    const rupees = parseFloat(amountStr);
    if (!rupees || rupees <= 0) return;

    setLoading(true);
    setError(null);
    try {
      const result = await submitExpense({
        amount: Math.round(rupees * 100),
        merchantRaw: merchant,
        merchantClean: merchant,
        note,
        source: 'MANUAL',
      });
      onAdded(result);
      showToast(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handlePaste(e: React.FormEvent) {
    e.preventDefault();
    if (!rawText.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const result = await submitExpense({ rawText, source: 'SHARE' });
      onAdded(result);
      showToast(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Add expense"
    >
      <div
        className="absolute inset-0 bg-ink/20 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg rounded-t-3xl border border-sage-line bg-paper p-6 shadow-xl sm:rounded-3xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Log expense</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-soft hover:bg-paper-dim"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Mode tabs */}
        <div className="mt-4 flex gap-1 rounded-xl bg-paper-dim p-1">
          {(['quick', 'paste'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                'flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors',
                mode === m
                  ? 'bg-white text-ink shadow-sm'
                  : 'text-ink-soft hover:text-ink',
              ].join(' ')}
            >
              {m === 'quick' ? 'Quick add' : 'Paste receipt'}
            </button>
          ))}
        </div>

        {/* Quick add */}
        {mode === 'quick' && (
          <form onSubmit={(e) => void handleQuickAdd(e)} className="mt-5 space-y-3">
            <div>
              <label className="text-xs font-medium text-ink-soft" htmlFor="amount">
                Amount (₹)
              </label>
              <input
                id="amount"
                type="number"
                min="1"
                step="1"
                placeholder="540"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                required
                className="mt-1 w-full rounded-xl border border-sage-line bg-white px-3 py-2.5 text-sm text-ink placeholder-ink-soft/50 focus:border-sage focus:outline-none focus:ring-1 focus:ring-sage"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-soft" htmlFor="merchant">
                Where (Swiggy, Kirana, etc.)
              </label>
              <input
                id="merchant"
                type="text"
                placeholder="Swiggy"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                className="mt-1 w-full rounded-xl border border-sage-line bg-white px-3 py-2.5 text-sm text-ink placeholder-ink-soft/50 focus:border-sage focus:outline-none focus:ring-1 focus:ring-sage"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-soft" htmlFor="note">
                Note (optional)
              </label>
              <input
                id="note"
                type="text"
                placeholder="Team lunch"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-xl border border-sage-line bg-white px-3 py-2.5 text-sm text-ink placeholder-ink-soft/50 focus:border-sage focus:outline-none focus:ring-1 focus:ring-sage"
              />
            </div>
            {error && <p className="text-xs text-clay">{error}</p>}
            <button
              type="submit"
              disabled={loading || !amountStr}
              className="mt-2 w-full rounded-xl bg-sage py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            >
              {loading ? 'Logging…' : 'Log expense'}
            </button>
          </form>
        )}

        {/* Paste receipt */}
        {mode === 'paste' && (
          <form onSubmit={(e) => void handlePaste(e)} className="mt-5 space-y-3">
            <div>
              <label className="text-xs font-medium text-ink-soft" htmlFor="rawText">
                Paste your UPI SMS or any payment text
              </label>
              <textarea
                id="rawText"
                rows={5}
                placeholder={`e.g. "Paid ₹540 to Swiggy on 24-Oct via UPI (Ref: 12345)"`}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                required
                className="mt-1 w-full resize-none rounded-xl border border-sage-line bg-white px-3 py-2.5 text-sm text-ink placeholder-ink-soft/50 focus:border-sage focus:outline-none focus:ring-1 focus:ring-sage"
              />
            </div>
            <p className="text-[11px] text-ink-soft">
              AI reads the amount, merchant, and category from the text. Nothing is stored until you confirm.
            </p>
            {error && <p className="text-xs text-clay">{error}</p>}
            <button
              type="submit"
              disabled={loading || !rawText.trim()}
              className="mt-2 w-full rounded-xl bg-sage py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            >
              {loading ? 'Parsing…' : 'Parse & log'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function showToast(result: AddExpenseResult) {
  const { expense, monthly } = result;
  const fmt = (p: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: 'INR', maximumFractionDigits: 0,
    }).format(Math.round(p) / 100);

  const merchant = expense.merchantClean || expense.merchantRaw || 'expense';
  const type = monthly.status === 'over_budget' ? 'error'
    : monthly.status === 'ahead_of_pace' ? 'warn'
    : 'success';

  toast(`${fmt(expense.amount)} at ${merchant}  ·  ${monthly.toastLine}`, type);
}
