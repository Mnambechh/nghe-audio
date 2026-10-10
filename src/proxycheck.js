// Kiểm tra IP có phải proxy / VPN / máy chủ ảo không bằng proxycheck.io.
// Khóa API lấy từ biến môi trường PROXYCHECK_KEY (Cloudflare) hoặc cài đặt ẩn trong admin — không nằm trong mã nguồn,
// không bao giờ gửi xuống trình duyệt. Kết quả lưu đệm 7 ngày để tiết kiệm lượt gọi.
import { first } from './db.js';
import { now } from './util.js';

export async function checkIp(db, key, ip) {
  if (!key || !ip || ip === '0.0.0.0' || ip === '127.0.0.1' || ip === '::1') return null;
  const cached = await first(db, 'SELECT proxy, type, risk, provider, checked_at FROM ip_checks WHERE ip = ?', ip);
  if (cached && cached.checked_at > now() - 7 * 86400) return { ...cached, proxy: !!cached.proxy };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    const res = await fetch(`https://proxycheck.io/v2/${encodeURIComponent(ip)}?key=${encodeURIComponent(key)}&vpn=1&asn=1&risk=1`, { signal: ctl.signal });
    clearTimeout(timer);
    const j = await res.json();
    const r = j && j[ip];
    if (!r) return null; // lỗi / hết lượt: không chặn nhầm người dùng thật
    const out = { proxy: r.proxy === 'yes', type: String(r.type || ''), risk: +r.risk || 0, provider: String(r.provider || r.organisation || '').slice(0, 80) };
    await db.prepare(`INSERT INTO ip_checks (ip, proxy, type, risk, provider, checked_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET proxy = excluded.proxy, type = excluded.type, risk = excluded.risk, provider = excluded.provider, checked_at = excluded.checked_at`)
      .bind(ip, out.proxy ? 1 : 0, out.type, out.risk, out.provider, now()).run();
    return out;
  } catch (e) {
    return null;
  }
}
