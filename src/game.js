// Tu luyện: EXP, cấp độ, Linh Thạch, điểm danh, đánh giá truyện, thông báo.
import { all, first } from './db.js';
import { json, now, vnDay } from './util.js';
import { levelInfo, badge } from './levels.js';

export const GAME_DEFAULTS = {
  checkin_stones: '10',     // Linh Thạch mỗi lần điểm danh
  checkin_exp: '5',         // EXP mỗi lần điểm danh
  checkin_wait: '180',      // giây online trong ngày trước khi điểm danh được
  comment_exp: '2',         // EXP khi bình luận được duyệt
  comment_exp_daily: '10',  // số bình luận mỗi ngày được cộng EXP
  levelup_stones: '20',     // Linh Thạch thưởng mỗi lần lên cấp
  rate_daily: '15',         // số truyện được đánh giá mỗi ngày
  level_base_exp: '100',    // cấp N cần N × số này EXP để lên cấp (tính lại từ 0 mỗi cấp)
};
const num = (s, k) => Math.max(0, parseFloat(s[k] ?? GAME_DEFAULTS[k]) || 0);

// ---------- Thông báo ----------

export async function notify(db, userId, type, { actor = 0, track = 0, comment = 0, text = '' } = {}) {
  if (!userId || userId === actor) return;
  await db.prepare('INSERT INTO notifications (user_id, type, actor_id, track_id, comment_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(userId, type, actor, track, comment, String(text).slice(0, 200), now()).run();
  if (Math.random() < 0.02) await db.prepare('DELETE FROM notifications WHERE created_at < ?').bind(now() - 60 * 86400).run();
}

// ---------- EXP & lên cấp ----------

export async function awardExp(db, s, userId, amount) {
  if (!userId || !amount) return null;
  const row = await first(db, 'UPDATE users SET exp = exp + ? WHERE id = ? RETURNING exp', amount, userId);
  if (!row) return null;
  const before = levelInfo(row.exp - amount).lvl;
  const after = levelInfo(row.exp);
  if (after.lvl > before) {
    const bonus = (after.lvl - before) * num(s, 'levelup_stones');
    if (bonus) await db.prepare('UPDATE users SET stones = stones + ? WHERE id = ?').bind(bonus, userId).run();
    await notify(db, userId, 'levelup', { text: `Chúc mừng đột phá ${after.realm} (Cấp ${after.lvl})${bonus ? ` · +${bonus} Linh Thạch` : ''}` });
  }
  return after;
}

// Gọi khi một bình luận được hiện (tự duyệt hoặc admin duyệt).
export async function onCommentApproved(db, s, c) {
  const today = vnDay();
  const u = await first(db, 'SELECT cexp_day, cexp_n FROM users WHERE id = ?', c.user_id);
  const n = u && u.cexp_day === today ? u.cexp_n : 0;
  await db.prepare('UPDATE users SET comments_n = comments_n + 1, cexp_day = ?, cexp_n = ? WHERE id = ?').bind(today, n + 1, c.user_id).run();
  if (n < num(s, 'comment_exp_daily')) await awardExp(db, s, c.user_id, num(s, 'comment_exp'));
  if (c.parent_id) {
    const p = await first(db, 'SELECT user_id FROM comments WHERE id = ?', c.parent_id);
    if (p) await notify(db, p.user_id, 'reply', { actor: c.user_id, track: c.track_id, comment: c.id, text: c.body.slice(0, 120) });
  }
}

// ---------- Thống kê người dùng cho thẻ tài khoản ----------

export async function gameStats(db, s, me) {
  const t = now(), today = vnDay();
  if (me.seen_day !== today) {
    await db.prepare('UPDATE users SET seen_day = ?, seen_at = ? WHERE id = ?').bind(today, t, me.id).run();
    me.seen_day = today; me.seen_at = t;
  }
  const unread = (await first(db, 'SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0', me.id)).c;
  const checkedIn = me.checkin_day === today;
  return {
    exp: me.exp || 0,
    stones: me.stones || 0,
    comments: me.comments_n || 0,
    level: levelInfo(me.exp),
    checkedIn,
    checkinIn: checkedIn ? 0 : Math.max(0, num(s, 'checkin_wait') - (t - me.seen_at)),
    ckStones: num(s, 'checkin_stones'),
    unread,
  };
}

// ---------- API ----------

export async function handleGameApi(request, db, s, path, me, input) {
  const url = new URL(request.url);

  // Danh sách thông báo (GET) / đánh dấu đã đọc (POST).
  if (path === '/api/notifications') {
    if (request.method === 'POST') {
      await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').bind(me.id).run();
      return json({ ok: true });
    }
    const items = await all(db, `SELECT n.id, n.type, n.text, n.is_read, n.created_at, n.comment_id, a.name actor, a.avatar actor_avatar, a.exp actor_exp, t.slug, t.title
      FROM notifications n LEFT JOIN users a ON a.id = n.actor_id LEFT JOIN tracks t ON t.id = n.track_id
      WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 30`, me.id);
    return json({ ok: true, items: items.map(n => ({ ...n, actor_badge: n.actor ? badge(n.actor_exp) : null })) });
  }

  // Điểm danh hằng ngày: phải online đủ thời gian trong ngày.
  if (path === '/api/checkin') {
    const t = now(), today = vnDay();
    if (me.checkin_day === today) return json({ ok: false, error: 'Hôm nay bạn đã điểm danh rồi.' }, 400);
    const wait = num(s, 'checkin_wait') - (me.seen_day === today ? t - me.seen_at : 0);
    if (me.seen_day !== today || wait > 0) {
      if (me.seen_day !== today) await db.prepare('UPDATE users SET seen_day = ?, seen_at = ? WHERE id = ?').bind(today, t, me.id).run();
      return json({ ok: false, error: 'Chưa đủ thời gian online.', wait: Math.max(1, Math.ceil(wait)) }, 400);
    }
    const r = await db.prepare("UPDATE users SET checkin_day = ?, stones = stones + ? WHERE id = ? AND checkin_day != ?")
      .bind(today, num(s, 'checkin_stones'), me.id, today).run();
    if (!r.meta.changes) return json({ ok: false, error: 'Hôm nay bạn đã điểm danh rồi.' }, 400);
    await awardExp(db, s, me.id, num(s, 'checkin_exp'));
    return json({ ok: true, stones: num(s, 'checkin_stones'), exp: num(s, 'checkin_exp') });
  }

  // Đánh giá truyện (1–10 sao), mỗi truyện 1 lần, giới hạn số truyện / ngày.
  if (path === '/api/rate') {
    const trackId = parseInt(request.method === 'GET' ? url.searchParams.get('track') : input.track_id, 10) || 0;
    if (request.method === 'GET') {
      const r = await first(db, 'SELECT stars FROM ratings WHERE user_id = ? AND track_id = ?', me.id, trackId);
      return json({ ok: true, mine: r ? r.stars : 0 });
    }
    const stars = parseInt(input.stars, 10);
    if (!(stars >= 1 && stars <= 10)) return json({ ok: false, error: 'Số sao không hợp lệ.' }, 400);
    if (!(await first(db, 'SELECT 1 x FROM tracks WHERE id = ? AND published = 1', trackId))) return json({ ok: false }, 404);
    if (await first(db, 'SELECT 1 x FROM ratings WHERE user_id = ? AND track_id = ?', me.id, trackId)) {
      return json({ ok: false, error: 'Bạn đã đánh giá truyện này rồi.' }, 400);
    }
    const today = vnDay();
    const used = me.rate_day === today ? me.rate_n : 0;
    if (used >= num(s, 'rate_daily')) return json({ ok: false, error: `Mỗi ngày chỉ đánh giá được ${num(s, 'rate_daily')} truyện.` }, 429);
    await db.batch([
      db.prepare('INSERT INTO ratings (user_id, track_id, stars, created_at) VALUES (?, ?, ?, ?)').bind(me.id, trackId, stars, now()),
      db.prepare('UPDATE tracks SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id = ?').bind(stars, trackId),
      db.prepare('UPDATE users SET rate_day = ?, rate_n = ? WHERE id = ?').bind(today, used + 1, me.id),
    ]);
    await awardExp(db, s, me.id, 1);
    const tr = await first(db, 'SELECT rating_sum, rating_count FROM tracks WHERE id = ?', trackId);
    return json({ ok: true, mine: stars, sum: tr.rating_sum, count: tr.rating_count });
  }

  return null;
}

// Bảng xếp hạng (lưu đệm phía gọi).
export async function leaderboard(db, limit = 50) {
  const rows = await all(db, 'SELECT id, name, avatar, exp, comments_n FROM users WHERE banned = 0 AND exp > 0 ORDER BY exp DESC, id LIMIT ?', limit);
  return rows.map(r => ({ ...r, ...badge(r.exp) }));
}
