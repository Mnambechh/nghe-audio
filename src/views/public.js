// Giao diện người nghe.
import { h, jsonScript, fmtTime, fmtNum, fmtInt, vnDate } from '../util.js';
import { fxOf, frameOf } from '../shop.js';
import { vipActive } from '../game.js';
const VIP_TICK = '<svg class="vtick" viewBox="0 0 24 24" role="img" aria-label="Đã xác thực Promax VIP"><title>Promax VIP</title><circle cx="12" cy="12" r="11" fill="#1877f2"/><path fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="square" stroke-linejoin="miter" d="M7.3 12.4l3.2 3.2 6.2-6.4"/></svg>';

export const ASSET_V = '92';
const asset = f => `/assets/${f}?v=${ASSET_V}`;
const abs = (origin, u) => (!u || /^https?:\/\//i.test(u) ? u : origin + u);

const ICON_HEADPHONES = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h2v-7H5v-2a7 7 0 0 1 14 0v2h-2v7h2a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"/></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24"><path d="M12.3 2a10 10 0 1 0 9.6 13A8 8 0 0 1 12.3 2z"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';

// Chỉ giữ các thẻ hợp lệ trong <head> (script, style, noscript, meta, link).
// Chữ thường dán nhầm vào ô này sẽ bị bỏ, tránh hiện lên đầu trang.
function safeHeadCode(code) {
  const m = String(code || '').match(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>|<(meta|link|base)\b[^>]*>/gi);
  return m ? m.join('\n') : '';
}

// ---------- Khung trang ----------

/**
 * ctx: { s (settings), origin, pages (footer), ads, q }
 * meta: { title, desc, canonical, ogType }
 */
export function layout(ctx, meta, body) {
  const s = ctx.s;
  const title = meta.title || s.seo_title;
  const desc = meta.desc || s.seo_description;
  const canonical = meta.canonical || ctx.origin + '/';
  const favicon = s.favicon || s.logo;

  let adConfig = null;
  if (s.ad_enabled === '1' && ctx.ads && ctx.ads.length) {
    const hours = Math.max(0.1, parseFloat(s.ad_interval_hours) || 6);
    adConfig = {
      hours,
      every: s.ad_mode === 'every', // mỗi lần bấm phát đều hiện quảng cáo
      message: s.ad_message,
      button: s.ad_button,
      note: s.ad_note.replace('{hours}', String(hours).replace('.', ',')),
      ads: ctx.ads,
    };
  }

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${h(title)}</title>
<meta name="description" content="${h(desc)}">
${(meta.keywords || s.seo_keywords) ? `<meta name="keywords" content="${h(meta.keywords || s.seo_keywords)}">` : ''}
<link rel="canonical" href="${h(canonical)}">
${meta.noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">'}
<meta property="og:locale" content="vi_VN">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${h(title)}">
<meta name="twitter:description" content="${h(desc)}">
${meta.extraHead || ''}
<meta name="theme-color" content="#FFF6F0">
<meta property="og:type" content="${meta.ogType || 'website'}">
<meta property="og:site_name" content="${h(s.site_name)}">
<meta property="og:title" content="${h(title)}">
<meta property="og:description" content="${h(desc)}">
<meta property="og:url" content="${h(canonical)}">
${meta.image ? `<meta property="og:image" content="${h(meta.image)}">
<meta name="twitter:image" content="${h(meta.image)}">` : s.logo ? `<meta property="og:image" content="${h(abs(ctx.origin, s.logo))}">` : ''}
${favicon ? `<link rel="icon" href="${h(favicon)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Mali:wght@500;600;700&family=Quicksand:wght@500;600;700&display=swap" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Mali:wght@500;600;700&family=Quicksand:wght@500;600;700&display=swap"></noscript>
<link rel="stylesheet" href="${asset('app.css')}">
<style>:root{--brand:${h(s.theme_color)}}</style>
${safeHeadCode(s.head_code)}
</head>
<body>
<header class="topbar">
  <a class="brand" href="/" aria-label="${h(s.site_name)}" title="${h(s.site_name)}">
    ${s.logo ? `<img src="${h(s.logo)}" alt="" height="34">` : '<span class="brand-dot"></span>'}
    ${s.header_show_name === '1' ? `<span>${h(s.site_name)}</span>` : ''}
  </a>
  <nav class="top-nav">
  <a href="/" data-nav="/"><svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>Trang chủ</a>
  <a href="/cua-hang" data-nav="/cua-hang">🛍️ Cửa hàng</a>
  <a href="/nhiem-vu" data-nav="/nhiem-vu">📜 Nhiệm vụ kiếm Linh Thạch</a>
  <a href="/rut-linh-thach" data-nav="/rut-linh-thach">💎 Rút Linh Thạch</a>
  <a href="/gioi-thieu" data-nav="/gioi-thieu">🤝 Giới thiệu bạn bè</a>
  <a href="/bang-xep-hang" data-nav="/bang-xep-hang">🏆 Bảng xếp hạng</a>
  <a href="/huong-dan" data-nav="/huong-dan">📖 Hướng dẫn</a>
  </nav>
  <span class="top-right">
    <a class="top-search" href="/#search" aria-label="Tìm kiếm">${ICON_SEARCH}</a>
    <span class="acct" id="acct">${ctx.authed ? '<span class="acct-ph" aria-hidden="true"><i class="ph-bell"></i><i class="ph-av"></i></span>' : '<button class="btn-login" type="button" data-act="login">Đăng nhập</button>'}</span>
    <button class="menu-btn" type="button" data-act="menu" aria-label="Menu" aria-controls="mainmenu"><svg viewBox="0 0 24 24"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg></button>
  </span>
</header>
<nav class="main-menu" id="mainmenu" hidden>
  <a href="/" data-nav="/"><svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>Trang chủ</a>
  <a href="/cua-hang" data-nav="/cua-hang">🛍️ Cửa hàng</a>
  <a href="/nhiem-vu" data-nav="/nhiem-vu">📜 Nhiệm vụ kiếm Linh Thạch</a>
  <a href="/rut-linh-thach" data-nav="/rut-linh-thach">💎 Rút Linh Thạch</a>
  <a href="/gioi-thieu" data-nav="/gioi-thieu">🤝 Giới thiệu bạn bè</a>
  <a href="/bang-xep-hang" data-nav="/bang-xep-hang">🏆 Bảng xếp hạng</a>
  <a href="/huong-dan" data-nav="/huong-dan">📖 Hướng dẫn tích Linh Thạch</a>
</nav>
<main id="main" data-title="${h(title)}">
${body}
<footer class="footer">
  <nav>${(ctx.pages || []).map(p => `<a href="/trang/${h(p.slug)}">${h(p.title)}</a>`).join('')}</nav>
  <p>© ${new Date().getFullYear()} ${h(s.site_name)}. ${h(s.footer_text)}</p>
</footer>
</main>

<div id="player" class="player" hidden>
  <div class="pl-row">
    <button class="pl-info" type="button" data-act="expand" aria-label="Mở trình phát">
      <span class="eq"><i></i><i></i><i></i><i></i></span>
      <span class="pl-text"><b class="pl-title"></b><small class="pl-sub"></small></span>
    </button>
    <button class="pl-icon wide-only" type="button" data-act="prev" aria-label="Tập trước"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg></button>
    <button class="pl-btn pl-play" type="button" data-act="toggle" aria-label="Phát / Tạm dừng"></button>
    <button class="pl-icon wide-only" type="button" data-act="next" aria-label="Tập sau"><svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg></button>
    <button class="pl-speed" type="button" data-act="speed" aria-label="Tốc độ nghe"><span class="speed-val">1.5×</span></button>
    <button class="pl-moon" type="button" data-act="timer-pop" aria-label="Hẹn giờ tắt">${ICON_MOON}</button>
  </div>
  <div class="pl-seek">
    <span class="t-cur">0:00</span>
    <input type="range" class="seek-range" min="0" max="1000" value="0" step="1" aria-label="Tua">
    <span class="t-dur">0:00</span>
  </div>
  <div class="timer-pop" id="timerpop" hidden>
    <p>Hẹn giờ đi ngủ</p>
    <div class="timer-grid">
      <button type="button" data-timer="15">15 phút</button>
      <button type="button" data-timer="30">30 phút</button>
      <button type="button" data-timer="45">45 phút</button>
      <button type="button" data-timer="60">60 phút</button>
      <button type="button" data-timer="end">Hết tập này</button>
      <button type="button" data-timer="off">Tắt hẹn giờ</button>
    </div>
  </div>
</div>

<div id="sheet" class="sheet" hidden>
  <div class="sheet-panel" role="dialog" aria-label="Trình phát">
    <button class="sheet-grip" type="button" data-act="collapse" aria-label="Thu nhỏ"><span></span></button>
    <div class="sheet-art"><span class="eq big"><i></i><i></i><i></i><i></i><i></i></span></div>
    <h2 class="sheet-title"></h2>
    <p class="sheet-sub"></p>
    <div class="seek">
      <input type="range" class="seek-range" min="0" max="1000" value="0" step="1" aria-label="Tua">
      <div class="seek-time"><span class="t-cur">0:00</span><span class="t-dur">0:00</span></div>
    </div>
    <div class="controls">
      <button class="c-btn" type="button" data-act="prev" aria-label="Phần trước"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg></button>
      <button class="c-btn" type="button" data-act="back" aria-label="Lùi 15 giây"><svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16.5" text-anchor="middle" font-size="7" font-weight="700">15</text></svg></button>
      <button class="c-btn c-main pl-play" type="button" data-act="toggle" aria-label="Phát / Tạm dừng"></button>
      <button class="c-btn" type="button" data-act="fwd" aria-label="Tới 15 giây"><svg viewBox="0 0 24 24"><path d="M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16.5" text-anchor="middle" font-size="7" font-weight="700">15</text></svg></button>
      <button class="c-btn" type="button" data-act="next" aria-label="Phần sau"><svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg></button>
    </div>
    <div class="extras">
      <button class="chip" type="button" data-act="speed">Tốc độ <b class="speed-val">1.5×</b></button>
      <button class="chip" type="button" data-act="timer">${ICON_MOON} <span class="timer-val">Hẹn giờ</span></button>
    </div>
    <div class="timer-menu" hidden>
      <p>Hẹn giờ tắt</p>
      <div class="timer-grid">
        <button type="button" data-timer="15">15 phút</button>
        <button type="button" data-timer="30">30 phút</button>
        <button type="button" data-timer="45">45 phút</button>
        <button type="button" data-timer="60">60 phút</button>
        <button type="button" data-timer="90">90 phút</button>
        <button type="button" data-timer="end">Hết tập này</button>
        <button type="button" data-timer="off" class="wide">Tắt hẹn giờ</button>
      </div>
    </div>
    <button class="sheet-close" type="button" data-act="close">Đóng trình phát</button>
  </div>
</div>

<div id="unlockbox" class="modal" hidden>
  <div class="modal-box" role="dialog" aria-modal="true">
    <button class="modal-x" type="button" data-act="ul-close" aria-label="Đóng">${ICON_X}</button>
    <p class="ul-msg"></p>
    <a class="ul-card" target="_blank" rel="noopener sponsored nofollow" data-act="ul-go">
      <img alt="" loading="lazy">
      <span class="ul-meta"><span class="ul-title"></span><span><s class="ul-old"></s> <b class="ul-price"></b></span></span>
    </a>
    <a class="ul-btn" target="_blank" rel="noopener sponsored nofollow" data-act="ul-go"></a>
    <p class="ul-note"></p>
  </div>
</div>

<div id="loginbox" class="modal" hidden>
  <div class="modal-box login-box" role="dialog" aria-modal="true" aria-labelledby="login-title">
    <button class="modal-x" type="button" data-act="login-close" aria-label="Đóng">${ICON_X}</button>
    <h2 id="login-title">Đăng nhập</h2>
    <p>Đăng nhập để bình luận, thả tim, nhận Linh Thạch và lưu <b>lịch sử nghe</b> trên mọi thiết bị.</p>
    <div class="lg-tabs" role="tablist">
      <button type="button" class="on" data-lg="google" role="tab">Google</button>
      <button type="button" data-lg="login" role="tab">Email</button>
      <button type="button" data-lg="register" role="tab">Đăng ký</button>
    </div>
    <div class="lg-pane" data-pane="google">
      <div class="g-btn login-g"></div>
      <p class="login-note">Chúng tôi chỉ dùng tên và ảnh đại diện Google của bạn.</p>
    </div>
    <form class="lg-pane lg-form" data-pane="login" id="emailLogin" hidden>
      <label>Email<input name="email" type="email" autocomplete="email" required maxlength="120" placeholder="ban@gmail.com"></label>
      <label>Mật khẩu<input name="password" type="password" autocomplete="current-password" required maxlength="100"></label>
      <button class="btn-play" type="submit">Đăng nhập</button>
      <p class="login-note"><button type="button" class="link-btn" data-lg="forgot">Quên mật khẩu?</button> · Chưa có tài khoản? <button type="button" class="link-btn" data-lg="register">Đăng ký ngay</button></p>
    </form>
    <form class="lg-pane lg-form" data-pane="forgot" id="emailForgot" hidden>
      <p class="login-note">Nhập email đã đăng ký, chúng tôi sẽ gửi link đặt lại mật khẩu (hiệu lực 30 phút).</p>
      <label>Email<input name="email" type="email" autocomplete="email" required maxlength="120" placeholder="ban@gmail.com"></label>
      <button class="btn-play" type="submit">Gửi link đặt lại</button>
      <p class="login-note"><button type="button" class="link-btn" data-lg="login">← Quay lại đăng nhập</button></p>
    </form>
    <form class="lg-pane lg-form" data-pane="register" id="emailRegister" hidden>
      <label>Email<input name="email" type="email" autocomplete="email" required maxlength="120" placeholder="ban@gmail.com"></label>
      <label>Mật khẩu (ít nhất 8 ký tự, có chữ và số)<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="100"></label>
      <label>Nhập lại mật khẩu<input name="password2" type="password" autocomplete="new-password" required minlength="8" maxlength="100"></label>
      <label>Mã giới thiệu <small>(không bắt buộc)</small><input name="ref" autocomplete="off" maxlength="8" placeholder="Ví dụ: WzjWr2k6"></label>
      <button class="btn-play" type="submit">Tạo tài khoản</button>
      <p class="login-note">Đã có tài khoản? <button type="button" class="link-btn" data-lg="login">Đăng nhập</button></p>
    </form>
  </div>
</div>

<div id="toast" class="toast" hidden></div>
<div id="rewards" class="rewards" aria-live="polite"></div>
<audio id="audio" preload="metadata" playsinline webkit-playsinline x-webkit-airplay="allow"></audio>
<script>window.APP = ${jsonScript({ base: '', ad: adConfig, tz: parseFloat(s.tz_offset) || 7 })};</script>
<script src="${asset('app.js')}" defer></script>
</body>
</html>`;
}

// ---------- Thành phần ----------

function liveBadge(t) {
  const n = t.live || 0;
  return `<span class="live" data-live="${t.id}"${n ? '' : ' hidden'}><i></i><b>${n}</b> đang nghe</span>`;
}

function card(t, rank = null, views = null) {
  return `<a class="card${t.cover ? ' has-cover' : ''}" href="/track/${h(t.slug)}">`
    + (t.cover ? `<img class="card-cover" src="${h(t.cover)}" alt="" loading="lazy" decoding="async">` : '')
    + (rank !== null ? `<span class="rank r${rank}">${rank}</span>` : '')
    + `<span class="card-body"><b class="card-title">${h(t.title)}</b>`
    + (t.tag ? `<span class="tag">${h(t.tag)}</span>` : '')
    + `<span class="meta">${ICON_HEADPHONES}${fmtNum(views ?? t.views)} lượt nghe</span>`
    + liveBadge(t) + '</span></a>';
}

function row(t) {
  return `<a class="row" href="/track/${h(t.slug)}">`
    + `<span class="row-icon${t.cover ? ' has-cover' : ''}">${t.cover ? `<img src="${h(t.cover)}" alt="" loading="lazy" decoding="async">` : ''}${ICON_PLAY}</span>`
    + `<span class="row-body"><span class="row-head"><b>${h(t.title)}</b>${t.tag ? `<span class="tag">${h(t.tag)}</span>` : ''}</span>`
    + `<span class="row-meta"><span class="meta">${ICON_HEADPHONES}${fmtNum(t.views)} lượt nghe</span>${liveBadge(t)}</span></span>`
    + (t.duration > 0 ? `<span class="dur">${fmtTime(t.duration)}</span>` : '')
    + '</a>';
}

function shelf(title, body, extra = '') {
  return `<section class="shelf"><div class="shelf-head"><h2>${h(title)}</h2>${extra}`
    + '<span class="swipe-hint" aria-hidden="true">Vuốt <i>›</i><i>›</i></span>'
    + '<span class="arrows"><button type="button" data-scroll="-1" aria-label="Trước">‹</button>'
    + '<button type="button" data-scroll="1" aria-label="Sau">›</button></span></div>' + body + '</section>';
}

function rail(tracks, { ranked = false, periodKey = '', attrs = '' } = {}) {
  return `<div class="rail"${attrs}>` + tracks.map((t, i) => card(t, ranked ? i + 1 : null, periodKey ? t[periodKey] : null)).join('') + '</div>';
}

// Đánh giá 10 sao: lớp sao hồng phủ theo điểm trung bình; bấm sao để chấm (cần đăng nhập).
function ratingWidget(t) {
  const n = t.rating_count || 0;
  const avg = n ? t.rating_sum / n : 0;
  const pct = Math.round(avg * 10);
  return `<div class="rating" data-track="${t.id}">
    <div class="stars" style="--pct:${pct}%" role="group" aria-label="Đánh giá">
      ${Array.from({ length: 10 }, (_, i) => `<button type="button" data-star="${i + 1}" aria-label="${i + 1} sao">★</button>`).join('')}
    </div>
    <span class="rate-text">${n ? `${avg.toFixed(1).replace('.', ',')} (${pct}%) · ${n} đánh giá` : 'Chưa có đánh giá'}</span>
    <span class="rate-mine" hidden></span>
  </div>`;
}

// Ảnh đại diện kèm số cấp; huy hiệu cảnh giới nhiều màu.
export function lvAvatar(name, url, b, cls = 'c-av') {
  const img = url
    ? `<img class="${cls}" src="${h(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-n="${h(String(name || '?'))}">`
    : `<span class="${cls} av-letter">${h(Array.from(String(name || '?').trim())[0] || '?').toUpperCase()}</span>`;
  const f = frameOf(b);
  return `<span class="av-wrap t${b.tier}${f.frame ? ' has-frame' : ''}">${img}${f.frame ? `<img class="av-frame" src="${h(f.frame)}" alt="" loading="lazy" decoding="async" style="--fs:${f.fs}%">` : ''}<i class="lv t${b.tier} l${b.lvl}">${b.lvl}</i></span>`;
}
export const realmBadge = b => `<span class="realm t${b.tier}">${h(b.realm)}</span>`;

// Ô tìm kiếm lớn có gợi ý khi gõ.
function searchBox(q = '') {
  return `<form class="searchbox" action="/" method="get" role="search" autocomplete="off">
    ${ICON_SEARCH}
    <input id="search" type="search" name="q" value="${h(q)}" placeholder="Tìm audio..." aria-label="Tìm audio"
      autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" role="combobox" aria-expanded="false" aria-controls="suggest">
    <button type="button" class="sb-clear" aria-label="Xóa"${q ? '' : ' hidden'}>${ICON_X}</button>
    <div class="suggest" id="suggest" role="listbox" hidden></div>
  </form>`;
}

// ---------- Trang ----------

export function homePage(ctx, d) {
  const s = ctx.s;
  let body = '<div class="wrap">';
  if (d.q) {
    body += searchBox(d.q) + `<h1 class="h1 results-h">Kết quả cho “${h(d.q)}”</h1><p class="sub">${d.results.length} audio</p>`
      + `<div class="list">${d.results.map(row).join('')}</div>`
      + (d.results.length ? '' : '<p class="empty">Không tìm thấy audio nào. Thử từ khóa khác nhé.</p>');
  } else {
    if (d.page === 1) {
      body += `<h1 class="h1">Nghe gì hôm nay?</h1><p class="sub">${fmtInt(d.total)} audio · ${h(s.site_tagline)}</p>` + searchBox();
      if (d.latest.length) body += shelf('Mới cập nhật', rail(d.latest));
      if (d.hot.length) body += shelf('Đang nghe nhiều', rail(d.hot, { ranked: true }));
      if (d.top.month.length) {
        const tabs = '<span class="tabs" role="tablist"><button type="button" class="on" data-tab="day">Hôm nay</button>'
          + '<button type="button" data-tab="week">Tuần</button><button type="button" data-tab="month">Tháng</button></span>';
        const panes = ['day', 'week', 'month'].map(k => {
          const hid = k === 'day' ? '' : ' hidden';
          return d.top[k].length
            ? rail(d.top[k], { ranked: true, periodKey: 'period', attrs: ` data-pane="${k}"${hid}` })
            : `<p class="empty" data-pane="${k}"${hid}>Chưa có lượt nghe.</p>`;
        }).join('');
        body += shelf('Top lượt nghe', panes, tabs);
      }
    } else {
      body += searchBox();
    }
    body += '<section class="all"><h2 class="h2">Tất cả audio</h2>'
      + (d.all.length ? '' : '<p class="empty">Chưa có audio nào.</p>')
      + `<div class="list">${d.all.map(row).join('')}</div>`;
    if (d.pages > 1) {
      const prev = d.page > 1 ? `<a href="/${d.page > 2 ? '?page=' + (d.page - 1) : ''}">← Trước</a>` : '<span class="off">← Trước</span>';
      const next = d.page < d.pages ? `<a href="/?page=${d.page + 1}">Sau →</a>` : '<span class="off">Sau →</span>';
      body += `<nav class="pager">${prev}<span>Trang ${d.page}/${d.pages}</span>${next}</nav>`;
    }
    body += '</section>';
  }
  body += '</div>';
  return layout(ctx, {
    title: d.q ? `Tìm "${d.q}" - ${s.site_name}` : (d.page > 1 ? `${s.seo_title} - Trang ${d.page}` : s.seo_title),
    canonical: ctx.origin + (d.page > 1 && !d.q ? `/?page=${d.page}` : '/'),
  }, body);
}

export function trackPage(ctx, t, related) {
  const s = ctx.s;
  const plainDesc = t.description.replace(/\s+/g, ' ').trim();
  const mins = Math.max(1, Math.round((t.duration || 0) / 60));
  // SEO: ưu tiên nội dung admin nhập; để trống thì tự tạo câu mô tả tự nhiên, đủ từ khóa, dài ~150 ký tự.
  const cut = (x, n) => x.length <= n ? x : x.slice(0, x.lastIndexOf(' ', n - 1) > n * 0.6 ? x.lastIndexOf(' ', n - 1) : n - 1).replace(/[\s,.;:–-]+$/, '') + '…';
  const seoTitle = t.seo_title || `${t.title} - Nghe ${t.tag || 'Audio Full'} Miễn Phí | ${s.site_name}`;
  const desc = t.seo_desc || cut(plainDesc
    ? `${plainDesc}${/[.!?…]$/.test(plainDesc) ? '' : '.'} Nghe ${t.title} audio full miễn phí tại ${s.site_name}.`
    : `Nghe ${t.title} ${(t.tag || 'audio full').toLowerCase()} miễn phí${t.duration ? `, thời lượng ${mins} phút` : ''}, giọng đọc truyền cảm, nghe online mượt, không cần tài khoản tại ${s.site_name}.`, 160);
  const keywords = t.seo_keywords || [t.title, `nghe ${t.title}`, `${t.title} audio`, `${t.title} full`, t.tag, 'truyện audio', 'nghe truyện online'].filter(Boolean).join(', ');
  const canonical = `${ctx.origin}/track/${t.slug}`;
  const parts = t.parts.map((p, i) => ({ title: p.title || `Phần ${i + 1}`, url: p.url, duration: p.duration }));
  const data = { id: t.id, slug: t.slug, title: t.title, parts };
  const ld = {
    '@context': 'https://schema.org', '@type': 'AudioObject', name: t.title, description: desc, url: canonical, inLanguage: 'vi', keywords,
    ...(t.cover ? { image: ctx.origin + t.cover, thumbnailUrl: ctx.origin + t.cover } : {}),
    genre: t.tag || undefined, publisher: { '@type': 'Organization', name: s.site_name, url: ctx.origin },
    dateModified: new Date((t.updated_at || t.created_at) * 1000).toISOString(),
    uploadDate: new Date(t.created_at * 1000).toISOString(), duration: `PT${t.duration}S`, contentUrl: parts[0]?.url || '',
    interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ListenAction', userInteractionCount: t.views },
  };
  if (t.rating_count > 0) {
    ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: +(t.rating_sum / t.rating_count).toFixed(1), bestRating: 10, worstRating: 1, ratingCount: t.rating_count };
  }

  const body = `<div class="wrap narrow">
  <a class="back" href="/">← Trang chủ</a>
  <article class="hero">
    <div class="hero-art${t.cover ? ' has-cover' : ''}">
      ${t.cover ? `<img class="hero-cover" src="${h(t.cover)}" alt="${h(t.title)}" fetchpriority="high">` : ''}
      <span class="eq big"><i></i><i></i><i></i><i></i><i></i></span>
      ${t.duration > 0 ? `<span class="dur">${fmtTime(t.duration)}</span>` : ''}
    </div>
    <div class="hero-body">
      <h1>${h(t.title)}</h1>
      <div class="hero-meta">
        ${t.tag ? `<span class="tag">${h(t.tag)}</span>` : ''}
        <span class="meta">${ICON_HEADPHONES}${fmtNum(t.views)} lượt nghe</span>
        ${liveBadge(t)}
        <span class="meta">${vnDate(t.created_at)}</span>
      </div>
      ${ratingWidget(t)}
      <div class="hero-actions">
        <button class="btn-play" type="button" data-act="play-track" data-part="0"${parts.length ? '' : ' disabled'}>${ICON_PLAY}<span>Phát</span></button>
        <button class="btn-ghost" type="button" data-act="timer-open">${ICON_MOON} Hẹn giờ</button>
      </div>
      <p class="resume" hidden></p>
    </div>
  </article>
  ${plainDesc ? `<div class="desc"><b class="desc-label">VĂN ÁN:</b> ${h(t.description).replace(/\n/g, '<br>')}</div>` : ''}
  ${parts.length > 1 ? `<section><h2 class="h2">Danh sách phần (${parts.length})</h2><div class="parts">${parts.map((p, i) => `
    <button class="part" type="button" data-act="play-track" data-part="${i}">
      <span class="part-no">${i + 1}</span>
      <span class="part-body"><b>${h(p.title)}</b>${p.duration ? `<small>${fmtTime(p.duration)}</small>` : ''}</span>
      <span class="part-prog"><span></span></span>
    </button>`).join('')}</div></section>` : ''}
  <section class="heart-box" data-track="${t.id}">
    <p class="heart-title">Bắn tim nào!</p>
    <div class="heart-row">
      <button class="heart-btn" type="button" data-act="heart" aria-label="Bắn tim cho truyện"><svg viewBox="0 0 24 24"><path d="M12 21.4 10.6 20C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.5z"/></svg></button>
      <span class="heart-n">${fmtNum(t.hearts || 0)}</span>
    </div>
  </section>
  ${ctx.s.comments_enabled === '1' ? `<section class="comments" id="comments" data-track="${t.id}">
    <h2 class="h2">Bình luận <span class="c-count"></span></h2>
    <div class="c-compose"></div>
    <div class="c-list"><p class="c-note">Đang tải bình luận…</p></div>
  </section>` : ''}
  ${related.length ? shelf('Có lẽ bạn sẽ thích', rail(related)) : ''}
</div>
<script type="application/json" id="track-data">${jsonScript(data)}</script>
<script type="application/ld+json">${jsonScript(ld)}</script>`;

  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: s.site_name, item: ctx.origin + '/' },
    { '@type': 'ListItem', position: 2, name: t.title, item: canonical }] };
  const extraHead = `<meta property="og:audio" content="${h(parts[0] ? parts[0].url : '')}">
<meta property="article:published_time" content="${new Date(t.created_at * 1000).toISOString()}">
<meta property="article:modified_time" content="${new Date((t.updated_at || t.created_at) * 1000).toISOString()}">
<script type="application/ld+json">${jsonScript(crumbs)}</script>`;
  return layout(ctx, { title: seoTitle, desc, keywords, canonical, ogType: 'music.song', extraHead, image: t.cover ? ctx.origin + t.cover : '' }, body);
}

