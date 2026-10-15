import { all, first } from './db.js';
import { vnDay, tzHours, dateIso } from './util.js';

export function adReportDay(value) {
  if (value === 'all') return 'all';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && dateIso(value).slice(0, 10) === value && value <= vnDay()) return value;
  return vnDay(1);
}

export async function adReport(db, value) {
  const day = adReportDay(value), today = vnDay();
  const [ads, started] = await Promise.all([
    all(db, `SELECT a.*, COALESCE(d.shows, 0) day_shows, COALESCE(d.clicks, 0) day_clicks
      FROM ads a LEFT JOIN ad_stats_daily d ON d.ad_id = a.id AND d.day = ? ORDER BY a.id DESC`, day),
    first(db, "SELECT v FROM settings WHERE k = 'ad_stats_started_at'"),
  ]);
  const stamp = Number(started?.v);
  const since = Number.isFinite(stamp) && stamp > 0
    ? new Date(stamp * 1000 + tzHours() * 3600000).toISOString().slice(0, 10) : today;
  return { ads, period: { day, today, yesterday: vnDay(1), since, startedAt: stamp,
    available: day === 'all' || day >= since, timezone: `UTC${tzHours() >= 0 ? '+' : ''}${tzHours()}` } };
}
