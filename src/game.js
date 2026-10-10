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
  rate_stones: '10',        // Linh Thạch mỗi lần đánh giá truyện
  rate_exp: '5',            // EXP mỗi lần đánh giá truyện
  heart_stones: '1',        // Linh Thạch mỗi lần thả tim truyện
  heart_exp: '1',           // EXP mỗi lần thả tim truyện
  heart_daily: '50',        // số truyện được thả tim mỗi ngày
  comment_like_daily: '50', // số lượt thả tim bình luận mỗi ngày
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

const heartHits = new Map(); // userId → các lần bấm tim gần đây (bộ nhớ tạm của máy chủ)
// Chống spam chung: quá `max` lần trong `ms` mili giây với cùng một khóa thì trả true (không đụng cơ sở dữ liệu).
const spamHits = new Map();
function tooFast(key, max, ms) {
  const t = Date.now(), list = (spamHits.get(key) || []).filter(x => t - x < ms);
  list.push(t); spamHits.set(key, list);
  if (spamHits.size > 10000) spamHits.clear();
  return list.length > max;
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
    await db.prepare('UPDATE users SET seen_day = ?, seen_at = ?, online_sec = 0, online_at = 0 WHERE id = ?').bind(today, t, me.id).run();
    me.seen_day = today; me.seen_at = t; me.online_sec = 0;
  }
  const unread = (await first(db, 'SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND is_read = 0', me.id)).c;
  const checkedIn = me.checkin_day === today;
  return {
    exp: me.exp || 0,
    stones: me.stones || 0,
    comments: me.comments_n || 0,
    level: levelInfo(me.exp),
    checkedIn,
    checkinIn: checkedIn ? 0 : Math.max(0, num(s, 'checkin_wait') - (me.online_sec || 0)),
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
    // Phân trang: ?before=<id> lấy các thông báo cũ hơn; ?id=<id> lấy đúng một thông báo (xem chi tiết).
    const before = parseInt(url.searchParams.get('before'), 10) || 0;
    const one = parseInt(url.searchParams.get('id'), 10) || 0;
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 30));
    const items = await all(db, `SELECT n.id, n.type, n.text, n.is_read, n.created_at, n.comment_id, a.name actor, a.avatar actor_avatar, a.exp actor_exp, t.slug, t.title
      FROM notifications n LEFT JOIN users a ON a.id = n.actor_id LEFT JOIN tracks t ON t.id = n.track_id
      WHERE n.user_id = ?${one ? ' AND n.id = ?' : before ? ' AND n.id < ?' : ''} ORDER BY n.id DESC LIMIT ?`, me.id, ...(one ? [one] : before ? [before] : []), limit);
    return json({ ok: true, more: items.length === limit, items: items.map(n => ({ ...n, actor_badge: n.actor ? badge(n.actor_exp) : null })) });
  }

  // Bắn tim truyện: mỗi tài khoản 1 lần / truyện, không thể bỏ (chèn có điều kiện nên bấm dồn cũng chỉ tính 1).
  if (path === '/api/heart') {
    // Chống spam phía máy chủ: quá 5 lần / 10 giây mỗi tài khoản thì trả lỗi ngay, không đụng cơ sở dữ liệu.
    const t0 = Date.now(), list = (heartHits.get(me.id) || []).filter(x => t0 - x < 10000);
    list.push(t0); heartHits.set(me.id, list);
    if (heartHits.size > 5000) heartHits.clear();
    if (list.length > 5) return json({ ok: false, error: 'Thao tác quá nhanh, thử lại sau ít giây.' }, 429);
    const trackId = parseInt(input.track_id, 10) || 0;
    const tr0 = await first(db, 'SELECT title FROM tracks WHERE id = ? AND published = 1', trackId);
    if (!tr0) return json({ ok: false }, 404);
    if (await first(db, 'SELECT 1 x FROM track_hearts WHERE user_id = ? AND track_id = ?', me.id, trackId)) {
      const tr = await first(db, 'SELECT hearts FROM tracks WHERE id = ?', trackId);
      return json({ ok: true, added: false, count: tr.hearts, mine: true });
    }
    // Giữ 1 lượt trong ngày (nguyên tử): tối đa heart_daily truyện / ngày.
    const today = vnDay(), max = num(s, 'heart_daily');
    const slot = await db.prepare(`UPDATE users SET heart_n = CASE WHEN heart_day = ? THEN heart_n + 1 ELSE 1 END, heart_day = ?
      WHERE id = ? AND (heart_day != ? OR heart_n < ?)`).bind(today, today, me.id, today, max).run();
    if (!slot.meta.changes) return json({ ok: false, limit: true, error: `Mỗi ngày chỉ thả tim được ${max} truyện, mai quay lại nhé!` }, 429);
    const r = await db.prepare('INSERT OR IGNORE INTO track_hearts (user_id, track_id, created_at) VALUES (?, ?, ?)').bind(me.id, trackId, now()).run();
    let rewards = [];
    if (r.meta.changes) {
      await db.prepare('UPDATE tracks SET hearts = hearts + 1 WHERE id = ?').bind(trackId).run();
      const st = num(s, 'heart_stones'), ex = num(s, 'heart_exp');
      if (st) {
        await db.prepare('UPDATE users SET stones = stones + ? WHERE id = ?').bind(st, me.id).run();
        await walletLog(db, me.id, 'stones', st, `Thả tim: ${tr0.title}`);
        rewards.push({ type: 'stones', n: st });
      }
      if (ex) rewards.push(...await awardExp(db, s, me.id, ex, `Thả tim: ${tr0.title}`));
    } else {
      // Bấm trùng đồng thời: trả lại lượt vừa giữ.
      await db.prepare('UPDATE users SET heart_n = MAX(0, heart_n - 1) WHERE id = ? AND heart_day = ?').bind(me.id, today).run();
    }
    const tr = await first(db, 'SELECT hearts FROM tracks WHERE id = ?', trackId);
    return json({ ok: true, added: !!r.meta.changes, count: tr.hearts, mine: true, rewards });
  }

  // Cộng thời gian đang mở tab web. Mỗi lần tối đa 20 giây và không quá thời gian thật trôi qua kể từ lần báo trước.
  if (path === '/api/online') {
    const t = now(), today = vnDay();
    const need = num(s, 'checkin_wait');
    const u = await first(db, 'SELECT seen_day, online_sec, online_at, checkin_day FROM users WHERE id = ?', me.id);
    if (u.checkin_day === today) return json({ ok: true, sec: need, need, left: 0 });
    const same = u.seen_day === today;
    const before = same ? u.online_sec : 0;
    const gap = same && u.online_at ? t - u.online_at + 2 : 20;
    const credit = Math.max(0, Math.min(Math.floor(+input.sec || 0), 20, gap));
    const after = Math.min(need, before + credit);
    const w = await db.prepare(`UPDATE users SET seen_day = ?, seen_at = CASE WHEN seen_day = ? THEN seen_at ELSE ? END, online_sec = ?, online_at = ?
      WHERE id = ? AND online_at = ? AND seen_day = ?`).bind(today, today, t, after, t, me.id, u.online_at, u.seen_day).run();
    const sec = w.meta.changes ? after : before;
    return json({ ok: true, sec, need, left: Math.max(0, need - sec) });
  }

  // Điểm danh hằng ngày: phải online đủ thời gian trong ngày.
  if (path === '/api/checkin') {
    const t = now(), today = vnDay();
    if (me.checkin_day === today) return json({ ok: false, error: 'Hôm nay bạn đã điểm danh rồi.' }, 400);
    // Chỉ tính thời gian đang mở tab web (máy khách báo về, máy chủ kiểm tra lại) — treo web rồi sang tab khác không được tính.
    const wait = num(s, 'checkin_wait') - (me.seen_day === today ? me.online_sec || 0 : 0);
    if (me.seen_day !== today || wait > 0) {
      if (me.seen_day !== today) await db.prepare('UPDATE users SET seen_day = ?, seen_at = ?, online_sec = 0, online_at = 0 WHERE id = ?').bind(today, t, me.id).run();
      return json({ ok: false, error: 'Chưa đủ thời gian online trên web.', wait: Math.max(1, Math.ceil(me.seen_day === today ? wait : num(s, 'checkin_wait'))) }, 400);
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
    if (tooFast('rate' + me.id, 5, 10000)) return json({ ok: false, silent: true, error: 'Thao tác quá nhanh.' }, 429);
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
    // Thưởng mỗi lần đánh giá (mỗi truyện chỉ 1 lần nhờ khóa chính user/track).
    const rewards = [];
    const st = num(s, 'rate_stones'), ex = num(s, 'rate_exp');
    if (st) {
      await db.prepare('UPDATE users SET stones = stones + ? WHERE id = ?').bind(st, me.id).run();
      await walletLog(db, me.id, 'stones', st, `Đánh giá ${stars} sao: ${track.title}`);
      rewards.push({ type: 'stones', n: st });
    }
    if (ex) rewards.push(...await awardExp(db, s, me.id, ex, `Đánh giá ${stars} sao: ${track.title}`));
    const tr = await first(db, 'SELECT rating_sum, rating_count FROM tracks WHERE id = ?', trackId);
    return json({ ok: true, mine: stars, sum: tr.rating_sum, count: tr.rating_count, rewards });
  }

  return null;
}

