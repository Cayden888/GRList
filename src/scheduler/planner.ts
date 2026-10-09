/**
 * Picks the day's random posting time inside the Malaysia posting window.
 *
 * The pick is seeded by the date, so if two workers ever race to create the
 * same day's row they propose the same time. If the worker first starts late
 * in the day, only the remaining part of the window is used (never "right now":
 * there is always at least a few minutes' gap), and if the window is already
 * over the day is recorded as missed instead of posting outside the window.
 */
import { createRng } from '../utils/rng.js';
import { formatClock, malaysiaWallTimeToDate } from '../utils/time.js';

export const MIN_LEAD_MS = 5 * 60_000;

export interface WindowConfig {
  startMinutes: number;
  endMinutes: number;
}

export type DailyPlan =
  | { status: 'pending'; scheduledAt: Date }
  | { status: 'missed'; scheduledAt: Date; note: string };

export function planDailyTime(malaysiaDate: string, window: WindowConfig, now: Date): DailyPlan {
  const start = malaysiaWallTimeToDate(malaysiaDate, window.startMinutes).getTime();
  const end = malaysiaWallTimeToDate(malaysiaDate, window.endMinutes).getTime();
  const earliest = Math.max(start, now.getTime() + MIN_LEAD_MS);

  if (earliest > end) {
    return {
      status: 'missed',
      scheduledAt: new Date(end),
      note: `Worker started after today's posting window (${formatClock(window.startMinutes)}–${formatClock(window.endMinutes)} MYT); no post today`,
    };
  }
  const rng = createRng(`schedule|${malaysiaDate}|${window.startMinutes}-${window.endMinutes}`);
  const firstSecond = Math.ceil(earliest / 1000);
  const lastSecond = Math.floor(end / 1000);
  return { status: 'pending', scheduledAt: new Date(rng.int(firstSecond, lastSecond) * 1000) };
}
