const $ = (s) => document.querySelector(s);

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
const STATUS = { pending: 'รอพิจารณา', assigned: 'มอบหมายแล้ว', in_progress: 'กำลังดำเนินการ', done: 'เสร็จสิ้น', closed: 'ปิดเรื่อง', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' };
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
const run = async (fn, after) => {
  try { await fn(); } catch (e) { toast(e.message, 'error'); }
  if (after) after();
};

// ชื่อรูปแบบ "ชื่อ นามสกุล (ตำแหน่ง)" แยกเป็น [ชื่อ, ตำแหน่ง]
function splitName(n) {
  const m = String(n ?? '').match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  return m ? [m[1], m[2]] : [String(n ?? ''), ''];
}
const nameCell = (n) => {
  const [a, b] = splitName(n);
  return esc(a) + (b ? `<div class="muted small">${esc(b)}</div>` : '');
};

const views = { overview: renderOverview, users: renderUsers, roles: renderRoles, acl: renderAcl, categories: renderCategories, property: renderProperty, logs: renderLogs };

function openTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#content').onclick = null;
  $('#content').onchange = null;
  views[name]().catch((e) => { $('#content').innerHTML = `<p class="error">${esc(e.message)}</p>`; });
}
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => openTab(b.dataset.tab)));

$('#logoutBtn').onclick = async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
};

