// Điểm vào: định tuyến mọi yêu cầu không phải file tĩnh.
import { migrate, loadSettings, cached, all, first, liveCounts, withLive } from './db.js';
import { h, html, vnDay, fromBase64 } from './util.js';
import { homePage, genrePage, trackPage, staticPage, notFoundPage, historyPage, profilePage, leaderboardPage, questsPage, notificationsPage, guidePage, referralPage, resetPage, withdrawPage, shopPage } from './views/public.js';
import { GENRES } from './genres.js';
import { leaderboard, BOARDS, parseLevelTiers, LEVELUP_TIERS_DEFAULT, levelupStones } from './game.js';
import { listenConfig, commentConfig } from './quests.js';
import { withdrawConfig, METHODS } from './withdraw.js';
import { MAX_LEVEL, realmOf, expToNext } from './levels.js';
import { noDbPage } from './views/admin.js';
import { handleApi } from './api.js';
import { refCookieFor } from './referral.js';
import { handleAdmin, handleInstall, handleEditor, EDITOR_PATH } from './admin.js';
import { searchTracks } from './search.js';
import { ADMIN, clientInfo, isBlocked, isProbe, logEvent, withSecurityHeaders } from './security.js';

export async function handle(request, env, ctx) {
  const res = await handleInner(request, env, ctx);
  // Khách đến từ link giới thiệu (?ref=MÃ): lưu cookie người mời trên trang thường (không áp dụng API / quản trị).
  const url = new URL(request.url);
  if (request.method === 'GET' && url.searchParams.has('ref') && !url.pathname.startsWith('/api/') && (res.headers.get('Content-Type') || '').includes('text/html')) {
    const c = refCookieFor(request, url);
    if (c) { const out = new Response(res.body, res); out.headers.append('Set-Cookie', c); return out; }
  }
  return res;
}

