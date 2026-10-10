// Bình luận + đăng nhập Google cho người nghe.
import { all, first, loadSettings, saveSettings } from './db.js';
import { vnDay, json, now, getCookie, setCookie, signToken, readToken, randomId, imageType, toBase64, hashPassword, verifyPassword } from './util.js';
import { verifyGoogleToken } from './google.js';
import { deviceOf, logEvent, recentHits } from './security.js';
import { checkIp } from './proxycheck.js';
import { mailConfig, sendMail, resetMailHtml } from './mailer.js';
import { attachReferrer, handleReferralApi } from './referral.js';
import { gameStats, handleGameApi, onCommentApproved, notify } from './game.js';
import { handleQuestApi, questStats, onCommentQuest } from './quests.js';
import { badge } from './levels.js';
import { matchWords } from './wordfilter.js';
import { handleWithdrawApi } from './withdraw.js';

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
  const u = await first(db, `SELECT id, name, email, avatar, banned, avatar_locked, name_changed_at, created_at, exp, stones, comments_n,
    checkin_day, seen_day, seen_at, rate_day, rate_n, cexp_day, cexp_n, locked, session_ver, listen_day, listen_sec, last_seen, online_sec, role FROM users WHERE id = ?`, p.uid);
  // Tài khoản bị khóa, hoặc admin đã "đăng xuất mọi thiết bị" (session_ver tăng) thì phiên cũ hết hiệu lực.
  if (!u || u.locked || (p.v || 0) !== (u.session_ver || 0)) return null;
  if (p.demo) u.demo = true; // admin đang xem thử tài khoản này
  return u;
}

// Admin "đăng nhập vào tài khoản thành viên" ở chế độ xem thử: phiên 1 giờ, chỉ xem, không thao tác được gì.
export async function demoLoginCookie(db, u) {
  const token = await signToken(await userSecret(db), { uid: u.id, v: u.session_ver || 0, exp: now() + 3600, demo: 1 });
  return setCookie(USER_COOKIE, token, { maxAge: 3600 });
}

const publicUser = u => u && { id: u.id, name: u.name, avatar: u.avatar, banned: !!u.banned, ...badge(u.exp) };
// Thông tin đầy đủ hơn, chỉ trả cho chính chủ.
const selfUser = u => u && { ...publicUser(u), email: u.email || '', created_at: u.created_at || 0, customAvatar: !!u.avatar_locked, demo: !!u.demo, editor: u.role === 'editor' && !u.demo };

// Kiểm tra trước khi tạo tài khoản mới (Google hoặc email): giới hạn số tài khoản / IP, chặn VPN / Proxy.
async function newAccountGuard(db, s, info, email) {
  const limit = Math.max(0, parseInt(s.reg_per_ip, 10) || 0);
  if (limit) {
    const n = (await first(db, 'SELECT COUNT(*) c FROM users WHERE reg_ip = ?', info.ip)).c;
    if (n >= limit) {
      await logEvent(db, info, 'reg_limit', `${email} · IP đã có ${n} tài khoản`);
      return json({ ok: false, error: `Mỗi mạng (IP) chỉ được tạo tối đa ${limit} tài khoản. Nếu đã có tài khoản, hãy đăng nhập.` }, 403);
    }
  }
  const key = info.proxyKey || s.proxycheck_key;
  if (s.reg_block_proxy !== '0' && key) {
    const r = await checkIp(db, key, info.ip);
    if (r && r.proxy) {
      await logEvent(db, info, 'reg_proxy', `${email} · ${r.type || 'Proxy'}${r.provider ? ' · ' + r.provider : ''}`);
      return json({ ok: false, error: 'Không thể tạo tài khoản khi đang dùng VPN / Proxy. Vui lòng tắt VPN rồi thử lại.' }, 403);
    }
  }
  return null;
}

async function sha256(t) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}

