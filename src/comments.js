// Bình luận + đăng nhập Google cho người nghe.
import { all, first, loadSettings, saveSettings } from './db.js';
import { json, now, getCookie, setCookie, signToken, readToken, randomId, imageType, toBase64 } from './util.js';
import { verifyGoogleToken } from './google.js';
import { logEvent } from './security.js';

const USER_COOKIE = 'aw_user';
const USER_DAYS = 60;
const MAX_LEN = 1000;
const MIN_GAP = 15;        // giây giữa hai bình luận của cùng một người
const MAX_PER_DAY = 50;    // bình luận / người / ngày

function sameOrigin(request) {
  const o = request.headers.get('Origin');
  return !o || o === new URL(request.url).origin;
}

async function userSecret(db) {
  const row = await first(db, "SELECT v FROM settings WHERE k = 'user_secret'");
  if (row && row.v) return row.v;
  const v = randomId(40);
  await saveSettings(db, { user_secret: v });
  return v;
}

// Người dùng đang đăng nhập (hoặc null).
export async function currentUser(request, db) {
  const tok = getCookie(request, USER_COOKIE);
  if (!tok) return null;
  const p = await readToken(await userSecret(db), tok);
  if (!p) return null;
  return first(db, 'SELECT id, name, email, avatar, banned, avatar_locked, name_changed_at, created_at FROM users WHERE id = ?', p.uid);
}

const publicUser = u => u && { id: u.id, name: u.name, avatar: u.avatar, banned: !!u.banned };
// Thông tin đầy đủ hơn, chỉ trả cho chính chủ.
const selfUser = u => u && { ...publicUser(u), email: u.email || '', created_at: u.created_at || 0, customAvatar: !!u.avatar_locked };

const NAME_GAP = 60; // giây giữa hai lần đổi tên

async function deleteMedia(db, path) {
  const m = String(path || '').match(/^\/media\/([A-Za-z0-9]+)\./);
  if (m) await db.prepare('DELETE FROM media WHERE id = ?').bind(m[1]).run();
}

function withCookie(res, cookie) {
  const out = new Response(res.body, res);
  out.headers.append('Set-Cookie', cookie);
  return out;
}

