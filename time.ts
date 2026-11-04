/**
 * Malaysia time helpers.
 *
 * Malaysia (Asia/Kuala_Lumpur) is UTC+08:00 all year round and has no daylight
 * saving time, so a fixed offset is exact. Doing the arithmetic ourselves means
 * the result never depends on the server's own clock time zone (Railway servers
 * run in UTC).
 */
export const MALAYSIA_TZ = 'Asia/Kuala_Lumpur';
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Shift a real instant so its UTC fields read as Malaysia wall-clock fields. */
function shifted(d: Date): Date {
  return new Date(d.getTime() + OFFSET_MS);
}

/** Malaysia calendar date, e.g. "2026-10-09". */
export function malaysiaDateString(d: Date): string {
  const s = shifted(d);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`;
}

export function isValidDateString(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Parses "HH:MM" (24-hour) into minutes after midnight. Throws on bad input. */
export function parseHHMM(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Invalid time "${value}". Use 24-hour HH:MM, e.g. 10:30 or 17:00.`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time "${value}".`);
  return h * 60 + min;
}

/** The real instant of a Malaysia wall-clock time on a Malaysia date. */
export function malaysiaWallTimeToDate(date: string, minutesAfterMidnight: number, seconds = 0): Date {
  if (!isValidDateString(date)) throw new Error(`Invalid date "${date}". Use YYYY-MM-DD.`);
  const midnightUtcFields = Date.parse(`${date}T00:00:00Z`);
  return new Date(midnightUtcFields - OFFSET_MS + minutesAfterMidnight * 60_000 + seconds * 1000);
}

/** Minutes (with fractions) since Malaysia midnight for an instant. */
export function malaysiaMinutesOfDay(d: Date): number {
  const s = shifted(d);
  return s.getUTCHours() * 60 + s.getUTCMinutes() + s.getUTCSeconds() / 60;
}

/** The instant when the next Malaysia calendar day starts. */
export function startOfNextMalaysiaDay(d: Date): Date {
  return malaysiaWallTimeToDate(addDays(malaysiaDateString(d), 1), 0);
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** "2026-10-09 14:05:33" in Malaysia time (used in logs). */
export function formatMalaysiaDateTime(d: Date): string {
  const s = shifted(d);
  return `${malaysiaDateString(d)} ${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "9 Oct 2026, 2:05 PM MYT" (used on the image and in captions). */
export function formatMalaysiaDisplay(d: Date): string {
  const s = shifted(d);
  const h24 = s.getUTCHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  return `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}, ${h12}:${pad(s.getUTCMinutes())} ${ampm} MYT`;
}

/** "10:30 AM" style label for minutes after midnight. */
export function formatClock(minutesAfterMidnight: number): string {
  const h24 = Math.floor(minutesAfterMidnight / 60) % 24;
  const m = Math.floor(minutesAfterMidnight % 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(m)} ${h24 < 12 ? 'AM' : 'PM'}`;
}
