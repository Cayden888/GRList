import { describe, expect, it } from 'vitest';
import { generateTrend, TREND_POINTS } from '../src/simulation/graph.js';
import { areComparable, chooseDecimals, drawDecimal, drawInteger, simulateDashboard, type SimulationOptions } from '../src/simulation/metrics.js';
import { itemSeed } from '../src/simulation/seed.js';
import { selectItem } from '../src/simulation/selection.js';
import { addDays } from '../src/utils/time.js';
import { createRng, streamRng } from '../src/utils/rng.js';
import { sampleItem } from './helpers.js';

const OPTS: SimulationOptions = { currentValueSource: 'generate', timeSinceUpdateMinMinutes: 3, timeSinceUpdateMaxMinutes: 45 };
const within = (v: number, r: { min: number; max: number }) => v >= r.min && v <= r.max;

describe('seeded random generator', () => {
  it('is deterministic for the same seed and differs for different seeds', () => {
    const a = createRng('x');
    const b = createRng('x');
    const c = createRng('y');
    const sa = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(sa);
  });

  it('int() is inclusive at both ends', () => {
    const r = createRng('ints');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(r.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('rejects invalid ranges', () => {
    const r = createRng('bad');
    expect(() => r.float(5, 1)).toThrow();
    expect(() => r.int(2.2, 2.8)).toThrow();
    expect(() => r.float(Number.NaN, 1)).toThrow();
  });
});

describe('simulated metrics', () => {
  it('keeps every value inside its configured range across many days', () => {
    const item = sampleItem();
    for (let d = 0; d < 400; d++) {
      const date = addDays('2026-01-01', d);
      const s = simulateDashboard(item, itemSeed(date, item.id), OPTS);
      expect(within(s.current.value, item.current)).toBe(true);
      expect(within(s.baseline!.value, item.baseline!)).toBe(true);
      expect(within(s.volume24h!.value, item.volume24h!)).toBe(true);
      expect(within(s.output24h!.value, item.output24h!)).toBe(true);
      expect(within(s.eventCount24h!.value, item.eventCount24h!)).toBe(true);
      for (const v of [s.current, s.baseline!, s.difference!, s.volume24h!, s.output24h!, s.eventCount24h!]) {
        expect(Number.isFinite(v.value)).toBe(true);
      }
    }
  });

  it('uses whole numbers for count fields', () => {
    const item = sampleItem({ eventCount24h: { min: 0.5, max: 9.7 } });
    for (let i = 0; i < 300; i++) {
      const s = simulateDashboard(item, `seed-${i}`, OPTS);
      expect(Number.isInteger(s.eventCount24h!.value)).toBe(true);
      expect(s.eventCount24h!.decimals).toBe(0);
      expect(within(s.eventCount24h!.value, { min: 1, max: 9 })).toBe(true);
    }
  });

  it('handles minimum equal to maximum', () => {
    const item = sampleItem({ current: { min: 97.5, max: 97.5 }, eventCount24h: { min: 12, max: 12 } });
    const s = simulateDashboard(item, 'same', OPTS);
    expect(s.current.value).toBe(97.5);
    expect(s.eventCount24h!.value).toBe(12);
    expect(s.trend.every((p) => p.value === 97.5)).toBe(true);
  });

  it('reproduces identical values and graph for the same date and item (retries)', () => {
    const item = sampleItem();
    const seed = itemSeed('2026-10-09', item.id);
    expect(simulateDashboard(item, seed, OPTS)).toEqual(simulateDashboard(item, seed, OPTS));
  });

  it('produces a different simulation on a different day', () => {
    const item = sampleItem();
    const a = simulateDashboard(item, itemSeed('2026-10-09', item.id), OPTS);
    const b = simulateDashboard(item, itemSeed('2026-10-10', item.id), OPTS);
    expect(a.current.value === b.current.value && a.baseline!.value === b.baseline!.value).toBe(false);
    expect(a.trend.map((p) => p.value)).not.toEqual(b.trend.map((p) => p.value));
  });

  it('keeps random streams independent (removing a card does not change the graph or main value)', () => {
    const seed = itemSeed('2026-10-09', 'item-a');
    const full = simulateDashboard(sampleItem(), seed, OPTS);
    const fewer = simulateDashboard(sampleItem({ baseline: undefined, volume24h: undefined }), seed, OPTS);
    expect(fewer.current).toEqual(full.current);
    expect(fewer.trend).toEqual(full.trend);
    expect(fewer.eventCount24h).toEqual(full.eventCount24h);
  });

  it('hides optional metrics that are not configured', () => {
    const s = simulateDashboard(sampleItem({ baseline: undefined, volume24h: undefined, output24h: undefined, eventCount24h: undefined }), 's', OPTS);
    expect(s.baseline).toBeUndefined();
    expect(s.difference).toBeUndefined();
    expect(s.volume24h).toBeUndefined();
    expect(s.output24h).toBeUndefined();
    expect(s.eventCount24h).toBeUndefined();
  });

  it('computes the difference from the displayed (rounded) numbers', () => {
    const s = simulateDashboard(sampleItem(), 'diff', OPTS);
    expect(s.difference!.value).toBeCloseTo(s.current.value - s.baseline!.value, 10);
  });

  it('does not show a difference when baseline and current are on very different scales', () => {
    expect(areComparable({ min: 95, max: 99 }, { min: 92, max: 97 })).toBe(true);
    expect(areComparable({ min: 95, max: 99 }, { min: 10000, max: 20000 })).toBe(false);
    const s = simulateDashboard(sampleItem({ baseline: { min: 10000, max: 20000 } }), 'x', OPTS);
    expect(s.baseline).toBeDefined();
    expect(s.difference).toBeUndefined();
  });

  it('uses the sheet Time_Since_Last_Update when given, otherwise a simulated value in range', () => {
    expect(simulateDashboard(sampleItem({ timeSinceUpdateMinutes: 12 }), 's', OPTS).timeSinceUpdate).toEqual({ minutes: 12, simulated: false });
    expect(simulateDashboard(sampleItem({ timeSinceUpdateText: '5 min' }), 's', OPTS).timeSinceUpdate).toEqual({ text: '5 min', simulated: false });
    for (let i = 0; i < 200; i++) {
      const t = simulateDashboard(sampleItem(), `t${i}`, OPTS).timeSinceUpdate;
      expect(t.simulated).toBe(true);
      expect(t.minutes).toBeGreaterThanOrEqual(3);
      expect(t.minutes).toBeLessThanOrEqual(45);
    }
  });

  it('can use the fixed Current_Value from the sheet when configured', () => {
    const item = sampleItem({ currentSheetValue: 96.7 });
    const s = simulateDashboard(item, 's', { ...OPTS, currentValueSource: 'sheet' });
    expect(s.current.value).toBe(96.7);
    expect(s.trend.at(-1)!.value).toBe(96.7);
  });

  it('chooses sensible decimals and draws stay in range', () => {
    expect(chooseDecimals({ min: 95, max: 99.5 })).toBe(2);
    expect(chooseDecimals({ min: 1000, max: 50000 })).toBe(0);
    expect(chooseDecimals({ min: 0.125, max: 0.5 })).toBe(3);
    const r = streamRng('d', 'x');
    for (let i = 0; i < 500; i++) {
      const v = drawDecimal(r, { min: 1.005, max: 1.006 }, 't').value;
      expect(within(v, { min: 1.005, max: 1.006 })).toBe(true);
      expect(within(drawInteger(r, { min: 0, max: 2 }, 'c').value, { min: 0, max: 2 })).toBe(true);
    }
  });
});

describe('simulated 24-hour trend', () => {
  it('has 25 hourly points within bounds, ending exactly at the current value', () => {
    for (let i = 0; i < 300; i++) {
      const range = { min: 95, max: 99.5 };
      const rng = createRng(`g${i}`);
      const final = Number(rng.float(range.min, range.max).toFixed(2));
      const t = generateTrend(range, final, createRng(`graph${i}`));
      expect(t).toHaveLength(TREND_POINTS);
      expect(t[0]!.hourOffset).toBe(-24);
      expect(t.at(-1)!.hourOffset).toBe(0);
      expect(t.at(-1)!.value).toBe(final);
      expect(t.every((p) => within(p.value, range) && Number.isFinite(p.value))).toBe(true);
    }
  });

  it('is not a flat line when the range allows movement', () => {
    const t = generateTrend({ min: 0, max: 100 }, 50, createRng('wiggle'));
    const values = t.map((p) => p.value);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(5);
  });

  it('works when the final value is at the edge of the range', () => {
    expect(generateTrend({ min: 0, max: 10 }, 0, createRng('lo')).at(-1)!.value).toBe(0);
    expect(generateTrend({ min: 0, max: 10 }, 10, createRng('hi')).at(-1)!.value).toBe(10);
  });

  it('refuses a final value outside the range', () => {
    expect(() => generateTrend({ min: 0, max: 10 }, 11, createRng('x'))).toThrow();
  });
});

describe('item selection', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id, i) => sampleItem({ id, rowNumber: i + 2, titleEn: id.toUpperCase() }));

  it('random selection is stable for a date and independent of row order', () => {
    const first = selectItem(items, '2026-10-09', 'random');
    expect(selectItem([...items].reverse(), '2026-10-09', 'random').id).toBe(first.id);
  });

  it('random selection varies across days', () => {
    const ids = new Set(Array.from({ length: 30 }, (_, d) => selectItem(items, addDays('2026-10-01', d), 'random').id));
    expect(ids.size).toBeGreaterThan(2);
  });

  it('sequential selection rotates daily', () => {
    const a = selectItem(items, '2026-10-09', 'sequential').id;
    const b = selectItem(items, '2026-10-10', 'sequential').id;
    expect(a).not.toBe(b);
    expect(selectItem(items, addDays('2026-10-09', 5), 'sequential').id).toBe(a);
  });

  it('fixed selection matches id, Image_Name or title', () => {
    expect(selectItem(items, '2026-10-09', 'fixed', 'c').id).toBe('c');
    expect(selectItem(items, '2026-10-09', 'fixed', 'D').id).toBe('d');
    expect(() => selectItem(items, '2026-10-09', 'fixed', 'zzz')).toThrow();
  });
});
