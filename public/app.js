const $ = (s) => document.querySelector(s);
const STATUS = {
  pending: 'รอพิจารณา', assigned: 'มอบหมายแล้ว', in_progress: 'กำลังดำเนินการ',
  done: 'เสร็จสิ้น', closed: 'ปิดเรื่อง', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก',
};
let me = null;

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch('/api' + path, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && me && path !== '/auth/login') {
    me = null; renderShell(); toast('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', 'error');
  }
  if (!res.ok) throw new Error(data.error || data.message || 'เกิดข้อผิดพลาด');
  return data;
}
const can = (p) => !!me && me.permissions.includes(p);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => new Date(d).toLocaleString('th-TH-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' });
function toast(msg, kind = 'info') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
const alertErr = (e) => toast(e.message, 'error');

function renderShell() {
  $('#login').classList.toggle('hidden', !!me);
  $('#app').classList.toggle('hidden', !me);
  if (!me) return;
  $('#userName').textContent = me.name;
  $('#hello').textContent = 'สวัสดี ' + me.name;
  document.querySelector('.work-grid').classList.toggle('solo', !can('request.create'));
  $('#adminLink').classList.toggle('hidden', !can('user.manage'));
  document.querySelectorAll('[data-perm]').forEach((el) =>
    el.classList.toggle('hidden', !can(el.dataset.perm)));
  if (can('request.create')) loadOptions().catch(alertErr);
  loadRequests().catch(alertErr);
  loadAnnouncements().catch(() => {});
  loadNotifications().catch(() => {});
  if (can('dashboard.view')) loadDashboard().catch(alertErr);
}

// ===== เข้าสู่ระบบ / สมัครสมาชิก =====
function showLoginForm(which) {
  $('#loginForm').classList.toggle('hidden', which !== 'login');
  $('#registerForm').classList.toggle('hidden', which !== 'register');
}
$('#toRegister').onclick = (e) => { e.preventDefault(); showLoginForm('register'); };
$('#toLogin').onclick = (e) => { e.preventDefault(); showLoginForm('login'); };

$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#loginError').className = 'error';
  try {
    await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    me = await api('/auth/me');
    e.target.reset();
    $('#loginError').textContent = '';
    renderShell();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
};

$('#registerForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const msg = $('#registerError');
  msg.textContent = '';
  if (f.password !== f.confirm) {
    msg.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
    return;
  }
  try {
    await api('/auth/register', { method: 'POST', body: {
      contract_no: f.contract_no.trim().toUpperCase(),
      name: f.name.trim(),
      username: f.username.trim(),
      password: f.password,
    } });
    e.target.reset();
    showLoginForm('login');
    $('#loginError').className = 'success';
    $('#loginError').textContent = 'สมัครสำเร็จ กรุณาเข้าสู่ระบบ';
  } catch (err) {
    msg.textContent = err.message;
  }
};

$('#logoutBtn').onclick = async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
};

// ===== ตัวเลือกฟอร์มแจ้งซ่อม =====
async function loadOptions() {
  const o = await api('/requests/options');
  $('#unitLabel').textContent = o.unit ? o.unit.unit_no : 'ยังไม่ได้ผูกห้อง';
  $('#categorySel').innerHTML = '<option value="">— เลือกประเภทงาน —</option>' +
    o.categories.map((c) =>
      `<option value="${c.id}" data-req="${c.requires_detail}">${esc(c.name)}${c.requires_detail ? ' *' : ''}</option>`
    ).join('');
  $('#areaSel').innerHTML = '<option value="">— เลือกพื้นที่ส่วนกลาง —</option>' +
    o.commonAreas.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
}

$('#categorySel').onchange = () => {
  const needed = $('#categorySel').selectedOptions[0]?.dataset.req === 'true';
  $('#descInput').required = needed;
  $('#descLabel').textContent = needed ? 'รายละเอียด (จำเป็น) *' : 'รายละเอียดเพิ่มเติม (ไม่บังคับ)';
};

$('#createForm').addEventListener('change', (e) => {
  if (e.target.name === 'location_type')
    $('#areaWrap').classList.toggle('hidden', e.target.value !== 'common');
});

