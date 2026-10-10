// Bấm vào số tài khoản / tên để sao chép (trang Rút Linh Thạch).
document.addEventListener('click', e => {
  const c = e.target.closest('[data-copy]');
  if (!c || !navigator.clipboard) return;
  navigator.clipboard.writeText(c.dataset.copy).then(() => {
    c.classList.add('copied');
    setTimeout(() => c.classList.remove('copied'), 1200);
  });
});

// Hỏi xác nhận trước khi xóa/chặn (thay cho onsubmit nội tuyến, vì CSP chặn script nội tuyến).
document.addEventListener('submit', e => {
  const f = e.target;
  const btn = e.submitter;
  const msg = (btn && btn.dataset.confirm) || f.dataset.confirm;
  if (msg && !confirm(msg)) e.preventDefault();
});

(() => {
  'use strict';
  const box = document.getElementById('parts');
  if (!box) return;

  const fmt = s => {
    s = Math.round(s);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };

  function renumber() {
    box.querySelectorAll('.part-row').forEach((r, i) => { r.querySelector('.pno').textContent = i + 1; });
  }

  function addRow(url = '') {
    const tpl = box.querySelector('.part-row');
    const row = tpl.cloneNode(true);
    row.querySelectorAll('input').forEach(i => { i.value = ''; i.classList.remove('bad', 'loading'); });
    row.querySelector('.purl').value = url;
    box.appendChild(row);
    renumber();
    if (url) detect(row);
    return row;
  }

  // Tự lấy thời lượng từ link audio (chỉ đọc phần đầu file).
  function detect(row) {
    const url = row.querySelector('.purl').value.trim();
    const dur = row.querySelector('.pdur');
    if (!/^https?:\/\//i.test(url) || (dur.dataset.src === url && dur.value)) return;
    dur.dataset.src = url;
    dur.classList.add('loading');
    dur.classList.remove('bad');
    const a = new Audio();
    a.preload = 'metadata';
    const done = ok => {
      dur.classList.remove('loading');
      if (ok && isFinite(a.duration) && a.duration > 0) dur.value = fmt(a.duration);
      else { dur.classList.add('bad'); dur.title = 'Không đọc được thời lượng. Kiểm tra lại link, hoặc tự nhập.'; }
      a.removeAttribute('src'); a.load();
    };
    a.addEventListener('loadedmetadata', () => done(true), { once: true });
    a.addEventListener('error', () => done(false), { once: true });
    setTimeout(() => { if (dur.classList.contains('loading')) done(false); }, 20000);
    a.src = url;
  }

  box.addEventListener('change', e => {
    if (e.target.classList.contains('purl')) detect(e.target.closest('.part-row'));
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const row = b.closest('.part-row');
    if (b.dataset.p === 'up' && row.previousElementSibling) box.insertBefore(row, row.previousElementSibling);
    if (b.dataset.p === 'down' && row.nextElementSibling) box.insertBefore(row.nextElementSibling, row);
    if (b.dataset.p === 'del') {
      if (box.children.length > 1) row.remove();
      else row.querySelectorAll('input').forEach(i => { i.value = ''; });
    }
    renumber();
  });

  document.getElementById('addPart').addEventListener('click', () => addRow().querySelector('.purl').focus());
  document.getElementById('bulkToggle').addEventListener('click', () => {
    const b = document.getElementById('bulk');
    b.hidden = !b.hidden;
  });
  document.getElementById('bulkAdd').addEventListener('click', () => {
    const t = document.getElementById('bulkText');
    const urls = t.value.split(/\s+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s));
    urls.forEach(u => {
      const empty = Array.from(box.querySelectorAll('.purl')).find(i => !i.value.trim());
      if (empty) { empty.value = u; detect(empty.closest('.part-row')); } else addRow(u);
    });
    t.value = '';
    document.getElementById('bulk').hidden = true;
  });

  // Nếu còn đang lấy thời lượng thì đợi xong rồi tự lưu.
  const form = document.getElementById('trackForm');
  form.addEventListener('submit', e => {
    if (!box.querySelector('.pdur.loading')) return;
    e.preventDefault();
    const btn = e.submitter;
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Đang lấy thời lượng...'; }
    const wait = setInterval(() => {
      if (box.querySelector('.pdur.loading')) return;
      clearInterval(wait);
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; }
      form.requestSubmit ? form.requestSubmit(btn || undefined) : form.submit();
    }, 200);
  });

  // Phần chưa có thời lượng thì lấy lại khi mở form sửa.
  box.querySelectorAll('.part-row').forEach(r => {
    if (r.querySelector('.purl').value && !r.querySelector('.pdur').value) detect(r);
  });
})();

