// Cửa hàng: đổi Linh Thạch lấy hiệu ứng tên (chữ đa sắc chạy từ phải qua trái).
// Gói (tên, hiệu ứng, giá, số ngày) do admin cài trong trang quản trị.
import { all, first } from './db.js';
import { json, now } from './util.js';
import { walletStmt, tooFast, vipActive } from './game.js';

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
// Khung avatar đang dùng: { frame: '/media/…', fs: cỡ % } hoặc rỗng nếu chưa có / hết hạn.
const FRAME_RE = /^\/media\/[A-Za-z0-9]+\.(webp|png)$/;
export const frameOf = u => (u && FRAME_RE.test(u.frame_img || '') && (!u.frame_until || u.frame_until > now()))
  ? { frame: u.frame_img, fs: Math.max(100, Math.min(300, u.frame_scale || 160)) } : {};

// Mã sở hữu trong bảng user_fx: hiệu ứng tên = mã hiệu ứng, khung = "f" + mã gói.
const keyOf = item => item.kind === 'frame' ? 'f' + item.id : item.fx;
const valid = r => r && (!r.until || r.until > now());

export async function shopData(db, me) {
  const items = await all(db, "SELECT id, name, kind, fx, img, scale, price, days, sold FROM shop_items WHERE active = 1 AND deleted = 0 ORDER BY kind = 'vip' DESC, kind = 'frame', pos, price, id");
  const owned = me ? (await all(db, 'SELECT fx, until FROM user_fx WHERE user_id = ?', me.id)).filter(valid) : [];
  // Khung đã mua vẫn dùng được kể cả khi admin ngừng bán gói.
  const fids = owned.filter(o => /^f\d+$/.test(o.fx)).map(o => +o.fx.slice(1));
  const frames = fids.length ? await all(db, `SELECT id, name, img, scale FROM shop_items WHERE kind = 'frame' AND id IN (${fids.map(() => '?').join(',')})`, ...fids) : [];
  const fmap = Object.fromEntries(frames.map(f => [f.id, f]));
  return {
    ok: true,
    items: items.filter(i => i.kind === 'vip' || (i.kind === 'frame' ? FRAME_RE.test(i.img) : NAME_FX[i.fx])).map(i => ({ ...i, key: keyOf(i) })),
    owned: owned.filter(o => NAME_FX[o.fx] || fmap[o.fx.slice(1)]).map(o => {
      const f = NAME_FX[o.fx] ? null : fmap[o.fx.slice(1)];
      return f ? { key: o.fx, kind: 'frame', id: f.id, name: f.name, img: f.img, scale: f.scale, until: o.until } : { key: o.fx, kind: 'fx', fx: o.fx, name: NAME_FX[o.fx][0], until: o.until };
    }),
    using: me ? fxOf(me) : '',
    frameUsing: me && frameOf(me).frame ? me.frame_id : 0,
    stones: me ? me.stones : 0,
    vipUntil: me && vipActive(me) ? me.vip_until : 0,
    // Số người đang dùng VIP (còn hạn).
    vipCount: (await first(db, 'SELECT COUNT(*) n FROM users WHERE vip_until > ?', now())).n,
  };
}

async function equip(db, me, item, until) {
  if (item.kind === 'frame') {
    await db.prepare('UPDATE users SET frame_id = ?, frame_img = ?, frame_scale = ?, frame_until = ? WHERE id = ?').bind(item.id, item.img, item.scale || 160, until, me.id).run();
  } else {
    await db.prepare('UPDATE users SET name_fx = ?, name_fx_until = ? WHERE id = ?').bind(item.fx, until, me.id).run();
  }
}

