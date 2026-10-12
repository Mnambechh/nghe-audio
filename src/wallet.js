// Lịch sử cá nhân và đối chiếu giao dịch; bảng cảnh báo chỉ gọi sau xác thực admin.
import { all, first } from './db.js';
import { now, dayStartTs } from './util.js';
import { GAME_DEFAULTS } from './game.js';
import { listenConfig, commentConfig } from './quests.js';

export async function walletData(db, userId, params) {
  const kind = ['exp', 'stones'].includes(params.get('kind')) ? params.get('kind') : '';
  const cursor = Number(params.get('before'));
  const before = Number.isSafeInteger(cursor) && cursor > 0 ? cursor : 0;
  const rows = await all(db, `SELECT id, kind, amount, balance, note, created_at FROM wallet_log
    WHERE user_id = ?${kind ? ' AND kind = ?' : ''}${before ? ' AND id < ?' : ''}
    ORDER BY id DESC LIMIT 51`, userId, ...(kind ? [kind] : []), ...(before ? [before] : []));
  const balance = await first(db, 'SELECT stones, exp FROM users WHERE id = ?', userId);
  return { ok: true, kind, balance, more: rows.length > 50, items: rows.slice(0, 50) };
}

export async function walletAnomalies(db, s, requestedPage = 1) {
  const page = Math.max(1, Math.min(10000, Math.floor(Number(requestedPage)) || 1));
  const number = k => {
    const value = Number(s[k] ?? GAME_DEFAULTS[k]);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  };
  const links = await first(db, "SELECT COALESCE(SUM(stones), 0) stones, COALESCE(SUM(exp), 0) exp FROM quests WHERE active = 1 AND url != ''");
  const listen = listenConfig(s), comment = commentConfig(s);
  // Lấy x2 để người đang/hết VIP trong ngày không bị báo nhầm. Cộng tay, hoàn tiền,
  // hoa hồng và thưởng lên cấp có quy tắc riêng, không gộp vào trần nhiệm vụ ngày.
  const stonesLimit = 2 * (number('checkin_stones') + number('rate_daily') * number('rate_stones')
    + number('heart_daily') * number('heart_stones') + links.stones
    + (listen.enabled ? listen.tiers.reduce((n, t) => n + t.stones, 0) : 0)
    + (comment.enabled ? comment.stones : 0));
  const expLimit = 2 * (number('checkin_exp') + number('rate_daily') * number('rate_exp')
    + number('heart_daily') * number('heart_exp') + number('comment_exp_daily') * number('comment_exp')
    + links.exp + (listen.enabled ? listen.tiers.reduce((n, t) => n + t.exp, 0) : 0));
  const start = dayStartTs(), cutoff = now() - 120;
  const rows = await all(db, `WITH daily AS (
      SELECT user_id,
        SUM(CASE WHEN kind = 'stones' THEN amount ELSE 0 END) earned_stones,
        SUM(CASE WHEN kind = 'exp' THEN amount ELSE 0 END) earned_exp
      FROM wallet_log WHERE created_at >= ? AND created_at < ? AND amount > 0
        AND note NOT LIKE 'Admin%' AND note NOT LIKE 'Hoàn%' AND note NOT LIKE 'Hoa hồng%'
        AND note NOT LIKE 'Thưởng đột phá%' AND note NOT LIKE 'Rút%'
      GROUP BY user_id
    ), repeated AS (
      SELECT user_id, COUNT(*) duplicate_sources FROM (
        SELECT user_id, replace(note, ' (VIP x2)', '') source FROM wallet_log
        WHERE created_at >= ? AND created_at < ? AND amount > 0 AND kind = 'stones'
          AND (note LIKE 'Điểm danh hằng ngày%' OR note LIKE 'Nhiệm vụ: Bình luận hợp lệ%'
            OR note LIKE 'Nhiệm vụ: Nghe audio %')
        GROUP BY user_id, source HAVING COUNT(*) > 1
      ) GROUP BY user_id
    ), latest AS (
      SELECT u.id, u.name, u.email, u.exp, u.stones, u.locked,
        (SELECT balance FROM wallet_log WHERE user_id = u.id AND kind = 'stones' ORDER BY id DESC LIMIT 1) log_stones,
        (SELECT balance FROM wallet_log WHERE user_id = u.id AND kind = 'exp' ORDER BY id DESC LIMIT 1) log_exp,
        (SELECT MAX(created_at) FROM wallet_log WHERE user_id = u.id) last_at
      FROM users u
    ) SELECT l.*, COALESCE(d.earned_stones, 0) earned_stones, COALESCE(d.earned_exp, 0) earned_exp,
        COALESCE(r.duplicate_sources, 0) duplicate_sources
      FROM latest l LEFT JOIN daily d ON d.user_id = l.id LEFT JOIN repeated r ON r.user_id = l.id
      WHERE l.stones < 0 OR l.exp < 0 OR r.duplicate_sources > 0
        OR d.earned_stones > ? OR d.earned_exp > ?
        OR (l.last_at <= ? AND ((l.log_stones IS NOT NULL AND l.stones != l.log_stones)
          OR (l.log_exp IS NOT NULL AND l.exp != l.log_exp)))
      ORDER BY (l.stones < 0 OR l.exp < 0) DESC, r.duplicate_sources DESC, l.last_at DESC, l.id DESC LIMIT 101 OFFSET ?`,
    start, start + 86400, start, start + 86400, stonesLimit, expLimit, cutoff, (page - 1) * 100);
  return { stonesLimit, expLimit, page, more: rows.length > 100, rows: rows.slice(0, 100).map(r => {
    const reasons = [];
    if (r.stones < 0 || r.exp < 0) reasons.push('Số dư Linh Thạch hoặc EXP âm');
    if (r.last_at <= cutoff && r.log_stones != null && r.stones !== r.log_stones) reasons.push(`Linh Thạch lệch nhật ký: ${r.stones} / ${r.log_stones}`);
    if (r.last_at <= cutoff && r.log_exp != null && r.exp !== r.log_exp) reasons.push(`EXP lệch nhật ký: ${r.exp} / ${r.log_exp}`);
    if (r.duplicate_sources) reasons.push(`${r.duplicate_sources} nguồn thưởng ngày được ghi nhiều lần`);
    if (r.earned_stones > stonesLimit) reasons.push(`Thưởng Linh Thạch hôm nay vượt trần: ${r.earned_stones} / ${stonesLimit}`);
    if (r.earned_exp > expLimit) reasons.push(`Thưởng EXP hôm nay vượt trần: ${r.earned_exp} / ${expLimit}`);
    return { ...r, reasons };
  }) };
}
