/**
 * Test safety net: no test may ever reach the real Telegram or Supabase.
 * Any real network call fails loudly. Tests that need HTTP pass their own fake fetch.
 */
import { beforeAll } from 'vitest';
import { setSilent } from '../src/utils/logger.js';

beforeAll(() => {
  setSilent(true);
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input instanceof Request ? input.url : input);
    throw new Error(`Real network access is blocked in tests (tried ${url.replace(/bot[^/]+/, 'bot***')})`);
  }) as typeof fetch;
});
