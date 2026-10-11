// Hàm tiện ích dùng chung.

export const LIVE_WINDOW = 150; // giây: trình phát ping mỗi 60s, quá 150s coi như đã rời
// Múi giờ của web (mặc định GMT+7 Hồ Chí Minh). Admin chỉnh trong Cài đặt; loadSettings gọi setTzOffset.
// Mọi mốc "0h làm mới" (nhiệm vụ, giới hạn mỗi ngày, thống kê hôm nay) tính theo múi giờ này.
let TZ_OFFSET = 7 * 3600e3;
export function setTzOffset(hours) {
  const h = parseFloat(hours);
  TZ_OFFSET = (Number.isFinite(h) && h >= -12 && h <= 14 ? h : 7) * 3600e3;
}
export const tzHours = () => TZ_OFFSET / 3600e3;
// Thời điểm 0h hôm nay (giây, Unix) và số giây còn lại tới 0h hôm sau theo múi giờ của web.
export function dayStartTs() {
  const local = Date.now() + TZ_OFFSET;
  return Math.floor((local - (local % 86400e3) - TZ_OFFSET) / 1000);
}
export const secondsToReset = () => dayStartTs() + 86400 - Math.floor(Date.now() / 1000);

export function h(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// JSON an toàn để nhúng vào <script>.
export function jsonScript(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export const now = () => Math.floor(Date.now() / 1000);

// Ngày theo giờ Việt Nam, dạng YYYY-MM-DD. daysAgo > 0 để lùi ngày.
export function vnDay(daysAgo = 0) {
  return new Date(Date.now() + TZ_OFFSET - daysAgo * 86400e3).toISOString().slice(0, 10);
}

export function vnDate(ts, withTime = false) {
  const d = new Date(ts * 1000 + TZ_OFFSET).toISOString();
  const s = `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  return withTime ? `${s} ${d.slice(11, 16)}` : s;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const hh = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = String(sec % 60).padStart(2, '0');
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function fmtNum(n) {
  n = Number(n) || 0;
  const short = (v, unit) => v.toFixed(1).replace(/\.0$/, '').replace('.', ',') + ' ' + unit;
  if (n >= 1e6) return short(n / 1e6, 'Tr');
  if (n >= 1e3) return short(n / 1e3, 'N');
  return String(n);
}

export function fmtInt(n) {
  return String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Bỏ dấu tiếng Việt, chữ thường. Dùng cho slug và tìm kiếm không dấu.
export function vnPlain(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
}

export function slugify(s) {
  return vnPlain(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'audio';
}

export function parseDuration(s) {
  s = String(s ?? '').trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return s.split(':').reduce((acc, p) => acc * 60 + (parseInt(p, 10) || 0), 0);
}

export function randomId(len = 24) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(buf, b => abc[b % abc.length]).join('');
}

// ---------- Phản hồi ----------

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function html(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SEC_HEADERS, ...headers } });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function redirect(location, headers = {}) {
  return new Response(null, { status: 303, headers: { Location: location, ...headers } });
}

// ---------- Cookie ----------

export function getCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  try { return m ? decodeURIComponent(m[1]) : null; }
  catch { return null; }
}

export function setCookie(name, value, { maxAge, path = '/', sameSite = 'Lax', httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}; Secure`;
  if (httpOnly) c += '; HttpOnly';
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

// ---------- Mã hóa ----------

const enc = new TextEncoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = s => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

const PBKDF2_ITER = 100000;

export async function hashPassword(pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(pass, stored) {
  const [alg, iter, salt, hash] = String(stored || '').split('$');
  if (alg !== 'pbkdf2') return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: +iter }, key, 256);
  return safeEqual(b64(bits), hash);
}

export function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

// Token phiên đăng nhập có chữ ký: base64url(json).chữký
export async function signToken(secret, payload) {
  const body = b64url(JSON.stringify(payload));
  return body + '.' + (await hmac(secret, body));
}

export async function readToken(secret, token) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig || !safeEqual(sig, await hmac(secret, body))) return null;
  try {
    const p = JSON.parse(unb64url(body));
    return p.exp > now() ? p : null;
  } catch (e) {
    return null;
  }
}

// ---------- Ảnh tải lên ----------

// Nhận diện ảnh theo vài byte đầu, trả về MIME hoặc null.
export function imageType(bytes) {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
  return null;
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s) {
  return unb64(s);
}