$('#createForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const msg = $('#createMsg');
  msg.className = 'muted';

  if (!f.category_id) return showMsg(msg, 'กรุณาเลือกประเภทงาน');
  if (f.location_type === 'common' && !f.common_area_id) {
    return showMsg(msg, 'กรุณาเลือกพื้นที่ส่วนกลาง');
  }

  const body = {
    category_id: Number(f.category_id),
    priority: f.priority,
    location_type: f.location_type,
    description: f.description || '',
  };
  if (f.location_type === 'common') body.common_area_id = Number(f.common_area_id);

  try {
    await api('/requests', { method: 'POST', body });
    e.target.reset();
    $('#areaWrap').classList.add('hidden');
    msg.className = 'success';
    msg.textContent = 'ส่งคำขอเรียบร้อยแล้ว';
    toast('ส่งคำขอเรียบร้อยแล้ว');
    loadRequests().catch(alertErr);
  } catch (err) {
    showMsg(msg, err.message);
  }
};

function showMsg(el, text) {
  el.className = 'error';
  el.textContent = text;
}

// ===== รายการแจ้งซ่อม =====
$('#statusFilter').innerHTML = '<option value="">ทุกสถานะ</option>' +
  Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
let allRows = [];
$('#statusFilter').onchange = () => renderRows();
$('#searchBox').oninput = () => renderRows();

async function loadRequests() {
  allRows = await api('/requests');
  renderSummary();
  renderRows();
}

function renderSummary() {
  const n = (...st) => allRows.filter((r) => st.includes(r.status)).length;
  const cell = (v, l, c = '') => `<div class="sum ${c}"><b>${v}</b><span>${l}</span></div>`;
  $('#summary').innerHTML =
    cell(n('pending'), 'รอพิจารณา') +
    cell(n('assigned', 'in_progress'), 'กำลังดำเนินการ', 'open') +
    cell(n('done'), 'รอยืนยันปิดเรื่อง', 'wait') +
    cell(n('closed'), 'ปิดเรื่องแล้ว', 'ok');
}

function renderRows() {
  const s = $('#statusFilter').value;
  const q = $('#searchBox').value.trim().toLowerCase();
  const rows = allRows.filter((r) => (!s || r.status === s) && (!q ||
    [`#${r.id}`, r.category, r.location, r.requester_name, r.technician_name]
      .some((v) => String(v ?? '').toLowerCase().includes(q))));
  $('#rows').innerHTML = rows.length
    ? rows.map((r) => `<tr data-id="${r.id}">
        <td>#${r.id}</td>
        <td>${esc(r.category)}${r.priority === 'urgent' ? '<span class="badge urgent">ด่วน</span>' : ''}</td>
        <td>${esc(r.location)}</td>
        <td>${esc(r.requester_name)}</td>
        <td>${esc(r.technician_name || '—')}</td>
        <td><span class="badge s-${r.status}">${STATUS[r.status]}</span></td>
        <td class="muted">${fmtDate(r.created_at)}</td>
      </tr>`).join('')
    : `<tr><td colspan="7" class="empty">${allRows.length ? 'ไม่พบรายการที่ตรงกับตัวกรอง' : 'ยังไม่มีรายการแจ้งเรื่อง'}</td></tr>`;
}

const FLOW = ['pending', 'assigned', 'in_progress', 'done', 'closed'];
function progress(st) {
  const i = FLOW.indexOf(st);
  if (i < 0) return `<p class="muted">${st === 'rejected' ? 'เรื่องนี้ไม่ได้รับอนุมัติ' : 'เรื่องนี้ถูกยกเลิกแล้ว'}</p>`;
  return `<ol class="flow">${FLOW.map((k, j) =>
    `<li class="${j < i ? 'past' : j === i ? 'now' : ''}">${STATUS[k]}</li>`).join('')}</ol>`;
}

$('#rows').onclick = (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (tr) openDetail(tr.dataset.id).catch(alertErr);
};

