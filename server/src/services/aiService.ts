import { requireGemini } from '../env.js';
import { env } from '../env.js';

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

/**
 * Minimal Gemini REST wrapper — no SDK, no extra dependency.
 * Always returns schema-validated JSON. On failure, calls the provided
 * fallback so callers have a deterministic result.
 */
export async function geminiJSON<T>(
  prompt: string,
  schema: (raw: unknown) => T,
  fallback: () => T,
  maxRetries = 1,
): Promise<{ result: T; fromFallback: boolean }> {
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
      return { result: schema(parsed), fromFallback: false };
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