// Danh sách thành viên: chọn tất cả.
document.addEventListener('change', e => {
  if (e.target.id !== 'checkAll') return;
  document.querySelectorAll('input[name=ids]').forEach(c => { c.checked = e.target.checked; });
});

// Form audio: đếm ký tự SEO + xem trước kết quả Google.
(() => {
  const form = document.getElementById('trackForm');
  if (!form) return;
  const $ = n => form.querySelector(`[name="${n}"]`);
  const update = () => {
    form.querySelectorAll('.seo-count').forEach(c => {
      const v = ($(c.dataset.for).value || '').length, max = +c.dataset.max;
      c.textContent = `${v}/${max}`;
      c.style.color = v > max ? '#c0392b' : v >= max * 0.6 ? '#0d6b43' : '';
    });
    const title = $('seo_title').value.trim() || `${$('title').value.trim() || 'Tên truyện'} - Nghe Audio Full Miễn Phí`;
    const desc = $('seo_desc').value.trim() || $('description').value.trim().replace(/\s+/g, ' ').slice(0, 155) || `Nghe ${$('title').value.trim() || 'truyện'} audio full miễn phí, giọng đọc truyền cảm…`;
    const t = form.querySelector('.serp-title'), d = form.querySelector('.serp-desc');
    if (t) t.textContent = title.length > 62 ? title.slice(0, 60) + '…' : title;
    if (d) d.textContent = desc.length > 160 ? desc.slice(0, 158) + '…' : desc;
  };
  form.addEventListener('input', update);
  update();
})();

// Ảnh bìa truyện: chỉ nhận ảnh cơ bản (JPG/PNG/WebP/GIF/BMP), thu nhỏ còn tối đa 1000px rồi nén sang WebP ngay trên trình duyệt.
(() => {
  const input = document.getElementById('coverFile');
  if (!input) return;
  const form = input.closest('form');
  const out = form.querySelector('[name=cover_data]');
  const prev = form.querySelector('.cover-prev');
  const info = form.querySelector('.cover-info');
  const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
  const OK_EXT = /\.(jpe?g|png|webp|gif|bmp)$/i;
  const fmtKB = n => n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB';
  // Kiểm tra chữ ký file thật (không tin đuôi file / MIME do trình duyệt đoán).
  const magicOk = b => (b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    || (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) || (b[0] === 0x42 && b[1] === 0x4d)
    || (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50);
  const readAs = (file, how) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r[how](file); });
  const loadImg = src => new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = src; });
  const toData = (canvas, type, q) => canvas.toDataURL(type, q);

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    out.value = '';
    if (!file) return;
    const fail = msg => { info.innerHTML = `<b style="color:#c0392b">${msg}</b>`; input.value = ''; };
    if (!OK_TYPES.includes(file.type) || !OK_EXT.test(file.name)) return fail('Chỉ nhận ảnh JPG, PNG, WebP, GIF, BMP.');
    try {
      const head = new Uint8Array(await readAs(file.slice(0, 16), 'readAsArrayBuffer'));
      if (!magicOk(head)) return fail('File không phải ảnh hợp lệ.');
      info.textContent = 'Đang nén ảnh…';
      const img = await loadImg(await readAs(file, 'readAsDataURL'));
      const MAX = 1000, k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // Giảm chất lượng dần đến khi ≤ 350KB. Trình duyệt quá cũ không nén được WebP thì dùng JPEG.
      let type = 'image/webp', data = toData(c, type, 0.85);
      if (!data.startsWith('data:image/webp')) { type = 'image/jpeg'; data = toData(c, type, 0.85); }
      for (let q = 0.75; data.length * 0.75 > 350 * 1024 && q >= 0.4; q -= 0.1) data = toData(c, type, q);
      out.value = data;
      prev.innerHTML = `<img src="${data}" alt="">`;
      const rm = form.querySelector('[name=cover_remove]'); if (rm) rm.checked = false;
      info.innerHTML = `Đã nén: ${fmtKB(file.size)} → <b>${fmtKB(Math.round(data.length * 0.75))}</b> (${type === 'image/webp' ? '.webp' : '.jpg'}, ${c.width}×${c.height}). Bấm Lưu để đăng.`;
    } catch (e) {
      fail('Không đọc được ảnh này, hãy thử ảnh khác.');
    }
  });
})();
