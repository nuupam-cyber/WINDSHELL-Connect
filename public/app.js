// =====================================================================
// public/app.js — JavaScript ฝั่งเบราว์เซอร์ของหน้าหลัก (index.html) ใช้ได้ทุก Role
// ทำงานแบบหน้าเดียว (Single Page): ดึงข้อมูลจาก API ด้วย fetch แล้ววาด HTML ใหม่โดยไม่โหลดหน้า
//
// ส่วนประกอบหลัก (ไล่ตามลำดับในไฟล์):
//   1) ตัวช่วย: api(), can(), esc(), dialog(), toast()
//   2) renderShell(): สลับหน้าเข้าสู่ระบบ / หน้าหลัก และซ่อน-แสดงส่วนต่างๆ ตามสิทธิ์
//   3) เข้าสู่ระบบ / สมัคร / ออกจากระบบ
//   4) ฟอร์มแจ้งเรื่องใหม่ (แนบไฟล์ได้)
//   5) รายการคำร้อง, งานที่ค้างอยู่, ตัวเลขสรุป
//   6) หน้ารายละเอียด + ปุ่มเปลี่ยนสถานะ + ไฟล์แนบ
//   7) แดชบอร์ด, ประกาศ, กระดิ่งแจ้งเตือน
//
// สำคัญ: การซ่อนปุ่มในไฟล์นี้เพื่อความสะดวกของผู้ใช้เท่านั้น ความปลอดภัยจริงอยู่ที่ server ตรวจซ้ำทุกคำขอ
// =====================================================================
const $ = (s) => document.querySelector(s);
const STATUS = {
  pending: 'รอพิจารณา', assigned: 'มอบหมายแล้ว', in_progress: 'กำลังดำเนินการ',
  done: 'เสร็จสิ้น', closed: 'ปิดเรื่อง', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก',
};
// me = ข้อมูลผู้ใช้ที่ล็อกอินอยู่ (จาก /api/auth/me) รวมรายการ permissions
let me = null;
let DIR = []; // รายชื่อเจ้าหน้าที่พร้อมตำแหน่ง
const refOf = (r) => r.ref || `#${r.id}`;
const posByName = (n) => DIR.find((d) => d.name === n)?.position || '';
const posById = (id) => DIR.find((d) => Number(d.id) === Number(id))?.position || '';
const person = (n) => (n ? esc(n) + (posByName(n) ? `<div class="muted small">${esc(posByName(n))}</div>` : '') : '—');
const withPos = (n) => esc(n) + (posByName(n) ? ` <span class="muted">(${esc(posByName(n))})</span>` : '');
// ชื่อไทยของ Role หลัก (Role ที่เพิ่มผ่านเว็บใช้คำอธิบายของ Role แทน)
const ROLE = { admin: 'ผู้ดูแลระบบ', dept_head: 'หัวหน้าแผนก', technician: 'เจ้าหน้าที่ช่าง', resident: 'ลูกบ้าน' };

