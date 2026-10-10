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
  rate_daily: '15',         // số truyện được đánh giá mỗi ngày
  level_base_exp: '100',    // cấp N cần N × số này EXP để lên cấp (tính lại từ 0 mỗi cấp)
};
// Thưởng Linh Thạch mỗi lần lên cấp theo khoảng cấp: "đến cấp:Linh Thạch" mỗi dòng.
// Mặc định: lên cấp 2–5 +200, cấp 6–20 +500, cấp 21–50 +1000, cấp 51–70 +1500.
export const LEVELUP_TIERS_DEFAULT = '5:200\n20:500\n50:1000\n70:1500';

export function parseLevelTiers(text) {
  const seen = new Set();
  return String(text || '').split(/[\n;,]+/).map(l => l.split(':').map(x => Math.max(0, Math.round(parseFloat(x) || 0))))
    .filter(([lvl]) => lvl > 1 && !seen.has(lvl) && seen.add(lvl))
    .map(([lvl, stones = 0]) => ({ lvl: Math.min(70, lvl), stones }))
    .sort((a, b) => a.lvl - b.lvl);
}

// Linh Thạch thưởng khi đạt cấp `lvl`.
export function levelupStones(s, lvl) {
  const tiers = parseLevelTiers(s.levelup_tiers ?? LEVELUP_TIERS_DEFAULT);
  const t = tiers.find(t => lvl <= t.lvl) || tiers[tiers.length - 1];
  return t ? t.stones : 0;
}

const num = (s, k) => Math.max(0, parseFloat(s[k] ?? GAME_DEFAULTS[k]) || 0);

// ---------- Thông báo ----------

