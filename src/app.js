// Điểm vào: định tuyến mọi yêu cầu không phải file tĩnh.
import { migrate, loadSettings, cached, all, first, liveCounts, withLive } from './db.js';
import { h, html, vnDay, fromBase64 } from './util.js';
import { homePage, trackPage, staticPage, notFoundPage } from './views/public.js';
import { noDbPage } from './views/admin.js';
import { handleApi } from './api.js';
import { handleAdmin, handleInstall } from './admin.js';
import { searchTracks } from './search.js';
import { ADMIN, clientInfo, isBlocked, isProbe, logEvent, withSecurityHeaders } from './security.js';

export async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const db = env.DB;
  if (!db) return html(noDbPage(), 500);
  await migrate(db);

  const info = clientInfo(request);
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

  if (path === '/') return html(homePage(pageCtx, await homeData(db, s, url)), 200, { 'Cache-Control': 'no-cache' });

  let m = path.match(/^\/track\/([a-z0-9-]+)$/);
  if (m) {
    const t = await first(db, 'SELECT * FROM tracks WHERE slug = ? AND published = 1', m[1]);
    if (!t) return html(notFoundPage(pageCtx), 404);
    t.parts = await all(db, 'SELECT title, url, duration FROM parts WHERE track_id = ? ORDER BY pos, id', t.id);
    const live = await liveCounts(db);
    t.live = live[t.id] || 0;
    const [before, after] = await Promise.all([
      all(db, 'SELECT * FROM tracks WHERE published = 1 AND id < ? ORDER BY id DESC LIMIT 5', t.id),
      all(db, 'SELECT * FROM tracks WHERE published = 1 AND id > ? ORDER BY id LIMIT 5', t.id),
    ]);
    const related = await withLive(db, [...after.reverse(), ...before], live);
    return html(trackPage(pageCtx, t, related), 200, { 'Cache-Control': 'no-cache' });
  }

  m = path.match(/^\/trang\/([a-z0-9-]+)$/);
  if (m) {
    const p = await first(db, 'SELECT * FROM pages WHERE slug = ?', m[1]);
    if (p) return html(staticPage(pageCtx, p));
  }

  return html(notFoundPage(pageCtx), 404);
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

async function sitemap(db, origin) {
  const tracks = await all(db, 'SELECT slug, updated_at FROM tracks WHERE published = 1 ORDER BY id DESC LIMIT 45000');
  const pages = await all(db, 'SELECT slug FROM pages');
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  x += `<url><loc>${h(origin)}/</loc><changefreq>daily</changefreq></url>\n`;
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

