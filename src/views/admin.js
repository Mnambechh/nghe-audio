// Giao diện trang quản trị.
import { h, fmtTime, fmtNum, fmtInt, vnDate } from '../util.js';
import { ASSET_V } from './public.js';
import { ADMIN, EVENT_LABELS, deviceOf } from '../security.js';
import { levelInfo } from '../levels.js';
import { matchWords } from '../wordfilter.js';
import { NAME_FX } from '../shop.js';
import { DEFAULT_WORDMARK, usesDefaultLogo } from './brand.js';
import { parseLevelTiers } from '../game.js';

const asset = f => `/assets/${f}?v=${ASSET_V}`;

function shell(title, body, extraHead = '') {
  return `<!doctype html>
<html lang="vi" class="admin-noir">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${h(title)}</title>
<link rel="stylesheet" href="${asset('admin.css')}">${extraHead}
<link rel="stylesheet" href="${asset('noir-admin.css')}">
</head>
${body}
</html>`;
}

const NAV = [['/admin/overview', 'Tổng quan'], ['/admin', 'Audio'], ['/admin/qc', 'Quảng cáo'], ['/admin/settings', 'Cài đặt & SEO'], ['/admin/members', 'Thành viên'], ['/admin/quests', 'Nhiệm vụ'], ['/admin/shop', 'Cửa hàng'], ['/admin/withdrawals', 'Rút Linh Thạch'], ['/admin/comments', 'Bình luận'], ['/admin/pages', 'Trang'], ['/admin/security', 'Bảo mật'], ['/admin/password', 'Tài khoản']];
// Đường dẫn nội bộ /admin/... → đường dẫn thật trên web.
const A = p => ADMIN + p.slice('/admin'.length);

