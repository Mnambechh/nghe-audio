// Bổ sung cho trình duyệt cũ (iOS 11–12, Android Chrome/WebView cũ) — chỉ chạy khi máy thiếu.
(function () {
  if (!Object.fromEntries) Object.fromEntries = function (it) { var o = {}; Array.from(it).forEach(function (p) { o[p[0]] = p[1]; }); return o; };
  if (window.Promise && !Promise.prototype.finally) {
    Promise.prototype.finally = function (f) {
      var P = this.constructor || Promise;
      return this.then(function (v) { return P.resolve(f()).then(function () { return v; }); },
        function (e) { return P.resolve(f()).then(function () { throw e; }); });
    };
  }
  var E = window.Element && Element.prototype;
  if (E && !E.matches) E.matches = E.webkitMatchesSelector || E.msMatchesSelector;
  if (E && !E.closest) E.closest = function (s) { var el = this; while (el && el.nodeType === 1) { if (el.matches(s)) return el; el = el.parentNode; } return null; };
  if (E && !E.remove) E.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
  if (E && !E.append) E.append = function () { for (var i = 0; i < arguments.length; i++) { var n = arguments[i]; this.appendChild(typeof n === 'string' ? document.createTextNode(n) : n); } };
  if (!String.prototype.padStart) String.prototype.padStart = function (n, c) { var s = String(this); c = c == null ? ' ' : String(c); while (s.length < n) s = c + s; return s.slice(-Math.max(n, String(this).length)); };
  var C = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
  if (C && !C.toBlob) C.toBlob = function (cb, type, q) {
    var bin = atob(this.toDataURL(type, q).split(',')[1]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var self = this; setTimeout(function () { cb(new Blob([arr], { type: type || 'image/png' })); }, 0);
  };
})();

(() => {
  'use strict';
  const APP = window.APP || { base: '', ad: null };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const audio = $('#audio');
  const player = $('#player');
  const sheet = $('#sheet');
  const body = document.body;
  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const DEFAULT_SPEED = 1.5; // tốc độ nghe mặc định khi người nghe chưa tự chọn

  // ---------- Lưu trữ cục bộ (an toàn khi bị chặn) ----------
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem('aw_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('aw_' + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem('aw_' + k); } catch (e) {} },
  };

  let sid = store.get('sid');
  if (!sid || !/^[A-Za-z0-9]{12,40}$/.test(sid)) {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const buf = new Uint8Array(24);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    sid = Array.from(buf, b => abc[b % abc.length]).join('');
    store.set('sid', sid);
  }

  const fmt = s => {
    s = Math.max(0, Math.floor(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };
  const api = (path, data) => fetch(APP.base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), keepalive: true,
  }).then(r => r.json()).catch(() => null);
  // Chặn gửi trùng: một thao tác nhận thưởng chỉ chạy một lần tại một thời điểm (máy chủ vẫn kiểm tra lại).
  const busy = new Set();
  const once = (key, run) => {
    if (busy.has(key)) return;
    busy.add(key);
    Promise.resolve().then(run).finally(() => busy.delete(key));
  };
  const beacon = (path, data) => {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    if (!(navigator.sendBeacon && navigator.sendBeacon(APP.base + path, blob))) api(path, data);
  };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- Trạng thái trình phát ----------
  let cur = null;          // {id, slug, title, parts:[{title,url,duration}]}
  let idx = 0;
  let pendingSeek = 0;
  let lastSave = 0, lastPing = 0, lastPos = 0, lastMs = 0;
  let speed = SPEEDS.includes(store.get('speed')) ? store.get('speed') : DEFAULT_SPEED;
  audio.defaultPlaybackRate = audio.playbackRate = speed;
  let timer = null;        // {end: ms} hoặc {part: true}
  let dragging = false;
  const counted = new Set();

  const posKey = (id, i) => `pos_${id}_${i}`;
  const part = () => cur && cur.parts[idx];

  function load(track, i, opts = {}) {
    cur = track; idx = Math.min(Math.max(0, i), track.parts.length - 1);
    const p = part();
    const saved = store.get(posKey(cur.id, idx), 0);
    pendingSeek = opts.at != null ? opts.at : (p.duration && saved > p.duration - 8 ? 0 : saved);
    audio.src = p.url;
    audio.defaultPlaybackRate = audio.playbackRate = speed;
    store.set('last', { track: cur, idx });
    store.set('lastidx_' + cur.id, idx);
    player.hidden = false;
    body.classList.add('has-player');
    updateMeta();
    renderAll();
    if (opts.autoplay) start();
  }

  function start() {
    if (!cur) return;
    body.classList.add('is-loading');
    const pr = audio.play();
    if (pr && pr.catch) pr.catch(err => {
      body.classList.remove('is-loading');
      if (err && err.name !== 'AbortError') toast('Bấm Phát để bắt đầu nghe');
    });
  }

  // Khóa quảng cáo: hiện popup nếu hết hạn mở khóa, bấm quảng cáo thì chạy fn.
  function needAd() {
    return !!(APP.ad && APP.ad.ads && APP.ad.ads.length) && Date.now() > (store.get('ad_until', 0) || 0);
  }
  let adAction = null, adShown = null;
  function gate(fn) {
    if (!needAd()) return fn();
    const cfg = APP.ad;
    const ad = cfg.ads[Math.floor(Math.random() * cfg.ads.length)];
    const m = $('#unlockbox');
    $('.ul-msg', m).textContent = cfg.message;
    $('.ul-note', m).textContent = cfg.note;
    const btn = $('.ul-btn', m);
    btn.textContent = cfg.button || ad.url;
    const card = $('.ul-card', m);
    card.hidden = !ad.image;
    if (ad.image) $('img', card).src = ad.image;
    $('.ul-title', card).textContent = ad.title || '';
    $('.ul-old', card).textContent = ad.old_price || '';
    $('.ul-price', card).textContent = ad.price || '';
    $('.ul-meta', card).hidden = !(ad.title || ad.price);
    [btn, card].forEach(a => { a.href = ad.url; });
    adAction = fn; adShown = ad;
    m.hidden = false;
    // Trình chặn quảng cáo ẩn nút: không khóa người nghe, phát luôn.
    if (!btn.offsetHeight || getComputedStyle(btn).display === 'none') {
      m.hidden = true; adAction = null;
      return fn();
    }
    beacon('/api/stat', { id: ad.id, ev: 'show' });
  }
  function adGo() {
    store.set('ad_until', Date.now() + APP.ad.hours * 3600e3);
    beacon('/api/stat', { id: adShown.id, ev: 'click' });
    $('#unlockbox').hidden = true;
    const fn = adAction; adAction = null;
    if (fn) fn();  // vẫn trong cùng thao tác bấm nên trình duyệt cho phép phát
  }

  function toggle() {
    if (!cur) return;
    if (audio.paused) gate(start); else audio.pause();
  }
  function seekBy(d) {
    if (!audio.duration) return;
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + d), audio.duration - 0.5);
  }
  function go(d) {
    if (!cur) return;
    const n = idx + d;
    if (n < 0 || n >= cur.parts.length) { if (d < 0) audio.currentTime = 0; return; }
    savePos();
    load(cur, n, { autoplay: true, at: 0 });
  }

  function savePos() {
    if (!cur || !audio.duration) return;
    const t = audio.currentTime;
    store.set(posKey(cur.id, idx), t > audio.duration - 8 ? 0 : Math.floor(t));
  }

  function ping(playing) {
    if (!cur) return;
    lastPing = Date.now();
    const data = { sid, track_id: cur.id, playing: !!playing };
    if (!playing) return beacon('/api/ping', data);
    api('/api/ping', data).then(r => { if (r && r.ok) setLive(cur.id, r.live); });
  }
  function setLive(id, n) {
    $$(`[data-live="${id}"]`).forEach(el => { $('b', el).textContent = n; el.hidden = !n; });
  }

  // ---------- Giao diện ----------
  function renderAll() {
    if (!cur) return;
    const p = part(), multi = cur.parts.length > 1;
    $('.pl-title', player).textContent = cur.title;
    $('.sheet-title', sheet).textContent = cur.title;
    const custom = p.title !== 'Phần ' + (idx + 1);
    $('.sheet-sub', sheet).textContent = multi ? (custom ? `${p.title} · ` : '') + `Phần ${idx + 1}/${cur.parts.length}` : (custom ? p.title : '');
    $$('.speed-val').forEach(e => { e.textContent = speed + '×'; });
    $('.pl-speed', player).classList.toggle('on', speed !== DEFAULT_SPEED);
    renderTime();
    renderTimer();
    renderPage();
  }

  function statusText() {
    const multi = cur.parts.length > 1;
    const st = body.classList.contains('is-loading') ? 'Đang tải…' : audio.paused ? 'Tạm dừng' : 'Đang phát';
    let tm = '';
    if (timer) tm = ' • ' + (timer.part ? 'tắt hết tập' : 'tắt sau ' + fmt((timer.end - Date.now()) / 1000));
    return (multi ? `Tập ${idx + 1}/${cur.parts.length} • ` : '') + st + tm;
  }

  function renderTime() {
    if (!cur) return;
    const d = audio.duration || part().duration || 0;
    const t = dragging ? +dragging.value / 1000 * d : (audio.currentTime || pendingSeek || 0);
    const pct = d ? Math.min(100, t / d * 100) : 0;
    $('.pl-sub', player).textContent = statusText();
    $$('.t-cur').forEach(e => { e.textContent = fmt(t); });
    $$('.t-dur').forEach(e => { e.textContent = fmt(d); });
    $$('.seek-range').forEach(r => {
      if (r !== dragging) r.value = Math.round(pct * 10);
      r.style.setProperty('--pct', pct + '%');
    });
    // Thanh tiến độ của phần đang phát trên trang
    const el = $(`.part[data-part="${idx}"] .part-prog span`);
    if (el && pageTrack && pageTrack.id === cur.id) el.style.width = pct + '%';
  }

  function renderTimer() {
    const chip = $('[data-act="timer"]', sheet), val = $('.timer-val', sheet), moon = $('.pl-moon', player);
    moon.classList.toggle('on', !!timer);
    $$('[data-timer]').forEach(b => b.classList.toggle('on', !!timer && (timer.part ? b.dataset.timer === 'end' : b.dataset.timer === String(timer.min))));
    if (!timer) { chip.classList.remove('on'); val.textContent = 'Hẹn giờ'; return; }
    chip.classList.add('on');
    val.textContent = timer.part ? 'Hết tập này' : 'Tắt sau ' + fmt((timer.end - Date.now()) / 1000);
    if (cur) $('.pl-sub', player).textContent = statusText();
  }

  function checkTimer() {
    if (timer && timer.end && Date.now() >= timer.end) {
      timer = null;
      audio.pause();
      toast('Đã hết giờ hẹn, chúc bạn ngủ ngon');
    }
    renderTimer();
  }

  function updateMeta() {
    if (!('mediaSession' in navigator) || !cur) return;
    const p = part();
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: cur.title,
        artist: cur.parts.length > 1 ? `Phần ${idx + 1}/${cur.parts.length}` : (document.querySelector('.brand') || {}).title || '',
        album: p.title,
      });
    } catch (e) {}
  }
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) {} };
    set('play', () => gate(start));
    set('pause', () => audio.pause());
    set('seekbackward', () => seekBy(-15));
    set('seekforward', () => seekBy(15));
    set('previoustrack', () => go(-1));
    set('nexttrack', () => go(1));
    set('seekto', e => { if (e.seekTime != null) audio.currentTime = e.seekTime; });
  }

  // ---------- Sự kiện audio ----------
  // Máy cũ (iOS 11–13, Android cũ) đôi khi bỏ qua lệnh tua khi mới có metadata: thử lại khi đã sẵn sàng phát.
  let seekRetry = 0;
  audio.addEventListener('loadedmetadata', () => {
    audio.defaultPlaybackRate = audio.playbackRate = speed;
    if (pendingSeek > 0 && pendingSeek < audio.duration - 3) {
      seekRetry = pendingSeek;
      try { audio.currentTime = pendingSeek; } catch (e) { /* tua lại ở canplay */ }
    }
    pendingSeek = 0;
    renderTime();
  });
  audio.addEventListener('canplay', () => {
    if (audio.playbackRate !== speed) audio.playbackRate = speed;
    if (seekRetry && Math.abs(audio.currentTime - seekRetry) > 3) { try { audio.currentTime = seekRetry; } catch (e) { /* bỏ qua */ } }
    seekRetry = 0;
  });
  audio.addEventListener('playing', () => {
    body.classList.add('is-playing');
    body.classList.remove('is-loading');
    renderTime();
    if (!counted.has(cur.id)) { counted.add(cur.id); api('/api/play', { sid, track_id: cur.id }); }
    ping(true);
  });
  audio.addEventListener('waiting', () => { body.classList.add('is-loading'); renderTime(); });
  audio.addEventListener('pause', () => {
    body.classList.remove('is-playing', 'is-loading');
    renderTime();
    savePos();
    syncHistory(true);
    ping(false);
  });
  audio.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - lastPos > 250) { lastPos = now; renderTime(); }
    if (now - lastSave > 5000) { lastSave = now; savePos(); }
    if (!audio.paused && now - lastPing > 60000) ping(true);
    if (!audio.paused) syncHistory();
    if (timer) checkTimer();
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && audio.duration && now - lastMs > 5000) {
      lastMs = now;
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate }); } catch (e) {}
    }
  });
  audio.addEventListener('ended', () => {
    store.set(posKey(cur.id, idx), 0);
    if (timer && timer.part) { timer = null; renderTimer(); toast('Đã hết phần, chúc bạn ngủ ngon'); return; }
    if (idx < cur.parts.length - 1) load(cur, idx + 1, { autoplay: true, at: 0 });
    else toast('Đã nghe hết ' + cur.title);
  });
  // Mạng chập chờn / máy yếu: tự tải lại tối đa 2 lần, nghe tiếp đúng chỗ đang dừng.
  let errRetry = 0, errAt = 0;
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src') || !cur) return;
    if (Date.now() - errAt > 60000) errRetry = 0;
    if (errRetry < 2) {
      errRetry++; errAt = Date.now();
      const at = audio.currentTime || store.get(posKey(cur.id, idx), 0) || 0, wasPlaying = body.classList.contains('is-playing') || body.classList.contains('is-loading');
      setTimeout(() => {
        pendingSeek = at;
        audio.src = part().url;
        audio.load();
        if (wasPlaying) start();
      }, 1500 * errRetry);
      return;
    }
    body.classList.remove('is-loading', 'is-playing');
    toast('Không tải được audio, vui lòng thử lại sau');
  });
  setInterval(() => {
    if (timer) checkTimer();
    if (cur && !audio.paused && Date.now() - lastPing > 60000) ping(true);
  }, 1000);
  window.addEventListener('pagehide', () => { savePos(); syncHistory('beacon'); if (!audio.paused) ping(false); });

  // ---------- Thanh tua (cả thanh dưới và trình phát mở rộng) ----------
  document.addEventListener('input', e => {
    if (!e.target.classList.contains('seek-range')) return;
    dragging = e.target; renderTime();
  });
  document.addEventListener('change', e => {
    if (!e.target.classList.contains('seek-range')) return;
    const d = audio.duration || 0;
    if (d) audio.currentTime = +e.target.value / 1000 * d;
    dragging = false; renderTime();
  });

  // ---------- Trình phát mở rộng ----------
  function openSheet(showTimer) {
    if (!cur) return;
    sheet.hidden = false;
    $('.timer-menu', sheet).hidden = !showTimer;
    body.style.overflow = 'hidden';
    renderAll();
  }
  function closeSheet() {
    sheet.hidden = true;
    body.style.overflow = '';
    $('.sheet-panel', sheet).style.transform = '';
  }
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  // Vuốt xuống để thu nhỏ
  (() => {
    const panel = $('.sheet-panel', sheet);
    let y0 = null, dy = 0;
    panel.addEventListener('touchstart', e => {
      if (panel.scrollTop > 0 || e.target.classList.contains('seek-range')) return;
      y0 = e.touches[0].clientY; dy = 0;
    }, { passive: true });
    panel.addEventListener('touchmove', e => {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      panel.style.transition = 'none';
      panel.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    panel.addEventListener('touchend', () => {
      if (y0 === null) return;
      panel.style.transition = 'transform .2s';
      if (dy > 110) closeSheet(); else panel.style.transform = '';
      y0 = null;
    });
  })();

  // ---------- Trang hiện tại ----------
  let pageTrack = null;

  function readTrack() {
    const el = $('#track-data');
    try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; }
  }

  function renderPage() {
    if (!pageTrack) return;
    const same = cur && cur.id === pageTrack.id;
    $$('.part').forEach(b => {
      const i = +b.dataset.part, p = pageTrack.parts[i];
      b.classList.toggle('on', same && i === idx);
      const pos = store.get(posKey(pageTrack.id, i), 0);
      const bar = $('.part-prog span', b);
      if (bar && !(same && i === idx)) bar.style.width = p.duration ? Math.min(100, pos / p.duration * 100) + '%' : '0';
    });
  }

  function initPage() {
    pageTrack = readTrack();
    initComments();
    if (pageTrack) {
      updateResume();
      renderPage();
      applyServerResume();
    }
    loadHistory();
    loadProfile();
    loadQuests();
    loadNotifPage();
    if (me && ($('#quests') || $('#withdraw'))) fetchMe(); // lấy tiến độ / số dư mới nhất khi chuyển trang
    loadWithdraw();
    markMenu();
    initRating();
    initHeart();
    refreshLive();
  }

  function updateResume() {
    if (!pageTrack) return;
    const li = Math.min(store.get('lastidx_' + pageTrack.id, 0) || 0, pageTrack.parts.length - 1);
    const pos = store.get(posKey(pageTrack.id, li), 0);
    const btn = $('.btn-play[data-act="play-track"]');
    const res = $('.resume');
    if (btn && pos > 20) {
      btn.dataset.part = li;
      $('span', btn).textContent = 'Nghe tiếp';
      res.hidden = false;
      res.textContent = `Bạn đang nghe dở${pageTrack.parts.length > 1 ? ' tập ' + (li + 1) : ''} ở ${fmt(pos)}`;
    }
  }

  function refreshLive() {
    const ids = [...new Set($$('[data-live]').map(e => e.dataset.live))].slice(0, 100);
    if (!ids.length || document.hidden) return;
    fetch(`${APP.base}/api/live?ids=${ids.join(',')}`).then(r => r.json()).then(r => {
      if (!r || !r.live) return;
      ids.forEach(id => setLive(id, r.live[id] || 0));
    }).catch(() => {});
  }
  setInterval(refreshLive, 90000);

  // ---------- Bấm nút ----------
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-scroll],[data-tab],[data-timer]');
    if (!t) return;
    if (t.dataset.scroll) {
      const rail = $$('.rail', t.closest('.shelf')).find(r => !r.hidden);
      if (rail) rail.scrollBy({ left: rail.clientWidth * 0.9 * +t.dataset.scroll, behavior: 'smooth' });
      return;
    }
    if (t.dataset.tab) {
      const shelf = t.closest('.shelf');
      $$('.tabs button', shelf).forEach(b => b.classList.toggle('on', b === t));
      $$('[data-pane]', shelf).forEach(p => { p.hidden = p.dataset.pane !== t.dataset.tab; });
      return;
    }
    if (t.dataset.timer) {
      const v = t.dataset.timer;
      timer = v === 'off' ? null : v === 'end' ? { part: true } : { end: Date.now() + v * 60000, min: +v };
      $('.timer-menu', sheet).hidden = true;
      $('#timerpop').hidden = true;
      renderTimer();
      toast(v === 'off' ? 'Đã tắt hẹn giờ' : v === 'end' ? 'Sẽ dừng khi hết phần này' : `Sẽ tắt sau ${v} phút`);
      return;
    }
    switch (t.dataset.act) {
      case 'play-track': {
        if (!pageTrack || !pageTrack.parts.length) return;
        const i = +t.dataset.part || 0;
        if (cur && cur.id === pageTrack.id && idx === i) { if (audio.paused) gate(start); else openSheet(); return; }
        gate(() => load(pageTrack, i, { autoplay: true }));
        return;
      }
      case 'timer-open':
        if (!cur && pageTrack && pageTrack.parts.length) {
          load(pageTrack, Math.min(store.get('lastidx_' + pageTrack.id, 0) || 0, pageTrack.parts.length - 1));
        }
        $('#timerpop').hidden = false;
        return;
      case 'login': openLogin(); return;
      case 'login-close': $('#loginbox').hidden = true; return;
      case 'logout': doLogout(); return;
      case 'acct-menu': { const mm = $('.acct-card'); mm.hidden = !mm.hidden; $('.notif-panel').hidden = true; return; }
      case 'heart': doHeart(t); return;
      case 'bell': openNotifs(); return;
      case 'nf-more': moreNotifs(); return;
      case 'menu': { const mm = $('#mainmenu'); mm.hidden = !mm.hidden; markMenu(); return; }
      case 'checkin': doCheckin(); return;
      case 'hist-del': {
        const row = t.closest('[data-hid]');
        api('/api/history/delete', { track_id: +row.dataset.hid }).then(() => { row.remove(); histCache = null; });
        return;
      }
      case 'avatar-reset':
        api('/api/profile/avatar/delete', {}).then(r => {
          if (!r || !r.ok) return;
          me.avatar = ''; me.customAvatar = false;
          renderAcct(); loadProfile(); toast('Ảnh Google sẽ được dùng lại từ lần đăng nhập sau');
        });
        return;
      case 'hist-clear':
        if (!confirm('Xóa toàn bộ lịch sử nghe?')) return;
        api('/api/history/delete', { all: true }).then(() => { histCache = null; loadHistory(); });
        return;
      case 'ul-go': adGo(); return;   // không chặn mặc định: liên kết vẫn mở Shopee ở tab mới
      case 'ul-close': $('#unlockbox').hidden = true; adAction = null; return;
      case 'toggle': toggle(); return;
      case 'expand': openSheet(); return;
      case 'collapse': closeSheet(); return;
      case 'back': seekBy(-15); return;
      case 'fwd': seekBy(15); return;
      case 'prev': go(-1); return;
      case 'next': go(1); return;
      case 'speed':
        speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
        audio.defaultPlaybackRate = audio.playbackRate = speed;
        store.set('speed', speed);
        renderAll();
        return;
      case 'timer': $('.timer-menu', sheet).hidden = !$('.timer-menu', sheet).hidden; return;
      case 'timer-pop': $('#timerpop').hidden = !$('#timerpop').hidden; return;
      case 'close':
        closeSheet();
        $('#timerpop').hidden = true;
        audio.pause();
        audio.removeAttribute('src'); audio.load();
        cur = null; timer = null;
        store.del('last');
        player.hidden = true;
        body.classList.remove('has-player');
        renderPage();
        return;
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeTopSearch(); const mm = $('#mainmenu'); if (mm) mm.hidden = true; }
    if (e.key === 'Escape') { ['.acct-card', '.notif-panel', '#timerpop'].forEach(sel => { const el = $(sel); if (el) el.hidden = true; }); }
    if (e.key === 'Escape') { if (!$('#unlockbox').hidden) $('#unlockbox').hidden = true; else if (!sheet.hidden) closeSheet(); }
    if (e.code === 'Space' && cur && !/^(INPUT|TEXTAREA|BUTTON|A|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); toggle(); }
  });

  // ---------- Chuyển trang không tải lại (nhạc không bị ngắt) ----------
  const sameSite = u => u.origin === location.origin && u.pathname.indexOf(APP.base + '/admin') !== 0
    && u.pathname.indexOf(APP.base + '/api/') !== 0 && !/\.(xml|txt|mp3|m4a|jpg|png|webp)$/i.test(u.pathname);

  async function navigate(href, push = true) {
    try {
      $('#main').style.opacity = '.55';
      const res = await fetch(href, { headers: { 'X-Requested-With': 'nav' } });
      const ctype = res.headers.get('Content-Type') || '';
      if (!ctype.includes('text/html')) throw new Error('not html');
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const main = doc.querySelector('#main');
      if (!main) throw new Error('no main');
      $('#main').replaceWith(main);
      document.title = doc.title;
      ['meta[name="description"]', 'link[rel="canonical"]'].forEach(sel => {
        const a = $(sel), b = doc.querySelector(sel);
        if (a && b) a.replaceWith(b);
      });
      if (push) history.pushState({}, '', href);
      window.scrollTo(0, 0);
      closeTopSearch();
      initPage();
      focusSearchFromHash();
    } catch (err) {
      location.href = href;
    }
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || a.target || a.hasAttribute('download') || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    const u = new URL(a.href, location.href);
    if (!sameSite(u)) return;
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return;
    e.preventDefault();
    navigate(u.href);
  });
  document.addEventListener('submit', e => {
    const f = e.target;
    if (!f.classList.contains('searchbox')) return;
    e.preventDefault();
    const active = $('.suggest [data-i].on', f);
    if (active) { hideSuggest(); navigate(active.href); return; }
    hideSuggest();
    const q = new FormData(f).get('q').trim();
    navigate(APP.base + '/' + (q ? '?q=' + encodeURIComponent(q) : ''));
    $('input', f).blur();
  });
  window.addEventListener('popstate', () => navigate(location.href, false));

  // ---------- Gợi ý tìm kiếm ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plainChar = c => c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').charAt(0) || c;
  const fmtNum = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '').replace('.', ',') + ' Tr'
    : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '').replace('.', ',') + ' N' : String(n);

  // Tô màu phần khớp (so khớp không dấu, giữ nguyên chữ có dấu khi hiển thị).
  function highlight(title, q) {
    const chars = Array.from(title);
    const plain = chars.map(plainChar).join('');
    const mark = new Array(chars.length).fill(false);
    const tokens = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').split(/[^a-z0-9]+/).filter(Boolean);
    tokens.forEach(tok => {
      const re = new RegExp('(^|[^a-z0-9])(' + tok + ')', 'g');
      let m, found = false;
      while ((m = re.exec(plain))) { found = true; const st = m.index + m[1].length; for (let i = st; i < st + tok.length; i++) mark[i] = true; }
      if (!found) { const i = plain.indexOf(tok); if (i >= 0) for (let j = i; j < i + tok.length; j++) mark[j] = true; }
    });
    let out = '', open = false;
    chars.forEach((c, i) => {
      if (mark[i] && !open) { out += '<mark>'; open = true; }
      if (!mark[i] && open) { out += '</mark>'; open = false; }
      out += esc(c);
    });
    return out + (open ? '</mark>' : '');
  }

  const sugCache = new Map();
  let sugTimer = 0, sugSeq = 0;

  function hideSuggest() {
    const box = $('#suggest');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    const inp = $('#search');
    if (inp) inp.setAttribute('aria-expanded', 'false');
  }

  function renderSuggest(q, items) {
    const box = $('#suggest'), inp = $('#search');
    if (!box || !inp || inp.value.trim() !== q) return;
    const all = `<a class="sg-all" data-i="${items.length}" href="${APP.base}/?q=${encodeURIComponent(q)}">Xem tất cả kết quả cho “${esc(q)}”</a>`;
    box.innerHTML = items.length
      ? items.map((t, i) => `<a class="sg-item" role="option" data-i="${i}" href="${APP.base}/track/${encodeURIComponent(t.slug)}">
          <span class="sg-icon"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
          <span class="sg-body"><span class="sg-title">${highlight(t.title, q)}</span>
          <span class="sg-meta">${t.duration ? fmt(t.duration) + ' · ' : ''}${fmtNum(t.views || 0)} lượt nghe</span></span></a>`).join('') + all
      : `<div class="sg-empty">Không tìm thấy audio nào cho “${esc(q)}”</div>`;
    box.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
  }

  function requestSuggest(q) {
    if (sugCache.has(q)) return renderSuggest(q, sugCache.get(q));
    const seq = ++sugSeq;
    fetch(`${APP.base}/api/suggest?q=${encodeURIComponent(q)}`).then(r => r.json()).then(r => {
      if (!r || !r.ok) return;
      sugCache.set(q, r.items);
      if (seq === sugSeq) renderSuggest(q, r.items);
    }).catch(() => {});
  }

  document.addEventListener('input', e => {
    if (e.target.id !== 'search') return;
    const q = e.target.value.trim();
    const clear = $('.sb-clear');
    if (clear) clear.hidden = !e.target.value;
    clearTimeout(sugTimer);
    if (!q) { sugSeq++; hideSuggest(); return; }
    sugTimer = setTimeout(() => requestSuggest(q), sugCache.has(q) ? 0 : 160);
  });
  document.addEventListener('focusin', e => {
    if (e.target.id === 'search' && e.target.value.trim()) requestSuggest(e.target.value.trim());
  });
  document.addEventListener('keydown', e => {
    if (e.target.id !== 'search') return;
    const box = $('#suggest');
    if (e.key === 'Escape') { hideSuggest(); return; }
    if (!box || box.hidden || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const items = $$('[data-i]', box);
    let i = items.findIndex(x => x.classList.contains('on'));
    i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
    items.forEach((x, j) => x.classList.toggle('on', j === i));
    items[i].scrollIntoView({ block: 'nearest' });
  });
  // Bấm ra ngoài thì đóng gợi ý; bấm nút xóa thì xóa chữ.
  document.addEventListener('click', e => {
    if (e.target.closest('.sb-clear')) {
      const inp = $('#search');
      inp.value = ''; e.target.closest('.sb-clear').hidden = true; hideSuggest(); inp.focus();
      return;
    }
    const menu = $('#mainmenu');
    if (menu && !menu.hidden && (!e.target.closest('#mainmenu, .menu-btn') || e.target.closest('#mainmenu a'))) menu.hidden = true;
    ['.acct-card', '.notif-panel'].forEach(sel => {
      const el = $(sel);
      if (el && !el.hidden && (!e.target.closest('.acct') || e.target.closest(sel + ' a'))) el.hidden = true;
    });
    const pop = $('#timerpop');
    if (pop && !pop.hidden && !e.target.closest('#timerpop, [data-act="timer-pop"], [data-act="timer-open"]')) pop.hidden = true;
    if (e.target.closest('.sg-item, .sg-all')) { hideSuggest(); return; }
    if (!e.target.closest('.searchbox')) hideSuggest();
  });

  // Menu 3 gạch: tô hồng mục đang xem.
  function markMenu() {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === p));
  }

  // Trang nhiệm vụ: tiến độ hôm nay.
  function loadQuests() {
    const box = $('#quests');
    if (!box || !meLoaded) return;
    if (!me || !game) {
      box.innerHTML = '<div class="c-login"><p>Đăng nhập để làm nhiệm vụ và nhận Linh Thạch.</p><button class="btn-play inline" type="button" data-act="login">Đăng nhập</button></div>';
      return;
    }
    const g = game, ckLeft = Math.max(0, Math.ceil(ckLeftSec));
    const q = (icon, title, desc, done, total, reward, btn) => {
      const pct = total ? Math.min(100, done / total * 100) : 0, fin = done >= total;
      return `<div class="quest${fin ? ' done' : ''}"><span class="q-ico">${icon}</span>
        <span class="q-body"><b>${title}</b><small>${desc}</small>
          <span class="q-bar"><span style="width:${pct}%"></span></span><small class="q-prog">${done}/${total}</small></span>
        <span class="q-side"><span class="q-reward">${reward}</span>${fin ? '<span class="q-ok">✓ Xong</span>' : btn || ''}</span></div>`;
    };
    box.innerHTML = `<h2 class="h2">Hằng ngày</h2>
      ${q('🎁', 'Điểm danh', g.checkedIn ? 'Hôm nay bạn đã điểm danh' : `<span class="q-ck-left">${ckLeft ? `Online thêm <b>${fmt(ckLeft)}</b> để điểm danh` : 'Đã đủ thời gian, bấm <b>Điểm danh</b> để nhận'}</span>`, g.checkedIn ? 1 : 0, 1,
        `+${nf(g.ckStones)} 💎 · +${nf(g.ckExp)} EXP`, `<button class="q-btn q-ck-btn" type="button" data-act="checkin"${ckLeft ? ' disabled' : ''}>Điểm danh</button>`)}
      ${listenQuest(q)}
      ${(c => c ? q('💬', 'Bình luận hợp lệ', 'Bình luận đầu tiên được hiện trong ngày', c.done ? 1 : 0, 1, rewardText(c.stones, 0),
        `<a class="q-btn" href="${APP.base}/">Đi nghe</a>`) : '')(g.quests && g.quests.comment)}
      ${((g.quests && g.quests.links) || []).map(x => q('🎯', esc(x.title), 'Bấm Mở để xem, mỗi ngày 1 lần', x.done ? 1 : 0, 1,
        rewardText(x.stones, x.exp), `<a class="q-btn" href="${esc(x.url)}" target="_blank" rel="noopener" data-quest="${x.id}">Mở</a>`)).join('')}
      <p class="c-note">Nhiệm vụ hằng ngày làm mới lúc 0h.</p>
      <h2 class="h2">Tu luyện</h2>
      ${q('⚡', `Đột phá lên cấp ${g.level.lvl + 1}`, `Hiện tại: ${esc(g.level.realm)}`, g.level.cur, g.level.need || 1, `+${nf(g.levelStones)} 💎`, '')}
      <p class="c-note">Linh Thạch hiện có: <b>${nf(g.stones)}</b> 💎</p>`;
  }

  const rewardText = (stones, exp) => [stones && `+${nf(stones)} 💎`, exp && `+${nf(exp)} EXP`].filter(Boolean).join(' · ') || '';

  // Nhiệm vụ nghe audio: mỗi mốc (20 phút, 30 phút…) một dòng, tiến độ chung là thời gian đã nghe hôm nay.
  function listenQuest(q) {
    const L = game && game.quests && game.quests.listen;
    if (!L) return '';
    const sec = Math.floor(Math.min(L.need, L.sec + lq.pending + (lq.since ? Math.min(120, (Date.now() - lq.since) / 1000) : 0)));
    return L.tiers.map(t => {
      const need = t.min * 60, s2 = Math.min(sec, need);
      return q('🎧', `Nghe audio ${t.min} phút`, t.done ? 'Đã nghe đủ hôm nay' : `Đã nghe ${fmt(s2)} / ${t.min}:00 · tua không được tính`,
        t.done ? 1 : Math.floor(s2 / 60), t.done ? 1 : t.min, rewardText(t.stones, t.exp), `<a class="q-btn" href="${APP.base}/">Đi nghe</a>`)
        .replace(/<small class="q-prog">[^<]*<\/small>/, `<small class="q-prog">${t.done ? '✓' : Math.floor(s2 / 60) + '/' + t.min + ' phút'}</small>`);
    }).join('');
  }

  // Bấm "Mở" nhiệm vụ link: trình duyệt mở link (tab mới), máy chủ ghi nhận và phát thưởng.
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-quest]');
    if (!a) return;
    if (!me) { e.preventDefault(); openLogin(); return; }
    const x = game && game.quests && game.quests.links.find(v => v.id === +a.dataset.quest);
    if (x && x.done) return; // đã nhận hôm nay: chỉ mở link
    once('quest' + a.dataset.quest, () => api('/api/quest/open', { id: +a.dataset.quest }).then(r => {
      if (!r || !r.ok) { toast((r && r.error) || 'Chưa ghi nhận được nhiệm vụ'); return; }
      if (x) x.done = true;
      if (!r.already) showRewards(r.rewards, `Bạn đã hoàn thành nhiệm vụ "${esc(r.title)}"`, '🎯');
      loadQuests(); fetchMe();
    }));
  });

  // Đếm thời gian nghe thật (đồng hồ) khi audio đang phát; tua không cộng thêm. Gửi máy chủ mỗi ~30 giây.
  const lq = { pending: 0, since: 0, sending: false };
  function lqActive() {
    const L = game && game.quests && game.quests.listen;
    return !!(me && L && L.tiers.some(t => !t.done));
  }
  function lqStop() {
    if (lq.since) { lq.pending += Math.min(120, (Date.now() - lq.since) / 1000); lq.since = 0; }
  }
  function lqFlush(force) {
    lqStop();
    if (!audio.paused && lqActive()) lq.since = Date.now();
    if (!lqActive() || lq.sending) return;
    const L = game.quests.listen;
    const sec = Math.floor(lq.pending);
    const nextMin = (L.tiers.find(t => !t.done) || {}).min || 0;
    if (sec < 1 || (!force && sec < 30 && L.sec + sec < nextMin * 60)) return;
    lq.sending = true;
    lq.pending -= sec;
    api('/api/quest/listen', { sec }).then(r => {
      if (r && r.ok) {
        L.sec = r.sec;
        if (r.reached && r.reached.length) {
          L.tiers.forEach(t => { if (r.reached.includes(t.min)) t.done = true; });
          showRewards(r.rewards, `Bạn đã nghe đủ ${r.reached[r.reached.length - 1]} phút hôm nay`, '🎧');
          fetchMe();
        }
      } else lq.pending += sec;
      if ($('#quests')) loadQuests();
    }).catch(() => { lq.pending += sec; }).finally(() => { lq.sending = false; });
  }
  audio.addEventListener('playing', () => { if (lqActive() && !lq.since) lq.since = Date.now(); });
  audio.addEventListener('pause', () => lqFlush(true));
  audio.addEventListener('waiting', lqStop);
  audio.addEventListener('ended', () => lqFlush(true));
  setInterval(() => lqFlush(false), 5000);
  // Đang ở trang Nhiệm vụ và đang phát: cập nhật tiến độ nghe mỗi giây.
  setInterval(() => { if (lq.since && $('#quests') && !document.hidden) loadQuests(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) lqFlush(true); });

  // ---------- Rút Linh Thạch ----------
  let wd = null;
  const WD_ICON = { bank: '🏦', momo: '🟣', viettelpay: '🔴', zalopay: '🔵' };
  const accLabel = a => `${WD_ICON[a.method] || ''} ${esc(wd.methods[a.method] || a.method)}${a.bank ? ' · ' + esc(a.bank) : ''}`;

  function loadWithdraw() {
    const box = $('#withdraw');
    if (!box || !meLoaded) return;
    if (!me) {
      box.innerHTML = '<div class="c-login"><p>Đăng nhập để rút Linh Thạch.</p><button class="btn-play inline" type="button" data-act="login">Đăng nhập</button></div>';
      return;
    }
    fetch(`${APP.base}/api/withdraw`, { credentials: 'same-origin' }).then(r => r.json()).then(r => {
      if (!r || !r.ok || $('#withdraw') !== box) return;
      wd = r;
      renderWithdraw();
    }).catch(() => { box.innerHTML = '<p class="c-note">Không tải được, thử lại sau.</p>'; });
  }

  function renderWithdraw() {
    const box = $('#withdraw');
    if (!box || !wd) return;
    const c = wd.config, vnd = n => nf(Math.floor(n * c.rate)) + 'đ';
    const STATUS = { pending: ['Chờ duyệt', 'st-pending'], paid: ['Đã chuyển', 'st-paid'], rejected: ['Từ chối, đã hoàn', 'st-rejected'] };
    box.innerHTML = `
      <div class="wd-balance"><span>Số dư</span><b>${nf(wd.balance)} 💎</b>${c.rate !== 1 ? `<small>≈ ${vnd(wd.balance)}</small>` : ''}</div>
      <p class="wd-rules">Rút tối thiểu <b>${nf(c.min)}</b> Linh Thạch${c.daily ? ` · ${c.daily} lần/ngày` : ''}. Admin duyệt và chuyển khoản thủ công, thường trong 24–48 giờ.</p>
      ${wd.blocked ? `<div class="wd-warn">${esc(wd.blocked)}</div>` : ''}

      <h2 class="h2">Tạo yêu cầu rút</h2>
      ${wd.accounts.length ? `<form class="wd-form" id="wdForm">
        <div class="wd-accs">${wd.accounts.map((a, i) => `<label class="wd-acc"><input type="radio" name="account_id" value="${a.id}"${i === 0 ? ' checked' : ''}>
          <span><b>${accLabel(a)}</b><small>${esc(a.number)} · ${esc(a.holder)}</small></span></label>`).join('')}</div>
        <label class="wd-amount">Số Linh Thạch muốn rút
          <input name="amount" inputmode="numeric" placeholder="${nf(c.min)}" autocomplete="off"></label>
        <div class="wd-quick">${[c.min, c.min * 2, c.min * 5].filter(n => n <= wd.balance).map(n => `<button type="button" data-amt="${n}">${nf(n)}</button>`).join('')}
          ${wd.balance >= c.min ? `<button type="button" data-amt="${wd.balance}">Tất cả</button>` : ''}</div>
        ${c.rate !== 1 ? '<p class="wd-vnd">Bạn sẽ nhận: <b>0đ</b></p>' : ''}
        <button class="btn-play inline" type="submit"${wd.blocked || wd.balance < c.min ? ' disabled' : ''}>Gửi yêu cầu rút</button>
      </form>` : '<p class="c-note">Hãy thêm tài khoản nhận tiền bên dưới trước khi rút.</p>'}

      <h2 class="h2">Tài khoản nhận tiền <small class="muted">(${wd.accounts.length}/3)</small></h2>
      <div class="list">${wd.accounts.map(a => `<div class="row wd-row"><span class="row-body"><b>${accLabel(a)}</b>
        <span class="meta">${esc(a.number)} · ${esc(a.holder)}</span></span>
        <button class="hist-del" type="button" data-act="wd-del" data-id="${a.id}" aria-label="Xóa">×</button></div>`).join('')}</div>
      ${wd.accounts.length < 3 ? `<form class="wd-add" id="wdAdd">
        <div class="wd-methods">${Object.keys(wd.methods).map((k, i) => `<label><input type="radio" name="method" value="${k}"${i === 0 ? ' checked' : ''}><span>${WD_ICON[k]} ${esc(wd.methods[k])}</span></label>`).join('')}</div>
        <label class="wd-bank">Ngân hàng<select name="bank"><option value="">— Chọn ngân hàng —</option>${wd.banks.map(b => `<option>${esc(b)}</option>`).join('')}</select></label>
        <label><span class="wd-num-label">Số tài khoản</span><input name="number" inputmode="numeric" autocomplete="off" placeholder="Số tài khoản"></label>
        <label>Tên chủ tài khoản (không dấu)<input name="holder" autocomplete="off" placeholder="NGUYEN VAN A" style="text-transform:uppercase"></label>
        <button class="btn-ghost sm" type="submit">+ Thêm tài khoản</button>
      </form>` : ''}

      <h2 class="h2">Lịch sử rút</h2>
      <div class="list">${wd.history.map(w => `<div class="row wd-row"><span class="row-body">
        <span class="row-head"><b>${nf(w.amount)} 💎 → ${nf(w.vnd)}đ</b><span class="st ${STATUS[w.status][1]}">${STATUS[w.status][0]}</span></span>
        <span class="meta">${esc(wd.methods[w.method] || w.method)}${w.bank ? ' · ' + esc(w.bank) : ''} · ${esc(w.number)} · ${cDate(w.created_at)}</span>
        ${w.admin_note ? `<span class="meta">Ghi chú: ${esc(w.admin_note)}</span>` : ''}</span></div>`).join('') || '<p class="c-note">Chưa có yêu cầu rút nào.</p>'}</div>`;
  }

  document.addEventListener('change', e => {
    const f = e.target.closest('#wdAdd');
    if (!f || e.target.name !== 'method') return;
    const bank = e.target.value === 'bank';
    $('.wd-bank', f).hidden = !bank;
    $('.wd-num-label', f).textContent = bank ? 'Số tài khoản' : 'Số điện thoại ví';
    $('[name=number]', f).placeholder = bank ? 'Số tài khoản' : '09xxxxxxxx';
  });
  document.addEventListener('input', e => {
    const f = e.target.closest('#wdForm');
    if (!f || e.target.name !== 'amount' || !wd) return;
    const n = parseInt(e.target.value.replace(/\D/g, ''), 10) || 0;
    const v = $('.wd-vnd b', f);
    if (v) v.textContent = nf(Math.floor(n * wd.config.rate)) + 'đ';
  });
  document.addEventListener('click', e => {
    const q = e.target.closest('[data-amt]');
    if (q) {
      const inp = $('#wdForm [name=amount]');
      inp.value = q.dataset.amt;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const d = e.target.closest('[data-act="wd-del"]');
    if (d && confirm('Xóa tài khoản nhận tiền này?')) {
      api('/api/withdraw/account/delete', { id: +d.dataset.id }).then(() => loadWithdraw());
    }
  });
  document.addEventListener('submit', e => {
    const f = e.target;
    if (f.id === 'wdAdd') {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      api('/api/withdraw/account', d).then(r => {
        if (!r || !r.ok) { toast((r && r.error) || 'Không thêm được'); return; }
        toast('Đã thêm tài khoản nhận tiền'); loadWithdraw();
      });
    }
    if (f.id === 'wdForm') {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      const amount = parseInt(String(d.amount).replace(/\D/g, ''), 10) || 0;
      if (!confirm(`Rút ${nf(amount)} Linh Thạch?`)) return;
      once('withdraw', () => api('/api/withdraw', { account_id: +d.account_id, amount }).then(r => {
        if (!r || !r.ok) { toast((r && r.error) || 'Không gửi được yêu cầu'); return; }
        rewardToast(`Đã gửi yêu cầu rút <b>${nf(r.amount)}</b> Linh Thạch. Admin sẽ duyệt sớm.`, '💎', 6000);
        loadWithdraw(); fetchMe();
      }));
    }
  });

  // Bấm kính lúp: hiện ô tìm kiếm ngay dưới thanh đầu trang (không chuyển trang).
  function openTopSearch() {
    const pageBox = $('#main #search');
    if (pageBox) {
      pageBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
      pageBox.focus({ preventScroll: true });
      return;
    }
    let ov = $('#topsearch');
    if (ov) { closeTopSearch(); return; }
    ov = document.createElement('div');
    ov.id = 'topsearch';
    ov.className = 'topsearch-ov';
    ov.innerHTML = `<div class="ts-inner"><form class="searchbox" action="${APP.base}/" method="get" role="search" autocomplete="off">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.3 4.3-1.4 1.4-4.3-4.3A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z"/></svg>
      <input id="search" type="search" name="q" placeholder="Tìm audio..." aria-label="Tìm audio" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" role="combobox" aria-expanded="false" aria-controls="suggest">
      <button type="button" class="sb-clear" aria-label="Xóa" hidden><svg viewBox="0 0 24 24"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6z"/></svg></button>
      <div class="suggest" id="suggest" role="listbox" hidden></div></form></div>`;
    $('.topbar').after(ov);
    $('#search', ov).focus();
  }
  function closeTopSearch() {
    const ov = $('#topsearch');
    if (ov) ov.remove();
  }

  function focusSearchFromHash() {
    if (location.hash !== '#search') return;
    const inp = $('#search');
    if (!inp) return;
    inp.scrollIntoView({ block: 'center' });
    inp.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', focusSearchFromHash);

  // ---------- Tài khoản (đăng nhập Google) + lịch sử nghe ----------
  let me = null, clientId = '', meLoaded = false, histCache = null, lastHist = 0, avatarMaxMb = 5;

  const ICON_BELL = '<svg viewBox="0 0 24 24"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2z"/></svg>';
  const ICON_OUT = '<svg viewBox="0 0 24 24"><path d="M10 17v-3H3v-4h7V7l5 5-5 5zm9-14H12v2h7v14h-7v2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/></svg>';
  let editorUrl = '';
  let game = null, ckTimer = 0, ckLeftSec = 0, ckNotified = false, notifs = null;

  const lvAv = (name, url, b, cls) => b ? `<span class="av-wrap t${b.tier}">${avatar(name, url, cls)}<i class="lv t${b.tier} l${b.lvl}">${b.lvl}</i></span>` : avatar(name, url, cls);
  const realmTag = b => b ? `<span class="realm t${b.tier}">${esc(b.realm)}</span>` : '';
  const nf = n => String(Math.floor(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  function renderAcct() {
    const box = $('#acct');
    if (!box) return;
    if (!me) { box.innerHTML = '<button class="btn-login" type="button" data-act="login">Đăng nhập</button>'; stopCk(); return; }
    box.innerHTML = `<button class="bell" type="button" data-act="bell" aria-label="Thông báo">${ICON_BELL}<b class="bell-n" hidden></b></button>
      <div class="notif-panel" hidden><div class="np-head">Thông báo</div><div class="np-list"><p class="c-note">Đang tải…</p></div>
        <a class="np-all" href="${APP.base}/thong-bao">Xem tất cả thông báo</a></div>
      <button class="acct-btn" type="button" data-act="acct-menu" aria-label="Tài khoản">${lvAv(me.name, me.avatar, game && game.level, 'acct-av')}</button>
      <div class="acct-card" hidden></div>`;
    renderGame();
  }

  // Thẻ tài khoản: Linh Thạch, điểm danh, EXP, bình luận, cấp, cảnh giới, thanh tiến độ.
  function renderGame() {
    const card = $('.acct-card');
    if (!card || !me) return;
    const g = game || { stones: 0, exp: 0, comments: 0, level: { lvl: me.lvl || 1, tier: me.tier || 0, realm: me.realm || 'Luyện Khí 1', cur: 0, need: 100, pct: 0 }, checkedIn: false, checkinIn: 0, unread: 0 };
    const L = g.level;
    card.innerHTML = `<div class="ac-head"><b>${esc(me.name)}</b><button type="button" data-act="logout" title="Đăng xuất" aria-label="Đăng xuất">${ICON_OUT}</button></div>
      <div class="ac-stones"><b>${nf(g.stones)}</b> Linh Thạch</div>
      <div class="ac-ck"><button type="button" class="ck-btn" data-act="checkin"${g.checkedIn ? ' disabled' : ''}>${g.checkedIn ? 'ĐÃ ĐIỂM DANH' : 'ĐIỂM DANH'}</button><span class="ck-time"></span></div>
      <div class="ac-stats"><span title="Tổng EXP">☆ ${nf(g.exp)}</span> · <span title="Bình luận">💬 ${nf(g.comments)}</span> · <span>Cấp ${L.lvl}</span> · ${realmTag(L)}</div>
      <div class="ac-bar" title="${L.need ? `${nf(L.cur)}/${nf(L.need)} EXP lên cấp ${L.lvl + 1}` : 'Cấp tối đa'}"><span style="width:${L.pct}%"></span><em>${L.need ? `${nf(L.cur)}/${nf(L.need)} EXP` : 'Viên mãn'}</em><i>Cấp ${L.lvl}</i></div>
      <nav class="ac-links"><a href="${APP.base}/tai-khoan">👤 Thông tin tài khoản</a><a href="${APP.base}/lich-su">🕘 Lịch sử nghe</a><a href="${APP.base}/thong-bao">🔔 Thông báo</a>${editorUrl ? `<a href="${esc(editorUrl)}" target="_self">✏️ Đăng truyện</a>` : ''}<a href="${APP.base}/bang-xep-hang">🏆 Bảng xếp hạng</a></nav>`;
    const av = $('.acct-btn');
    if (av) av.innerHTML = lvAv(me.name, me.avatar, L, 'acct-av');
    updateBell();
    tickCk();
  }

  function stopCk() { clearInterval(ckTimer); ckTimer = 0; }
  // Đếm ngược điểm danh: CHỈ chạy khi tab web đang hiện và đang được chọn (treo web rồi sang tab/ứng dụng khác thì dừng).
  // Thời gian được báo về máy chủ mỗi 15 giây; máy chủ là bên quyết định cuối cùng.
  let onlinePending = 0, onlineSending = false;
  const pageActive = () => !document.hidden && (!document.hasFocus || document.hasFocus());
  function sendOnline(force) {
    if (!me || me.demo || !game || game.checkedIn || onlineSending) return;
    const sec = Math.floor(onlinePending);
    if (sec < 1 || (!force && sec < 15 && ckLeftSec > 0)) return;
    onlineSending = true;
    onlinePending -= sec;
    api('/api/online', { sec }).then(r => {
      if (r && r.ok) { ckLeftSec = r.left; renderCk(); }
      else onlinePending += sec;
    }).finally(() => { onlineSending = false; });
  }
  function renderCk() {
    const left = Math.max(0, Math.ceil(ckLeftSec)), paused = left > 0 && !pageActive();
    const t = $('.ck-time'), b = $('.ck-btn');
    if (t) t.textContent = left ? ' · ' + fmt(left) + (paused ? ' (tạm dừng)' : '') : ' · Sẵn sàng!';
    if (b) { b.disabled = left > 0; b.classList.toggle('ready', !left); }
    const ql = $('.q-ck-left'), qb = $('.q-ck-btn');
    if (ql) ql.innerHTML = left ? `Mở web thêm <b>${fmt(left)}</b> để điểm danh${paused ? ' <i>(tạm dừng khi rời trang)</i>' : ''}` : 'Đã đủ thời gian, bấm <b>Điểm danh</b> để nhận';
    if (qb) qb.disabled = left > 0;
    return left;
  }
  function tickCk() {
    stopCk();
    if (!game || game.checkedIn) { const t = $('.ck-time'); if (t) t.textContent = ''; return; }
    let last = Date.now();
    const step = () => {
      const nowMs = Date.now(), dt = Math.min(2, (nowMs - last) / 1000);
      last = nowMs;
      if (ckLeftSec > 0 && pageActive()) {
        ckLeftSec = Math.max(0, ckLeftSec - dt);
        onlinePending += dt;
        if (ckLeftSec <= 0) sendOnline(true); else sendOnline(false);
      }
      if (!renderCk() && onlinePending < 1) {
        stopCk();
        if (!ckNotified) { ckNotified = true; updateBell(); }
      }
    };
    step();
    ckTimer = setInterval(step, 1000);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) sendOnline(true); renderCk(); });
  window.addEventListener('blur', () => { sendOnline(true); renderCk(); });
  window.addEventListener('focus', renderCk);

  function updateBell() {
    const n = (game ? game.unread : 0) + (game && !game.checkedIn && ckNotified ? 1 : 0);
    const b = $('.bell-n');
    if (b) { b.textContent = n > 9 ? '9+' : n; b.hidden = !n; }
  }

  const NOTIF_TEXT = {
    reply: n => `<b>${esc(n.actor || 'Ai đó')}</b> đã trả lời bình luận của bạn`,
    like: n => `<b>${esc(n.actor || 'Ai đó')}</b> đã thả tim bình luận của bạn ❤️`,
    approved: () => 'Bình luận của bạn đã được duyệt',
    levelup: () => '🎉 Đột phá thành công!',
    admin: () => '🛡️ Quản trị viên',
    withdraw: () => '💎 Rút Linh Thạch',
  };

  function renderNotifs() {
    const list = $('.np-list');
    if (!list) return;
    let html = '';
    if (game && !game.checkedIn && ckNotified) {
      html += `<button type="button" class="np-item unread" data-act="checkin"><span class="np-ico">🎁</span><span class="np-body"><span>Đã đến giờ <b>điểm danh</b> hôm nay! Nhận ${nf(game.ckStones || 10)} Linh Thạch.</span></span></button>`;
    }
    html += (notifs || []).map(notifItem).join('');
    list.innerHTML = html || '<p class="c-note">Chưa có thông báo nào.</p>';
  }

  // Bấm thông báo: bình luận → mở đúng truyện (khung bình luận); thông báo khác → trang Thông báo, xem chi tiết.
  const notifHref = n => n.slug ? `${APP.base}/track/${encodeURIComponent(n.slug)}#comments` : `${APP.base}/thong-bao?id=${n.id}`;
  const notifIco = n => n.actor ? lvAv(n.actor, n.actor_avatar, n.actor_badge, 'np-av') : `<span class="np-ico">${{ levelup: '⚡', admin: '💎', withdraw: '💸', approved: '✅' }[n.type] || '🔔'}</span>`;
  function notifItem(n) {
    return `<a class="np-item${n.is_read ? '' : ' unread'}" href="${notifHref(n)}">${notifIco(n)}<span class="np-body">
      <span>${(NOTIF_TEXT[n.type] || (() => ''))(n)}${n.text ? `: <q>${esc(n.text)}</q>` : ''}</span>
      <small>${cDate(n.created_at)}${n.title ? ' · ' + esc(n.title) : ''}</small></span></a>`;
  }

  // Trang Thông báo: toàn bộ thông báo (tải thêm khi kéo), xem chi tiết một thông báo qua ?id=.
  let nfState = null;
  function loadNotifPage() {
    const box = $('#notifs');
    if (!box || !meLoaded) return;
    const detail = $('#notif-detail');
    if (!me) {
      detail.innerHTML = '';
      box.innerHTML = '<div class="c-login"><p>Đăng nhập để xem thông báo.</p><button class="btn-play inline" type="button" data-act="login">Đăng nhập</button></div>';
      return;
    }
    if (box.dataset.loaded) return;
    box.dataset.loaded = '1';
    nfState = { before: 0, more: true, busy: false };
    box.innerHTML = '';
    const id = +(new URLSearchParams(location.search).get('id') || 0);
    if (id) {
      fetch(`${APP.base}/api/notifications?id=${id}`, { credentials: 'same-origin' }).then(r => r.json()).then(r => {
        const n = r && r.ok && r.items[0];
        detail.innerHTML = n ? `<div class="nf-detail">${notifIco(n)}<div>
          <b>${(NOTIF_TEXT[n.type] || (() => ''))(n)}</b>${n.text ? `<p>${esc(n.text)}</p>` : ''}
          <small>${cDate(n.created_at)} · ${new Date(n.created_at * 1000).toLocaleString('vi-VN')}</small>
          ${n.slug ? `<a class="q-btn" href="${notifHref(n)}">Mở truyện</a>` : ''}</div></div>` : '<p class="c-note">Không tìm thấy thông báo này.</p>';
      }).catch(() => {});
    } else detail.innerHTML = '';
    moreNotifs();
    if (game && game.unread) { api('/api/notifications', {}); game.unread = 0; updateBell(); }
  }
  function moreNotifs() {
    const box = $('#notifs');
    if (!box || !nfState || nfState.busy || !nfState.more) return;
    nfState.busy = true;
    const old = $('.nf-more', box); if (old) old.remove();
    fetch(`${APP.base}/api/notifications?limit=30${nfState.before ? '&before=' + nfState.before : ''}`, { credentials: 'same-origin' }).then(r => r.json()).then(r => {
      if (!r || !r.ok || $('#notifs') !== box) return;
      nfState.more = r.more;
      if (r.items.length) nfState.before = r.items[r.items.length - 1].id;
      box.insertAdjacentHTML('beforeend', r.items.map(notifItem).join(''));
      if (!box.querySelector('.np-item')) box.innerHTML = '<p class="c-note">Chưa có thông báo nào.</p>';
      else if (r.more) box.insertAdjacentHTML('beforeend', '<button type="button" class="nf-more" data-act="nf-more">Xem thêm thông báo cũ</button>');
    }).catch(() => {}).finally(() => { nfState.busy = false; });
  }

  function openNotifs() {
    const panel = $('.notif-panel');
    panel.hidden = !panel.hidden;
    if (panel.hidden) return;
    $('.acct-card').hidden = true;
    renderNotifs();
    fetch(`${APP.base}/api/notifications`, { credentials: 'same-origin' }).then(r => r.json()).then(r => {
      if (!r || !r.ok) return;
      notifs = r.items;
      r.items.forEach(n => shownNotifs.add(n.id));
      store.set('shown_notifs', [...shownNotifs].slice(-200));
      renderNotifs();
      if (game && game.unread) {
        api('/api/notifications', {});
        game.unread = 0;
        updateBell();
      }
    }).catch(() => {});
  }

  // ---------- Thông báo nhận thưởng ở góc dưới bên trái (trượt từ trái sang) ----------
  let lastLevelToast = 0;
  function rewardToast(html, icon = '★', ms = 4500) {
    const box = $('#rewards');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'rw';
    el.innerHTML = `<span class="rw-ico">${icon}</span><span class="rw-text">${html}</span><button type="button" class="rw-x" aria-label="Đóng">×</button>`;
    box.appendChild(el);
    while (box.children.length > 5) box.firstElementChild.remove();
    const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 350); };
    $('.rw-x', el).addEventListener('click', close);
    setTimeout(close, ms);
  }
  // Gộp hành động + mọi phần thưởng (EXP, Linh Thạch, đột phá) vào MỘT ô thông báo.
  function showRewards(list, title, icon = '🎉') {
    list = list || [];
    const sum = t => list.filter(r => r.type === t).reduce((n, r) => n + (r.n || 0), 0);
    const exp = sum('exp'), stones = sum('stones');
    const gains = [exp && `<b>+${nf(exp)}</b> kinh nghiệm`, stones && `<b>+${nf(stones)}</b> Linh Thạch`].filter(Boolean);
    const up = list.filter(r => r.type === 'levelup').pop();
    if (!title && !gains.length && !up) return;
    let html = title ? `Chúc mừng! ${title}` : 'Chúc mừng!';
    if (gains.length) html += ` và nhận ${gains.join(', ')}`;
    html += '!';
    if (up) {
      lastLevelToast = Date.now();
      html += `<br>⚡ Đột phá thành công: ${realmTag(up)} <b>Cấp ${up.lvl}</b>`;
    }
    rewardToast(html, up ? '⚡' : icon, up ? 7000 : 5000);
  }

  // Thông báo mới (được trả lời, thả tim, duyệt, lên cấp) cũng hiện ở góc, mỗi thông báo một lần.
  const shownNotifs = new Set(store.get('shown_notifs', []) || []);
  function toastNewNotifs() {
    fetch(`${APP.base}/api/notifications`, { credentials: 'same-origin' }).then(r => r.json()).then(r => {
      if (!r || !r.ok) return;
      notifs = r.items;
      const fresh = r.items.filter(n => !n.is_read && !shownNotifs.has(n.id)).slice(0, 4).reverse();
      const ICON = { reply: '💬', like: '❤️', approved: '✅', levelup: '⚡', admin: '💎', withdraw: '💸' };
      const lines = [];
      let icon = '🔔';
      fresh.forEach(n => {
        shownNotifs.add(n.id);
        if (n.type === 'levelup' && Date.now() - lastLevelToast < 300000) return;
        const withText = n.type === 'levelup' || n.type === 'admin' || n.type === 'withdraw';
        icon = ICON[n.type] || '🔔';
        lines.push(`${(NOTIF_TEXT[n.type] || (() => ''))(n)}${withText && n.text ? `: ${esc(n.text)}` : ''}`);
      });
      // Nhiều thông báo cùng lúc vẫn gộp trong một ô.
      if (lines.length) rewardToast(lines.length > 1 ? lines.map(l => '• ' + l).join('<br>') : lines[0], lines.length > 1 ? '🔔' : icon, 6000 + (lines.length - 1) * 1500);
      store.set('shown_notifs', [...shownNotifs].slice(-200));
    }).catch(() => {});
  }

  function doCheckin() {
    // Gửi nốt thời gian online chưa báo rồi mới điểm danh.
    const flush = onlinePending >= 1 && !onlineSending
      ? (() => { const sec = Math.floor(onlinePending); onlinePending -= sec; return api('/api/online', { sec }); })()
      : Promise.resolve();
    once('checkin', () => flush.then(() => api('/api/checkin', {})).then(r => {
      if (r && r.ok) {
        showRewards(r.rewards, 'Bạn đã điểm danh thành công', '📅');
        ckNotified = false;
        fetchMe();
      } else {
        if (r && r.wait) ckLeftSec = r.wait;
        toast((r && r.error) || 'Chưa điểm danh được');
        tickCk();
      }
    }));
  }

  function setMe(m, g) {
    if (m && g && g.unread > 0) setTimeout(toastNewNotifs, 600);
    const changed = (me && me.id) !== (m && m.id) || !$('.acct-btn') !== !m;
    const prevLvl = !changed && game && game.level ? game.level.lvl : 0;
    me = m || null;
    game = me ? (g || game) : null;
    if (prevLvl && game && game.level && game.level.lvl !== prevLvl) setTimeout(syncMyLevel);
    if (game) { ckLeftSec = Math.max(0, (game.checkinIn || 0) - onlinePending); if (game.checkedIn) ckNotified = false; }
    histCache = null;
    if (changed) renderAcct(); else renderGame();
    renderDemoBar();
    renderEditorNav();
  }

  // Biên tập viên: thêm "Đăng truyện" vào menu (đường dẫn /bien-tap, máy chủ chỉ mở cho đúng người có quyền).
  function renderEditorNav() {
    $$('.editor-link').forEach(a => a.remove());
    if (!editorUrl || !me) return;
    const html = `<a class="editor-link" href="${esc(editorUrl)}" target="_self">✏️ Đăng truyện</a>`;
    const mm = $('#mainmenu'), tn = $('.top-nav');
    if (mm) mm.insertAdjacentHTML('beforeend', html);
    if (tn) tn.insertAdjacentHTML('beforeend', html);
  }

  // Admin đang xem thử tài khoản thành viên: hiện thanh cảnh báo + nút thoát.
  function renderDemoBar() {
    let bar = $('#demoBar');
    if (!(me && me.demo)) { if (bar) bar.remove(); body.classList.remove('is-demo'); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'demoBar';
      bar.className = 'demo-bar';
      document.body.prepend(bar);
    }
    bar.innerHTML = `👁️ Đang xem thử tài khoản <b>${esc(me.name)}</b> (chế độ admin, chỉ xem) <button type="button" data-act="logout">Thoát</button>`;
    body.classList.add('is-demo');
  }

  // Cấp độ thay đổi (admin cộng EXP, lên cấp ở thiết bị khác…): cập nhật avatar/cảnh giới của mình đang hiện trên trang.
  function syncMyLevel() {
    if (!me || !game || !cState) return;
    const L = game.level, b = { lvl: L.lvl, tier: L.tier, realm: L.realm };
    cState.items.forEach(c => { if (c.mine) Object.assign(c, b); });
    if (cState.me) Object.assign(cState.me, b);
    $$('#comments .c-item').forEach(el => {
      const c = cState.items.find(x => String(x.id) === el.dataset.cid);
      if (!c || !c.mine) return;
      el.firstElementChild.outerHTML = lvAv(c.name, c.avatar, c, 'c-av');
      const name = $(':scope > .c-main > .c-bubble .c-name', el);
      if (name) name.innerHTML = `<b>${esc(c.name)}</b>${realmTag(c)}`;
    });
    $$('#comments .c-form').forEach(f => { f.firstElementChild.outerHTML = lvAv(me.name, me.avatar, L, 'c-av'); });
  }

  let meFetchedAt = 0;
  function fetchMe() {
    meFetchedAt = Date.now();
    return fetch(`${APP.base}/api/me`, { credentials: 'same-origin' }).then(r => r.json()).then(r => {
      if (!r || !r.ok) return;
      clientId = r.clientId || '';
      avatarMaxMb = r.avatarMaxMb || 5;
      editorUrl = (r.me && r.editorUrl) || '';
      setMe(r.me, r.game);
    }).catch(() => {}).finally(() => { meLoaded = true; applyServerResume(); loadHistory(); loadProfile(); loadQuests(); loadWithdraw(); loadNotifPage(); initRating(); initHeart(); });
  }

  // Đồng bộ EXP, Linh Thạch, cấp độ giữa các thiết bị: mỗi phút, và ngay khi quay lại tab/ứng dụng.
  setInterval(() => { if (me && !document.hidden) fetchMe(); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (me && !document.hidden && Date.now() - meFetchedAt > 10000) fetchMe();
  });

  function openLogin() {
    const m = $('#loginbox');
    m.hidden = false;
    const el = $('.login-g', m);
    if (clientId) renderGoogleButton(el, clientId);
    else el.innerHTML = '<span class="c-note">Đăng nhập Google chưa được bật.</span>';
  }

  function doLogout() {
    api('/api/auth/logout', {}).then(() => {
      setMe(null);
      toast('Đã đăng xuất');
      loadComments();
      loadHistory();
      loadProfile();
    });
  }

  // Lưu vị trí đang nghe lên tài khoản (90 giây/lần khi đang phát, ngay khi tạm dừng/rời trang).
  function syncHistory(mode) {
    if (!me || !cur || !audio.duration) return;
    const t = Date.now();
    if (!mode && t - lastHist < 90000) return;
    lastHist = t;
    const data = { track_id: cur.id, part: idx, pos: Math.floor(audio.currentTime), dur: Math.floor(audio.duration) };
    if (mode === 'beacon') beacon('/api/history', data); else api('/api/history', data);
    if (histCache) histCache = null;
  }

  function getHistory() {
    if (!me) return Promise.resolve(null);
    if (!histCache) histCache = fetch(`${APP.base}/api/history`, { credentials: 'same-origin' }).then(r => r.json()).catch(() => null);
    return histCache;
  }

  // Máy mới chưa có vị trí nghe: lấy từ lịch sử trên tài khoản.
  function applyServerResume() {
    if (!me || !pageTrack || store.get('lastidx_' + pageTrack.id) !== null) return;
    const id = pageTrack.id;
    getHistory().then(r => {
      const it = r && r.ok && r.items.find(x => x.id === id);
      if (!it || !pageTrack || pageTrack.id !== id || store.get('lastidx_' + id) !== null) return;
      store.set('lastidx_' + id, it.part);
      store.set(posKey(id, it.part), it.pos);
      updateResume();
      renderPage();
    });
  }

  function loadHistory() {
    const box = $('#history');
    if (!box || !meLoaded) return;
    const clearBtn = $('[data-act="hist-clear"]');
    if (!me) {
      clearBtn.hidden = true;
      box.innerHTML = '<div class="c-login"><p>Đăng nhập để lưu và xem lịch sử nghe trên mọi thiết bị.</p><button class="btn-play inline" type="button" data-act="login">Đăng nhập</button></div>';
      return;
    }
    histCache = null;
    getHistory().then(r => {
      if (!r || !r.ok || $('#history') !== box) return;
      clearBtn.hidden = !r.items.length;
      box.innerHTML = r.items.length ? r.items.map(it => {
        const pct = it.dur ? Math.min(100, it.pos / it.dur * 100) : 0;
        return `<div class="row hist-row" data-hid="${it.id}">
          <a class="row-icon" href="${APP.base}/track/${encodeURIComponent(it.slug)}" data-resume="${it.id}" data-part="${it.part}" data-pos="${it.pos}" aria-label="Nghe tiếp"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></a>
          <a class="row-body" href="${APP.base}/track/${encodeURIComponent(it.slug)}" data-resume="${it.id}" data-part="${it.part}" data-pos="${it.pos}">
            <span class="row-head"><b>${esc(it.title)}</b></span>
            <span class="meta">${it.nparts > 1 ? `Tập ${it.part + 1}/${it.nparts} · ` : ''}${fmt(it.pos)} / ${fmt(it.dur)} · ${cDate(it.at)}</span>
            <span class="hist-bar"><span style="width:${pct}%"></span></span>
          </a>
          <button class="hist-del" type="button" data-act="hist-del" aria-label="Xóa khỏi lịch sử">×</button>
        </div>`;
      }).join('') : '<p class="c-note">Bạn chưa nghe audio nào. Nghe xong sẽ hiện ở đây.</p>';
    });
  }

  let rateWarnAt = 0;
  // ---------- Bắn tim truyện (mỗi tài khoản 1 lần / truyện, không bỏ được) ----------
  function initHeart() {
    const box = $('.heart-box');
    if (!box || box.dataset.loaded || !meLoaded) return;
    box.dataset.loaded = '1';
    fetch(`${APP.base}/api/heart?track=${box.dataset.track}`, { credentials: 'same-origin' }).then(r => r.json()).then(r => {
      if (!r || !r.ok || $('.heart-box') !== box) return;
      $('.heart-n', box).textContent = nf(r.count);
      box.classList.toggle('on', !!r.mine);
    }).catch(() => {});
  }
  // Hiệu ứng: tim nhỏ bắn tung ra từ trái tim lớn.
  function heartBurst(btn) {
    const host = btn;
    const colors = ['#F2557A', '#FF7A9A', '#FFB3C4', '#E8738B', '#FFD1DC'];
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('i');
      p.className = 'heart-p';
      const ang = (-90 + (Math.random() * 150 - 75)) * Math.PI / 180, dist = 50 + Math.random() * 70;
      p.style.setProperty('--x', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--y', Math.sin(ang) * dist + 'px');
      p.style.setProperty('--r', (Math.random() * 60 - 30) + 'deg');
      p.style.setProperty('--s', (0.5 + Math.random() * 0.7).toFixed(2));
      p.style.color = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 120) + 'ms';
      host.appendChild(p);
      setTimeout(() => p.remove(), 1300);
    }
    btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
  }
  // Chống spam: bấm từ lần thứ 3 trở đi trong 2 giây thì bỏ qua hoàn toàn (không gửi máy chủ, không hiện thông báo);
  // thông báo "đã bắn tim" chỉ hiện tối đa 1 lần / 5 giây.
  const heartClicks = [];
  let heartToastAt = 0;
  function doHeart(btn) {
    const box = btn.closest('.heart-box');
    const t = Date.now();
    while (heartClicks.length && t - heartClicks[0] > 2000) heartClicks.shift();
    heartClicks.push(t);
    if (heartClicks.length >= 3) return;
    if (!me) { openLogin(); return; }
    if (box.classList.contains('on')) {
      heartBurst(btn);
      if (t - heartToastAt > 5000) { heartToastAt = t; toast('Bạn đã bắn tim truyện này rồi ❤️'); }
      return;
    }
    box.classList.add('on');
    heartBurst(btn);
    const n = $('.heart-n', box);
    n.textContent = nf((parseInt(n.textContent.replace(/\D/g, ''), 10) || 0) + 1);
    once('heart', () => api('/api/heart', { track_id: +box.dataset.track }).then(r => {
      if (!r || !r.ok) { box.classList.remove('on'); toast((r && r.error) || 'Chưa bắn tim được, thử lại sau'); initHeartReset(box); return; }
      n.textContent = nf(r.count);
      if (r.added) { showRewards(r.rewards, 'Bạn đã thả tim thành công', '❤️'); fetchMe(); }
    }));
  }
  function initHeartReset(box) { delete box.dataset.loaded; initHeart(); }

  // ---------- Đánh giá truyện ----------
  function initRating() {
    const box = $('.rating');
    if (!box || !me || box.dataset.loaded) return;
    box.dataset.loaded = '1';
    fetch(`${APP.base}/api/rate?track=${box.dataset.track}`, { credentials: 'same-origin' }).then(r => r.json()).then(r => {
      if (r && r.ok && r.mine && $('.rating') === box) showMine(box, r.mine);
    }).catch(() => {});
  }
  function showMine(box, n) {
    box.classList.add('rated');
    const m = $('.rate-mine', box);
    m.hidden = false;
    m.textContent = `Bạn đã chấm ${n}★`;
  }
  document.addEventListener('mouseover', e => {
    const b = e.target.closest('.rating:not(.rated) [data-star]');
    const box = e.target.closest('.rating');
    if (box) box.style.setProperty('--hover', b ? b.dataset.star * 10 + '%' : '');
    if (box) box.classList.toggle('hovering', !!b);
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('.rating [data-star]');
    if (!b) return;
    const box = b.closest('.rating');
    if (!me) { openLogin(); return; }
    // Đã đánh giá: báo 1 lần, bấm tiếp trong 10 giây thì im lặng và không gửi máy chủ (chống spam).
    if (box.classList.contains('rated')) {
      const t = Date.now();
      if (t - rateWarnAt > 10000) { rateWarnAt = t; toast('Bạn đã đánh giá truyện này rồi'); }
      return;
    }
    once('rate', () => api('/api/rate', { track_id: +box.dataset.track, stars: +b.dataset.star }).then(r => {
      if (!r || !r.ok) {
        if (r && /đã đánh giá/.test(r.error || '')) { box.classList.add('rated'); rateWarnAt = Date.now(); }
        if (!(r && r.silent)) toast((r && r.error) || 'Không gửi được đánh giá');
        return;
      }
      const avg = r.sum / r.count, pct = Math.round(avg * 10);
      $('.stars', box).style.setProperty('--pct', pct + '%');
      $('.rate-text', box).textContent = `${avg.toFixed(1).replace('.', ',')} (${pct}%) · ${r.count} đánh giá`;
      showMine(box, r.mine);
      showRewards(r.rewards, `Bạn đã đánh giá <b>${r.mine}★</b>`, '⭐');
      fetchMe();
    }));
  });

  // ---------- Thông tin tài khoản: đổi ảnh, đổi tên ----------
  function loadProfile() {
    const box = $('#profile');
    if (!box || !meLoaded) return;
    if (!me) {
      box.innerHTML = '<div class="c-login"><p>Đăng nhập để xem và sửa thông tin tài khoản.</p><button class="btn-play inline" type="button" data-act="login">Đăng nhập</button></div>';
      return;
    }
    const joined = me.created_at ? cDate(me.created_at).replace(/^ngày /, '') : '';
    box.innerHTML = `<div class="prof-card">
      <div class="prof-av">${avatar(me.name, me.avatar, 'prof-img')}
        <label class="prof-cam" aria-label="Đổi ảnh đại diện"><input type="file" accept="image/*" id="avatarFile" hidden>📷</label></div>
      <div class="prof-btns">
        <label class="btn-ghost sm"><input type="file" accept="image/*" class="avatar-input" hidden>Đổi ảnh</label>
        ${me.customAvatar ? '<button type="button" class="link-btn" data-act="avatar-reset">Dùng lại ảnh Google</button>' : ''}
      </div>
      <p class="prof-hint">Ảnh JPG, PNG, WebP. Tối đa ${String(avatarMaxMb).replace('.', ',')}MB.</p>
      <form class="prof-form" id="nameForm">
        <label>Tên hiển thị<input name="name" maxlength="40" value="${esc(me.name)}" autocomplete="nickname" required></label>
        <button class="btn-play inline" type="submit">Lưu tên</button>
      </form>
      <dl class="prof-info">
        ${me.email ? `<dt>Email</dt><dd>${esc(me.email)}</dd>` : ''}
        ${joined ? `<dt>Tham gia</dt><dd>${esc(joined)}</dd>` : ''}
        <dt>Đăng nhập bằng</dt><dd>Google</dd>
      </dl>
      <p class="prof-links"><a href="${APP.base}/lich-su">🕘 Lịch sử nghe</a> · <button type="button" class="link-btn" data-act="logout">Đăng xuất</button></p>
    </div>`;
  }

  // Cắt vuông giữa ảnh và nén còn 256×256 JPEG trước khi tải lên.
  function shrinkImage(file, size = 256) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
        g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        c.toBlob(b => (b ? resolve(b) : reject(new Error('nén lỗi'))), 'image/jpeg', 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('không đọc được ảnh')); };
      img.src = url;
    });
  }

  document.addEventListener('change', async e => {
    if (!e.target.matches('#profile input[type=file]')) return;
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Vui lòng chọn file ảnh'); return; }
    if (file.size > avatarMaxMb * 1024 * 1024) { toast(`Ảnh quá lớn, tối đa ${String(avatarMaxMb).replace('.', ',')}MB`); return; }
    let blob;
    try { blob = await shrinkImage(file); } catch (err) { toast('Không đọc được ảnh này, thử ảnh khác'); return; }
    const fd = new FormData();
    fd.append('avatar', blob, 'avatar.jpg');
    toast('Đang tải ảnh lên…');
    try {
      const r = await (await fetch(`${APP.base}/api/profile/avatar`, { method: 'POST', body: fd, credentials: 'same-origin' })).json();
      if (!r.ok) { toast(r.error || 'Tải ảnh không thành công'); return; }
      me.avatar = r.avatar; me.customAvatar = true;
      renderAcct(); loadProfile(); toast('Đã đổi ảnh đại diện');
    } catch (err) { toast('Tải ảnh không thành công'); }
  });

  document.addEventListener('submit', e => {
    if (e.target.id !== 'nameForm') return;
    e.preventDefault();
    const name = new FormData(e.target).get('name').trim();
    api('/api/profile', { name }).then(r => {
      if (!r || !r.ok) { toast((r && r.error) || 'Không lưu được tên'); return; }
      me.name = r.name; renderAcct(); loadProfile(); toast('Đã lưu tên mới');
    });
  });

  document.addEventListener('click', e => {
    if (e.target.closest('.top-search')) { e.preventDefault(); e.stopPropagation(); openTopSearch(); return; }
    const ov = $('#topsearch');
    if (ov && !e.target.closest('#topsearch')) closeTopSearch();
  }, true);

  // Bấm "Nghe tiếp" trong lịch sử: đặt sẵn vị trí để trang audio phát tiếp đúng chỗ.
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-resume]');
    if (!a) return;
    store.set('lastidx_' + a.dataset.resume, +a.dataset.part);
    store.set(posKey(+a.dataset.resume, +a.dataset.part), +a.dataset.pos);
  }, true);

  // ---------- Bình luận + đăng nhập Google ----------
  const EMOJIS = ['😂', '🤣', '😍', '🥰', '😘', '😊', '😁', '😅', '😢', '😭', '😡', '😤', '😱', '🤔', '😴', '🥺', '👍', '👏', '🙏', '💪', '❤️', '💔', '🔥', '🎧'];
  const AV_COLORS = ['#e91e63', '#9c27b0', '#3f51b5', '#0288d1', '#00897b', '#43a047', '#f4511e', '#6d4c41', '#546e7a', '#d81b60'];
  let cState = null;
  let gsiPromise = null, gsiClient = '';

  function avatar(name, url, cls = 'c-av') {
    if (url) return `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
    const n = String(name || '?').trim();
    let hsh = 0;
    for (const ch of n) hsh = (hsh * 31 + ch.codePointAt(0)) >>> 0;
    const letters = Array.from(n)[0].toUpperCase();
    return `<span class="${cls}" style="background:${AV_COLORS[hsh % AV_COLORS.length]}">${esc(letters)}</span>`;
  }

  function cDate(ts) {
    const diff = Date.now() / 1000 - ts;
    if (diff < 60) return 'vừa xong';
    if (diff < 3600) return Math.floor(diff / 60) + ' phút trước';
    if (diff < 86400) return Math.floor(diff / 3600) + ' giờ trước';
    const d = new Date(ts * 1000 + 7 * 3600e3);
    return `ngày ${d.getUTCDate()} tháng ${d.getUTCMonth() + 1}, ${d.getUTCFullYear()}`;
  }

  function cItem(c) {
    return `<div class="c-item${c.parent ? ' c-reply' : ''}" data-cid="${c.id}">
      ${lvAv(c.name, c.avatar, c.lvl ? c : null, 'c-av')}
      <div class="c-main">
        <div class="c-bubble"><span class="c-name"><b>${esc(c.name)}</b>${c.lvl ? realmTag(c) : ''}</span><p>${esc(c.body).replace(/\n/g, '<br>')}</p>
          <span class="c-hearts"${c.likes ? '' : ' hidden'}>❤️ <b>${c.likes}</b></span></div>
        <div class="c-actions">
          <span>${cDate(c.at)}</span>
          ${c.pending ? '<span class="c-pending">Đang chờ duyệt</span>' : `<button type="button" data-c="like" class="${c.liked ? 'on' : ''}">Thích</button>
          <button type="button" data-c="reply">Trả lời</button>`}
          ${cState && cState.me && cState.me.id === 1 ? '<button type="button" data-c="del">Xóa</button>' : ''}
        </div>
        ${c.parent ? '' : '<div class="c-replies"></div>'}
      </div>
    </div>`;
  }

  function composeHtml(parent = 0, placeholder = '') {
    const me = cState.me;
    const ph = placeholder || ('Viết bình luận...' + (cState.config.moderation ? ' (sẽ hiện sau khi duyệt)' : ''));
    return `<form class="c-form" data-parent="${parent}">
      ${lvAv(me.name, me.avatar, game ? game.level : null, 'c-av')}
      <div class="c-field">
        <textarea rows="1" maxlength="1000" placeholder="${esc(ph)}" aria-label="Nội dung bình luận"></textarea>
        <button type="button" class="c-ico" data-c="emoji" aria-label="Chèn emoji">😊</button>
        <button type="submit" class="c-send" aria-label="Gửi"><svg viewBox="0 0 24 24"><path d="M3 20.5 21 12 3 3.5V10l12 2-12 2z"/></svg></button>
        <div class="c-emojis" hidden>${EMOJIS.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
      </div>
    </form>`;
  }

  function renderComments() {
    const sec = $('#comments');
    if (!sec || !cState) return;
    const cMe = cState.me, config = cState.config, items = cState.items;
    if (!config.enabled) { sec.hidden = true; return; }
    $('.c-count', sec).textContent = `(${cState.total})`;
    const compose = $('.c-compose', sec);
    if (cMe && cMe.banned) compose.innerHTML = '<p class="c-note">Tài khoản của bạn đã bị khóa bình luận.</p>';
    else if (cMe) compose.innerHTML = composeHtml() + `<p class="c-who">Đang bình luận với tên <b>${esc(cMe.name)}</b> · <button type="button" data-c="logout">Đăng xuất</button></p>`;
    else {
      compose.innerHTML = `<div class="c-login"><p>Đăng nhập để bình luận, thả tim và nhận Linh Thạch</p><div class="g-btn" data-label="Đăng nhập Google để bình luận"></div></div>`;
      if (config.clientId) renderGoogleButton($('.g-btn', compose), config.clientId);
      else $('.g-btn', compose).innerHTML = '<span class="c-note">Đăng nhập Google chưa được bật.</span>';
    }
    const tops = items.filter(c => !c.parent);
    const list = $('.c-list', sec);
    list.innerHTML = tops.length ? tops.map(cItem).join('') : '<p class="c-note">Chưa có bình luận nào. Hãy là người đầu tiên!</p>';
    items.filter(c => c.parent).sort((a, b) => a.at - b.at).forEach(r => {
      const box = $(`.c-item[data-cid="${r.parent}"] .c-replies`, list);
      if (box) box.insertAdjacentHTML('beforeend', cItem(r));
    });
  }

  function loadComments() {
    const sec = $('#comments');
    if (!sec) return;
    fetch(`${APP.base}/api/comments?track=${sec.dataset.track}`, { credentials: 'same-origin' }).then(r => r.json()).then(r => {
      if (!r || !r.ok || $('#comments') !== sec) return;
      cState = r;
      if ((r.me && (!me || me.id !== r.me.id)) || (!r.me && me)) setMe(r.me);
      renderComments();
    }).catch(() => { $('.c-list', sec).innerHTML = '<p class="c-note">Không tải được bình luận.</p>'; });
  }

  function initComments() {
    const sec = $('#comments');
    cState = null;
    if (!sec) return;
    if (!('IntersectionObserver' in window)) return loadComments();
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { io.disconnect(); loadComments(); }
    }, { rootMargin: '600px 0px' });
    io.observe(sec);
  }

  function loadGsi() {
    if (!gsiPromise) {
      gsiPromise = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = 'https://accounts.google.com/gsi/client';
        sc.async = true; sc.onload = resolve; sc.onerror = reject;
        document.head.appendChild(sc);
      });
    }
    return gsiPromise;
  }

  // Nút đăng nhập: nút đẹp theo giao diện web, nút thật của Google phủ trong suốt lên trên (bấm vẫn là nút Google).
  const G_LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  async function renderGoogleButton(el, clientId, label) {
    const text = label || el.dataset.label || 'Đăng nhập bằng Google';
    el.classList.add('g-wrap');
    el.innerHTML = `<span class="g-fake">${G_LOGO}<span>${esc(text)}</span></span><span class="g-real"></span>`;
    const real = $('.g-real', el);
    const blocked = msg => {
      real.remove();
      el.onclick = () => toast(msg);
    };
    try {
      await loadGsi();
      if (gsiClient !== clientId) {
        google.accounts.id.initialize({ client_id: clientId, callback: onGoogleCredential, cancel_on_tap_outside: true, use_fedcm_for_prompt: true });
        gsiClient = clientId;
      }
      google.accounts.id.renderButton(real, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', locale: 'vi',
        width: Math.max(200, Math.min(400, el.clientWidth || 320)) });
      setTimeout(() => {
        if (el.isConnected && !real.querySelector('iframe, div[role=button]')) blocked('Không hiện được nút Google. Hãy tắt trình chặn quảng cáo cho trang này rồi tải lại.');
      }, 6000);
    } catch (e) {
      blocked('Không tải được đăng nhập Google. Hãy kiểm tra mạng hoặc tắt trình chặn quảng cáo rồi tải lại.');
    }
  }

  function onGoogleCredential(resp) {
    api('/api/auth/google', { credential: resp.credential }).then(r => {
      if (r && r.ok) {
        toast('Xin chào ' + r.me.name + '!');
        $('#loginbox').hidden = true;
        setMe(r.me);
        loadComments();
        loadHistory();
        loadProfile();
        applyServerResume();
      }
      else toast((r && r.error) || 'Đăng nhập không thành công');
    });
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-c], [data-emoji]');
    if (!b || !b.closest('#comments')) {
      if (!e.target.closest('.c-emojis')) $$('.c-emojis').forEach(x => { x.hidden = true; });
      return;
    }
    if (b.dataset.emoji) {
      const ta = $('textarea', b.closest('.c-form'));
      const st = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
      ta.value = ta.value.slice(0, st) + b.dataset.emoji + ta.value.slice(ta.selectionEnd != null ? ta.selectionEnd : st);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = st + b.dataset.emoji.length;
      return;
    }
    const item = b.closest('.c-item');
    const id = item ? +item.dataset.cid : 0;
    switch (b.dataset.c) {
      case 'emoji': {
        const pop = $('.c-emojis', b.closest('.c-form'));
        pop.hidden = !pop.hidden;
        return;
      }
      case 'logout':
        doLogout();
        return;
      case 'like': {
        if (!cState.me) { toast('Đăng nhập để thích bình luận'); $('#comments').scrollIntoView({ behavior: 'smooth' }); return; }
        once('like' + id, () => api('/api/comments/like', { id }).then(r => {
          if (!r || !r.ok) { if (r && r.error) toast(r.error); return; }
          b.classList.toggle('on', r.liked);
          const hearts = $(':scope > .c-main > .c-bubble .c-hearts', item);
          hearts.hidden = !r.likes;
          $('b', hearts).textContent = r.likes;
        }));
        return;
      }
      case 'reply': {
        if (!cState.me) { toast('Đăng nhập để trả lời'); return; }
        const root = item.classList.contains('c-reply') ? item.parentElement.closest('.c-item') : item;
        const box = $(':scope > .c-main > .c-replies', root);
        let f = $(':scope > .c-form', box);
        if (!f) {
          box.insertAdjacentHTML('beforeend', composeHtml(id, 'Viết câu trả lời...'));
          f = $(':scope > .c-form', box);
        }
        const name = $('.c-name b', item).textContent;
        const ta = $('textarea', f);
        if (item !== root && !ta.value) ta.value = '@' + name + ' ';
        ta.focus();
        return;
      }
      case 'del':
        if (!confirm('Xóa bình luận này?')) return;
        api('/api/comments/delete', { id }).then(r => { if (r && r.ok) { toast('Đã xóa'); loadComments(); } });
    }
  });

  document.addEventListener('input', e => {
    if (e.target.matches('.c-form textarea')) {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px';
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.c-form textarea') && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      e.target.closest('.c-form').requestSubmit();
    }
  });
  document.addEventListener('submit', e => {
    const f = e.target;
    if (!f.classList.contains('c-form')) return;
    e.preventDefault();
    const ta = $('textarea', f), btn = $('.c-send', f);
    const body = ta.value.trim();
    if (!body || btn.disabled) return;
    btn.disabled = true;
    api('/api/comments', { track_id: +$('#comments').dataset.track, parent_id: +f.dataset.parent, body }).then(r => {
      btn.disabled = false;
      if (!r || !r.ok) { toast((r && r.error) || 'Không gửi được, thử lại sau'); return; }
      ta.value = ''; ta.style.height = '';
      cState.items.unshift(r.item);
      if (!r.item.pending) cState.total++;
      renderComments();
      if (r.item.pending) rewardToast('Đã gửi bình luận, bình luận sẽ hiện sau khi được duyệt.', '💬', 5000);
      else { showRewards(r.rewards, 'Bạn đã bình luận thành công', '💬'); fetchMe(); }
    });
  });

  // ---------- Khởi động ----------
  const last = store.get('last');
  if (last && last.track && last.track.parts && last.track.parts.length) load(last.track, last.idx || 0);
  initPage();
  focusSearchFromHash();
  fetchMe();
})();
