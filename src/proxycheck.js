// Kiểm tra IP có phải proxy / VPN / máy chủ ảo không bằng proxycheck.io.
// Khóa API lấy từ biến môi trường PROXYCHECK_KEY (Cloudflare) hoặc cài đặt ẩn trong admin — không nằm trong mã nguồn,
// không bao giờ gửi xuống trình duyệt. Kết quả lưu đệm 7 ngày để tiết kiệm lượt gọi.
import { first } from './db.js';
import { now } from './util.js';

export async function checkIp(db, key, ip) {
  if (!key || !ip || ip === '0.0.0.0' || ip === '127.0.0.1' || ip === '::1') return null;
  const cached = await first(db, 'SELECT proxy, type, risk, provider, checked_at FROM ip_checks WHERE ip = ?', ip);
  if (cached && cached.checked_at > now() - 3 * 86400) return { ...cached, proxy: !!cached.proxy };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    const res = await fetch(`https://proxycheck.io/v2/${encodeURIComponent(ip)}?key=${encodeURIComponent(key)}&vpn=3&asn=1&risk=1`, { signal: ctl.signal });
    clearTimeout(timer);
    const j = await res.json();
    const r = j && j[ip];
    if (!r) return { error: String((j && (j.message || j.status)) || 'không rõ') }; // lỗi / hết lượt: không chặn nhầm người dùng thật
    // vpn=3: trả cả "proxy" và "vpn" riêng; coi là ẩn danh nếu một trong hai là "yes", hoặc loại là VPN / máy chủ / điểm rủi ro cao.
    const type = String(r.type || '');
    const out = { proxy: r.proxy === 'yes' || r.vpn === 'yes' || /vpn|tor|hosting|compromised/i.test(type) || (+r.risk || 0) >= 75,
      type, risk: +r.risk || 0, provider: String(r.provider || r.organisation || '').slice(0, 80) };
    await db.prepare(`INSERT INTO ip_checks (ip, proxy, type, risk, provider, checked_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(ip) DO UPDATE SET proxy = excluded.proxy, type = excluded.type, risk = excluded.risk, provider = excluded.provider, checked_at = excluded.checked_at`)
      .bind(ip, out.proxy ? 1 : 0, out.type, out.risk, out.provider, now()).run();
    return out;
  } catch (e) {
    return { error: 'không kết nối được proxycheck.io' };
  }
}

// Lớp chặn không cần API: nhà mạng (ASN) thuộc trung tâm dữ liệu, dịch vụ VPN hoặc Cloudflare WARP.
// Nhà mạng Việt Nam thông thường (Viettel, VNPT, FPT, Mobifone, CMC…) không bị ảnh hưởng.
const HOSTING_ASN = new Set([13335, 209242, 16509, 14618, 8075, 15169, 396982, 14061, 24940, 16276, 63949, 20473, 9009, 60068,
  212238, 51167, 46562, 62240, 36352, 40021, 32097, 136787, 135377, 202425, 49981, 51852, 133752, 141995, 45102, 37963, 31898, 54825, 397373]);
const HOSTING_ORG = /(vpn|proxy|hosting|host|server|cloud|datacenter|data center|colo|vps|digitalocean|amazon|aws|google llc|microsoft|azure|ovh|hetzner|linode|akamai|vultr|choopa|contabo|leaseweb|m247|datacamp|cdn77|nordvpn|expressvpn|surfshark|proton|mullvad|private internet|tefincom|packethub|zenlayer|psychz|quadranet|tencent|alibaba|oracle|cloudflare)/i;
export function hostingByAsn(info) {
  if (!info) return '';
  if (info.asn && HOSTING_ASN.has(info.asn)) return `ASN ${info.asn}${info.asOrg ? ' · ' + info.asOrg : ''}`;
  if (info.asOrg && HOSTING_ORG.test(info.asOrg)) return `${info.asOrg} (ASN ${info.asn || '?'})`;
  return '';
}
