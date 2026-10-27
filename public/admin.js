// =====================================================================
// public/admin.js — JavaScript ของหน้าจัดการระบบ (/admin) สำหรับ Admin
// หน้านี้เปิดได้เฉพาะผู้มีสิทธิ์ user.manage (server ตรวจก่อนส่งไฟล์ admin.html)
// และทุกปุ่มเรียก API /api/admin/... ซึ่งตรวจสิทธิ์ซ้ำทุกครั้ง
//
// แท็บ: ภาพรวม | ผู้ใช้ | Role | Permission | สิทธิ์ (ACL) | ประเภทงาน | ห้องและพื้นที่ | Log
// แต่ละแท็บมีฟังก์ชัน renderXxx() ที่ดึงข้อมูลจาก API แล้ววาดลงใน #content
// =====================================================================
const $ = (s) => document.querySelector(s);

// api(): ตัวกลางเรียก API ส่ง cookie session ไปด้วย ถ้าไม่สำเร็จโยน Error พร้อมข้อความจาก server
async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch('/api' + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'เกิดข้อผิดพลาด');
  return data;
}
// กล่องโต้ตอบมาตรฐาน (แทน prompt/confirm ของเบราว์เซอร์)
// dialog({ title, intro, fields: [{name,label,value,type,required,minlength,placeholder,hint}], submit, danger })
// คืนค่า object ของค่าที่กรอก หรือ null ถ้ายกเลิก
function dialog({ title, intro = '', fields = [], submit = 'บันทึก', danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.setAttribute('aria-label', title);
    d.innerHTML = `<form class="dlg-form" novalidate>
      <h2>${esc(title)}</h2>
      ${intro ? `<p class="muted">${esc(intro)}</p>` : ''}
      ${fields.map((f) => `<label>${esc(f.label)}
        <input name="${esc(f.name)}" type="${f.type || 'text'}" value="${esc(f.value || '')}"
          placeholder="${esc(f.placeholder || '')}" ${f.minlength ? `minlength="${f.minlength}"` : ''}
          ${f.required ? 'required' : ''} autocomplete="off">
        ${f.hint ? `<span class="muted small">${esc(f.hint)}</span>` : ''}</label>`).join('')}
      <p class="error dlg-err" role="alert"></p>
      <div class="dlg-actions">
        <button type="button" class="ghost" data-cancel>ยกเลิก</button>
        <button type="submit" class="${danger ? 'danger' : ''}">${esc(submit)}</button>
      </div>
    </form>`;
    document.body.appendChild(d);
    let result = null;
    const form = d.querySelector('form');
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      for (const f of fields) {
        const val = String(v[f.name] ?? '').trim();
        if (f.required && !val) { d.querySelector('.dlg-err').textContent = `กรุณากรอก${f.label}`; return; }
        if (f.minlength && val && val.length < f.minlength) {
          d.querySelector('.dlg-err').textContent = `${f.label}ต้องมีอย่างน้อย ${f.minlength} ตัวอักษร`; return;
        }
        v[f.name] = val;
      }
      result = v;
      d.close();
    };
    d.querySelector('[data-cancel]').onclick = () => d.close();
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    d.showModal();
    d.querySelector('input, button[type=submit]').focus();
  });
}
const confirmBox = ({ title, message, ok = 'ยืนยัน', danger = false }) =>
  dialog({ title, intro: message, submit: ok, danger }).then((r) => r !== null);

function toast(msg, kind = 'info') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
const formData = (f) => Object.fromEntries(new FormData(f));
const nullable = (v) => (v === '' || v == null ? null : Number(v));
// run(fn, after): รันคำสั่ง ถ้าผิดพลาดแสดงข้อความ แล้ววาดแท็บใหม่ (after) ให้เห็นข้อมูลล่าสุด
const run = async (fn, after) => {
  try { await fn(); } catch (e) { toast(e.message, 'error'); }
  if (after) after();
};

// views: จับคู่ชื่อแท็บกับฟังก์ชันวาดหน้า
const views = { overview: renderOverview, users: renderUsers, roles: renderRoles, permissions: renderPermissions, acl: renderAcl, categories: renderCategories, property: renderProperty, logs: renderLogs };

const PAGE = {
  overview: ['ภาพรวมระบบ', 'สรุปการใช้งานของระบบ'],
  users: ['ผู้ใช้', 'เพิ่ม แก้ไข และจัดกลุ่มบัญชีผู้ใช้'],
  roles: ['Role', 'บทบาทที่ใช้กำหนดสิทธิ์ในระบบ'],
  permissions: ['Permission', 'รายการสิทธิ์ที่ใช้ในระบบ'],
  acl: ['สิทธิ์การใช้งาน (ACL)', 'กำหนดว่าแต่ละบทบาททำอะไรได้บ้าง'],
  categories: ['ประเภทงาน', 'ประเภทงานซ่อมและฝ่ายที่รับผิดชอบ'],
  property: ['ห้องและพื้นที่', 'ห้องพัก สัญญา และพื้นที่ส่วนกลาง'],
  logs: ['Log การใช้งาน', 'ประวัติการใช้งานและความพยายามเข้าถึงระบบ'],
};
// openTab: สลับแท็บ เปลี่ยนหัวข้อ แล้วเรียก renderXxx ของแท็บนั้น
function openTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#pageTitle').textContent = PAGE[name][0];
  $('#pageSub').textContent = PAGE[name][1];
  document.title = `${PAGE[name][0]} | จัดการระบบ`;
  $('#content').onclick = null;
  $('#content').onchange = null;
  views[name]().catch((e) => { $('#content').innerHTML = `<p class="error">${esc(e.message)}</p>`; });
}
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => openTab(b.dataset.tab)));