export async function handleCommentsApi(request, db, path, info, ctx) {
  const url = new URL(request.url);
  const s = await loadSettings(db);
  const enabled = s.comments_enabled === '1';

  // Danh sách bình luận của một audio (đã duyệt + bình luận chờ duyệt của chính mình).
  if (path === '/api/comments' && request.method === 'GET') {
    const trackId = parseInt(url.searchParams.get('track'), 10) || 0;
    const me = await currentUser(request, db);
    const config = { enabled, clientId: s.google_client_id || '', moderation: s.comment_moderation === '1' };
    if (!enabled || !trackId) return json({ ok: true, me: publicUser(me), config, total: 0, items: [] });
    const rows = await all(db, `SELECT c.id, c.parent_id, c.body, c.status, c.likes, c.created_at, c.user_id, u.name, u.avatar
      FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.track_id = ? AND (c.status = 'approved' OR (c.status = 'pending' AND c.user_id = ?))
      ORDER BY c.created_at DESC LIMIT 300`, trackId, me ? me.id : -1);
    let liked = new Set();
    if (me && rows.length) {
      const ids = rows.map(r => r.id);
      const lk = await all(db, `SELECT comment_id FROM comment_likes WHERE user_id = ? AND comment_id IN (${ids.map(() => '?').join(',')})`, me.id, ...ids);
      liked = new Set(lk.map(r => r.comment_id));
    }
    const items = rows.map(r => ({
      id: r.id, parent: r.parent_id, body: r.body, pending: r.status === 'pending', likes: r.likes, at: r.created_at,
      name: r.name, avatar: r.avatar, mine: !!me && r.user_id === me.id, liked: liked.has(r.id),
    }));
    return json({ ok: true, me: publicUser(me), config, total: items.filter(i => !i.pending).length, items });
  }

  // Thông tin người đang đăng nhập (cho thanh đầu trang).
  if (path === '/api/me') {
    const me = await currentUser(request, db);
    return json({ ok: true, me: selfUser(me), clientId: s.google_client_id || '', avatarMaxMb: +s.avatar_max_mb || 5 });
  }

  // Lịch sử nghe của người đang đăng nhập.
  if (path === '/api/history' && request.method === 'GET') {
    const me = await currentUser(request, db);
    if (!me) return json({ ok: false, error: 'Vui lòng đăng nhập.' }, 401);
    const items = await all(db, `SELECT h.track_id id, h.part, h.pos, h.dur, h.updated_at at, t.title, t.slug, t.duration total,
        (SELECT COUNT(*) FROM parts p WHERE p.track_id = t.id) nparts
      FROM history h JOIN tracks t ON t.id = h.track_id AND t.published = 1
      WHERE h.user_id = ? ORDER BY h.updated_at DESC LIMIT 100`, me.id);
    return json({ ok: true, items });
  }

  if (request.method !== 'POST') return json({ ok: false }, 405);
  if (!sameOrigin(request)) return json({ ok: false, error: 'Yêu cầu không hợp lệ.' }, 400);
  // Tải ảnh đại diện (multipart). Trình duyệt đã cắt vuông + nén nhỏ trước khi gửi.
  if (path === '/api/profile/avatar') {
    const me = await currentUser(request, db);
    if (!me) return json({ ok: false, error: 'Vui lòng đăng nhập.' }, 401);
    const maxMb = Math.max(0.2, parseFloat(s.avatar_max_mb) || 5);
    const len = parseInt(request.headers.get('Content-Length'), 10) || 0;
    if (len > maxMb * 1024 * 1024 + 4096) return json({ ok: false, error: `Ảnh tối đa ${maxMb}MB.` }, 413);
    let file;
    try { file = (await request.formData()).get('avatar'); } catch (e) { /* bỏ qua */ }
    if (!file || typeof file === 'string' || !file.size) return json({ ok: false, error: 'Chưa chọn ảnh.' }, 400);
    if (file.size > maxMb * 1024 * 1024) return json({ ok: false, error: `Ảnh tối đa ${maxMb}MB.` }, 413);
    if (file.size > 1024 * 1024) return json({ ok: false, error: 'Ảnh sau khi nén vẫn quá lớn, thử ảnh khác.' }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = imageType(bytes);
    if (!type || type === 'image/x-icon') return json({ ok: false, error: 'Chỉ nhận ảnh JPG, PNG, WebP hoặc GIF.' }, 400);
    const id = randomId(20);
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[type];
    await db.prepare('INSERT INTO media (id, type, data, created_at) VALUES (?, ?, ?, ?)').bind(id, type, toBase64(bytes), now()).run();
    if (me.avatar_locked) await deleteMedia(db, me.avatar);
    const url = `/media/${id}.${ext}`;
    await db.prepare('UPDATE users SET avatar = ?, avatar_locked = 1 WHERE id = ?').bind(url, me.id).run();
    return json({ ok: true, avatar: url });
  }

  let input = {};
  try { input = await request.json(); } catch (e) { /* bỏ qua */ }

  // Đăng nhập bằng Google: nhận ID token từ nút Google, xác minh rồi tạo phiên.
  if (path === '/api/auth/google') {
    if (!s.google_client_id) return json({ ok: false, error: 'Web chưa cấu hình đăng nhập Google.' }, 400);
    let g;
    try {
      g = await verifyGoogleToken(input.credential, s.google_client_id);
    } catch (e) {
      await logEvent(db, info, 'login_fail', 'google: ' + e.message);
      return json({ ok: false, error: 'Đăng nhập Google không thành công, vui lòng thử lại.' }, 401);
    }
    const t = now();
    await db.prepare(`INSERT INTO users (sub, name, email, avatar, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(sub) DO UPDATE SET email = excluded.email, last_login = excluded.last_login,
        name = CASE WHEN users.name_locked = 1 THEN users.name ELSE excluded.name END,
        avatar = CASE WHEN users.avatar_locked = 1 THEN users.avatar ELSE excluded.avatar END`)
      .bind(g.sub, g.name, g.email, g.avatar, t, t).run();
    const u = await first(db, 'SELECT id, name, avatar, banned FROM users WHERE sub = ?', g.sub);
    const token = await signToken(await userSecret(db), { uid: u.id, exp: t + USER_DAYS * 86400 });
    return withCookie(json({ ok: true, me: publicUser(u) }), setCookie(USER_COOKIE, token, { maxAge: USER_DAYS * 86400 }));
  }

  if (path === '/api/auth/logout') {
    return withCookie(json({ ok: true }), setCookie(USER_COOKIE, '', { maxAge: 0 }));
  }

  const me = await currentUser(request, db);
  if (!me) return json({ ok: false, error: 'Vui lòng đăng nhập để bình luận.' }, 401);
  if (me.banned && path.startsWith('/api/comments')) return json({ ok: false, error: 'Tài khoản của bạn đã bị khóa bình luận.' }, 403);

  // Đổi tên hiển thị.
  if (path === '/api/profile') {
    const name = String(input.name || '').replace(/[\u0000-\u001f\u200b-\u200f\u2028-\u202e]/g, '').replace(/\s+/g, ' ').trim();
    if ([...name].length < 2 || [...name].length > 40) return json({ ok: false, error: 'Tên cần từ 2 đến 40 ký tự.' }, 400);
    if (/(https?:|www\.|\.(com|net|vn|xyz|top|io|me|link)\b)/i.test(name)) return json({ ok: false, error: 'Tên không được chứa đường link.' }, 400);
    if (name !== me.name && now() - (me.name_changed_at || 0) < NAME_GAP) return json({ ok: false, error: 'Bạn vừa đổi tên, đợi một phút rồi thử lại.' }, 429);
    await db.prepare('UPDATE users SET name = ?, name_locked = 1, name_changed_at = ? WHERE id = ?').bind(name, now(), me.id).run();
    return json({ ok: true, name });
  }

  // Bỏ ảnh tự tải lên, quay lại ảnh Google ở lần đăng nhập sau.
  if (path === '/api/profile/avatar/delete') {
    if (me.avatar_locked) await deleteMedia(db, me.avatar);
    await db.prepare("UPDATE users SET avatar = '', avatar_locked = 0 WHERE id = ?").bind(me.id).run();
    return json({ ok: true });
  }

  // Lưu vị trí đang nghe (gửi định kỳ khi đang phát, khi tạm dừng, khi rời trang).
  if (path === '/api/history') {
    const trackId = parseInt(input.track_id, 10) || 0;
    if (trackId <= 0) return json({ ok: false }, 400);
    const part = Math.max(0, parseInt(input.part, 10) || 0);
    const pos = Math.max(0, Math.floor(+input.pos || 0));
    const dur = Math.max(0, Math.floor(+input.dur || 0));
    await db.prepare(`INSERT INTO history (user_id, track_id, part, pos, dur, updated_at)
      SELECT ?, id, ?, ?, ?, ? FROM tracks WHERE id = ? AND published = 1
      ON CONFLICT(user_id, track_id) DO UPDATE SET part = excluded.part, pos = excluded.pos, dur = excluded.dur, updated_at = excluded.updated_at`)
      .bind(me.id, part, pos, dur, now(), trackId).run();
    return json({ ok: true });
  }

  if (path === '/api/history/delete') {
    if (input.all) await db.prepare('DELETE FROM history WHERE user_id = ?').bind(me.id).run();
    else await db.prepare('DELETE FROM history WHERE user_id = ? AND track_id = ?').bind(me.id, parseInt(input.track_id, 10) || 0).run();
    return json({ ok: true });
  }

  // Viết bình luận / trả lời.
  if (path === '/api/comments') {
    if (!enabled) return json({ ok: false, error: 'Bình luận đang tắt.' }, 400);
    const trackId = parseInt(input.track_id, 10) || 0;
    let parent = parseInt(input.parent_id, 10) || 0;
    const body = String(input.body || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!body) return json({ ok: false, error: 'Bạn chưa nhập nội dung.' }, 400);
    if (body.length > MAX_LEN) return json({ ok: false, error: `Bình luận tối đa ${MAX_LEN} ký tự.` }, 400);
    if (!(await first(db, 'SELECT 1 x FROM tracks WHERE id = ? AND published = 1', trackId))) return json({ ok: false }, 404);
    if (parent) {
      // Chỉ cho trả lời 1 cấp: trả lời một câu trả lời thì gắn vào bình luận gốc.
      const p = await first(db, 'SELECT id, parent_id FROM comments WHERE id = ? AND track_id = ?', parent, trackId);
      if (!p) return json({ ok: false, error: 'Bình luận gốc không còn.' }, 404);
      parent = p.parent_id || p.id;
    }
    const t = now();
    const recent = await first(db, 'SELECT COUNT(*) c, MAX(created_at) last FROM comments WHERE user_id = ? AND created_at > ?', me.id, t - 86400);
    if (recent.last && t - recent.last < MIN_GAP) return json({ ok: false, error: 'Bạn bình luận nhanh quá, đợi vài giây nhé.' }, 429);
    if (recent.c >= MAX_PER_DAY) {
      await logEvent(db, info, 'comment_spam', `user ${me.id}: ${recent.c} bình luận/ngày`);
      return json({ ok: false, error: 'Bạn đã bình luận quá nhiều hôm nay.' }, 429);
    }
    // Bình luận có link luôn phải chờ duyệt (chống spam quảng cáo).
    const hasLink = /(https?:\/\/|www\.|\.(com|net|vn|xyz|top|info|io|me|link)\b)/i.test(body);
    const status = s.comment_moderation === '1' || hasLink ? 'pending' : 'approved';
    const r = await db.prepare('INSERT INTO comments (track_id, user_id, parent_id, body, status, created_at, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(trackId, me.id, parent, body, status, t, info.ip).run();
    return json({
      ok: true,
      item: { id: r.meta.last_row_id, parent, body, pending: status === 'pending', likes: 0, at: t, name: me.name, avatar: me.avatar, mine: true, liked: false },
    });
  }

  // Thích / bỏ thích.
  if (path === '/api/comments/like') {
    const id = parseInt(input.id, 10) || 0;
    const c = await first(db, "SELECT id FROM comments WHERE id = ? AND status = 'approved'", id);
    if (!c) return json({ ok: false }, 404);
    const del = await db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?').bind(id, me.id).run();
    const liked = del.meta.changes === 0;
    if (liked) await db.prepare('INSERT OR IGNORE INTO comment_likes (comment_id, user_id) VALUES (?, ?)').bind(id, me.id).run();
    await db.prepare('UPDATE comments SET likes = (SELECT COUNT(*) FROM comment_likes WHERE comment_id = ?) WHERE id = ?').bind(id, id).run();
    const n = await first(db, 'SELECT likes FROM comments WHERE id = ?', id);
    return json({ ok: true, liked, likes: n.likes });
  }

  // Xóa bình luận của chính mình (kèm các trả lời).
  if (path === '/api/comments/delete') {
    const id = parseInt(input.id, 10) || 0;
    const c = await first(db, 'SELECT id FROM comments WHERE id = ? AND user_id = ?', id, me.id);
    if (!c) return json({ ok: false }, 404);
    await db.batch([
      db.prepare('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE id = ? OR parent_id = ?)').bind(id, id),
      db.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(id, id),
    ]);
    return json({ ok: true });
  }

  return json({ ok: false, error: 'not_found' }, 404);
}
