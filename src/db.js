// Cơ sở dữ liệu D1: tạo bảng, cài đặt, bộ nhớ đệm, truy vấn dùng chung.
import { now, LIVE_WINDOW, setTzOffset } from './util.js';
import { GAME_DEFAULTS } from './game.js';
import { WITHDRAW_DEFAULTS } from './withdraw.js';
import { setLevelBase } from './levels.js';
import { DEFAULT_WORDS } from './wordfilter.js';
import { QUEST_DEFAULTS } from './quests.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, search TEXT NOT NULL DEFAULT '',
    tag TEXT NOT NULL DEFAULT 'Audio Full', description TEXT NOT NULL DEFAULT '',
    duration INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_tracks_created ON tracks(published, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tracks_views ON tracks(published, views DESC)`,
  `CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL DEFAULT '', url TEXT NOT NULL,
    duration INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_parts_track ON parts(track_id, pos)`,
  `CREATE TABLE IF NOT EXISTS views_daily (
    track_id INTEGER NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (track_id, day))`,
  `CREATE INDEX IF NOT EXISTS idx_views_day ON views_daily(day)`,
  `CREATE TABLE IF NOT EXISTS plays (sid TEXT NOT NULL, track_id INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY (sid, track_id, day))`,
  `CREATE TABLE IF NOT EXISTS listeners (sid TEXT PRIMARY KEY, track_id INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '',
    price TEXT NOT NULL DEFAULT '', old_price TEXT NOT NULL DEFAULT '', url TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, shows INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL)`,
];

// Bản 2: nhật ký bảo mật, chặn IP, ghi IP cho lượt nghe (chống bơm lượt nghe).
const SCHEMA_V2 = [
  `CREATE TABLE IF NOT EXISTS security_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, ip TEXT NOT NULL, country TEXT NOT NULL DEFAULT '',
    event TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '', hits INTEGER NOT NULL DEFAULT 1)`,
  `CREATE INDEX IF NOT EXISTS idx_seclog_ip ON security_log(ip, event, at)`,
  `CREATE INDEX IF NOT EXISTS idx_seclog_at ON security_log(at)`,
  `CREATE TABLE IF NOT EXISTS blocked_ips (ip TEXT PRIMARY KEY, reason TEXT NOT NULL DEFAULT '', until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `ALTER TABLE plays ADD COLUMN ip TEXT NOT NULL DEFAULT ''`,
  `CREATE INDEX IF NOT EXISTS idx_plays_ip ON plays(ip, day)`,
];

// Bản 3: người dùng (đăng nhập Google) và bình luận.
const SCHEMA_V3 = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, sub TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '', banned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, track_id INTEGER NOT NULL, user_id INTEGER NOT NULL, parent_id INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', likes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX IF NOT EXISTS idx_comments_track ON comments(track_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS comment_likes (comment_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (comment_id, user_id))`,
];

// Bản 4: lịch sử nghe của người dùng đã đăng nhập.
const SCHEMA_V4 = [
  `CREATE TABLE IF NOT EXISTS history (
    user_id INTEGER NOT NULL, track_id INTEGER NOT NULL, part INTEGER NOT NULL DEFAULT 0,
    pos INTEGER NOT NULL DEFAULT 0, dur INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, track_id))`,
  `CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, updated_at DESC)`,
];

let migrated = false;

async function missing(db, table) {
  try {
    await db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first();
    return false;
  } catch (e) {
    return true;
  }
}

