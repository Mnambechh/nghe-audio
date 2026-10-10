// Nhiệm vụ hằng ngày (reset lúc 0h giờ Việt Nam):
// - Nhiệm vụ mở link (vd. quảng cáo TikTok): bấm "Mở" là mở link và nhận thưởng, mỗi ngày 1 lần.
// - Nghe audio đủ N phút (tính theo thời gian thực đang phát, tua không được tính).
import { all, first } from './db.js';
import { json, now, vnDay } from './util.js';
import { awardExp, walletLog } from './game.js';

export const QUEST_DEFAULTS = {
  listen_quest_enabled: '1',
  listen_quest_minutes: '20',
  listen_quest_stones: '10',
  listen_quest_exp: '0',
};

const LISTEN_ID = 0; // mã nhiệm vụ nghe trong bảng quest_done
const num = (s, k) => Math.max(0, parseFloat(s[k] ?? QUEST_DEFAULTS[k]) || 0);

export function listenConfig(s) {
  return {
    enabled: s.listen_quest_enabled !== '0',
    minutes: Math.max(1, num(s, 'listen_quest_minutes')),
    stones: num(s, 'listen_quest_stones'),
    exp: num(s, 'listen_quest_exp'),
  };
}

// Tiến độ nhiệm vụ hôm nay cho thẻ tài khoản / trang Nhiệm vụ.
export async function questStats(db, s, me) {
  const today = vnDay();
  const [links, done] = await Promise.all([
    all(db, "SELECT id, title, url, stones, exp FROM quests WHERE active = 1 AND url != '' ORDER BY pos, id"),
    all(db, 'SELECT quest_id FROM quest_done WHERE user_id = ? AND day = ?', me.id, today),
  ]);
  const doneSet = new Set(done.map(d => d.quest_id));
  const L = listenConfig(s);
  return {
    links: links.map(q => ({ ...q, done: doneSet.has(q.id) })),
    listen: L.enabled ? {
      sec: me.listen_day === today ? me.listen_sec || 0 : 0,
      need: Math.round(L.minutes * 60), stones: L.stones, exp: L.exp, done: doneSet.has(LISTEN_ID),
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
    const need = Math.round(L.minutes * 60);
    const after = Math.min(need, before + credit);
    await db.prepare('UPDATE users SET listen_day = ?, listen_sec = ?, listen_at = ? WHERE id = ?').bind(today, after, t, me.id).run();
    let rewards = null;
    if (after >= need) rewards = await grant(db, s, me, LISTEN_ID, L.stones, L.exp, `Nhiệm vụ: Nghe audio ${L.minutes} phút`);
    return json({ ok: true, sec: after, need, rewards: rewards || [], completed: !!rewards, minutes: L.minutes });
  }

  return json({ ok: false, error: 'not_found' }, 404);
}