$('#meBtn').onclick = () => openAccount();
$('#logoutBtn').onclick = async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
};

// ===== เมนูซ้ายย่อ/ขยาย + โหมดมืด + ข้อมูลผู้ใช้บนแถบหัว =====
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ไม่เป็นไร */ } };

function setSide(collapsed) {
  document.querySelector('.admin-shell').classList.toggle('collapsed', collapsed);
  const b = $('#sideToggle');
  b.setAttribute('aria-expanded', String(!collapsed));
  b.title = collapsed ? 'ขยายเมนู' : 'ย่อเมนู';
  lsSet('wc-side', collapsed ? '1' : '0');
}
$('#sideToggle').onclick = () => setSide(!document.querySelector('.admin-shell').classList.contains('collapsed'));
if (lsGet('wc-side') === '1') setSide(true);

const ICON_MOON = '<svg class="i" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
const ICON_SUN = '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
function paintTheme() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  $('#themeBtn').innerHTML = dark ? ICON_SUN : ICON_MOON;
  $('#themeBtn').setAttribute('aria-pressed', String(dark));
}
$('#themeBtn').onclick = () => {
  const dark = document.documentElement.getAttribute('data-theme') !== 'dark';
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  lsSet('wc-theme', dark ? 'dark' : 'light');
  paintTheme();
};
paintTheme();

api('/auth/me').then((m) => { $('#meName').textContent = m.name; $('#meBtn').title = `บัญชีของฉัน (${m.name})`; }).catch(() => {});
api('/notifications').then((n) => { if (n && n.unread > 0) $('#bellDot').classList.remove('hidden'); }).catch(() => {});

