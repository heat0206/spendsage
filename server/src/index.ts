import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { env, hasGemini, hasPayPal } from './env.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'spendsage',
    version: '0.1.0',
    env: env.NODE_ENV,
    time: new Date().toISOString(),
    integrations: {
      paypal: hasPayPal,
      gemini: hasGemini,
    },
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Unexpected error';
  console.error('[server]', err);
  res.status(500).json({ error: message });
});

app.listen(env.PORT, () => {
  console.log(`SpendSage API listening on http://localhost:${env.PORT}`);
  if (!hasPayPal) console.warn('  ! PayPal credentials missing — set them in server/.env');
  if (!hasGemini) console.warn('  ! GEMINI_API_KEY missing — AI features will use fallbacks');
});