async function handleInner(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const db = env.DB;
  if (!db) return html(noDbPage(), 500);
  await migrate(db);

  const info = clientInfo(request);
  info.proxyKey = env.PROXYCHECK_KEY || '';
  info.resendKey = env.RESEND_KEY || ''; // khóa gửi email (Resend), chỉ dùng phía máy chủ
  // Nhà mạng (ASN) của người truy cập do Cloudflare cung cấp sẵn — dùng để nhận ra máy chủ ảo / VPN / WARP mà không cần API ngoài.
  info.asn = (request.cf && +request.cf.asn) || 0;
  info.asOrg = (request.cf && String(request.cf.asOrganization || '')) || '';
  if (await isBlocked(db, info.ip)) {
    return new Response('Truy cập bị từ chối.', { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  if (path.startsWith('/api/')) return handleApi(request, db, path, ctx, info);
  if (path.startsWith('/media/')) return serveMedia(request, db, path, ctx);

  const s = await loadSettings(db);
  if (!s.admin_user) {
    // Chưa cài đặt: mọi trang đều dẫn tới trình cài đặt.
    return withSecurityHeaders(await handleInstall(request, db), true);
  }

  // Trang quản trị nằm ở đường dẫn riêng; bên trong vẫn xử lý như /admin/...
  if (path === ADMIN || path.startsWith(ADMIN + '/')) {
    const res = await handleAdmin(request, env, db, s, '/admin' + path.slice(ADMIN.length), url, info);
    return withSecurityHeaders(res, true);
  }

  // Khu biên tập viên: người không có quyền thấy trang 404 bình thường.
  if (path === EDITOR_PATH || path.startsWith(EDITOR_PATH + '/')) {
    const res = await handleEditor(request, env, db, s, path, url, info, async () => html(notFoundPage(await publicContext(db, s, url)), 404));
    return withSecurityHeaders(res, true);
  }

  // Bot dò lỗ hổng: ghi nhật ký, tự chặn IP nếu dò quá 20 lần / 10 phút.
  if (isProbe(path)) {
    const job = logEvent(db, info, 'probe', path, { hits: 20, hours: 24 });
    if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  if (path === '/robots.txt') {
    return new Response(`User-agent: *\nDisallow: /api/\nSitemap: ${url.origin}/sitemap.xml\n`, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  if (path === '/sitemap.xml') return sitemap(db, url.origin);

  const pageCtx = await publicContext(db, s, url);
  // Có cookie đăng nhập → vẽ sẵn chỗ avatar thay vì nút "Đăng nhập" (tránh nhấp nháy khi tải lại trang). Chỉ xem có cookie, không đọc DB.
  pageCtx.authed = /(?:^|;\s*)aw_user=/.test(request.headers.get('Cookie') || '');

  if (path === '/') return html(homePage(pageCtx, await homeData(db, s, url)), 200, { 'Cache-Control': 'no-cache' });
  const genre = GENRES.find(g => path === '/' + g.slug);
  if (genre) return html(genrePage(pageCtx, genre, await genreData(db, s, url, genre)), 200, { 'Cache-Control': 'no-cache' });

  if (path === '/bang-xep-hang') {
    const kind = BOARDS.includes(url.searchParams.get('top')) ? url.searchParams.get('top') : 'level';
    const rows = await cached(db, 'leaderboard_' + kind, 300, () => leaderboard(db, kind, 50));
    return html(leaderboardPage(pageCtx, rows, kind));
  }
  if (path === '/dat-lai-mat-khau') return html(resetPage(pageCtx), 200, { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (path === '/gioi-thieu') return html(referralPage(pageCtx), 200, { 'Cache-Control': 'no-store' });
  if (path === '/huong-dan') return html(guidePage(pageCtx, await guideData(db, s)));
  if (path === '/thong-bao') return html(notificationsPage(pageCtx), 200, { 'Cache-Control': 'no-store' });
  if (path === '/nhiem-vu') return html(questsPage(pageCtx), 200, { 'Cache-Control': 'no-store' });
  if (path === '/cua-hang') return html(shopPage(pageCtx), 200, { 'Cache-Control': 'no-store' });
  if (path === '/rut-linh-thach') return html(withdrawPage(pageCtx), 200, { 'Cache-Control': 'no-store' });
  if (path === '/tai-khoan') return html(profilePage(pageCtx), 200, { 'Cache-Control': 'no-store' });
  if (path === '/lich-su') return html(historyPage(pageCtx), 200, { 'Cache-Control': 'no-store' });

  let m = path.match(/^\/track\/([a-z0-9-]+)$/);
  if (m) {
    const t = await first(db, 'SELECT * FROM tracks WHERE slug = ? AND published = 1', m[1]);
    if (!t) return html(notFoundPage(pageCtx), 404);
    t.parts = await all(db, 'SELECT title, url, duration FROM parts WHERE track_id = ? ORDER BY pos, id', t.id);
    const live = await liveCounts(db);
    t.live = live[t.id] || 0;
    const related = await withLive(db, await suggestFor(db, t.id), live);
    return html(trackPage(pageCtx, t, related), 200, { 'Cache-Control': 'no-cache' });
  }

  m = path.match(/^\/trang\/([a-z0-9-]+)$/);
  if (m) {
    const p = await first(db, 'SELECT * FROM pages WHERE slug = ?', m[1]);
    if (p) return html(staticPage(pageCtx, p));
  }

  return html(notFoundPage(pageCtx), 404);
}

// Gợi ý "Có lẽ bạn sẽ thích": chọn ngẫu nhiên từ nhóm nghe nhiều hôm nay + nhiều lượt nghe nhất.
// Nhóm ứng viên lưu đệm 10 phút; mỗi lần mở trang xáo lại nên gợi ý luôn thay đổi.
async function suggestFor(db, currentId, n = 10) {
  const pool = await cached(db, 'suggest_pool', 600, async () => {
    const [today, top] = await Promise.all([
      all(db, `SELECT t.* FROM views_daily v JOIN tracks t ON t.id = v.track_id
        WHERE v.day = ? AND t.published = 1 ORDER BY v.n DESC LIMIT 30`, vnDay()),
      all(db, 'SELECT * FROM tracks WHERE published = 1 ORDER BY views DESC LIMIT 30'),
    ]);
    const seen = new Set();
    return [...today, ...top].filter(x => !seen.has(x.id) && seen.add(x.id));
  });
  let list = pool.filter(x => x.id !== currentId);
  if (list.length < n) {
    const more = await all(db, 'SELECT * FROM tracks WHERE published = 1 AND id != ? ORDER BY created_at DESC LIMIT 20', currentId);
    const ids = new Set(list.map(x => x.id));
    list = list.concat(more.filter(x => !ids.has(x.id)));
  }
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, n);
}

// Số liệu cho trang Hướng dẫn: đọc thẳng từ cài đặt hiện tại.
async function guideData(db, s) {
  const num = (k, d = 0) => Math.max(0, parseFloat(s[k]) || d);
  const L = listenConfig(s), C = commentConfig(s), W = withdrawConfig(s);
  const links = await cached(db, 'guide_links', 300, () => all(db, "SELECT title, stones, exp FROM quests WHERE active = 1 AND url != '' ORDER BY pos, id"));
  // Gom các cấp liên tiếp cùng mức thưởng thành từng khoảng.
  const tiers = [];
  let levelTotal = 0;
  for (let l = 2; l <= MAX_LEVEL; l++) {
    const st = levelupStones(s, l);
    levelTotal += st;
    const last = tiers[tiers.length - 1];
    if (last && last.stones === st && last.to === l - 1) { last.to = l; last.realmTo = realmOf(l).name; }
    else tiers.push({ from: l, to: l, stones: st, realmFrom: realmOf(l).name, realmTo: realmOf(l).name });
  }
  const levels = Array.from({ length: MAX_LEVEL }, (_, i) => ({ lvl: i + 1, realm: realmOf(i + 1).name, need: i + 1 < MAX_LEVEL ? expToNext(i + 1) : 0 }));
  const listen = L.enabled ? L : null, comment = C.enabled && C.stones ? C : null;
  const dailyMax = num('checkin_stones') + (listen ? listen.tiers.reduce((a, t) => a + t.stones, 0) : 0) + (comment ? comment.stones : 0) + links.reduce((a, q) => a + q.stones, 0);
  return {
    checkinStones: num('checkin_stones'), checkinExp: num('checkin_exp'), checkinWait: num('checkin_wait', 180),
    listen, comment, links, dailyMax,
    cmtExp: num('comment_exp'), cmtDaily: num('comment_exp_daily'), rateDaily: num('rate_daily'),
    rateStones: num('rate_stones', 10), rateExp: num('rate_exp', 2),
    heartStones: num('heart_stones', 1), heartExp: num('heart_exp', 1), heartDaily: num('heart_daily', 50),
    base: Math.max(1, Math.round(num('level_base_exp', 100))), levelTiers: tiers, levelTotal, levels, maxLevel: MAX_LEVEL,
    wdMin: W.min, wdDaily: W.daily, wdEnabled: W.enabled, wdMethods: Object.values(METHODS).join(', '),
    promax: s.promax_enabled !== '0' && /^https?:\/\//i.test(s.promax_url || '') ? { url: s.promax_url, title: s.promax_title, desc: s.promax_desc } : null,
  };
}

async function publicContext(db, s, url) {
  const [pages, ads] = await Promise.all([
    cached(db, 'nav_pages', 600, () => all(db, 'SELECT title, slug FROM pages ORDER BY pos, id')),
    s.ad_enabled === '1'
      ? cached(db, 'ads_active', 600, () => all(db, 'SELECT id, title, image, price, old_price, url FROM ads WHERE active = 1'))
      : [],
  ]);
  return { s, origin: url.origin, pages, ads, q: url.searchParams.get('q') || '' };
}

async function homeData(db, s, url) {
  const perPage = Math.max(5, parseInt(s.per_page, 10) || 15);
  const q = (url.searchParams.get('q') || '').trim();
  const live = await liveCounts(db);

  if (q) {
    const results = await searchTracks(db, q, 100);
    return { q, page: 1, results: await withLive(db, results, live) };
  }

  const total = await cached(db, 'total', 600, async () => (await first(db, 'SELECT COUNT(*) c FROM tracks WHERE published = 1')).c);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1), pages);
  const list = await all(db, 'SELECT * FROM tracks WHERE published = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?', perPage, (page - 1) * perPage);
  const d = { q: '', page, pages, total, all: await withLive(db, list, live) };
  if (page !== 1) return d;

  d.latest = await withLive(db, await all(db, 'SELECT * FROM tracks WHERE published = 1 ORDER BY created_at DESC LIMIT 10'), live);

  // Đang nghe nhiều: ưu tiên số người đang nghe, bù bằng audio nhiều lượt nghe nhất.
  const liveIds = Object.entries(live).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => +id);
  const liveTracks = liveIds.length
    ? await all(db, `SELECT * FROM tracks WHERE published = 1 AND id IN (${liveIds.map(() => '?').join(',')})`, ...liveIds)
    : [];
  const topViews = await cached(db, 'top_views', 600, () => all(db, 'SELECT * FROM tracks WHERE published = 1 ORDER BY views DESC LIMIT 10'));
  const seen = new Set();
  d.hot = (await withLive(db, [...liveTracks, ...topViews], live))
    .filter(t => !seen.has(t.id) && seen.add(t.id))
    .sort((a, b) => b.live - a.live || b.views - a.views)
    .slice(0, 10);

  d.top = await cached(db, 'top_periods', 600, async () => {
    const out = {};
    for (const [k, days] of [['day', 0], ['week', 6], ['month', 29]]) {
      out[k] = await all(db, `SELECT t.*, SUM(v.n) period FROM views_daily v JOIN tracks t ON t.id = v.track_id
        WHERE v.day >= ? AND t.published = 1 GROUP BY t.id ORDER BY period DESC LIMIT 10`, vnDay(days));
    }
    return out;
  });
  for (const k of ['day', 'week', 'month']) d.top[k] = await withLive(db, d.top[k], live);
  return d;
}

async function genreData(db, s, url, genre) {
  const perPage = Math.max(5, parseInt(s.per_page, 10) || 15);
  // Khớp nguyên nhãn trong danh sách, không gộp các nhãn chỉ chứa tên thể loại.
  const where = "WHERE published = 1 AND instr(',' || replace(tag, ' ', '') || ',', ?) > 0";
  const label = ',' + genre.name.replace(/ /g, '') + ',';
  const total = (await first(db, `SELECT COUNT(*) c FROM tracks ${where}`, label)).c;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1), pages);
  const tracks = await all(db, `SELECT * FROM tracks ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, label, perPage, (page - 1) * perPage);
  return { total, pages, page, tracks: await withLive(db, tracks) };
}

async function sitemap(db, origin) {
  const tracks = await all(db, 'SELECT slug, updated_at FROM tracks WHERE published = 1 ORDER BY id DESC LIMIT 45000');
  const pages = await all(db, 'SELECT slug FROM pages');
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  x += `<url><loc>${h(origin)}/</loc><changefreq>daily</changefreq></url>\n`;
  for (const g of GENRES) x += `<url><loc>${h(origin)}/${g.slug}</loc><changefreq>daily</changefreq></url>\n`;
  for (const t of tracks) x += `<url><loc>${h(origin)}/track/${h(t.slug)}</loc><lastmod>${new Date(t.updated_at * 1000).toISOString().slice(0, 10)}</lastmod></url>\n`;
  for (const p of pages) x += `<url><loc>${h(origin)}/trang/${h(p.slug)}</loc></url>\n`;
  return new Response(x + '</urlset>', { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

// Ảnh tải lên (logo, quảng cáo) được lưu trong D1, phục vụ kèm bộ nhớ đệm dài hạn.
async function serveMedia(request, db, path, ctx) {
  const m = path.match(/^\/media\/([A-Za-z0-9]+)\.\w+$/);
  if (!m) return new Response('Not found', { status: 404 });
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const hit = await cache.match(request);
    if (hit) return hit;
  }
  const row = await first(db, 'SELECT type, data FROM media WHERE id = ?', m[1]);
  if (!row) return new Response('Not found', { status: 404 });
  const res = new Response(fromBase64(row.data), {
    headers: { 'Content-Type': row.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
  if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}