// ===== ภาพรวม =====
// ส่งออกรายการคำร้องเป็นไฟล์ CSV: server สร้างไฟล์และตรวจสิทธิ์ request.export (GET /api/requests/export)
// ถ้าไม่มีสิทธิ์ server ตอบ 403 แล้วแสดงข้อความแทนการดาวน์โหลด
async function exportCsv() {
  const res = await fetch('/api/requests/export', { credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'ส่งออกไม่สำเร็จ');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = `repair-requests-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const IC = {
  users: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg>',
  wrench: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>',
};
// แท็บภาพรวม: ตัวเลขสรุปคำร้อง ผู้ใช้ และ Role
async function renderOverview() {
  const [st, users, roles] = await Promise.all([api('/requests/stats'), api('/admin/users'), api('/admin/roles')]);
  const n = (s) => st.byStatus.find((x) => x.status === s)?.n ?? 0;
  const total = st.byStatus.reduce((a, x) => a + x.n, 0);
  const active = users.filter((u) => u.is_active).length;
  const roleName = Object.fromEntries(roles.map((r) => [r.id, r.name]));
  const perRole = {};
  users.forEach((u) => { const k = roleName[u.role_id] || '-'; perRole[k] = (perRole[k] || 0) + 1; });
  const maxR = Math.max(1, ...Object.values(perRole));
  const card = (icon, v, l, c = '') =>
    `<div class="stat ${c}"><span class="ico" aria-hidden="true">${IC[icon]}</span><b>${v}</b><span>${l}</span></div>`;

  $('#content').innerHTML = `
    <div class="stat-grid">
      ${card('users', `${active}<small>/${users.length}</small>`, 'ผู้ใช้ที่เปิดใช้งาน')}
      ${card('wrench', total, 'เรื่องแจ้งซ่อมทั้งหมด')}
      ${card('clock', n('pending'), 'รอพิจารณา', 'st-open')}
      ${card('alert', st.urgentOpen, 'ด่วนที่ยังค้าง', 'st-urgent')}
    </div>
    <div class="ov-grid">
      <section>
        <h3>ผู้ใช้แยกตาม Role</h3>
        ${Object.entries(perRole).map(([k, v]) => `<div class="bar-row"><span>${esc(k)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(v / maxR) * 100}%"></div></div><b>${v}</b></div>`).join('')}
      </section>
      <section>
        <h3>ทางลัด</h3>
        <div class="quick">
          <button data-go="users">เพิ่มผู้ใช้</button>
          <button class="ghost" data-go="categories">จัดการประเภทงาน</button>
          <button class="ghost" data-go="property">จัดการห้อง/พื้นที่</button>
          <button class="export" data-export>ส่งออกรายการแจ้งซ่อม (CSV)</button>
        </div>
      </section>
    </div>`;

  $('#content').onclick = (e) => {
    const go = e.target.closest('[data-go]');
    if (go) return openTab(go.dataset.go);
    if (e.target.closest('[data-export]')) {
      run(exportCsv);
    }
  };
}

// จัดกลุ่มผู้ใช้ตามประเภท: ผู้ดูแล > หัวหน้า > ช่าง/เจ้าหน้าที่ > ลูกบ้าน (ในกลุ่มเรียงตามฝ่ายแล้วชื่อ)
function userGroups(users, roles) {
  const defs = [['admin', 'ผู้ดูแลระบบ'], ['dept_head', 'หัวหน้าฝ่าย'], ['technician', 'ช่างและเจ้าหน้าที่'], ['resident', 'ลูกบ้าน']];
  const known = new Set(defs.map((d) => d[0]));
  const roleOf = (u) => roles.find((r) => r.id === u.role_id)?.name || '';
  const out = defs.map(([k, label]) => ({ label, items: users.filter((u) => roleOf(u) === k) }));
  const other = users.filter((u) => !known.has(roleOf(u)));
  if (other.length) out.push({ label: 'อื่น ๆ', items: other });
  out.forEach((g) => g.items.sort((x, y) => String(x.department_id ?? 99).localeCompare(String(y.department_id ?? 99)) || x.username.localeCompare(y.username)));
  return out.filter((g) => g.items.length);
}

// ===== ผู้ใช้ =====
// แท็บผู้ใช้: เพิ่มบัญชี, เปลี่ยน Role/ฝ่าย, เปิด-ปิดบัญชี, ตั้งรหัสผ่านใหม่ (PATCH /api/admin/users/:id ฯลฯ)
// การเปลี่ยน Role ทำผ่านเว็บได้ทันที ไม่ต้องแก้โค้ด และ server กันไม่ให้ Admin คนสุดท้ายหายไป
async function renderUsers() {
  const [users, roles, depts] = await Promise.all([
    api('/admin/users'), api('/admin/roles'), api('/admin/departments'),
  ]);
  const roleOpts = (sel) => roles.map((r) =>
    `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  const deptOpts = (sel) => '<option value="">— ไม่ระบุ —</option>' + depts.map((d) =>
    `<option value="${d.id}" ${d.id === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('');

  $('#content').innerHTML = `
    <h2>เพิ่มผู้ใช้</h2>
    <form id="userForm" class="grid-form">
      <input name="username" placeholder="ชื่อผู้ใช้ (a-z 0-9 _ .)" autocomplete="off" readonly data-noauto required>
      <input name="name" placeholder="ชื่อ-นามสกุลจริง" required>
      <input name="position" placeholder="ตำแหน่ง/หน้าที่ เช่น ช่างไฟฟ้า">
      <input name="password" type="password" placeholder="รหัสผ่าน อย่างน้อย 8 ตัว" autocomplete="new-password" readonly data-noauto required>
      <select name="role_id" required>${roleOpts(null)}</select>
      <select name="department_id">${deptOpts(null)}</select>
      <button>เพิ่มผู้ใช้</button>
    </form>

    <div class="row between wrap mt" style="margin-bottom:12px">
      <h2 style="margin:0">ผู้ใช้ทั้งหมด</h2>
      <input id="userSearch" type="search" placeholder="ค้นหาชื่อผู้ใช้หรือชื่อ" style="width:240px" aria-label="ค้นหาผู้ใช้">
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ-นามสกุล</th><th>ตำแหน่ง</th><th>Role</th><th>ฝ่าย</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${userGroups(users, roles).map((g) => `<tr class="ugrp"><td colspan="7"><b>${esc(g.label)}</b> <span>${g.items.length} คน</span></td></tr>`
          + g.items.map((u) => `<tr>
          <td>${esc(u.username)}</td>
          <td>${esc(u.name)}</td>
          <td class="muted">${esc(u.position || '—')}</td>
          <td><select data-field="role_id" data-id="${u.id}">${roleOpts(u.role_id)}</select></td>
          <td><select data-field="department_id" data-id="${u.id}">${deptOpts(u.department_id)}</select></td>
          <td><span class="badge ${u.is_active ? 's-done' : 's-cancelled'}">${u.is_active ? 'ใช้งาน' : 'ปิดแล้ว'}</span></td>
          <td><button class="small ${u.is_active ? 'warn' : 'good'}" data-toggle="${u.id}" data-active="${u.is_active}">
            ${u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
            <button class="ghost small" data-rename="${u.id}" data-name="${esc(u.name)}" data-position="${esc(u.position || '')}">แก้ชื่อ</button>
            <button class="small warn" data-reset="${u.id}" data-name="${esc(u.username)}">ตั้งรหัสผ่านใหม่</button></td>
        </tr>`).join('')).join('')}</tbody>
      </table>
    </div>`;

  $('#userForm').onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const position = (f.position || '').trim();
    delete f.position;
    run(async () => {
      await api('/admin/users', { method: 'POST', body: {
        ...f, name: f.name.trim(), role_id: Number(f.role_id), department_id: nullable(f.department_id),
      } });
      if (position) {
        const list = await api('/admin/users');
        const u = list.find((x) => x.username === f.username);
        if (u) await api(`/admin/users/${u.id}/profile`, { method: 'PATCH', body: { name: u.name, position } });
      }
    }, renderUsers);
  };

  $('#content').onchange = (e) => {
    const s = e.target.closest('select[data-field]');
    if (!s) return;
    run(() => api(`/admin/users/${s.dataset.id}`, {
      method: 'PATCH', body: { [s.dataset.field]: nullable(s.value) },
    }), renderUsers);
  };

  // ไม่ให้เบราว์เซอร์เติมชื่อผู้ใช้/รหัสผ่านที่จำไว้ลงฟอร์มเพิ่มผู้ใช้: ช่องจะพิมพ์ได้เมื่อคลิกเข้าไปเท่านั้น
  document.querySelectorAll('#userForm input[data-noauto]').forEach((i) => {
    i.addEventListener('focus', () => { i.readOnly = false; }, { once: true });
  });
  setTimeout(() => {
    const uf = $('#userForm');
    if (uf && !uf.contains(document.activeElement)) uf.reset();
  }, 300);

  $('#userSearch').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    let head = null, shown = 0;
    const flush = () => { if (head) head.hidden = !shown; };
    document.querySelectorAll('#content tbody tr').forEach((tr) => {
      if (tr.classList.contains('ugrp')) { flush(); head = tr; shown = 0; return; }
      tr.hidden = !!q && !(tr.children[0].textContent + tr.children[1].textContent + tr.children[2].textContent).toLowerCase().includes(q);
      if (!tr.hidden) shown++;
    });
    flush();
  };

  $('#content').onclick = async (e) => {
    const rn = e.target.closest('[data-rename]');
    if (rn) {
      const v = await dialog({
        title: 'แก้ไขข้อมูลผู้ใช้',
        intro: `บัญชี: ${rn.closest('tr').children[0].textContent}`,
        fields: [
          { name: 'name', label: 'ชื่อ-นามสกุล', value: rn.dataset.name, required: true, placeholder: 'เช่น สมชาย ใจดี' },
          { name: 'position', label: 'ตำแหน่ง/หน้าที่', value: rn.dataset.position, placeholder: 'เช่น ช่างไฟฟ้า, หัวหน้าฝ่ายอาคาร',
            hint: 'ไม่บังคับ ใช้แสดงต่อท้ายชื่อในหน้าต่างๆ และในไฟล์ส่งออก' },
        ],
        submit: 'บันทึกข้อมูล',
      });
      if (!v) return;
      run(() => api(`/admin/users/${rn.dataset.rename}/profile`, { method: 'PATCH', body: { name: v.name, position: v.position } })
        .then(() => toast('บันทึกข้อมูลผู้ใช้แล้ว')), renderUsers);
      return;
    }
    const r = e.target.closest('[data-reset]');
    if (r) {
      const v = await dialog({
        title: 'ตั้งรหัสผ่านใหม่',
        intro: `บัญชี: ${r.dataset.name}`,
        fields: [{ name: 'password', label: 'รหัสผ่านใหม่', required: true, minlength: 8,
          hint: 'อย่างน้อย 8 ตัวอักษร และแจ้งรหัสนี้ให้เจ้าของบัญชีโดยตรง' }],
        submit: 'ตั้งรหัสผ่าน',
      });
      if (!v) return;
      run(() => api(`/admin/users/${r.dataset.reset}/password`, { method: 'POST', body: { password: v.password } })
        .then(() => toast('ตั้งรหัสผ่านใหม่แล้ว')));
      return;
    }
    const b = e.target.closest('[data-toggle]');
    if (!b) return;
    run(() => api(`/admin/users/${b.dataset.toggle}`, {
      method: 'PATCH', body: { is_active: b.dataset.active !== 'true' },
    }), renderUsers);
  };
}

// ===== Role =====
// แท็บ Role: เพิ่ม/แก้/ลบ Role (server ปฏิเสธการลบ Role ที่ยังมีผู้ใช้ และ Role admin)
async function renderRoles() {
  const roles = await api('/admin/roles');
  $('#content').innerHTML = `
    <form id="roleForm" class="row wrap">
      <input name="name" placeholder="ชื่อ Role เช่น viewer" required>
      <input name="description" placeholder="ชื่อภาษาไทย เช่น ผู้ประกาศข่าว">
      <button>เพิ่ม Role</button>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ชื่อ</th><th>ชื่อภาษาไทย / คำอธิบาย</th><th>จำนวนผู้ใช้</th><th></th></tr></thead>
        <tbody>${roles.map((r) => `<tr>
          <td><code>${esc(r.name)}</code>${r.in_code ? ' <span class="role">Role หลัก</span>' : ''}</td>
          <td>${esc(r.description)}</td>
          <td>${r.user_count}</td>
          <td>
            <button class="ghost small" data-edit="${r.id}">แก้ไข</button>
            ${r.in_code ? '' : `<button class="danger small" data-del="${r.id}">ลบ</button>`}
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <p class="muted">กำหนดสิทธิ์ของ Role ได้ที่แท็บ "สิทธิ์ (ACL)" · Role หลักที่ระบบใช้แก้ได้เฉพาะคำอธิบาย และลบไม่ได้</p>`;

  $('#roleForm').onsubmit = (e) => {
    e.preventDefault();
    run(() => api('/admin/roles', { method: 'POST', body: formData(e.target) }), renderRoles);
  };

  $('#content').onclick = async (e) => {
    // แก้ไข Role → PATCH /api/admin/roles/:id (Role หลักไม่มีช่องชื่อให้แก้)
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const r = roles.find((x) => String(x.id) === ed.dataset.edit);
      const v = await dialog({
        title: `แก้ไข Role ${r.name}`,
        intro: r.in_code ? 'Role หลักที่ระบบใช้ เปลี่ยนชื่อไม่ได้ แก้ได้เฉพาะคำอธิบาย' : '',
        fields: [
          ...(r.in_code ? [] : [{ name: 'name', label: 'ชื่อ Role', value: r.name, required: true, hint: 'a-z และ _ ความยาว 3-50 ตัวอักษร' }]),
          { name: 'description', label: 'ชื่อภาษาไทย (แสดงในหน้า ACL และหน้าผู้ใช้)', value: r.description || '' },
        ],
      });
      if (v) run(() => api(`/admin/roles/${r.id}`, { method: 'PATCH', body: v }), renderRoles);
      return;
    }
    const b = e.target.closest('[data-del]');
    if (b && await confirmBox({ title: 'ลบบทบาท', message: 'การลบบทบาทไม่สามารถย้อนกลับได้ ต้องการดำเนินการต่อหรือไม่', ok: 'ลบบทบาท', danger: true })) {
      run(() => api(`/admin/roles/${b.dataset.del}`, { method: 'DELETE' }), renderRoles);
    }
  };
}

// แท็บ Permission: เพิ่ม/แก้ไข/ลบรายการสิทธิ์ผ่านเว็บ (GET/POST/PATCH/DELETE /api/admin/permissions)
// สิทธิ์ที่โค้ดใช้ตรวจอยู่ (in_code) ลบหรือเปลี่ยนชื่อไม่ได้ แก้ได้เฉพาะคำอธิบาย
// "สิทธิ์ที่ระบบรองรับแต่ยังไม่ได้เพิ่ม" (missing) เช่น request.export ใช้สาธิตการเพิ่ม Permission แล้วเชื่อมกับฟังก์ชัน
async function renderPermissions() {
  const { permissions, missing } = await api('/admin/permissions');
  $('#content').innerHTML = `
    ${missing.length ? `<div class="notice">สิทธิ์ที่ระบบรองรับแต่ยังไม่ได้เพิ่ม:
      ${missing.map((n) => `<button class="ghost small" data-quick="${esc(n)}">+ ${esc(n)}</button>`).join(' ')}
      <div class="small">เพิ่มแล้ว Admin ได้รับสิทธิ์ทันที จากนั้นไปติ๊กให้ Role อื่นที่แท็บ "สิทธิ์ (ACL)"</div></div>` : ''}
    <form id="permForm" class="row wrap">
      <input name="name" placeholder="ชื่อสิทธิ์ เช่น equipment.read" required>
      <input name="description" placeholder="คำอธิบาย">
      <button>เพิ่ม Permission</button>
    </form>
    <div class="table-wrap" style="margin-top:12px">
      <table>
        <thead><tr><th>ชื่อ</th><th>คำอธิบาย</th><th>ผูกกับฟังก์ชัน</th><th></th></tr></thead>
        <tbody>${permissions.map((p) => `<tr>
          <td><code>${esc(p.name)}</code></td>
          <td>${esc(p.description)}</td>
          <td>${p.in_code ? '<span class="badge s-done">ใช้ในโค้ด</span>' : '<span class="badge s-cancelled">ยังไม่ผูก</span>'}</td>
          <td>
            <button class="ghost small" data-edit="${p.id}">แก้ไข</button>
            ${p.in_code ? '' : `<button class="danger small" data-del="${p.id}">ลบ</button>`}
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <p class="muted">สิทธิ์ใหม่จะป้องกันอะไรจริงก็ต่อเมื่อ Route ในโค้ดตรวจด้วย requirePermission ชื่อนั้น ("ใช้ในโค้ด")</p>`;

  const add = (body) => run(() => api('/admin/permissions', { method: 'POST', body }), renderPermissions);
  $('#permForm').onsubmit = (e) => { e.preventDefault(); add(formData(e.target)); };

  $('#content').onclick = async (e) => {
    const quick = e.target.closest('[data-quick]');
    if (quick) return add({ name: quick.dataset.quick, description: PERM[quick.dataset.quick]?.[1] || '' });

    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const p = permissions.find((x) => String(x.id) === ed.dataset.edit);
      const v = await dialog({
        title: `แก้ไข Permission ${p.name}`,
        intro: p.in_code ? 'สิทธิ์นี้ถูกใช้ในโค้ด เปลี่ยนชื่อไม่ได้ แก้ได้เฉพาะคำอธิบาย' : '',
        fields: [
          ...(p.in_code ? [] : [{ name: 'name', label: 'ชื่อสิทธิ์', value: p.name, required: true, hint: 'รูปแบบ resource.action เช่น equipment.read' }]),
          { name: 'description', label: 'คำอธิบาย', value: p.description || '' },
        ],
      });
      if (v) run(() => api(`/admin/permissions/${p.id}`, { method: 'PATCH', body: v }), renderPermissions);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del && await confirmBox({ title: 'ลบ Permission', message: 'สิทธิ์นี้จะถูกถอนจากทุก Role ด้วย ต้องการดำเนินการต่อหรือไม่', ok: 'ลบ', danger: true })) {
      run(() => api(`/admin/permissions/${del.dataset.del}`, { method: 'DELETE' }), renderPermissions);
    }
  };
}

// ===== ACL: Role × Permission =====
// PERM: คำอธิบายภาษาไทยของแต่ละ Permission ใช้แสดงในตาราง ACL แบ่งเป็นกลุ่ม (ไม่มีผลต่อการตรวจสิทธิ์)
const PERM = {
  'request.create': ['งานแจ้งซ่อม', 'แจ้งเรื่องซ่อมใหม่', 'ลูกบ้านกรอกฟอร์มแจ้งเรื่อง'],
  'request.approve': ['งานแจ้งซ่อม', 'อนุมัติหรือไม่อนุมัติเรื่อง', 'เฉพาะเรื่องในแผนกของตัวเอง'],
  'request.assign': ['งานแจ้งซ่อม', 'มอบหมายงานให้ช่าง', 'เลือกผู้รับผิดชอบเมื่ออนุมัติ'],
  'request.update_status': ['งานแจ้งซ่อม', 'เริ่มงานและกดเสร็จงาน', 'เฉพาะงานที่ได้รับมอบหมาย'],
  'request.close': ['งานแจ้งซ่อม', 'ยืนยันปิดเรื่อง', 'ผู้แจ้งตรวจรับงานแล้วปิดเรื่อง'],
  'request.cancel.own': ['งานแจ้งซ่อม', 'ลบเรื่องของตัวเอง', 'ลบได้ขณะรอพิจารณาและยังไม่มอบหมายงาน'],
  'announcement.read': ['ประกาศ', 'อ่านประกาศ'],
  'announcement.manage': ['ประกาศ', 'สร้างและยกเลิกประกาศ'],
  'attachment.upload': ['ไฟล์แนบ', 'อัปโหลดไฟล์แนบ'],
  'attachment.read': ['ไฟล์แนบ', 'เปิดดูไฟล์แนบ'],
  'attachment.delete': ['ไฟล์แนบ', 'ลบไฟล์แนบ'],
  'dashboard.view': ['รายงานและบันทึก', 'ดูภาพรวมงาน', 'กราฟและตัวเลขสถิติ'],
  'request.export': ['รายงานและบันทึก', 'ส่งออกรายการเป็น CSV', 'ปุ่มส่งออกในหน้ารายการแจ้งเรื่อง'],
  'log.read': ['รายงานและบันทึก', 'ดู Log การใช้งาน', 'ใครทำอะไรเมื่อไหร่'],
  'user.manage': ['จัดการระบบ', 'จัดการผู้ใช้', 'เข้าหน้า "จัดการระบบ" ได้'],
  'category.manage': ['จัดการระบบ', 'จัดการประเภทงาน'],
  'property.manage': ['จัดการระบบ', 'จัดการห้องและพื้นที่ส่วนกลาง'],
  'acl.manage': ['จัดการระบบ', 'กำหนดสิทธิ์ของแต่ละบทบาท', 'หน้านี้'],
  'permission.manage': ['จัดการระบบ', 'เพิ่มรายการสิทธิ์ใหม่'],
  'role.manage': ['จัดการระบบ', 'จัดการบทบาท'],
};
const PERM_GROUPS = ['งานแจ้งซ่อม', 'ประกาศ', 'ไฟล์แนบ', 'รายงานและบันทึก', 'จัดการระบบ', 'อื่นๆ'];
const ROLE_TH = { admin: 'ผู้ดูแลระบบ', dept_head: 'หัวหน้าแผนก', technician: 'เจ้าหน้าที่ช่าง', resident: 'ลูกบ้าน' };
// roleLabel: ชื่อไทยของ Role — Role ที่มากับระบบใช้ ROLE_TH, Role ที่เพิ่มผ่านเว็บใช้ "คำอธิบาย" ที่กรอกไว้ (ไม่มีก็ใช้ชื่อ Role)
const roleLabel = (r) => ROLE_TH[r.name] || r.description || r.name;
const LOCKOUT = ['acl.manage', 'user.manage', 'permission.manage'];

// แท็บ ACL: ตาราง Role (คอลัมน์) × Permission (แถว) แต่ละช่องคือ checkbox
// ติ๊ก = POST /api/admin/acl (ให้สิทธิ์), เอาติ๊กออก = DELETE /api/admin/acl/:roleId/:permId (ถอนสิทธิ์)
// มีผลกับผู้ใช้ทันทีโดยไม่ต้องรีสตาร์ต server
async function renderAcl() {
  const { roles, permissions, grants } = await api('/admin/acl');
  const granted = new Set(grants.map((g) => `${g.role_id}-${g.permission_id}`));
  const info = (p) => PERM[p.name] || ['อื่นๆ', p.description || p.name, ''];

  const row = (p) => {
    const [, label, hint] = info(p);
    return `<tr>
      <td><b>${esc(label)}</b>${hint ? `<div class="muted small">${esc(hint)}</div>` : ''}
        <code title="ชื่อที่ใช้ในโค้ด">${esc(p.name)}</code></td>
      ${roles.map((r) => `<td><input type="checkbox" data-role="${r.id}" data-perm="${p.id}"
        data-rname="${esc(r.name)}" data-pname="${esc(p.name)}"
        aria-label="${esc(roleLabel(r))}: ${esc(label)}"
        ${granted.has(`${r.id}-${p.id}`) ? 'checked' : ''}></td>`).join('')}
    </tr>`;
  };
  const body = PERM_GROUPS.map((g) => {
    const list = permissions.filter((p) => info(p)[0] === g);
    return list.length
      ? `<tr class="grp"><td colspan="${roles.length + 1}">${g}</td></tr>` + list.map(row).join('') : '';
  }).join('');

  $('#content').innerHTML = `
    <h2>สิทธิ์ของแต่ละบทบาท</h2>
    <p class="muted">ติ๊กเพื่อให้บทบาทนั้นทำสิ่งนี้ได้ ยกเลิกติ๊กเพื่อถอนสิทธิ์ มีผลทันที ไม่ต้องรีสตาร์ต Server</p>
    <div class="table-wrap acl-wrap">
      <table class="matrix">
        <thead><tr><th>ทำอะไรได้บ้าง</th>${roles.map((r) =>
          `<th>${esc(roleLabel(r))}<small>${esc(r.name)}</small></th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="muted">เพิ่ม แก้ไข หรือลบรายการสิทธิ์ได้ที่แท็บ "Permission"</p>`;

  // เมื่อติ๊ก/เอาติ๊กออก: ถ้าเป็นสิทธิ์สำคัญของ admin ถามยืนยันก่อน ถ้า server ปฏิเสธ คืนค่า checkbox กลับเหมือนเดิม
  $('#content').onchange = async (e) => {
    const cb = e.target;
    if (cb.type !== 'checkbox') return;
    if (!cb.checked && cb.dataset.rname === 'admin' && LOCKOUT.includes(cb.dataset.pname)) {
      const ok = await confirmBox({
        title: 'ยืนยันการถอนสิทธิ์',
        message: 'การถอนสิทธิ์นี้ของผู้ดูแลระบบอาจทำให้คุณเข้าหน้าจัดการระบบไม่ได้อีก ต้องการถอนสิทธิ์หรือไม่',
        ok: 'ถอนสิทธิ์', danger: true,
      });
      if (!ok) { cb.checked = true; return; }
    }
    const role_id = Number(cb.dataset.role);
    const permission_id = Number(cb.dataset.perm);
    try {
      await (cb.checked
        ? api('/admin/acl', { method: 'POST', body: { role_id, permission_id } })
        : api(`/admin/acl/${role_id}/${permission_id}`, { method: 'DELETE' }));
      toast('บันทึกสิทธิ์แล้ว');
    } catch (err) {
      cb.checked = !cb.checked;
      toast(err.message, 'error');
    }
  };
}

// ===== ประเภทงาน =====
// แท็บประเภทงาน: เพิ่มประเภท, เลือกฝ่ายที่รับผิดชอบ, บังคับกรอกรายละเอียด, เปิด/ปิดใช้งาน
async function renderCategories() {
  const [cats, depts] = await Promise.all([api('/admin/categories'), api('/admin/departments')]);
  const deptOpts = (sel) => depts.map((d) =>
    `<option value="${d.id}" ${d.id === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('');

  $('#content').innerHTML = `
    <form id="catForm" class="grid-form">
      <input name="name" placeholder="ชื่อประเภท" required>
      <select name="department_id" required>${deptOpts(null)}</select>
      <label class="check"><input type="checkbox" name="requires_detail"> ต้องกรอกรายละเอียด</label>
      <button>เพิ่มประเภท</button>
    </form>
    <div class="table-wrap mt">
      <table>
        <thead><tr><th>ชื่อ</th><th>ส่งให้ฝ่าย</th><th>ต้องกรอกรายละเอียด</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${cats.map((c) => `<tr>
          <td>${esc(c.name)}</td>
          <td><select data-cat="${c.id}" data-field="department_id">${deptOpts(c.department_id)}</select></td>
          <td><input type="checkbox" data-cat="${c.id}" data-field="requires_detail" ${c.requires_detail ? 'checked' : ''}></td>
          <td><span class="badge ${c.is_active ? 's-done' : 's-cancelled'}">${c.is_active ? 'เปิดใช้' : 'ปิดแล้ว'}</span></td>
          <td><button class="small ${c.is_active ? 'warn' : 'good'}" data-cat-toggle="${c.id}" data-active="${c.is_active}">
            ${c.is_active ? 'ปิด' : 'เปิด'}</button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;

  $('#catForm').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    run(() => api('/admin/categories', { method: 'POST', body: {
      name: f.get('name'),
      department_id: Number(f.get('department_id')),
      requires_detail: f.get('requires_detail') === 'on',
    } }), renderCategories);
  };

  $('#content').onchange = (e) => {
    const el = e.target;
    if (!el.dataset.cat) return;
    const value = el.type === 'checkbox' ? el.checked : Number(el.value);
    run(() => api(`/admin/categories/${el.dataset.cat}`, {
      method: 'PATCH', body: { [el.dataset.field]: value },
    }), renderCategories);
  };

  $('#content').onclick = (e) => {
    const b = e.target.closest('[data-cat-toggle]');
    if (!b) return;
    run(() => api(`/admin/categories/${b.dataset.catToggle}`, {
      method: 'PATCH', body: { is_active: b.dataset.active !== 'true' },
    }), renderCategories);
  };
}

// ===== Log =====
// แท็บ Log: กรองตามช่วงวันที่ ผู้ใช้ ผลลัพธ์ (success/failure/denied) และประเภทเหตุการณ์
// ส่งเงื่อนไขเป็น query string ไปที่ GET /api/admin/logs ให้ server ค้นในฐานข้อมูล
async function renderLogs() {
  const logUsers = await api('/admin/users').catch(() => []);
  $('#content').innerHTML = `
    <form id="logForm" class="row wrap">
      <input type="date" name="from" title="ตั้งแต่วันที่">
      <input type="date" name="to" title="ถึงวันที่">
      <select name="user_id" title="ผู้ใช้">
        <option value="">ทุกผู้ใช้</option>
        ${logUsers.map((u) => `<option value="${u.id}">${esc(u.name)} (${esc(u.username)})</option>`).join('')}
      </select>
      <select name="result">
        <option value="">ทุกผลลัพธ์</option>
        <option value="success">success</option>
        <option value="failure">failure</option>
        <option value="denied">denied</option>
      </select>
      <input name="event_type" placeholder="ประเภท เช่น login">
      <button>ค้นหา</button>
    </form>
    <div id="logTable" class="table-wrap" style="margin-top:16px"></div>`;

  const load = async () => {
    const f = formData($('#logForm'));
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
    if (f.to) q.set('to', `${f.to}T23:59:59`);
    const rows = await api(`/admin/logs?${q}`);
    $('#logTable').innerHTML = `
      <table>
        <thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>เหตุการณ์</th><th>ทรัพยากร</th><th>ผล</th><th>IP</th><th>รายละเอียด</th></tr></thead>
        <tbody>${rows.map((l) => `<tr>
          <td class="muted">${fmtDate(l.occurred_at)}</td>
          <td>${esc(l.username || l.username_attempted || '—')}</td>
          <td><code>${esc(l.event_type)}</code></td>
          <td>${esc(l.resource_type ? `${l.resource_type} ${l.resource_id ?? ''}` : '')}</td>
          <td><span class="badge r-${l.result}">${esc(l.result)}</span></td>
          <td class="muted">${esc(l.ip)}</td>
          <td>${esc(l.detail)}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="empty">ไม่พบรายการ</td></tr>'}</tbody>
      </table>`;
  };

  $('#logForm').onsubmit = (e) => {
    e.preventDefault();
    load().catch((err) => toast(err.message, 'error'));
  };
  await load();
}

// ===== อาคารและสัญญา =====
// แท็บห้องและพื้นที่: เพิ่มห้อง, เพิ่มสัญญา, เปิด/ปิดสัญญา, ถอนผู้สมัครออกจากสัญญา, เปิด/ปิดพื้นที่ส่วนกลาง
async function renderProperty() {
  const [buildings, units, contracts, areas] = await Promise.all([
    api('/admin/property/buildings'),
    api('/admin/property/units'),
    api('/admin/property/contracts'),
    api('/admin/property/common-areas'),
  ]);
  const buildingOpts = buildings.map((b) => `<option value="${b.id}">${esc(b.name)} (${esc(b.code)})</option>`).join('');
  const unitOpts = units.map((u) => `<option value="${u.id}">${esc(u.building_code)} · ${esc(u.unit_no)}</option>`).join('');

  $('#content').innerHTML = `
    <h2>เพิ่มห้อง</h2>
    <form id="unitForm" class="grid-form">
      <select name="building_id" required>${buildingOpts}</select>
      <input name="floor" type="number" min="1" max="100" placeholder="ชั้น" required>
      <input name="unit_no" maxlength="20" placeholder="เลขห้อง เช่น A-1101" required>
      <button>เพิ่มห้อง</button>
    </form>

    <h2 class="mt">ออกเลขที่สัญญา</h2>
    <form id="contractForm" class="grid-form">
      <select name="unit_id" required>${unitOpts}</select>
      <input name="contract_no" maxlength="30" placeholder="เลขที่สัญญา เช่น CT-A-1101" required>
      <button>ออกสัญญา</button>
    </form>
    <p class="muted small">ลูกบ้านจะสมัครได้ด้วยเลขที่สัญญาที่เปิดใช้งานอยู่และยังไม่มีผู้สมัคร</p>

    <h2 class="mt">สัญญาทั้งหมด</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>เลขที่สัญญา</th><th>ห้อง</th><th>ผู้สมัครแล้ว</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${contracts.map((c) => `<tr>
          <td><code>${esc(c.contract_no)}</code></td>
          <td>${esc(c.building_code)} · ${esc(c.unit_no)}</td>
          <td>${c.resident_name
            ? `${esc(c.resident_name)} <span class="muted small">(${esc(c.username)})</span>`
            : '<span class="muted">ยังไม่มี</span>'}</td>
          <td><span class="badge ${c.is_active ? 's-done' : 's-cancelled'}">${c.is_active ? 'เปิดใช้งาน' : 'ปิดแล้ว'}</span></td>
          <td class="row">
            <button class="small ${c.is_active ? 'warn' : 'good'}" data-ct-toggle="${c.id}" data-active="${c.is_active}">
              ${c.is_active ? 'ปิดสัญญา' : 'เปิดสัญญา'}</button>
            ${c.registered_user_id
              ? `<button class="danger small" data-ct-unlink="${c.id}">ถอนผู้สมัคร</button>` : ''}
          </td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">ยังไม่มีสัญญา</td></tr>'}</tbody>
      </table>
    </div>

    <h2 class="mt">พื้นที่ส่วนกลาง</h2>
    <form id="areaForm" class="row wrap">
      <input name="name" maxlength="100" placeholder="ชื่อพื้นที่ เช่น สวนหย่อม" required>
      <button>เพิ่มพื้นที่</button>
    </form>
    <div class="table-wrap" style="margin-top:12px">
      <table>
        <thead><tr><th>ชื่อพื้นที่</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${areas.map((a) => `<tr>
          <td>${esc(a.name)}</td>
          <td><span class="badge ${a.is_active ? 's-done' : 's-cancelled'}">${a.is_active ? 'เปิดใช้งาน' : 'ปิดแล้ว'}</span></td>
          <td><button class="small ${a.is_active ? 'warn' : 'good'}" data-area-toggle="${a.id}" data-active="${a.is_active}">
            ${a.is_active ? 'ปิด' : 'เปิด'}</button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;

  $('#unitForm').onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
    run(() => api('/admin/property/units', { method: 'POST', body: {
      building_id: Number(f.building_id),
      floor: Number(f.floor),
      unit_no: f.unit_no.trim(),
    } }), renderProperty);
  };

  $('#contractForm').onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
    run(() => api('/admin/property/contracts', { method: 'POST', body: {
      unit_id: Number(f.unit_id),
      contract_no: f.contract_no.trim(),
    } }), renderProperty);
  };

  $('#areaForm').onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
    run(() => api('/admin/property/common-areas', { method: 'POST', body: { name: f.name.trim() } }), renderProperty);
  };

  $('#content').onclick = async (e) => {
    const toggle = e.target.closest('[data-ct-toggle]');
    const unlink = e.target.closest('[data-ct-unlink]');
    const area = e.target.closest('[data-area-toggle]');

    if (toggle) {
      run(() => api(`/admin/property/contracts/${toggle.dataset.ctToggle}`, {
        method: 'PATCH', body: { is_active: toggle.dataset.active !== 'true' },
      }), renderProperty);
    } else if (unlink) {
      if (await confirmBox({ title: 'ถอนผู้สมัครจากสัญญา', message: 'ผู้ใช้เดิมที่ผูกกับสัญญานี้จะถูกปิดการใช้งาน ต้องการดำเนินการต่อหรือไม่', ok: 'ถอนผู้สมัคร', danger: true })) {
        run(() => api(`/admin/property/contracts/${unlink.dataset.ctUnlink}`, {
          method: 'PATCH', body: { unlink: true },
        }), renderProperty);
      }
    } else if (area) {
      run(() => api(`/admin/property/common-areas/${area.dataset.areaToggle}`, {
        method: 'PATCH', body: { is_active: area.dataset.active !== 'true' },
      }), renderProperty);
    }
  };
}

// เปิดหน้ามาแสดงแท็บภาพรวมก่อน
openTab('overview');