// api(): ตัวกลางเรียก API ทุกตัว
// - ส่ง cookie session ไปด้วย (credentials: same-origin)
// - ถ้าเป็น FormData (มีไฟล์) ส่งตรงๆ ไม่งั้นแปลงเป็น JSON
// - ถ้า server ตอบ 401 (session หมดอายุ) พากลับหน้าเข้าสู่ระบบ
// - ถ้าไม่สำเร็จ โยน Error พร้อมข้อความภาษาไทยจาก server เพื่อแสดงให้ผู้ใช้เห็น
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
// can('request.create') → true/false ใช้ตัดสินว่าจะแสดงปุ่ม/ส่วนไหน
// esc(): แปลงอักขระพิเศษ HTML ก่อนแสดงข้อมูลจากผู้ใช้ ป้องกัน XSS (สคริปต์แปลกปลอมฝังมากับข้อความ)
const can = (p) => !!me && me.permissions.includes(p);
// canReadRequests(): มีสิทธิ์ดูเรื่องแจ้งซ่อมอย่างน้อย 1 ขอบเขต (ทั้งหมด / ของตน / ในฝ่าย / ที่ได้รับมอบหมาย)
const canReadRequests = () => ['request.read.all', 'request.read.own', 'request.read.dept', 'request.read.assigned'].some((p) => can(p));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDay = (d) => new Date(d).toLocaleDateString('th-TH-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtClock = (d) => new Date(d).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDate = (d) => new Date(d).toLocaleString('th-TH-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' });
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

// showImage: ป๊อปอัปดูรูปไฟล์แนบ (<dialog>) ปิดได้ด้วยปุ่ม ×, กด Esc หรือคลิกพื้นหลังนอกรูป
// รูปโหลดจาก /api/attachments/:id ซึ่ง server ตรวจสิทธิ์และบันทึก Log การเปิดดูเหมือนเปิดแท็บใหม่
function showImage(src, name) {
  const d = document.createElement('dialog');
  d.className = 'dlg img-view';
  d.innerHTML = `
    <div class="img-view-head"><span>${esc(name)}</span>
      <button type="button" class="link-btn" data-close aria-label="ปิด">×</button></div>
    <img src="${src}" alt="${esc(name)}">
    <a class="small" href="${src}" target="_blank" rel="noopener">เปิดขนาดเต็มในแท็บใหม่</a>`;
  document.body.appendChild(d);
  d.querySelector('[data-close]').onclick = () => d.close();
  // คลิกโดนตัว dialog เอง (คือพื้นหลังรอบกล่อง) ให้ปิด
  d.onclick = (e) => { if (e.target === d) d.close(); };
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

// toast: ข้อความแจ้งเล็กๆ มุมจอ หายเองใน 4.5 วินาที
function toast(msg, kind = 'info') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
const alertErr = (e) => toast(e.message, 'error');

$('#meBtn').onclick = () => openAccount((name) => { if (me) { me.name = name; $('#userName').textContent = name; } });

// renderShell: เรียกหลังรู้ว่าล็อกอินหรือยัง
// ทุก element ที่มี data-perm="ชื่อสิทธิ์" ใน index.html จะถูกซ่อนถ้าผู้ใช้ไม่มีสิทธิ์นั้น
// แล้วโหลดข้อมูลที่ผู้ใช้คนนี้มีสิทธิ์เห็น
function renderShell() {
  $('#login').classList.toggle('hidden', !!me);
  $('#app').classList.toggle('hidden', !me);
  if (!me) return;
  const shownName = me.name;
  $('#userName').textContent = shownName;
  // Role ที่เพิ่มผ่านเว็บไม่มีใน ROLE ใช้คำอธิบายของ Role เป็นชื่อไทยแทน
  const roleName = ROLE[me.role] || me.role_description || me.role;
  // ขอบเขตข้อมูลที่เห็น คิดจากสิทธิ์ read ที่ได้จริง (ใช้ได้กับทุก Role รวมถึง Role ที่เพิ่มผ่านเว็บ)
  const scope = can('request.read.all') ? 'ทุกเรื่องในระบบ'
    : [can('request.read.dept') && 'เรื่องในแผนกของคุณ', can('request.read.assigned') && 'งานที่ได้รับมอบหมาย',
      can('request.read.own') && 'เรื่องที่คุณแจ้ง'].filter(Boolean).join(' · ');
  const sub = me.position || roleName;
  $('#userRole').textContent = sub;
  $('#userRole').classList.toggle('hidden', sub === shownName);
  // ปุ่มจัดการระบบ: มีสิทธิ์ส่วน Admin อย่างน้อย 1 อย่าง (ตรงกับ ADMIN_AREA_PERMISSIONS ฝั่ง server)
  const hasAdmin = ['user.manage', 'role.manage', 'permission.manage', 'acl.manage', 'category.manage', 'property.manage', 'log.read'].some(can);
  $('#adminLink').classList.toggle('hidden', !hasAdmin);
  document.querySelectorAll('[data-perm]').forEach((el) =>
    el.classList.toggle('hidden', !can(el.dataset.perm)));

  // ปรับหน้าตามขอบเขตงานของ Role (ตัดสินจากสิทธิ์ ไม่ผูกกับชื่อ Role จึงใช้กับ Role ที่เพิ่มผ่านเว็บได้ด้วย)
  // - ไม่มีสิทธิ์ดูเรื่องแจ้งซ่อม (request.read.*) เช่น ผู้ประกาศ → ซ่อนสรุป งานค้าง รายการเรื่อง เหลือหน้าประกาศ
  // - แจ้งเรื่องได้ต้องมีทั้ง request.create และบัญชีผูกกับห้องชุด (server ตรวจซ้ำทั้งสองข้อ)
  const readsRequests = canReadRequests();
  const canCreate = can('request.create') && me.has_unit;
  document.querySelectorAll('.needs-requests').forEach((el) => el.classList.toggle('hidden', !readsRequests));
  document.querySelectorAll('[data-perm="request.create"]').forEach((el) => el.classList.toggle('hidden', !canCreate));
  document.querySelector('.work-grid').classList.toggle('solo', !canCreate);
  $('#annCard').classList.toggle('hidden', !can('announcement.read') && !can('announcement.manage'));
  // หน้าที่หลักคือประกาศ (ไม่ได้ดูเรื่องแจ้งซ่อม) → เปิดฟอร์มสร้างประกาศไว้เลย ไม่ต้องกดขยาย
  document.querySelector('.ann-form').open = !readsRequests && can('announcement.manage');
  $('#pageTitle').textContent = readsRequests ? 'ภาพรวมเรื่องแจ้งซ่อม' : 'ประกาศจากนิติบุคคล';
  $('#scopeNote').textContent = readsRequests ? 'กำลังแสดง: ' + scope : 'จัดการและติดตามประกาศถึงลูกบ้าน';
  // ไม่มีสิทธิ์ใช้งานหน้าหลักเลย (ไม่ดูเรื่อง ไม่แจ้งเรื่อง ไม่มีประกาศ ไม่มีแดชบอร์ด) → แสดงการ์ดแจ้งแทนหน้าว่าง
  // ถ้ามีแค่สิทธิ์ฝั่ง Admin แจ้งให้ไปหน้าจัดการระบบแทน
  const usesMain = readsRequests || canCreate || can('announcement.read') || can('announcement.manage') || can('dashboard.view');
  $('#noAccess').classList.toggle('hidden', usesMain);
  document.querySelector('.hello').classList.toggle('hidden', !usesMain);
  if (!usesMain) {
    $('#noAccessUser').textContent = me.username;
    $('#noAccessRole').textContent = roleName;
    $('#noAccessTitle').textContent = hasAdmin ? 'บัญชีนี้ใช้งานส่วนจัดการระบบ' : 'บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน';
    $('#noAccessText').textContent = hasAdmin
      ? 'หน้าหลักไม่มีส่วนที่บทบาทของคุณใช้งานได้ ไปที่หน้าจัดการระบบเพื่อทำงานตามสิทธิ์ที่ได้รับ'
      : 'ผู้ดูแลระบบยังไม่ได้กำหนดสิทธิ์ให้บทบาทของคุณ กรุณาติดต่อนิติบุคคลหรือผู้ดูแลระบบ';
    $('#noAccessAdmin').classList.toggle('hidden', !hasAdmin);
  }
  if (canCreate) loadOptions().catch(alertErr);
  if (readsRequests) loadRequests().catch(alertErr);
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

// ส่งชื่อผู้ใช้/รหัสผ่านไป /api/auth/login → สำเร็จแล้วดึง /api/auth/me มาเก็บใน me → วาดหน้าหลัก
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#loginError').className = 'error';
  try {
    await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    me = await api('/auth/me');
    e.target.reset();
    $('#loginError').textContent = '';
    renderShell();
    if(me.role === 'technician'){
      alert('Hello World');
    }
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
};

// สมัครลูกบ้าน: ตรวจรหัสผ่าน 2 ช่องตรงกันก่อน (ฝั่งเบราว์เซอร์) แล้ว server ตรวจซ้ำทุกช่อง
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

// ออกจากระบบ: server ทำลาย session แล้วโหลดหน้าใหม่ กลับไปหน้าเข้าสู่ระบบ
$('#logoutBtn').onclick = async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
};

// ===== ตัวเลือกฟอร์มแจ้งซ่อม =====
// ดึงประเภทงาน พื้นที่ส่วนกลาง และห้องของผู้ใช้ มาเติมใน dropdown ของฟอร์ม
async function loadOptions() {
  const o = await api('/requests/options');
  $('#unitLabel').textContent = o.unit ? o.unit.unit_no : 'ยังไม่ได้ผูกห้อง';
  $('#categorySel').innerHTML = '<option value="">— เลือกประเภทงาน —</option>' +
    o.categories.map((c) =>
      `<option value="${c.id}" data-req="${c.requires_detail}" data-photo="${!!c.needs_photo}">${esc(c.name)}${c.requires_detail ? ' *' : ''}</option>`
    ).join('');
  $('#areaSel').innerHTML = '<option value="">— เลือกพื้นที่ส่วนกลาง —</option>' +
    o.commonAreas.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
}

// งานฝ่ายช่างอาคาร (needs_photo) บังคับแนบรูป: เปลี่ยนป้ายกำกับ (ตรวจจริงตอนกดส่ง และ server ตรวจซ้ำ)
function syncPhotoRule() {
  const need = $('#categorySel').selectedOptions[0]?.dataset.photo === 'true';
  $('#fileLabel').textContent = need ? 'แนบรูปหรือไฟล์ (จำเป็น) *' : 'แนบรูปหรือไฟล์ (ไม่บังคับ)';
}

// shrinkImage: ย่อรูปในเบราว์เซอร์ก่อนส่ง ด้านยาวสุดไม่เกิน 1600 px แล้วบันทึกเป็น JPEG คุณภาพ 0.82
// รูปจากกล้องมือถือ 4–12 MB มักเหลือราว 200–600 KB อัปโหลดเร็วขึ้นและไม่เกิน 5 MB
// ไม่ใช่รูป (PDF) หรือรูปเล็กอยู่แล้ว หรือย่อแล้วไม่เล็กลง → คืนไฟล์เดิม
// การตรวจนี้ช่วยผู้ใช้เท่านั้น server ยังตรวจขนาดและชนิดไฟล์ซ้ำเสมอ
const SHRINK_MAX_SIDE = 1600;
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size < 500 * 1024) return file;
  try {
    const img = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, SHRINK_MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // PNG พื้นใสให้เป็นพื้นขาว (JPEG ไม่มีพื้นใส)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // เบราว์เซอร์อ่านรูปนี้ไม่ได้ ส่งไฟล์เดิมให้ server ตรวจ
  }
}

