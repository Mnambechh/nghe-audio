// Xác thực 2 bước (TOTP, chuẩn RFC 6238) — dùng với Google Authenticator, Microsoft Authenticator, Authy…
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomBase32(len = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => B32[b % 32]).join('');
}

function base32Decode(s) {
  s = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const c of s) {
    val = (val << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function hotp(secret, counter) {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, '0');
}

// Trả về bước thời gian (counter) khớp với mã, hoặc 0 nếu sai. Cho lệch ±1 bước (30 giây) vì đồng hồ điện thoại.
export async function verifyTotp(secret, code, notBefore = 0) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code) || !secret) return 0;
  const step = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) {
    const c = step + d;
    if (c <= notBefore) continue; // chống dùng lại mã cũ
    if (await hotp(secret, c) === code) return c;
  }
  return 0;
}

export function otpauthUri(secret, account, issuer) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}
