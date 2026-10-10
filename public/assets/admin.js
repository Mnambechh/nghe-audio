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
