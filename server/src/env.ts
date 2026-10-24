import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Always load server/.env regardless of current working directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default(isTest ? 'test' : 'development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default('file:./dev.db'),
  JWT_SECRET: z.string().min(1).default('dev-only-insecure-secret'),

  PAYPAL_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_CURRENCY: z.string().default('USD'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  MOCK_AI: z
    .string()
    .optional()
    .transform((val) => {
      if (isTest && process.env.FORCE_LIVE_AI !== 'true') return true;
      return val === 'true' || val === '1';
    })
    .default(isTest ? 'true' : 'false'),
});

export const env = schema.parse(process.env);

/**
 * Integrations are optional at boot so the app runs before day-1 credentials
 * are in place. `/api/health` reports which ones are actually configured —
 * check it before demoing or recording.
 */
export const hasPayPal = Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
export const hasGemini = Boolean(env.GEMINI_API_KEY);

export function requirePayPal(): { clientId: string; clientSecret: string } {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error('PayPal is not configured. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to server/.env');
  }
  return { clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET };
}

export function requireGemini(): string {
  if (!env.GEMINI_API_KEY) {
    throw new Error('Gemini is not configured. Add GEMINI_API_KEY to server/.env');
  }
  return env.GEMINI_API_KEY;
}
