// Giới thiệu bạn bè: người mời nhận ref_rate% Linh Thạch mà người được mời TỰ KIẾM (nhiệm vụ, điểm danh, đánh giá, thả tim, lên cấp).
// Không tính tiền admin cộng tay, tiền hoàn rút, và chỉ 1 tầng (hoa hồng không sinh hoa hồng tiếp).
import { all, first } from './db.js';
import { json, now, randomId, getCookie, setCookie, vnDay } from './util.js';

export const REF_COOKIE = 'aw_ref';
export const REF_RE = /^[A-Za-z0-9]{8}$/;
const NO_COMMISSION = /^(Admin|Hoàn|Hoa hồng|Rút)/;

// Khách mở link ?ref=MÃ: lưu cookie 30 ngày (giữ người mời đầu tiên, không ghi đè).
export function refCookieFor(request, url) {
  const code = url.searchParams.get('ref');
  if (!code || !REF_RE.test(code) || getCookie(request, REF_COOKIE) || getCookie(request, 'aw_user')) return '';
  return setCookie(REF_COOKIE, code, { maxAge: 30 * 86400 });
}

// Gắn người mời cho tài khoản MỚI vừa tạo. Trả về cookie xóa aw_ref (luôn xóa sau khi đăng ký).
export async function attachReferrer(db, s, request, newUserId, ip) {
  const code = getCookie(request, REF_COOKIE);
  if (!code || !REF_RE.test(code) || s.ref_enabled === '0') return code ? setCookie(REF_COOKIE, '', { maxAge: 0 }) : '';
  const r = await first(db, 'SELECT id, reg_ip, last_ip, locked, banned FROM users WHERE ref_code = ?', code);
  const max = Math.max(0, parseInt(s.ref_daily, 10) || 0);
  const today0 = Math.floor(Date.parse(vnDay() + 'T00:00:00+07:00') / 1000);
  let ok = r && r.id !== newUserId && !r.locked && !r.banned
    // Chống tự mời chính mình: người mời và người được mời không được cùng IP.
    && r.reg_ip !== ip && r.last_ip !== ip;
  if (ok && max) ok = (await first(db, 'SELECT COUNT(*) c FROM users WHERE referred_by = ? AND created_at >= ?', r.id, today0)).c < max;
  if (ok) await db.prepare('UPDATE users SET referred_by = ? WHERE id = ? AND referred_by = 0').bind(r.id, newUserId).run();
  return setCookie(REF_COOKIE, '', { maxAge: 0 });
}

// Gọi sau mỗi lần người dùng được cộng Linh Thạch. Phần lẻ được cộng dồn (ref_carry) cho tới khi đủ 1 Linh Thạch.
export async function payCommission(db, userId, amount, note, s) {
  if (!(amount > 0) || NO_COMMISSION.test(String(note || ''))) return;
  const rate = Math.max(0, Math.min(50, parseFloat(s && s.ref_rate) || 5)) / 100;
  if (!rate || (s && s.ref_enabled === '0')) return;
  const u = await first(db, 'UPDATE users SET ref_carry = ref_carry + ? WHERE id = ? AND referred_by > 0 RETURNING ref_carry, referred_by, name', amount * rate, userId);
  if (!u || u.ref_carry < 1) return;
  const n = Math.floor(u.ref_carry);
  // Trừ phần đã trả trong cùng câu lệnh có điều kiện → không trả trùng khi nhiều yêu cầu chạy song song.
  const r = await db.prepare('UPDATE users SET ref_carry = ref_carry - ? WHERE id = ? AND ref_carry >= ?').bind(n, userId, n).run();
  if (!r.meta.changes) return;
  const ref = await first(db, 'SELECT id, locked, banned FROM users WHERE id = ?', u.referred_by);
  if (!ref || ref.locked) return;
  await db.batch([
    db.prepare('UPDATE users SET stones = stones + ?, ref_earned = ref_earned + ? WHERE id = ?').bind(n, n, ref.id),
    db.prepare(`INSERT INTO wallet_log (user_id, kind, amount, balance, note, created_at)
      SELECT id, 'stones', ?, stones, ?, ? FROM users WHERE id = ?`).bind(n, `Hoa hồng giới thiệu: ${String(u.name).slice(0, 60)}`, now(), ref.id),
    db.prepare('UPDATE users SET ref_given = ref_given + ? WHERE id = ?').bind(n, userId),
  ]);
}

async function ensureCode(db, uid) {
  const u = await first(db, 'SELECT ref_code FROM users WHERE id = ?', uid);
  if (u && u.ref_code) return u.ref_code;
  for (let i = 0; i < 5; i++) {
    const code = randomId(8);
    const r = await db.prepare("UPDATE users SET ref_code = ? WHERE id = ? AND ref_code = '' AND NOT EXISTS (SELECT 1 FROM users WHERE ref_code = ?)").bind(code, uid, code).run();
    if (r.meta.changes) return code;
    const again = await first(db, 'SELECT ref_code FROM users WHERE id = ?', uid);
    if (again && again.ref_code) return again.ref_code;
  }
  return '';
}

export async function handleReferralApi(request, db, s, me) {
  const code = await ensureCode(db, me.id);
  const [stat, list] = await Promise.all([
    first(db, 'SELECT ref_earned FROM users WHERE id = ?', me.id),
    all(db, 'SELECT name, avatar, exp, created_at, ref_given FROM users WHERE referred_by = ? ORDER BY id DESC LIMIT 100', me.id),
  ]);
  const count = (await first(db, 'SELECT COUNT(*) c FROM users WHERE referred_by = ?', me.id)).c;
  // Ẩn bớt tên người được mời (bảo vệ riêng tư).
  const mask = n => { const a = Array.from(String(n || '?')); return a.length <= 2 ? a[0] + '*' : a[0] + '*'.repeat(Math.min(4, a.length - 2)) + a[a.length - 1]; };
  return json({ ok: true, code, rate: Math.max(0, parseFloat(s.ref_rate) || 5), enabled: s.ref_enabled !== '0', count, earned: stat ? stat.ref_earned : 0,
    list: list.map(x => ({ name: mask(x.name), at: x.created_at, given: x.ref_given })) });
}