// ===== ไฟล์แนบในฟอร์มแจ้งเรื่อง: เลือกไฟล์หรือถ่ายรูปได้ 1 ไฟล์ ลบไฟล์ที่เลือกผิดออกแล้วเลือกใหม่ได้ก่อนกดส่ง =====
const MAX_FILES = 1; // แต่ละคนแนบได้คนละ 1 ไฟล์ต่อเรื่อง (server ตรวจซ้ำ)
const MAX_SIZE = 5 * 1024 * 1024;
let picked = []; // ไฟล์ที่เลือกไว้ (ยังไม่ได้ส่ง)

function renderPicked() {
  $('#pickedFiles').innerHTML = picked.map((f, i) => `
    <li>
      ${f.type.startsWith('image/') ? `<img src="${URL.createObjectURL(f)}" alt="">` : '<span class="pdf">PDF</span>'}
      <span class="picked-name">${esc(f.name)}<small class="muted">${fmtSize(f.size)}</small></span>
      <button type="button" class="ghost small cancel" data-unpick="${i}">ลบ</button>
    </li>`).join('');
  const left = MAX_FILES - picked.length;
  $('#pickBtn').disabled = left === 0;
  $('#cameraBtn').disabled = left === 0;
  $('#pickBtn').textContent = left === 0 ? 'แนบครบแล้ว (ลบไฟล์เดิมก่อนถ้าจะเปลี่ยน)' : '+ เลือกไฟล์';
}

$('#pickBtn').onclick = () => $('#createFiles').click();
$('#cameraBtn').onclick = () => $('#createCamera').click();

// ตรวจขนาดและจำนวนทันทีที่เลือก (server ตรวจซ้ำอีกครั้งตอนส่ง รวมถึงชนิดไฟล์จากเนื้อไฟล์)
// รูปถูกย่อด้วย shrinkImage ก่อน จึงตรวจขนาดหลังย่อ ส่วน PDF ย่อไม่ได้ ต้องไม่เกิน 5 MB เอง
async function addPicked(e) {
  const msg = $('#createMsg');
  msg.textContent = '';
  const input = e.target;
  for (const original of input.files) {
    if (picked.length >= MAX_FILES) { showMsg(msg, 'แนบได้ 1 ไฟล์ ลบไฟล์เดิมก่อนถ้าจะเปลี่ยน'); break; }
    const f = await shrinkImage(original);
    if (f.size > MAX_SIZE) { showMsg(msg, `${f.name} ใหญ่เกิน 5 MB`); continue; }
    if (!picked.some((p) => p.name === f.name && p.size === f.size)) picked.push(f);
  }
  input.value = ''; // ล้างช่อง ให้เลือกไฟล์ชื่อเดิมซ้ำได้หลังลบ
  renderPicked();
}
$('#createFiles').onchange = addPicked;
$('#createCamera').onchange = addPicked;

$('#pickedFiles').onclick = (e) => {
  const b = e.target.closest('[data-unpick]');
  if (!b) return;
  picked.splice(Number(b.dataset.unpick), 1);
  renderPicked();
};

$('#categorySel').onchange = () => {
  syncPhotoRule();
  const needed = $('#categorySel').selectedOptions[0]?.dataset.req === 'true';
  $('#descInput').required = needed;
  $('#descLabel').textContent = needed ? 'รายละเอียด (จำเป็น) *' : 'รายละเอียดเพิ่มเติม (ไม่บังคับ)';
};

// ปรับหน้าตาฟอร์มตามความเร่งด่วน และเตือนถ้ามีเรื่องประเภทเดียวกันที่ยังค้างอยู่
function syncCreateForm() {
  const f = $('#createForm');
  const urgent = f.priority.value === 'urgent';
  $('#priorityHint').textContent = urgent
    ? 'เรื่องนี้จะถูกทำเครื่องหมายว่าด่วน ใช้เฉพาะเมื่อกระทบการอยู่อาศัยจริง'
    : 'เลือก “ด่วน” เมื่อกระทบการอยู่อาศัย เช่น น้ำรั่วหรือไฟดับ';
  const b = f.querySelector('button.send');
  b.classList.toggle('urgent', urgent);
  b.textContent = urgent ? 'ส่งคำขอด่วน' : 'ส่งคำขอ';

  const opt = $('#categorySel').selectedOptions[0];
  const name = opt && opt.value ? opt.textContent.replace(/\s*\*$/, '') : '';
  const dup = name && me
    ? allRows.filter((r) => r.category === name && OPEN_STATUS.includes(r.status) && isMine(r, 'requester_id', 'requester_name'))
    : [];
  const box = $('#dupNotice');
  box.classList.toggle('hidden', !dup.length);
  box.innerHTML = dup.length
    ? `คุณมีเรื่อง “${esc(name)}” ที่ยังค้างอยู่ ${dup.length} เรื่อง: `
      + dup.map((r) => `<a href="#" data-open="${r.id}">${refOf(r)} ${STATUS[r.status]}</a>`).join(', ')
      + '<br><span class="small">ตรวจสอบก่อนส่ง เพื่อไม่ให้แจ้งซ้ำ</span>'
    : '';
}
$('#createForm').addEventListener('change', syncCreateForm);
$('#dupNotice').onclick = (e) => {
  const a = e.target.closest('[data-open]');
  if (!a) return;
  e.preventDefault();
  openDetail(a.dataset.open).catch(alertErr);
};

$('#createForm').addEventListener('change', (e) => {
  if (e.target.name === 'location_type')
    $('#areaWrap').classList.toggle('hidden', e.target.value !== 'common');
});