export async function notify(db, userId, type, { actor = 0, track = 0, comment = 0, text = '' } = {}) {
  if (!userId || userId === actor) return;
  await db.prepare('INSERT INTO notifications (user_id, type, actor_id, track_id, comment_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(userId, type, actor, track, comment, String(text).slice(0, 200), now()).run();
  if (Math.random() < 0.02) await db.prepare('DELETE FROM notifications WHERE created_at < ?').bind(now() - 60 * 86400).run();
}

// ---------- Lịch sử EXP / Linh Thạch ----------

// Câu lệnh ghi một dòng lịch sử; số dư lấy sau khi đã cập nhật (gọi sau UPDATE, hoặc đặt sau nó trong batch).
export function walletStmt(db, userId, kind, amount, note) {
  const col = kind === 'exp' ? 'exp' : 'stones';
  return db.prepare(`INSERT INTO wallet_log (user_id, kind, amount, balance, note, created_at)
    SELECT id, ?, ?, ${col}, ?, ? FROM users WHERE id = ?`).bind(kind, amount, String(note || '').slice(0, 200), now(), userId);
}

export async function walletLog(db, userId, kind, amount, note) {
  if (!userId || !amount) return;
  await walletStmt(db, userId, kind, amount, note).run();
  if (Math.random() < 0.01) await db.prepare('DELETE FROM wallet_log WHERE created_at < ?').bind(now() - 365 * 86400).run();
}

// ---------- EXP & lên cấp ----------

// Cộng EXP, tự xử lý lên cấp. Trả về danh sách phần thưởng để hiện thông báo góc màn hình.
export async function awardExp(db, s, userId, amount, note = '') {
  if (!userId || !amount) return [];
  const row = await first(db, 'UPDATE users SET exp = exp + ? WHERE id = ? RETURNING exp', amount, userId);
  if (!row) return [];
  await walletLog(db, userId, 'exp', amount, note);
  const rewards = [{ type: 'exp', n: amount }];
  const before = levelInfo(row.exp - amount).lvl;
  const after = levelInfo(row.exp);
  if (after.lvl > before) {
    let bonus = 0;
    for (let l = before + 1; l <= after.lvl; l++) bonus += levelupStones(s, l);
    if (bonus) {
      await db.prepare('UPDATE users SET stones = stones + ? WHERE id = ?').bind(bonus, userId).run();
      await walletLog(db, userId, 'stones', bonus, `Thưởng đột phá ${after.realm} (Cấp ${after.lvl})`);
    }
    await notify(db, userId, 'levelup', { text: `Chúc mừng đột phá ${after.realm} (Cấp ${after.lvl})${bonus ? ` · +${bonus} Linh Thạch` : ''}` });
    rewards.push({ type: 'levelup', lvl: after.lvl, realm: after.realm, tier: after.tier });
    if (bonus) rewards.push({ type: 'stones', n: bonus });
  }
  return rewards;
}

// Gọi khi một bình luận được hiện (tự duyệt hoặc admin duyệt).
export async function onCommentApproved(db, s, c) {
  const today = vnDay();
  // Tăng bộ đếm trong một câu lệnh nguyên tử; giá trị trả về quyết định có được cộng EXP không.
  const u = await first(db, `UPDATE users SET comments_n = comments_n + 1, cexp_n = CASE WHEN cexp_day = ? THEN cexp_n + 1 ELSE 1 END, cexp_day = ?
    WHERE id = ? RETURNING cexp_n`, today, today, c.user_id);
  const rewards = u && u.cexp_n <= num(s, 'comment_exp_daily') ? await awardExp(db, s, c.user_id, num(s, 'comment_exp'), `Bình luận được duyệt #${c.id}`) : [];
  if (c.parent_id) {
    const p = await first(db, 'SELECT user_id FROM comments WHERE id = ?', c.parent_id);
    if (p) await notify(db, p.user_id, 'reply', { actor: c.user_id, track: c.track_id, comment: c.id, text: c.body.slice(0, 120) });
  }
  return rewards;
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
    ckExp: num(s, 'checkin_exp'),
    rateToday: me.rate_day === today ? me.rate_n : 0,
    rateMax: num(s, 'rate_daily'),
    cmtToday: me.cexp_day === today ? me.cexp_n : 0,
    cmtMax: num(s, 'comment_exp_daily'),
    cmtExp: num(s, 'comment_exp'),
    levelStones: levelupStones(s, levelInfo(me.exp).lvl + 1),
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
    await walletLog(db, me.id, 'stones', num(s, 'checkin_stones'), 'Điểm danh hằng ngày');
    const rewards = [{ type: 'stones', n: num(s, 'checkin_stones') }, ...await awardExp(db, s, me.id, num(s, 'checkin_exp'), 'Điểm danh hằng ngày')];
    return json({ ok: true, stones: num(s, 'checkin_stones'), exp: num(s, 'checkin_exp'), rewards });
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
    const track = await first(db, 'SELECT title FROM tracks WHERE id = ? AND published = 1', trackId);
    if (!track) return json({ ok: false }, 404);
    if (await first(db, 'SELECT 1 x FROM ratings WHERE user_id = ? AND track_id = ?', me.id, trackId)) {
      return json({ ok: false, error: 'Bạn đã đánh giá truyện này rồi.' }, 400);
    }
    const today = vnDay(), max = num(s, 'rate_daily');
    // Giữ chỗ 1 lượt trong ngày bằng một câu lệnh nguyên tử (gửi nhiều yêu cầu cùng lúc cũng không vượt giới hạn).
    const slot = await db.prepare(`UPDATE users SET rate_n = CASE WHEN rate_day = ? THEN rate_n + 1 ELSE 1 END, rate_day = ?
      WHERE id = ? AND (rate_day != ? OR rate_n < ?)`).bind(today, today, me.id, today, max).run();
    if (!slot.meta.changes) return json({ ok: false, error: `Mỗi ngày chỉ đánh giá được ${max} truyện.` }, 429);
    const ins = await db.prepare('INSERT OR IGNORE INTO ratings (user_id, track_id, stars, created_at) VALUES (?, ?, ?, ?)').bind(me.id, trackId, stars, now()).run();
    if (!ins.meta.changes) {
      await db.prepare('UPDATE users SET rate_n = MAX(0, rate_n - 1) WHERE id = ? AND rate_day = ?').bind(me.id, today).run();
      return json({ ok: false, error: 'Bạn đã đánh giá truyện này rồi.' }, 400);
    }
    await db.prepare('UPDATE tracks SET rating_sum = rating_sum + ?, rating_count = rating_count + 1 WHERE id = ?').bind(stars, trackId).run();
    const rewards = await awardExp(db, s, me.id, 1, `Đánh giá ${stars} sao: ${track.title}`);
    const tr = await first(db, 'SELECT rating_sum, rating_count FROM tracks WHERE id = ?', trackId);
    return json({ ok: true, mine: stars, sum: tr.rating_sum, count: tr.rating_count, rewards });
  }

  return null;
}

// Bảng xếp hạng (lưu đệm phía gọi).
export async function leaderboard(db, limit = 50) {
  const rows = await all(db, 'SELECT id, name, avatar, exp, comments_n FROM users WHERE banned = 0 AND exp > 0 ORDER BY exp DESC, id LIMIT ?', limit);
  return rows.map(r => ({ ...r, ...badge(r.exp) }));
}