export function staticPage(ctx, p) {
  const desc = p.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  // Nội dung trang do admin soạn nên cho phép HTML.
  const body = `<div class="wrap narrow"><a class="back" href="/">← Trang chủ</a>
    <article class="prose"><h1 class="h1">${h(p.title)}</h1>${p.content}</article></div>`;
  return layout(ctx, { title: `${p.title} - ${ctx.s.site_name}`, desc, canonical: `${ctx.origin}/trang/${p.slug}` }, body);
}

export function notFoundPage(ctx) {
  const body = `<div class="wrap narrow center"><h1 class="h1">Không tìm thấy trang</h1>
    <p class="sub">Audio này có thể đã bị gỡ hoặc đường dẫn không đúng.</p>
    <p><a class="btn-play inline" href="/">Về trang chủ</a></p></div>`;
  return layout(ctx, { title: `Không tìm thấy - ${ctx.s.site_name}` }, body);
}

// Hướng dẫn tích Linh Thạch: mọi con số lấy từ cài đặt hiện tại của admin.
export function guidePage(ctx, g) {
  const n = v => fmtNum(v);
  const nf = v => Number(v || 0).toLocaleString('vi-VN');
  const gem = v => `<b class="gd-gem">+${nf(v)} 💎</b>`;
  const xp = v => `<b class="gd-exp">+${nf(v)} EXP</b>`;
  const rw = (st, ex) => [st ? gem(st) : '', ex ? xp(ex) : ''].filter(Boolean).join(' ') || '<span class="muted">không thưởng</span>';
  const mins = s => Math.max(1, Math.round(s / 60));
  const row = (icon, title, desc, reward) => `<div class="gd-row"><span class="gd-ico">${icon}</span><div><b>${title}</b><p>${desc}</p></div><div class="gd-rw">${reward}</div></div>`;
  const body = `<div class="wrap narrow guide"><a class="back" href="/">← Trang chủ</a>
    <h1 class="h1">Hướng dẫn tích Linh Thạch</h1>
    <p class="sub">Linh Thạch 💎 là phần thưởng khi bạn nghe truyện, làm nhiệm vụ và tu luyện lên cấp. Đủ số lượng có thể <a href="/rut-linh-thach">rút về ngân hàng / ví điện tử</a>.</p>

    <section class="gd-card">
      <h2>1. Bắt đầu</h2>
      <ol class="gd-steps">
        <li><b>Đăng nhập bằng Google</b> (nút Đăng nhập ở góc trên). Khách chưa đăng nhập vẫn nghe được nhưng không tích Linh Thạch.</li>
        <li>Vào <a href="/nhiem-vu">Nhiệm vụ</a> để xem tiến độ hôm nay.</li>
        <li>Mọi nhiệm vụ hằng ngày <b>làm mới lúc 0h</b> (giờ Việt Nam). Mỗi nhiệm vụ nhận <b>1 lần mỗi ngày</b>.</li>
      </ol>
    </section>

    <section class="gd-card">
      <h2>2. Nhiệm vụ hằng ngày</h2>
      ${row('🎁', 'Điểm danh', `Mở web đủ <b>${mins(g.checkinWait)} phút</b> trong ngày rồi bấm <b>Điểm danh</b>. Chỉ tính thời gian <b>đang mở trang web</b>: chuyển sang tab hoặc ứng dụng khác thì đồng hồ tạm dừng.`, rw(g.checkinStones, g.checkinExp))}
      ${g.listen ? g.listen.tiers.map(t => row('🎧', `Nghe audio ${t.min} phút`, `Nghe đủ <b>${t.min} phút</b> trong ngày. Tính theo thời gian thật đang phát: nghe 1.5× vẫn cần đủ ${t.min} phút đồng hồ; <b>tua, tạm dừng không được tính</b>. Đạt mốc là tự nhận thưởng.`, rw(t.stones, t.exp))).join('') : ''}
      ${g.comment ? row('💬', 'Bình luận hợp lệ', 'Bình luận đầu tiên <b>được hiện</b> trong ngày (làm mới lúc 0h, bình luận lại truyện cũ vẫn tính). Bình luận chứa từ ngữ không phù hợp hoặc link sẽ phải chờ duyệt, được duyệt mới nhận.', rw(g.comment.stones, 0)) : ''}
      ${g.links.map(q => row('🎯', h(q.title), 'Bấm nút <b>Mở</b> ở trang Nhiệm vụ để xem, nhận thưởng ngay.', rw(q.stones, q.exp))).join('')}
      <p class="gd-note">Tổng tối đa mỗi ngày từ nhiệm vụ: <b>${nf(g.dailyMax)} 💎</b>.</p>
    </section>

    <section class="gd-card">
      <h2>3. Kiếm EXP để lên cấp</h2>
      ${row('💬', 'Bình luận', `Mỗi <b>truyện khác nhau</b> được tính 1 lần / ngày (bình luận thêm ở cùng truyện không cộng EXP). Tối đa <b>${nf(g.cmtDaily)} truyện/ngày</b>.`, xp(g.cmtExp))}
      ${row('❤️', 'Thả tim truyện', `Bấm <b>Bắn tim</b> ở trang nghe, mỗi truyện 1 lần. Tối đa <b>${nf(g.heartDaily)} truyện/ngày</b>.`, rw(g.heartStones, g.heartExp))}
      ${row('⭐', 'Đánh giá truyện', `Chấm sao cho truyện, <b>mỗi truyện chỉ 1 lần duy nhất</b>. Tối đa <b>${nf(g.rateDaily)} truyện/ngày</b>.`, rw(g.rateStones, g.rateExp))}
      ${g.checkinExp ? row('🎁', 'Điểm danh', 'Mỗi ngày điểm danh.', xp(g.checkinExp)) : ''}
      <p class="gd-note">Cấp <b>N</b> cần <b>N × ${nf(g.base)} EXP</b> để lên cấp kế tiếp (tính lại từ 0 mỗi cấp). Ví dụ: cấp 1 → 2 cần ${nf(g.base)} EXP, cấp 2 → 3 cần ${nf(g.base * 2)} EXP, cấp 10 → 11 cần ${nf(g.base * 10)} EXP.</p>
    </section>

    <section class="gd-card">
      <h2>4. Thưởng Linh Thạch khi lên cấp</h2>
      <p>Mỗi lần đột phá lên một cấp mới bạn nhận Linh Thạch theo bảng sau (lên nhiều cấp một lúc thì cộng đủ từng cấp):</p>
      <div class="gd-table">
        <div class="gd-th"><span>Cấp đạt được</span><span>Cảnh giới</span><span>Thưởng mỗi cấp</span></div>
        ${g.levelTiers.map(t => `<div class="gd-tr"><span>Cấp ${t.from} → ${t.to}</span><span>${h(t.realmFrom)} → ${h(t.realmTo)}</span><span>${gem(t.stones)}</span></div>`).join('')}
      </div>
      <p class="gd-note">Tổng Linh Thạch nhận được từ cấp 1 lên cấp ${g.maxLevel}: <b>${nf(g.levelTotal)} 💎</b>.</p>
      <details class="gd-realms"><summary>Xem 70 cấp tu luyện và EXP cần</summary>
        <div class="gd-table small">
          <div class="gd-th"><span>Cấp</span><span>Cảnh giới</span><span>EXP lên cấp kế</span></div>
          ${g.levels.map(l => `<div class="gd-tr"><span>Cấp ${l.lvl}</span><span>${h(l.realm)}</span><span>${l.need ? nf(l.need) : 'Tối đa'}</span></div>`).join('')}
        </div>
      </details>
    </section>

    <section class="gd-card">
      <h2>5. Rút Linh Thạch</h2>
      <ul class="gd-steps">
        <li>Rút tối thiểu <b>${nf(g.wdMin)} Linh Thạch</b> mỗi lần, ${g.wdDaily ? `tối đa <b>${nf(g.wdDaily)} lần/ngày</b>` : 'không giới hạn số lần'}.</li>
        <li>Hỗ trợ: <b>${g.wdMethods}</b>. Thêm tài khoản nhận tiền tại trang <a href="/rut-linh-thach">Rút Linh Thạch</a>.</li>
        <li>Yêu cầu được admin duyệt thủ công. Nếu bị từ chối, Linh Thạch được <b>hoàn lại đầy đủ</b>.</li>
        ${g.wdEnabled ? '' : '<li><b>Chức năng rút đang tạm đóng.</b></li>'}
      </ul>
    </section>

    <section class="gd-card gd-warn">
      <h2>⚠️ Lưu ý</h2>
      <ul class="gd-steps">
        <li>Mỗi người chỉ dùng <b>một tài khoản</b>. Tạo nhiều tài khoản, dùng công cụ gian lận hoặc lợi dụng lỗi sẽ bị khóa tài khoản và hủy Linh Thạch.</li>
        <li>Phần thưởng có thể được điều chỉnh theo từng thời kỳ; số liệu trên trang này luôn là số hiện tại.</li>
      </ul>
    </section>
    ${g.promax ? `<a class="gd-promax" href="${h(g.promax.url)}" target="_blank" rel="noopener">🚀 <span><b>${h(g.promax.title)}</b><small>${h(g.promax.desc)}</small></span></a>` : ''}
  </div>`;
  return layout(ctx, { title: `Hướng dẫn tích Linh Thạch - ${ctx.s.site_name}`, canonical: ctx.origin + '/huong-dan' }, body);
}

