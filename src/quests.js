// Nhiệm vụ hằng ngày (reset lúc 0h giờ Việt Nam):
// - Nhiệm vụ mở link (vd. quảng cáo TikTok): bấm "Mở" là mở link và nhận thưởng, mỗi ngày 1 lần.
// - Nghe audio đủ N phút (tính theo thời gian thực đang phát, tua không được tính).
import { all, first } from './db.js';
import { json, now, vnDay, secondsToReset } from './util.js';
import { awardExp, walletLog } from './game.js';

export const QUEST_DEFAULTS = {
  listen_quest_enabled: '1',
  listen_quest_minutes: '20',  // (bản cũ) mốc đầu tiên khi chưa cài danh sách mốc
  listen_quest_stones: '10',
  listen_quest_exp: '0',
  listen_quest_tiers: '',      // các mốc "phút:Linh Thạch:EXP", mỗi dòng một mốc; rỗng = mốc cũ + mốc 30 phút
  // Nhiệm vụ Promax: giới thiệu web đối tác, chỉ có nút mở link, không cộng Linh Thạch.
  promax_enabled: '1',
  promax_title: 'Mời bạn sử dụng web hoàn tiền mua sắm tại ahoan.com',
  promax_desc: 'Đăng ký tài khoản tại ahoan.com, mời bạn qua phần giới thiệu bạn bè. Mời bạn đầu và phát sinh đơn hàng nhận ngay 10.000đ, nhận tối đa 100.000đ.',
  promax_url: 'https://ahoan.com',
  promax_button: 'Mở ahoan.com',
  comment_quest_enabled: '1',
  comment_quest_stones: '20',
};

const LISTEN_BASE = 100000; // mã nhiệm vụ nghe trong bảng quest_done = LISTEN_BASE + số phút của mốc
const COMMENT_ID = -1; // mã nhiệm vụ bình luận hợp lệ
const num = (s, k) => Math.max(0, parseFloat(s[k] ?? QUEST_DEFAULTS[k]) || 0);

// Các mốc nghe trong ngày, vd. 20 phút +10 Linh Thạch, 30 phút +15 Linh Thạch.
export function parseTiers(text) {
  const seen = new Set();
  return String(text || '').split(/[\n;]+/).map(l => l.split(':').map(x => Math.max(0, Math.round(parseFloat(x) || 0))))
    .map(([min, stones = 0, exp = 0]) => ({ min: Math.min(600, min), stones, exp }))
    .filter(t => t.min > 0 && !seen.has(t.min) && seen.add(t.min))
    .sort((a, b) => a.min - b.min).slice(0, 10);
}

export function listenConfig(s) {
  let tiers = parseTiers(s.listen_quest_tiers);
  if (!s.listen_quest_tiers) {
    const m = Math.max(1, num(s, 'listen_quest_minutes'));
    tiers = parseTiers(`${m}:${num(s, 'listen_quest_stones')}:${num(s, 'listen_quest_exp')}` + (m < 30 ? '\n30:15:0' : ''));
  }
  return { on: s.listen_quest_enabled !== '0', enabled: s.listen_quest_enabled !== '0' && tiers.length > 0, tiers, need: tiers.length ? tiers[tiers.length - 1].min * 60 : 0 };
}

export function commentConfig(s) {
  return { enabled: s.comment_quest_enabled !== '0', stones: num(s, 'comment_quest_stones') };
}

// Bình luận hợp lệ (được hiện): thưởng Linh Thạch cho bình luận đầu tiên mỗi ngày.
export async function onCommentQuest(db, s, userId) {
  const C = commentConfig(s);
  if (!C.enabled || !C.stones) return [];
  return (await grant(db, s, { id: userId }, COMMENT_ID, C.stones, 0, 'Nhiệm vụ: Bình luận hợp lệ')) || [];
}

