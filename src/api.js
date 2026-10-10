// API cho trình phát: đếm lượt nghe, người đang nghe, thống kê quảng cáo.
import { first, liveCounts } from './db.js';
import { json, now, vnDay, LIVE_WINDOW } from './util.js';

export async function handleApi(request, db, path, ctx) {
  // Cập nhật số đang nghe cho các thẻ trên trang.
  if (path === '/api/live') return json({ ok: true, live: await liveCounts(db) });

  if (request.method !== 'POST') return json({ ok: false }, 405);
  let input = {};
  try { input = await request.json(); } catch (e) { /* bỏ qua */ }
  const sid = String(input.sid || '');
  const validSid = /^[A-Za-z0-9]{12,40}$/.test(sid);
  const trackId = parseInt(input.track_id, 10) || 0;

  switch (path) {
    // Một lượt nghe: mỗi thiết bị tính 1 lần / truyện / ngày.
    case '/api/play': {
      if (!validSid || trackId <= 0) return json({ ok: false }, 400);
      if (!(await first(db, 'SELECT 1 x FROM tracks WHERE id = ? AND published = 1', trackId))) return json({ ok: false }, 404);
      const day = vnDay();
      const r = await db.prepare('INSERT OR IGNORE INTO plays (sid, track_id, day) VALUES (?, ?, ?)').bind(sid, trackId, day).run();
      if (r.meta.changes > 0) {
        await db.batch([
          db.prepare('UPDATE tracks SET views = views + 1 WHERE id = ?').bind(trackId),
          db.prepare('INSERT INTO views_daily (track_id, day, n) VALUES (?, ?, 1) ON CONFLICT(track_id, day) DO UPDATE SET n = n + 1').bind(trackId, day),
        ]);
      }
      if (Math.random() < 0.01) {
        ctx?.waitUntil?.(db.prepare('DELETE FROM plays WHERE day < ?').bind(vnDay(2)).run());
      }
      return json({ ok: true });
    }

    // Ping khi đang phát (60s/lần) để đếm người đang nghe.
    case '/api/ping': {
      if (!validSid) return json({ ok: false }, 400);
      if (input.playing && trackId > 0) {
        await db.prepare(`INSERT INTO listeners (sid, track_id, last_seen) VALUES (?, ?, ?)
          ON CONFLICT(sid) DO UPDATE SET track_id = excluded.track_id, last_seen = excluded.last_seen`).bind(sid, trackId, now()).run();
      } else {
        await db.prepare('DELETE FROM listeners WHERE sid = ?').bind(sid).run();
      }
      if (Math.random() < 0.1) {
        ctx?.waitUntil?.(db.prepare('DELETE FROM listeners WHERE last_seen < ?').bind(now() - LIVE_WINDOW).run());
      }
      if (trackId <= 0) return json({ ok: true, live: 0 });
      const row = await first(db, 'SELECT COUNT(*) c FROM listeners WHERE track_id = ? AND last_seen > ?', trackId, now() - LIVE_WINDOW);
      return json({ ok: true, live: row ? row.c : 0 });
    }

    // Thống kê hiển thị / bấm quảng cáo.
    case '/api/stat': {
      const adId = parseInt(input.id, 10) || 0;
      const col = input.ev === 'click' ? 'clicks' : 'shows';
      if (adId > 0) await db.prepare(`UPDATE ads SET ${col} = ${col} + 1 WHERE id = ?`).bind(adId).run();
      return json({ ok: true });
    }
  }
  return json({ ok: false, error: 'not_found' }, 404);
}
