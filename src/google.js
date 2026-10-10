// Xác minh mã đăng nhập Google (ID token, chuẩn JWT ký RS256) ngay trên Cloudflare, không cần thư viện.
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

let keyCache = null; // { keys, exp }

async function googleKeys(force = false) {
  const t = Date.now();
  if (!force && keyCache && keyCache.exp > t) return keyCache.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('Không tải được khóa của Google');
  const { keys } = await res.json();
  const m = (res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/);
  keyCache = { keys, exp: t + Math.min(86400, m ? +m[1] : 3600) * 1000 };
  return keys;
}

const b64urlBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const b64urlJson = s => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

/**
 * Trả về thông tin người dùng nếu token hợp lệ, ném lỗi nếu không.
 * getKeys có thể thay thế khi chạy thử.
 */
export async function verifyGoogleToken(token, clientId, getKeys = googleKeys) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Token không hợp lệ');
  const [h, p, sig] = parts;
  const header = b64urlJson(h);
  if (header.alg !== 'RS256') throw new Error('Thuật toán không hợp lệ');
  let jwk = (await getKeys()).find(k => k.kid === header.kid);
  if (!jwk) jwk = (await getKeys(true)).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Không tìm thấy khóa');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(sig), new TextEncoder().encode(h + '.' + p));
  if (!ok) throw new Error('Chữ ký không hợp lệ');
  const c = b64urlJson(p);
  const now = Math.floor(Date.now() / 1000);
  if (!ISSUERS.includes(c.iss)) throw new Error('Nguồn token không hợp lệ');
  if (c.aud !== clientId) throw new Error('Token không dành cho web này');
  if (!c.exp || c.exp < now - 60) throw new Error('Token đã hết hạn');
  if (!c.sub) throw new Error('Thiếu mã người dùng');
  return {
    sub: String(c.sub),
    name: String(c.name || c.given_name || (c.email || '').split('@')[0] || 'Người nghe').slice(0, 60),
    email: String(c.email || '').slice(0, 120),
    avatar: /^https:\/\/[a-z0-9.-]*googleusercontent\.com\//i.test(c.picture || '') ? c.picture : '',
  };
}