export async function handleShopApi(request, db, s, path, me, input) {
  // Bấm dồn dập → bỏ qua luôn, không đụng cơ sở dữ liệu.
  if (tooFast(`shop${me.id}`, 6, 10000)) return json({ ok: false, silent: true }, 429);

  if (path === '/api/shop/buy') {
    const item = await first(db, 'SELECT * FROM shop_items WHERE id = ? AND active = 1 AND deleted = 0', parseInt(input.id, 10) || 0);
    if (!item || !['vip', 'frame', 'fx'].includes(item.kind)
      || (item.kind === 'frame' ? !FRAME_RE.test(item.img) : item.kind === 'fx' && !Object.hasOwn(NAME_FX, item.fx))) {
      return json({ ok: false, error: 'Gói này không còn bán.' }, 404);
    }
    const price = Math.max(0, Math.floor(item.price));
    const days = item.kind === 'vip' ? Math.max(1, Math.floor(item.days) || 7) : Math.max(0, Math.floor(item.days));
    if (!Number.isSafeInteger(price) || !Number.isSafeInteger(days) || !Number.isSafeInteger(now() + days * 86400)) {
      return json({ ok: false, error: 'Gói này chưa được cấu hình hợp lệ.' }, 400);
    }
    const t = now(), note = `Cửa hàng: ${item.name}`;
    const sold = db.prepare('UPDATE shop_items SET sold = sold + 1 WHERE id = ? AND changes() > 0').bind(item.id);
    const log = price ? [walletStmt(db, me.id, 'stones', -price, note, true)] : [];
    // D1 batch là một giao dịch: không ai nhìn thấy vật phẩm/VIP chưa trả tiền,
    // lỗi ở bất kỳ bước nào cũng hoàn tác số dư, quyền sở hữu và lịch sử.
    // changes() truyền kết quả bước trước; không trừ được tiền thì mọi bước sau bỏ qua.
    if (item.kind === 'vip') {
      const result = await db.batch([
        db.prepare(`UPDATE users SET stones = stones - ?, vip_until = MAX(COALESCE(vip_until, 0), ?) + ?
          WHERE id = ? AND locked = 0 AND stones >= ?
            AND EXISTS (SELECT 1 FROM shop_items WHERE id = ? AND active = 1 AND deleted = 0)
          RETURNING vip_until`).bind(price, t, days * 86400, me.id, price, item.id),
        sold, ...log,
      ]);
      if (!result[0].meta.changes) return json({ ok: false, error: 'Bạn không đủ Linh Thạch hoặc gói đã ngừng bán.' }, 400);
      return json({ ok: true, kind: 'vip', fx: '', until: result[0].results[0].vip_until, name: item.name, price });
    }
    const key = keyOf(item);
    const prev = await first(db, 'SELECT until FROM user_fx WHERE user_id = ? AND fx = ?', me.id, key);
    if (prev && prev.until === 0) return json({ ok: false, error: 'Bạn đã sở hữu vĩnh viễn vật phẩm này rồi.' }, 400);
    const equipStmt = item.kind === 'frame'
      ? db.prepare(`UPDATE users SET frame_id = ?, frame_img = ?, frame_scale = ?,
          frame_until = (SELECT until FROM user_fx WHERE user_id = ? AND fx = ?)
          WHERE id = ? AND changes() > 0`).bind(item.id, item.img, item.scale || 160, me.id, key, me.id)
      : db.prepare(`UPDATE users SET name_fx = ?, name_fx_until = (SELECT until FROM user_fx WHERE user_id = ? AND fx = ?)
          WHERE id = ? AND changes() > 0`).bind(item.fx, me.id, key, me.id);
    const result = await db.batch([
      db.prepare(`UPDATE users SET stones = stones - ? WHERE id = ? AND locked = 0 AND stones >= ?
          AND NOT EXISTS (SELECT 1 FROM user_fx WHERE user_id = ? AND fx = ? AND until = 0)
          AND EXISTS (SELECT 1 FROM shop_items WHERE id = ? AND active = 1 AND deleted = 0)`)
        .bind(price, me.id, price, me.id, key, item.id),
      db.prepare(`INSERT INTO user_fx (user_id, fx, until, created_at)
          SELECT ?, ?, ?, ? WHERE changes() > 0
          ON CONFLICT(user_id, fx) DO UPDATE SET until = CASE WHEN ? = 0 THEN 0 ELSE MAX(user_fx.until, ?) + ? END
          RETURNING until`).bind(me.id, key, days ? t + days * 86400 : 0, t, days, t, days * 86400),
      equipStmt, sold, ...log,
    ]);
    if (!result[0].meta.changes) return json({ ok: false, error: 'Bạn không đủ Linh Thạch, đã sở hữu vĩnh viễn hoặc gói đã ngừng bán.' }, 400);
    return json({ ok: true, kind: item.kind, fx: item.kind === 'frame' ? '' : item.fx,
      until: result[1].results[0].until, name: item.name, price });
  }

  // Đổi hiệu ứng tên / khung đang dùng (chỉ chọn được thứ mình sở hữu và còn hạn). Rỗng / 0 = tắt.
  if (path === '/api/shop/use') {
    if ('frame' in input) {
      const id = parseInt(input.frame, 10) || 0;
      if (!id) {
        await db.prepare("UPDATE users SET frame_id = 0, frame_img = '', frame_until = 0 WHERE id = ?").bind(me.id).run();
        return json({ ok: true, frame: 0 });
      }
      const [own, item] = await Promise.all([
        first(db, 'SELECT until FROM user_fx WHERE user_id = ? AND fx = ?', me.id, 'f' + id),
        first(db, "SELECT * FROM shop_items WHERE id = ? AND kind = 'frame'", id),
      ]);
      if (!item || !FRAME_RE.test(item.img) || !valid(own)) return json({ ok: false, error: 'Bạn chưa sở hữu khung này.' }, 400);
      await equip(db, me, item, own.until);
      return json({ ok: true, frame: id });
    }
    const fx = String(input.fx || '');
    if (!fx) {
      await db.prepare("UPDATE users SET name_fx = '', name_fx_until = 0 WHERE id = ?").bind(me.id).run();
      return json({ ok: true, fx: '' });
    }
    const own = await first(db, 'SELECT until FROM user_fx WHERE user_id = ? AND fx = ?', me.id, fx);
    if (!NAME_FX[fx] || !valid(own)) return json({ ok: false, error: 'Bạn chưa sở hữu hiệu ứng này.' }, 400);
    await equip(db, me, { kind: 'fx', fx }, own.until);
    return json({ ok: true, fx });
  }

  return json({ ok: false, error: 'not_found' }, 404);
}
