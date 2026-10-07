/**
 * Opening hours + timezone helpers (pure, Intl-based — correct across DST changes).
 */
import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const dayHoursSchema = z.object({ open: hhmm, close: hhmm }).nullable();
/** Index 0 = Sunday … 6 = Saturday. `null` for a day = closed all day. */
export const weeklyHoursSchema = z.array(dayHoursSchema).length(7);
export type DayHours = z.infer<typeof dayHoursSchema>;
export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    weekday: WEEKDAYS[p.weekday] ?? 0,
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Minutes the timezone is ahead of UTC at the given instant. */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** UTC instant of local midnight (start of the local day) for `date` in `timeZone`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  const midnightUtcGuess = Date.UTC(p.year, p.month - 1, p.day);
  const offset = tzOffsetMinutes(new Date(midnightUtcGuess - tzOffsetMinutes(date, timeZone) * 60_000), timeZone);
  return new Date(midnightUtcGuess - offset * 60_000);
}

/** UTC instant for a local calendar date string (YYYY-MM-DD) at local midnight. */
export function localDateToUtc(dateStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  const first = new Date(guess - offset * 60_000);
  const offset2 = tzOffsetMinutes(first, timeZone);
  return offset2 === offset ? first : new Date(guess - offset2 * 60_000);
}

export function localDateString(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const toMinutes = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/** Is the restaurant open at `at`? `null` hours = no schedule (always open). Supports overnight windows. */
export function isOpenAt(hours: WeeklyHours | null | undefined, timeZone: string, at: Date): boolean {
  if (!hours) return true;
  const p = localParts(at, timeZone);
  const t = p.hour * 60 + p.minute;

  const today = hours[p.weekday];
  if (today) {
    const o = toMinutes(today.open);
    const c = toMinutes(today.close);
    if (o === c) return true; // 24h
    if (o < c ? t >= o && t < c : t >= o) return true;
  }
  const yesterday = hours[(p.weekday + 6) % 7];
  if (yesterday) {
    const o = toMinutes(yesterday.open);
    const c = toMinutes(yesterday.close);
    if (o > c && t < c) return true; // overnight window spilling into today
  }
  return false;
}

export const WEEKDAY_NAMES_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const WEEKDAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Value for an <input type="datetime-local"> showing `date` in `timeZone`. */
export function toZonedInputValue(date: Date | null | undefined, timeZone: string): string {
  if (!date) return '';
  const p = localParts(date, timeZone);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** Parses a datetime-local value ("YYYY-MM-DDTHH:mm") as wall-clock time in `timeZone`. */
export function fromZonedInputValue(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = tzOffsetMinutes(new Date(guess), timeZone);
  const first = guess - offset * 60_000;
  const offset2 = tzOffsetMinutes(new Date(first), timeZone);
  return new Date(offset2 === offset ? first : guess - offset2 * 60_000);
}
