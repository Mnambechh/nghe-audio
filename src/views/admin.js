// Giao diện trang quản trị.
import { h, fmtTime, fmtNum, fmtInt, vnDate } from '../util.js';
import { ASSET_V } from './public.js';
import { ADMIN, EVENT_LABELS } from '../security.js';

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

const NAV = [['/admin', 'Audio'], ['/admin/qc', 'Quảng cáo'], ['/admin/settings', 'Cài đặt & SEO'], ['/admin/comments', 'Bình luận'], ['/admin/pages', 'Trang'], ['/admin/security', 'Bảo mật'], ['/admin/password', 'Tài khoản']];
// Đường dẫn nội bộ /admin/... → đường dẫn thật trên web.
const A = p => ADMIN + p.slice('/admin'.length);

export function adminLayout(s, path, flash, content) {
  const cur = path === '/admin' || path.startsWith('/admin/track') ? '/admin' : path.startsWith('/admin/page') ? '/admin/pages' : path;
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
