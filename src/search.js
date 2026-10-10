// Tìm kiếm: không dấu, xếp hạng theo độ khớp, ưu tiên khớp đúng số (gõ "303" thì "Số 303" lên đầu).
import { cached, all } from './db.js';
import { vnPlain } from './util.js';

// Danh sách rút gọn mọi audio đang hiện, lưu đệm 5 phút (mỗi lần gõ chỉ tốn 1 lượt đọc D1).
export function searchIndex(db) {
  return cached(db, 'search_index', 300, () =>
    all(db, 'SELECT id, title, slug, tag, views, duration, created_at, search FROM tracks WHERE published = 1 ORDER BY created_at DESC'));
}

export function normalizeQuery(q) {
  return vnPlain(q).replace(/[^a-z0-9]+/g, ' ').trim();
}

const words = s => s.split(/[^a-z0-9]+/).filter(Boolean);

export function rankTracks(index, q, limit = 10) {
  const nq = normalizeQuery(q);
  if (!nq) return [];
  const tokens = nq.split(' ');
  const numTok = tokens.find(t => /^\d+$/.test(t));
  const out = [];
  for (const t of index) {
    const ws = words(t.search || vnPlain(t.title));
    let score = 0;
    let ok = true;
    for (const tok of tokens) {
      const isNum = /^\d+$/.test(tok);
      let best = 0;
      for (const w of ws) {
        if (w === tok) best = Math.max(best, isNum ? 100 : 20);
        else if (w.startsWith(tok)) best = Math.max(best, isNum ? 40 - Math.min(20, w.length - tok.length) : 12);
        else if (w.includes(tok)) best = Math.max(best, isNum ? 2 : 4);
      }
      if (!best) { ok = false; break; }
      score += best;
    }
    if (!ok) continue;
    const plain = ws.join(' ');
    if (plain.includes(nq)) score += 15;
    if (plain.startsWith(nq)) score += 10;
    // Số khớp (để xếp 300, 301, 302… theo thứ tự khi gõ "30").
    const nw = numTok ? ws.find(w => /^\d+$/.test(w) && w.startsWith(numTok)) : null;
    out.push({ t, score, num: nw ? parseInt(nw, 10) : Infinity });
  }
  out.sort((a, b) => b.score - a.score || a.num - b.num || b.t.views - a.t.views || b.t.created_at - a.t.created_at);
  return out.slice(0, limit).map(x => x.t);
}

export async function searchTracks(db, q, limit = 10) {
  return rankTracks(await searchIndex(db), q, limit);
}
