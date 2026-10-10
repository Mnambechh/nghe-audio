// Rút Linh Thạch: tài khoản nhận tiền (ngân hàng, MoMo, ViettelPay, ZaloPay) và yêu cầu rút (admin duyệt tay).
import { all, first } from './db.js';
import { json, now, vnDay, vnPlain } from './util.js';
import { walletStmt } from './game.js';

export const WITHDRAW_DEFAULTS = {
  withdraw_enabled: '1',
  withdraw_min: '10000',       // Linh Thạch tối thiểu mỗi lần rút
  withdraw_rate: '1',          // 1 Linh Thạch = bao nhiêu đồng
  withdraw_daily: '1',         // số lần rút mỗi ngày
};

export const METHODS = { bank: 'Ngân hàng', momo: 'MoMo', viettelpay: 'ViettelPay', zalopay: 'ZaloPay' };

export const BANKS = [
  'Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'ACB', 'VPBank', 'TPBank', 'Sacombank',
  'HDBank', 'VIB', 'SHB', 'SeABank', 'OCB', 'MSB', 'LPBank', 'Eximbank', 'Nam A Bank', 'Bac A Bank', 'BVBank',
  'ABBANK', 'Kienlongbank', 'PVcomBank', 'Saigonbank', 'VietABank', 'NCB', 'PGBank', 'BaoViet Bank', 'GPBank',
  'Cake by VPBank', 'Timo', 'TNEX', 'Ubank', 'Liobank', 'Shinhan Bank', 'Woori Bank', 'UOB', 'Standard Chartered', 'HSBC',
];

const MAX_ACCOUNTS = 3;
const num = (s, k) => Math.max(0, parseFloat(s[k] ?? WITHDRAW_DEFAULTS[k]) || 0);

export function withdrawConfig(s) {
  return {
    enabled: s.withdraw_enabled !== '0',
    min: num(s, 'withdraw_min'),
    rate: num(s, 'withdraw_rate'),
    daily: num(s, 'withdraw_daily'),
  };
}

// Kiểm tra điều kiện rút; trả về chuỗi lý do nếu chưa đủ, hoặc '' nếu được rút.
async function blocker(db, s, u) {
  const c = withdrawConfig(s);
  if (!c.enabled) return 'Chức năng rút Linh Thạch đang tạm đóng.';
  if (u.banned || u.locked) return 'Tài khoản của bạn đang bị khóa.';
  const pending = await first(db, "SELECT 1 x FROM withdrawals WHERE user_id = ? AND status = 'pending'", u.id);
  if (pending) return 'Bạn đang có một yêu cầu chờ duyệt, vui lòng đợi xử lý xong.';
  const today = await first(db, "SELECT COUNT(*) c FROM withdrawals WHERE user_id = ? AND day = ? AND status != 'rejected'", u.id, vnDay());
  if (c.daily && today.c >= c.daily) return `Mỗi ngày chỉ rút được ${c.daily} lần.`;
  return '';
}

function cleanAccount(input) {
  const method = String(input.method || '');
  if (!METHODS[method]) return { error: 'Chọn loại tài khoản.' };
  const bank = method === 'bank' ? String(input.bank || '').trim() : '';
  if (method === 'bank' && !BANKS.includes(bank)) return { error: 'Chọn ngân hàng.' };
  const number = String(input.number || '').replace(/[\s.-]/g, '');
  if (method === 'bank' && !/^\d{6,19}$/.test(number)) return { error: 'Số tài khoản ngân hàng gồm 6–19 chữ số.' };
  if (method !== 'bank' && !/^0\d{9}$/.test(number)) return { error: 'Số điện thoại ví gồm 10 số, bắt đầu bằng 0.' };
  const holder = vnPlain(String(input.holder || '')).toUpperCase().replace(/[^A-Z\s]/g, '').replace(/\s+/g, ' ').trim();
  if (holder.length < 3 || holder.length > 50) return { error: 'Nhập tên chủ tài khoản (không dấu, như trên thẻ/ví).' };
  return { method, bank, number, holder };
}

