// Trang quản trị và trình cài đặt.
import { saveSettings, loadSettings as loadSettingsFresh, clearCache, all, first, liveCounts, withLive, uniqueSlug, DEFAULT_SETTINGS } from './db.js';
import {
  html, redirect, now, vnDay, dayStartTs, vnPlain, slugify, parseDuration, randomId, getCookie, setCookie,
  hashPassword, verifyPassword, signToken, readToken, safeEqual, imageType, toBase64,
} from './util.js';
import * as V from './views/admin.js';
import { ADMIN, logEvent, recentHits, blockIp, unblockIp } from './security.js';
import { onCommentApproved, notify, awardExp, walletLog, walletStmt, GAME_DEFAULTS, parseLevelTiers } from './game.js';
import { WITHDRAW_DEFAULTS, METHODS } from './withdraw.js';
import { parseWords } from './wordfilter.js';
import { listenConfig, commentConfig, onCommentQuest, parseTiers } from './quests.js';
import { demoLoginCookie, currentUser } from './comments.js';
import { verifyTotp, randomBase32, otpauthUri } from './totp.js';
import { mailConfig, sendMail } from './mailer.js';
import { checkIp, hostingByAsn } from './proxycheck.js';
import { NAME_FX } from './shop.js';

const SESSION_COOKIE = 'aw_admin';
const FLASH_COOKIE = 'aw_flash';
const SESSION_DAYS = 7;
// Đăng nhập sai: 5 lần / 15 phút mỗi IP thì tạm khóa; 10 lần / 10 phút thì chặn IP 24 giờ.
// Tổng cộng mọi IP sai 30 lần / 15 phút thì khóa đăng nhập 15 phút (chống dò mật khẩu từ nhiều IP).
const FAILS_PER_IP = 5, FAILS_GLOBAL = 30;
// Dấu vân tay thiết bị của phiên admin (băm User-Agent): cookie bị lấy cắp đem sang máy khác sẽ không dùng được.
// Thành viên #1 là tài khoản quản trị mặc định: không xóa, không khóa, không bị thao tác hàng loạt.
export const OWNER_ID = 1;
const OWNER_BLOCKED = ['delete', 'lock', 'ban', 'logout', 'avatar_reset'];

async function uaHash(request) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(request.headers.get('User-Agent') || ''));
  return Array.from(new Uint8Array(d).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256hex(t) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}
// Danh sách IP được phép vào trang quản trị (mỗi dòng một IP hoặc tiền tố, vd. 113.161. hoặc 2405:4802:).
function ipAllowed(list, ip) {
  const rules = String(list || '').split(/[\s,]+/).map(x => x.trim()).filter(Boolean);
  return !rules.length || rules.some(r => ip === r || (/[.:]$/.test(r) && ip.startsWith(r)));
}
const sessionCookie = (token, maxAge) => setCookie(SESSION_COOKIE, token, { maxAge, path: ADMIN, sameSite: 'Strict' });

// Chặn gửi form từ trang web khác (CSRF): yêu cầu POST phải đến từ chính tên miền này.
function sameOrigin(request) {
  const origin = new URL(request.url).origin;
  const o = request.headers.get('Origin');
  if (o) return o === origin;
  const r = request.headers.get('Referer');
  return !!r && r.startsWith(origin + '/');
}

const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY' };

function flashCookie(type, msg) {
  return setCookie(FLASH_COOKIE, JSON.stringify([type, msg]), { maxAge: 60, path: ADMIN });
}

function go(location, flash) {
  const headers = {};
  if (flash) headers['Set-Cookie'] = flashCookie(...flash);
  return redirect(location, headers);
}

const str = (form, k) => String(form.get(k) ?? '').trim();

