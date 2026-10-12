import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, requireMode, safeSummary } from '../src/config/env.js';

describe('configuration', () => {
  it('has safe defaults: scheduler off, dry run on, 10:30–17:00 window', () => {
    const c = loadConfig({});
    expect(c.enableScheduler).toBe(false);
    expect(c.dryRun).toBe(true);
    expect(c.window).toMatchObject({ startMinutes: 630, endMinutes: 1020 });
    expect(c.dashboard).toMatchObject({ width: 1600, height: 900, simulatedLabel: 'SIMULATED DATA' });
  });

  it('preview mode needs nothing; database / telegram / scheduler modes list what is missing', () => {
    const c = loadConfig({});
    expect(() => requireMode(c, 'database')).toThrow(/SUPABASE_URL/);
    expect(() => requireMode(c, 'telegram')).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => requireMode(c, 'scheduler')).toThrow(/GOOGLE_SHEET/);
    const dry = loadConfig({ GOOGLE_SHEET_ID: 'x', SUPABASE_URL: 'https://a.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40) });
    expect(() => requireMode(dry, 'scheduler')).not.toThrow(); // DRY_RUN does not need Telegram
    const live = loadConfig({ GOOGLE_SHEET_ID: 'x', SUPABASE_URL: 'https://a.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40), DRY_RUN: 'false' });
    expect(() => requireMode(live, 'scheduler')).toThrow(/TELEGRAM_CHAT_ID/);
  });

  it('rejects invalid values with clear messages', () => {
    const bad = () => loadConfig({ ENABLE_SCHEDULER: 'maybe', POST_WINDOW_START: '18:00', POST_WINDOW_END: '17:00', DASHBOARD_WIDTH: 'wide', TELEGRAM_CHAT_ID: 'group' });
    expect(bad).toThrow(ConfigError);
    try {
      bad();
    } catch (e) {
      const problems = (e as ConfigError).problems.join('\n');
      expect(problems).toMatch(/ENABLE_SCHEDULER/);
      expect(problems).toMatch(/earlier than/);
      expect(problems).toMatch(/DASHBOARD_WIDTH/);
      expect(problems).toMatch(/TELEGRAM_CHAT_ID/);
    }
  });

  it('refuses to remove the simulated-data disclosure', () => {
    expect(() => loadConfig({ SIMULATED_DATA_LABEL: 'LIVE DATA' })).toThrow(/SIMULATED/);
    expect(loadConfig({ SIMULATED_DATA_LABEL: 'Simulated demo' }).dashboard.simulatedLabel).toBe('Simulated demo');
  });

  it('startup summary never contains secrets', () => {
    const key = 'service-role-secret-'.repeat(3);
    const token = '123456789:AAsecretsecretsecretsecretsecret123';
    const s = JSON.stringify(safeSummary(loadConfig({ SUPABASE_URL: 'https://a.supabase.co', SUPABASE_SERVICE_ROLE_KEY: key, TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: '-100123' })));
    expect(s).not.toContain(key);
    expect(s).not.toContain(token);
    expect(s).toContain('configured');
  });
});

describe('Supabase URL', () => {
  it('fixes trailing slash and /rest/v1, rejects the dashboard address', () => {
    expect(loadConfig({ SUPABASE_URL: 'https://abc.supabase.co/rest/v1/' }).supabase.url).toBe('https://abc.supabase.co');
    expect(() => loadConfig({ SUPABASE_URL: 'https://supabase.com/dashboard/project/abc' })).toThrow(/Project URL/);
  });
});
