import { useEffect, useState } from 'react';

interface Health {
  ok: boolean;
  app: string;
  version: string;
  env: string;
  integrations: { paypal: boolean; gemini: boolean };
}

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

// Illustrative festival weights from the 2026–27 catalogue.
// Phase 2 replaces this with the live plan from /api/plan/:year.
const PREVIEW_WEIGHTS = [1.1, 1.08, 1.1, 1.15, 1.0, 1.0, 1.0, 1.15, 1.15, 1.2, 1.45, 1.25];

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <rect x="2" y="16" width="5" height="10" rx="1.6" fill="#2F5D50" />
        <rect x="10" y="11" width="5" height="15" rx="1.6" fill="#2F5D50" />
        <rect x="18" y="4" width="5" height="22" rx="1.6" fill="#E8A33D" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight text-ink">SpendSage</span>
    </div>
  );
}

function Chip({ label, ok, pending }: { label: string; ok: boolean; pending?: boolean }) {
  const tone = pending
    ? 'border-sage-line bg-paper-dim text-ink-soft'
    : ok
      ? 'border-sage-line bg-sage-soft text-sage'
      : 'border-clay/25 bg-clay/10 text-clay';

  const dot = pending ? 'bg-ink-soft/40' : ok ? 'bg-sage' : 'bg-clay';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tone}`}
    >
      <span className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`API returned ${res.status}`))))
      .then((data: Health) => {
        if (!cancelled) setHealth(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <Wordmark />
        <span className="rounded-full border border-sage-line bg-paper-dim px-3 py-1 text-xs font-medium text-ink-soft">
          v{health?.version ?? '0.1.0'} · scaffold
        </span>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 pb-16">
        <div className="mt-10 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sage">
            Festival-aware money planning
          </p>
          <h1 className="mt-3 text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
            Budget the year,
            <br />
            not the month.
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink-soft">
            November costs more than June. SpendSage builds a twelve-month plan where festival months
            get the room they need and lean months give it up — so the year still adds up.
          </p>
        </div>

        <section
          className="mt-12 rounded-2xl border border-sage-line bg-white/60 p-6 shadow-[0_1px_2px_rgba(20,32,28,0.04)]"
          aria-label="Festival weighting preview"
        >
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-ink">Monthly weighting</h2>
            <span className="text-xs text-ink-soft">illustrative · 2026–27</span>
          </div>

          <div className="mt-6 flex gap-1.5 sm:gap-2.5">
            {PREVIEW_WEIGHTS.map((weight, index) => {
              const heightPct = ((weight - 1) / 0.45) * 45 + 55;
              const isPeak = weight === Math.max(...PREVIEW_WEIGHTS);
              return (
                <div key={index} className="flex flex-1 flex-col items-center">
                  {/* The bar needs a parent with a DEFINITE height for a percentage
                      height to resolve. Against an auto-height flex child it collapses
                      to zero. `h-32` + `items-end` gives us that. */}
                  <div className="flex h-32 w-full items-end">
                    <div
                      className={`w-full rounded-t-md transition-all ${
                        isPeak ? 'bg-marigold' : 'bg-sage/85'
                      }`}
                      style={{ height: `${heightPct}%` }}
                      title={`Weight ${weight.toFixed(2)}`}
                    />
                  </div>
                  <span className="mt-2 text-[10px] font-medium text-ink-soft">
                    {MONTH_LABELS[index]}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="mt-5 text-xs leading-relaxed text-ink-soft">
            Diwali month at 1.45×, lean months at 1.00×. The annual total is held constant — the
            weighted months are funded by the lean ones, not by extra money.
          </p>
        </section>

        <section className="mt-6 flex flex-wrap items-center gap-2" aria-label="System status">
          {error ? (
            <Chip label={`API unreachable — ${error}`} ok={false} />
          ) : health ? (
            <>
              <Chip label={`API ${health.env}`} ok={true} />
              <Chip
                label={health.integrations.paypal ? 'PayPal configured' : 'PayPal not configured'}
                ok={health.integrations.paypal}
              />
              <Chip
                label={health.integrations.gemini ? 'Gemini configured' : 'Gemini not configured'}
                ok={health.integrations.gemini}
              />
            </>
          ) : (
            <Chip label="Connecting to API…" ok={false} pending />
          )}
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-6 pb-8 text-xs text-ink-soft/70">
        SpendSage · PayPal AI Hackathon · sandbox only
      </footer>
    </div>
  );
}