// Lưu ảnh tải lên vào bảng media. Trả về đường dẫn /media/..., null nếu không có file, hoặc ném lỗi.
async function saveUpload(db, file) {
  if (!file || typeof file === 'string' || !file.size) return null;
  if (file.size > 1024 * 1024) throw new Error('Ảnh quá lớn, tối đa 1MB. Hãy nén ảnh (ví dụ tinypng.com) rồi tải lại.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type) throw new Error('File không phải ảnh PNG/JPG/GIF/WebP/ICO.');
  const id = randomId(20);
  await db.prepare('INSERT INTO media (id, type, data, created_at) VALUES (?, ?, ?, ?)').bind(id, type, toBase64(bytes), now()).run();
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/x-icon': 'ico' }[type];
  return `/media/${id}.${ext}`;
}

// Ảnh bìa: trình duyệt đã nén sang WebP (data URL). Máy chủ chỉ nhận đúng ảnh WebP thật (kiểm tra chữ ký file), tối đa 1.5MB.
async function saveCoverData(db, dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('Ảnh bìa không hợp lệ.');
  const bin = atob(m[2]);
  if (bin.length > 1.5 * 1024 * 1024) throw new Error('Ảnh bìa sau khi nén vẫn quá lớn.');
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const type = imageType(bytes);
  if (type !== 'image/webp') throw new Error('Ảnh bìa không hợp lệ.');
  const id = randomId(20);
  await db.prepare('INSERT INTO media (id, type, data, created_at) VALUES (?, ?, ?, ?)').bind(id, type, toBase64(bytes), now()).run();
  return `/media/${id}.webp`;
}

async function deleteMedia(db, path) {
  const m = String(path || '').match(/^\/media\/([A-Za-z0-9]+)\./);
  if (m) await db.prepare('DELETE FROM media WHERE id = ?').bind(m[1]).run();
}

// ---------- Cài đặt lần đầu ----------

export async function handleInstall(request, db) {
  if (request.method !== 'POST') return html(V.installPage('', false), 200, noStore);
  if (!sameOrigin(request)) return html(V.installPage('Yêu cầu không hợp lệ, vui lòng tải lại trang.', false), 400, noStore);
  const f = await request.formData();
  const site = str(f, 'site_name'), user = str(f, 'user'), pass = String(f.get('pass') || '');
  const form = { site_name: site, user };
  let err = '';
  if (!site || !user) err = 'Vui lòng nhập tên web và tên đăng nhập.';
  else if (pass.length < 8) err = 'Mật khẩu cần ít nhất 8 ký tự.';
  else if (pass !== f.get('pass2')) err = 'Hai mật khẩu không khớp.';
  if (err) return html(V.installPage(err, false, form), 400, noStore);

  // Kiểm tra lại để tránh hai người cài cùng lúc.
  if (await first(db, "SELECT 1 x FROM settings WHERE k = 'admin_user'")) return redirect(ADMIN);

  await saveSettings(db, {
    site_name: site,
    seo_title: `${site} - Nghe audio truyện miễn phí`,
    admin_user: user,
    admin_pass: await hashPassword(pass),
    secret: randomId(40),
  });
  const pages = [
    ['Giới thiệu', 'gioi-thieu', `<p>${site.replace(/</g, '&lt;')} là nơi nghe audio truyện miễn phí, không cần tài khoản.</p>`],
    ['Liên hệ', 'lien-he', '<p>Email: <a href="mailto:lienhe@example.com">lienhe@example.com</a></p>'],
    ['Chính sách bảo mật', 'chinh-sach-bao-mat', '<p>Chúng tôi không thu thập thông tin cá nhân. Trình duyệt chỉ lưu vị trí đang nghe và cài đặt trên thiết bị của bạn.</p>'],
    ['Điều khoản sử dụng', 'dieu-khoan-su-dung', '<p>Nội dung trên website chỉ dùng cho mục đích giải trí cá nhân.</p>'],
    ['Miễn trừ trách nhiệm & Bản quyền', 'ban-quyen', '<p>Nếu bạn là chủ sở hữu bản quyền và muốn gỡ nội dung, vui lòng liên hệ, chúng tôi sẽ xử lý trong 24 giờ.</p>'],
  ];
  const st = db.prepare('INSERT OR IGNORE INTO pages (title, slug, content, pos) VALUES (?, ?, ?, ?)');
  await db.batch(pages.map((p, i) => st.bind(p[0], p[1], p[2], i)));
  await clearCache(db);
  return html(V.installPage('', true), 200, noStore);
}

// ---------- Trang quản trị ----------

// Khu biên tập viên (/bien-tap): chỉ người có vai trò biên tập viên mới vào được, người khác thấy 404.
// Dùng lại trang Audio của admin nhưng đổi mọi đường dẫn /quanly-… thành /bien-tap để không lộ link quản trị.
export const EDITOR_PATH = '/bien-tap';
export async function handleEditor(request, env, db, s, path, url, info, notFound) {
  const u = await currentUser(request, db);
  if (!u || u.demo || u.role !== 'editor' || u.banned) return notFound();
  const res = await handleAdmin(request, env, db, s, '/admin' + path.slice(EDITOR_PATH.length), url, info, u);
  const out = new Response(res.body, res);
  const swap = v => v.split(ADMIN).join(EDITOR_PATH);
  for (const k of ['Location']) if (out.headers.get(k)) out.headers.set(k, swap(out.headers.get(k)));
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (cookies.length) { out.headers.delete('Set-Cookie'); cookies.forEach(c => out.headers.append('Set-Cookie', swap(c))); }
  if ((out.headers.get('Content-Type') || '').includes('text/html')) {
    return new Response(swap(await out.text()), { status: out.status, headers: out.headers });
  }
  return out;
}

export async function handleAdmin(request, env, db, s, path, url, info, editorUser = null) {
  const isPost = request.method === 'POST';
  // Giới hạn IP (nếu admin bật): IP lạ nhận 404 như thể trang không tồn tại. (Không áp dụng cho khu biên tập viên.)
  if (!editorUser && !ipAllowed(s.admin_ip_allow, info.ip)) {
    await logEvent(db, info, 'admin_ip_deny', ADMIN + path.slice('/admin'.length), { hits: 20, hours: 24 });
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (isPost && !sameOrigin(request)) {
    await logEvent(db, info, 'csrf', ADMIN + path.slice('/admin'.length));
    return new Response('Yêu cầu không hợp lệ, vui lòng tải lại trang.', { status: 400 });
  }

  // Đăng nhập (chỉ admin; khu biên tập viên không có trang đăng nhập riêng)
  if (path === '/admin/login' && editorUser) return go(ADMIN);
  if (path === '/admin/login') {
    let err = '';
    if (isPost) {
      const f = await request.formData();
      const ipFails = await recentHits(db, 'login_fail', 900, info.ip);
      const allFails = await recentHits(db, 'login_fail', 900);
      if (ipFails >= FAILS_PER_IP || allFails >= FAILS_GLOBAL) {
        await logEvent(db, info, 'login_lock', `user=${str(f, 'user')}`);
        err = 'Sai quá nhiều lần, vui lòng thử lại sau 15 phút.';
      } else if (safeEqual(str(f, 'user'), s.admin_user) && await verifyPassword(String(f.get('pass') || ''), s.admin_pass)) {
        // Bước 2: mã 6 số từ ứng dụng xác thực (hoặc mã dự phòng dùng 1 lần).
        let ok2 = true;
        if (s.admin_totp) {
          const code = str(f, 'code').replace(/\s/g, '').toUpperCase();
          const counter = await verifyTotp(s.admin_totp, code, +s.admin_totp_last || 0);
          if (counter) await saveSettings(db, { admin_totp_last: String(counter) });
          else {
            const codes = String(s.admin_recovery || '').split(',').filter(Boolean);
            const hash = code.length >= 8 ? await sha256hex(code.replace(/-/g, '')) : '';
            if (hash && codes.includes(hash)) await saveSettings(db, { admin_recovery: codes.filter(c => c !== hash).join(',') });
            else ok2 = false;
          }
        }
        if (!ok2) {
          await logEvent(db, info, 'login_fail', `user=${s.admin_user} (sai mã 2 bước)`, { hits: 10, hours: 24 });
          await new Promise(r => setTimeout(r, 600));
          err = 'Mã xác thực 2 bước không đúng hoặc đã hết hạn.';
        } else {
          await logEvent(db, info, 'login_ok', `user=${s.admin_user}${s.admin_totp ? ' · 2 bước' : ''}`);
          const token = await signToken(s.secret, { u: s.admin_user, d: await uaHash(request), exp: now() + SESSION_DAYS * 86400 });
          return redirect(ADMIN + '/overview', { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
        }
      } else {
        await logEvent(db, info, 'login_fail', `user=${str(f, 'user')}`, { hits: 10, hours: 24 });
        await new Promise(r => setTimeout(r, 600)); // làm chậm dò mật khẩu
        err = 'Sai tên đăng nhập hoặc mật khẩu.';
      }
    }
    return html(V.loginPage(s, err), err ? 401 : 200, noStore);
  }

  const session = await readToken(s.secret, getCookie(request, SESSION_COOKIE));
  // Biên tập viên: đăng nhập bằng tài khoản thành viên (Google) có vai trò "editor", chỉ được đăng / sửa audio.
  // Biên tập viên chỉ vào qua /bien-tap (handleEditor); đường quản trị thật chỉ dành cho admin.
  let editor = null;
  if (editorUser) {
    const u = editorUser;
    editor = u;
    const allowed = path === '/admin' || path === '/admin/track/new' || /^\/admin\/track\/\d+$/.test(path);
    if (!allowed) {
      await logEvent(db, info, 'editor_deny', `#${u.id} ${u.name}: ${ADMIN + path.slice('/admin'.length)}`);
      return go(ADMIN, ['err', 'Biên tập viên chỉ có quyền đăng và sửa audio.']);
    }
  } else if (!session || session.u !== s.admin_user) return redirect(ADMIN + '/login');
  // Phiên gắn với thiết bị đã đăng nhập: cookie dùng trên thiết bị khác → bắt đăng nhập lại và ghi nhật ký.
  if (!editor && s.admin_bind_device !== '0' && session.d && session.d !== await uaHash(request)) {
    await logEvent(db, info, 'session_stolen', ADMIN + path.slice('/admin'.length));
    return redirect(ADMIN + '/login', { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (path === '/admin/logout' && isPost) {
    return redirect(ADMIN + '/login', { 'Set-Cookie': sessionCookie('', 0) });
  }

  let flash = null;
  try { flash = JSON.parse(getCookie(request, FLASH_COOKIE) || 'null'); } catch (e) { /* bỏ qua */ }
  const view = (content, status = 200) => {
    const headers = { ...noStore };
    if (flash) headers['Set-Cookie'] = setCookie(FLASH_COOKIE, '', { maxAge: 0, path: ADMIN });
    return html(V.adminLayout(s, path, flash, content, editor), status, headers);
  };

  // Tổng quan: thành viên, Linh Thạch, bình luận chờ duyệt, yêu cầu rút.
  if (path === '/admin/overview') {
    const day0 = dayStartTs();
    const QUEST = "kind = 'stones' AND amount > 0 AND (note LIKE 'Nhiệm vụ:%' OR note = 'Điểm danh hằng ngày')";
    const LEVEL = "kind = 'stones' AND amount > 0 AND note LIKE 'Thưởng đột phá%'";
    const [users, wallet, cmt, wd, live] = await Promise.all([
      first(db, `SELECT COUNT(*) total, SUM(created_at >= ?) today, COALESCE(SUM(stones), 0) stones, SUM(stones > 0) holders,
        SUM(locked = 1) locked FROM users`, day0),
      first(db, `SELECT COALESCE(SUM(CASE WHEN ${QUEST} THEN amount END), 0) quest, COALESCE(SUM(CASE WHEN ${QUEST} AND created_at >= ? THEN amount END), 0) quest_today,
        COALESCE(SUM(CASE WHEN ${LEVEL} THEN amount END), 0) level, COALESCE(SUM(CASE WHEN ${LEVEL} AND created_at >= ? THEN amount END), 0) level_today
        FROM wallet_log`, day0, day0),
      first(db, "SELECT SUM(status = 'pending') pending, SUM(created_at >= ?) today, COUNT(*) total FROM comments", day0),
      first(db, `SELECT COUNT(*) total, SUM(status = 'pending') pending, COALESCE(SUM(CASE WHEN status = 'pending' THEN vnd END), 0) pending_vnd,
        SUM(status = 'paid') paid, COALESCE(SUM(CASE WHEN status = 'paid' THEN vnd END), 0) paid_vnd, SUM(created_at >= ?) today FROM withdrawals`, day0),
      liveCounts(db),
    ]);
    const listening = Object.values(live).reduce((a, b) => a + b, 0);
    return view(V.overviewView({ users, wallet, cmt, wd, listening }));
  }

  // Danh sách audio
  if (path === '/admin') {
    const q = (url.searchParams.get('q') || '').trim();
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const per = 30;
    const where = q ? 'WHERE search LIKE ?' : '';
    const args = q ? ['%' + vnPlain(q) + '%'] : [];
    const total = (await first(db, `SELECT COUNT(*) c FROM tracks ${where}`, ...args)).c;
    const rows = await all(db, `SELECT t.*, (SELECT COUNT(*) FROM parts p WHERE p.track_id = t.id) nparts, (SELECT name FROM users u WHERE u.id = t.created_by) creator FROM tracks t ${where}
      ORDER BY created_at DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, ...args);
    const live = await liveCounts(db);
    const stats = {
      tracks: (await first(db, 'SELECT COUNT(*) c FROM tracks')).c,
      views: (await first(db, 'SELECT COALESCE(SUM(views), 0) c FROM tracks')).c,
      today: (await first(db, 'SELECT COALESCE(SUM(n), 0) c FROM views_daily WHERE day = ?', vnDay())).c,
      live: Object.values(live).reduce((a, b) => a + b, 0),
    };
    return view(V.tracksView({ tracks: await withLive(db, rows, live), stats, q, page, total, per, editor }));
  }

  // Thêm / sửa audio
  let m = path.match(/^\/admin\/track\/(new|\d+)$/);
  if (m) {
    let id = m[1] === 'new' ? 0 : parseInt(m[1], 10);
    let track = { id: 0, title: '', slug: '', tag: 'Audio Full', description: '', published: 1 };
    let parts = [];
    if (id) {
      track = await first(db, 'SELECT * FROM tracks WHERE id = ?', id);
      if (!track) return redirect(ADMIN);
      if (editor && track.created_by !== editor.id) return go(ADMIN, ['err', 'Biên tập viên chỉ sửa được audio do chính mình đăng.']);
      parts = await all(db, 'SELECT * FROM parts WHERE track_id = ? ORDER BY pos, id', id);
    }
    if (!isPost) return view(V.trackForm({ track, parts, err: '', editor }));

    const f = await request.formData();
    const title = str(f, 'title');
    const urls = f.getAll('part_url'), titles = f.getAll('part_title'), durs = f.getAll('part_dur');
    let err = '';
    const newParts = [];
    urls.forEach((u, i) => {
      u = String(u).trim();
      if (!u) return;
      if (!/^https?:\/\//i.test(u)) { err = 'Link audio phải bắt đầu bằng http:// hoặc https://'; return; }
      newParts.push({ title: String(titles[i] || '').trim(), url: u, duration: parseDuration(durs[i]) });
    });
    if (!title) err = 'Vui lòng nhập tên truyện.';
    else if (!newParts.length && !err) err = 'Cần ít nhất một link audio.';
    track = { ...track, title, slug: str(f, 'slug'), tag: str(f, 'tag'), description: str(f, 'description'), published: f.get('published') ? 1 : 0,
      seo_title: str(f, 'seo_title').slice(0, 120), seo_desc: str(f, 'seo_desc').replace(/\s+/g, ' ').slice(0, 320), seo_keywords: str(f, 'seo_keywords').slice(0, 300) };
    // Ảnh bìa: mới / giữ nguyên / gỡ bỏ.
    let cover = track.cover || '';
    if (!err && str(f, 'cover_data')) {
      try { cover = await saveCoverData(db, str(f, 'cover_data')); } catch (e) { err = e.message; }
    } else if (!err && f.get('cover_remove')) cover = '';
    if (err) return view(V.trackForm({ track, parts: newParts, err, editor }), 400);
    if (cover !== (track.cover || '') && track.cover) await deleteMedia(db, track.cover);
    track.cover = cover;

    const slug = await uniqueSlug(db, 'tracks', slugify(track.slug || title), id);
    const t = now();
    const duration = newParts.reduce((a, p) => a + p.duration, 0);
    if (id) {
      await db.batch([
        db.prepare('UPDATE tracks SET title=?, slug=?, search=?, tag=?, description=?, published=?, duration=?, updated_at=? WHERE id=?')
          .bind(title, slug, vnPlain(title), track.tag, track.description, track.published, duration, t, id),
        db.prepare('UPDATE tracks SET seo_title=?, seo_desc=?, seo_keywords=?, updated_by=?, cover=? WHERE id=?').bind(track.seo_title, track.seo_desc, track.seo_keywords, editor ? editor.id : 0, track.cover, id),
        ...(f.get('bump') ? [db.prepare('UPDATE tracks SET created_at = ? WHERE id = ?').bind(t, id)] : []),
        db.prepare('DELETE FROM parts WHERE track_id = ?').bind(id),
      ]);
    } else {
      const r = await db.prepare('INSERT INTO tracks (title, slug, search, tag, description, published, duration, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(title, slug, vnPlain(title), track.tag, track.description, track.published, duration, t, t).run();
      id = r.meta.last_row_id;
      await db.prepare('UPDATE tracks SET seo_title=?, seo_desc=?, seo_keywords=?, created_by=?, updated_by=?, cover=? WHERE id=?')
        .bind(track.seo_title, track.seo_desc, track.seo_keywords, editor ? editor.id : 0, editor ? editor.id : 0, track.cover, id).run();
    }
    const ins = db.prepare('INSERT INTO parts (track_id, pos, title, url, duration) VALUES (?,?,?,?,?)');
    await db.batch(newParts.map((p, i) => ins.bind(id, i, p.title, p.url, p.duration)));
    await clearCache(db);
    return go(f.get('and_new') ? ADMIN + '/track/new' : `${ADMIN}/track/${id}`, ['ok', `Đã lưu “${title}”.`]);
  }

  m = path.match(/^\/admin\/track\/(\d+)\/delete$/);
  if (m && isPost) {
    const id = parseInt(m[1], 10);
    const old = await first(db, 'SELECT cover FROM tracks WHERE id = ?', id);
    if (old && old.cover) await deleteMedia(db, old.cover);
    await db.batch([
      db.prepare('DELETE FROM parts WHERE track_id = ?').bind(id),
      db.prepare('DELETE FROM views_daily WHERE track_id = ?').bind(id),
      db.prepare('DELETE FROM tracks WHERE id = ?').bind(id),
    ]);
    await clearCache(db);
    return go(ADMIN, ['ok', 'Đã xóa audio.']);
  }

  // Quảng cáo
  if (path === '/admin/qc') {
    if (isPost) {
      const f = await request.formData();
      const act = f.get('action');
      const adId = parseInt(f.get('id'), 10) || 0;
      if (act === 'config') {
        const hours = Math.max(0.1, parseFloat(str(f, 'ad_interval_hours').replace(',', '.')) || 6);
        await saveSettings(db, {
          ad_enabled: f.get('ad_enabled') ? '1' : '0',
          ad_interval_hours: String(hours),
          ad_message: str(f, 'ad_message'),
          ad_button: str(f, 'ad_button'),
          ad_note: str(f, 'ad_note'),
        });
        await clearCache(db);
        return go(ADMIN + '/qc', ['ok', 'Đã lưu cài đặt quảng cáo.']);
      }
      if (act === 'save') {
        const adUrl = str(f, 'url');
        if (!/^https?:\/\//i.test(adUrl)) return go(ADMIN + '/qc', ['err', 'Link quảng cáo phải bắt đầu bằng https://']);
        const old = adId ? await first(db, 'SELECT image FROM ads WHERE id = ?', adId) : null;
        let image;
        try {
          image = await saveUpload(db, f.get('image_file'));
        } catch (e) {
          return go(ADMIN + '/qc', ['err', e.message]);
        }
        image = image || str(f, 'image');
        if (old && old.image !== image) await deleteMedia(db, old.image);
        const vals = [str(f, 'title'), image, str(f, 'price'), str(f, 'old_price'), adUrl, f.get('active') ? 1 : 0];
        if (adId) await db.prepare('UPDATE ads SET title=?, image=?, price=?, old_price=?, url=?, active=? WHERE id=?').bind(...vals, adId).run();
        else await db.prepare('INSERT INTO ads (title, image, price, old_price, url, active) VALUES (?,?,?,?,?,?)').bind(...vals).run();
        await clearCache(db);
        return go(ADMIN + '/qc', ['ok', 'Đã lưu quảng cáo.']);
      }
      if (act === 'delete' && adId) {
        const old = await first(db, 'SELECT image FROM ads WHERE id = ?', adId);
        if (old) await deleteMedia(db, old.image);
        await db.prepare('DELETE FROM ads WHERE id = ?').bind(adId).run();
        await clearCache(db);
        return go(ADMIN + '/qc', ['ok', 'Đã xóa quảng cáo.']);
      }
      return go(ADMIN + '/qc');
    }
    const ads = await all(db, 'SELECT * FROM ads ORDER BY id DESC');
    const editId = parseInt(url.searchParams.get('edit'), 10) || 0;
    return view(V.adsView(s, ads, ads.find(a => a.id === editId)));
  }

  // Cài đặt chung & SEO
  if (path === '/admin/settings') {
    if (isPost) {
      const f = await request.formData();
      const data = {};
      for (const k of ['site_name', 'site_tagline', 'seo_title', 'seo_description', 'seo_keywords', 'footer_text', 'head_code']) data[k] = str(f, k);
      data.header_show_name = f.get('header_show_name') ? '1' : '0';
      data.comments_enabled = f.get('comments_enabled') ? '1' : '0';
      data.withdraw_enabled = f.get('withdraw_enabled') ? '1' : '0';
      data.comment_moderation = f.get('comment_moderation') ? '1' : '0';
      { const tz = parseFloat(str(f, 'tz_offset')); data.tz_offset = String(Number.isFinite(tz) && tz >= -12 && tz <= 14 ? tz : 7); }
      const luL = f.getAll('lu_lvl'), luS = f.getAll('lu_stones');
      data.levelup_tiers = parseLevelTiers(luL.map((l, i) => `${l}:${luS[i] || 0}`).join('\n')).map(t => `${t.lvl}:${t.stones}`).join('\n') || '70:0';
      data.comment_words = parseWords(f.get('comment_words')).join('\n').slice(0, 20000);
      for (const k of [...Object.keys(GAME_DEFAULTS), ...Object.keys(WITHDRAW_DEFAULTS).filter(k => k !== 'withdraw_enabled')]) {
        const v = parseFloat(str(f, k).replace(',', '.'));
        data[k] = String(Number.isFinite(v) && v >= 0 ? Math.min(100000, v) : GAME_DEFAULTS[k]);
      }
      data.avatar_max_mb = String(Math.min(20, Math.max(0.5, parseFloat(str(f, 'avatar_max_mb').replace(',', '.')) || 5)));
      const gid = str(f, 'google_client_id');
      if (gid && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(gid)) return go(ADMIN + '/settings', ['err', 'Google Client ID không đúng dạng (…apps.googleusercontent.com).']);
      data.google_client_id = gid;
      const color = str(f, 'theme_color');
      data.theme_color = /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_SETTINGS.theme_color;
      data.per_page = String(Math.min(100, Math.max(5, parseInt(f.get('per_page'), 10) || 15)));
      try {
        for (const k of ['logo', 'favicon']) {
          const up = await saveUpload(db, f.get(k + '_file'));
          if (up || f.get(k + '_remove')) {
            await deleteMedia(db, s[k]);
            data[k] = up || '';
          }
        }
      } catch (e) {
        return go(ADMIN + '/settings', ['err', e.message]);
      }
      await saveSettings(db, data);
      await clearCache(db);
      return go(ADMIN + '/settings', ['ok', 'Đã lưu cài đặt.']);
    }
    return view(V.settingsView(s, url.origin));
  }

  // Trang tĩnh
  if (path === '/admin/pages') return view(V.pagesView(await all(db, 'SELECT * FROM pages ORDER BY pos, id')));

  m = path.match(/^\/admin\/page\/(new|\d+)$/);
  if (m) {
    const id = m[1] === 'new' ? 0 : parseInt(m[1], 10);
    let p = { id: 0, title: '', slug: '', content: '', pos: 0 };
    if (id) {
      p = await first(db, 'SELECT * FROM pages WHERE id = ?', id);
      if (!p) return redirect(ADMIN + '/pages');
    }
    if (isPost) {
      const f = await request.formData();
      if (f.get('action') === 'delete' && id) {
        await db.prepare('DELETE FROM pages WHERE id = ?').bind(id).run();
        await clearCache(db);
        return go(ADMIN + '/pages', ['ok', 'Đã xóa trang.']);
      }
      const title = str(f, 'title');
      if (title) {
        const slug = await uniqueSlug(db, 'pages', slugify(str(f, 'slug') || title), id);
        const vals = [title, slug, String(f.get('content') || ''), parseInt(f.get('pos'), 10) || 0];
        if (id) await db.prepare('UPDATE pages SET title=?, slug=?, content=?, pos=? WHERE id=?').bind(...vals, id).run();
        else await db.prepare('INSERT INTO pages (title, slug, content, pos) VALUES (?,?,?,?)').bind(...vals).run();
        await clearCache(db);
        return go(ADMIN + '/pages', ['ok', 'Đã lưu trang.']);
      }
    }
    return view(V.pageForm(p));
  }

  // Đổi mật khẩu
  if (path === '/admin/password') {
    let err = '';
    if (isPost) {
      const f = await request.formData();
      const act2 = f.get('action');
      // ----- Xác thực 2 bước -----
      if (act2 === '2fa_start') {
        await saveSettings(db, { admin_totp_pending: randomBase32(32) });
        return go(ADMIN + '/password#twofa');
      }
      if (act2 === '2fa_confirm') {
        const sec = s.admin_totp_pending;
        const c = sec ? await verifyTotp(sec, str(f, 'code')) : 0;
        if (!c) return go(ADMIN + '/password#twofa', ['err', 'Mã không đúng. Kiểm tra giờ trên điện thoại và nhập mã mới nhất.']);
        // 8 mã dự phòng dùng 1 lần (chỉ hiện một lần), lưu dạng băm.
        const plain = Array.from({ length: 8 }, () => randomBase32(8));
        await saveSettings(db, { admin_totp: sec, admin_totp_pending: '', admin_totp_last: String(c),
          admin_recovery: (await Promise.all(plain.map(sha256hex))).join(','), secret: randomId(40) });
        await logEvent(db, info, 'admin_2fa', 'Bật xác thực 2 bước');
        const token = await signToken((await loadSettingsFresh(db)).secret, { u: s.admin_user, d: await uaHash(request), exp: now() + SESSION_DAYS * 86400 });
        return html(V.adminLayout(s, path, ['ok', 'Đã bật xác thực 2 bước. Mọi thiết bị khác đã bị đăng xuất.'], V.recoveryView(plain)), 200,
          { ...noStore, 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
      }
      if (act2 === '2fa_off') {
        const okPass = await verifyPassword(String(f.get('old') || ''), s.admin_pass);
        const okCode = await verifyTotp(s.admin_totp, str(f, 'code'), +s.admin_totp_last || 0);
        if (!okPass || !okCode) return go(ADMIN + '/password#twofa', ['err', 'Sai mật khẩu hoặc mã xác thực.']);
        await saveSettings(db, { admin_totp: '', admin_totp_pending: '', admin_recovery: '' });
        await logEvent(db, info, 'admin_2fa', 'Tắt xác thực 2 bước');
        return go(ADMIN + '/password', ['ok', 'Đã tắt xác thực 2 bước.']);
      }
      const nw = String(f.get('new') || '');
      if (!(await verifyPassword(String(f.get('old') || ''), s.admin_pass))) err = 'Mật khẩu hiện tại không đúng.';
      else if (nw.length < 10 || !/[a-zA-Z]/.test(nw) || !/\d/.test(nw)) err = 'Mật khẩu mới cần ít nhất 10 ký tự, gồm cả chữ và số.';
      else if (nw.toLowerCase().includes(String(str(f, 'user') || s.admin_user).toLowerCase())) err = 'Mật khẩu không được chứa tên đăng nhập.';
      else if (nw !== f.get('new2')) err = 'Hai mật khẩu mới không khớp.';
      else {
        const user = str(f, 'user') || s.admin_user;
        const secret = randomId(40); // đổi khóa để đăng xuất mọi thiết bị khác
        await saveSettings(db, { admin_user: user, admin_pass: await hashPassword(nw), secret });
        const token = await signToken(secret, { u: user, exp: now() + SESSION_DAYS * 86400 });
        const headers = new Headers({ Location: ADMIN + '/password' });
        headers.append('Set-Cookie', sessionCookie(token, SESSION_DAYS * 86400));
        headers.append('Set-Cookie', flashCookie('ok', 'Đã đổi thông tin đăng nhập.'));
        return new Response(null, { status: 303, headers });
      }
    }
    const pendingUri = s.admin_totp_pending ? otpauthUri(s.admin_totp_pending, s.admin_user, s.site_name || 'Admin') : '';
    return view(V.passwordView(s, err, { pendingUri, recoveryLeft: String(s.admin_recovery || '').split(',').filter(Boolean).length }), err ? 400 : 200);
  }

  // Bình luận: duyệt, ẩn, xóa, khóa người dùng
  if (path === '/admin/comments') {
    if (isPost) {
      const f = await request.formData();
      const act = f.get('action');
      const id = parseInt(f.get('id'), 10) || 0;
      const uid = parseInt(f.get('user_id'), 10) || 0;
      const back = ADMIN + '/comments' + (url.search || '');
      // Duyệt: chuyển trạng thái, cộng EXP, báo cho người viết và người được trả lời.
      const approve = async cid => {
        const c = await first(db, "SELECT id, user_id, parent_id, track_id, body FROM comments WHERE id = ? AND status != 'approved'", cid);
        if (!c) return;
        // Chỉ thưởng nếu chính lần bấm này chuyển trạng thái (bấm 2 lần / 2 tab không cộng trùng).
        const r = await db.prepare("UPDATE comments SET status = 'approved' WHERE id = ? AND status != 'approved'").bind(cid).run();
        if (!r.meta.changes) return;
        await onCommentApproved(db, s, c);
        await onCommentQuest(db, s, c.user_id);
        await notify(db, c.user_id, 'approved', { track: c.track_id, comment: c.id, text: c.body.slice(0, 120) });
      };
      if (act === 'approve' && id) await approve(id);
      else if (act === 'hide' && id) await db.prepare("UPDATE comments SET status = 'hidden' WHERE id = ?").bind(id).run();
      else if (act === 'delete' && id) {
        await db.batch([
          db.prepare('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE id = ? OR parent_id = ?)').bind(id, id),
          db.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(id, id),
        ]);
      } else if (act === 'approve_all') {
        const ids = await all(db, "SELECT id FROM comments WHERE status = 'pending' ORDER BY created_at LIMIT 100");
        for (const r of ids) await approve(r.id);
      }
      else if (act === 'ban' && uid === OWNER_ID) return go(back, ['err', 'Không thể khóa tài khoản quản trị (#1).']);
      else if (act === 'ban' && uid) {
        await db.batch([
          db.prepare('UPDATE users SET banned = 1 WHERE id = ?').bind(uid),
          db.prepare("UPDATE comments SET status = 'hidden' WHERE user_id = ?").bind(uid),
        ]);
        return go(back, ['ok', 'Đã khóa người dùng và ẩn mọi bình luận của họ.']);
      } else if (act === 'unban' && uid) await db.prepare('UPDATE users SET banned = 0 WHERE id = ?').bind(uid).run();
      return go(back, ['ok', 'Đã cập nhật.']);
    }
    const status = ['pending', 'approved', 'hidden'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const per = 40;
    const [rows, counts, banned] = await Promise.all([
      all(db, `SELECT c.*, u.name, u.email, u.avatar, u.banned, t.title track_title, t.slug track_slug
        FROM comments c JOIN users u ON u.id = c.user_id LEFT JOIN tracks t ON t.id = c.track_id
        WHERE c.status = ? ORDER BY c.created_at DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, status),
      all(db, 'SELECT status, COUNT(*) n FROM comments GROUP BY status'),
      all(db, 'SELECT id, name, email FROM users WHERE banned = 1 ORDER BY id DESC LIMIT 100'),
    ]);
    const count = Object.fromEntries(counts.map(r => [r.status, r.n]));
    return view(V.commentsView({ rows, count, status, page, per, banned, moderation: s.comment_moderation === '1', clientId: s.google_client_id, words: s.comment_words }));
  }

  // Nhiệm vụ: nghe đủ phút + nhiệm vụ mở link (quảng cáo TikTok…)
  if (path === '/admin/quests') {
    const back = ADMIN + '/quests';
    if (isPost) {
      const f = await request.formData();
      const act = f.getAll('action').pop(); // nút Xóa ghi đè action của form
      await clearCache(db); // trang Hướng dẫn hiện đúng nhiệm vụ mới
      const int = k => Math.max(0, Math.min(1000000, Math.round(parseFloat(str(f, k).replace(/[.\s]/g, '').replace(',', '.')) || 0)));
      const cleanUrl = u => /^https?:\/\/\S+$/i.test(u) ? u.slice(0, 1000) : '';
      if (act === 'listen') {
        const mins = f.getAll('t_min'), st = f.getAll('t_stones'), ex = f.getAll('t_exp');
        const tiers = parseTiers(mins.map((m, i) => `${m}:${st[i] || 0}:${ex[i] || 0}`).join('\n'));
        await saveSettings(db, {
          listen_quest_enabled: f.get('listen_quest_enabled') ? '1' : '0',
          listen_quest_tiers: tiers.map(t => `${t.min}:${t.stones}:${t.exp}`).join('\n') || '0',
        });
        return go(back, ['ok', 'Đã lưu nhiệm vụ nghe audio.']);
      }
      if (act === 'promax') {
        const link = str(f, 'promax_url');
        if (link && !/^https?:\/\/\S+$/i.test(link)) return go(back, ['err', 'Link phải bắt đầu bằng http:// hoặc https://']);
        await saveSettings(db, {
          promax_enabled: f.get('promax_enabled') ? '1' : '0', promax_url: link.slice(0, 1000),
          promax_title: str(f, 'promax_title').slice(0, 120), promax_desc: str(f, 'promax_desc').slice(0, 600), promax_button: str(f, 'promax_button').slice(0, 40),
        });
        return go(back, ['ok', 'Đã lưu nhiệm vụ Promax.']);
      }
      if (act === 'comment') {
        await saveSettings(db, { comment_quest_enabled: f.get('comment_quest_enabled') ? '1' : '0', comment_quest_stones: String(int('comment_quest_stones')) });
        return go(back, ['ok', 'Đã lưu nhiệm vụ bình luận.']);
      }
      if (act === 'add' || act === 'save') {
        const title = str(f, 'title').slice(0, 80);
        const link = cleanUrl(str(f, 'url'));
        if (!title) return go(back, ['err', 'Nhập tên nhiệm vụ.']);
        if (str(f, 'url') && !link) return go(back, ['err', 'Link phải bắt đầu bằng http:// hoặc https://']);
        const vals = [title, link, int('stones'), int('exp'), f.get('active') ? 1 : 0, int('pos')];
        if (act === 'add') await db.prepare('INSERT INTO quests (title, url, stones, exp, active, pos, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(...vals, now()).run();
        else await db.prepare('UPDATE quests SET title = ?, url = ?, stones = ?, exp = ?, active = ?, pos = ? WHERE id = ?').bind(...vals, parseInt(f.get('id'), 10) || 0).run();
        return go(back, ['ok', act === 'add' ? 'Đã thêm nhiệm vụ.' : 'Đã lưu nhiệm vụ.']);
      }
      if (act === 'delete') {
        const id = parseInt(f.get('id'), 10) || 0;
        await db.batch([db.prepare('DELETE FROM quests WHERE id = ?').bind(id), db.prepare('DELETE FROM quest_done WHERE quest_id = ?').bind(id)]);
        return go(back, ['ok', 'Đã xóa nhiệm vụ.']);
      }
      return go(back);
    }
    const today = vnDay();
    const [quests, doneToday] = await Promise.all([
      all(db, 'SELECT * FROM quests ORDER BY pos, id'),
      all(db, 'SELECT quest_id, COUNT(*) n FROM quest_done WHERE day = ? GROUP BY quest_id', today),
    ]);
    const counts = Object.fromEntries(doneToday.map(r => [r.quest_id, r.n]));
    return view(V.questsView({ quests, counts, listen: listenConfig(s), comment: commentConfig(s), s }));
  }

  // Cửa hàng: gói hiệu ứng tên (tên gói, hiệu ứng, giá Linh Thạch, số ngày).
  if (path === '/admin/shop') {
    const back = ADMIN + '/shop';
    if (isPost) {
      const f = await request.formData();
      const act = f.getAll('action').pop();
      const int = k => Math.max(0, Math.min(100000000, Math.round(parseFloat(str(f, k).replace(/[.\s]/g, '').replace(',', '.')) || 0)));
      if (act === 'add' || act === 'save') {
        const name = str(f, 'name').slice(0, 60), fx = str(f, 'fx');
        if (!name) return go(back, ['err', 'Nhập tên gói.']);
        if (!NAME_FX[fx]) return go(back, ['err', 'Chọn hiệu ứng.']);
        const vals = [name, fx, int('price'), Math.min(3650, int('days')), f.get('active') ? 1 : 0, int('pos')];
        if (act === 'add') await db.prepare('INSERT INTO shop_items (name, fx, price, days, active, pos, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(...vals, now()).run();
        else await db.prepare('UPDATE shop_items SET name = ?, fx = ?, price = ?, days = ?, active = ?, pos = ? WHERE id = ?').bind(...vals, parseInt(f.get('id'), 10) || 0).run();
        return go(back, ['ok', act === 'add' ? 'Đã thêm gói.' : 'Đã lưu gói.']);
      }
      if (act === 'delete') {
        await db.prepare('DELETE FROM shop_items WHERE id = ?').bind(parseInt(f.get('id'), 10) || 0).run();
        return go(back, ['ok', 'Đã xóa gói.']);
      }
      return go(back);
    }
    const [items, owned] = await Promise.all([
      all(db, 'SELECT * FROM shop_items ORDER BY pos, price, id'),
      all(db, 'SELECT fx, COUNT(*) n FROM user_fx GROUP BY fx'),
    ]);
    return view(V.shopView({ items, sold: Object.fromEntries(owned.map(r => [r.fx, r.n])) }));
  }

  // Rút Linh Thạch: duyệt yêu cầu
  if (path === '/admin/withdrawals') {
    if (isPost) {
      const f = await request.formData();
      const id = parseInt(f.get('id'), 10) || 0;
      const act = f.get('action');
      const note = str(f, 'note').slice(0, 200);
      const w = await first(db, "SELECT * FROM withdrawals WHERE id = ? AND status = 'pending'", id);
      if (!w) return go(ADMIN + '/withdrawals', ['err', 'Yêu cầu không còn ở trạng thái chờ.']);
      const where = `${METHODS[w.method] || w.method}${w.bank ? ' ' + w.bank : ''}`;
      const money = w.vnd.toLocaleString('vi-VN') + 'đ';
      if (act === 'paid') {
        await db.prepare("UPDATE withdrawals SET status = 'paid', admin_note = ?, processed_at = ? WHERE id = ? AND status = 'pending'").bind(note, now(), id).run();
        await notify(db, w.user_id, 'withdraw', { text: `Đã chuyển ${money} về ${where} (rút ${w.amount.toLocaleString('vi-VN')} Linh Thạch)${note ? ' · ' + note : ''}` });
        return go(ADMIN + '/withdrawals', ['ok', `Đã đánh dấu đã chuyển ${money}.`]);
      }
      if (act === 'reject') {
        const r = await db.prepare("UPDATE withdrawals SET status = 'rejected', admin_note = ?, processed_at = ? WHERE id = ? AND status = 'pending'").bind(note, now(), id).run();
        if (r.meta.changes) {
          await db.batch([
            db.prepare('UPDATE users SET stones = stones + ? WHERE id = ?').bind(w.amount, w.user_id),
            db.prepare('INSERT INTO member_log (user_id, action, amount, note, created_at) VALUES (?, ?, ?, ?, ?)')
              .bind(w.user_id, 'withdraw_refund', w.amount, note || 'Từ chối yêu cầu rút', now()),
            walletStmt(db, w.user_id, 'stones', w.amount, 'Hoàn lại do yêu cầu rút bị từ chối'),
          ]);
          await notify(db, w.user_id, 'withdraw', { text: `Yêu cầu rút ${w.amount.toLocaleString('vi-VN')} Linh Thạch bị từ chối, đã hoàn lại${note ? ' · Lý do: ' + note : ''}` });
        }
        return go(ADMIN + '/withdrawals', ['ok', 'Đã từ chối và hoàn Linh Thạch.']);
      }
      return go(ADMIN + '/withdrawals');
    }
    const status = ['pending', 'paid', 'rejected'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
    const [rows, counts] = await Promise.all([
      all(db, `SELECT w.*, u.name, u.email, u.exp, u.created_at user_created, u.reg_ip, u.last_ip,
          (SELECT COUNT(*) FROM users x WHERE x.id != u.id AND u.reg_ip != '' AND (x.reg_ip = u.reg_ip OR x.last_ip = u.last_ip)) same_ip,
          (SELECT COALESCE(SUM(vnd), 0) FROM withdrawals y WHERE y.user_id = u.id AND y.status = 'paid') paid_total
        FROM withdrawals w JOIN users u ON u.id = w.user_id WHERE w.status = ? ORDER BY w.id ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`, status),
      all(db, 'SELECT status, COUNT(*) n, COALESCE(SUM(vnd), 0) vnd FROM withdrawals GROUP BY status'),
    ]);
    return view(V.withdrawalsView({ rows, counts: Object.fromEntries(counts.map(r => [r.status, r])), status }));
  }

  // Thành viên: danh sách
  if (path === '/admin/members') {
    // Thao tác hàng loạt trên các thành viên được chọn.
    if (isPost) {
      const f = await request.formData();
      const act = f.get('action');
      const ids = f.getAll('ids').map(x => parseInt(x, 10)).filter(x => x > 0 && x !== OWNER_ID).slice(0, 200);
      const back = ADMIN + '/members' + (str(f, 'qs') ? '?' + str(f, 'qs').replace(/^\?/, '') : '');
      const BULK = {
        lock: ['UPDATE users SET locked = 1, session_ver = session_ver + 1 WHERE id = ?', 'Đã khóa tài khoản'],
        unlock: ['UPDATE users SET locked = 0 WHERE id = ?', 'Đã mở khóa tài khoản'],
        ban: ['UPDATE users SET banned = 1 WHERE id = ?', 'Đã khóa bình luận'],
        unban: ['UPDATE users SET banned = 0 WHERE id = ?', 'Đã mở khóa bình luận'],
        logout: ['UPDATE users SET session_ver = session_ver + 1 WHERE id = ?', 'Đã đăng xuất mọi thiết bị cho'],
      };
      if (!BULK[act] || !ids.length) return go(back, ['err', 'Chọn thành viên và thao tác.']);
      const t = now();
      const stmts = [];
      for (const id of ids) {
        stmts.push(db.prepare(BULK[act][0]).bind(id));
        stmts.push(db.prepare('INSERT INTO member_log (user_id, action, amount, note, created_at) VALUES (?, ?, 0, ?, ?)').bind(id, act, 'Thao tác hàng loạt', t));
        if (act === 'ban') stmts.push(db.prepare("UPDATE comments SET status = 'hidden' WHERE user_id = ? AND status != 'hidden'").bind(id));
      }
      await db.batch(stmts);
      await clearCache(db);
      return go(back, ['ok', `${BULK[act][1]} ${ids.length} thành viên.`]);
    }
    // Danh sách theo dõi: các nhóm tài khoản dùng chung IP (đăng ký hoặc đăng nhập gần nhất).
    const SHARED = `SELECT ip, COUNT(DISTINCT id) n FROM (SELECT id, reg_ip ip FROM users WHERE reg_ip != '' UNION SELECT id, last_ip FROM users WHERE last_ip != '')
      GROUP BY ip HAVING n > 1`;
    const sharedCount = (await first(db, `SELECT COUNT(*) groups, COALESCE(SUM(n), 0) accounts FROM (${SHARED})`));
    if (url.searchParams.get('f') === 'sameip') {
      const groups = await all(db, `${SHARED} ORDER BY n DESC LIMIT 100`);
      const ips = groups.map(g => g.ip);
      const users = ips.length ? await all(db, `SELECT u.id, u.name, u.email, u.avatar, u.exp, u.stones, u.created_at, u.last_seen, u.last_login, u.reg_ip, u.last_ip,
          u.device, u.banned, u.locked, (SELECT COALESCE(SUM(vnd), 0) FROM withdrawals w WHERE w.user_id = u.id AND w.status = 'paid') paid,
          (SELECT COUNT(*) FROM withdrawals w WHERE w.user_id = u.id AND w.status = 'pending') wd_pending
        FROM users u WHERE u.reg_ip IN (${ips.map(() => '?').join(',')}) OR u.last_ip IN (${ips.map(() => '?').join(',')})`, ...ips, ...ips) : [];
      const checks = ips.length ? await all(db, `SELECT ip, proxy, type, provider FROM ip_checks WHERE ip IN (${ips.map(() => '?').join(',')})`, ...ips) : [];
      const blocked = ips.length ? await all(db, `SELECT ip FROM blocked_ips WHERE ip IN (${ips.map(() => '?').join(',')}) AND (until = 0 OR until > ?)`, ...ips, now()) : [];
      const chk = Object.fromEntries(checks.map(c => [c.ip, c])), blk = new Set(blocked.map(b => b.ip));
      const list = groups.map(g => ({ ...g, check: chk[g.ip], blocked: blk.has(g.ip),
        users: users.filter(u => u.reg_ip === g.ip || u.last_ip === g.ip).sort((a, b) => a.created_at - b.created_at) }));
      return view(V.sharedIpView({ groups: list, sharedCount, myIp: info.ip }));
    }
    const q = (url.searchParams.get('q') || '').trim();
    const sort = ['new', 'exp', 'stones', 'login', 'seen'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'new';
    const filter = ['all', 'banned', 'locked', 'online', 'today', 'editor'].includes(url.searchParams.get('f')) ? url.searchParams.get('f') : 'all';
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const per = 30;
    const where = [], args = [];
    if (q) {
      if (/^ref:\d+$/.test(q)) { where.push('referred_by = ?'); args.push(+q.slice(4)); }
      else if (/^\d+$/.test(q)) { where.push('(id = ? OR reg_ip = ? OR last_ip = ?)'); args.push(+q, q, q); }
      else { where.push('(name LIKE ? OR email LIKE ? OR reg_ip = ? OR last_ip = ?)'); args.push(`%${q}%`, `%${q}%`, q, q); }
    }
    if (filter === 'banned') where.push('banned = 1');
    if (filter === 'locked') where.push('locked = 1');
    if (filter === 'editor') where.push("role = 'editor'");
    if (filter === 'online') { where.push('last_seen > ?'); args.push(now() - 600); }
    if (filter === 'today') { where.push('created_at >= ?'); args.push(dayStartTs()); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const order = { new: 'id DESC', exp: 'exp DESC', stones: 'stones DESC', login: 'last_login DESC', seen: 'last_seen DESC' }[sort];
    const [rows, total, stats] = await Promise.all([
      all(db, `SELECT u.id, u.name, u.email, u.avatar, u.exp, u.stones, u.comments_n, u.created_at, u.last_login, u.last_seen, u.reg_ip, u.last_ip,
          u.country, u.device, u.note, u.banned, u.locked, u.role,
          (SELECT COUNT(*) FROM users x WHERE x.id != u.id AND u.reg_ip != '' AND (x.reg_ip = u.reg_ip OR x.last_ip = u.reg_ip)) same_ip,
          (SELECT COALESCE(SUM(vnd), 0) FROM withdrawals wd WHERE wd.user_id = u.id AND wd.status = 'paid') paid,
          (SELECT COUNT(*) FROM withdrawals wd WHERE wd.user_id = u.id AND wd.status = 'pending') wd_pending
        FROM users u ${w.replace(/\b(id|name|email|reg_ip|last_ip|banned|locked|last_seen|created_at)\b/g, 'u.$1')} ORDER BY ${order.replace(/^(\w+)/, 'u.$1')}
        LIMIT ${per} OFFSET ${(page - 1) * per}`, ...args),
      first(db, `SELECT COUNT(*) c FROM users ${w}`, ...args),
      first(db, `SELECT COUNT(*) total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) today, SUM(CASE WHEN last_seen > ? THEN 1 ELSE 0 END) online,
        SUM(CASE WHEN last_login > ? OR last_seen > ? THEN 1 ELSE 0 END) active, COALESCE(SUM(stones), 0) stones, SUM(locked) locked FROM users`,
        dayStartTs(), now() - 600, now() - 7 * 86400, now() - 7 * 86400),
    ]);
    return view(V.membersView({ rows, total: total.c, stats, q, sort, filter, page, per, sharedCount }));
  }

  // Thành viên: chi tiết + thao tác
  m = path.match(/^\/admin\/members\/(\d+)$/);
  if (m) {
    const uid = parseInt(m[1], 10);
    const u = await first(db, 'SELECT * FROM users WHERE id = ?', uid);
    if (!u) return go(ADMIN + '/members', ['err', 'Không tìm thấy thành viên.']);
    let back = `${ADMIN}/members/${uid}`;
    const log = (action, amount, note) => db.prepare('INSERT INTO member_log (user_id, action, amount, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(uid, action, amount, String(note || '').slice(0, 200), now()).run();
    if (isPost) {
      const f = await request.formData();
      const act = f.get('action');
      const reason = str(f, 'reason');
      // Bấm từ danh sách: quay lại danh sách (giữ bộ lọc).
      if (f.get('from') === 'list') back = ADMIN + '/members' + (str(f, 'qs') ? '?' + str(f, 'qs').replace(/^\?/, '') : '');
      if (uid === OWNER_ID && OWNER_BLOCKED.includes(act)) return go(back, ['err', 'Tài khoản quản trị (#1) được bảo vệ: không thể xóa, khóa hay đăng xuất từ đây.']);
      if (act === 'set_pass') {
        const np = String(f.get('new_pass') || '');
        if (np.length < 8 || !/[a-zA-Z]/.test(np) || !/\d/.test(np)) return go(back, ['err', 'Mật khẩu mới cần ít nhất 8 ký tự, gồm cả chữ và số.']);
        if (!u.email) return go(back, ['err', 'Tài khoản chưa có email.']);
        await db.prepare('UPDATE users SET pass_hash = ?, session_ver = session_ver + 1 WHERE id = ?').bind(await hashPassword(np), uid).run();
        await log('set_pass', 0, 'Admin đặt lại mật khẩu');
        return go(back, ['ok', `Đã đặt mật khẩu mới cho ${u.name}. Thành viên đăng nhập bằng email ${u.email} và mật khẩu mới.`]);
      }
      if (act === 'role') {
        const role = f.get('role') === 'editor' ? 'editor' : '';
        await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, uid).run();
        await log('role', 0, role ? 'Đặt làm biên tập viên' : 'Bỏ quyền biên tập viên');
        await notify(db, uid, 'admin', { text: role ? 'Bạn đã được cấp quyền Biên tập viên: có thể đăng truyện audio trong trang quản lý.' : 'Quyền Biên tập viên của bạn đã được gỡ.' });
        return go(back, ['ok', role ? `Đã đặt ${u.name} làm Biên tập viên.` : `Đã gỡ quyền Biên tập viên của ${u.name}.`]);
      }
      if (act === 'impersonate') {
        await log('impersonate', 0, 'Admin đăng nhập xem thử');
        return redirect('/', { 'Set-Cookie': await demoLoginCookie(db, u) });
      }
      if (act === 'save') {
        const name = str(f, 'name').replace(/\s+/g, ' ');
        if ([...name].length < 2 || [...name].length > 40) return go(back, ['err', 'Tên cần từ 2 đến 40 ký tự.']);
        await db.prepare('UPDATE users SET name = ?, name_locked = 1, note = ? WHERE id = ?').bind(name, str(f, 'note').slice(0, 500), uid).run();
        if (name !== u.name) await log('rename', 0, `${u.name} → ${name}`);
        await clearCache(db);
        return go(back, ['ok', 'Đã lưu thông tin.']);
      }
      if (act === 'stones' || act === 'exp') {
        // Chỉ lấy chữ số; nút bấm quyết định cộng hay trừ.
        const n = parseInt(str(f, 'amount').replace(/\D/g, ''), 10) || 0;
        if (!n) return go(back, ['err', 'Nhập số lượng (chỉ gồm chữ số) rồi bấm Cộng hoặc Trừ.']);
        if (n > 100000000) return go(back, ['err', 'Số quá lớn (tối đa 100.000.000 mỗi lần).']);
        const amt = f.get('dir') === 'sub' ? -n : n;
        const label = act === 'stones' ? 'Linh Thạch' : 'EXP';
        const why = `Admin ${amt > 0 ? 'cộng' : 'trừ'}${reason ? ': ' + reason : ''}`;
        if (act === 'exp' && amt > 0) await awardExp(db, s, uid, amt, why);
        else {
          // Trừ không xuống dưới 0: ghi đúng số thực sự bị trừ.
          const col = act === 'stones' ? 'stones' : 'exp';
          const before = u[col] || 0;
          const after = Math.max(0, before + amt);
          await db.prepare(`UPDATE users SET ${col} = MAX(0, ${col} + ?) WHERE id = ?`).bind(amt, uid).run();
          await walletLog(db, uid, col, after - before, why);
        }
        await log(act, amt, reason);
        await notify(db, uid, 'admin', { text: `${amt > 0 ? 'Cộng' : 'Trừ'} ${Math.abs(amt).toLocaleString('vi-VN')} ${label}${reason ? ' · ' + reason : ''}` });
        await clearCache(db);
        return go(back, ['ok', `Đã ${amt > 0 ? 'cộng' : 'trừ'} ${Math.abs(amt).toLocaleString('vi-VN')} ${label}.`]);
      }
      const simple = {
        ban: ['UPDATE users SET banned = 1 WHERE id = ?', 'Đã khóa bình luận.'],
        unban: ['UPDATE users SET banned = 0 WHERE id = ?', 'Đã mở khóa bình luận.'],
        lock: ['UPDATE users SET locked = 1, session_ver = session_ver + 1 WHERE id = ?', 'Đã khóa tài khoản và đăng xuất mọi thiết bị.'],
        unlock: ['UPDATE users SET locked = 0 WHERE id = ?', 'Đã mở khóa tài khoản.'],
        logout: ['UPDATE users SET session_ver = session_ver + 1 WHERE id = ?', 'Đã đăng xuất thành viên khỏi mọi thiết bị.'],
        avatar_reset: ["UPDATE users SET avatar = '', avatar_locked = 0 WHERE id = ?", 'Đã bỏ ảnh đại diện.'],
      };
      if (simple[act]) {
        if (act === 'avatar_reset' && u.avatar_locked) await deleteMedia(db, u.avatar);
        await db.prepare(simple[act][0]).bind(uid).run();
        await log(act, 0, reason);
        if (act === 'ban') await db.prepare("UPDATE comments SET status = 'hidden' WHERE user_id = ? AND status != 'hidden'").bind(uid).run();
        await clearCache(db);
        return go(back, ['ok', simple[act][1]]);
      }
      if (act === 'block_ip') {
        const ip = str(f, 'ip');
        if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return go(back, ['err', 'IP không hợp lệ.']);
        if (ip === info.ip) return go(back, ['err', 'Đây là IP của chính bạn.']);
        await blockIp(db, ip, `Thành viên #${uid} ${u.name}${reason ? ': ' + reason : ''}`, 0);
        await log('block_ip', 0, ip);
        return go(back, ['ok', `Đã chặn IP ${ip}.`]);
      }
      if (act === 'delete') {
        if (str(f, 'confirm') !== 'XOA') return go(back, ['err', 'Gõ XOA để xác nhận xóa tài khoản.']);
        if (u.avatar_locked) await deleteMedia(db, u.avatar);
        await db.batch([
          db.prepare('UPDATE tracks SET rating_sum = rating_sum - (SELECT stars FROM ratings r WHERE r.user_id = ? AND r.track_id = tracks.id), rating_count = rating_count - 1 WHERE id IN (SELECT track_id FROM ratings WHERE user_id = ?)').bind(uid, uid),
          db.prepare('DELETE FROM ratings WHERE user_id = ?').bind(uid),
          db.prepare('DELETE FROM comment_likes WHERE user_id = ? OR comment_id IN (SELECT id FROM comments WHERE user_id = ?)').bind(uid, uid),
          db.prepare('DELETE FROM comments WHERE user_id = ? OR parent_id IN (SELECT id FROM comments WHERE user_id = ?)').bind(uid, uid),
          db.prepare('DELETE FROM history WHERE user_id = ?').bind(uid),
          db.prepare('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?').bind(uid, uid),
          db.prepare('DELETE FROM member_log WHERE user_id = ?').bind(uid),
          db.prepare('DELETE FROM wallet_log WHERE user_id = ?').bind(uid),
          db.prepare('DELETE FROM quest_done WHERE user_id = ?').bind(uid),
          db.prepare('DELETE FROM ref_log WHERE referrer_id = ? OR referee_id = ?').bind(uid, uid),
          db.prepare('UPDATE users SET referred_by = 0 WHERE referred_by = ?').bind(uid),
          db.prepare('DELETE FROM users WHERE id = ?').bind(uid),
        ]);
        await clearCache(db);
        return go(ADMIN + '/members', ['ok', `Đã xóa tài khoản ${u.name}.`]);
      }
      return go(back);
    }
    // Lịch sử EXP / Linh Thạch: lọc theo loại, 50 dòng mỗi trang.
    const wk = ['exp', 'stones'].includes(url.searchParams.get('wk')) ? url.searchParams.get('wk') : '';
    const wp = Math.max(1, parseInt(url.searchParams.get('wp'), 10) || 1);
    const WPER = 50;
    const wWhere = 'user_id = ?' + (wk ? ' AND kind = ?' : '');
    const wArgs = wk ? [uid, wk] : [uid];
    const [wallet, wTotal, wSum] = await Promise.all([
      all(db, `SELECT * FROM wallet_log WHERE ${wWhere} ORDER BY id DESC LIMIT ? OFFSET ?`, ...wArgs, WPER, (wp - 1) * WPER),
      first(db, `SELECT COUNT(*) c FROM wallet_log WHERE ${wWhere}`, ...wArgs),
      first(db, `SELECT SUM(CASE WHEN kind = 'exp' AND amount > 0 THEN amount END) exp_in, SUM(CASE WHEN kind = 'exp' AND amount < 0 THEN amount END) exp_out,
        SUM(CASE WHEN kind = 'stones' AND amount > 0 THEN amount END) st_in, SUM(CASE WHEN kind = 'stones' AND amount < 0 THEN amount END) st_out
        FROM wallet_log WHERE user_id = ?`, uid),
    ]);
    const walletData = { rows: wallet, total: wTotal.c, sum: wSum || {}, kind: wk, page: wp, per: WPER };
    const [comments, logs, counts] = await Promise.all([
      all(db, `SELECT c.id, c.body, c.status, c.likes, c.created_at, t.title, t.slug FROM comments c LEFT JOIN tracks t ON t.id = c.track_id
        WHERE c.user_id = ? ORDER BY c.created_at DESC LIMIT 20`, uid),
      all(db, 'SELECT * FROM member_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', uid),
      first(db, `SELECT (SELECT COUNT(*) FROM ratings WHERE user_id = ?) ratings, (SELECT COUNT(*) FROM history WHERE user_id = ?) history,
        (SELECT COUNT(*) FROM comments WHERE user_id = ?) comments_all, (SELECT COUNT(*) FROM users WHERE id != ? AND (reg_ip = ? OR last_ip = ?) AND ? != '') same_ip,
        (SELECT COUNT(*) FROM users WHERE referred_by = ?) invited`,
        uid, uid, uid, uid, u.reg_ip || '-', u.last_ip || '-', u.reg_ip || u.last_ip || '', uid),
    ]);
    return view(V.memberView({ u, comments, logs, counts, myIp: info.ip, wallet: walletData }));
  }

  // Bảo mật: nhật ký tấn công, chặn IP, đăng xuất mọi thiết bị
  if (path === '/admin/security') {
    if (isPost) {
      const f = await request.formData();
      const act = f.get('action');
      const ip = str(f, 'ip');
      const validIp = /^[0-9a-fA-F:.]{3,45}$/.test(ip);
      if (act === 'block') {
        if (!validIp) return go(ADMIN + '/security', ['err', 'Địa chỉ IP không hợp lệ.']);
        if (ip === info.ip) return go(ADMIN + '/security', ['err', 'Đây là IP của chính bạn, không chặn được.']);
        await blockIp(db, ip, str(f, 'reason') || 'Chặn thủ công', parseFloat(f.get('hours')) || 0);
        return go(ADMIN + '/security', ['ok', `Đã chặn ${ip}.`]);
      }
      if (act === 'unblock' && validIp) {
        await unblockIp(db, ip);
        return go(ADMIN + '/security', ['ok', `Đã bỏ chặn ${ip}.`]);
      }
      // Xác nhận lại danh tính admin (mật khẩu + mã 2 bước nếu bật) cho thao tác nhạy cảm:
      // đổi / xóa khóa API, tắt chặn VPN, xóa nhật ký. Kẻ chiếm được phiên đăng nhập cũng không làm được.
      const confirmAdmin = async () => {
        if (!(await verifyPassword(String(f.get('confirm_pass') || ''), s.admin_pass))) return 'Sai mật khẩu admin xác nhận.';
        if (s.admin_totp) {
          const c = await verifyTotp(s.admin_totp, str(f, 'confirm_code'), +s.admin_totp_last || 0);
          if (!c) return 'Sai mã xác thực 2 bước.';
          await saveSettings(db, { admin_totp_last: String(c) });
        }
        return '';
      };
      if (act === 'clear_log') {
        const why = await confirmAdmin();
        if (why) return go(ADMIN + '/security', ['err', why + ' Nhật ký chưa bị xóa.']);
        await db.prepare('DELETE FROM security_log').run();
        return go(ADMIN + '/security', ['ok', 'Đã xóa nhật ký.']);
      }
      if (act === 'antifake') {
        const data = { reg_per_ip: String(Math.max(0, Math.min(100, parseInt(str(f, 'reg_per_ip'), 10) || 0))), reg_block_proxy: f.get('reg_block_proxy') ? '1' : '0' };
        const key = str(f, 'proxycheck_key');
        const sensitive = key || f.get('proxycheck_clear') || (s.reg_block_proxy !== '0' && data.reg_block_proxy === '0');
        if (sensitive) {
          if (info.proxyKey && (key || f.get('proxycheck_clear'))) return go(ADMIN + '/security', ['err', 'Khóa đang đặt bằng biến môi trường Cloudflare (bị khóa cứng) — đổi trong Cloudflare.']);
          const why = await confirmAdmin();
          if (why) return go(ADMIN + '/security', ['err', why + ' Chưa lưu thay đổi.']);
        }
        if (f.get('proxycheck_clear')) data.proxycheck_key = '';
        else if (key) {
          if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) return go(ADMIN + '/security', ['err', 'Khóa API không hợp lệ.']);
          data.proxycheck_key = key;
        }
        await saveSettings(db, data);
        if (sensitive) await logEvent(db, info, 'api_key_change', `proxycheck: ${f.get('proxycheck_clear') ? 'xóa khóa' : key ? 'đổi khóa' : ''}${data.reg_block_proxy === '0' ? ' · tắt chặn VPN' : ''}`);
        return go(ADMIN + '/security', ['ok', 'Đã lưu cài đặt chống tài khoản ảo.']);
      }
      if (act === 'mail') {
        const data = { mail_from: str(f, 'mail_from').slice(0, 120) };
        const key = str(f, 'resend_key');
        if (key || f.get('resend_clear')) {
          if (info.resendKey) return go(ADMIN + '/security', ['err', 'Khóa đang đặt bằng biến môi trường Cloudflare (bị khóa cứng) — đổi trong Cloudflare.']);
          const why = await confirmAdmin();
          if (why) return go(ADMIN + '/security', ['err', why + ' Chưa lưu thay đổi.']);
          await logEvent(db, info, 'api_key_change', `resend: ${f.get('resend_clear') ? 'xóa khóa' : 'đổi khóa'}`);
        }
        if (f.get('resend_clear')) data.resend_key = '';
        else if (key) {
          if (!/^re_[A-Za-z0-9_]{10,80}$/.test(key)) return go(ADMIN + '/security', ['err', 'Khóa Resend không hợp lệ (bắt đầu bằng re_).']);
          data.resend_key = key;
        }
        if (data.mail_from && !/^[^<>]*<[^\s@<>]+@[^\s@<>]+>$|^[^\s@]+@[^\s@]+$/.test(data.mail_from)) return go(ADMIN + '/security', ['err', 'Địa chỉ gửi không hợp lệ. Ví dụ: Truyện Gì <no-reply@truyengi.info>']);
        await saveSettings(db, data);
        const to = str(f, 'test_to');
        if (to) {
          const s2 = await loadSettingsFresh(db);
          const r = await sendMail(mailConfig(s2, info, url.origin), to, `Email thử - ${s2.site_name}`, `<p>Gửi email thành công từ ${s2.site_name}. ✅</p>`);
          return go(ADMIN + '/security', r.ok ? ['ok', `Đã lưu và gửi email thử tới ${to}.`] : ['err', `Đã lưu nhưng gửi thử lỗi: ${r.error}`]);
        }
        return go(ADMIN + '/security', ['ok', 'Đã lưu cài đặt email.']);
      }
      if (act === 'access') {
        const list = str(f, 'admin_ip_allow').split(/[\s,]+/).filter(x => /^[0-9a-fA-F:.]{2,45}$/.test(x)).join('\n');
        if (list && !ipAllowed(list, info.ip)) return go(ADMIN + '/security', ['err', `IP hiện tại của bạn (${info.ip}) không nằm trong danh sách — thêm nó vào để tránh tự khóa mình.`]);
        await saveSettings(db, { admin_ip_allow: list, admin_bind_device: f.get('admin_bind_device') ? '1' : '0' });
        return go(ADMIN + '/security', ['ok', 'Đã lưu giới hạn truy cập.']);
      }
      if (act === 'logout_all') {
        await saveSettings(db, { secret: randomId(40) });
        return redirect(ADMIN + '/login', { 'Set-Cookie': sessionCookie('', 0) });
      }
      return go(ADMIN + '/security');
    }
    const t = now();
    const [stats, logs, blocked] = await Promise.all([
      all(db, 'SELECT event, SUM(hits) n, COUNT(DISTINCT ip) ips FROM security_log WHERE at > ? GROUP BY event', t - 86400),
      all(db, 'SELECT * FROM security_log ORDER BY at DESC LIMIT 150'),
      all(db, 'SELECT * FROM blocked_ips ORDER BY created_at DESC LIMIT 300'),
    ]);
    const logins = await all(db, "SELECT at, ip, country, ua, detail FROM security_log WHERE event = 'login_ok' ORDER BY at DESC LIMIT 10");
    // Kiểm tra trực tiếp IP đang dùng (bật VPN rồi mở trang này để xem web có nhận ra không).
    const pkey = info.proxyKey || s.proxycheck_key;
    const myCheck = { asn: info.asn, org: info.asOrg, host: hostingByAsn(info), pc: pkey ? await checkIp(db, pkey, info.ip) : null };
    return view(V.securityView({ stats, logs, blocked: blocked.filter(b => !b.until || b.until > t), myIp: info.ip, s, logins,
      proxy: { hasKey: !!(info.proxyKey || s.proxycheck_key), fromEnv: !!info.proxyKey, myCheck },
      mail: { hasKey: !!(info.resendKey || s.resend_key), fromEnv: !!info.resendKey, from: mailConfig(s, info, url.origin).from } }));
  }

  return new Response('Không tìm thấy', { status: 404 });
}