// Tiến độ nhiệm vụ hôm nay cho thẻ tài khoản / trang Nhiệm vụ.
export async function questStats(db, s, me) {
  const today = vnDay();
  const [links, done] = await Promise.all([
    all(db, "SELECT id, title, url, stones, exp FROM quests WHERE active = 1 AND url != '' ORDER BY pos, id"),
    all(db, 'SELECT quest_id FROM quest_done WHERE user_id = ? AND day = ?', me.id, today),
  ]);
  const doneSet = new Set(done.map(d => d.quest_id));
  const L = listenConfig(s), C = commentConfig(s);
  return {
    resetIn: secondsToReset(), // giây còn lại tới 0h (múi giờ của web) — nhiệm vụ làm mới
    comment: C.enabled && C.stones ? { stones: C.stones, done: doneSet.has(COMMENT_ID) } : null,
    links: links.map(q => ({ ...q, done: doneSet.has(q.id) })),
    listen: L.enabled ? {
      sec: me.listen_day === today ? me.listen_sec || 0 : 0,
      need: L.need,
      tiers: L.tiers.map(t => ({ ...t, done: doneSet.has(LISTEN_BASE + t.min) })),
    } : null,
  };
}

// Phát thưởng một nhiệm vụ (chỉ một lần mỗi ngày nhờ khóa chính user/quest/day).
async function grant(db, s, me, questId, stones, exp, note) {
  const r = await db.prepare('INSERT OR IGNORE INTO quest_done (user_id, quest_id, day, created_at) VALUES (?, ?, ?, ?)')
    .bind(me.id, questId, vnDay(), now()).run();
  if (!r.meta.changes) return null;
  const rewards = [];
  if (stones) {
    await db.prepare('UPDATE users SET stones = stones + ? WHERE id = ?').bind(stones, me.id).run();
    await walletLog(db, me.id, 'stones', stones, note);
    rewards.push({ type: 'stones', n: stones });
  }
  if (exp) rewards.push(...await awardExp(db, s, me.id, exp, note));
  return rewards;
}

export async function handleQuestApi(request, db, s, path, me, input) {
  // Bấm "Mở" nhiệm vụ link.
  if (path === '/api/quest/open') {
    const q = await first(db, "SELECT * FROM quests WHERE id = ? AND active = 1 AND url != ''", parseInt(input.id, 10) || 0);
    if (!q) return json({ ok: false, error: 'Nhiệm vụ không còn.' }, 404);
    const rewards = await grant(db, s, me, q.id, q.stones, q.exp, `Nhiệm vụ: ${q.title}`);
    if (!rewards) return json({ ok: true, already: true });
    return json({ ok: true, rewards, title: q.title });
  }

  // Cộng thời gian nghe. Máy chủ giới hạn theo thời gian thực đã trôi qua để không thể gửi khống.
  if (path === '/api/quest/listen') {
    const L = listenConfig(s);
    if (!L.enabled) return json({ ok: false }, 400);
    const t = now(), today = vnDay();
    const u = await first(db, 'SELECT listen_day, listen_sec, listen_at FROM users WHERE id = ?', me.id);
    const sameDay = u.listen_day === today;
    const before = sameDay ? u.listen_sec : 0;
    const elapsed = sameDay && u.listen_at ? t - u.listen_at : 120;
    const credit = Math.max(0, Math.min(Math.floor(+input.sec || 0), elapsed + 5, 120));
    const after = Math.min(L.need, before + credit);
    // Chỉ ghi nếu chưa có yêu cầu nào khác chen vào (so khớp listen_at cũ) — gửi song song không cộng trùng thời gian.
    const w = await db.prepare('UPDATE users SET listen_day = ?, listen_sec = ?, listen_at = ? WHERE id = ? AND listen_at = ? AND listen_day = ?')
      .bind(today, after, t, me.id, u.listen_at, u.listen_day).run();
    if (!w.meta.changes) return json({ ok: true, sec: before, need: L.need, rewards: [], reached: [] });
    // Phát thưởng mọi mốc vừa đạt (mỗi mốc 1 lần / ngày).
    const rewards = [], reached = [];
    for (const tier of L.tiers) {
      if (after < tier.min * 60) break;
      const r = await grant(db, s, me, LISTEN_BASE + tier.min, tier.stones, tier.exp, `Nhiệm vụ: Nghe audio ${tier.min} phút`);
      if (r) { rewards.push(...r); reached.push(tier.min); }
    }
    return json({ ok: true, sec: after, need: L.need, rewards, reached });
  }

  return json({ ok: false, error: 'not_found' }, 404);
}
