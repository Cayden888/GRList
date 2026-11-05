import { describe, expect, it } from 'vitest';
import { postingDaysForWeek, shouldPostOnDate, weekMonday } from '../src/scheduler/weekly.js';
import { addDays } from '../src/utils/time.js';

describe('weekly MYT frequency', () => {
  it('starts every week on Monday', () => {
    expect(weekMonday('2026-11-05')).toBe('2026-11-02');
    expect(weekMonday('2026-11-08')).toBe('2026-11-02');
    expect(weekMonday('2026-11-09')).toBe('2026-11-09');
  });
  it('picks exactly the requested number of distinct days, repeatably', () => {
    for (let n = 0; n <= 7; n++) {
      const dates = postingDaysForWeek('2026-11-05', n);
      expect(dates).toHaveLength(n);
      expect(new Set(dates).size).toBe(n);
      expect(dates).toEqual(postingDaysForWeek('2026-11-08', n));
      expect(dates.every(d => d >= '2026-11-02' && d <= '2026-11-08')).toBe(true);
      expect(Array.from({ length: 7 }, (_, i) => addDays('2026-11-02', i)).filter(d => shouldPostOnDate(d, n))).toEqual(dates);
    }
  });
  it('rejects invalid counts', () => {
    expect(() => postingDaysForWeek('2026-11-05', 8)).toThrow();
    expect(() => postingDaysForWeek('2026-11-05', 2.5)).toThrow();
  });
});
