import YearPlanner from './screens/YearPlanner';

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true">
        <rect x="2" y="16" width="5" height="10" rx="1.6" fill="#2F5D50" />
        <rect x="10" y="11" width="5" height="15" rx="1.6" fill="#2F5D50" />
        <rect x="18" y="4" width="5" height="22" rx="1.6" fill="#E8A33D" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight text-ink">SpendSage</span>
    </div>
  );
}

export default function App() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Wordmark />
        <span className="rounded-full border border-sage-line bg-paper-dim px-3 py-1 text-xs font-medium text-ink-soft">
          demo account · sandbox
        </span>
      </header>

      <main className="flex-1">
        <YearPlanner />
      </main>

      <footer className="mx-auto w-full max-w-5xl px-6 pb-8 text-xs text-ink-soft/70">
        SpendSage · PayPal AI Hackathon · sandbox only
      </footer>
    </div>
  );
}