// ส่งฟอร์มแจ้งเรื่อง: ตรวจเบื้องต้นในเบราว์เซอร์ (ช่วยผู้ใช้) แล้ว server ตรวจซ้ำทั้งหมดอีกครั้ง
$('#createForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const msg = $('#createMsg');
  msg.className = 'muted';

  if (!f.category_id) return showMsg(msg, 'กรุณาเลือกประเภทงาน');
  if (f.location_type === 'common' && !f.common_area_id) {
    return showMsg(msg, 'กรุณาเลือกพื้นที่ส่วนกลาง');
  }

  const files = picked;
  if ($('#categorySel').selectedOptions[0]?.dataset.photo === 'true' && !files.length) {
    return showMsg(msg, 'งานประเภทนี้ต้องแนบรูปอย่างน้อย 1 ไฟล์ เพื่อให้ช่างเห็นปัญหา');
  }

  // ส่งข้อมูลและไฟล์ในคำขอเดียว เพื่อให้ Server ตรวจและบังคับแนบไฟล์ได้
  const body = new FormData();
  body.append('category_id', f.category_id);
  body.append('priority', f.priority);
  body.append('location_type', f.location_type);
  body.append('description', f.description || '');
  if (f.location_type === 'common') body.append('common_area_id', f.common_area_id);
  files.forEach((file) => body.append('file', file));

  try {
    await api('/requests', { method: 'POST', body });
    e.target.reset();
    picked = [];
    renderPicked();
    syncPhotoRule();
    syncCreateForm();
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

// ปุ่ม "ส่งออก CSV": server สร้างไฟล์เฉพาะรายการที่ผู้ใช้มองเห็น และตรวจสิทธิ์ request.export ทุกครั้ง
// ถ้าสิทธิ์ถูกถอนไปแล้ว server ตอบ 403 → แสดงข้อความแทนการดาวน์โหลด
$('#exportBtn').onclick = async () => {
  try {
    const res = await fetch('/api/requests/export', { credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'ส่งออกไม่สำเร็จ');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = `repair-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) { alertErr(err); }
};

// โหลดรายการคำร้อง (server กรองตามสิทธิ์มาให้แล้ว) และรายชื่อเจ้าหน้าที่ แล้ววาดทุกส่วนที่ใช้ข้อมูลนี้
async function loadRequests() {
  [allRows, DIR] = await Promise.all([api('/requests'), api('/directory').catch(() => [])]);
  renderSummary();
  renderTodo();
  renderRows();
  syncCreateForm();
}

// ===== งานที่ยังค้างอยู่ (แสดงบนสุด ไม่ต้องเลื่อนหา) =====
const OPEN_STATUS = ['pending', 'assigned', 'in_progress', 'done'];
let todoExpanded = false;
const isMine = (r, idF, nameF) =>
  (r[idF] !== undefined && r[idF] !== null ? Number(r[idF]) === Number(me.id) : r[nameF] === me.name);

// คืนข้อความปุ่มถ้าเรื่องนี้รอให้ "คุณ" ทำ ไม่งั้นคืนค่าว่าง (ใช้กฎเดียวกับปุ่มในหน้ารายละเอียด)
// ปุ่มลัดในการ์ด "งานที่ยังค้างอยู่" แต่ละ Role เห็นงานที่ตัวเองต้องทำต่อ
function todoAction(r) {
  if (r.status === 'pending' && (can('request.assign') || can('request.approve'))) return 'พิจารณาเรื่อง';
  if (r.status === 'assigned' && can('request.update_status') && isMine(r, 'technician_id', 'technician_name')) return 'เริ่มดำเนินการ';
  if (r.status === 'in_progress' && can('request.update_status') && isMine(r, 'technician_id', 'technician_name')) return 'บันทึกว่าเสร็จ';
  if (r.status === 'done' && can('request.close') && isMine(r, 'requester_id', 'requester_name')) return 'ตรวจรับงาน';
  return '';
}

function waited(d) {
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  if (m < 60) return 'เพิ่งแจ้ง';
  const h = Math.floor(m / 60);
  return h < 24 ? `แจ้งมา ${h} ชั่วโมง` : `แจ้งมา ${Math.floor(h / 24)} วัน`;
}

function renderTodo() {
  const items = allRows.filter((r) => OPEN_STATUS.includes(r.status)).map((r) => ({ r, act: todoAction(r) }));
  // เรียง: รอคุณทำ > ด่วน > แจ้งมานานสุดก่อน
  items.sort((a, b) => (!!b.act - !!a.act)
    || ((b.r.priority === 'urgent') - (a.r.priority === 'urgent'))
    || new Date(a.r.created_at) - new Date(b.r.created_at));
  const need = items.filter((x) => x.act).length;

  $('#todoCard').classList.toggle('has-need', need > 0);
  const cnt = $('#todoCount');
  cnt.textContent = need ? `รอคุณดำเนินการ ${need} รายการ` : items.length ? `เปิดอยู่ ${items.length} รายการ` : '';
  cnt.classList.toggle('hidden', !cnt.textContent);
  cnt.classList.toggle('calm', !need);

  const shown = todoExpanded ? items : items.slice(0, 5);
  $('#todoList').innerHTML = items.length
    ? shown.map(({ r, act }) => `
        <div class="todo ${act ? 'need' : ''} ${r.priority === 'urgent' ? 'urgent' : ''}" role="button" tabindex="0" data-open="${r.id}">
          <div class="todo-main">
            <div class="todo-title">${refOf(r)} ${esc(r.category)}${r.priority === 'urgent' ? '<span class="badge urgent">ด่วน</span>' : ''}</div>
            <div class="todo-sub">${esc(r.location)}${r.requester_name && r.requester_name !== me.name ? ` · ผู้แจ้ง ${esc(r.requester_name)}` : ''} · ${waited(r.created_at)}</div>
          </div>
          ${act ? `<span class="todo-act">${act}</span>` : `<span class="badge s-${r.status}">${STATUS[r.status]}</span>`}
        </div>`).join('')
      + (items.length > 5
        ? `<button class="ghost small" data-todo-more>${todoExpanded ? 'ย่อรายการ' : `ดูอีก ${items.length - 5} รายการ`}</button>` : '')
    : '<p class="an-empty">ไม่มีงานค้างในขณะนี้</p>';
}

$('#todoList').onclick = (e) => {
  if (e.target.closest('[data-todo-more]')) { todoExpanded = !todoExpanded; renderTodo(); return; }
  const it = e.target.closest('[data-open]');
  if (it) openDetail(it.dataset.open).catch(alertErr);
};
$('#todoList').onkeydown = (e) => {
  const it = e.target.closest('[data-open]');
  if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDetail(it.dataset.open).catch(alertErr); }
};

// ตัวเลขสรุป 4 ช่องด้านบน นับจากรายการที่ผู้ใช้มองเห็น
function renderSummary() {
  const n = (...st) => allRows.filter((r) => st.includes(r.status)).length;
  const cell = (v, l, c = '') => `<div class="sum ${c}"><b>${v}</b><span>${l}</span></div>`;
  $('#summary').innerHTML =
    cell(n('pending'), 'รอพิจารณา') +
    cell(n('assigned', 'in_progress'), 'กำลังดำเนินการ', 'open') +
    cell(n('done'), 'รอยืนยันปิดเรื่อง', 'wait') +
    cell(n('closed'), 'ปิดเรื่องแล้ว', 'ok');
}

// วาดตารางรายการ พร้อมกรองตามสถานะและคำค้นหา (กรองในเบราว์เซอร์ ไม่ต้องเรียก API ใหม่)
function renderRows() {
  const s = $('#statusFilter').value;
  const q = $('#searchBox').value.trim().toLowerCase();
  const rows = allRows.filter((r) => (!s || r.status === s) && (!q ||
    [refOf(r), `#${r.id}`, r.category, r.location, r.requester_name, r.technician_name]
      .some((v) => String(v ?? '').toLowerCase().includes(q))));
  $('#rows').innerHTML = rows.length
    ? rows.map((r) => `<tr data-id="${r.id}">
        <td data-l="เลขที่" class="refno">${refOf(r)}</td>
        <td data-l="ประเภท">${esc(r.category)}${r.priority === 'urgent' ? '<span class="badge urgent">ด่วน</span>' : ''}</td>
        <td data-l="สถานที่">${esc(r.location)}</td>
        <td data-l="ผู้แจ้ง">${esc(r.requester_name)}</td>
        <td data-l="ผู้รับผิดชอบ">${person(r.technician_name)}</td>
        <td data-l="สถานะ"><span class="badge s-${r.status}">${STATUS[r.status]}</span></td>
        <td class="muted" data-l="วันที่แจ้ง">${fmtDay(r.created_at)}<div class="small">${fmtClock(r.created_at)} น.</div></td>
      </tr>`).join('')
    : `<tr><td colspan="7" class="empty">${allRows.length ? 'ไม่พบรายการที่ตรงกับตัวกรอง' : 'ยังไม่มีรายการแจ้งเรื่อง'}</td></tr>`;
}

// แถบความคืบหน้า 5 ขั้นในหน้ารายละเอียด (ไม่อนุมัติ/ยกเลิก แสดงเป็นข้อความแทน)
const FLOW = ['pending', 'assigned', 'in_progress', 'done', 'closed'];
function progress(st) {
  const i = FLOW.indexOf(st);
  if (i < 0) return `<p class="muted">${st === 'rejected' ? 'เรื่องนี้ไม่ได้รับอนุมัติ' : 'เรื่องนี้ถูกยกเลิกแล้ว'}</p>`;
  return `<ol class="flow ${i === FLOW.length - 1 ? 'complete' : ''}">${FLOW.map((k, j) =>
    `<li style="--i:${j}" class="${j < i ? 'past' : j === i ? 'now' : ''}">${STATUS[k]}</li>`).join('')}</ol>`;
}

$('#rows').onclick = (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (tr) openDetail(tr.dataset.id).catch(alertErr);
};

// ประเภทงาน -> ตำแหน่งที่รับผิดชอบ (จับคู่ด้วยคำสำคัญในชื่อประเภท / ตำแหน่ง) ชื่อตำแหน่งดูได้ที่ src/config/positions.js
const ROLE_FOR = [['ไฟฟ้า', 'ไฟฟ้า'], ['ประปา', 'ประปา'], ['ลิฟต์', 'ลิฟต์'], ['ปรับอากาศ', 'แอร์'], ['แอร์', 'แอร์'], ['ประตู', 'ประตู'], ['กุญแจ', 'ประตู'], ['ดิจิทัล', 'ดิจิทัล'], ['สัญญาณ', 'ดิจิทัล'], ['ความสะอาด', 'ความสะอาด'], ['รักษาความปลอดภัย', 'รักษาความปลอดภัย']];
// pickerHtml: รายชื่อช่างให้หัวหน้าฝ่ายเลือก ช่างที่ตำแหน่งตรงกับประเภทงานขึ้นก่อน
function pickerHtml(r, techs) {
  const kw = (ROLE_FOR.find(([c]) => (r.category || '').includes(c)) || [])[1];
  const match = kw ? techs.filter((t) => posById(t.id).includes(kw)) : [];
  const list = match.length ? match : techs;
  const need = match.length ? `งานนี้เป็นของ “${esc(match[0] ? posById(match[0].id) : kw)}”` : 'ยังไม่มีตำแหน่งที่ผูกกับงานประเภทนี้ — เลือกจากทุกคนในฝ่าย';
  const item = (t, withPos) => `<label class="pick-item"><input type="radio" name="tech" value="${t.id}">
    <span><b>${esc(t.name)}</b>${withPos ? `<small>${esc(posById(t.id)) || 'ยังไม่ระบุตำแหน่ง'}</small>` : ''}</span></label>`;
  return `<fieldset class="pick"><legend>เลือกผู้รับผิดชอบ</legend>
    <p class="muted small" style="margin:2px 4px 6px">${need}</p>
    ${list.map((t) => item(t, !match.length)).join('')}
    ${match.length && match.length < techs.length ? `<details class="pick-more"><summary>แสดงผู้อื่นในฝ่าย (${techs.length - match.length})</summary>${techs.filter((t) => !match.includes(t)).map((t) => item(t, true)).join('')}</details>` : ''}
  </fieldset>`;
}

// ===== รายละเอียดและการดำเนินการ =====
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// openDetail: เปิดหน้ารายละเอียดเรื่อง (ดึงจาก /api/requests/:id)
// acts = ปุ่มที่ผู้ใช้คนนี้กดได้ ขึ้นกับ สถานะ + สิทธิ์ + เป็นเจ้าของ/ช่างของเรื่องหรือไม่ (กฎเดียวกับฝั่ง server)
async function openDetail(id) {
  const r = await api(`/requests/${id}`);
  // ส่งฝ่ายของเรื่องไปด้วย: Admin ไม่มีฝ่ายของตัวเอง server จึงใช้ค่านี้ (หัวหน้าฝ่าย server ใช้ฝ่ายตัวเองเสมอ)
  const techs = can('request.assign') && r.status === 'pending' ? await api(`/requests/technicians?department_id=${r.department_id}`) : [];
  if (techs.length && !DIR.length) DIR = await api('/directory').catch(() => DIR);
  const mine = (field) => r[field] === me.id;

  const acts = [];
  if (r.status === 'pending' && can('request.assign')) acts.push(['assign', 'อนุมัติและมอบหมายผู้รับผิดชอบ', 'ok']);
  if (r.status === 'pending' && can('request.approve')) acts.push(['reject', 'ไม่อนุมัติ', 'danger']);
  if (r.status === 'assigned' && can('request.update_status') && mine('technician_id')) acts.push(['start', 'เริ่มดำเนินการ', 'info']);
  if (r.status === 'in_progress' && can('request.update_status') && mine('technician_id')) acts.push(['complete', 'ดำเนินการเสร็จ', 'ok']);
  if (r.status === 'done' && can('request.close') && mine('requester_id')) acts.push(['confirm', 'ยืนยันปิดเรื่อง', 'ok']);
  // กรอกผิด: ผู้แจ้งลบเรื่องแล้วแจ้งใหม่ ได้เฉพาะตอนรอพิจารณาและยังไม่มอบหมายงาน
  if (r.status === 'pending' && !r.technician_id && can('request.cancel.own') && mine('requester_id')) acts.push(['delete', 'ลบเรื่องนี้', 'danger']);

  // showNote = ช่องหมายเหตุตอนพิจารณา, showWorkNote = ช่องรายละเอียดงานที่ทำตอนช่างกดเสร็จ
  const showNote = r.status === 'pending' && acts.some(([x]) => x === 'assign' || x === 'reject');
  const showWorkNote = acts.some(([x]) => x === 'complete');
  // แนบไฟล์หลังส่งเรื่อง: เฉพาะช่างผู้รับผิดชอบระหว่างดำเนินการ (ลูกบ้านแนบได้แค่ตอนแจ้งเรื่อง) server ตรวจซ้ำ
  // แต่ละคนแนบได้คนละ 1 ไฟล์ต่อเรื่อง: ถ้าแนบไว้แล้วไม่แสดงช่องแนบ (ลบไฟล์เดิมก่อนแล้วช่องจะกลับมา)
  const canUpload = can('attachment.upload') && r.status === 'in_progress' && (mine('technician_id') || can('request.read.all'))
    && !(r.attachments || []).some((f) => f.uploaded_by === me.id);
  // ป้ายบอกว่าใครแนบไฟล์: ผู้แจ้ง / ช่าง เทียบ id ผู้แนบกับผู้แจ้งและช่างของเรื่อง
  const uploaderOf = (f) => `${esc(f.uploaded_by_name)} (${f.uploaded_by === r.requester_id ? 'ผู้แจ้ง' : f.uploaded_by === r.technician_id ? 'ช่าง' : 'เจ้าหน้าที่'})`;
  // งานช่างอาคาร: ต้องมีรูปที่ช่างแนบอย่างน้อย 1 ไฟล์ก่อนกดดำเนินการเสร็จ
  const hasWorkPhoto = (r.attachments || []).some((f) => f.uploaded_by === r.technician_id);
  $('#detail').innerHTML = `
    <h2>${esc(r.title)} <span class="refno">${refOf(r)}</span></h2>
    <span class="badge s-${r.status}">${STATUS[r.status]}</span>
    ${progress(r.status)}
    <dl class="info" style="margin-top:14px">
      <dt>ประเภท</dt><dd>${esc(r.category)} ${r.priority === 'urgent' ? '· ด่วน' : ''}</dd>
      <dt>สถานที่</dt><dd>${esc(r.location)}</dd>
      <dt>รายละเอียด</dt><dd>${esc(r.description) || '—'}</dd>
      <dt>วันที่แจ้ง</dt><dd>${fmtDate(r.created_at)}</dd>
      <dt>ผู้รับผิดชอบ</dt><dd>${r.technician_name ? withPos(r.technician_name) : '<span class="muted">ยังไม่ได้มอบหมาย</span>'}</dd>
    </dl>

    <h3>ไฟล์แนบ</h3>
    <ul class="files" id="fileList">${(r.attachments || []).map((f) => `
      <li>${can('attachment.read') ? `<a href="/api/attachments/${f.id}" target="_blank" rel="noopener"${f.mime_type.startsWith('image/') ? ` data-preview="${f.id}"` : ''}>${esc(f.original_name)}</a>` : esc(f.original_name)}
        <span class="muted small">${fmtSize(f.size_bytes)} · แนบโดย ${uploaderOf(f)}</span>
        ${can('attachment.read') ? `<a class="small" href="/api/attachments/${f.id}?download=1">ดาวน์โหลด</a>` : ''}
        ${f.can_delete ? `<button type="button" class="link-btn small" data-delfile="${f.id}">ลบ</button>` : ''}</li>`).join('') || '<li class="muted">ยังไม่มีไฟล์แนบ</li>'}</ul>
    ${canUpload ? `<label class="file-up">แนบรูปผลงาน (JPG, PNG หรือ PDF ไม่เกิน 5 MB)${r.needs_photo ? ' <b>จำเป็นก่อนกดดำเนินการเสร็จ</b>' : ''}
      <input type="file" id="fileIn" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"></label>
      <label class="ghost small cam-btn">📷 ถ่ายรูปผลงาน<input type="file" id="camIn" class="hidden" accept="image/*" capture="environment"></label>` : ''}

    <h3>ประวัติการดำเนินการ</h3>
    <ul class="timeline">${r.history.map((h) => `
      <li><b>${STATUS[h.to_status]}</b> · ${withPos(h.changed_by)} ·
        <span class="muted">${fmtDate(h.changed_at)}</span>
        ${h.note ? `<br>${esc(h.note)}` : ''}</li>`).join('')}</ul>

    ${acts.length ? `
      <div class="actions">
        ${techs.length ? pickerHtml(r, techs) : acts.some(([x]) => x === 'assign') ? '<p class="muted small">ฝ่ายนี้ยังไม่มีช่างที่ใช้งานได้ เพิ่มหรือเปิดใช้งานบัญชีช่างในหน้า Admin ก่อน</p>' : ''}
${showNote ? `<label class="note-field">หมายเหตุ <span class="muted small">ไม่บังคับเมื่ออนุมัติ · <b>จำเป็นเมื่อไม่อนุมัติ</b></span>
          <textarea id="actNote" rows="2" maxlength="500" placeholder="เช่น เหตุผลที่ไม่อนุมัติ หรือข้อความถึงผู้รับผิดชอบ"></textarea></label>` : ''}
${showWorkNote ? `<label class="note-field">รายละเอียดงานที่ทำ <span class="muted small"><b>จำเป็น</b> · ผู้แจ้งจะเห็นในประวัติการดำเนินการ</span>
          <textarea id="actNote" rows="3" maxlength="1000" placeholder="เช่น เปลี่ยนลูกบิดประตูใหม่ ทดสอบล็อกแล้วใช้งานได้ปกติ"></textarea></label>` : ''}
        ${acts.map(([a, label, kind]) =>
          `<button class="${kind}" data-act="${a}">${label}</button>`).join('')}
      </div>` : ''}
    <p id="detailMsg" class="error"></p>`;

  // เลือกไฟล์หรือถ่ายรูปแล้วอัปโหลดทันที (POST /api/requests/:id/attachments) แล้วเปิดหน้ารายละเอียดใหม่ให้เห็นไฟล์
  // รูปถูกย่อด้วย shrinkImage ก่อนส่ง
  const uploadOne = async (input) => {
    if (!input.files[0]) return;
    const f = await shrinkImage(input.files[0]);
    if (f.size > MAX_SIZE) { $('#detailMsg').textContent = 'ไฟล์ใหญ่เกิน 5 MB'; input.value = ''; return; }
    const fd = new FormData();
    fd.append('file', f);
    try {
      await api(`/requests/${id}/attachments`, { method: 'POST', body: fd });
      toast('อัปโหลดไฟล์แล้ว');
      await openDetail(id);
    } catch (err) {
      $('#detailMsg').textContent = err.message;
      input.value = '';
    }
  };
  for (const input of [$('#fileIn'), $('#camIn')]) if (input) input.onchange = () => uploadOne(input);

  // ตัวจัดการคลิกทั้งหน้ารายละเอียด: ดูรูปแบบป๊อปอัป, ปุ่มลบไฟล์, ลบเรื่อง, และปุ่มเปลี่ยนสถานะ (data-act)
  $('#detail').onclick = async (e) => {
    // ลิงก์รูปภาพ (data-preview) เปิดเป็นป๊อปอัปในหน้าเดิม ไม่เปิดแท็บใหม่ ส่วน PDF ยังเปิดแท็บใหม่ตามปกติ
    const pv = e.target.closest('[data-preview]');
    if (pv) {
      e.preventDefault();
      showImage(pv.getAttribute('href'), pv.textContent);
      return;
    }
    const del = e.target.closest('[data-delfile]');
    if (del) {
      if (!(await confirmBox({ title: 'ลบไฟล์แนบ', message: 'ไฟล์นี้จะถูกลบถาวร ต้องการดำเนินการต่อหรือไม่', ok: 'ลบไฟล์', danger: true }))) return;
      try {
        await api(`/attachments/${del.dataset.delfile}`, { method: 'DELETE' });
        await openDetail(id);
      } catch (err) { $('#detailMsg').textContent = err.message; }
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'delete') {
      const ok = await confirmBox({ title: 'ลบเรื่องนี้?', message: 'เรื่อง ไฟล์แนบ และประวัติทั้งหมดจะถูกลบถาวร กู้คืนไม่ได้ (กรอกผิดให้ลบแล้วแจ้งเรื่องใหม่)', ok: 'ลบเรื่อง', danger: true });
      if (!ok) return;
      try {
        await api(`/requests/${id}`, { method: 'DELETE' });
        $('#modal').classList.add('hidden');
        toast('ลบเรื่องแล้ว');
        loadRequests().catch(alertErr);
      } catch (err) { $('#detailMsg').textContent = err.message; }
      return;
    }
    const noteEl = $('#actNote');
    const body = { note: noteEl?.value.trim() || undefined };
    if (b.dataset.act === 'complete' && !body.note) {
      $('#detailMsg').textContent = 'กรุณากรอกรายละเอียดงานที่ทำก่อนกดดำเนินการเสร็จ';
      noteEl?.focus();
      return;
    }
    if (b.dataset.act === 'complete' && r.needs_photo && !hasWorkPhoto) {
      $('#detailMsg').textContent = 'งานช่างอาคารต้องแนบรูปผลงานอย่างน้อย 1 ไฟล์ก่อนกดดำเนินการเสร็จ';
      return;
    }
    if (b.dataset.act === 'reject' && !body.note) {
      $('#detailMsg').textContent = 'กรุณาระบุเหตุผลในช่องหมายเหตุก่อนกดไม่อนุมัติ';
      noteEl?.focus();
      return;
    }
    if (b.dataset.act === 'assign') {
      const t = document.querySelector('input[name=tech]:checked');
      if (!t) { $('#detailMsg').textContent = 'กรุณาเลือกผู้รับผิดชอบก่อน'; return; }
      body.technician_id = Number(t.value);
    }
    // ส่งไป POST /api/requests/:id/<การกระทำ> เช่น /assign พร้อมหมายเหตุ และ technician_id ถ้าเป็นการมอบหมาย
    try {
      await api(`/requests/${id}/${b.dataset.act}`, { method: 'POST', body });
      await openDetail(id);
      loadRequests().catch(alertErr);
      if (can('dashboard.view')) loadDashboard().catch(() => {});
    } catch (err) {
      $('#detailMsg').textContent = err.message;
    }
  };

  $('#modal').classList.remove('hidden');
}

$('#closeModal').onclick = () => $('#modal').classList.add('hidden');

// เริ่มต้นเมื่อเปิดหน้า: ถาม server ว่ายังล็อกอินอยู่ไหม (มี session) แล้ววาดหน้าตามผล
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

// ปุ่มรูปตา แสดง/ซ่อนรหัสผ่านในช่องกรอก
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.pw-toggle');
  if (!btn) return;
  const input = btn.parentElement.querySelector('input');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  setPwIcon(btn, !showing);
});
// ===== แดชบอร์ด =====
// แดชบอร์ด (สิทธิ์ dashboard.view): วาดกราฟแท่งด้วย HTML/CSS จากตัวเลขของ /api/requests/stats
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

