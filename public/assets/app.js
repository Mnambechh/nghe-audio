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
  let speed = SPEEDS.includes(store.get('speed')) ? store.get('speed') : 1;
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
    audio.playbackRate = speed;
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
    $('.pl-speed', player).classList.toggle('on', speed !== 1);
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
        artist: cur.parts.length > 1 ? `Phần ${idx + 1}/${cur.parts.length}` : document.querySelector('.brand span:last-child').textContent,
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
  audio.addEventListener('loadedmetadata', () => {
    audio.playbackRate = speed;
    if (pendingSeek > 0 && pendingSeek < audio.duration - 3) audio.currentTime = pendingSeek;
    pendingSeek = 0;
    renderTime();
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
    ping(false);
  });
  audio.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - lastPos > 250) { lastPos = now; renderTime(); }
    if (now - lastSave > 5000) { lastSave = now; savePos(); }
    if (!audio.paused && now - lastPing > 60000) ping(true);
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
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    body.classList.remove('is-loading', 'is-playing');
    toast('Không tải được audio, vui lòng thử lại sau');
  });
  setInterval(() => {
    if (timer) checkTimer();
    if (cur && !audio.paused && Date.now() - lastPing > 60000) ping(true);
  }, 1000);
  window.addEventListener('pagehide', () => { savePos(); if (!audio.paused) ping(false); });

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
    if (pageTrack) {
      const li = Math.min(store.get('lastidx_' + pageTrack.id, 0) || 0, pageTrack.parts.length - 1);
      const pos = store.get(posKey(pageTrack.id, li), 0);
      const btn = $('.btn-play[data-act="play-track"]');
      const res = $('.resume');
      if (btn && pos > 20) {
        btn.dataset.part = li;
        $('span', btn).textContent = 'Nghe tiếp';
        res.hidden = false;
        res.textContent = `Bạn đang nghe dở${pageTrack.parts.length > 1 ? ' phần ' + (li + 1) : ''} ở ${fmt(pos)}`;
      }
      renderPage();
    }
    refreshLive();
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
        audio.playbackRate = speed;
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
    const pop = $('#timerpop');
    if (pop && !pop.hidden && !e.target.closest('#timerpop, [data-act="timer-pop"], [data-act="timer-open"]')) pop.hidden = true;
    if (e.target.closest('.sg-item, .sg-all')) { hideSuggest(); return; }
    if (!e.target.closest('.searchbox')) hideSuggest();
  });

  function focusSearchFromHash() {
    if (location.hash !== '#search') return;
    const inp = $('#search');
    if (!inp) return;
    inp.scrollIntoView({ block: 'center' });
    inp.focus({ preventScroll: true });
  }
  window.addEventListener('hashchange', focusSearchFromHash);

  // ---------- Khởi động ----------
  const last = store.get('last');
  if (last && last.track && last.track.parts && last.track.parts.length) load(last.track, last.idx || 0);
  initPage();
  focusSearchFromHash();
})();
