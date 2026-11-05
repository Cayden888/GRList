/** Deterministic Monday–Sunday MYT posting days, without replacement. */
import { createRng } from '../utils/rng.js';
import { addDays } from '../utils/time.js';

/** Monday of the ISO-style week containing the given YYYY-MM-DD date. */
export function weekMonday(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

export function postingDaysForWeek(date: string, postsPerWeek: number): string[] {
  if (!Number.isInteger(postsPerWeek) || postsPerWeek < 0 || postsPerWeek > 7) {
    throw new Error('posts_per_week must be an integer between 0 and 7');
  }
  const monday = weekMonday(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const rng = createRng(`weekly-post-days|${monday}|${postsPerWeek}`);
  // Fisher–Yates: exactly N distinct weekdays, deterministic on restart.
  for (let i = days.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [days[i], days[j]] = [days[j]!, days[i]!];
  }
  return days.slice(0, postsPerWeek).sort();
}

export function shouldPostOnDate(date: string, postsPerWeek: number): boolean {
  return postingDaysForWeek(date, postsPerWeek).includes(date);
}