// ===== ประกาศ =====
const ANN_ICON = { elevator: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M12 3v18M8.2 9.8L10 8l1.8 1.8M13.4 14.2L15 16l1.6-1.8"/></svg>', maintenance: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/></svg>', water: '<svg viewBox="0 0 24 24"><path d="M12 2.7l5.7 5.7a8 8 0 1 1-11.4 0z"/></svg>', electric: '<svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg>', aircon: '<svg viewBox="0 0 24 24"><path d="M12 2v20M4.9 4.9l14.2 14.2M2 12h20M19.1 4.9L4.9 19.1"/></svg>', general: '<svg viewBox="0 0 24 24"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7"/></svg>' };
const ANN_LABEL = { elevator: 'ลิฟต์', maintenance: 'บำรุงรักษา', water: 'ประปา', electric: 'ไฟฟ้า', aircon: 'เครื่องปรับอากาศ', general: 'ทั่วไป' };

const ANN_WEIGHT = { elevator: 0, water: 0, electric: 0, aircon: 1, maintenance: 1, general: 2 };
const ANN_GROUPS = [['live', 'กำลังเกิดขึ้นตอนนี้'], ['upcoming', 'กำลังจะมาถึง'], ['ended', 'สิ้นสุดแล้ว']];
const CLOCK = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const annDate = (d) => new Date(d).toLocaleDateString('th-TH-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' });
const annTime = (d) => `${String(new Date(d).getHours()).padStart(2, '0')}:${String(new Date(d).getMinutes()).padStart(2, '0')}`;
const dayDiff = (d) => {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(d); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 864e5);
};

