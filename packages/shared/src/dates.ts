/**
 * A day as YYYY-MM-DD in the local calendar: the browser's for a form
 * default, the server's (TZ) on the API. Never `toISOString().slice(0, 10)`,
 * which is the UTC date - in Pakistan still yesterday until 5 am, so a
 * payment taken after midnight on the 1st was dated in the previous month.
 */
export function localIsoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The local date `days` from now (negative for the past). */
export function localIsoDateIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localIsoDate(d);
}