// Bảng xếp hạng (lưu đệm phía gọi): cấp độ, Linh Thạch, bình luận, tim nhận được trên bình luận.
export const BOARDS = ['level', 'stones', 'comments', 'hearts'];
export async function leaderboard(db, kind = 'level', limit = 50) {
  const base = 'SELECT u.id, u.name, u.avatar, u.exp, u.stones, u.comments_n FROM users u WHERE u.banned = 0 AND u.locked = 0';
  let rows;
  if (kind === 'stones') rows = await all(db, `${base} AND u.stones > 0 ORDER BY u.stones DESC, u.id LIMIT ?`, limit);
  else if (kind === 'comments') rows = await all(db, `${base} AND u.comments_n > 0 ORDER BY u.comments_n DESC, u.exp DESC LIMIT ?`, limit);
  else if (kind === 'hearts') {
    // Tim người khác thả vào bình luận của mình (tự thả tim cho mình không tính).
    rows = await all(db, `SELECT u.id, u.name, u.avatar, u.exp, u.stones, u.comments_n, h.n hearts FROM (
        SELECT c.user_id uid, COUNT(*) n FROM comment_likes l JOIN comments c ON c.id = l.comment_id
        WHERE c.status = 'approved' AND l.user_id != c.user_id GROUP BY c.user_id) h
      JOIN users u ON u.id = h.uid WHERE u.banned = 0 AND u.locked = 0 ORDER BY h.n DESC, u.exp DESC LIMIT ?`, limit);
  } else rows = await all(db, `${base} AND u.exp > 0 ORDER BY u.exp DESC, u.id LIMIT ?`, limit);
  return rows.map(r => ({ ...r, ...badge(r.exp) }));
}