// annInfo: จัดกลุ่มประกาศ กำลังเกิดขึ้น / กำลังจะมาถึง / สิ้นสุดแล้ว
function annInfo(a) {
  const now = Date.now(), s = new Date(a.starts_at), e = new Date(a.ends_at);
  const when = annDate(s) === annDate(e)
    ? `${annDate(s)} · ${annTime(s)}–${annTime(e)} น.`
    : `${annDate(s)} ${annTime(s)} น. – ${annDate(e)} ${annTime(e)} น.`;
  if (now > e) return { state: 'ended', chip: 'สิ้นสุดแล้ว', cls: 'ended', when };
  if (now >= s) return { state: 'live', chip: `กำลังเกิดขึ้น · ถึง ${annTime(e)} น.`, cls: 'live', when };
  const n = dayDiff(s);
  return { state: 'upcoming', when, cls: n <= 1 ? 'soon' : '',
    chip: n === 0 ? `วันนี้ ${annTime(s)} น.` : n === 1 ? 'พรุ่งนี้' : `อีก ${n} วัน` };
}

// โหลดและวาดรายการประกาศ ปุ่ม "ยกเลิกประกาศ" แสดงเฉพาะประกาศที่ mine = true (server บอกมา)
async function loadAnnouncements() {
  const list = (await api('/announcements')).map((a) => ({ ...a, ...annInfo(a) }));
  // เรียง: กำลังเกิดขึ้น > กำลังจะมาถึง (ใกล้สุดก่อน) > สิ้นสุดแล้ว; เวลาเท่ากันให้เรื่องที่กระทบมากก่อน (ลิฟต์/น้ำ/ไฟ)
  const rank = { live: 0, upcoming: 1, ended: 2 };
  list.sort((x, y) => rank[x.state] - rank[y.state]
    || new Date(x.starts_at) - new Date(y.starts_at)
    || (ANN_WEIGHT[x.type] ?? 2) - (ANN_WEIGHT[y.type] ?? 2));

  const card = (a) => `
    <article class="an t-${esc(a.type)} ${a.state === 'live' ? 'an-live' : ''} ${a.state === 'ended' ? 'an-ended' : ''}">
      <div class="an-ico" aria-hidden="true">${ANN_ICON[a.type] || ANN_ICON.general}</div>
      <div class="an-main">
        <div class="an-top"><span class="an-type">${esc(ANN_LABEL[a.type] || a.type)}</span>
          <span class="an-chip ${a.cls}">${esc(a.chip)}</span></div>
        <h3 class="an-title">${esc(a.title)}</h3>
        <div class="an-when">${CLOCK}<span>${esc(a.when)}</span></div>
        ${a.detail ? `<p class="an-detail">${esc(a.detail)}</p>` : ''}
        <div class="an-foot">
          <span class="muted small">ประกาศโดย ${withPos(a.author)}</span>
          ${can('announcement.manage') && (a.mine !== undefined ? a.mine : a.author === me.name)
            ? `<button class="ghost small cancel" data-ann-cancel="${a.id}">ยกเลิกประกาศ</button>` : ''}
        </div>
      </div>
    </article>`;

  $('#annCount').textContent = list.length ? `${list.length} รายการ` : '';
  $('#annList').innerHTML = list.length
    ? ANN_GROUPS.map(([k, title]) => {
        const items = list.filter((a) => a.state === k);
        return items.length
          ? `<h3 class="an-group ${k}">${title} <span>${items.length}</span></h3>${items.map(card).join('')}` : '';
      }).join('')
    : '<p class="an-empty">ขณะนี้ไม่มีประกาศจากนิติบุคคล</p>';
}