export function referralPage(ctx) {
  const body = `<div class="wrap narrow"><a class="back" href="/">← Trang chủ</a>
    <h1 class="h1">Giới thiệu bạn bè</h1>
    <p class="sub">Mời bạn bè nghe truyện, nhận hoa hồng Linh Thạch mãi mãi</p>
    <div id="referral"><p class="c-note">Đang tải…</p></div></div>`;
  return layout(ctx, { title: `Giới thiệu bạn bè - ${ctx.s.site_name}`, canonical: ctx.origin + '/gioi-thieu', noindex: true }, body);
}

export function resetPage(ctx) {
  const body = `<div class="wrap narrow"><a class="back" href="/">← Trang chủ</a>
    <h1 class="h1">Đặt lại mật khẩu</h1>
    <form class="lg-form reset-form" id="resetForm">
      <label>Mật khẩu mới (ít nhất 8 ký tự, có chữ và số)<input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="100"></label>
      <label>Nhập lại mật khẩu mới<input name="password2" type="password" autocomplete="new-password" required minlength="8" maxlength="100"></label>
      <button class="btn-play" type="submit">Lưu mật khẩu mới</button>
    </form></div>`;
  return layout(ctx, { title: `Đặt lại mật khẩu - ${ctx.s.site_name}`, canonical: ctx.origin + '/dat-lai-mat-khau', noindex: true }, body);
}

