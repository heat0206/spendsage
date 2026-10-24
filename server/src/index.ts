import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';
import { env, hasGemini, hasPayPal } from './env.js';
import { getAICacheStats } from './services/aiService.js';
import { router } from './routes.js';
import { ensureFestivalCatalogue, ensureFestivalSelections } from './services/festivalService.js';
import { ensureDemoUser } from './services/planService.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'spendsage',
    version: '0.2.0',
    env: env.NODE_ENV,
    time: new Date().toISOString(),
    integrations: {
      paypal: hasPayPal,
      gemini: env.MOCK_AI ? 'mock' : hasGemini,
      mockAi: env.MOCK_AI,
      aiCache: getAICacheStats(),
    },
  });
});

app.use('/api', router);

// In production, Express serves the built client so there's one process and one
// origin (and no CORS). In dev, Vite serves the client and proxies /api here.
const clientDist = path.resolve(process.cwd(), '../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Invalid request', issues: err.issues });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected error';
  console.error('[server]', err);
  res.status(500).json({ error: message });
});

// Warm the catalogue and the demo user before accepting traffic, so the very
// first request from a judge doesn't pay for seeding.
async function bootstrap() {
  const seeded = await ensureFestivalCatalogue();
  const user = await ensureDemoUser();
  await ensureFestivalSelections(user.id);
  console.log(`  · festival catalogue ready (${seeded} entries)`);
  console.log(`  · demo user ready (${user.email})`);
}

app.listen(env.PORT, async () => {
  console.log(`SpendSage API listening on http://localhost:${env.PORT}`);
  try {
    await bootstrap();
  } catch (err) {
    console.error('  ! bootstrap failed', err);
  }
  if (!hasPayPal) console.warn('  ! PayPal credentials missing — set them in server/.env');
  if (env.MOCK_AI) {
    console.log('  · MOCK_AI=true — AI runs in local deterministic mock mode (0 Gemini quota used)');
  } else if (!hasGemini) {
    console.warn('  ! GEMINI_API_KEY missing — AI features will use fallbacks');
  } else {
    console.log('  · Gemini AI active with local disk/memory caching');
  }
});