export async function handleWithdrawApi(request, db, s, path, me, input, info) {
  const c = withdrawConfig(s);

  if (path === '/api/withdraw' && request.method === 'GET') {
    const [accounts, history, u] = await Promise.all([
      all(db, 'SELECT id, method, bank, number, holder FROM payout_accounts WHERE user_id = ? ORDER BY id', me.id),
      all(db, 'SELECT id, amount, vnd, method, bank, number, holder, status, admin_note, created_at, processed_at FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT 30', me.id),
      first(db, 'SELECT id, stones, exp, created_at, banned, locked FROM users WHERE id = ?', me.id),
    ]);
    return json({ ok: true, balance: u.stones, config: c, methods: METHODS, banks: BANKS, accounts, history, blocked: await blocker(db, s, u) });
  }

  if (path === '/api/withdraw/account') {
    const a = cleanAccount(input);
    if (a.error) return json({ ok: false, error: a.error }, 400);
    const n = await first(db, 'SELECT COUNT(*) c FROM payout_accounts WHERE user_id = ?', me.id);
    if (n.c >= MAX_ACCOUNTS) return json({ ok: false, error: `Tối đa ${MAX_ACCOUNTS} tài khoản, hãy xóa bớt.` }, 400);
    await db.prepare('INSERT INTO payout_accounts (user_id, method, bank, number, holder, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(me.id, a.method, a.bank, a.number, a.holder, now()).run();
    return json({ ok: true });
  }

  if (path === '/api/withdraw/account/delete') {
    await db.prepare('DELETE FROM payout_accounts WHERE id = ? AND user_id = ?').bind(parseInt(input.id, 10) || 0, me.id).run();
    return json({ ok: true });
  }

  if (path === '/api/withdraw' && request.method === 'POST') {
    const u = await first(db, 'SELECT id, stones, exp, created_at, banned, locked FROM users WHERE id = ?', me.id);
    const why = await blocker(db, s, u);
    if (why) return json({ ok: false, error: why }, 400);
    const amount = Math.floor(+input.amount || 0);
    if (amount < c.min) return json({ ok: false, error: `Rút tối thiểu ${c.min.toLocaleString('vi-VN')} Linh Thạch.` }, 400);
    const acc = await first(db, 'SELECT * FROM payout_accounts WHERE id = ? AND user_id = ?', parseInt(input.account_id, 10) || 0, me.id);
    if (!acc) return json({ ok: false, error: 'Chọn tài khoản nhận tiền.' }, 400);
    if (u.stones < amount) return json({ ok: false, error: 'Số Linh Thạch không đủ.' }, 400);
    const vnd = Math.floor(amount * c.rate), today = vnDay();
    // 1) Tạo yêu cầu có điều kiện (không có yêu cầu chờ duyệt, chưa vượt số lần/ngày) trong MỘT câu lệnh:
    //    gửi nhiều yêu cầu cùng lúc thì chỉ một cái được tạo.
    const ins = await db.prepare(`INSERT INTO withdrawals (user_id, amount, vnd, method, bank, number, holder, status, day, ip, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM withdrawals WHERE user_id = ? AND status = 'pending')
        AND (? = 0 OR (SELECT COUNT(*) FROM withdrawals WHERE user_id = ? AND day = ? AND status != 'rejected') < ?)`)
      .bind(me.id, amount, vnd, acc.method, acc.bank, acc.number, acc.holder, today, info.ip, now(), me.id, c.daily, me.id, today, c.daily).run();
    if (!ins.meta.changes) return json({ ok: false, error: 'Bạn đang có yêu cầu chờ duyệt hoặc đã hết lượt rút hôm nay.' }, 400);
    const wid = ins.meta.last_row_id;
    // 2) Trừ Linh Thạch có điều kiện đủ số dư; không đủ thì hủy yêu cầu vừa tạo.
    const r = await db.prepare('UPDATE users SET stones = stones - ? WHERE id = ? AND stones >= ?').bind(amount, me.id, amount).run();
    if (!r.meta.changes) {
      await db.prepare('DELETE FROM withdrawals WHERE id = ?').bind(wid).run();
      return json({ ok: false, error: 'Số Linh Thạch không đủ.' }, 400);
    }
    await db.batch([
      db.prepare('INSERT INTO member_log (user_id, action, amount, note, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(me.id, 'withdraw', -amount, `Yêu cầu rút về ${METHODS[acc.method]}${acc.bank ? ' ' + acc.bank : ''} ${acc.number}`, now()),
      walletStmt(db, me.id, 'stones', -amount, `Rút Linh Thạch về ${METHODS[acc.method]}${acc.bank ? ' ' + acc.bank : ''}`),
    ]);
    return json({ ok: true, amount, vnd });
  }

  return json({ ok: false, error: 'not_found' }, 404);
}