export function notificationsPage(ctx) {
  const body = `<div class="wrap narrow"><a class="back" href="/">← Trang chủ</a>
    <h1 class="h1">Thông báo</h1>
    <div id="notif-detail"></div>
    <div id="notifs" class="nf-list"><p class="c-note">Đang tải…</p></div></div>`;
  return layout(ctx, { title: `Thông báo - ${ctx.s.site_name}`, canonical: ctx.origin + '/thong-bao', noindex: true }, body);
}

export function historyPage(ctx) {
  const body = `<div class="wrap narrow"><a class="back" href="/">← Trang chủ</a>
    <div class="bar-line"><h1 class="h1">Lịch sử nghe</h1><button type="button" class="link-btn" data-act="hist-clear" hidden>Xóa tất cả</button></div>
    <div id="history" class="list"><p class="c-note">Đang tải…</p></div></div>`;
  return layout(ctx, { title: `Lịch sử nghe - ${ctx.s.site_name}`, canonical: ctx.origin + '/lich-su', noindex: true }, body);
}

export function profilePage(ctx) {
  const body = `<div class="wrap narrow"><a class="back" href="/">← Trang chủ</a>
    <h1 class="h1">Thông tin tài khoản</h1>
    <div id="profile"><p class="c-note">Đang tải…</p></div></div>`;
  return layout(ctx, { title: `Tài khoản - ${ctx.s.site_name}`, canonical: ctx.origin + '/tai-khoan', noindex: true }, body);
}

