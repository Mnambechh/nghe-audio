// Bảo mật: đường dẫn quản trị, nhật ký tấn công, chặn IP, header bảo mật.
import { cached, all, first, clearCache } from './db.js';
import { now } from './util.js';

// Đường dẫn trang quản trị. Đổi ở đây nếu muốn dùng link khác.
export const ADMIN = '/quanly-199x';

// Các đường dẫn mà bot dò lỗ hổng hay thử (WordPress, phpMyAdmin, file cấu hình, file sao lưu…).
const PROBE_RE = new RegExp([
  '^/(wp-|wordpress|xmlrpc\\.php|phpmyadmin|pma|myadmin|mysql|adminer|administrator|admin(/|$|\\.)|login\\.php',
  '|cgi-bin|vendor/|\\.env|\\.git|\\.svn|\\.aws|\\.ssh|\\.ds_store|server-status|boaform|actuator|telescope|debug',
  '|shell|config\\.(php|json|ya?ml|js)|backup|dump|database|db\\.)',
  '|\\.(php\\d?|asp|aspx|jsp|cgi|sql|sqlite|db|bak|old|zip|tar|gz|rar|7z|ini|log|sh|env)$',
].join(''), 'i');

export function isProbe(path) {
  return PROBE_RE.test(path);
}

// Rút gọn User-Agent thành "Hệ điều hành · Trình duyệt" để admin dễ đọc (vd. "iOS 16.5 · Safari", "Android 10 · Zalo").
export function deviceOf(ua) {
  ua = String(ua || '');
  let os = 'Không rõ', m;
  if ((m = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/))) os = `iOS ${m[1]}.${m[2]}`;
  else if ((m = ua.match(/Android (\d+(?:\.\d+)?)/))) os = `Android ${m[1]}`;
  else if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if ((m = ua.match(/Windows NT (\d+\.\d+)/))) os = `Windows ${{ '6.1': '7', '6.2': '8', '6.3': '8.1' }[m[1]] || m[1]}`;
  else if ((m = ua.match(/Mac OS X (\d+)[_.](\d+)/))) os = `macOS ${m[1]}.${m[2]}`;
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  const br = /Zalo/i.test(ua) ? 'Zalo' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook' : /Instagram/.test(ua) ? 'Instagram' : /TikTok|musical_ly/i.test(ua) ? 'TikTok'
    : /CocCoc|coc_coc/i.test(ua) ? 'Cốc Cốc' : /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${os} · ${br}` : os;
}

export function clientInfo(request) {
  return {
    ip: request.headers.get('CF-Connecting-IP') || '0.0.0.0',
    country: request.headers.get('CF-IPCountry') || '',
    ua: (request.headers.get('User-Agent') || '').slice(0, 200),
  };
}

// ---------- Chặn IP ----------

export async function isBlocked(db, ip) {
  const list = await cached(db, 'blocked_ips', 120, () => all(db, 'SELECT ip, until FROM blocked_ips'));
  const t = now();
  return list.some(b => b.ip === ip && (!b.until || b.until > t));
}

export async function blockIp(db, ip, reason, hours = 0) {
  await db.prepare('INSERT INTO blocked_ips (ip, reason, until, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(ip) DO UPDATE SET reason = excluded.reason, until = excluded.until, created_at = excluded.created_at')
    .bind(ip, reason, hours ? now() + hours * 3600 : 0, now()).run();
  await clearCache(db);
}

export async function unblockIp(db, ip) {
  await db.prepare('DELETE FROM blocked_ips WHERE ip = ?').bind(ip).run();
  await clearCache(db);
}

// ---------- Nhật ký ----------

// Ghi một sự kiện. Cùng IP + cùng loại trong 10 phút thì cộng dồn số lần (tiết kiệm lượt ghi).
// autoBlock: { hits, hours } → tự chặn IP khi số lần trong 10 phút đạt ngưỡng.
export async function logEvent(db, info, event, detail = '', autoBlock = null) {
  const t = now();
  const row = await first(db, 'SELECT id, hits FROM security_log WHERE ip = ? AND event = ? AND at > ? ORDER BY at DESC LIMIT 1', info.ip, event, t - 600);
  let hits = 1;
  if (row) {
    hits = row.hits + 1;
    await db.prepare('UPDATE security_log SET hits = ?, at = ?, detail = ?, ua = ? WHERE id = ?').bind(hits, t, String(detail).slice(0, 300), info.ua, row.id).run();
  } else {
    await db.prepare('INSERT INTO security_log (at, ip, country, event, detail, ua, hits) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .bind(t, info.ip, info.country, event, String(detail).slice(0, 300), info.ua).run();
  }
  if (autoBlock && hits >= autoBlock.hits) {
    await blockIp(db, info.ip, `Tự động: ${EVENT_LABELS[event] || event} ${hits} lần / 10 phút`, autoBlock.hours);
  }
  if (Math.random() < 0.02) {
    await db.prepare('DELETE FROM security_log WHERE at < ?').bind(t - 30 * 86400).run();
  }
  return hits;
}

// Số lần một sự kiện của IP trong khoảng thời gian gần đây.
export async function recentHits(db, event, sinceSec, ip = null) {
  const sql = 'SELECT COALESCE(SUM(hits), 0) c FROM security_log WHERE event = ? AND at > ?' + (ip ? ' AND ip = ?' : '');
  const args = [event, now() - sinceSec, ...(ip ? [ip] : [])];
  return (await first(db, sql, ...args)).c;
}

export const EVENT_LABELS = {
  probe: 'Dò quét lỗ hổng',
  login_fail: 'Đăng nhập sai',
  login_ok: 'Đăng nhập thành công',
  admin_ip_deny: 'IP lạ vào trang quản trị',
  session_stolen: 'Phiên admin dùng trên thiết bị khác',
  admin_2fa: 'Thay đổi xác thực 2 bước',
  login_lock: 'Khóa đăng nhập tạm thời',
  csrf: 'Gửi form giả mạo',
  play_spam: 'Bơm lượt nghe',
  comment_spam: 'Spam bình luận',
};

// ---------- Header bảo mật ----------

const ADMIN_CSP = [
  "default-src 'self'",
  "img-src 'self' https: data:",
  "media-src https: http:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

export function withSecurityHeaders(res, isAdmin) {
  const out = new Response(res.body, res);
  const h = out.headers;
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  h.set('X-Frame-Options', isAdmin ? 'DENY' : 'SAMEORIGIN');
  if (isAdmin) {
    h.set('Content-Security-Policy', ADMIN_CSP);
    h.set('X-Robots-Tag', 'noindex, nofollow');
    h.set('Cache-Control', 'no-store');
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
    h.set('Referrer-Policy', 'no-referrer'); // không để lộ đường dẫn quản trị khi bấm link ra ngoài
  }
  return out;
}
