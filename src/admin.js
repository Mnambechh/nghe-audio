// Trang quản trị và trình cài đặt.
import { saveSettings, clearCache, all, first, liveCounts, withLive, uniqueSlug, DEFAULT_SETTINGS } from './db.js';
import {
  html, redirect, now, vnDay, vnPlain, slugify, parseDuration, randomId, getCookie, setCookie,
  hashPassword, verifyPassword, signToken, readToken, safeEqual, imageType, toBase64,
} from './util.js';
import * as V from './views/admin.js';
import { ADMIN, logEvent, recentHits, blockIp, unblockIp } from './security.js';

const SESSION_COOKIE = 'aw_admin';
const FLASH_COOKIE = 'aw_flash';
const SESSION_DAYS = 7;
// Đăng nhập sai: 5 lần / 15 phút mỗi IP thì tạm khóa; 10 lần / 10 phút thì chặn IP 24 giờ.
// Tổng cộng mọi IP sai 30 lần / 15 phút thì khóa đăng nhập 15 phút (chống dò mật khẩu từ nhiều IP).
const FAILS_PER_IP = 5, FAILS_GLOBAL = 30;
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

export async function handleAdmin(request, env, db, s, path, url, info) {
  const isPost = request.method === 'POST';
  if (isPost && !sameOrigin(request)) {
    await logEvent(db, info, 'csrf', ADMIN + path.slice('/admin'.length));
    return new Response('Yêu cầu không hợp lệ, vui lòng tải lại trang.', { status: 400 });
  }

  // Đăng nhập
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
        await logEvent(db, info, 'login_ok', `user=${s.admin_user}`);
        const token = await signToken(s.secret, { u: s.admin_user, exp: now() + SESSION_DAYS * 86400 });
        return redirect(ADMIN, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
      } else {
        await logEvent(db, info, 'login_fail', `user=${str(f, 'user')}`, { hits: 10, hours: 24 });
        await new Promise(r => setTimeout(r, 600)); // làm chậm dò mật khẩu
        err = 'Sai tên đăng nhập hoặc mật khẩu.';
      }
    }
    return html(V.loginPage(s, err), err ? 401 : 200, noStore);
  }

  const session = await readToken(s.secret, getCookie(request, SESSION_COOKIE));
  if (!session || session.u !== s.admin_user) return redirect(ADMIN + '/login');

  if (path === '/admin/logout' && isPost) {
    return redirect(ADMIN + '/login', { 'Set-Cookie': sessionCookie('', 0) });
  }

  let flash = null;
  try { flash = JSON.parse(getCookie(request, FLASH_COOKIE) || 'null'); } catch (e) { /* bỏ qua */ }
  const view = (content, status = 200) => {
    const headers = { ...noStore };
    if (flash) headers['Set-Cookie'] = setCookie(FLASH_COOKIE, '', { maxAge: 0, path: ADMIN });
    return html(V.adminLayout(s, path, flash, content), status, headers);
  };

  // Danh sách audio
  if (path === '/admin') {
    const q = (url.searchParams.get('q') || '').trim();
    const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
    const per = 30;
    const where = q ? 'WHERE search LIKE ?' : '';
    const args = q ? ['%' + vnPlain(q) + '%'] : [];
    const total = (await first(db, `SELECT COUNT(*) c FROM tracks ${where}`, ...args)).c;
    const rows = await all(db, `SELECT t.*, (SELECT COUNT(*) FROM parts p WHERE p.track_id = t.id) nparts FROM tracks t ${where}
      ORDER BY created_at DESC LIMIT ${per} OFFSET ${(page - 1) * per}`, ...args);
    const live = await liveCounts(db);
    const stats = {
      tracks: (await first(db, 'SELECT COUNT(*) c FROM tracks')).c,
      views: (await first(db, 'SELECT COALESCE(SUM(views), 0) c FROM tracks')).c,
      today: (await first(db, 'SELECT COALESCE(SUM(n), 0) c FROM views_daily WHERE day = ?', vnDay())).c,
      live: Object.values(live).reduce((a, b) => a + b, 0),
    };
    return view(V.tracksView({ tracks: await withLive(db, rows, live), stats, q, page, total, per }));
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
      parts = await all(db, 'SELECT * FROM parts WHERE track_id = ? ORDER BY pos, id', id);
    }
    if (!isPost) return view(V.trackForm({ track, parts, err: '' }));

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
    track = { ...track, title, slug: str(f, 'slug'), tag: str(f, 'tag'), description: str(f, 'description'), published: f.get('published') ? 1 : 0 };
    if (err) return view(V.trackForm({ track, parts: newParts, err }), 400);

    const slug = await uniqueSlug(db, 'tracks', slugify(track.slug || title), id);
    const t = now();
    const duration = newParts.reduce((a, p) => a + p.duration, 0);
    if (id) {
      await db.batch([
        db.prepare('UPDATE tracks SET title=?, slug=?, search=?, tag=?, description=?, published=?, duration=?, updated_at=? WHERE id=?')
          .bind(title, slug, vnPlain(title), track.tag, track.description, track.published, duration, t, id),
        ...(f.get('bump') ? [db.prepare('UPDATE tracks SET created_at = ? WHERE id = ?').bind(t, id)] : []),
        db.prepare('DELETE FROM parts WHERE track_id = ?').bind(id),
      ]);
    } else {
      const r = await db.prepare('INSERT INTO tracks (title, slug, search, tag, description, published, duration, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(title, slug, vnPlain(title), track.tag, track.description, track.published, duration, t, t).run();
      id = r.meta.last_row_id;
    }
    const ins = db.prepare('INSERT INTO parts (track_id, pos, title, url, duration) VALUES (?,?,?,?,?)');
    await db.batch(newParts.map((p, i) => ins.bind(id, i, p.title, p.url, p.duration)));
    await clearCache(db);
    return go(f.get('and_new') ? ADMIN + '/track/new' : `${ADMIN}/track/${id}`, ['ok', `Đã lưu “${title}”.`]);
  }

  m = path.match(/^\/admin\/track\/(\d+)\/delete$/);
  if (m && isPost) {
    const id = parseInt(m[1], 10);
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
      data.comments_enabled = f.get('comments_enabled') ? '1' : '0';
      data.comment_moderation = f.get('comment_moderation') ? '1' : '0';
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
      const nw = String(f.get('new') || '');
      if (!(await verifyPassword(String(f.get('old') || ''), s.admin_pass))) err = 'Mật khẩu hiện tại không đúng.';
      else if (nw.length < 8) err = 'Mật khẩu mới cần ít nhất 8 ký tự.';
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
    return view(V.passwordView(s, err), err ? 400 : 200);
  }

  // Bình luận: duyệt, ẩn, xóa, khóa người dùng
  if (path === '/admin/comments') {
    if (isPost) {
      const f = await request.formData();
      const act = f.get('action');
      const id = parseInt(f.get('id'), 10) || 0;
      const uid = parseInt(f.get('user_id'), 10) || 0;
      const back = ADMIN + '/comments' + (url.search || '');
      if (act === 'approve' && id) await db.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").bind(id).run();
      else if (act === 'hide' && id) await db.prepare("UPDATE comments SET status = 'hidden' WHERE id = ?").bind(id).run();
      else if (act === 'delete' && id) {
        await db.batch([
          db.prepare('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE id = ? OR parent_id = ?)').bind(id, id),
          db.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(id, id),
        ]);
      } else if (act === 'approve_all') await db.prepare("UPDATE comments SET status = 'approved' WHERE status = 'pending'").run();
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
    return view(V.commentsView({ rows, count, status, page, per, banned, moderation: s.comment_moderation === '1', clientId: s.google_client_id }));
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
      if (act === 'clear_log') {
        await db.prepare('DELETE FROM security_log').run();
        return go(ADMIN + '/security', ['ok', 'Đã xóa nhật ký.']);
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
    return view(V.securityView({ stats, logs, blocked: blocked.filter(b => !b.until || b.until > t), myIp: info.ip }));
  }

  return new Response('Không tìm thấy', { status: 404 });
}