const BOARD_INFO = {
  level: { tab: '⚡ Cấp độ', sub: 'TOP đạo hữu nhiều EXP nhất', val: r => `${fmtInt(r.exp)} EXP` },
  stones: { tab: '💎 Linh Thạch', sub: 'TOP đạo hữu nhiều Linh Thạch nhất', val: r => `${fmtInt(r.stones)} 💎` },
  comments: { tab: '💬 Bình luận', sub: 'TOP đạo hữu bình luận nhiều nhất', val: r => `${fmtInt(r.comments_n)} bình luận` },
  hearts: { tab: '❤️ Thả tim', sub: 'TOP đạo hữu được thả tim nhiều nhất khi bình luận', val: r => `${fmtInt(r.hearts)} tim` },
};
export function leaderboardPage(ctx, rows, kind = 'level') {
  const B = BOARD_INFO[kind] || BOARD_INFO.level;
  const body = `<div class="wrap narrow"><a class="back" href="/">← Trang chủ</a>
    <h1 class="h1">Bảng xếp hạng</h1>
    <nav class="lb-tabs">${Object.entries(BOARD_INFO).map(([k, v]) => `<a href="/bang-xep-hang${k === 'level' ? '' : '?top=' + k}" class="${k === kind ? 'on' : ''}">${v.tab}</a>`).join('')}</nav>
    <p class="sub">${B.sub} · cập nhật mỗi 5 phút</p>
    <div class="lb">${rows.map((r, i) => `<div class="lb-row${i < 3 ? ' top' + (i + 1) : ''}">
      <span class="lb-rank">${i + 1}</span>
      ${lvAvatar(r.name, r.avatar, r, 'lb-av')}
      <span class="lb-body"><span class="lb-name"><b${fxOf(r) ? ` class="nfx nfx-${fxOf(r)}"` : ''}>${h(r.name)}</b>${vipActive(r) ? VIP_TICK : ''}${realmBadge(r)}</span>
        <span class="meta">Cấp ${r.lvl} · ☆ ${fmtInt(r.exp)} EXP · 💬 ${fmtInt(r.comments_n)}</span></span>
      <b class="lb-val">${B.val(r)}</b>
    </div>`).join('') || '<p class="c-note">Chưa có ai trên bảng này. Đăng nhập, điểm danh, bình luận và thả tim để lên bảng!</p>'}</div></div>`;
  return layout(ctx, { title: `Bảng xếp hạng ${B.tab.replace(/^\S+\s/, '')} - ${ctx.s.site_name}`, canonical: ctx.origin + '/bang-xep-hang' + (kind === 'level' ? '' : '?top=' + kind) }, body);
}