$('#annList').onclick = async (e) => {
  const b = e.target.closest('[data-ann-cancel]');
  if (!b || !(await confirmBox({ title: 'ยกเลิกประกาศ', message: 'ประกาศนี้จะไม่แสดงต่อผู้ใช้อีก ต้องการดำเนินการต่อหรือไม่', ok: 'ยกเลิกประกาศ', danger: true }))) return;
  try {
    await api(`/announcements/${b.dataset.annCancel}/cancel`, { method: 'POST' });
    await loadAnnouncements();
  } catch (err) {
    toast(err.message, 'error');
  }
};

// ===== เลือกวัน-เวลาของประกาศ (เลือกจากรายการ ไม่ต้องพิมพ์) =====
const pad2 = (n) => String(n).padStart(2, '0');
const TIME_OPTS = Array.from({ length: 96 }, (_, i) => `${pad2(Math.floor(i / 4))}:${pad2((i % 4) * 15)}`);
const dStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const tStr = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const annAt = (f, k) => {
  const d = f[`${k}_date`].value, t = f[`${k}_time`].value;
  return d && t ? new Date(`${d}T${t}:00`) : null;
};
const annSet = (f, k, date) => { f[`${k}_date`].value = dStr(date); f[`${k}_time`].value = tStr(date); };
let annDur = 60; // นาที ระหว่างเริ่มกับสิ้นสุด ใช้เลื่อนเวลาสิ้นสุดตามเวลาเริ่ม