// ===== ภาพรวม =====
function exportCsv(rows) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['เลขที่', 'ประเภท', 'ความเร่งด่วน', 'สถานที่', 'ผู้แจ้ง', 'ผู้รับผิดชอบ', 'สถานะ', 'วันที่แจ้ง'];
  const lines = rows.map((r) => [r.id, r.category, r.priority === 'urgent' ? 'ด่วน' : 'ปกติ', r.location,
    r.requester_name, r.technician_name || '', STATUS[r.status] || r.status, new Date(r.created_at).toLocaleString('th-TH-u-ca-gregory')].map(q).join(','));
  const blob = new Blob(['\ufeff' + [head.map(q).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `repair-requests-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function renderOverview() {
  const [st, users, roles] = await Promise.all([api('/requests/stats'), api('/admin/users'), api('/admin/roles')]);
  const n = (s) => st.byStatus.find((x) => x.status === s)?.n ?? 0;
  const total = st.byStatus.reduce((a, x) => a + x.n, 0);
  const active = users.filter((u) => u.is_active).length;
  const roleName = Object.fromEntries(roles.map((r) => [r.id, r.name]));
  const perRole = {};
  users.forEach((u) => { const k = roleName[u.role_id] || '-'; perRole[k] = (perRole[k] || 0) + 1; });
  const maxR = Math.max(1, ...Object.values(perRole));
  const card = (v, l, c = '') => `<div class="stat ${c}"><b>${v}</b><span>${l}</span></div>`;

  $('#content').innerHTML = `
    <h2>ภาพรวมระบบ</h2>
    <div class="stat-grid">
      ${card(`${active}<small>/${users.length}</small>`, 'ผู้ใช้ที่เปิดใช้งาน')}
      ${card(total, 'เรื่องแจ้งซ่อมทั้งหมด')}
      ${card(n('pending'), 'รอพิจารณา', 'st-open')}
      ${card(st.urgentOpen, 'ด่วนที่ยังค้าง', 'st-urgent')}
    </div>
    <div class="dash-cols">
      <div>
        <h3>ผู้ใช้แยกตาม Role</h3>
        ${Object.entries(perRole).map(([k, v]) => `<div class="bar-row"><span>${esc(k)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(v / maxR) * 100}%"></div></div><b>${v}</b></div>`).join('')}
      </div>
      <div>
        <h3>ทางลัด</h3>
        <div class="quick">
          <button data-go="users">+ เพิ่มผู้ใช้</button>
          <button class="ghost" data-go="categories">จัดการประเภทงาน</button>
          <button class="ghost" data-go="property">จัดการห้อง/พื้นที่</button>
          <button class="ghost" data-go="logs">ดู Log ล่าสุด</button>
          <button class="export" data-export>ส่งออกรายการแจ้งซ่อม (CSV)</button>
        </div>
      </div>
    </div>`;

  $('#content').onclick = (e) => {
    const go = e.target.closest('[data-go]');
    if (go) return openTab(go.dataset.go);
    if (e.target.closest('[data-export]')) {
      run(async () => exportCsv(await api('/requests')));
    }
  };
}

// ===== ผู้ใช้ =====
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
      <input name="username" placeholder="ชื่อผู้ใช้ (a-z 0-9 _ .)" required>
      <input name="name" placeholder="ชื่อ-นามสกุลจริง" required>
      <input name="position" placeholder="ตำแหน่ง/หน้าที่ เช่น ช่างไฟฟ้า">
      <input name="password" type="password" placeholder="รหัสผ่าน อย่างน้อย 8 ตัว" required>
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
        <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ-นามสกุล / ตำแหน่ง</th><th>Role</th><th>ฝ่าย</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr>
          <td>${esc(u.username)}</td>
          <td>${nameCell(u.name)}</td>
          <td><select data-field="role_id" data-id="${u.id}">${roleOpts(u.role_id)}</select></td>
          <td><select data-field="department_id" data-id="${u.id}">${deptOpts(u.department_id)}</select></td>
          <td><span class="badge ${u.is_active ? 's-done' : 's-cancelled'}">${u.is_active ? 'ใช้งาน' : 'ปิดแล้ว'}</span></td>
          <td><button class="ghost small" data-toggle="${u.id}" data-active="${u.is_active}">
            ${u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
            <button class="ghost small" data-rename="${u.id}" data-name="${esc(u.name)}">แก้ชื่อ</button>
            <button class="ghost small key" data-reset="${u.id}" data-name="${esc(u.username)}">ตั้งรหัสผ่านใหม่</button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;

  $('#userForm').onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
    f.name = f.position ? `${f.name.trim()} (${f.position.trim()})` : f.name.trim();
    delete f.position;
    run(() => api('/admin/users', { method: 'POST', body: {
      ...f, role_id: Number(f.role_id), department_id: nullable(f.department_id),
    } }), renderUsers);
  };

  $('#content').onchange = (e) => {
    const s = e.target.closest('select[data-field]');
    if (!s) return;
    run(() => api(`/admin/users/${s.dataset.id}`, {
      method: 'PATCH', body: { [s.dataset.field]: nullable(s.value) },
    }), renderUsers);
  };

  $('#userSearch').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#content tbody tr').forEach((tr) => {
      tr.hidden = !!q && !(tr.children[0].textContent + tr.children[1].textContent).toLowerCase().includes(q);
    });
  };

  $('#content').onclick = (e) => {
    const rn = e.target.closest('[data-rename]');
    if (rn) {
      const [cur, pos] = splitName(rn.dataset.name);
      const full = prompt('ชื่อ-นามสกุลจริง', cur);
      if (full === null || !full.trim()) return;
      const position = prompt('ตำแหน่ง/หน้าที่ (เว้นว่างถ้าไม่ระบุ)', pos);
      if (position === null) return;
      const name = position.trim() ? `${full.trim()} (${position.trim()})` : full.trim();
      run(() => api(`/admin/users/${rn.dataset.rename}/name`, { method: 'PATCH', body: { name } }), renderUsers);
      return;
    }
    const r = e.target.closest('[data-reset]');
    if (r) {
      const pw = prompt(`ตั้งรหัสผ่านใหม่ให้ ${r.dataset.name} (อย่างน้อย 8 ตัวอักษร)`);
      if (!pw) return;
      run(() => api(`/admin/users/${r.dataset.reset}/password`, { method: 'POST', body: { password: pw } })
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
async function renderRoles() {
  const roles = await api('/admin/roles');
  $('#content').innerHTML = `
    <h2>Role</h2>
    <form id="roleForm" class="row wrap">
      <input name="name" placeholder="ชื่อ Role เช่น viewer" required>
      <input name="description" placeholder="คำอธิบาย">
      <button>เพิ่ม Role</button>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ชื่อ</th><th>คำอธิบาย</th><th>จำนวนผู้ใช้</th><th></th></tr></thead>
        <tbody>${roles.map((r) => `<tr>
          <td><code>${esc(r.name)}</code></td>
          <td>${esc(r.description)}</td>
          <td>${r.user_count}</td>
          <td>${r.name === 'admin' ? '<span class="muted">ระบบ</span>'
            : `<button class="danger small" data-del="${r.id}">ลบ</button>`}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
    <p class="muted">กำหนดสิทธิ์ของ Role ได้ที่แท็บ "สิทธิ์ (ACL)"</p>`;

  $('#roleForm').onsubmit = (e) => {
    e.preventDefault();
    run(() => api('/admin/roles', { method: 'POST', body: formData(e.target) }), renderRoles);
  };

  $('#content').onclick = (e) => {
    const b = e.target.closest('[data-del]');
    if (b && confirm('ลบ Role นี้ใช่หรือไม่')) {
      run(() => api(`/admin/roles/${b.dataset.del}`, { method: 'DELETE' }), renderRoles);
    }
  };
}

// ===== ACL: Role × Permission =====
const PERM = {
  'request.create': ['งานแจ้งซ่อม', 'แจ้งเรื่องซ่อมใหม่', 'ลูกบ้านกรอกฟอร์มแจ้งเรื่อง'],
  'request.approve': ['งานแจ้งซ่อม', 'อนุมัติหรือไม่อนุมัติเรื่อง', 'เฉพาะเรื่องในแผนกของตัวเอง'],
  'request.assign': ['งานแจ้งซ่อม', 'มอบหมายงานให้ช่าง', 'เลือกผู้รับผิดชอบเมื่ออนุมัติ'],
  'request.update_status': ['งานแจ้งซ่อม', 'เริ่มงานและกดเสร็จงาน', 'เฉพาะงานที่ได้รับมอบหมาย'],
  'request.close': ['งานแจ้งซ่อม', 'ยืนยันปิดเรื่อง', 'ผู้แจ้งตรวจรับงานแล้วปิดเรื่อง'],
  'request.cancel.own': ['งานแจ้งซ่อม', 'ยกเลิกเรื่องของตัวเอง', 'ยกเลิกได้ขณะยังรอพิจารณา'],
  'announcement.read': ['ประกาศ', 'อ่านประกาศ'],
  'announcement.manage': ['ประกาศ', 'สร้างและยกเลิกประกาศ'],
  'attachment.upload': ['ไฟล์แนบและความคิดเห็น', 'อัปโหลดไฟล์แนบ'],
  'attachment.read': ['ไฟล์แนบและความคิดเห็น', 'เปิดดูไฟล์แนบ'],
  'attachment.delete': ['ไฟล์แนบและความคิดเห็น', 'ลบไฟล์แนบ'],
  'comment.create': ['ไฟล์แนบและความคิดเห็น', 'เขียนความคิดเห็น'],
  'dashboard.view': ['รายงานและบันทึก', 'ดูภาพรวมงาน', 'กราฟและตัวเลขสถิติ'],
  'log.read': ['รายงานและบันทึก', 'ดู Log การใช้งาน', 'ใครทำอะไรเมื่อไหร่'],
  'user.manage': ['จัดการระบบ', 'จัดการผู้ใช้', 'เข้าหน้า "จัดการระบบ" ได้'],
  'category.manage': ['จัดการระบบ', 'จัดการประเภทงาน'],
  'property.manage': ['จัดการระบบ', 'จัดการห้องและพื้นที่ส่วนกลาง'],
  'acl.manage': ['จัดการระบบ', 'กำหนดสิทธิ์ของแต่ละบทบาท', 'หน้านี้'],
  'permission.manage': ['จัดการระบบ', 'เพิ่มรายการสิทธิ์ใหม่'],
  'role.manage': ['จัดการระบบ', 'จัดการบทบาท'],
};
const PERM_GROUPS = ['งานแจ้งซ่อม', 'ประกาศ', 'ไฟล์แนบและความคิดเห็น', 'รายงานและบันทึก', 'จัดการระบบ', 'อื่นๆ'];
const ROLE_TH = { admin: 'ผู้ดูแลระบบ', dept_head: 'หัวหน้าแผนก', technician: 'เจ้าหน้าที่ช่าง', resident: 'ลูกบ้าน' };
const LOCKOUT = ['acl.manage', 'user.manage', 'permission.manage'];

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
        aria-label="${esc(ROLE_TH[r.name] || r.name)}: ${esc(label)}"
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
          `<th>${esc(ROLE_TH[r.name] || r.name)}<small>${esc(r.name)}</small></th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>

    <details class="ann-form">
      <summary>สำหรับนักพัฒนา: เพิ่มรายการสิทธิ์ใหม่</summary>
      <form id="permForm" class="row wrap" style="margin-top:12px">
        <input name="name" placeholder="เช่น equipment.read" required>
        <input name="description" placeholder="คำอธิบาย">
        <button>เพิ่ม</button>
      </form>
      <p class="muted">สิทธิ์ใหม่จะป้องกันอะไรจริงก็ต่อเมื่อ Route ในโค้ดเรียกใช้ requirePermission ด้วยชื่อนั้น</p>
    </details>`;

  $('#permForm').onsubmit = (e) => {
    e.preventDefault();
    run(() => api('/admin/permissions', { method: 'POST', body: formData(e.target) }), renderAcl);
  };

  $('#content').onchange = async (e) => {
    const cb = e.target;
    if (cb.type !== 'checkbox') return;
    if (!cb.checked && cb.dataset.rname === 'admin' && LOCKOUT.includes(cb.dataset.pname)
        && !confirm('การถอนสิทธิ์นี้ของผู้ดูแลระบบอาจทำให้คุณเข้าหน้าจัดการระบบไม่ได้อีก ต้องการถอนจริงหรือไม่')) {
      cb.checked = true;
      return;
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
async function renderCategories() {
  const [cats, depts] = await Promise.all([api('/admin/categories'), api('/admin/departments')]);
  const deptOpts = (sel) => depts.map((d) =>
    `<option value="${d.id}" ${d.id === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('');

  $('#content').innerHTML = `
    <h2>ประเภทงาน</h2>
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
          <td><button class="ghost small" data-cat-toggle="${c.id}" data-active="${c.is_active}">
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
async function renderLogs() {
  $('#content').innerHTML = `
    <h2>Log การใช้งาน</h2>
    <form id="logForm" class="row wrap">
      <input type="date" name="from" title="ตั้งแต่วันที่">
      <input type="date" name="to" title="ถึงวันที่">
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
            <button class="ghost small" data-ct-toggle="${c.id}" data-active="${c.is_active}">
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
          <td><button class="ghost small" data-area-toggle="${a.id}" data-active="${a.is_active}">
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

  $('#content').onclick = (e) => {
    const toggle = e.target.closest('[data-ct-toggle]');
    const unlink = e.target.closest('[data-ct-unlink]');
    const area = e.target.closest('[data-area-toggle]');

    if (toggle) {
      run(() => api(`/admin/property/contracts/${toggle.dataset.ctToggle}`, {
        method: 'PATCH', body: { is_active: toggle.dataset.active !== 'true' },
      }), renderProperty);
    } else if (unlink) {
      if (confirm('ถอนผู้สมัครจากสัญญานี้ ผู้ใช้เดิมจะถูกปิดการใช้งาน ยืนยันหรือไม่')) {
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

openTab('overview');