// ===== รายละเอียดและการดำเนินการ =====
async function openDetail(id) {
  const r = await api(`/requests/${id}`);
  const techs = can('request.assign') && r.status === 'pending' ? await api('/requests/technicians') : [];
  const mine = (field) => r[field] === me.id;

  const acts = [];
  if (r.status === 'pending' && can('request.approve')) acts.push(['reject', 'ไม่อนุมัติ', 'danger']);
  if (r.status === 'pending' && can('request.assign')) acts.push(['assign', 'อนุมัติและมอบหมายผู้รับผิดชอบ', '']);
  if (r.status === 'assigned' && can('request.update_status') && mine('technician_id')) acts.push(['start', 'เริ่มดำเนินการ', '']);
  if (r.status === 'in_progress' && can('request.update_status') && mine('technician_id')) acts.push(['complete', 'ดำเนินการเสร็จ', '']);
  if (r.status === 'done' && can('request.close') && mine('requester_id')) acts.push(['confirm', 'ยืนยันปิดเรื่อง', '']);
  if (r.status === 'pending' && can('request.cancel.own') && mine('requester_id')) acts.push(['cancel', 'ยกเลิกคำขอ', 'ghost']);

  $('#detail').innerHTML = `
    <h2>#${r.id} ${esc(r.title)}</h2>
    <span class="badge s-${r.status}">${STATUS[r.status]}</span>
    ${progress(r.status)}
    <dl class="info" style="margin-top:14px">
      <dt>ประเภท</dt><dd>${esc(r.category)} ${r.priority === 'urgent' ? '· ด่วน' : ''}</dd>
      <dt>สถานที่</dt><dd>${esc(r.location)}</dd>
      <dt>รายละเอียด</dt><dd>${esc(r.description) || '—'}</dd>
      <dt>วันที่แจ้ง</dt><dd>${fmtDate(r.created_at)}</dd>
    </dl>

    <h3>ไฟล์แนบ</h3>
    <ul class="files">${r.attachments.map((a) => `
      <li><a href="/api/attachments/${a.id}" target="_blank">${esc(a.original_name)}</a>
        <span class="muted">${(a.size_bytes / 1024).toFixed(0)} KB</span></li>`).join('')
      || '<li class="muted">ยังไม่มีไฟล์</li>'}</ul>
    ${can('attachment.upload') ? `
      <form id="uploadForm" class="row" style="margin-top:10px">
        <input type="file" name="file" accept=".jpg,.jpeg,.png,.pdf" required>
        <button>อัปโหลด</button>
      </form>` : ''}

    <h3>ประวัติการดำเนินการ</h3>
    <ul class="timeline">${r.history.map((h) => `
      <li><b>${STATUS[h.to_status]}</b> · ${esc(h.changed_by)} ·
        <span class="muted">${fmtDate(h.changed_at)}</span>
        ${h.note ? `<br>${esc(h.note)}` : ''}</li>`).join('')}</ul>

    ${acts.length ? `
      <div class="actions">
        <textarea id="actNote" rows="2" placeholder="หมายเหตุ (จำเป็นเมื่อไม่อนุมัติ)"></textarea>
        ${techs.length ? `<select id="techSel">${techs.map((t) =>
          `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>` : ''}
        ${acts.map(([a, label, kind]) =>
          `<button class="${kind}" data-act="${a}">${label}</button>`).join('')}
      </div>` : ''}
    <p id="detailMsg" class="error"></p>`;

  $('#detail').onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const body = { note: $('#actNote')?.value.trim() || undefined };
    if (b.dataset.act === 'assign') body.technician_id = Number($('#techSel')?.value);
    try {
      await api(`/requests/${id}/${b.dataset.act}`, { method: 'POST', body });
      await openDetail(id);
      loadRequests().catch(alertErr);
            if (can('dashboard.view')) loadDashboard().catch(() => {});
    } catch (err) {
      $('#detailMsg').textContent = err.message;
    }
  };

  $('#uploadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/requests/${id}/attachments`, { method: 'POST', body: new FormData(e.target) });
      await openDetail(id);
    } catch (err) {
      $('#detailMsg').textContent = err.message;
    }
  });

    await loadComments(id);
  $('#modal').classList.remove('hidden');
}

$('#closeModal').onclick = () => $('#modal').classList.add('hidden');

