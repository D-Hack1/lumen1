// Owner: Abhinav
// UTC + MET formatting for the shell (ops convention: ISO-like UTC, T±dd:hh:mm).
const pad = (n: number, w = 2) => String(Math.trunc(n)).padStart(w, '0');
export function formatUtc(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
export function parseUtc(s: string): number | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(?:Z|UTC)?\s*$/i.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map((x) => Number(x ?? 0));
  const t = Date.UTC(y, mo - 1, d, h, mi, se);
  const back = new Date(t);
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d && h < 24 && mi < 60 && se < 60 ? t : null;
}
/** Mission Elapsed Time T±dd:hh:mm. */
export function formatMet(t: number, landing: number): string {
  const ms = t - landing;
  const sign = ms < 0 ? '−' : '+';
  const m = Math.floor(Math.abs(ms) / 60000);
  return `T${sign}${pad(Math.floor(m / 1440))}:${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}
