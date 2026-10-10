// Giao diện trang quản trị.
import { h, fmtTime, fmtNum, fmtInt, vnDate } from '../util.js';
import { ASSET_V } from './public.js';
import { ADMIN, EVENT_LABELS } from '../security.js';
import { levelInfo } from '../levels.js';

const asset = f => `/assets/${f}?v=${ASSET_V}`;

function shell(title, body, extraHead = '') {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${h(title)}</title>
<link rel="stylesheet" href="${asset('admin.css')}">${extraHead}
</head>
${body}
</html>`;
}

const NAV = [['/admin', 'Audio'], ['/admin/qc', 'Quảng cáo'], ['/admin/settings', 'Cài đặt & SEO'], ['/admin/members', 'Thành viên'], ['/admin/withdrawals', 'Rút Linh Thạch'], ['/admin/comments', 'Bình luận'], ['/admin/pages', 'Trang'], ['/admin/security', 'Bảo mật'], ['/admin/password', 'Tài khoản']];
// Đường dẫn nội bộ /admin/... → đường dẫn thật trên web.
const A = p => ADMIN + p.slice('/admin'.length);

export function adminLayout(s, path, flash, content) {
  const cur = path === '/admin' || path.startsWith('/admin/track') ? '/admin' : path.startsWith('/admin/page') ? '/admin/pages' : path.startsWith('/admin/members') ? '/admin/members' : path;
  return shell(`Quản trị - ${s.site_name}`, `<body>
<header class="qt-top">
  <a class="qt-brand" href="${ADMIN}">${h(s.site_name)} <small>admin</small></a>
  <nav class="qt-nav">${NAV.map(([p, l]) => `<a href="${A(p)}" class="${cur === p ? 'on' : ''}">${l}</a>`).join('')}</nav>
  <div class="qt-right">
    <a href="/" target="_blank">Xem web ↗</a>
    <form method="post" action="${ADMIN}/logout"><button type="submit">Thoát</button></form>
  </div>
</header>
<main class="qt-main">
  ${flash ? `<div class="flash ${h(flash[0])}">${h(flash[1])}</div>` : ''}
  ${content}
</main>
<script src="${asset('admin.js')}" defer></script>
</body>`);
}

export function loginPage(s, err) {
  return shell('Đăng nhập quản trị', `<body class="auth">
<form class="auth-box form" method="post">
  <h1>${h(s.site_name)}</h1>
  ${err ? `<div class="flash err">${h(err)}</div>` : ''}
  <label>Tên đăng nhập<input name="user" required autocomplete="username" autofocus></label>
  <label>Mật khẩu<input name="pass" type="password" required autocomplete="current-password"></label>
  <button class="btn" type="submit">Đăng nhập</button>
</form>
</body>`);
}

export function installPage(err, done, form = {}) {
  const inner = done
    ? `<div class="flash ok">Cài đặt thành công!</div>
       <p class="row-actions"><a class="btn" href="${ADMIN}">Vào trang quản trị</a><a class="btn ghost" href="/">Xem trang chủ</a></p>`
    : `${err ? `<div class="flash err">${h(err)}</div>` : ''}
       <form method="post" class="form">
         <label>Tên website<input name="site_name" required value="${h(form.site_name || '')}" placeholder="Ví dụ: Yêu Đời Audio"></label>
         <label>Tên đăng nhập admin<input name="user" required autocomplete="username" value="${h(form.user || 'admin')}"></label>
         <label>Mật khẩu (ít nhất 8 ký tự)<input name="pass" type="password" required minlength="8" autocomplete="new-password"></label>
         <label>Nhập lại mật khẩu<input name="pass2" type="password" required minlength="8" autocomplete="new-password"></label>
         <button class="btn" type="submit">Cài đặt</button>
       </form>`;
  return shell('Cài đặt', `<body class="auth"><div class="auth-box wide"><h1>Cài đặt web audio</h1>${inner}</div></body>`);
}

export function noDbPage() {
  return shell('Chưa kết nối D1', `<body class="auth"><div class="auth-box wide">
  <h1>Chưa kết nối cơ sở dữ liệu</h1>
  <p>Vào <b>Cloudflare → Workers &amp; Pages → dự án này → Settings → Bindings → Add → D1 database</b>, đặt tên biến là <code>DB</code> và chọn database đã tạo. Sau đó vào <b>Deployments</b> bấm <b>Retry deployment</b>.</p>
</div></body>`);
}

// ---------- Danh sách audio ----------

export function tracksView({ tracks, stats, q, page, total, per }) {
  const pages = Math.max(1, Math.ceil(total / per));
  return `
<div class="stats">
  <div><b>${fmtInt(stats.tracks)}</b><span>audio</span></div>
  <div><b>${fmtInt(stats.views)}</b><span>tổng lượt nghe</span></div>
  <div><b>${fmtInt(stats.today)}</b><span>lượt nghe hôm nay</span></div>
  <div><b class="live-n">${stats.live}</b><span>đang nghe</span></div>
</div>
<div class="bar">
  <form method="get" class="search"><input type="search" name="q" value="${h(q)}" placeholder="Tìm theo tên..."></form>
  <a class="btn" href="${ADMIN}/track/new">+ Đăng audio</a>
</div>
<div class="table">
  ${tracks.map(t => `<a class="trow" href="${ADMIN}/track/${t.id}">
    <span class="tmain"><b>${h(t.title)}</b>
      <small>${t.published ? '' : '<em class="pill">Ẩn</em> '}${t.nparts} phần · ${fmtTime(t.duration)} · ${vnDate(t.created_at, true)}</small></span>
    <span class="tnum">${fmtNum(t.views)}<small>lượt nghe</small></span>
    <span class="tnum live-n">${t.live}<small>đang nghe</small></span>
  </a>`).join('')}
  ${tracks.length ? '' : '<p class="muted pad">Chưa có audio nào. Bấm “Đăng audio” để bắt đầu.</p>'}
</div>
${pages > 1 ? `<nav class="pager">${Array.from({ length: pages }, (_, i) => i + 1)
    .map(i => `<a class="${i === page ? 'on' : ''}" href="?page=${i}&q=${encodeURIComponent(q)}">${i}</a>`).join('')}</nav>` : ''}`;
}

// ---------- Thêm / sửa audio ----------

export function trackForm({ track, parts, err }) {
  if (!parts.length) parts = [{ title: '', url: '', duration: 0 }];
  return `
<div class="bar">
  <h1>${track.id ? 'Sửa audio' : 'Đăng audio mới'}</h1>
  ${track.id && track.slug ? `<a class="btn ghost" target="_blank" href="/track/${h(track.slug)}">Xem ↗</a>` : ''}
</div>
${err ? `<div class="flash err">${h(err)}</div>` : ''}
<form method="post" class="form card" id="trackForm">
  <label>Tên truyện / audio *<input name="title" required value="${h(track.title)}" placeholder="Ví dụ: Yêu Đời Audio Số 306"></label>
  <div class="grid2">
    <label>Nhãn<input name="tag" value="${h(track.tag)}" placeholder="Audio Full"></label>
    <label>Đường dẫn (để trống sẽ tự tạo)<input name="slug" value="${h(track.slug)}" placeholder="yeu-doi-audio-so-306"></label>
  </div>
  <label>Mô tả (hiện trên trang nghe và dùng cho SEO)<textarea name="description" rows="3">${h(track.description)}</textarea></label>

  <h2>Link audio <small class="muted">.mp3 .m4a .aac .ogg .opus .wav .flac</small></h2>
  <div id="parts">
    ${parts.map((p, i) => `<div class="part-row">
      <span class="pno">${i + 1}</span>
      <div class="pfields">
        <input name="part_url" class="purl" type="url" value="${h(p.url)}" placeholder="https://cdn.tenmien.com/audio/tap-1.mp3">
        <div class="pline">
          <input name="part_title" value="${h(p.title)}" placeholder="Tên phần (tùy chọn)">
          <input name="part_dur" class="pdur" value="${p.duration ? fmtTime(p.duration) : ''}" placeholder="Thời lượng" title="Tự lấy khi dán link, hoặc nhập dạng 1:04:46">
        </div>
      </div>
      <div class="pbtns">
        <button type="button" data-p="up" title="Lên">↑</button>
        <button type="button" data-p="down" title="Xuống">↓</button>
        <button type="button" data-p="del" title="Xóa">✕</button>
      </div>
    </div>`).join('')}
  </div>
  <div class="row-actions">
    <button type="button" class="btn ghost" id="addPart">+ Thêm phần</button>
    <button type="button" class="btn ghost" id="bulkToggle">Dán nhiều link</button>
  </div>
  <div id="bulk" hidden>
    <textarea id="bulkText" rows="5" placeholder="Mỗi dòng một link audio"></textarea>
    <button type="button" class="btn ghost" id="bulkAdd">Thêm các link này</button>
  </div>

  <label class="check"><input type="checkbox" name="published" value="1"${track.published ? ' checked' : ''}> Hiển thị công khai</label>
  ${track.id ? '<label class="check"><input type="checkbox" name="bump" value="1"> Đưa lên đầu “Mới cập nhật”</label>' : ''}
  <div class="row-actions sticky">
    <button class="btn" type="submit">Lưu</button>
    ${track.id ? '' : '<button class="btn ghost" type="submit" name="and_new" value="1">Lưu & đăng tiếp</button>'}
  </div>
</form>
${track.id ? `<form method="post" action="${ADMIN}/track/${track.id}/delete" class="danger" data-confirm="Xóa audio này? Không thể hoàn tác.">
  <button type="submit">Xóa audio này</button></form>` : ''}`;
}

// ---------- Quảng cáo ----------

export function adsView(s, ads, edit) {
  const e = edit || { id: 0, title: '', image: '', price: '', old_price: '', url: '', active: 1 };
  return `
<h1>Quảng cáo Shopee</h1>
<form method="post" class="form card">
  <input type="hidden" name="action" value="config">
  <h2>Cách hiển thị</h2>
  <label class="check"><input type="checkbox" name="ad_enabled" value="1"${s.ad_enabled === '1' ? ' checked' : ''}> Bật khóa audio bằng quảng cáo</label>
  <label>Sau khi bấm quảng cáo, được nghe tự do trong (giờ)
    <input name="ad_interval_hours" inputmode="decimal" value="${h(s.ad_interval_hours)}">
    <small class="muted">Ví dụ: 6 = mỗi 6 tiếng hiện lại 1 lần, 24 = mỗi ngày 1 lần. Tính riêng trên từng thiết bị.</small>
  </label>
  <label>Lời nhắn trên popup<textarea name="ad_message" rows="3">${h(s.ad_message)}</textarea></label>
  <label>Chữ trên nút xanh<input name="ad_button" value="${h(s.ad_button)}"></label>
  <label>Ghi chú dưới nút <small class="muted">({hours} = số giờ ở trên)</small><input name="ad_note" value="${h(s.ad_note)}"></label>
  <div class="row-actions"><button class="btn" type="submit">Lưu cài đặt</button></div>
</form>

<form method="post" class="form card" enctype="multipart/form-data" id="qcform">
  <input type="hidden" name="action" value="save"><input type="hidden" name="id" value="${e.id}">
  <h2>${e.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}</h2>
  <label>Link Shopee (affiliate) *<input name="url" type="url" required value="${h(e.url)}" placeholder="https://s.shopee.vn/..."></label>
  <label>Tên sản phẩm<input name="title" value="${h(e.title)}"></label>
  <div class="grid2">
    <label>Giá bán<input name="price" value="${h(e.price)}" placeholder="145.250đ"></label>
    <label>Giá gốc (gạch ngang)<input name="old_price" value="${h(e.old_price)}" placeholder="299.000đ"></label>
  </div>
  <div class="grid2">
    <label>Ảnh: tải lên (tối đa 1MB)<input name="image_file" type="file" accept="image/*"></label>
    <label>…hoặc dán link ảnh<input name="image" value="${h(e.image)}" placeholder="https://..."></label>
  </div>
  ${e.image ? `<img class="thumb" src="${h(e.image)}" alt="">` : ''}
  <label class="check"><input type="checkbox" name="active" value="1"${e.active ? ' checked' : ''}> Đang chạy</label>
  <div class="row-actions">
    <button class="btn" type="submit">Lưu sản phẩm</button>
    ${e.id ? '<a class="btn ghost" href="${ADMIN}/qc">Hủy</a>' : ''}
  </div>
</form>

<h2>Danh sách (hiển thị ngẫu nhiên trong các sản phẩm đang chạy)</h2>
<div class="table">
  ${ads.map(a => `<div class="trow">
    ${a.image ? `<img class="thumb sm" src="${h(a.image)}" alt="">` : ''}
    <span class="tmain"><b>${h(a.title || a.url)}</b>
      <small>${a.active ? '<em class="pill ok">Đang chạy</em>' : '<em class="pill">Tắt</em>'} ${h(a.url)}</small></span>
    <span class="tnum">${fmtInt(a.shows)}<small>lượt hiện</small></span>
    <span class="tnum">${fmtInt(a.clicks)}<small>lượt bấm</small></span>
    <span class="tact">
      <a href="?edit=${a.id}#qcform">Sửa</a>
      <form method="post" data-confirm="Xóa sản phẩm này?"><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${a.id}"><button>Xóa</button></form>
    </span>
  </div>`).join('')}
  ${ads.length ? '' : '<p class="muted pad">Chưa có sản phẩm. Khi chưa có sản phẩm nào đang chạy, audio sẽ không bị khóa.</p>'}
</div>`;
}

// ---------- Cài đặt ----------

export function settingsView(s, origin) {
  const img = (k, label) => `<div class="field"><span>${label}</span><input name="${k}_file" type="file" accept="image/*">
      ${s[k] ? `<span class="inline"><img class="thumb sm" src="${h(s[k])}" alt=""><label class="check"><input type="checkbox" name="${k}_remove" value="1"> Gỡ</label></span>` : ''}</div>`;
  return `
<h1>Cài đặt & SEO</h1>
<form method="post" class="form card" enctype="multipart/form-data">
  <h2>Thông tin web</h2>
  <div class="grid2">
    <label>Tên website<input name="site_name" required value="${h(s.site_name)}"></label>
    <label>Dòng giới thiệu (dưới tiêu đề trang chủ)<input name="site_tagline" value="${h(s.site_tagline)}"></label>
  </div>
  <div class="grid2">
    ${img('logo', 'Logo (PNG/JPG/WebP, tối đa 1MB)')}
    ${img('favicon', 'Favicon (để trống sẽ dùng logo)')}
  </div>
  <label class="check"><input type="checkbox" name="header_show_name" value="1"${s.header_show_name === '1' ? ' checked' : ''}> Hiện chữ tên website cạnh logo trên thanh đầu trang</label>
  <div class="grid2">
    <label>Màu chủ đạo<input name="theme_color" type="color" value="${h(s.theme_color)}"></label>
    <label>Số audio mỗi trang<input name="per_page" type="number" min="5" max="100" value="${h(s.per_page)}"></label>
  </div>
  <label>Chữ ở chân trang<input name="footer_text" value="${h(s.footer_text)}"></label>

  <h2>Bình luận & đăng nhập Google</h2>
  <label class="check"><input type="checkbox" name="comments_enabled" value="1"${s.comments_enabled === '1' ? ' checked' : ''}> Bật bình luận</label>
  <label class="check"><input type="checkbox" name="comment_moderation" value="1"${s.comment_moderation === '1' ? ' checked' : ''}> Duyệt bình luận trước khi hiện (bình luận có link luôn phải duyệt)</label>
  <label>Dung lượng tối đa ảnh đại diện người dùng tải lên (MB)<input name="avatar_max_mb" inputmode="decimal" value="${h(s.avatar_max_mb)}">
    <small class="muted">Ảnh được tự cắt vuông và nén còn khoảng 20–50KB trước khi lưu.</small></label>
  <label>Google Client ID<input name="google_client_id" value="${h(s.google_client_id)}" placeholder="123456789-xxxx.apps.googleusercontent.com">
    <small class="muted">Tạo tại console.cloud.google.com → APIs &amp; Services → Credentials → OAuth client ID (Web). Xem hướng dẫn trong README.</small></label>

  <h2>Tu luyện (cấp độ, Linh Thạch)</h2>
  <div class="grid2">
    <label>EXP lên cấp (cấp N cần N × số này, tính lại từ 0 mỗi cấp)<input name="level_base_exp" inputmode="numeric" value="${h(s.level_base_exp)}"></label>
    <label>Điểm danh: Linh Thạch<input name="checkin_stones" inputmode="numeric" value="${h(s.checkin_stones)}"></label>
    <label>Điểm danh: EXP<input name="checkin_exp" inputmode="numeric" value="${h(s.checkin_exp)}"></label>
    <label>Phải online bao lâu mới điểm danh được (giây)<input name="checkin_wait" inputmode="numeric" value="${h(s.checkin_wait)}"></label>
    <label>Thưởng Linh Thạch mỗi lần lên cấp<input name="levelup_stones" inputmode="numeric" value="${h(s.levelup_stones)}"></label>
    <label>EXP mỗi bình luận được duyệt<input name="comment_exp" inputmode="numeric" value="${h(s.comment_exp)}"></label>
    <label>Số bình luận/ngày được cộng EXP<input name="comment_exp_daily" inputmode="numeric" value="${h(s.comment_exp_daily)}"></label>
    <label>Số truyện được đánh giá mỗi ngày (mỗi lượt +1 EXP)<input name="rate_daily" inputmode="numeric" value="${h(s.rate_daily)}"></label>
  </div>

  <h2>Rút Linh Thạch</h2>
  <label class="check"><input type="checkbox" name="withdraw_enabled" value="1"${s.withdraw_enabled !== '0' ? ' checked' : ''}> Cho phép rút Linh Thạch</label>
  <div class="grid2">
    <label>Tỷ giá: 1 Linh Thạch = ? đồng<input name="withdraw_rate" inputmode="decimal" value="${h(s.withdraw_rate)}"></label>
    <label>Rút tối thiểu (Linh Thạch)<input name="withdraw_min" inputmode="numeric" value="${h(s.withdraw_min)}"></label>
    <label>Cấp tối thiểu được rút<input name="withdraw_min_level" inputmode="numeric" value="${h(s.withdraw_min_level)}"></label>
    <label>Tài khoản tạo tối thiểu (ngày)<input name="withdraw_min_days" inputmode="numeric" value="${h(s.withdraw_min_days)}"></label>
    <label>Số lần rút mỗi ngày<input name="withdraw_daily" inputmode="numeric" value="${h(s.withdraw_daily)}"></label>
  </div>

  <h2>SEO</h2>
  <label>Tiêu đề trang chủ (title)<input name="seo_title" maxlength="70" value="${h(s.seo_title)}"><small class="muted">Nên dưới 60 ký tự.</small></label>
  <label>Mô tả web (meta description)<textarea name="seo_description" rows="3" maxlength="300">${h(s.seo_description)}</textarea><small class="muted">Nên 120–160 ký tự. Hiện trên Google và khi chia sẻ Facebook/Zalo.</small></label>
  <label>Từ khóa<input name="seo_keywords" value="${h(s.seo_keywords)}"></label>
  <label>Mã chèn vào &lt;head&gt; (Google Analytics, xác minh Search Console...)<textarea name="head_code" rows="4" class="code">${h(s.head_code)}</textarea></label>
  <p class="muted">Sitemap: <a href="/sitemap.xml" target="_blank">${h(origin)}/sitemap.xml</a> (gửi link này lên Google Search Console)</p>
  <div class="row-actions sticky"><button class="btn" type="submit">Lưu cài đặt</button></div>
</form>`;
}

// ---------- Trang tĩnh ----------

export function pagesView(pages) {
  return `<div class="bar"><h1>Trang (hiện ở chân trang)</h1><a class="btn" href="${ADMIN}/page/new">+ Thêm trang</a></div>
<div class="table">${pages.map(p => `<a class="trow" href="${ADMIN}/page/${p.id}"><span class="tmain"><b>${h(p.title)}</b><small>/trang/${h(p.slug)}</small></span></a>`).join('')}</div>`;
}

export function pageForm(p) {
  return `<h1>${p.id ? 'Sửa trang' : 'Thêm trang'}</h1>
<form method="post" class="form card">
  <div class="grid2">
    <label>Tiêu đề<input name="title" required value="${h(p.title)}"></label>
    <label>Đường dẫn<input name="slug" value="${h(p.slug)}"></label>
  </div>
  <label>Thứ tự<input name="pos" type="number" value="${p.pos}"></label>
  <label>Nội dung (cho phép HTML: &lt;p&gt;, &lt;a&gt;, &lt;b&gt;...)<textarea name="content" rows="12" class="code">${h(p.content)}</textarea></label>
  <div class="row-actions"><button class="btn" type="submit">Lưu</button>
  ${p.id ? `<button class="btn ghost danger-txt" type="submit" name="action" value="delete" formnovalidate data-confirm="Xóa trang này?">Xóa</button>` : ''}</div>
</form>`;
}

export function passwordView(s, err) {
  return `<h1>Tài khoản quản trị</h1>
${err ? `<div class="flash err">${h(err)}</div>` : ''}
<form method="post" class="form card narrow">
  <label>Tên đăng nhập<input name="user" value="${h(s.admin_user)}" autocomplete="username"></label>
  <label>Mật khẩu hiện tại<input name="old" type="password" required autocomplete="current-password"></label>
  <label>Mật khẩu mới (ít nhất 8 ký tự)<input name="new" type="password" required minlength="8" autocomplete="new-password"></label>
  <label>Nhập lại mật khẩu mới<input name="new2" type="password" required minlength="8" autocomplete="new-password"></label>
  <div class="row-actions"><button class="btn" type="submit">Lưu</button></div>
</form>`;
}

// ---------- Bảo mật ----------

export function securityView({ stats, logs, blocked, myIp }) {
  const by = Object.fromEntries(stats.map(r => [r.event, r]));
  const stat = (k, label) => `<div><b>${fmtInt(by[k]?.n || 0)}</b><span>${label} (${by[k]?.ips || 0} IP)</span></div>`;
  const label = e => EVENT_LABELS[e] || e;
  const bad = e => !['login_ok'].includes(e);
  const blockForm = (ip, reason = '') => `<form method="post" data-confirm="Chặn IP ${h(ip)}?"><input type="hidden" name="action" value="block">
    <input type="hidden" name="ip" value="${h(ip)}"><input type="hidden" name="reason" value="${h(reason)}"><input type="hidden" name="hours" value="0"><button>Chặn</button></form>`;
  return `
<h1>Bảo mật</h1>
<p class="muted">IP của bạn: <b>${h(myIp)}</b>. Link quản trị: <code>${h(ADMIN)}</code>. Đừng chia sẻ link này.</p>
<h2>24 giờ qua</h2>
<div class="stats">
  ${stat('probe', 'lượt dò lỗ hổng')}
  ${stat('login_fail', 'lần đăng nhập sai')}
  ${stat('login_lock', 'lần bị khóa đăng nhập')}
  ${stat('play_spam', 'lần bơm lượt nghe')}
</div>

<form method="post" class="form card">
  <input type="hidden" name="action" value="block">
  <h2>Chặn IP thủ công</h2>
  <div class="grid2">
    <label>Địa chỉ IP<input name="ip" required placeholder="1.2.3.4"></label>
    <label>Thời gian<select name="hours"><option value="0">Vĩnh viễn</option><option value="24">24 giờ</option><option value="168">7 ngày</option><option value="720">30 ngày</option></select></label>
  </div>
  <label>Lý do<input name="reason" placeholder="Spam, tấn công..."></label>
  <div class="row-actions"><button class="btn" type="submit">Chặn IP</button></div>
</form>

<h2>IP đang bị chặn (${blocked.length})</h2>
<div class="table">
  ${blocked.map(b => `<div class="trow">
    <span class="tmain"><b>${h(b.ip)}</b><small>${h(b.reason)} · ${b.until ? 'đến ' + vnDate(b.until, true) : 'vĩnh viễn'}</small></span>
    <span class="tact"><form method="post"><input type="hidden" name="action" value="unblock"><input type="hidden" name="ip" value="${h(b.ip)}"><button class="ok-txt">Bỏ chặn</button></form></span>
  </div>`).join('') || '<p class="muted pad">Chưa chặn IP nào.</p>'}
</div>

<div class="bar"><h2>Nhật ký (30 ngày, mới nhất trước)</h2>
  <form method="post" data-confirm="Xóa toàn bộ nhật ký?"><input type="hidden" name="action" value="clear_log"><button class="btn ghost">Xóa nhật ký</button></form>
</div>
<div class="table">
  ${logs.map(l => `<div class="trow">
    <span class="tmain"><b class="${bad(l.event) ? 'danger-txt' : 'ok-txt'}">${h(label(l.event))}${l.hits > 1 ? ` ×${l.hits}` : ''}</b>
      <small>${vnDate(l.at, true)} · ${h(l.ip)}${l.country ? ' (' + h(l.country) + ')' : ''} · ${h(l.detail)}</small>
      <small class="ua">${h(l.ua)}</small></span>
    <span class="tact">${bad(l.event) && l.ip !== myIp ? blockForm(l.ip, label(l.event)) : ''}</span>
  </div>`).join('') || '<p class="muted pad">Chưa có sự kiện nào.</p>'}
</div>

<form method="post" class="danger" data-confirm="Đăng xuất khỏi mọi thiết bị, kể cả máy này?">
  <input type="hidden" name="action" value="logout_all"><button type="submit">Đăng xuất khỏi mọi thiết bị</button>
</form>`;
}

// ---------- Bình luận ----------

export function commentsView({ rows, count, status, page, per, banned, moderation, clientId }) {
  const tabs = [['pending', 'Chờ duyệt'], ['approved', 'Đã hiện'], ['hidden', 'Đã ẩn']];
  const total = count[status] || 0;
  const pages = Math.max(1, Math.ceil(total / per));
  const btn = (act, label, c, extra = '') => `<form method="post"${extra}><input type="hidden" name="action" value="${act}"><input type="hidden" name="id" value="${c.id}"><input type="hidden" name="user_id" value="${c.user_id}"><button>${label}</button></form>`;
  return `
<div class="bar"><h1>Bình luận</h1>
  ${status === 'pending' && total ? `<form method="post" data-confirm="Duyệt tất cả ${total} bình luận đang chờ?"><input type="hidden" name="action" value="approve_all"><button class="btn">Duyệt tất cả</button></form>` : ''}
</div>
${clientId ? '' : `<div class="flash err">Chưa nhập Google Client ID nên người nghe chưa đăng nhập được. Vào <a href="${ADMIN}/settings">Cài đặt & SEO</a> để nhập.</div>`}
<p class="muted">${moderation ? 'Đang bật duyệt: bình luận mới chỉ hiện sau khi bạn bấm Duyệt.' : 'Đang tắt duyệt: bình luận hiện ngay (trừ bình luận có link).'}</p>
<nav class="tabs-admin">${tabs.map(([k, l]) => `<a href="?status=${k}" class="${k === status ? 'on' : ''}">${l} (${count[k] || 0})</a>`).join('')}</nav>
<div class="table">
  ${rows.map(c => `<div class="trow crow">
    <span class="tmain"><b>${h(c.name)}${c.banned ? ' <em class="pill">Đã khóa</em>' : ''} <small>${h(c.email)}</small></b>
      <span class="cbody">${h(c.body)}</span>
      <small>${vnDate(c.created_at, true)} · ${c.parent_id ? 'trả lời · ' : ''}${c.track_slug ? `<a href="/track/${h(c.track_slug)}#comments" target="_blank">${h(c.track_title)}</a>` : 'audio đã xóa'} · ${c.likes} thích · ${h(c.ip)}</small></span>
    <span class="tact col">
      ${c.status !== 'approved' ? btn('approve', 'Duyệt', c, ' class="ok-form"') : ''}
      ${c.status !== 'hidden' ? btn('hide', 'Ẩn', c) : ''}
      ${btn('delete', 'Xóa', c, ' data-confirm="Xóa bình luận này?"')}
      ${c.banned ? btn('unban', 'Mở khóa', c) : btn('ban', 'Khóa người này', c, ` data-confirm="Khóa ${h(c.name)} và ẩn mọi bình luận của họ?"`)}
    </span>
  </div>`).join('') || '<p class="muted pad">Không có bình luận nào.</p>'}
</div>
${pages > 1 ? `<nav class="pager">${Array.from({ length: pages }, (_, i) => i + 1).map(i => `<a class="${i === page ? 'on' : ''}" href="?status=${status}&page=${i}">${i}</a>`).join('')}</nav>` : ''}
${banned.length ? `<h2>Người dùng bị khóa (${banned.length})</h2><div class="table">${banned.map(u => `<div class="trow"><span class="tmain"><b>${h(u.name)}</b><small>${h(u.email)}</small></span>
  <span class="tact"><form method="post"><input type="hidden" name="action" value="unban"><input type="hidden" name="user_id" value="${u.id}"><button class="ok-txt">Mở khóa</button></form></span></div>`).join('')}</div>` : ''}`;
}

// ---------- Thành viên ----------

const memberAv = (u, size = 40) => u.avatar
  ? `<img class="m-av" src="${h(u.avatar)}" alt="" referrerpolicy="no-referrer" style="width:${size}px;height:${size}px">`
  : `<span class="m-av" style="width:${size}px;height:${size}px">${h(Array.from(u.name || '?')[0].toUpperCase())}</span>`;
const realmTag = exp => { const L = levelInfo(exp); return `<span class="m-realm t${L.tier}">Cấp ${L.lvl} · ${h(L.realm)}</span>`; };
const ACTION_LABELS = { rename: 'Đổi tên', stones: 'Linh Thạch', exp: 'EXP', ban: 'Khóa bình luận', unban: 'Mở khóa bình luận', lock: 'Khóa tài khoản',
  unlock: 'Mở khóa tài khoản', logout: 'Đăng xuất mọi thiết bị', avatar_reset: 'Bỏ ảnh đại diện', block_ip: 'Chặn IP',
  withdraw: 'Yêu cầu rút Linh Thạch', withdraw_refund: 'Hoàn Linh Thạch (từ chối rút)' };

export function membersView({ rows, total, stats, q, sort, filter, page, per }) {
  const pages = Math.max(1, Math.ceil(total / per));
  const qs = (o = {}) => '?' + new URLSearchParams({ q, sort, f: filter, ...o }).toString();
  return `
<h1>Thành viên</h1>
<div class="stats">
  <div><b>${fmtInt(stats.total)}</b><span>thành viên</span></div>
  <div><b>${fmtInt(stats.today || 0)}</b><span>đăng ký 24 giờ qua</span></div>
  <div><b>${fmtInt(stats.active || 0)}</b><span>hoạt động 7 ngày</span></div>
  <div><b>${fmtInt(stats.stones)}</b><span>tổng Linh Thạch</span></div>
</div>
<form method="get" class="bar">
  <input class="search" type="search" name="q" value="${h(q)}" placeholder="Tìm tên, email, ID hoặc IP...">
  <select name="sort" class="sel">${[['new', 'Mới đăng ký'], ['exp', 'EXP cao nhất'], ['stones', 'Nhiều Linh Thạch'], ['login', 'Đăng nhập gần đây']].map(([k, l]) => `<option value="${k}"${k === sort ? ' selected' : ''}>${l}</option>`).join('')}</select>
  <select name="f" class="sel">${[['all', 'Tất cả'], ['banned', 'Bị khóa bình luận'], ['locked', 'Bị khóa tài khoản']].map(([k, l]) => `<option value="${k}"${k === filter ? ' selected' : ''}>${l}</option>`).join('')}</select>
  <button class="btn ghost" type="submit">Lọc</button>
</form>
<div class="table">
  ${rows.map(u => `<a class="trow mrow" href="${ADMIN}/members/${u.id}">
    ${memberAv(u)}
    <span class="tmain"><b>${h(u.name)} <small>#${u.id}</small>${u.locked ? ' <em class="pill bad">Khóa TK</em>' : ''}${u.banned ? ' <em class="pill">Khóa BL</em>' : ''}</b>
      <small>${h(u.email)} · ${realmTag(u.exp)}</small>
      <small>Đăng ký ${vnDate(u.created_at)} · IP ${h(u.reg_ip || '—')}${u.country ? ' (' + h(u.country) + ')' : ''} · vào lần cuối ${u.last_login ? vnDate(u.last_login, true) : '—'}</small></span>
    <span class="tnum">${fmtInt(u.stones)}<small>Linh Thạch</small></span>
    <span class="tnum">${fmtInt(u.exp)}<small>EXP</small></span>
  </a>`).join('') || '<p class="muted pad">Không có thành viên nào.</p>'}
</div>
${pages > 1 ? `<nav class="pager">${Array.from({ length: pages }, (_, i) => i + 1).map(i => `<a class="${i === page ? 'on' : ''}" href="${qs({ page: i })}">${i}</a>`).join('')}</nav>` : ''}`;
}

export function memberView({ u, comments, logs, counts, myIp }) {
  const L = levelInfo(u.exp);
  const act = (a, label, cls = 'btn ghost', confirm = '') => `<form method="post"${confirm ? ` data-confirm="${h(confirm)}"` : ''}><input type="hidden" name="action" value="${a}"><button class="${cls}">${label}</button></form>`;
  const ipRow = (label, ip) => `<dt>${label}</dt><dd>${ip ? `${h(ip)}${ip !== myIp ? ` <form method="post" class="inline-form" data-confirm="Chặn IP ${h(ip)}?"><input type="hidden" name="action" value="block_ip"><input type="hidden" name="ip" value="${h(ip)}"><button class="link-danger">Chặn IP</button></form>` : ' <small class="muted">(IP của bạn)</small>'}` : '—'}</dd>`;
  return `
<p><a href="${ADMIN}/members">← Danh sách thành viên</a></p>
<div class="card mhead">
  ${memberAv(u, 72)}
  <div><h1>${h(u.name)} <small class="muted">#${u.id}</small></h1>
    <p>${realmTag(u.exp)} ${u.locked ? '<em class="pill bad">Tài khoản bị khóa</em>' : ''} ${u.banned ? '<em class="pill">Khóa bình luận</em>' : ''}</p>
    <p class="muted">${h(u.email)} · đăng nhập bằng Google</p></div>
</div>
<div class="stats">
  <div><b>${fmtInt(u.stones)}</b><span>Linh Thạch</span></div>
  <div><b>${fmtInt(u.exp)}</b><span>EXP · ${fmtInt(L.cur)}/${fmtInt(L.need)} lên cấp ${L.lvl + 1}</span></div>
  <div><b>${fmtInt(u.comments_n)}</b><span>bình luận được duyệt (${fmtInt(counts.comments_all)} tổng)</span></div>
  <div><b>${fmtInt(counts.ratings)}</b><span>đánh giá · ${fmtInt(counts.history)} truyện đã nghe</span></div>
</div>

<div class="grid2">
  <form method="post" class="form card"><input type="hidden" name="action" value="stones">
    <h2>Cộng / trừ Linh Thạch</h2>
    <label>Số lượng (số âm để trừ)<input name="amount" inputmode="numeric" placeholder="100 hoặc -50" required></label>
    <label>Lý do (thành viên sẽ thấy trong thông báo)<input name="reason" placeholder="Thưởng sự kiện..."></label>
    <button class="btn">Cập nhật Linh Thạch</button>
  </form>
  <form method="post" class="form card"><input type="hidden" name="action" value="exp">
    <h2>Cộng / trừ EXP</h2>
    <label>Số lượng (số âm để trừ)<input name="amount" inputmode="numeric" placeholder="500 hoặc -100" required></label>
    <label>Lý do<input name="reason" placeholder="Bù EXP do lỗi..."></label>
    <button class="btn">Cập nhật EXP</button>
  </form>
</div>

<form method="post" class="form card"><input type="hidden" name="action" value="save">
  <h2>Thông tin</h2>
  <label>Tên hiển thị<input name="name" value="${h(u.name)}" maxlength="40" required></label>
  <label>Ghi chú nội bộ (chỉ admin thấy)<textarea name="note" rows="2">${h(u.note || '')}</textarea></label>
  <dl class="minfo">
    <dt>Đăng ký</dt><dd>${vnDate(u.created_at, true)}</dd>
    <dt>Đăng nhập gần nhất</dt><dd>${u.last_login ? vnDate(u.last_login, true) : '—'}</dd>
    ${ipRow('IP đăng ký', u.reg_ip)}
    ${ipRow('IP gần nhất', u.last_ip)}
    <dt>Quốc gia</dt><dd>${h(u.country || '—')}</dd>
    <dt>Cùng IP</dt><dd>${counts.same_ip ? `<a href="${ADMIN}/members?q=${encodeURIComponent(u.reg_ip || u.last_ip)}">${counts.same_ip} tài khoản khác</a> <small class="muted">(có thể là clone, hoặc chung mạng di động)</small>` : 'Không có'}</dd>
  </dl>
  <div class="row-actions"><button class="btn">Lưu</button></div>
</form>

<div class="card">
  <h2>Mật khẩu & đăng nhập</h2>
  <p class="muted">Thành viên đăng nhập bằng Google nên web không lưu mật khẩu; mật khẩu do Google quản lý. Bạn có thể buộc đăng xuất hoặc khóa tài khoản:</p>
  <div class="row-actions">
    ${act('logout', 'Đăng xuất mọi thiết bị', 'btn ghost', 'Đăng xuất thành viên này khỏi mọi thiết bị?')}
    ${u.locked ? act('unlock', 'Mở khóa tài khoản', 'btn') : act('lock', 'Khóa tài khoản', 'btn ghost danger-txt', 'Khóa tài khoản này? Thành viên sẽ không đăng nhập được.')}
    ${u.banned ? act('unban', 'Mở khóa bình luận', 'btn ghost') : act('ban', 'Khóa bình luận', 'btn ghost danger-txt', 'Khóa bình luận và ẩn mọi bình luận của thành viên này?')}
    ${u.avatar ? act('avatar_reset', 'Bỏ ảnh đại diện', 'btn ghost', 'Bỏ ảnh đại diện của thành viên này?') : ''}
  </div>
</div>

<h2>Nhật ký thay đổi</h2>
<div class="table">${logs.map(l => `<div class="trow"><span class="tmain"><b>${h(ACTION_LABELS[l.action] || l.action)}${l.amount ? ` ${l.amount > 0 ? '+' : ''}${fmtInt(l.amount)}`.replace('+-', '-') : ''}</b>
  <small>${vnDate(l.created_at, true)}${l.note ? ' · ' + h(l.note) : ''}</small></span></div>`).join('') || '<p class="muted pad">Chưa có thay đổi nào.</p>'}</div>

<h2>Bình luận gần đây</h2>
<div class="table">${comments.map(c => `<div class="trow crow"><span class="tmain"><span class="cbody">${h(c.body)}</span>
  <small>${vnDate(c.created_at, true)} · ${{ approved: 'Đã hiện', pending: 'Chờ duyệt', hidden: 'Đã ẩn' }[c.status] || c.status} · ${c.likes} thích · ${c.slug ? `<a href="/track/${h(c.slug)}#comments" target="_blank">${h(c.title)}</a>` : 'audio đã xóa'}</small></span></div>`).join('') || '<p class="muted pad">Chưa bình luận.</p>'}</div>

<form method="post" class="form card danger-zone" data-confirm="Xóa vĩnh viễn tài khoản này cùng toàn bộ bình luận, đánh giá, lịch sử?">
  <input type="hidden" name="action" value="delete">
  <h2>Xóa tài khoản</h2>
  <p class="muted">Xóa vĩnh viễn thành viên cùng bình luận, lượt thích, đánh giá, lịch sử nghe. Không thể hoàn tác.</p>
  <label>Gõ <b>XOA</b> để xác nhận<input name="confirm" autocomplete="off"></label>
  <div class="row-actions"><button class="btn danger-btn">Xóa tài khoản</button></div>
</form>`;
}

// ---------- Rút Linh Thạch ----------

const WD_METHODS = { bank: 'Ngân hàng', momo: 'MoMo', viettelpay: 'ViettelPay', zalopay: 'ZaloPay' };

export function withdrawalsView({ rows, counts, status }) {
  const tabs = [['pending', 'Chờ duyệt'], ['paid', 'Đã chuyển'], ['rejected', 'Từ chối']];
  const money = n => fmtInt(n) + 'đ';
  return `
<h1>Rút Linh Thạch</h1>
<div class="stats">
  <div><b>${fmtInt(counts.pending?.n || 0)}</b><span>chờ duyệt · ${money(counts.pending?.vnd || 0)}</span></div>
  <div><b>${money(counts.paid?.vnd || 0)}</b><span>đã chuyển (${fmtInt(counts.paid?.n || 0)} lần)</span></div>
  <div><b>${fmtInt(counts.rejected?.n || 0)}</b><span>đã từ chối</span></div>
</div>
<p class="muted">Chuyển tiền thủ công theo thông tin bên dưới rồi bấm <b>Đã chuyển</b>. Từ chối sẽ tự hoàn Linh Thạch. Hãy kiểm tra cột "cùng IP" để phát hiện người dùng nhiều tài khoản.</p>
<nav class="tabs-admin">${tabs.map(([k, l]) => `<a href="?status=${k}" class="${k === status ? 'on' : ''}">${l} (${counts[k]?.n || 0})</a>`).join('')}</nav>
<div class="table">
  ${rows.map(w => {
    const L = levelInfo(w.exp);
    return `<div class="trow wrow">
    <span class="tmain">
      <b>${money(w.vnd)} <small class="muted">· ${fmtInt(w.amount)} Linh Thạch · #${w.id}</small></b>
      <span class="wacc"><b>${h(WD_METHODS[w.method] || w.method)}${w.bank ? ' · ' + h(w.bank) : ''}</b>
        <span>Số: <code class="copy" data-copy="${h(w.number)}">${h(w.number)}</code></span>
        <span>Chủ TK: <code class="copy" data-copy="${h(w.holder)}">${h(w.holder)}</code></span>
        <span>Nội dung CK: <code class="copy" data-copy="RUT ${w.id}">RUT ${w.id}</code></span></span>
      <small><a href="${ADMIN}/members/${w.user_id}">${h(w.name)}</a> · ${h(w.email)} · Cấp ${L.lvl} · tạo TK ${vnDate(w.user_created)} ·
        IP rút ${h(w.ip || '—')}${w.same_ip ? ` · <b class="danger-txt">${w.same_ip} TK cùng IP</b>` : ''} · đã nhận trước đó ${money(w.paid_total)}</small>
      <small>Gửi lúc ${vnDate(w.created_at, true)}${w.processed_at ? ' · xử lý ' + vnDate(w.processed_at, true) : ''}${w.admin_note ? ' · Ghi chú: ' + h(w.admin_note) : ''}</small>
    </span>
    ${w.status === 'pending' ? `<span class="wact">
      <form method="post" data-confirm="Xác nhận đã chuyển ${money(w.vnd)} cho ${h(w.holder)}?"><input type="hidden" name="action" value="paid"><input type="hidden" name="id" value="${w.id}">
        <input name="note" placeholder="Mã giao dịch (tùy chọn)"><button class="btn">Đã chuyển</button></form>
      <form method="post" data-confirm="Từ chối và hoàn ${fmtInt(w.amount)} Linh Thạch?"><input type="hidden" name="action" value="reject"><input type="hidden" name="id" value="${w.id}">
        <input name="note" placeholder="Lý do từ chối"><button class="btn ghost danger-txt">Từ chối</button></form>
    </span>` : ''}
  </div>`;
  }).join('') || '<p class="muted pad">Không có yêu cầu nào.</p>'}
</div>`;
}