async function init() {
  try { me = await api('/auth/me'); } catch { me = null; }
  renderShell();
}
init();
// ไอคอนดวงตา แสดง/ซ่อนรหัสผ่าน
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function setPwIcon(btn, showing) {
  btn.innerHTML = showing ? EYE_OFF_ICON : EYE_ICON;
  btn.setAttribute('aria-label', showing ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
  btn.title = showing ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน';
}

document.querySelectorAll('.pw-toggle').forEach((b) => setPwIcon(b, false));

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.pw-toggle');
  if (!btn) return;
  const input = btn.parentElement.querySelector('input');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  setPwIcon(btn, !showing);
});
// ===== แดชบอร์ด =====
async function loadDashboard() {
  const d = await api('/requests/stats');
  const count = (s) => d.byStatus.find((x) => x.status === s)?.n ?? 0;
  const total = d.byStatus.reduce((sum, x) => sum + x.n, 0);
  const open = count('pending') + count('assigned') + count('in_progress');

  const stat = (label, value, cls = '') =>
    `<div class="stat ${cls}"><b>${value}</b><span>${label}</span></div>`;
  $('#dashStats').innerHTML =
    stat('งานทั้งหมด', total) +
    stat('กำลังดำเนินการ', open, 'st-open') +
    stat('รอพิจารณา', count('pending')) +
    stat('เสร็จสิ้น/ปิดเรื่อง', count('done') + count('closed'), 'st-done') +
    stat('ด่วนที่ยังค้าง', d.urgentOpen, 'st-urgent');

  const bar = (label, n, max) => `
    <div class="bar-row">
      <span class="bar-label">${esc(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${max ? (n / max) * 100 : 0}%"></div></div>
      <b>${n}</b>
    </div>`;

  const maxS = Math.max(1, ...d.byStatus.map((x) => x.n));
  $('#chartStatus').innerHTML = d.byStatus.length
    ? d.byStatus.map((x) => bar(STATUS[x.status], x.n, maxS)).join('')
    : '<p class="muted">ยังไม่มีข้อมูล</p>';

  const maxC = Math.max(1, ...d.byCategory.map((x) => x.n));
  $('#chartCategory').innerHTML = d.byCategory.length
    ? d.byCategory.map((x) => bar(x.name, x.n, maxC)).join('')
    : '<p class="muted">ยังไม่มีข้อมูล</p>';

  const maxD = Math.max(1, ...d.daily.map((x) => x.n));
  $('#chartDaily').innerHTML = d.daily.map((x) => {
    const [, m, dd] = x.day.split('-');
    return `<div class="day">
      <div class="day-bar" style="height:${(x.n / maxD) * 100}%"><span>${x.n}</span></div>
      <small>${dd}/${m}</small>
    </div>`;
  }).join('');
}

// ===== ความคิดเห็น =====
async function loadComments(id) {
  const box = document.createElement('div');
  box.id = 'commentBox';
  box.innerHTML = `
    <h3>ความคิดเห็น</h3>
    <div id="commentList"></div>
    ${can('comment.create') ? `
      <form id="commentForm" class="row" style="margin-top:10px">
        <input name="body" maxlength="500" placeholder="พิมพ์ความคิดเห็น" required>
        <button>ส่ง</button>
      </form>` : ''}`;
  $('#detail').appendChild(box);

  const render = async () => {
    const list = await api(`/requests/${id}/comments`);
    $('#commentList').innerHTML = list.length
      ? list.map((c) => `
          <div class="comment">
            <b>${esc(c.author)}</b> <span class="muted small">${fmtDate(c.created_at)}</span>
            <div>${esc(c.body)}</div>
          </div>`).join('')
      : '<p class="muted">ยังไม่มีความคิดเห็น</p>';
  };
  await render();

  $('#commentForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(`/requests/${id}/comments`, {
        method: 'POST', body: { body: new FormData(e.target).get('body') },
      });
      e.target.reset();
      await render();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}
// ===== ประกาศ =====
const ANN_ICON = { elevator: '🛗', maintenance: '🔧', water: '💧', electric: '⚡', aircon: '❄️', general: '📢' };
const ANN_LABEL = { elevator: 'ลิฟต์', maintenance: 'บำรุงรักษา', water: 'ประปา', electric: 'ไฟฟ้า', aircon: 'เครื่องปรับอากาศ', general: 'ทั่วไป' };

