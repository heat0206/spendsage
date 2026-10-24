import { useEffect, useRef, useState } from 'react';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'warn' | 'error';
}

let listeners: ((t: Toast) => void)[] = [];
let uid = 0;

export function toast(message: string, type: Toast['type'] = 'success') {
  const id = String(++uid);
  for (const fn of listeners) fn({ id, message, type });
}

export function useToastBus() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (t: Toast) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 5000);
    };
    listeners.push(handler);
    return () => {
      listeners = listeners.filter((fn) => fn !== handler);
    };
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id));

  return { toasts, dismiss };
}

export function ToastContainer() {
  const { toasts, dismiss } = useToastBus();

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            'pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg',
            t.type === 'success'
              ? 'border-sage-line bg-white text-ink'
              : t.type === 'warn'
                ? 'border-marigold/40 bg-marigold/10 text-ink'
                : 'border-clay/30 bg-clay/10 text-clay',
          ].join(' ')}
        >
          <span className="mt-0.5 shrink-0 text-base leading-none">
            {t.type === 'success' ? '✓' : t.type === 'warn' ? '⚡' : '✕'}
          </span>
          <p className="flex-1 text-sm leading-snug">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-ink-soft/60 hover:text-ink-soft"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
