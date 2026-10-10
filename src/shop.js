// Cửa hàng: đổi Linh Thạch lấy hiệu ứng tên (chữ đa sắc chạy từ phải qua trái).
// Gói (tên, hiệu ứng, giá, số ngày) do admin cài trong trang quản trị.
import { all, first } from './db.js';
import { json, now } from './util.js';
import { walletLog, tooFast } from './game.js';

// Các hiệu ứng có sẵn: mã → [tên, dãy màu]. Màu dùng để vẽ CSS (public/assets/app.css + admin.css).
export const NAME_FX = {
  bang: ['Băng Tâm', ['#93c5fd', '#c4b5fd', '#f9a8d4', '#a5b4fc']],
  lua: ['Hỏa Diệm', ['#dc2626', '#f97316', '#facc15', '#fb923c']],
  hoadao: ['Hoa Đào', ['#f472b6', '#f9a8d4', '#ec4899', '#fbcfe8']],
  thien: ['Thiên Không', ['#93c5fd', '#60a5fa', '#2563eb', '#1e40af']],
  hai: ['Hải Lam', ['#1d4ed8', '#06b6d4', '#2563eb', '#38bdf8']],
  cauvong: ['Thất Sắc Cầu Vồng', ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899']],
  kim: ['Hoàng Kim', ['#b45309', '#f59e0b', '#facc15', '#d97706']],
  tim: ['Tử Vi', ['#7c3aed', '#c026d3', '#a78bfa', '#db2777']],
  ngoc: ['Bích Ngọc', ['#059669', '#10b981', '#2dd4bf', '#0d9488']],
  huyet: ['Huyết Nguyệt', ['#991b1b', '#e11d48', '#f43f5e', '#be123c']],
  hoanghon: ['Hoàng Hôn', ['#f43f5e', '#fb923c', '#facc15', '#a855f7']],
  cucquang: ['Cực Quang', ['#06b6d4', '#84cc16', '#6366f1', '#d946ef']],
};

// Hiệu ứng đang dùng của một thành viên (rỗng nếu chưa có hoặc đã hết hạn).
export const fxOf = u => (u && u.name_fx && NAME_FX[u.name_fx] && (!u.name_fx_until || u.name_fx_until > now())) ? u.name_fx : '';

const until = r => r && (!r.until || r.until > now());

export async function shopData(db, me) {
  const items = await all(db, 'SELECT id, name, fx, price, days FROM shop_items WHERE active = 1 ORDER BY pos, price, id');
  const owned = me ? await all(db, 'SELECT fx, until FROM user_fx WHERE user_id = ?', me.id) : [];
  return {
    ok: true,
    items: items.filter(i => NAME_FX[i.fx]),
    owned: owned.filter(o => NAME_FX[o.fx] && until(o)).map(o => ({ fx: o.fx, until: o.until })),
    using: me ? fxOf(me) : '',
    stones: me ? me.stones : 0,
    names: Object.fromEntries(Object.entries(NAME_FX).map(([k, v]) => [k, v[0]])),
  };
}

export async function handleShopApi(request, db, s, path, me, input) {
  // Bấm dồn dập → bỏ qua luôn, không đụng cơ sở dữ liệu.
  if (tooFast(`shop${me.id}`, 6, 10000)) return json({ ok: false, silent: true }, 429);

  if (path === '/api/shop/buy') {
    const item = await first(db, 'SELECT * FROM shop_items WHERE id = ? AND active = 1', parseInt(input.id, 10) || 0);
    if (!item || !NAME_FX[item.fx]) return json({ ok: false, error: 'Gói này không còn bán.' }, 404);
    const price = Math.max(0, Math.floor(item.price)), days = Math.max(0, Math.floor(item.days));
    const t = now();
    const prev = await first(db, 'SELECT until FROM user_fx WHERE user_id = ? AND fx = ?', me.id, item.fx);
    if (prev && prev.until === 0) return json({ ok: false, error: 'Bạn đã sở hữu vĩnh viễn hiệu ứng này rồi.' }, 400);

    let newUntil;
    if (!days) {
      // Gói vĩnh viễn: giữ chỗ trước (câu lệnh có điều kiện) → bấm mua song song chỉ 1 lần bị trừ tiền.
      const claim = await db.prepare(`INSERT INTO user_fx (user_id, fx, until, created_at) VALUES (?, ?, 0, ?)
          ON CONFLICT(user_id, fx) DO UPDATE SET until = 0 WHERE user_fx.until != 0`).bind(me.id, item.fx, t).run();
      if (!claim.meta.changes) return json({ ok: false, error: 'Bạn đã sở hữu vĩnh viễn hiệu ứng này rồi.' }, 400);
      const paid = price ? await db.prepare('UPDATE users SET stones = stones - ? WHERE id = ? AND stones >= ?').bind(price, me.id, price).run() : { meta: { changes: 1 } };
      if (!paid.meta.changes) {
        // Không đủ Linh Thạch: trả lại trạng thái cũ.
        if (prev) await db.prepare('UPDATE user_fx SET until = ? WHERE user_id = ? AND fx = ?').bind(prev.until, me.id, item.fx).run();
        else await db.prepare('DELETE FROM user_fx WHERE user_id = ? AND fx = ?').bind(me.id, item.fx).run();
        return json({ ok: false, error: 'Bạn không đủ Linh Thạch.' }, 400);
      }
      newUntil = 0;
    } else {
      // Gói có hạn: trừ tiền (có điều kiện đủ số dư) rồi cộng thêm ngày (mua nhiều lần = gia hạn dồn).
      const paid = price ? await db.prepare('UPDATE users SET stones = stones - ? WHERE id = ? AND stones >= ?').bind(price, me.id, price).run() : { meta: { changes: 1 } };
      if (!paid.meta.changes) return json({ ok: false, error: 'Bạn không đủ Linh Thạch.' }, 400);
      const row = await first(db, `INSERT INTO user_fx (user_id, fx, until, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, fx) DO UPDATE SET until = CASE WHEN user_fx.until = 0 THEN 0 ELSE MAX(user_fx.until, ?) + ? END
          RETURNING until`, me.id, item.fx, t + days * 86400, t, t, days * 86400);
      newUntil = row ? row.until : t + days * 86400;
    }
    if (price) await walletLog(db, me.id, 'stones', -price, `Cửa hàng: ${item.name}`);
    // Mua xong tự dùng luôn hiệu ứng vừa mua.
    await db.prepare('UPDATE users SET name_fx = ?, name_fx_until = ? WHERE id = ?').bind(item.fx, newUntil, me.id).run();
    return json({ ok: true, fx: item.fx, until: newUntil, name: item.name, price });
  }

  // Đổi hiệu ứng đang dùng (chỉ chọn được hiệu ứng mình sở hữu và còn hạn), fx rỗng = tắt.
  if (path === '/api/shop/use') {
    const fx = String(input.fx || '');
    if (!fx) {
      await db.prepare("UPDATE users SET name_fx = '', name_fx_until = 0 WHERE id = ?").bind(me.id).run();
      return json({ ok: true, fx: '' });
    }
    const own = await first(db, 'SELECT until FROM user_fx WHERE user_id = ? AND fx = ?', me.id, fx);
    if (!NAME_FX[fx] || !until(own)) return json({ ok: false, error: 'Bạn chưa sở hữu hiệu ứng này.' }, 400);
    await db.prepare('UPDATE users SET name_fx = ?, name_fx_until = ? WHERE id = ?').bind(fx, own.until, me.id).run();
    return json({ ok: true, fx });
  }

  return json({ ok: false, error: 'not_found' }, 404);
}