async function loadAnnouncements() {
  const list = await api('/announcements');
  $('#annCount').textContent = list.length ? `${list.length} รายการที่กำลังจะมาถึง` : '';
  $('#annList').innerHTML = list.length
    ? list.map((a) => `
        <div class="ann ann-${a.type}">
          <div class="ann-icon">${ANN_ICON[a.type]}</div>
          <div class="ann-body">
            <div class="row between wrap">
              <b>${esc(a.title)}</b>
              <span class="row">
                <span class="badge">${ANN_LABEL[a.type]}</span>
                ${can('announcement.manage')
                  ? `<button class="ghost small" data-ann-cancel="${a.id}">ยกเลิก</button>` : ''}
              </span>
            </div>
            <div class="muted small">🕒 ${fmtDate(a.starts_at)} – ${fmtDate(a.ends_at)} · โดย ${esc(a.author)}</div>
            ${a.detail ? `<div class="ann-detail">${esc(a.detail)}</div>` : ''}
          </div>
        </div>`).join('')
    : '<p class="muted">ยังไม่มีประกาศในขณะนี้</p>';
}

$('#annList').onclick = async (e) => {
  const b = e.target.closest('[data-ann-cancel]');
  if (!b || !confirm('ยกเลิกประกาศนี้ใช่หรือไม่')) return;
  try {
    await api(`/announcements/${b.dataset.annCancel}/cancel`, { method: 'POST' });
    await loadAnnouncements();
  } catch (err) {
    toast(err.message, 'error');
  }
};

$('#annForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const msg = $('#annMsg');
  msg.textContent = '';
  if (new Date(f.ends_at) <= new Date(f.starts_at)) {
    msg.textContent = 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม';
    return;
  }
  try {
    await api('/announcements', { method: 'POST', body: {
      type: f.type,
      title: f.title.trim(),
      detail: f.detail.trim(),
      starts_at: new Date(f.starts_at).toISOString(),
      ends_at: new Date(f.ends_at).toISOString(),
    } });
    e.target.reset();
    await loadAnnouncements();
  } catch (err) {
    msg.textContent = err.message;
  }
};
// ===== การแจ้งเตือน =====
async function loadNotifications() {
  const d = await api('/notifications');
  const count = $('#bellCount');
  count.textContent = d.unread > 9 ? '9+' : d.unread;
  count.classList.toggle('hidden', !d.unread);

  $('#notifList').innerHTML = d.items.length
    ? d.items.map((n) => `
        <div class="notif-item ${n.isNew ? 'new' : ''} ${n.requestId ? 'clickable' : ''}"
             ${n.requestId ? `data-req="${n.requestId}"` : ''}>
          <span class="notif-dot"></span>
          <div>
            <div class="notif-title">${esc(n.title)}</div>
            <div class="notif-text">${esc(n.text)}</div>
            <div class="muted small">${fmtDate(n.at)}</div>
          </div>
        </div>`).join('')
    : '<p class="muted notif-empty">ยังไม่มีการแจ้งเตือน</p>';
}

$('#bellBtn').onclick = (e) => {
  e.stopPropagation();
  const panel = $('#notifPanel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) loadNotifications().catch(() => {});
};

// คลิกนอกกระดิ่งให้ปิดรายการ
document.addEventListener('click', (e) => {
  if (!e.target.closest('.notif')) $('#notifPanel').classList.add('hidden');
});

$('#notifList').onclick = (e) => {
  const item = e.target.closest('[data-req]');
  if (!item) return;
  $('#notifPanel').classList.add('hidden');
  openDetail(item.dataset.req).catch(alertErr);
};

$('#markRead').onclick = async () => {
  await api('/notifications/read', { method: 'POST' }).catch(() => {});
  loadNotifications().catch(() => {});
};

// ตรวจการแจ้งเตือนใหม่ทุก 60 วินาที
setInterval(() => {
  if (me) loadNotifications().catch(() => {});
}, 60000);