// Tạo phiên đăng nhập (cookie) cho người dùng.
async function loginResponse(db, u, extraCookie) {
  const token = await signToken(await userSecret(db), { uid: u.id, v: u.session_ver || 0, exp: now() + USER_DAYS * 86400 });
  const res = withCookie(json({ ok: true, me: publicUser(u) }), setCookie(USER_COOKIE, token, { maxAge: USER_DAYS * 86400 }));
  return extraCookie ? withCookie(res, extraCookie) : res;
}

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
    const rows = await all(db, `SELECT c.id, c.parent_id, c.body, c.status, c.likes, c.created_at, c.user_id, u.name, u.avatar, u.exp
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
      name: r.name, avatar: r.avatar, mine: !!me && r.user_id === me.id, liked: liked.has(r.id), ...badge(r.exp),
    }));
    return json({ ok: true, me: publicUser(me), config, total: items.filter(i => !i.pending).length, items });
  }

  // Thông tin người đang đăng nhập (cho thanh đầu trang).
  if (path === '/api/me') {
    const me = await currentUser(request, db);
    // Ghi thời điểm hoạt động, IP, thiết bị (tối đa 1 lần / 5 phút để đỡ ghi D1).
    if (me && !me.demo && now() - (me.last_seen || 0) > 300) {
      const job = db.prepare('UPDATE users SET last_seen = ?, last_ip = ?, device = ? WHERE id = ?').bind(now(), info.ip, deviceOf(info.ua), me.id).run();
      if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
    }
    // Đường dẫn trang quản trị chỉ gửi cho biên tập viên (người thường không biết link admin).
    return json({ ok: true, editorUrl: me && me.role === 'editor' && !me.demo ? '/bien-tap' : '', me: selfUser(me), game: me ? { ...await gameStats(db, s, me), quests: await questStats(db, s, me) } : null, clientId: s.google_client_id || '', avatarMaxMb: +s.avatar_max_mb || 5 });
  }

  if (request.method === 'GET' && path === '/api/withdraw') {
    const me = await currentUser(request, db);
    if (!me) return json({ ok: false, error: 'Vui lòng đăng nhập.' }, 401);
    return handleWithdrawApi(request, db, s, path, me, {}, info);
  }
  // Bắn tim: số tim của truyện + mình đã bắn chưa (khách cũng xem được số tim).
  if (request.method === 'GET' && path === '/api/heart') {
    const trackId = parseInt(url.searchParams.get('track'), 10) || 0;
    const me = await currentUser(request, db);
    const [tr, mine] = await Promise.all([
      first(db, 'SELECT hearts FROM tracks WHERE id = ?', trackId),
      me ? first(db, 'SELECT 1 x FROM track_hearts WHERE user_id = ? AND track_id = ?', me.id, trackId) : null,
    ]);
    return json({ ok: true, count: tr ? tr.hearts : 0, mine: !!mine });
  }
  if (request.method === 'GET' && path === '/api/referral') {
    const me = await currentUser(request, db);
    if (!me) return json({ ok: false, error: 'Vui lòng đăng nhập.' }, 401);
    return handleReferralApi(request, db, s, me);
  }
  if (request.method === 'GET' && (path === '/api/notifications' || path === '/api/rate')) {
    const me = await currentUser(request, db);
    if (!me) return json({ ok: false, error: 'Vui lòng đăng nhập.' }, 401);
    return handleGameApi(request, db, s, path, me, {});
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
    let isNew = !(await first(db, 'SELECT id FROM users WHERE sub = ?', g.sub));
    // Tài khoản MỚI: giới hạn số tài khoản mỗi IP và chặn đăng ký qua proxy / VPN (chống clone, tài khoản ảo).
    if (isNew) {
      // Đã đăng ký bằng email trước đó (cùng địa chỉ Gmail): gộp vào tài khoản cũ thay vì tạo tài khoản mới.
      const old = g.email ? await first(db, "SELECT id FROM users WHERE email = ? AND sub LIKE 'email:%'", String(g.email).toLowerCase()) : null;
      if (old) { await db.prepare('UPDATE users SET sub = ? WHERE id = ?').bind(g.sub, old.id).run(); isNew = false; }
      else {
        const block = await newAccountGuard(db, s, info, g.email);
        if (block) return block;
      }
    }
    await db.prepare(`INSERT INTO users (sub, name, email, avatar, created_at, last_login, reg_ip, last_ip, country, device, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sub) DO UPDATE SET email = excluded.email, last_login = excluded.last_login, last_ip = excluded.last_ip, country = excluded.country,
        device = excluded.device, last_seen = excluded.last_seen,
        name = CASE WHEN users.name_locked = 1 THEN users.name ELSE excluded.name END,
        avatar = CASE WHEN users.avatar_locked = 1 THEN users.avatar ELSE excluded.avatar END`)
      .bind(g.sub, g.name, g.email, g.avatar, t, t, info.ip, info.ip, info.country, deviceOf(info.ua), t).run();
    const u = await first(db, 'SELECT id, name, avatar, banned, exp, locked, session_ver FROM users WHERE sub = ?', g.sub);
    if (u.locked) return json({ ok: false, error: 'Tài khoản của bạn đã bị khóa. Liên hệ quản trị viên nếu có nhầm lẫn.' }, 403);
    // Tài khoản mới đến từ link giới thiệu: ghi nhận người mời (đã kiểm tra chống tự mời / cùng IP).
    const refCookie = isNew ? await attachReferrer(db, s, request, u.id, info.ip) : '';
    return loginResponse(db, u, refCookie);
  }

  // ---------- Đăng ký / đăng nhập bằng email ----------
  if (path === '/api/auth/register') {
    if (s.email_auth === '0') return json({ ok: false, error: 'Đăng ký bằng email đang tạm đóng.' }, 403);
    const email = String(input.email || '').trim().toLowerCase();
    const pass = String(input.password || ''), pass2 = String(input.password2 || '');
    const refCode = String(input.ref || '').trim();
    if (!/^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/i.test(email) || email.length > 120) return json({ ok: false, error: 'Email không hợp lệ.' }, 400);
    if (pass.length < 8 || !/[a-zA-Z]/.test(pass) || !/\d/.test(pass)) return json({ ok: false, error: 'Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số.' }, 400);
    if (pass.length > 100) return json({ ok: false, error: 'Mật khẩu quá dài.' }, 400);
    if (pass !== pass2) return json({ ok: false, error: 'Hai mật khẩu không khớp.' }, 400);
    if (refCode && !/^[A-Za-z0-9]{8}$/.test(refCode)) return json({ ok: false, error: 'Mã giới thiệu không hợp lệ (8 ký tự chữ và số).' }, 400);
    // Chống spam đăng ký: mỗi IP tối đa 5 lần thử / giờ.
    if (await recentHits(db, 'reg_try', 3600, info.ip) >= 5) return json({ ok: false, error: 'Bạn thử đăng ký quá nhiều lần, vui lòng thử lại sau.' }, 429);
    await logEvent(db, info, 'reg_try', email);
    if (await first(db, 'SELECT 1 x FROM users WHERE email = ? COLLATE NOCASE', email)) {
      return json({ ok: false, error: 'Email này đã có tài khoản. Hãy đăng nhập (nếu là Gmail đã dùng nút Google, hãy đăng nhập bằng Google).' }, 409);
    }
    if (refCode && !(await first(db, 'SELECT 1 x FROM users WHERE ref_code = ?', refCode))) return json({ ok: false, error: 'Mã giới thiệu không tồn tại.' }, 400);
    const block = await newAccountGuard(db, s, info, email);
    if (block) return block;
    const t = now();
    const name = (email.split('@')[0].replace(/[^\p{L}\p{N}._-]/gu, '').slice(0, 30)) || 'Đạo hữu';
    const ins = await db.prepare(`INSERT OR IGNORE INTO users (sub, name, email, avatar, created_at, last_login, reg_ip, last_ip, country, device, last_seen, pass_hash)
      VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`).bind('email:' + email, name, email, t, t, info.ip, info.ip, info.country, deviceOf(info.ua), t, await hashPassword(pass)).run();
    if (!ins.meta.changes) return json({ ok: false, error: 'Email này đã có tài khoản.' }, 409);
    const u = await first(db, 'SELECT id, name, avatar, banned, exp, locked, session_ver FROM users WHERE id = ?', ins.meta.last_row_id);
    const refCookie = await attachReferrer(db, s, request, u.id, info.ip, refCode);
    return loginResponse(db, u, refCookie);
  }

  // ---------- Quên mật khẩu ----------
  if (path === '/api/auth/forgot') {
    const email = String(input.email || '').trim().toLowerCase();
    const generic = json({ ok: true, message: 'Nếu email này đã đăng ký, chúng tôi vừa gửi link đặt lại mật khẩu. Hãy kiểm tra hộp thư (cả mục Spam).' });
    if (!/^[^\s@]{1,64}@[^\s@]+\.[a-z]{2,}$/i.test(email)) return json({ ok: false, error: 'Email không hợp lệ.' }, 400);
    const cfg = mailConfig(s, info, new URL(request.url).origin);
    if (!cfg.ok) return json({ ok: false, error: 'Web chưa bật gửi email. Hãy liên hệ quản trị viên để đặt lại mật khẩu.' }, 503);
    // Chống spam: mỗi IP 5 lần / giờ, mỗi email 3 lần / giờ.
    if (await recentHits(db, 'pw_forgot', 3600, info.ip) >= 5) return json({ ok: false, error: 'Bạn yêu cầu quá nhiều lần, vui lòng thử lại sau.' }, 429);
    await logEvent(db, info, 'pw_forgot', email);
    const u = await first(db, 'SELECT id, name, email, locked FROM users WHERE email = ? COLLATE NOCASE', email);
    if (!u || u.locked) return generic; // không tiết lộ email có tồn tại hay không
    const recent = await first(db, 'SELECT COUNT(*) c FROM password_resets WHERE user_id = ? AND created_at > ?', u.id, now() - 3600);
    if (recent.c >= 3) return generic;
    const token = randomId(40);
    await db.prepare('INSERT INTO password_resets (token_hash, user_id, expires, ip, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256(token), u.id, now() + 1800, info.ip, now()).run();
    const link = `${new URL(request.url).origin}/dat-lai-mat-khau?t=${token}`;
    const r = await sendMail(cfg, u.email, `Đặt lại mật khẩu - ${s.site_name}`, resetMailHtml(s.site_name, u.name, link));
    if (!r.ok) {
      await logEvent(db, info, 'mail_fail', r.error);
      return json({ ok: false, error: 'Chưa gửi được email, vui lòng thử lại sau hoặc liên hệ quản trị viên.' }, 502);
    }
    return generic;
  }

  if (path === '/api/auth/reset') {
    const token = String(input.token || '');
    const pass = String(input.password || ''), pass2 = String(input.password2 || '');
    if (!/^[A-Za-z0-9]{40}$/.test(token)) return json({ ok: false, error: 'Link không hợp lệ.' }, 400);
    if (pass.length < 8 || !/[a-zA-Z]/.test(pass) || !/\d/.test(pass)) return json({ ok: false, error: 'Mật khẩu cần ít nhất 8 ký tự, gồm cả chữ và số.' }, 400);
    if (pass.length > 100) return json({ ok: false, error: 'Mật khẩu quá dài.' }, 400);
    if (pass !== pass2) return json({ ok: false, error: 'Hai mật khẩu không khớp.' }, 400);
    const th = await sha256(token);
    // Đánh dấu đã dùng trong một câu lệnh có điều kiện → link chỉ dùng được 1 lần kể cả khi bấm nhiều lần cùng lúc.
    const row = await first(db, 'UPDATE password_resets SET used = 1 WHERE token_hash = ? AND used = 0 AND expires > ? RETURNING user_id', th, now());
    if (!row) return json({ ok: false, error: 'Link đã hết hạn hoặc đã được dùng. Hãy yêu cầu link mới.' }, 400);
    await db.prepare('UPDATE users SET pass_hash = ?, session_ver = session_ver + 1 WHERE id = ?').bind(await hashPassword(pass), row.user_id).run();
    await db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ?').bind(row.user_id).run();
    const u = await first(db, 'SELECT id, name, avatar, banned, exp, locked, session_ver FROM users WHERE id = ?', row.user_id);
    if (!u || u.locked) return json({ ok: false, error: 'Tài khoản đã bị khóa.' }, 403);
    return loginResponse(db, u, '');
  }

  if (path === '/api/auth/login') {
    const email = String(input.email || '').trim().toLowerCase();
    const pass = String(input.password || '');
    // Khóa đăng nhập: sai 8 lần / 15 phút mỗi IP thì tạm khóa; sai 20 lần / 10 phút thì chặn IP 24 giờ.
    if (await recentHits(db, 'user_login_fail', 900, info.ip) >= 8) return json({ ok: false, error: 'Sai quá nhiều lần, vui lòng thử lại sau 15 phút.' }, 429);
    const u = email ? await first(db, "SELECT id, name, avatar, banned, exp, locked, session_ver, pass_hash FROM users WHERE email = ? COLLATE NOCASE AND pass_hash != ''", email) : null;
    if (!u || !(await verifyPassword(pass, u.pass_hash))) {
      await logEvent(db, info, 'user_login_fail', email.slice(0, 120), { hits: 20, hours: 24 });
      await new Promise(r => setTimeout(r, 500));
      return json({ ok: false, error: 'Sai email hoặc mật khẩu.' }, 401);
    }
    if (u.locked) return json({ ok: false, error: 'Tài khoản của bạn đã bị khóa. Liên hệ quản trị viên nếu có nhầm lẫn.' }, 403);
    await db.prepare('UPDATE users SET last_login = ?, last_ip = ?, country = ?, device = ?, last_seen = ? WHERE id = ?')
      .bind(now(), info.ip, info.country, deviceOf(info.ua), now(), u.id).run();
    return loginResponse(db, u, '');
  }

  if (path === '/api/auth/logout') {
    return withCookie(json({ ok: true }), setCookie(USER_COOKIE, '', { maxAge: 0 }));
  }

  const me = await currentUser(request, db);
  if (!me) return json({ ok: false, error: 'Vui lòng đăng nhập để bình luận.' }, 401);
  // Chế độ xem thử của admin: chặn mọi thao tác ghi (nhận thưởng, rút, bình luận, đổi tên…).
  if (me.demo) return json({ ok: false, error: 'Đang ở chế độ xem thử của admin, không thể thao tác.' }, 403);
  if (path.startsWith('/api/withdraw')) return handleWithdrawApi(request, db, s, path, me, input, info);
  if (path.startsWith('/api/quest/')) return handleQuestApi(request, db, s, path, me, input);
  if (path === '/api/notifications' || path === '/api/checkin' || path === '/api/rate' || path === '/api/online' || path === '/api/heart') {
    return handleGameApi(request, db, s, path, me, input);
  }
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
    // Chứa từ trong bộ lọc của admin cũng phải chờ duyệt.
    const flagged = !hasLink && s.comment_moderation !== '1' && matchWords(body, s.comment_words).length > 0;
    const status = s.comment_moderation === '1' || hasLink || flagged ? 'pending' : 'approved';
    // Chèn có điều kiện: nếu vừa có bình luận khác trong MIN_GAP giây (gửi nhiều yêu cầu cùng lúc) thì bỏ.
    const r = await db.prepare(`INSERT INTO comments (track_id, user_id, parent_id, body, status, created_at, ip)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM comments WHERE user_id = ? AND created_at > ?)`)
      .bind(trackId, me.id, parent, body, status, t, info.ip, me.id, t - MIN_GAP).run();
    if (!r.meta.changes) return json({ ok: false, error: 'Bạn bình luận nhanh quá, đợi vài giây nhé.' }, 429);
    const rewards = status === 'approved'
      ? [...await onCommentApproved(db, s, { id: r.meta.last_row_id, user_id: me.id, parent_id: parent, track_id: trackId, body }), ...await onCommentQuest(db, s, me.id)]
      : [];
    return json({
      ok: true,
      rewards,
      item: { id: r.meta.last_row_id, parent, body, pending: status === 'pending', likes: 0, at: t, name: me.name, avatar: me.avatar, mine: true, liked: false, ...badge(me.exp) },
    });
  }

  // Thích / bỏ thích.
  if (path === '/api/comments/like') {
    const id = parseInt(input.id, 10) || 0;
    const c = await first(db, "SELECT id, user_id, track_id, body FROM comments WHERE id = ? AND status = 'approved'", id);
    if (!c) return json({ ok: false }, 404);
    const del = await db.prepare('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?').bind(id, me.id).run();
    const liked = del.meta.changes === 0;
    if (liked) {
      // Tối đa comment_like_daily lượt thả tim bình luận / ngày (giữ lượt nguyên tử; bỏ thích không hoàn lượt).
      const today = vnDay(), max = Math.max(0, parseFloat(s.comment_like_daily) || 50);
      const slot = await db.prepare(`UPDATE users SET like_n = CASE WHEN like_day = ? THEN like_n + 1 ELSE 1 END, like_day = ?
        WHERE id = ? AND (like_day != ? OR like_n < ?)`).bind(today, today, me.id, today, max).run();
      if (!slot.meta.changes) return json({ ok: false, error: `Mỗi ngày chỉ thả tim được ${max} bình luận.` }, 429);
      const ins = await db.prepare('INSERT OR IGNORE INTO comment_likes (comment_id, user_id) VALUES (?, ?)').bind(id, me.id).run();
      if (!ins.meta.changes) await db.prepare('UPDATE users SET like_n = MAX(0, like_n - 1) WHERE id = ? AND like_day = ?').bind(me.id, today).run();
      const seen = await first(db, "SELECT 1 x FROM notifications WHERE user_id = ? AND type = 'like' AND actor_id = ? AND comment_id = ?", c.user_id, me.id, id);
      if (!seen) await notify(db, c.user_id, 'like', { actor: me.id, track: c.track_id, comment: id, text: c.body.slice(0, 120) });
    }
    await db.prepare('UPDATE comments SET likes = (SELECT COUNT(*) FROM comment_likes WHERE comment_id = ?) WHERE id = ?').bind(id, id).run();
    const n = await first(db, 'SELECT likes FROM comments WHERE id = ?', id);
    return json({ ok: true, liked, likes: n.likes });
  }

  // Xóa bình luận của chính mình (kèm các trả lời).
  if (path === '/api/comments/delete') {
    // Chỉ tài khoản quản trị (#1) được xóa bình luận ngay trên trang; thành viên không tự xóa được (admin quản lý trong trang quản trị).
    if (me.id !== 1) return json({ ok: false, error: 'Chỉ quản trị viên mới xóa được bình luận.' }, 403);
    const id = parseInt(input.id, 10) || 0;
    const c = await first(db, 'SELECT id FROM comments WHERE id = ?', id);
    if (!c) return json({ ok: false }, 404);
    await db.batch([
      db.prepare('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE id = ? OR parent_id = ?)').bind(id, id),
      db.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(id, id),
    ]);
    return json({ ok: true });
  }

  return json({ ok: false, error: 'not_found' }, 404);
}