export async function migrate(db) {
  if (migrated) return;
  if (await missing(db, 'cache')) await db.batch(SCHEMA.map(s => db.prepare(s)));
  if (await missing(db, 'security_log')) await db.batch(SCHEMA_V2.map(s => db.prepare(s)));
  if (await missing(db, 'comments')) await db.batch(SCHEMA_V3.map(s => db.prepare(s)));
  if (await missing(db, 'history')) await db.batch(SCHEMA_V4.map(s => db.prepare(s)));
  // Bản 6: tu luyện (EXP, Linh Thạch, điểm danh), đánh giá truyện, thông báo.
  if (await missing(db, 'notifications')) {
    await db.batch([
      `ALTER TABLE users ADD COLUMN exp INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN stones INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN comments_n INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN checkin_day TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN seen_day TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN seen_at INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN rate_day TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN rate_n INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN cexp_day TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN cexp_n INTEGER NOT NULL DEFAULT 0`,
      `CREATE INDEX IF NOT EXISTS idx_users_exp ON users(exp DESC)`,
      `ALTER TABLE tracks ADD COLUMN rating_sum INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE tracks ADD COLUMN rating_count INTEGER NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS ratings (user_id INTEGER NOT NULL, track_id INTEGER NOT NULL, stars INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, track_id))`,
      `CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, actor_id INTEGER NOT NULL DEFAULT 0,
        track_id INTEGER NOT NULL DEFAULT 0, comment_id INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL DEFAULT '',
        is_read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at)`,
      `UPDATE users SET comments_n = (SELECT COUNT(*) FROM comments c WHERE c.user_id = users.id AND c.status = 'approved')`,
    ].map(q => db.prepare(q)));
  }
  // Bản 5: người dùng tự đổi tên/ảnh (không bị Google ghi đè khi đăng nhập lại).
  try {
    await db.prepare('SELECT name_locked FROM users LIMIT 1').first();
  } catch (e) {
    await db.batch([
      'ALTER TABLE users ADD COLUMN name_locked INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE users ADD COLUMN avatar_locked INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE users ADD COLUMN name_changed_at INTEGER NOT NULL DEFAULT 0',
    ].map(q => db.prepare(q)));
  }
  // Bản 7: quản lý thành viên (IP đăng ký, khóa tài khoản, đăng xuất mọi thiết bị, nhật ký admin).
  try {
    await db.prepare('SELECT session_ver FROM users LIMIT 1').first();
  } catch (e) {
    await db.batch([
      `ALTER TABLE users ADD COLUMN reg_ip TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN last_ip TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN country TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN locked INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN session_ver INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN note TEXT NOT NULL DEFAULT ''`,
      `CREATE TABLE IF NOT EXISTS member_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, action TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_member_log ON member_log(user_id, created_at DESC)`,
    ].map(q => db.prepare(q)));
  }
  // Bản 8: rút Linh Thạch.
  if (await missing(db, 'withdrawals')) {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS payout_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, method TEXT NOT NULL, bank TEXT NOT NULL DEFAULT '',
        number TEXT NOT NULL, holder TEXT NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_payout_user ON payout_accounts(user_id)`,
      `CREATE TABLE IF NOT EXISTS withdrawals (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, vnd INTEGER NOT NULL,
        method TEXT NOT NULL, bank TEXT NOT NULL DEFAULT '', number TEXT NOT NULL, holder TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', admin_note TEXT NOT NULL DEFAULT '', day TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, processed_at INTEGER NOT NULL DEFAULT 0)`,
      `CREATE INDEX IF NOT EXISTS idx_wd_status ON withdrawals(status, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_wd_user ON withdrawals(user_id, created_at)`,
    ].map(q => db.prepare(q)));
  }
  // Bản 27: cửa hàng hiệu ứng tên (gói do admin cài, hiệu ứng thành viên sở hữu, hiệu ứng đang dùng).
  if (await missing(db, 'shop_items')) {
    const t = Math.floor(Date.now() / 1000);
    await db.batch([
      `CREATE TABLE IF NOT EXISTS shop_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, fx TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0,
        days INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS user_fx (user_id INTEGER NOT NULL, fx TEXT NOT NULL, until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, fx))`,
      ...[['Băng Tâm', 'bang', 500], ['Hỏa Diệm', 'lua', 500], ['Hoa Đào', 'hoadao', 500], ['Thiên Không', 'thien', 500], ['Hải Lam', 'hai', 500],
        ['Hoàng Kim', 'kim', 800], ['Tử Vi', 'tim', 800], ['Bích Ngọc', 'ngoc', 800], ['Hoàng Hôn', 'hoanghon', 800], ['Cực Quang', 'cucquang', 1000],
        ['Huyết Nguyệt', 'huyet', 1000], ['Thất Sắc Cầu Vồng', 'cauvong', 1500]]
        .map(([n, fx, p], i) => `INSERT INTO shop_items (name, fx, price, days, active, pos, created_at) VALUES ('${n}', '${fx}', ${p}, 30, 1, ${i}, ${t})`),
    ].map(q => db.prepare(q)));
  }
  try { await db.prepare('SELECT name_fx FROM users LIMIT 1').first(); }
  catch {
    await db.batch([
      "ALTER TABLE users ADD COLUMN name_fx TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE users ADD COLUMN name_fx_until INTEGER NOT NULL DEFAULT 0',
    ].map(q => db.prepare(q)));
  }
  // Bản 28 (chạy sau Bản 27 vì cần bảng shop_items): khung avatar trong cửa hàng (admin tải ảnh khung lên), gói đã xóa vẫn giữ cho người đã mua.
  try { await db.prepare('SELECT kind FROM shop_items LIMIT 1').first(); }
  catch {
    await db.batch([
      "ALTER TABLE shop_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'fx'",
      "ALTER TABLE shop_items ADD COLUMN img TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE shop_items ADD COLUMN scale INTEGER NOT NULL DEFAULT 160',
      'ALTER TABLE shop_items ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE users ADD COLUMN frame_id INTEGER NOT NULL DEFAULT 0',
      "ALTER TABLE users ADD COLUMN frame_img TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE users ADD COLUMN frame_scale INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE users ADD COLUMN frame_until INTEGER NOT NULL DEFAULT 0',
    ].map(q => db.prepare(q)));
  }
  // Bản 26: mốc giờ điểm danh — chống điểm danh 2 lần trong ngày khi đổi múi giờ.
  try { await db.prepare('SELECT checkin_at FROM users LIMIT 1').first(); }
  catch { await db.prepare('ALTER TABLE users ADD COLUMN checkin_at INTEGER DEFAULT 0').run(); }
  // Bản 25: EXP bình luận tính theo từng truyện mỗi ngày; thưởng nhiệm vụ bình luận lên 20 Linh Thạch.
  if (await missing(db, 'comment_exp_log')) {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS comment_exp_log (user_id INTEGER NOT NULL, track_id INTEGER NOT NULL, day TEXT NOT NULL, PRIMARY KEY (user_id, track_id, day))`,
      `UPDATE settings SET v = '20' WHERE k = 'comment_quest_stones' AND v = '5'`,
    ].map(q => db.prepare(q)));
  }
  // Bản 24: link đặt lại mật khẩu (lưu dạng băm, hết hạn 30 phút, dùng 1 lần).
  if (await missing(db, 'password_resets')) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
      expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, ip TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`).run();
  }
  // Bản 23: đăng ký / đăng nhập bằng email + mật khẩu.
  try {
    await db.prepare('SELECT pass_hash FROM users LIMIT 1').first();
  } catch (e) {
    await db.batch([
      `ALTER TABLE users ADD COLUMN pass_hash TEXT NOT NULL DEFAULT ''`,
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
    ].map(q => db.prepare(q)));
  }
  // Bản 22: lịch sử hoa hồng giới thiệu.
  if (await missing(db, 'ref_log')) {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS ref_log (id INTEGER PRIMARY KEY AUTOINCREMENT, referrer_id INTEGER NOT NULL, referee_id INTEGER NOT NULL,
        amount INTEGER NOT NULL, source INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_ref_log ON ref_log(referrer_id, id DESC)`,
    ].map(q => db.prepare(q)));
  }
  // Bản 21: giới thiệu bạn bè.
  try {
    await db.prepare('SELECT ref_code FROM users LIMIT 1').first();
  } catch (e) {
    await db.batch([
      `ALTER TABLE users ADD COLUMN ref_code TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN referred_by INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN ref_carry REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN ref_earned INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN ref_given INTEGER NOT NULL DEFAULT 0`,
      `CREATE INDEX IF NOT EXISTS idx_users_ref_code ON users(ref_code)`,
      `CREATE INDEX IF NOT EXISTS idx_users_referred ON users(referred_by, created_at)`,
    ].map(q => db.prepare(q)));
  }
  // Bản 20: giới hạn lượt thả tim bình luận mỗi ngày.
  try {
    await db.prepare('SELECT like_n FROM users LIMIT 1').first();
  } catch (e) {
    await db.batch([
      `ALTER TABLE users ADD COLUMN like_day TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN like_n INTEGER NOT NULL DEFAULT 0`,
    ].map(q => db.prepare(q)));
  }
  // Bản 19: đếm lượt thả tim mỗi ngày (thưởng Linh Thạch + EXP, giới hạn / ngày).
  try {
    await db.prepare('SELECT heart_n FROM users LIMIT 1').first();
  } catch (e) {
    await db.batch([
      `ALTER TABLE users ADD COLUMN heart_day TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN heart_n INTEGER NOT NULL DEFAULT 0`,
    ].map(q => db.prepare(q)));
  }
  // Bản 18: ảnh bìa truyện (WebP lưu trong bảng media).
  try {
    await db.prepare('SELECT cover FROM tracks LIMIT 1').first();
  } catch (e) {
    await db.prepare(`ALTER TABLE tracks ADD COLUMN cover TEXT NOT NULL DEFAULT ''`).run();
  }
  // Bản 17: vai trò thành viên (biên tập viên) và người đăng / sửa truyện.
  try {
    await db.prepare('SELECT role FROM users LIMIT 1').first();
  } catch (e) {
    await db.batch([
      `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE tracks ADD COLUMN created_by INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE tracks ADD COLUMN updated_by INTEGER NOT NULL DEFAULT 0`,
    ].map(q => db.prepare(q)));
  }
  // Bản 16: bắn tim cho truyện (mỗi tài khoản 1 lần / truyện, không bỏ được).
  if (await missing(db, 'track_hearts')) {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS track_hearts (user_id INTEGER NOT NULL, track_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, track_id))`,
      `ALTER TABLE tracks ADD COLUMN hearts INTEGER NOT NULL DEFAULT 0`,
    ].map(q => db.prepare(q)));
  }
  // Bản 15: lưu đệm kết quả kiểm tra proxy / VPN.
  if (await missing(db, 'ip_checks')) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS ip_checks (ip TEXT PRIMARY KEY, proxy INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT '',
      risk INTEGER NOT NULL DEFAULT 0, provider TEXT NOT NULL DEFAULT '', checked_at INTEGER NOT NULL)`).run();
  }
  // Bản 14: thời gian online thật (chỉ tính khi đang mở tab web) cho điểm danh.
  try {
    await db.prepare('SELECT online_sec FROM users LIMIT 1').first();
  } catch (e) {
    await db.batch([
      `ALTER TABLE users ADD COLUMN online_sec INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN online_at INTEGER NOT NULL DEFAULT 0`,
    ].map(q => db.prepare(q)));
  }
  // Bản 13: SEO riêng cho từng truyện.
  try {
    await db.prepare('SELECT seo_title FROM tracks LIMIT 1').first();
  } catch (e) {
    await db.batch([
      `ALTER TABLE tracks ADD COLUMN seo_title TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE tracks ADD COLUMN seo_desc TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE tracks ADD COLUMN seo_keywords TEXT NOT NULL DEFAULT ''`,
    ].map(q => db.prepare(q)));
  }
  // Bản 12: thiết bị và thời điểm hoạt động gần nhất của thành viên.
  try {
    await db.prepare('SELECT last_seen FROM users LIMIT 1').first();
  } catch (e) {
    await db.batch([
      `ALTER TABLE users ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN device TEXT NOT NULL DEFAULT ''`,
    ].map(q => db.prepare(q)));
  }
  // Bản 11: nhiệm vụ hằng ngày (mở link, nghe đủ phút).
  if (await missing(db, 'quests')) {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', stones INTEGER NOT NULL DEFAULT 0,
        exp INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS quest_done (
        user_id INTEGER NOT NULL, quest_id INTEGER NOT NULL, day TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, quest_id, day))`,
      `CREATE INDEX IF NOT EXISTS idx_quest_done_day ON quest_done(day, quest_id)`,
      `ALTER TABLE users ADD COLUMN listen_day TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE users ADD COLUMN listen_sec INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN listen_at INTEGER NOT NULL DEFAULT 0`,
      `INSERT INTO quests (title, url, stones, exp, active, pos, created_at) VALUES ('Mở quảng cáo TikTok', '', 5, 0, 1, 0, ${Math.floor(Date.now() / 1000)})`,
    ].map(q => db.prepare(q)));
  }
  // Bản 10: bộ lọc từ. Lần đầu có bộ lọc thì tắt duyệt toàn bộ (chỉ bình luận chứa từ lọc / link mới phải duyệt).
  if (!(await db.prepare("SELECT 1 x FROM settings WHERE k = 'comment_words'").first())) {
    const st = db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
    await db.batch([st.bind('comment_words', DEFAULT_WORDS), st.bind('comment_moderation', '0')]);
  }
  // Bản 9: lịch sử EXP / Linh Thạch của từng thành viên.
  if (await missing(db, 'wallet_log')) {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS wallet_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL,
        balance INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_log(user_id, kind, id DESC)`,
    ].map(q => db.prepare(q)));
  }
  migrated = true;
}

// ---------- Cài đặt ----------

export const DEFAULT_SETTINGS = {
  site_name: 'Audio Truyện',
  site_tagline: 'Nghe audio miễn phí, không cần tài khoản',
  header_show_name: '0',
  seo_title: 'Audio Truyện - Nghe audio truyện miễn phí',
  seo_description: 'Nghe audio truyện full miễn phí, không cần tài khoản.',
  seo_keywords: 'audio truyện, truyện audio, nghe truyện',
  logo: '',
  favicon: '',
  theme_color: '#16a36a',
  footer_text: 'Nghe audio trực tuyến miễn phí.',
  head_code: '',
  per_page: '15',
  comments_enabled: '1',
  avatar_max_mb: '5',
  levelup_tiers: '5:200\n20:500\n50:1000\n70:1500', // thưởng Linh Thạch lên cấp theo khoảng cấp (xem game.js)
  tz_offset: '7',           // múi giờ (giờ lệch so với UTC), mặc định GMT+7 Hồ Chí Minh
  ref_enabled: '1',         // bật giới thiệu bạn bè
  reg_per_ip: '2',          // số tài khoản tối đa được đăng ký từ một IP (0 = không giới hạn)
  reg_block_proxy: '1',     // chặn đăng ký khi dùng proxy / VPN (cần khóa proxycheck.io)
  comment_moderation: '0',   // 1 = duyệt mọi bình luận; 0 = chỉ duyệt bình luận có link hoặc chứa từ trong bộ lọc
  comment_words: DEFAULT_WORDS,
  google_client_id: '',
  ad_enabled: '1',
  ad_interval_hours: '6',
  ad_message: 'Bạn xác nhận bấm "Đồng ý mở Shopee và tham khảo sản phẩm" là hoàn toàn tự nguyện. Bạn cũng có thể bấm X ở góc để đóng.',
  ad_button: 'Mở Shopee & nghe tiếp',
  ad_note: 'Lưu ý: Quảng cáo chỉ xuất hiện 1 lần mỗi {hours} giờ, mong quý thính giả ủng hộ.',
};

export async function loadSettings(db) {
  const s = { ...DEFAULT_SETTINGS, ...GAME_DEFAULTS, ...WITHDRAW_DEFAULTS, ...QUEST_DEFAULTS };
  const { results } = await db.prepare('SELECT k, v FROM settings').all();
  for (const r of results) s[r.k] = r.v;
  setLevelBase(s.level_base_exp);
  setTzOffset(s.tz_offset);
  return s;
}

export async function saveSettings(db, data) {
  const st = db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  await db.batch(Object.entries(data).map(([k, v]) => st.bind(k, String(v ?? ''))));
}

// ---------- Bộ nhớ đệm (giảm số dòng đọc của D1) ----------

const mem = new Map();

export async function cached(db, key, ttl, fn) {
  const t = now();
  const m = mem.get(key);
  if (m && m.exp > t) return m.v;
  const row = await db.prepare('SELECT v, exp FROM cache WHERE k = ?').bind(key).first();
  if (row && row.exp > t) {
    const v = JSON.parse(row.v);
    mem.set(key, { v, exp: Math.min(row.exp, t + 30) });
    return v;
  }
  const v = await fn();
  mem.set(key, { v, exp: t + ttl });
  await db.prepare('INSERT INTO cache (k, v, exp) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, exp = excluded.exp')
    .bind(key, JSON.stringify(v), t + ttl).run();
  return v;
}

export async function clearCache(db) {
  mem.clear();
  await db.prepare('DELETE FROM cache').run();
}

// ---------- Truy vấn dùng chung ----------

export async function all(db, sql, ...args) {
  return (await db.prepare(sql).bind(...args).all()).results;
}

export async function first(db, sql, ...args) {
  return db.prepare(sql).bind(...args).first();
}

// Số người đang nghe theo từng track (tính cả khách).
export async function liveCounts(db) {
  const rows = await all(db, 'SELECT track_id, COUNT(*) c FROM listeners WHERE last_seen > ? GROUP BY track_id', now() - LIVE_WINDOW);
  const out = {};
  for (const r of rows) out[r.track_id] = r.c;
  return out;
}

export async function withLive(db, tracks, live) {
  live = live || await liveCounts(db);
  return tracks.map(t => ({ ...t, live: live[t.id] || 0 }));
}

export async function uniqueSlug(db, table, slug, exceptId = 0) {
  let s = slug, i = 2;
  while (await first(db, `SELECT 1 x FROM ${table} WHERE slug = ? AND id != ?`, s, exceptId)) s = `${slug}-${i++}`;
  return s;
}