export function adminLayout(s, path, flash, content, editor = null) {
  const cur = path === '/admin' || path.startsWith('/admin/track') ? '/admin' : path.startsWith('/admin/page') ? '/admin/pages' : path.startsWith('/admin/members') ? '/admin/members' : path;
  return shell(`Quản trị - ${s.site_name}`, `<body>
<header class="qt-top">
  <a class="qt-brand" href="${ADMIN}" aria-label="${h(usesDefaultLogo(s) ? 'TruyenGi.info' : s.site_name)}">${usesDefaultLogo(s) ? DEFAULT_WORDMARK : `<img class="qt-logo" src="${h(s.logo)}" alt="" height="34">`} <small>${editor ? 'biên tập' : 'admin'}</small></a>
  <nav class="qt-nav">${(editor ? NAV.filter(([p]) => p === '/admin' || p === '/admin/qc') : NAV).map(([p, l]) => `<a href="${A(p)}" class="${cur === p ? 'on' : ''}">${l}</a>`).join('')}</nav>
  <div class="qt-right">
    ${editor ? `<span class="muted">✏️ ${h(editor.name)}</span>` : ''}
    <a href="/" target="_blank">Xem web ↗</a>
    ${editor ? '' : `<form method="post" action="${ADMIN}/logout"><button type="submit">Thoát</button></form>`}
  </div>
</header>
<main class="qt-main${path === '/admin/members' || path === '/admin/overview' ? ' wide' : ''}">
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
  ${s.admin_totp ? '<label>Mã xác thực 2 bước (6 số trong ứng dụng)<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required placeholder="123456"><small class="muted">Mất điện thoại? Nhập một mã dự phòng.</small></label>' : ''}
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

export function tracksView({ tracks, stats, q, page, total, per, editor = null }) {
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
  ${editor ? '<p class="muted">Bạn đang ở chế độ <b>Biên tập viên</b>: đăng audio mới và sửa audio do chính mình đăng.</p>' : ''}
  ${tracks.map(t => {
    const mine = !editor || t.created_by === editor.id;
    return `<${mine ? `a href="${ADMIN}/track/${t.id}"` : 'div'} class="trow${mine ? '' : ' trow-off'}">
    <span class="tmain"><b>${h(t.title)}</b>
      <small>${t.published ? '' : '<em class="pill">Ẩn</em> '}${t.nparts} phần · ${fmtTime(t.duration)} · ${vnDate(t.created_at, true)}${t.creator ? ` · ✏️ ${h(t.creator)}` : ''}</small></span>
    <span class="tnum">${fmtNum(t.views)}<small>lượt nghe</small></span>
    <span class="tnum live-n">${t.live}<small>đang nghe</small></span>
    ${mine ? '<span class="tedit" title="Sửa truyện">✏️</span>' : ''}
  </${mine ? 'a' : 'div'}>`;
  }).join('')}
  ${tracks.length ? '' : '<p class="muted pad">Chưa có audio nào. Bấm “Đăng audio” để bắt đầu.</p>'}
</div>
${pages > 1 ? `<nav class="pager">${Array.from({ length: pages }, (_, i) => i + 1)
    .map(i => `<a class="${i === page ? 'on' : ''}" href="?page=${i}&q=${encodeURIComponent(q)}">${i}</a>`).join('')}</nav>` : ''}`;
}

// ---------- Thêm / sửa audio ----------

export function trackForm({ track, parts, err, editor = null }) {
  if (!parts.length) parts = [{ title: '', url: '', duration: 0 }];
  return `
<div class="bar">
  <h1>${track.id ? 'Sửa audio' : 'Đăng audio mới'}</h1>
  ${track.id ? `<a class="btn" href="${ADMIN}/track/new">+ Thêm mới</a>` : ''}
  ${track.id && track.slug ? `<a class="btn ghost" target="_blank" href="/track/${h(track.slug)}">Xem ↗</a>` : ''}
</div>
${err ? `<div class="flash err">${h(err)}</div>` : ''}
<form method="post" class="form card" id="trackForm">
  <label>Tên truyện / audio *<input name="title" required value="${h(track.title)}" placeholder="Ví dụ: Truyện Gì Audio Số 306"></label>
  <div class="grid2">
    <label>Nhãn<input name="tag" value="${h(track.tag)}" placeholder="Audio Full"></label>
    <label>Đường dẫn (để trống sẽ tự tạo)<input name="slug" value="${h(track.slug)}" placeholder="truyen-gi-audio-so-306"></label>
  </div>
  <div class="field">
    <span>Thể loại (chọn nhanh)</span>
    <div class="row-actions">
      ${['Đam mỹ', 'Ngôn tình'].map(genre => `<label class="check"><input type="checkbox" data-genre="${genre}"${String(track.tag || '').split(',').map(t => t.trim()).includes(genre) ? ' checked' : ''}> ${genre}</label>`).join('')}
    </div>
  </div>
  <label>Mô tả (hiện trên trang nghe)<textarea name="description" rows="3">${h(track.description)}</textarea></label>

  <div class="cover-box">
    <div class="cover-prev">${track.cover ? `<img src="${h(track.cover)}" alt="">` : '<span>Chưa có ảnh bìa</span>'}</div>
    <div class="cover-ctl">
      <b>Ảnh bìa</b>
      <label class="btn ghost cover-pick">Chọn ảnh…<input type="file" id="coverFile" accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,image/jpeg,image/png,image/webp,image/gif,image/bmp" hidden></label>
      <small class="muted cover-info">Hỗ trợ: JPG, PNG, WebP, GIF, BMP.</small>
      <input type="hidden" name="cover_data">
      ${track.cover ? '<label class="check"><input type="checkbox" name="cover_remove" value="1"> Gỡ ảnh bìa</label>' : ''}
    </div>
  </div>

  <details class="seo-box"${track.seo_title || track.seo_desc || track.seo_keywords ? ' open' : ''}>
    <summary>🔎 SEO cho truyện này <small class="muted">(để trống = web tự tạo nội dung chuẩn SEO)</small></summary>
    <label>Tiêu đề SEO <small class="muted seo-count" data-for="seo_title" data-max="60"></small>
      <input name="seo_title" value="${h(track.seo_title || '')}" maxlength="120" placeholder="Ví dụ: ${h(track.title || 'Tên truyện')} - Nghe Audio Full Miễn Phí"></label>
    <label>Mô tả SEO (hiện dưới tiêu đề trên Google) <small class="muted seo-count" data-for="seo_desc" data-max="160"></small>
      <textarea name="seo_desc" rows="3" maxlength="320" placeholder="1–2 câu tóm tắt hấp dẫn, có tên truyện và từ khóa chính, 120–160 ký tự.">${h(track.seo_desc || '')}</textarea></label>
    <label>Từ khóa (cách nhau bằng dấu phẩy)<input name="seo_keywords" value="${h(track.seo_keywords || '')}" placeholder="tên truyện, truyện audio, nghe truyện ..."></label>
    <div class="serp" aria-label="Xem trước trên Google">
      <small class="serp-url">${h('truyengi.info › track › ' + (track.slug || 'truyen-gi-audio-so-306'))}</small>
      <b class="serp-title"></b>
      <span class="serp-desc"></span>
    </div>
  </details>

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
    ${track.id ? `<a class="btn ghost" href="${ADMIN}/track/new">+ Thêm mới</a>` : '<button class="btn ghost" type="submit" name="and_new" value="1">Lưu & đăng tiếp</button>'}
  </div>
</form>
${track.id && !editor ? `<form method="post" action="${ADMIN}/track/${track.id}/delete" class="danger" data-confirm="Xóa audio này? Không thể hoàn tác.">
  <button type="submit">Xóa audio này</button></form>` : ''}`;
}

// ---------- Quảng cáo ----------

export function adsView(s, ads, edit, editor = null) {
  const e = edit || { id: 0, title: '', image: '', price: '', old_price: '', url: '', active: 1 };
  const ctr = a => a.shows ? (a.clicks / a.shows * 100).toFixed(1).replace('.', ',') + '%' : '–';
  // Biên tập viên: chỉ xem thống kê, không có form sửa / xóa (máy chủ cũng chặn mọi thao tác gửi lên).
  if (editor) {
    const tot = ads.reduce((t, a) => ({ shows: t.shows + (a.shows || 0), clicks: t.clicks + (a.clicks || 0) }), { shows: 0, clicks: 0 });
    return `
<h1>Quảng cáo Shopee</h1>
<p class="muted">Bạn đang xem ở chế độ <b>Biên tập viên</b>: chỉ xem lượt hiển thị và lượt bấm, không chỉnh sửa được quảng cáo.</p>
<div class="card"><p>Trạng thái: ${s.ad_enabled === '1' ? '<em class="pill ok">Đang bật</em>' : '<em class="pill">Đang tắt</em>'} · hiện lại sau mỗi <b>${h(s.ad_interval_hours)}</b> giờ</p>
  <p>Tổng: <b>${fmtInt(tot.shows)}</b> lượt hiện · <b>${fmtInt(tot.clicks)}</b> lượt bấm · tỉ lệ bấm <b>${ctr(tot)}</b></p></div>
<div class="table">
  ${ads.map(a => `<div class="trow">
    ${a.image ? `<img class="thumb sm" src="${h(a.image)}" alt="">` : ''}
    <span class="tmain"><b>${h(a.title || 'Sản phẩm #' + a.id)}</b>
      <small>${a.active ? '<em class="pill ok">Đang chạy</em>' : '<em class="pill">Tắt</em>'}${a.price ? ' ' + h(a.price) : ''}</small></span>
    <span class="tnum">${fmtInt(a.shows)}<small>lượt hiện</small></span>
    <span class="tnum">${fmtInt(a.clicks)}<small>lượt bấm</small></span>
    <span class="tnum">${ctr(a)}<small>tỉ lệ bấm</small></span>
  </div>`).join('') || '<p class="muted pad">Chưa có sản phẩm quảng cáo.</p>'}
</div>`;
  }
  return `
<h1>Quảng cáo Shopee</h1>
<form method="post" class="form card">
  <input type="hidden" name="action" value="config">
  <h2>Cách hiển thị</h2>
  <label class="check"><input type="checkbox" name="ad_enabled" value="1"${s.ad_enabled === '1' ? ' checked' : ''}> Bật khóa audio bằng quảng cáo</label>
  <label>Tần suất hiện quảng cáo
    <select name="ad_mode">
      <option value="hours"${s.ad_mode !== 'every' ? ' selected' : ''}>Theo số giờ (bấm 1 lần, nghe tự do trong số giờ bên dưới)</option>
      <option value="every"${s.ad_mode === 'every' ? ' selected' : ''}>Mỗi lần bấm phát đều hiện quảng cáo 1 lần</option>
    </select>
    <small class="muted">"Mỗi lần bấm phát": mỗi lần người nghe bấm ▶ (phát truyện, chọn tập, bấm tiếp tục) đều hiện quảng cáo; tự chuyển sang tập kế tiếp thì không hiện. Nhớ sửa "Ghi chú dưới nút" cho đúng chế độ này.</small>
  </label>
  <label>Sau khi bấm quảng cáo, được nghe tự do trong (giờ) <small class="muted">— chỉ dùng cho chế độ "Theo số giờ"</small>
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
    ${e.id ? `<a class="btn ghost" href="${ADMIN}/qc">Hủy</a>` : ''}
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
  <input type="hidden" name="default_logo_form" value="1">
  <h2>Thông tin web</h2>
  <div class="grid2">
    <label>Tên website<input name="site_name" required value="${h(s.site_name)}"></label>
    <label>Dòng giới thiệu (dưới tiêu đề trang chủ)<input name="site_tagline" value="${h(s.site_tagline)}"></label>
  </div>
  <div class="grid2">
    ${img('logo', 'Logo (PNG/JPG/WebP, tối đa 1MB)')}
    ${img('favicon', 'Favicon (để trống sẽ dùng logo)')}
  </div>
  <label class="check"><input type="checkbox" name="default_logo" value="1"${usesDefaultLogo(s) ? ' checked' : ''}> Dùng logo chữ TruyenGi.info mặc định</label>
  <p class="muted">Bỏ chọn để dùng ảnh logo đã tải. Tải ảnh logo mới sẽ tự chuyển sang logo riêng.</p>
  <label class="check"><input type="checkbox" name="header_show_name" value="1"${s.header_show_name === '1' ? ' checked' : ''}> Hiện chữ tên website cạnh logo trên thanh đầu trang</label>
  <div class="grid2">
    <label>Màu chủ đạo<input name="theme_color" type="color" value="${h(s.theme_color)}"></label>
    <label>Số audio mỗi trang<input name="per_page" type="number" min="5" max="100" value="${h(s.per_page)}"></label>
  </div>
  <label>Chữ ở chân trang<input name="footer_text" value="${h(s.footer_text)}"></label>

  <h2>Bình luận & đăng nhập Google</h2>
  <label class="check"><input type="checkbox" name="comments_enabled" value="1"${s.comments_enabled === '1' ? ' checked' : ''}> Bật bình luận</label>
  <label class="check"><input type="checkbox" name="comment_moderation" value="1"${s.comment_moderation === '1' ? ' checked' : ''}> Duyệt <b>tất cả</b> bình luận trước khi hiện</label>
  <label>Bộ lọc từ (mỗi dòng một từ hoặc cụm từ)<textarea name="comment_words" rows="8" spellcheck="false">${h(s.comment_words)}</textarea>
    <small class="muted">Khi tắt "Duyệt tất cả": bình luận hiện ngay, trừ bình luận chứa từ trong danh sách này hoặc có link sẽ phải chờ bạn duyệt.
    Không phân biệt hoa thường, bắt cả khi chèn dấu chấm/cách (đ.m, l o n). Từ viết <b>không dấu</b> bắt mọi cách viết (dm bắt cả đm, Đ.M); từ <b>có dấu</b> chỉ bắt đúng dấu đó.</small></label>
  <label>Dung lượng tối đa ảnh đại diện người dùng tải lên (MB)<input name="avatar_max_mb" inputmode="decimal" value="${h(s.avatar_max_mb)}">
    <small class="muted">Ảnh được tự cắt vuông và nén còn khoảng 20–50KB trước khi lưu.</small></label>
  <label>Google Client ID<input name="google_client_id" value="${h(s.google_client_id)}" placeholder="123456789-xxxx.apps.googleusercontent.com">
    <small class="muted">Tạo tại console.cloud.google.com → APIs &amp; Services → Credentials → OAuth client ID (Web). Xem hướng dẫn trong README.</small></label>

  <h2>Múi giờ</h2>
  <label>Múi giờ của web (mốc 0h làm mới nhiệm vụ, giới hạn mỗi ngày, thống kê "hôm nay")
    <select name="tz_offset" class="sel">${[[-12,'Đảo Baker'],[-11,'Samoa thuộc Mỹ'],[-10,'Hawaii'],[-9,'Alaska'],[-8,'Los Angeles (PST)'],[-7,'Denver'],[-6,'Chicago, Mexico City'],[-5,'New York, Toronto'],[-4,'Santiago, Caracas'],[-3,'São Paulo, Buenos Aires'],[-2,'Nam Georgia'],[-1,'Azores'],[0,'London, Lisbon (UTC)'],[1,'Paris, Berlin, Rome'],[2,'Athens, Cairo, Kyiv'],[3,'Moskva, Istanbul, Riyadh'],[3.5,'Tehran'],[4,'Dubai'],[4.5,'Kabul'],[5,'Karachi, Tashkent'],[5.5,'Ấn Độ (New Delhi)'],[5.75,'Kathmandu'],[6,'Dhaka, Almaty'],[6.5,'Yangon (Myanmar)'],[7,'Hồ Chí Minh, Hà Nội, Bangkok, Jakarta'],[8,'Bắc Kinh, Singapore, Đài Bắc, Perth'],[9,'Tokyo, Seoul'],[9.5,'Adelaide'],[10,'Sydney, Melbourne'],[11,'Quần đảo Solomon'],[12,'Auckland, Fiji'],[13,'Tonga'],[14,'Kiribati']].map(([v, l]) => { const g = v === 0 ? 'GMT' : 'GMT' + (v > 0 ? '+' : '−') + (Math.abs(v) % 1 ? `${Math.floor(Math.abs(v))}:${String(Math.round(Math.abs(v) % 1 * 60)).padStart(2, '0')}` : Math.abs(v)); return `<option value="${v}"${String(v) === String(s.tz_offset ?? '7') ? ' selected' : ''}>(${g}) ${l}</option>`; }).join('')}</select></label>

  <h2>Tu luyện (cấp độ, Linh Thạch)</h2>
  <div class="grid2">
    <label>EXP lên cấp (cấp N cần N × số này, tính lại từ 0 mỗi cấp)<input name="level_base_exp" inputmode="numeric" value="${h(s.level_base_exp)}"></label>
    <label>Điểm danh: Linh Thạch<input name="checkin_stones" inputmode="numeric" value="${h(s.checkin_stones)}"></label>
    <label>Điểm danh: EXP<input name="checkin_exp" inputmode="numeric" value="${h(s.checkin_exp)}"></label>
    <label>Phải online bao lâu mới điểm danh được (giây)<input name="checkin_wait" inputmode="numeric" value="${h(s.checkin_wait)}"></label>
    <label>EXP mỗi bình luận được duyệt<input name="comment_exp" inputmode="numeric" value="${h(s.comment_exp)}"></label>
    <label>Số truyện/ngày được cộng EXP bình luận (mỗi truyện 1 lần)<input name="comment_exp_daily" inputmode="numeric" value="${h(s.comment_exp_daily)}"></label>
    <label>Số truyện được đánh giá mỗi ngày<input name="rate_daily" inputmode="numeric" value="${h(s.rate_daily)}"></label>
    <label>Đánh giá: Linh Thạch mỗi truyện<input name="rate_stones" inputmode="numeric" value="${h(s.rate_stones)}"></label>
    <label>Đánh giá: EXP mỗi truyện<input name="rate_exp" inputmode="numeric" value="${h(s.rate_exp)}"></label>
    <label>Thả tim: Linh Thạch mỗi truyện<input name="heart_stones" inputmode="numeric" value="${h(s.heart_stones)}"></label>
    <label>Thả tim: EXP mỗi truyện<input name="heart_exp" inputmode="numeric" value="${h(s.heart_exp)}"></label>
    <label>Số truyện được thả tim mỗi ngày<input name="heart_daily" inputmode="numeric" value="${h(s.heart_daily)}"></label>
    <label>Số lượt thả tim bình luận mỗi ngày<input name="comment_like_daily" inputmode="numeric" value="${h(s.comment_like_daily)}"></label>
    <label>Giới thiệu bạn bè: % hoa hồng cho người mời<input name="ref_rate" inputmode="decimal" value="${h(s.ref_rate)}"></label>
  </div>
  <h3>Thưởng Linh Thạch mỗi lần lên cấp</h3>
  <p class="muted">Mỗi dòng: lên tới cấp nào thì mỗi lần lên cấp được thưởng bao nhiêu. Vd. "đến cấp 5: 200" nghĩa là lên cấp 2, 3, 4, 5 mỗi lần +200.</p>
  ${(tiers => [...tiers, {}, {}].slice(0, Math.max(5, tiers.length + 1)).map((t, i) => `<div class="grid2">
    <label>${i ? `Từ cấp ${(tiers[i - 1] || {}).lvl ? tiers[i - 1].lvl + 1 : '…'} đến cấp` : 'Từ cấp 2 đến cấp'}<input name="lu_lvl" inputmode="numeric" value="${t.lvl || ''}" placeholder="vd. 70"></label>
    <label>Linh Thạch mỗi lần lên cấp<input name="lu_stones" inputmode="numeric" value="${t.lvl ? t.stones : ''}"></label>
  </div>`).join(''))(parseLevelTiers(s.levelup_tiers))}

  <h2>Rút Linh Thạch</h2>
  <label class="check"><input type="checkbox" name="withdraw_enabled" value="1"${s.withdraw_enabled !== '0' ? ' checked' : ''}> Cho phép rút Linh Thạch</label>
  <div class="grid2">
    <label>Tỷ giá: 1 Linh Thạch = ? đồng<input name="withdraw_rate" inputmode="decimal" value="${h(s.withdraw_rate)}"></label>
    <label>Rút tối thiểu (Linh Thạch)<input name="withdraw_min" inputmode="numeric" value="${h(s.withdraw_min)}"></label>
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

export function passwordView(s, err, tf = {}) {
  const key = s.admin_totp_pending ? s.admin_totp_pending.replace(/(.{4})/g, '$1 ').trim() : '';
  const twofa = s.admin_totp
    ? `<p><em class="pill ok">Đang bật</em> Đăng nhập cần mật khẩu + mã 6 số trong ứng dụng xác thực. Còn <b>${tf.recoveryLeft || 0}</b> mã dự phòng.</p>
      <form method="post" class="form" data-confirm="Tắt xác thực 2 bước sẽ làm tài khoản kém an toàn hơn. Tiếp tục?"><input type="hidden" name="action" value="2fa_off">
        <div class="grid2"><label>Mật khẩu hiện tại<input name="old" type="password" required autocomplete="current-password"></label>
        <label>Mã 6 số hiện tại<input name="code" inputmode="numeric" maxlength="6" required></label></div>
        <button class="btn ghost danger-txt">Tắt xác thực 2 bước</button></form>`
    : s.admin_totp_pending
      ? `<ol class="steps">
          <li>Cài ứng dụng <b>Google Authenticator</b>, <b>Microsoft Authenticator</b> hoặc <b>Authy</b> trên điện thoại.</li>
          <li>Trong ứng dụng chọn <b>Thêm tài khoản → Nhập khóa thiết lập</b> (hoặc mở link bên dưới trên điện thoại):
            <div class="totp-key" data-copy="${h(s.admin_totp_pending)}" title="Bấm để sao chép">${h(key)}</div>
            <a class="btn ghost" href="${h(tf.pendingUri)}">Mở trong ứng dụng xác thực</a></li>
          <li>Nhập mã 6 số ứng dụng hiện ra để xác nhận:</li></ol>
        <form method="post" class="form"><input type="hidden" name="action" value="2fa_confirm">
          <label>Mã 6 số<input name="code" inputmode="numeric" maxlength="6" required autocomplete="one-time-code"></label>
          <button class="btn">Xác nhận và bật</button></form>`
      : `<p class="muted">Kể cả khi lộ mật khẩu, kẻ gian vẫn không vào được nếu không có điện thoại của bạn. <b>Rất nên bật.</b></p>
        <form method="post"><input type="hidden" name="action" value="2fa_start"><button class="btn">Bật xác thực 2 bước</button></form>`;
  return `<h1>Tài khoản quản trị</h1>
${err ? `<div class="flash err">${h(err)}</div>` : ''}
<div class="card narrow" id="twofa"><h2>🔐 Xác thực 2 bước</h2>${twofa}</div>
<form method="post" class="form card narrow">
  <h2>Đổi tên đăng nhập / mật khẩu</h2>
  <label>Tên đăng nhập<input name="user" value="${h(s.admin_user)}" autocomplete="username"></label>
  <label>Mật khẩu hiện tại<input name="old" type="password" required autocomplete="current-password"></label>
  <label>Mật khẩu mới (ít nhất 10 ký tự, có chữ và số)<input name="new" type="password" required minlength="10" autocomplete="new-password"></label>
  <label>Nhập lại mật khẩu mới<input name="new2" type="password" required minlength="10" autocomplete="new-password"></label>
  <div class="row-actions"><button class="btn" type="submit">Lưu</button></div>
</form>`;
}

export function recoveryView(codes) {
  return `<h1>Mã dự phòng</h1>
<div class="card narrow">
  <p><b>Lưu 8 mã này ở nơi an toàn</b> (chụp màn hình, ghi giấy). Mỗi mã dùng được <b>1 lần</b> thay cho mã 6 số khi bạn mất điện thoại. Mã chỉ hiện <b>một lần duy nhất</b>.</p>
  <div class="recovery">${codes.map(c => `<code>${h(c.slice(0, 4))}-${h(c.slice(4))}</code>`).join('')}</div>
  <p class="row-actions"><a class="btn" href="${ADMIN}/password">Tôi đã lưu xong</a></p>
</div>`;
}

// ---------- Bảo mật ----------

export function securityView({ stats, logs, blocked, myIp, s = {}, logins = [], proxy = {}, mail = {} }) {
  const by = Object.fromEntries(stats.map(r => [r.event, r]));
  const stat = (k, label) => `<div><b>${fmtInt(by[k]?.n || 0)}</b><span>${label} (${by[k]?.ips || 0} IP)</span></div>`;
  const label = e => EVENT_LABELS[e] || e;
  const bad = e => !['login_ok'].includes(e);
  const blockForm = (ip, reason = '') => `<form method="post" data-confirm="Chặn IP ${h(ip)}?"><input type="hidden" name="action" value="block">
    <input type="hidden" name="ip" value="${h(ip)}"><input type="hidden" name="reason" value="${h(reason)}"><input type="hidden" name="hours" value="0"><button>Chặn</button></form>`;
  return `
<h1>Bảo mật</h1>
<div class="grid2">
  <div class="card">
    <h2>🛡️ Mức bảo vệ hiện tại</h2>
    <ul class="sec-check">
      <li class="${s.admin_totp ? 'ok' : 'bad'}">Xác thực 2 bước: ${s.admin_totp ? 'đang bật' : `<b>chưa bật</b> — <a href="${ADMIN}/password#twofa">bật ngay</a>`}</li>
      <li class="${s.admin_bind_device !== '0' ? 'ok' : 'bad'}">Phiên đăng nhập gắn với thiết bị: ${s.admin_bind_device !== '0' ? 'bật' : 'tắt'}</li>
      <li class="${s.admin_ip_allow ? 'ok' : 'warn'}">Giới hạn IP vào trang quản trị: ${s.admin_ip_allow ? 'bật' : 'không giới hạn'}</li>
      <li class="ok">Đường dẫn quản trị riêng, ẩn khỏi bot tìm kiếm (noindex)</li>
      <li class="ok">Khóa đăng nhập khi sai nhiều lần, tự chặn IP dò quét</li>
      <li class="ok">Chống giả mạo form (CSRF), cookie HttpOnly + Secure + SameSite=Strict, chặn nhúng iframe, CSP</li>
    </ul>
  </div>
  <form method="post" class="form card"><input type="hidden" name="action" value="access">
    <h2>🌐 Giới hạn truy cập</h2>
    <label>Chỉ cho các IP này vào trang quản trị (mỗi dòng một IP; kết thúc bằng dấu chấm/hai chấm để cho cả dải, vd. <code>113.161.</code>)
      <textarea name="admin_ip_allow" rows="4" placeholder="Để trống = không giới hạn">${h(s.admin_ip_allow || '')}</textarea></label>
    <small class="muted">IP hiện tại của bạn: <b>${h(myIp)}</b>. Mạng 4G đổi IP thường xuyên — chỉ dùng khi bạn có IP cố định. IP lạ sẽ thấy trang 404 như không tồn tại.</small>
    <label class="check"><input type="checkbox" name="admin_bind_device" value="1"${s.admin_bind_device !== '0' ? ' checked' : ''}> Gắn phiên đăng nhập với thiết bị (cookie bị lấy cắp đem sang máy khác sẽ vô hiệu)</label>
    <div class="row-actions"><button class="btn">Lưu</button></div>
  </form>
</div>
<form method="post" class="form card"><input type="hidden" name="action" value="antifake">
  <h2>🧬 Chống tài khoản ảo / clone</h2>
  <div class="grid2">
    <label>Số tài khoản tối đa được tạo từ một IP (0 = không giới hạn)<input name="reg_per_ip" inputmode="numeric" value="${h(s.reg_per_ip ?? '2')}"></label>
    <label>Khóa API proxycheck.io ${proxy.hasKey ? `<em class="pill ok">Đã cài${proxy.fromEnv ? ' (biến môi trường)' : ''}</em>` : '<em class="pill">Chưa có</em>'}
      <input name="proxycheck_key" type="password" autocomplete="off"${proxy.fromEnv ? ' disabled' : ''} placeholder="${proxy.fromEnv ? 'Khóa cứng bằng biến môi trường Cloudflare' : proxy.hasKey ? 'Đã lưu — để trống nếu không đổi' : 'Dán khóa API vào đây'}"></label>
  </div>
  <label class="check"><input type="checkbox" name="reg_block_proxy" value="1"${s.reg_block_proxy !== '0' ? ' checked' : ''}> Chặn tạo tài khoản mới khi dùng VPN / Proxy / máy chủ ảo / WARP</label>
  ${(c => c ? `<div class="ipcheck"><b>Kiểm tra IP hiện tại của bạn</b> (${h(myIp)}): nhà mạng <b>${h(c.org || '?')}</b> (ASN ${c.asn || '?'})
    · Lớp 1 (nhà mạng): ${c.host ? '<em class="st st-bad">Bị chặn — máy chủ ảo / VPN</em>' : '<em class="st st-ok">Bình thường</em>'}
    · Lớp 2 (proxycheck.io): ${!proxy.hasKey ? '<em class="st st-warn">Chưa có khóa</em>' : c.pc && c.pc.error ? `<em class="st st-warn">Lỗi: ${h(c.pc.error)}</em>` : c.pc && c.pc.proxy ? `<em class="st st-bad">${h(c.pc.type || 'Proxy')} — bị chặn</em>` : '<em class="st st-ok">Bình thường</em>'}
    <br><small class="muted">Mẹo: bật VPN rồi tải lại trang này để xem web có nhận ra VPN không.</small></div>` : '')(proxy.myCheck)}
  ${proxy.hasKey && !proxy.fromEnv ? '<label class="check"><input type="checkbox" name="proxycheck_clear" value="1"> Xóa khóa API đã lưu</label>' : ''}
  <div class="confirm-box"><b>🔒 Xác nhận khi đổi / xóa khóa</b><small class="muted">Chỉ cần điền khi đổi, xóa khóa hoặc tắt chặn VPN.</small>
    <div class="grid2"><label>Mật khẩu admin<input name="confirm_pass" type="password" autocomplete="current-password"></label>
    ${s.admin_totp ? '<label>Mã 2 bước<input name="confirm_code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>' : ''}</div></div>
  <small class="muted">Khóa API được lưu ẩn phía máy chủ, không bao giờ hiện lại trên trang hay gửi xuống trình duyệt. Chỉ kiểm tra khi <b>tạo tài khoản mới</b> (người cũ đăng nhập không bị ảnh hưởng); kết quả mỗi IP lưu 7 ngày để tiết kiệm lượt gọi; nếu proxycheck.io lỗi/hết lượt thì cho đăng ký bình thường.
  Lưu ý: nhà mạng 4G có thể cho nhiều người dùng chung 1 IP — nếu thấy người dùng thật bị chặn, tăng giới hạn lên 3–5.</small>
  <div class="row-actions"><button class="btn">Lưu</button></div>
</form>

<form method="post" class="form card"><input type="hidden" name="action" value="mail">
  <h2>📧 Gửi email (Resend) — dùng cho "Quên mật khẩu"</h2>
  <div class="grid2">
    <label>Khóa API Resend ${mail.hasKey ? `<em class="pill ok">Đã cài${mail.fromEnv ? ' (biến môi trường)' : ''}</em>` : '<em class="pill">Chưa có</em>'}
      <input name="resend_key" type="password" autocomplete="off"${mail.fromEnv ? ' disabled' : ''} placeholder="${mail.fromEnv ? 'Khóa cứng bằng biến môi trường Cloudflare' : mail.hasKey ? 'Đã lưu — để trống nếu không đổi' : 're_xxxxxxxx'}"></label>
    <label>Địa chỉ gửi<input name="mail_from" value="${h(s.mail_from || '')}" placeholder="${h(mail.from || '')}"></label>
  </div>
  <label>Gửi email thử tới (không bắt buộc)<input name="test_to" type="email" placeholder="email-cua-ban@gmail.com"></label>
  ${mail.hasKey && !mail.fromEnv ? '<label class="check"><input type="checkbox" name="resend_clear" value="1"> Xóa khóa đã lưu</label>' : ''}
  <div class="confirm-box"><b>🔒 Xác nhận khi đổi / xóa khóa</b><small class="muted">Chỉ cần điền khi đổi, xóa khóa hoặc tắt chặn VPN.</small>
    <div class="grid2"><label>Mật khẩu admin<input name="confirm_pass" type="password" autocomplete="current-password"></label>
    ${s.admin_totp ? '<label>Mã 2 bước<input name="confirm_code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>' : ''}</div></div>
  <small class="muted">Khóa được lưu ẩn phía máy chủ, không hiện lại và không gửi xuống trình duyệt. Địa chỉ gửi phải thuộc <b>tên miền đã xác minh</b> trong Resend (Domains → Add domain → thêm các bản ghi DNS vào Cloudflare). Để trống "Địa chỉ gửi" sẽ dùng <code>${h(mail.from || '')}</code>.</small>
  <div class="row-actions"><button class="btn">Lưu</button></div>
</form>

<h2>Đăng nhập admin gần đây</h2>
<div class="table">${logins.map(l => `<div class="trow"><span class="tmain"><b>${vnDate(l.at, true)} · ${h(l.ip)}${l.country ? ' (' + h(l.country) + ')' : ''}${l.ip === myIp ? ' <em class="pill ok">bạn</em>' : ''}</b><small>${h(deviceOf(l.ua))} · ${h(l.detail || '')}</small></span></div>`).join('') || '<p class="muted pad">Chưa có.</p>'}</div>
<p class="muted">Thấy lần đăng nhập lạ? Bấm <b>Đăng xuất mọi thiết bị</b> bên dưới rồi đổi mật khẩu ngay.</p>

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
  <form method="post" class="inline-form" data-confirm="Xóa toàn bộ nhật ký?"><input type="hidden" name="action" value="clear_log">
    <input name="confirm_pass" type="password" placeholder="Mật khẩu admin" autocomplete="current-password" required>
    ${s.admin_totp ? '<input name="confirm_code" inputmode="numeric" maxlength="6" placeholder="Mã 2 bước" required>' : ''}
    <button class="btn ghost">Xóa nhật ký</button></form>
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

export function commentsView({ rows, count, status, page, per, banned, moderation, clientId, words }) {
  const tabs = [['pending', 'Chờ duyệt'], ['approved', 'Đã hiện'], ['hidden', 'Đã ẩn']];
  const total = count[status] || 0;
  const pages = Math.max(1, Math.ceil(total / per));
  const btn = (act, label, c, extra = '') => `<form method="post"${extra}><input type="hidden" name="action" value="${act}"><input type="hidden" name="id" value="${c.id}"><input type="hidden" name="user_id" value="${c.user_id}"><button>${label}</button></form>`;
  return `
<div class="bar"><h1>Bình luận</h1>
  ${status === 'pending' && total ? `<form method="post" data-confirm="Duyệt tất cả ${total} bình luận đang chờ?"><input type="hidden" name="action" value="approve_all"><button class="btn">Duyệt tất cả</button></form>` : ''}
</div>
${clientId ? '' : `<div class="flash err">Chưa nhập Google Client ID nên người nghe chưa đăng nhập được. Vào <a href="${ADMIN}/settings">Cài đặt & SEO</a> để nhập.</div>`}
<p class="muted">${moderation ? 'Đang bật duyệt tất cả: bình luận mới chỉ hiện sau khi bạn bấm Duyệt.' : `Bình luận hiện ngay, trừ bình luận có link hoặc chứa từ trong <a href="${ADMIN}/settings">bộ lọc từ</a>.`}</p>
<nav class="tabs-admin">${tabs.map(([k, l]) => `<a href="?status=${k}" class="${k === status ? 'on' : ''}">${l} (${count[k] || 0})</a>`).join('')}</nav>
<div class="table">
  ${rows.map(c => `<div class="trow crow">
    <span class="tmain"><b>${h(c.name)}${c.banned ? ' <em class="pill">Đã khóa</em>' : ''} <small>${h(c.email)}</small></b>
      <span class="cbody">${h(c.body)}</span>
      ${c.status === 'pending' ? (hits => hits.length ? `<small class="wf-hit">⚠ Chứa từ lọc: ${hits.map(h).join(', ')}</small>` : '')(matchWords(c.body, words)) : ''}
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
  withdraw: 'Yêu cầu rút Linh Thạch', role: 'Đổi vai trò', set_pass: 'Đặt lại mật khẩu', impersonate: 'Admin xem thử tài khoản', withdraw_refund: 'Hoàn Linh Thạch (từ chối rút)' };

const MI = {
  view: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
};
const micon = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${MI[k]}</svg>`;
const ago = t => {
  if (!t) return '—';
  const d = Math.floor(Date.now() / 1000) - t;
  if (d < 600) return '<b class="m-on">● Đang online</b>';
  if (d < 3600) return Math.floor(d / 60) + ' phút trước';
  if (d < 86400) return Math.floor(d / 3600) + ' giờ trước';
  if (d < 30 * 86400) return Math.floor(d / 86400) + ' ngày trước';
  return vnDate(t);
};

export function membersView({ rows, total, stats, q, sort, filter, page, per, sharedCount = {} }) {
  const pages = Math.max(1, Math.ceil(total / per));
  const params = { q, sort, f: filter, page };
  const qs = (o = {}) => '?' + new URLSearchParams({ ...params, ...o }).toString();
  const curQs = new URLSearchParams(params).toString();
  const rowAct = (u, a, icon, title, cls = '', confirm = '', blank = false) => `<form method="post" action="${ADMIN}/members/${u.id}"${blank ? ' target="_blank"' : ''}${confirm ? ` data-confirm="${h(confirm)}"` : ''}>
    <input type="hidden" name="action" value="${a}"><input type="hidden" name="from" value="list"><input type="hidden" name="qs" value="${h(curQs)}">
    <button class="mi ${cls}" title="${title}" aria-label="${title}">${micon(icon)}</button></form>`;
  const status = u => u.locked ? '<span class="st st-bad">Khóa tài khoản</span>' : u.banned ? '<span class="st st-warn">Khóa bình luận</span>' : '<span class="st st-ok">Hoạt động</span>';
  return `
<h1>Thành viên</h1>
<div class="stats">
  <div><b>${fmtInt(stats.total)}</b><span>thành viên · mới hôm nay <strong>${fmtInt(stats.today || 0)}</strong></span></div>
  <div><b class="m-on">${fmtInt(stats.online || 0)}</b><span>đang online (10 phút)</span></div>
  <div><b>${fmtInt(stats.active || 0)}</b><span>hoạt động 7 ngày</span></div>
  <div><b>${fmtInt(stats.stones)}</b><span>tổng Linh Thạch · ${fmtInt(stats.locked || 0)} bị khóa</span></div>
</div>
<nav class="tabs-admin">
  <a href="${ADMIN}/members" class="on">Tất cả thành viên</a>
  <a href="${ADMIN}/members?f=sameip">⚠️ Theo dõi cùng IP <b>${fmtInt(sharedCount.groups || 0)}</b> nhóm · ${fmtInt(sharedCount.accounts || 0)} tài khoản</a>
</nav>
<form method="get" class="bar">
  <input class="search" type="search" name="q" value="${h(q)}" placeholder="Tìm tên, email, ID hoặc IP...">
  <select name="sort" class="sel">${[['new', 'Mới đăng ký'], ['seen', 'Hoạt động gần đây'], ['exp', 'EXP cao nhất'], ['stones', 'Nhiều Linh Thạch'], ['login', 'Đăng nhập gần đây']].map(([k, l]) => `<option value="${k}"${k === sort ? ' selected' : ''}>${l}</option>`).join('')}</select>
  <select name="f" class="sel">${[['all', 'Tất cả'], ['online', 'Đang online'], ['today', 'Đăng ký hôm nay'], ['editor', 'Biên tập viên'], ['banned', 'Bị khóa bình luận'], ['locked', 'Bị khóa tài khoản']].map(([k, l]) => `<option value="${k}"${k === filter ? ' selected' : ''}>${l}</option>`).join('')}</select>
  <button class="btn ghost" type="submit">Lọc</button>
</form>

<form method="post" id="bulkForm" class="bulk-bar">
  <input type="hidden" name="qs" value="${h(curQs)}">
    <label class="check"><input type="checkbox" id="checkAll"> Chọn tất cả</label>
    <select name="action" class="sel">
      <option value="">— Thao tác với mục đã chọn —</option>
      <option value="lock">Khóa tài khoản</option><option value="unlock">Mở khóa tài khoản</option>
      <option value="ban">Khóa bình luận</option><option value="unban">Mở khóa bình luận</option>
      <option value="logout">Đăng xuất mọi thiết bị</option>
    </select>
    <button class="btn ghost" data-confirm="Áp dụng thao tác cho các thành viên đã chọn?">Áp dụng</button>
    <small class="muted">${fmtInt(total)} kết quả</small>
</form>
<div class="mtable-wrap">
  <div class="mtable">
    <div class="mt-head"><span></span><span>Thành viên</span><span>Ghi chú</span><span>Cấp độ</span><span>Linh Thạch</span><span>Đã rút</span><span>Trạng thái</span><span>IP · Thiết bị</span><span>Hoạt động</span><span>Thao tác</span></div>
    ${rows.map(u => `<div class="mt-row${u.locked ? ' is-locked' : ''}">
      <span class="mt-cb">${u.id === 1 ? '<span title="Tài khoản quản trị được bảo vệ">🔒</span>' : `<input type="checkbox" name="ids" value="${u.id}" form="bulkForm" aria-label="Chọn ${h(u.name)}">`}</span>
      <a class="mt-user" href="${ADMIN}/members/${u.id}">${memberAv(u, 36)}<span><b>${h(u.name)} <small>#${u.id}</small>${u.id === 1 ? ' <em class="st st-admin">Quản trị viên</em>' : ''}${u.role === 'editor' ? ' <em class="st st-editor">Biên tập viên</em>' : ''}</b><small>${h(u.email)}</small></span></a>
      <span class="mt-note" data-l="Ghi chú">${u.note ? h(u.note.length > 40 ? u.note.slice(0, 40) + '…' : u.note) : '<i>Không có</i>'}</span>
      <span data-l="Cấp độ">${realmTag(u.exp)}</span>
      <span class="mt-num" data-l="Linh Thạch"><b>${fmtInt(u.stones)}</b><small>${fmtInt(u.exp)} EXP</small></span>
      <span class="mt-num" data-l="Đã rút"><b class="mt-paid">${fmtInt(u.paid)}đ</b>${u.wd_pending ? '<small class="st-warn-t">1 yêu cầu chờ</small>' : ''}</span>
      <span data-l="Trạng thái">${status(u)}</span>
      <span class="mt-ip" data-l="IP · Thiết bị"><code>${h(u.last_ip || u.reg_ip || '—')}</code>${u.same_ip ? `<a class="st st-warn" href="${ADMIN}/members?q=${encodeURIComponent(u.reg_ip)}" title="Cùng IP đăng ký">+${u.same_ip} cùng IP</a>` : ''}<small>${h(u.device || 'Chưa rõ thiết bị')}${u.country ? ' · ' + h(u.country) : ''}</small></span>
      <span class="mt-time" data-l="Hoạt động"><span>${ago(u.last_seen || u.last_login)}</span><small>ĐK ${vnDate(u.created_at)}</small></span>
      <span class="mt-act">
        <a class="mi" href="${ADMIN}/members/${u.id}" title="Xem / sửa" aria-label="Xem / sửa">${micon('edit')}</a>
        ${u.id === 1 ? '' : u.locked ? '' : rowAct(u, 'impersonate', 'login', 'Đăng nhập vào tài khoản (xem thử)', 'mi-green', `Mở web dưới tài khoản ${u.name} ở chế độ xem thử (1 giờ, không thao tác được)?`, true)}
        ${u.id === 1 ? '' : u.locked ? rowAct(u, 'unlock', 'unlock', 'Mở khóa tài khoản', 'mi-green') : rowAct(u, 'lock', 'lock', 'Khóa tài khoản', 'mi-red', `Khóa tài khoản ${u.name}?`)}
        ${u.id === 1 ? '' : `<a class="mi mi-red" href="${ADMIN}/members/${u.id}#delete" title="Xóa tài khoản" aria-label="Xóa tài khoản">${micon('trash')}</a>`}
      </span>
    </div>`).join('') || '<p class="muted pad">Không có thành viên nào.</p>'}
  </div>
</div>
${pages > 1 ? `<nav class="pager">${Array.from({ length: pages }, (_, i) => i + 1).map(i => `<a class="${i === page ? 'on' : ''}" href="${qs({ page: i })}">${i}</a>`).join('')}</nav>` : ''}`;
}

// Danh sách theo dõi: nhóm tài khoản dùng chung IP.
export function sharedIpView({ groups, sharedCount, myIp }) {
  const status = u => u.locked ? '<span class="st st-bad">Khóa TK</span>' : u.banned ? '<span class="st st-warn">Khóa BL</span>' : '<span class="st st-ok">Hoạt động</span>';
  return `
<h1>Thành viên</h1>
<nav class="tabs-admin">
  <a href="${ADMIN}/members">Tất cả thành viên</a>
  <a href="${ADMIN}/members?f=sameip" class="on">⚠️ Theo dõi cùng IP <b>${fmtInt(sharedCount.groups || 0)}</b> nhóm · ${fmtInt(sharedCount.accounts || 0)} tài khoản</a>
</nav>
<p class="muted">Các tài khoản <b>đăng ký hoặc đăng nhập gần nhất từ cùng một IP</b> được tự động đưa vào đây. Có thể là một người tạo nhiều tài khoản (clone) để cày Linh Thạch — hoặc chỉ là người nhà / dùng chung wifi, mạng 4G. Hãy xem kỹ trước khi duyệt rút tiền.</p>
${groups.map(g => {
    const total = g.users.reduce((a, u) => a + (u.stones || 0), 0), paid = g.users.reduce((a, u) => a + (u.paid || 0), 0);
    const pending = g.users.some(u => u.wd_pending);
    const lockable = g.users.filter(u => u.id !== 1 && !u.locked);
    return `<div class="card ipg${pending ? ' ipg-hot' : ''}">
  <div class="ipg-head">
    <span><code>${h(g.ip)}</code> <b>${g.n} tài khoản</b>
      ${g.check ? (g.check.proxy ? `<em class="st st-bad">${h(g.check.type || 'Proxy')}</em>` : '<em class="st st-ok">IP thường</em>') : ''}
      ${g.check && g.check.provider ? `<small class="muted">${h(g.check.provider)}</small>` : ''}
      ${g.blocked ? '<em class="st st-bad">Đã chặn IP</em>' : ''}
      ${pending ? '<em class="st st-warn">Có yêu cầu rút đang chờ</em>' : ''}</span>
    <span class="ipg-sum">💎 ${fmtInt(total)} · đã rút ${fmtInt(paid)}đ</span>
  </div>
  <div class="ipg-users">${g.users.map(u => `<a class="ipg-u" href="${ADMIN}/members/${u.id}">${memberAv(u, 30)}
    <span><b>${h(u.name)} <small>#${u.id}</small></b><small>${h(u.email)} · ${h(u.device || '')}</small>
    <small>ĐK ${vnDate(u.created_at)} ${u.reg_ip === g.ip ? '(từ IP này)' : ''} · 💎 ${fmtInt(u.stones)} · rút ${fmtInt(u.paid)}đ${u.wd_pending ? ' · <b class="st-warn-t">đang chờ rút</b>' : ''}</small></span>
    ${status(u)}</a>`).join('')}</div>
  <div class="row-actions">
    ${lockable.length ? `<form method="post" action="${ADMIN}/members" data-confirm="Khóa ${lockable.length} tài khoản dùng IP ${h(g.ip)}?">
      <input type="hidden" name="action" value="lock"><input type="hidden" name="qs" value="f=sameip">
      ${lockable.map(u => `<input type="hidden" name="ids" value="${u.id}">`).join('')}<button class="btn ghost danger-txt">Khóa cả nhóm (${lockable.length})</button></form>` : ''}
    ${!g.blocked && g.ip !== myIp ? `<form method="post" action="${ADMIN}/security" data-confirm="Chặn IP ${h(g.ip)}? Mọi người dùng IP này sẽ không vào được web.">
      <input type="hidden" name="action" value="block"><input type="hidden" name="ip" value="${h(g.ip)}"><input type="hidden" name="reason" value="Nhiều tài khoản cùng IP"><input type="hidden" name="hours" value="0">
      <button class="btn ghost danger-txt">Chặn IP</button></form>` : ''}
  </div>
</div>`;
  }).join('') || '<p class="muted pad">Chưa có tài khoản nào dùng chung IP. 👍</p>'}`;
}

// Lịch sử EXP / Linh Thạch của thành viên (mọi nguồn: điểm danh, bình luận, đánh giá, lên cấp, rút, admin).
function walletSection(u, w) {
  const pages = Math.max(1, Math.ceil(w.total / w.per));
  const link = (o = {}) => `${ADMIN}/members/${u.id}?` + new URLSearchParams({ wk: w.kind, wp: 1, ...o }).toString() + '#wallet';
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtInt(Math.abs(n));
  const tab = (k, label) => `<a class="pill${w.kind === k ? ' on' : ''}" href="${link({ wk: k })}">${label}</a>`;
  const s = w.sum;
  return `
<h2 id="wallet">Lịch sử Kinh nghiệm & Linh Thạch</h2>
<div class="stats">
  <div><b>+${fmtInt(s.exp_in || 0)}</b><span>EXP đã nhận${s.exp_out ? ` · ${signed(s.exp_out)} bị trừ` : ''}</span></div>
  <div><b>+${fmtInt(s.st_in || 0)}</b><span>Linh Thạch đã nhận</span></div>
  <div><b>${signed(s.st_out || 0)}</b><span>Linh Thạch đã dùng / rút / bị trừ</span></div>
</div>
<p class="wl-tabs">${tab('', 'Tất cả')} ${tab('exp', 'Kinh nghiệm')} ${tab('stones', 'Linh Thạch')} <small class="muted">${fmtInt(w.total)} dòng</small></p>
<div class="table wl">${w.rows.map(r => `<div class="trow"><span class="tmain">
  <b><span class="wl-amt ${r.amount < 0 ? 'neg' : 'pos'}">${signed(r.amount)} ${r.kind === 'exp' ? 'EXP' : 'Linh Thạch'}</span> <small class="muted">→ còn ${fmtInt(r.balance)}</small></b>
  <small>${vnDate(r.created_at, true)}${r.note ? ' · ' + h(r.note) : ''}</small></span></div>`).join('') || '<p class="muted pad">Chưa có lịch sử.</p>'}</div>
${pages > 1 ? `<nav class="pager">${w.page > 1 ? `<a href="${link({ wp: w.page - 1 })}">‹ Mới hơn</a>` : ''}<span class="muted">Trang ${w.page}/${pages}</span>${w.page < pages ? `<a href="${link({ wp: w.page + 1 })}">Cũ hơn ›</a>` : ''}</nav>` : ''}`;
}

export function memberView({ u, comments, logs, counts, myIp, wallet }) {
  const L = levelInfo(u.exp);
  const act = (a, label, cls = 'btn ghost', confirm = '') => `<form method="post"${confirm ? ` data-confirm="${h(confirm)}"` : ''}><input type="hidden" name="action" value="${a}"><button class="${cls}">${label}</button></form>`;
  const ipRow = (label, ip) => `<dt>${label}</dt><dd>${ip ? `${h(ip)}${ip !== myIp ? ` <form method="post" class="inline-form" data-confirm="Chặn IP ${h(ip)}?"><input type="hidden" name="action" value="block_ip"><input type="hidden" name="ip" value="${h(ip)}"><button class="link-danger">Chặn IP</button></form>` : ' <small class="muted">(IP của bạn)</small>'}` : '—'}</dd>`;
  return `
<p><a href="${ADMIN}/members">← Danh sách thành viên</a></p>
<div class="card mhead">
  ${memberAv(u, 72)}
  <div><h1>${h(u.name)} <small class="muted">#${u.id}</small>${u.id === 1 ? ' <em class="st st-admin">Quản trị viên</em>' : ''}${u.role === 'editor' ? ' <em class="st st-editor">Biên tập viên</em>' : ''}</h1>
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
    <h2>💎 Linh Thạch <small class="muted">· hiện có ${fmtInt(u.stones)}</small></h2>
    <label>Số lượng<input name="amount" inputmode="numeric" placeholder="Ví dụ: 100" required></label>
    <label>Lý do (thành viên sẽ thấy trong thông báo)<input name="reason" placeholder="Thưởng sự kiện..."></label>
    <div class="row-actions pm-btns">
      <button class="btn" name="dir" value="add">＋ Cộng Linh Thạch</button>
      <button class="btn ghost danger-txt" name="dir" value="sub">－ Trừ Linh Thạch</button>
    </div>
  </form>
  <form method="post" class="form card"><input type="hidden" name="action" value="exp">
    <h2>⭐ EXP <small class="muted">· hiện có ${fmtInt(u.exp)}</small></h2>
    <label>Số lượng<input name="amount" inputmode="numeric" placeholder="Ví dụ: 500" required></label>
    <label>Lý do<input name="reason" placeholder="Bù EXP do lỗi..."></label>
    <div class="row-actions pm-btns">
      <button class="btn" name="dir" value="add">＋ Cộng EXP</button>
      <button class="btn ghost danger-txt" name="dir" value="sub">－ Trừ EXP</button>
    </div>
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
    <dt>Được mời bởi</dt><dd>${u.referred_by ? `<a href="${ADMIN}/members/${u.referred_by}">#${u.referred_by}</a> · đã tạo ${fmtInt(u.ref_given || 0)} 💎 hoa hồng` : '—'}</dd>
    <dt>Đã mời</dt><dd>${fmtInt(counts.invited || 0)} người · nhận ${fmtInt(u.ref_earned || 0)} 💎 hoa hồng${counts.invited ? ` · <a href="${ADMIN}/members?q=ref:${u.id}">xem danh sách</a>` : ''}</dd>
    <dt>Cùng IP</dt><dd>${counts.same_ip ? `<a href="${ADMIN}/members?q=${encodeURIComponent(u.reg_ip || u.last_ip)}">${counts.same_ip} tài khoản khác</a> <small class="muted">(có thể là clone, hoặc chung mạng di động)</small>` : 'Không có'}</dd>
  </dl>
  <div class="row-actions"><button class="btn">Lưu</button></div>
</form>

<div class="card">
  <h2>Mật khẩu & đăng nhập</h2>
  <p class="muted">${String(u.sub || '').startsWith('email:') ? 'Thành viên đăng ký bằng <b>email + mật khẩu</b>.' : 'Thành viên đăng nhập bằng <b>Google</b>' + (u.pass_hash ? ' (có thêm mật khẩu email).' : '.')} Mật khẩu được mã hóa, không ai xem được. Khi thành viên quên mật khẩu, bạn đặt mật khẩu mới rồi báo cho họ:</p>
  <form method="post" class="inline-form pass-form"><input type="hidden" name="action" value="set_pass">
    <input name="new_pass" type="text" autocomplete="off" minlength="8" placeholder="Mật khẩu mới (≥ 8 ký tự, có chữ và số)" required>
    <button class="btn ghost">Đặt mật khẩu mới</button></form>
  <div class="row-actions">
    <form method="post" class="inline-form"><input type="hidden" name="action" value="role">
      <select name="role" class="sel"><option value="">Vai trò: Thành viên</option><option value="editor"${u.role === 'editor' ? ' selected' : ''}>Vai trò: Biên tập viên (đăng audio)</option></select>
      <button class="btn ghost">Lưu vai trò</button></form>
    <form method="post" target="_blank"><input type="hidden" name="action" value="impersonate"><button class="btn ghost">Đăng nhập vào tài khoản (xem thử)</button></form>
    ${act('logout', 'Đăng xuất mọi thiết bị', 'btn ghost', 'Đăng xuất thành viên này khỏi mọi thiết bị?')}
    ${u.id === 1 ? '' : u.locked ? act('unlock', 'Mở khóa tài khoản', 'btn') : act('lock', 'Khóa tài khoản', 'btn ghost danger-txt', 'Khóa tài khoản này? Thành viên sẽ không đăng nhập được.')}
    ${u.id === 1 ? '' : u.banned ? act('unban', 'Mở khóa bình luận', 'btn ghost') : act('ban', 'Khóa bình luận', 'btn ghost danger-txt', 'Khóa bình luận và ẩn mọi bình luận của thành viên này?')}
    ${u.avatar ? act('avatar_reset', 'Bỏ ảnh đại diện', 'btn ghost', 'Bỏ ảnh đại diện của thành viên này?') : ''}
  </div>
</div>

${walletSection(u, wallet)}

<h2>Nhật ký thay đổi</h2>
<div class="table">${logs.map(l => `<div class="trow"><span class="tmain"><b>${h(ACTION_LABELS[l.action] || l.action)}${l.amount ? ` ${l.amount > 0 ? '+' : ''}${fmtInt(l.amount)}`.replace('+-', '-') : ''}</b>
  <small>${vnDate(l.created_at, true)}${l.note ? ' · ' + h(l.note) : ''}</small></span></div>`).join('') || '<p class="muted pad">Chưa có thay đổi nào.</p>'}</div>

<h2>Bình luận gần đây</h2>
<div class="table">${comments.map(c => `<div class="trow crow"><span class="tmain"><span class="cbody">${h(c.body)}</span>
  <small>${vnDate(c.created_at, true)} · ${{ approved: 'Đã hiện', pending: 'Chờ duyệt', hidden: 'Đã ẩn' }[c.status] || c.status} · ${c.likes} thích · ${c.slug ? `<a href="/track/${h(c.slug)}#comments" target="_blank">${h(c.title)}</a>` : 'audio đã xóa'}</small></span></div>`).join('') || '<p class="muted pad">Chưa bình luận.</p>'}</div>

${u.id === 1 ? '<p class="muted">🔒 Đây là tài khoản quản trị mặc định (#1): không thể xóa, khóa hay khóa bình luận.</p>' : `<form method="post" class="form card danger-zone" id="delete" data-confirm="Xóa vĩnh viễn tài khoản này cùng toàn bộ bình luận, đánh giá, lịch sử?">
  <input type="hidden" name="action" value="delete">
  <h2>Xóa tài khoản</h2>
  <p class="muted">Xóa vĩnh viễn thành viên cùng bình luận, lượt thích, đánh giá, lịch sử nghe. Không thể hoàn tác.</p>
  <label>Gõ <b>XOA</b> để xác nhận<input name="confirm" autocomplete="off"></label>
  <div class="row-actions"><button class="btn danger-btn">Xóa tài khoản</button></div>
</form>`}`;
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

// ---------- Nhiệm vụ ----------

export function questsView({ quests, counts, listen, comment, s }) {
  const fields = (q = {}) => `
    <label>Tên nhiệm vụ<input name="title" value="${h(q.title || '')}" maxlength="80" placeholder="Mở quảng cáo TikTok" required></label>
    <label>Link mở khi bấm<input name="url" value="${h(q.url || '')}" placeholder="https://vt.tiktok.com/..." inputmode="url"></label>
    <div class="grid3">
      <label>Linh Thạch thưởng<input name="stones" inputmode="numeric" value="${q.stones ?? 5}"></label>
      <label>EXP thưởng<input name="exp" inputmode="numeric" value="${q.exp ?? 0}"></label>
      <label>Thứ tự<input name="pos" inputmode="numeric" value="${q.pos ?? 0}"></label>
    </div>
    <label class="check"><input type="checkbox" name="active" value="1"${q.active === 0 ? '' : ' checked'}> Đang bật</label>`;
  return `
<h1>Nhiệm vụ</h1>
<p class="muted">Mọi nhiệm vụ làm được <b>1 lần mỗi ngày</b>, tự làm mới lúc 0h (giờ Việt Nam). Thưởng được ghi vào lịch sử Linh Thạch / EXP của thành viên.</p>

<form method="post" class="form card"><input type="hidden" name="action" value="listen">
  <h2>🎧 Nghe audio</h2>
  <label class="check"><input type="checkbox" name="listen_quest_enabled" value="1"${listen.on ? ' checked' : ''}> Bật nhiệm vụ nghe audio</label>
  <p class="muted">Mỗi dòng là một mốc trong ngày (vd. nghe đủ 20 phút +10 Linh Thạch, đủ 30 phút +15 Linh Thạch). Để trống số phút để bỏ mốc đó.</p>
  ${[...listen.tiers, {}, {}].slice(0, Math.max(3, listen.tiers.length + 1)).map(t => `<div class="grid3 tier">
    <label>Nghe đủ (phút)<input name="t_min" inputmode="numeric" value="${t.min || ''}" placeholder="vd. 45"></label>
    <label>Linh Thạch thưởng<input name="t_stones" inputmode="numeric" value="${t.min ? t.stones : ''}"></label>
    <label>EXP thưởng<input name="t_exp" inputmode="numeric" value="${t.min ? t.exp : ''}"></label>
  </div>${t.min ? `<small class="muted">Hôm nay ${fmtInt(counts[100000 + t.min] || 0)} người đạt mốc ${t.min} phút.</small>` : ''}`).join('')}
  <small class="muted">Tính theo thời gian thật đang phát (nghe 1.5× hay 2× vẫn cần đủ số phút đồng hồ); tua, tạm dừng không được cộng. Máy chủ kiểm tra lại để chống gửi khống.</small>
  <div class="row-actions"><button class="btn">Lưu</button></div>
</form>

<form method="post" class="form card"><input type="hidden" name="action" value="comment">
  <h2>💬 Bình luận hợp lệ</h2>
  <label class="check"><input type="checkbox" name="comment_quest_enabled" value="1"${comment.enabled ? ' checked' : ''}> Bật nhiệm vụ bình luận</label>
  <label>Linh Thạch thưởng (1 lần mỗi ngày, làm mới lúc 0h)<input name="comment_quest_stones" inputmode="numeric" value="${comment.stones}"></label>
  <small class="muted">Thưởng cho bình luận <b>được hiện</b> đầu tiên trong ngày (bình luận bị bộ lọc giữ lại thì nhận khi bạn duyệt). EXP bình luận vẫn tính riêng theo Cài đặt. Hôm nay đã có <b>${fmtInt(counts[-1] || 0)}</b> người hoàn thành.</small>
  <div class="row-actions"><button class="btn">Lưu</button></div>
</form>

<h2>🔗 Nhiệm vụ mở link</h2>
<p class="muted">Thành viên bấm <b>Mở</b> → mở link trong tab mới và nhận thưởng ngay. Nhiệm vụ chưa có link sẽ không hiện cho thành viên.</p>
${quests.map(q => `<form method="post" class="form card">
  <input type="hidden" name="action" value="save"><input type="hidden" name="id" value="${q.id}">
  <p>${q.active && q.url ? '<em class="pill ok">Đang hiện</em>' : '<em class="pill">Đang ẩn</em>'} <small class="muted">Hôm nay: ${fmtInt(counts[q.id] || 0)} lượt hoàn thành</small></p>
  ${fields(q)}
  <div class="row-actions"><button class="btn">Lưu</button>
    <button class="btn ghost danger-txt" name="action" value="delete" formnovalidate data-confirm="Xóa nhiệm vụ ${h(q.title)}?">Xóa</button></div>
</form>`).join('')}
<form method="post" class="form card"><input type="hidden" name="action" value="add">
  <h2>➕ Thêm nhiệm vụ mở link</h2>
  ${fields()}
  <div class="row-actions"><button class="btn">Thêm</button></div>
</form>

<form method="post" class="form card"><input type="hidden" name="action" value="promax">
  <h2>🚀 Nhiệm vụ Promax</h2>
  <p class="muted">Luôn nằm cuối trang Nhiệm vụ, hiện cả với khách chưa đăng nhập. Chỉ có nút mở link, <b>không cộng Linh Thạch</b>.</p>
  <label class="check"><input type="checkbox" name="promax_enabled" value="1"${s.promax_enabled !== '0' ? ' checked' : ''}> Hiện nhiệm vụ Promax</label>
  <label>Tiêu đề<input name="promax_title" value="${h(s.promax_title)}" maxlength="120"></label>
  <label>Mô tả<textarea name="promax_desc" rows="3" maxlength="600">${h(s.promax_desc)}</textarea></label>
  <div class="grid2">
    <label>Link<input name="promax_url" value="${h(s.promax_url)}" inputmode="url"></label>
    <label>Chữ trên nút<input name="promax_button" value="${h(s.promax_button)}" maxlength="40"></label>
  </div>
  <div class="row-actions"><button class="btn">Lưu</button></div>
</form>`;
}

// ---------- Cửa hàng ----------

export function shopView({ items, sold, vipCount = 0 }) {
  const fxSelect = cur => `<select name="fx">${Object.entries(NAME_FX).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${h(v[0])}</option>`).join('')}</select>`;
  const fields = (i = {}) => `
    <label>Tên gói<input name="name" value="${h(i.name || '')}" maxlength="60" placeholder="vd. Hỏa Diệm 30 ngày" required></label>
    <label>Hiệu ứng${fxSelect(i.fx)}</label>
    <div class="grid3">
      <label>Giá (Linh Thạch)<input name="price" inputmode="numeric" value="${i.price ?? 500}"></label>
      <label>Số ngày (0 = vĩnh viễn)<input name="days" inputmode="numeric" value="${i.days ?? 30}"></label>
      <label>Thứ tự<input name="pos" inputmode="numeric" value="${i.pos ?? 0}"></label>
    </div>
    <label class="check"><input type="checkbox" name="active" value="1"${i.active === 0 ? '' : ' checked'}> Đang bán</label>`;
  const fxItems = items.filter(i => i.kind === 'fx'), frames = items.filter(i => i.kind === 'frame'), vips = items.filter(i => i.kind === 'vip');
  const vipFields = (i = {}) => `
    <label>Tên gói<input name="name" value="${h(i.name || 'Promax VIP 7 ngày')}" maxlength="60" required></label>
    <div class="grid3">
      <label>Giá (Linh Thạch)<input name="price" inputmode="numeric" value="${i.price ?? 5000}"></label>
      <label>Số ngày VIP<input name="days" inputmode="numeric" value="${i.days || 7}"></label>
      <label>Thứ tự<input name="pos" inputmode="numeric" value="${i.pos ?? 0}"></label>
    </div>
    <label class="check"><input type="checkbox" name="active" value="1"${i.active === 0 ? '' : ' checked'}> Đang bán</label>`;
  const frameFields = (i = {}) => `
    <div class="fr-box">
      <div class="fr-prev" style="--fs:${i.scale || 160}%"><span class="fr-av"></span>${i.img ? `<img src="${h(i.img)}" alt="">` : ''}</div>
      <div class="fr-ctl">
        <label class="btn ghost">Chọn ảnh khung…<input type="file" class="frame-file" accept=".png,.webp,image/png,image/webp" hidden></label>
        <small class="muted fr-info">PNG / WebP nền trong suốt, khung tròn ở giữa ảnh (ảnh vuông đẹp nhất).</small>
        <input type="hidden" name="frame_data">
      </div>
    </div>
    <label>Tên khung<input name="name" value="${h(i.name || '')}" maxlength="60" placeholder="vd. Băng Long" required></label>
    <div class="grid3">
      <label>Giá (Linh Thạch)<input name="price" inputmode="numeric" value="${i.price ?? 1000}"></label>
      <label>Số ngày (0 = vĩnh viễn)<input name="days" inputmode="numeric" value="${i.days ?? 30}"></label>
      <label>Thứ tự<input name="pos" inputmode="numeric" value="${i.pos ?? 0}"></label>
    </div>
    <label>Cỡ khung so với avatar (%) — chỉnh đến khi vòng khung ôm vừa avatar ở ô xem trước<input name="scale" class="fr-scale" type="number" min="100" max="300" step="5" value="${i.scale || 160}"></label>
    <label class="check"><input type="checkbox" name="active" value="1"${i.active === 0 ? '' : ' checked'}> Đang bán</label>`;
  return `
<h1>Cửa hàng</h1>
<p class="muted">Thành viên đổi Linh Thạch lấy <b>hiệu ứng tên</b> (chữ đa sắc chạy từ phải qua trái) hiện ở bình luận, bảng xếp hạng và thẻ tài khoản. Mua gói có hạn nhiều lần sẽ cộng dồn ngày; gói vĩnh viễn chỉ mua được 1 lần. Máy chủ trừ Linh Thạch có điều kiện đủ số dư → bấm mua dồn dập không bị trừ sai.</p>
<div class="card"><h2>Các hiệu ứng có sẵn</h2><div class="fx-demo">${Object.entries(NAME_FX).map(([k, v]) => `<span class="nfx nfx-${k}">${h(v[0])}</span>`).join('')}</div></div>
<h2>👑 Gói Promax VIP</h2>
<p class="muted">Quyền lợi trong thời hạn gói: <b>bỏ quảng cáo</b> toàn web, <b>tích xanh</b> khi bình luận / trang cá nhân / bảng xếp hạng, <b>x2 EXP</b> mọi nhiệm vụ, <b>x2 Linh Thạch</b> kiếm được (điểm danh, nhiệm vụ, đánh giá, thả tim, thưởng đột phá). Không nhân đôi khi admin cộng tay và hoa hồng giới thiệu. Mua thêm = cộng dồn ngày. Hiện đang có <b>${fmtInt(vipCount)}</b> người dùng VIP.</p>
${vips.map(i => `<form method="post" class="form card">
  <input type="hidden" name="action" value="vip_save"><input type="hidden" name="id" value="${i.id}">
  <p>${i.active ? '<em class="pill ok">Đang bán</em>' : '<em class="pill">Đang ẩn</em>'} <small class="muted">Đã bán: ${fmtInt(i.sold || 0)} lượt</small></p>
  ${vipFields(i)}
  <div class="row-actions"><button class="btn">Lưu</button>
    <button class="btn ghost danger-txt" name="action" value="delete" formnovalidate data-confirm="Xóa gói ${h(i.name)}? (người đã mua vẫn giữ VIP đến hết hạn)">Xóa</button></div>
</form>`).join('')}
<form method="post" class="form card"><input type="hidden" name="action" value="vip_add">
  <h2>➕ Thêm gói VIP</h2>
  ${vipFields()}
  <div class="row-actions"><button class="btn">Thêm</button></div>
</form>

<h2>🖼️ Khung avatar</h2>
<p class="muted">Tải ảnh khung lên, đặt tên, giá và thời hạn. Khung hiện quanh avatar ở bình luận, bảng xếp hạng và thẻ tài khoản.</p>
${frames.map(i => `<form method="post" class="form card">
  <input type="hidden" name="action" value="frame_save"><input type="hidden" name="id" value="${i.id}">
  <p>${i.active ? '<em class="pill ok">Đang bán</em>' : '<em class="pill">Đang ẩn</em>'} <small class="muted">Đã bán: ${fmtInt(i.sold || 0)} lượt · ${fmtInt(sold['f' + i.id] || 0)} người sở hữu</small></p>
  ${frameFields(i)}
  <div class="row-actions"><button class="btn">Lưu</button>
    <button class="btn ghost danger-txt" name="action" value="delete" formnovalidate data-confirm="Xóa khung ${h(i.name)}? (người đã mua vẫn giữ đến hết hạn)">Xóa</button></div>
</form>`).join('')}
<form method="post" class="form card"><input type="hidden" name="action" value="frame_add">
  <h2>➕ Thêm khung avatar</h2>
  ${frameFields()}
  <div class="row-actions"><button class="btn">Thêm</button></div>
</form>

<h2>✨ Hiệu ứng tên</h2>
${fxItems.map(i => `<form method="post" class="form card">
  <input type="hidden" name="action" value="save"><input type="hidden" name="id" value="${i.id}">
  <p>${i.active ? '<em class="pill ok">Đang bán</em>' : '<em class="pill">Đang ẩn</em>'} <span class="nfx nfx-${h(i.fx)} fx-big">${h(i.name)}</span> <small class="muted">Đã bán: ${fmtInt(i.sold || 0)} lượt · ${fmtInt(sold[i.fx] || 0)} người sở hữu hiệu ứng này</small></p>
  ${fields(i)}
  <div class="row-actions"><button class="btn">Lưu</button>
    <button class="btn ghost danger-txt" name="action" value="delete" formnovalidate data-confirm="Xóa gói ${h(i.name)}? (người đã mua vẫn giữ hiệu ứng)">Xóa</button></div>
</form>`).join('')}
<form method="post" class="form card"><input type="hidden" name="action" value="add">
  <h2>➕ Thêm gói hiệu ứng tên</h2>
  ${fields()}
  <div class="row-actions"><button class="btn">Thêm</button></div>
</form>`;
}

// ---------- Tổng quan ----------

const ICONS = {
  users: '<path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="4"/><path d="M22 19v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  live: '<path d="M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4"/><circle cx="12" cy="12" r="2"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M12 21 8 9l4-6 4 6z"/>',
  quest: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v2h6V3M9 13l2 2 4-4"/>',
  level: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/><path d="M8 11h8M8 14h5"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 9h-6a3 3 0 0 0 0 6h6z"/>',
  paid: '<path d="M22 7 13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/>',
};

export function overviewView({ users, wallet, cmt, wd, listening }) {
  const money = n => fmtInt(n) + 'đ';
  const card = (color, icon, label, value, subs = [], href = '') => `<${href ? `a href="${href}"` : 'div'} class="ov-card ov-${color}">
    <div><span class="ov-label">${label}</span><b class="ov-value">${value}</b>${subs.map(x => `<small>${x}</small>`).join('')}</div>
    <span class="ov-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg></span>
  </${href ? 'a' : 'div'}>`;
  return `
<h1>Tổng quan</h1>
<p class="muted">Số liệu thành viên, Linh Thạch, bình luận và yêu cầu rút tiền.</p>
<div class="ov-grid">
  ${card('blue', 'users', 'Thành viên', fmtInt(users.total || 0), [`Đăng ký mới hôm nay: <b>${fmtInt(users.today || 0)}</b>`], `${ADMIN}/members`)}
  ${card('green', 'live', 'Đang nghe', fmtInt(listening), ['Cả khách và thành viên, trong vài phút qua'])}
  ${card('indigo', 'gem', 'Tổng Linh Thạch hệ thống', fmtInt(users.stones || 0), [`Trong ví của ${fmtInt(users.holders || 0)} thành viên`])}
  ${card('purple', 'quest', 'Linh Thạch từ nhiệm vụ', fmtInt(wallet.quest), [`Hôm nay: +${fmtInt(wallet.quest_today)}`, 'Điểm danh, nghe audio, bình luận, mở link'], `${ADMIN}/quests`)}
  ${card('orange', 'level', 'Linh Thạch từ lên cấp', fmtInt(wallet.level), [`Hôm nay: +${fmtInt(wallet.level_today)}`])}
  ${card('red', 'comment', 'Bình luận cần duyệt', fmtInt(cmt.pending || 0), [`Bình luận hôm nay: ${fmtInt(cmt.today || 0)} · Tổng: ${fmtInt(cmt.total || 0)}`], `${ADMIN}/comments?status=pending`)}
  ${card('teal', 'wallet', 'Yêu cầu rút tiền', fmtInt(wd.total || 0), [`Chờ duyệt: <b>${fmtInt(wd.pending || 0)}</b> · ${money(wd.pending_vnd)}`, `Hôm nay: ${fmtInt(wd.today || 0)} yêu cầu`], `${ADMIN}/withdrawals`)}
  ${card('emerald', 'paid', 'Đã rút thành công', money(wd.paid_vnd), [`${fmtInt(wd.paid || 0)} lần chuyển`], `${ADMIN}/withdrawals?status=paid`)}
</div>
<p class="muted"><small>Linh Thạch từ nhiệm vụ / lên cấp được tính từ khi có lịch sử Linh Thạch (các bản cập nhật gần đây).</small></p>`;
}
