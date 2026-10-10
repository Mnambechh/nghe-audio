// Gửi email qua Resend (resend.com). Khóa API lấy từ biến môi trường RESEND_KEY hoặc cài đặt ẩn trong admin,
// không nằm trong mã nguồn và không bao giờ gửi xuống trình duyệt.
import { h } from './util.js';

export function mailConfig(s, info, origin) {
  const key = (info && info.resendKey) || s.resend_key || '';
  const host = new URL(origin).hostname.replace(/^www\./, '');
  const from = s.mail_from || `${s.site_name || 'Truyện Gì'} <no-reply@${host}>`;
  return { key, from, ok: !!key };
}

export async function sendMail(cfg, to, subject, html) {
  if (!cfg.key) return { ok: false, error: 'Chưa cấu hình gửi email.' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: cfg.from, to: [to], subject, html }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (j && (j.message || j.error)) || `Resend lỗi ${res.status}` };
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, error: 'Không kết nối được máy chủ email.' };
  }
}

// Mẫu email đặt lại mật khẩu (tông hồng của web).
export function resetMailHtml(siteName, name, link) {
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#FFF6F0;border-radius:16px;color:#4A2C2A">
  <h2 style="margin:0 0 12px;color:#A8344F">${h(siteName)}</h2>
  <p>Chào <b>${h(name)}</b>,</p>
  <p>Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu. Bấm nút bên dưới để tạo mật khẩu mới. Link có hiệu lực <b>30 phút</b> và chỉ dùng được 1 lần.</p>
  <p style="text-align:center;margin:24px 0"><a href="${h(link)}" style="display:inline-block;padding:12px 26px;border-radius:999px;background:#A8344F;color:#fff;text-decoration:none;font-weight:bold">Đặt lại mật khẩu</a></p>
  <p style="font-size:13px;color:#6E4A44">Nếu nút không bấm được, mở link này: <br><a href="${h(link)}" style="color:#A8344F;word-break:break-all">${h(link)}</a></p>
  <p style="font-size:13px;color:#6E4A44">Không phải bạn yêu cầu? Cứ bỏ qua email này, mật khẩu sẽ không thay đổi.</p>
</div>`;
}