// ตั้งค่าช่องวัน-เวลาของฟอร์มประกาศ (เลือกเวลาทีละ 15 นาที)
function initAnnTimes() {
  const f = $('#annForm');
  ['starts_time', 'ends_time'].forEach((n) => {
    f[n].innerHTML = TIME_OPTS.map((t) => `<option value="${t}">${t} น.</option>`).join('');
  });
  const s = new Date();
  s.setMinutes(Math.ceil((s.getMinutes() + 1) / 15) * 15, 0, 0);
  annDur = 60;
  annSet(f, 'starts', s);
  annSet(f, 'ends', new Date(s.getTime() + annDur * 60000));
}
initAnnTimes();

$('#annForm').addEventListener('change', (e) => {
  const f = e.currentTarget, n = e.target.name || '';
  const s = annAt(f, 'starts');
  if (n.startsWith('starts_') && s) annSet(f, 'ends', new Date(s.getTime() + annDur * 60000));
  if (n.startsWith('ends_')) {
    const en = annAt(f, 'ends');
    if (s && en && en > s) annDur = (en - s) / 60000;
  }
});

$('#annForm').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dur]');
  if (!b) return;
  const f = $('#annForm');
  let s = annAt(f, 'starts') || new Date();
  if (b.dataset.dur === 'day') {
    s = new Date(s); s.setHours(0, 0, 0, 0);
    annDur = 24 * 60 - 15; // 00:00 – 23:45
    annSet(f, 'starts', s);
  } else {
    annDur = Number(b.dataset.dur);
  }
  annSet(f, 'ends', new Date(s.getTime() + annDur * 60000));
});

// สร้างประกาศ (สิทธิ์ announcement.manage) ส่งเวลาเป็น ISO string ให้ server ตรวจซ้ำ
$('#annForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const msg = $('#annMsg');
  msg.textContent = '';
  const s = annAt(e.target, 'starts'), en = annAt(e.target, 'ends');
  if (!s || !en) { msg.textContent = 'กรุณาเลือกวันและเวลาให้ครบ'; return; }
  if (en <= s) { msg.textContent = 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม'; return; }
  try {
    await api('/announcements', { method: 'POST', body: {
      type: f.type,
      title: f.title.trim(),
      detail: f.detail.trim(),
      starts_at: s.toISOString(),
      ends_at: en.toISOString(),
    } });
    e.target.reset();
    initAnnTimes();
    toast('เผยแพร่ประกาศแล้ว');
    await loadAnnouncements();
  } catch (err) {
    msg.textContent = err.message;
  }
};
// ===== การแจ้งเตือน =====
// กระดิ่ง: แสดงจำนวนที่ยังไม่อ่าน และรายการแจ้งเตือน กดรายการไหนเปิดเรื่องนั้นเลย
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

// กด "อ่านทั้งหมด" → server บันทึกเวลาที่อ่าน → ตัวเลขบนกระดิ่งหายไป
$('#markRead').onclick = async () => {
  await api('/notifications/read', { method: 'POST' }).catch(() => {});
  loadNotifications().catch(() => {});
};

// ตรวจการแจ้งเตือนใหม่ทุก 60 วินาที (รายการเรื่องโหลดเฉพาะผู้มีสิทธิ์ดู)
setInterval(() => {
  if (me) { loadNotifications().catch(() => {}); loadAnnouncements().catch(() => {}); if (canReadRequests()) loadRequests().catch(() => {}); }
}, 60000);
