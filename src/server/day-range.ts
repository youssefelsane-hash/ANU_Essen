import { localDateString, localDateToUtc, startOfLocalDay } from '../lib/domain/hours';

/** A local calendar day (YYYY-MM-DD, default today) as a UTC [from, to) range. */
export function dayRange(date: string | undefined, timezone: string) {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDateString(new Date(), timezone);
  const from = date ? localDateToUtc(day, timezone) : startOfLocalDay(new Date(), timezone);
  const next = new Date(`${day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { day, from, to: localDateToUtc(next.toISOString().slice(0, 10), timezone) };
}
