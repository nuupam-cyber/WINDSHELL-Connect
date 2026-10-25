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
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
const formData = (f) => Object.fromEntries(new FormData(f));
const nullable = (v) => (v === '' || v == null ? null : Number(v));
const run = async (fn, after) => {
  try { await fn(); } catch (e) { alert(e.message); }
  if (after) after();
};

const views = { users: renderUsers, roles: renderRoles, acl: renderAcl, categories: renderCategories, property: renderProperty, logs: renderLogs };

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
      <input name="name" placeholder="ชื่อ-สกุล" required>
      <input name="password" type="password" placeholder="รหัสผ่าน อย่างน้อย 8 ตัว" required>
      <select name="role_id" required>${roleOpts(null)}</select>
      <select name="department_id">${deptOpts(null)}</select>
      <button>เพิ่มผู้ใช้</button>
    </form>

    <h2 class="mt">ผู้ใช้ทั้งหมด</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ</th><th>Role</th><th>ฝ่าย</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr>
          <td>${esc(u.username)}</td>
          <td>${esc(u.name)}</td>
          <td><select data-field="role_id" data-id="${u.id}">${roleOpts(u.role_id)}</select></td>
          <td><select data-field="department_id" data-id="${u.id}">${deptOpts(u.department_id)}</select></td>
          <td><span class="badge ${u.is_active ? 's-done' : 's-cancelled'}">${u.is_active ? 'ใช้งาน' : 'ปิดแล้ว'}</span></td>
          <td><button class="ghost small" data-toggle="${u.id}" data-active="${u.is_active}">
            ${u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;

  $('#userForm').onsubmit = (e) => {
    e.preventDefault();
    const f = formData(e.target);
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

  $('#content').onclick = (e) => {
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
async function renderAcl() {
  const { roles, permissions, grants } = await api('/admin/acl');
  const granted = new Set(grants.map((g) => `${g.role_id}-${g.permission_id}`));

  $('#content').innerHTML = `
    <h2>สิทธิ์ของแต่ละ Role (ACL)</h2>
    <p class="muted">ติ๊กเพื่อให้สิทธิ์ ยกเลิกเพื่อถอนสิทธิ์ มีผลทันทีโดยไม่ต้องรีสตาร์ต Server</p>
    <div class="table-wrap">
      <table class="matrix">
        <thead><tr><th>Permission</th>${roles.map((r) => `<th>${esc(r.name)}</th>`).join('')}</tr></thead>
        <tbody>${permissions.map((p) => `<tr>
          <td><code>${esc(p.name)}</code><div class="muted small">${esc(p.description)}</div></td>
          ${roles.map((r) => `<td><input type="checkbox" data-role="${r.id}" data-perm="${p.id}"
            ${granted.has(`${r.id}-${p.id}`) ? 'checked' : ''}></td>`).join('')}
        </tr>`).join('')}</tbody>
      </table>
    </div>

    <h2 class="mt">เพิ่ม Permission ใหม่</h2>
    <form id="permForm" class="row wrap">
      <input name="name" placeholder="เช่น equipment.read" required>
      <input name="description" placeholder="คำอธิบาย">
      <button>เพิ่ม</button>
    </form>
    <p class="muted">Permission ใหม่จะป้องกันอะไรจริงก็ต่อเมื่อ Route ในโค้ดเรียกใช้ requirePermission ด้วยชื่อนั้น</p>`;

  $('#permForm').onsubmit = (e) => {
    e.preventDefault();
    run(() => api('/admin/permissions', { method: 'POST', body: formData(e.target) }), renderAcl);
  };

  $('#content').onchange = (e) => {
    const cb = e.target;
    if (cb.type !== 'checkbox') return;
    const role_id = Number(cb.dataset.role);
    const permission_id = Number(cb.dataset.perm);
    run(() => (cb.checked
      ? api('/admin/acl', { method: 'POST', body: { role_id, permission_id } })
      : api(`/admin/acl/${role_id}/${permission_id}`, { method: 'DELETE' })), renderAcl);
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
    load().catch((err) => alert(err.message));
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

openTab('users');