import { describe, expect, it } from 'vitest';
import { clearAICache, geminiJSON, getAICacheStats } from './aiService.js';

describe('aiService cache & fallback', () => {
  it('serves fallback when Gemini call cannot be made or fails', async () => {
    // A fake prompt with a guaranteed fallback
    const fallbackVal = { test: 'fallback-ok' };
    const res = await geminiJSON(
      'Prompt that tests fallback',
      (raw) => raw as { test: string },
      () => fallbackVal,
    );

    expect(res.result).toEqual(fallbackVal);
  });

  it('reports cache stats and mock mode in tests', () => {
    const stats = getAICacheStats();
    expect(typeof stats.cachedPrompts).toBe('number');
    expect(stats.mockAi).toBe(true);
  });

  it('can clear the cache safely', () => {
    clearAICache();
    const stats = getAICacheStats();
    expect(stats.cachedPrompts).toBe(0);
  });
});