// Nhiệm vụ Promax: luôn ở cuối trang, hiện cả khi chưa đăng nhập, chỉ mở link (không cộng Linh Thạch).
function promaxQuest(s) {
  if (s.promax_enabled === '0' || !/^https?:\/\//i.test(s.promax_url || '')) return '';
  return `<h2 class="h2">Nhiệm vụ Promax</h2>
    <div class="quest promax"><span class="q-ico">🚀</span>
      <span class="q-body"><b>${h(s.promax_title)} <em class="pm-tag">PROMAX</em></b><small>${h(s.promax_desc)}</small></span>
      <span class="q-side"><a class="q-btn" href="${h(s.promax_url)}" target="_blank" rel="noopener">${h(s.promax_button || 'Mở')}</a></span></div>`;
}

export function questsPage(ctx) {
  const body = `<div class="wrap narrow"><a class="back" href="/">← Trang chủ</a>
    <h1 class="h1">Nhiệm vụ kiếm Linh Thạch</h1>
    <p class="sub">Làm nhiệm vụ mỗi ngày để nhận Linh Thạch và EXP tu luyện</p>
    <div id="quests"><p class="c-note">Đang tải…</p></div>
    ${promaxQuest(ctx.s)}</div>`;
  return layout(ctx, { title: `Nhiệm vụ - ${ctx.s.site_name}`, canonical: ctx.origin + '/nhiem-vu', noindex: true }, body);
}

export function shopPage(ctx) {
  const body = `<div class="wrap narrow"><a class="back" href="/">← Trang chủ</a>
    <h1 class="h1">Cửa hàng</h1>
    <p class="sub">Đổi Linh Thạch lấy khung avatar và hiệu ứng tên đa sắc — hiện ở bình luận, bảng xếp hạng và thẻ tài khoản</p>
    <div id="shop"><p class="c-note">Đang tải…</p></div></div>`;
  return layout(ctx, { title: `Cửa hàng - ${ctx.s.site_name}`, canonical: ctx.origin + '/cua-hang', noindex: true }, body);
}

export function withdrawPage(ctx) {
  const body = `<div class="wrap narrow"><a class="back" href="/">← Trang chủ</a>
    <h1 class="h1">Rút Linh Thạch</h1>
    <div id="withdraw"><p class="c-note">Đang tải…</p></div></div>`;
  return layout(ctx, { title: `Rút Linh Thạch - ${ctx.s.site_name}`, canonical: ctx.origin + '/rut-linh-thach', noindex: true }, body);
}

export function comingSoonPage(ctx, title, icon, text) {
  const body = `<div class="wrap narrow"><a class="back" href="/">← Trang chủ</a>
    <h1 class="h1">${h(title)}</h1>
    <div class="soon"><span>${icon}</span><p>${text}</p><a class="btn-play inline" href="/nhiem-vu">Làm nhiệm vụ kiếm Linh Thạch</a></div></div>`;
  return layout(ctx, { title: `${title} - ${ctx.s.site_name}`, canonical: ctx.origin + '/' + (title === 'Cửa hàng' ? 'cua-hang' : 'rut-linh-thach'), noindex: true }, body);
}
