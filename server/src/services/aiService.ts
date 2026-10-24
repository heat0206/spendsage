import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireGemini, env } from '../env.js';

interface GeminiContent {
  parts: { text: string }[];
}

interface GeminiCandidate {
  content: GeminiContent;
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST);
const CACHE_DIR = path.resolve(__dirname, '../../.cache');
const CACHE_FILE = path.join(CACHE_DIR, isTestEnv ? 'ai-cache.test.json' : 'ai-cache.json');

const memoryCache = new Map<string, unknown>();

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(data)) {
        memoryCache.set(k, v);
      }
      console.log(`[ai:cache] Loaded ${memoryCache.size} cached AI responses from disk`);
    }
  } catch (err) {
    console.warn('[ai:cache] Could not load cache file:', (err as Error).message);
  }
}

// Load cache once on module boot
loadCache();

function persistCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const obj = Object.fromEntries(memoryCache.entries());
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[ai:cache] Could not persist cache:', (err as Error).message);
  }
}

function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt.trim()).digest('hex');
}

export function getAICacheStats() {
  return {
    cachedPrompts: memoryCache.size,
    mockAi: env.MOCK_AI,
  };
}

export function clearAICache() {
  memoryCache.clear();
  try {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
    console.log('[ai:cache] AI cache cleared');
  } catch {
    /* ignore */
  }
}

/**
 * Minimal Gemini REST wrapper with:
 * 1. MOCK_AI toggle support — returns deterministic response with 0 network calls when true.
 * 2. Persistent disk + in-memory cache — repeat prompts return instantly without using API quota.
 * 3. Graceful fallback on API failure so the application never breaks.
 */
export async function geminiJSON<T>(
  prompt: string,
  schema: (raw: unknown) => T,
  fallback: () => T,
  maxRetries = 1,
): Promise<{ result: T; fromFallback: boolean }> {
  // 1. Mock mode short-circuit (zero quota used)
  if (env.MOCK_AI) {
    console.log('[ai:mock] MOCK_AI=true — serving deterministic local response (0 quota used)');
    return { result: fallback(), fromFallback: true };
  }

  // 2. Cache lookup (zero quota used on hits)
  const hash = hashPrompt(prompt);
  if (memoryCache.has(hash)) {
    try {
      const cached = memoryCache.get(hash);
      const validated = schema(cached);
      console.log(`[ai:cache] Cache hit (${hash.slice(0, 8)}) — 0 quota used`);
      return { result: validated, fromFallback: false };
    } catch {
      // Schema changed or corrupt cached data; evict and call API
      memoryCache.delete(hash);
    }
  }

  // 3. Live Gemini call
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const apiKey = requireGemini();
      const model = env.GEMINI_MODEL;

      const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
          maxOutputTokens: 512,
        },
      };

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(12_000),
        },
      );

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const parsed: unknown = JSON.parse(cleaned);
      const validated = schema(parsed);

      // Persist in cache for subsequent requests
      memoryCache.set(hash, parsed);
      persistCache();
      console.log(`[ai:gemini] Live call succeeded & cached (${hash.slice(0, 8)})`);

      return { result: validated, fromFallback: false };
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
      console.warn('[ai] falling back to deterministic result:', (err as Error).message);
    }
  }

  return { result: fallback(), fromFallback: true };
}
