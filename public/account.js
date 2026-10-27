// "บัญชีของฉัน": ทุกบทบาทแก้ชื่อและเปลี่ยนรหัสผ่านของตัวเองได้ (ใช้ได้ทั้งหน้าหลักและหน้าจัดการระบบ)
async function accountApi(path, method, body) {
  const res = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'เกิดข้อผิดพลาด');
  return data;
}

async function openAccount(onChanged) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROLE = { admin: 'ผู้ดูแลระบบ', dept_head: 'หัวหน้าแผนก', technician: 'เจ้าหน้าที่ช่าง', resident: 'ลูกบ้าน' };
  let u;
  try { u = await accountApi('/auth/me', 'GET'); } catch (e) { return; }
  const acct = await accountApi('/account', 'GET').catch(() => ({ email: '' }));

  const d = document.createElement('dialog');
  d.className = 'dlg';
  d.setAttribute('aria-label', 'บัญชีของฉัน');
  d.innerHTML = `<div class="dlg-form">
    <h2>บัญชีของฉัน</h2>
    <dl class="acc-info">
      <dt>ชื่อผู้ใช้</dt><dd>${esc(u.username)}</dd>
      <dt>บทบาท</dt><dd>${esc(ROLE[u.role] || u.role)}</dd>
      ${u.position ? `<dt>ตำแหน่ง</dt><dd>${esc(u.position)}</dd>` : ''}
    </dl>
    <form id="accName" novalidate>
      <fieldset><legend>ชื่อ-นามสกุล</legend>
        <label>ชื่อที่แสดงในระบบ
          <input name="name" value="${esc(u.name)}" maxlength="100" required autocomplete="off">
          <span class="muted small">ชื่อผู้ใช้และตำแหน่งแก้เองไม่ได้ ติดต่อผู้ดูแลระบบ</span></label>
        <p class="error dlg-err" data-for="name" role="alert"></p>
        <div class="dlg-actions" style="margin-top:6px;padding-top:10px"><button type="submit">บันทึกชื่อ</button></div>
      </fieldset>
    </form>
    <form id="accEmail" novalidate>
      <fieldset><legend>อีเมล (ใช้กู้รหัสผ่านเมื่อลืม)</legend>
        <label>อีเมล<input name="email" type="email" value="${esc(acct.email)}" maxlength="254" autocomplete="email" required></label>
        <label>รหัสผ่านปัจจุบัน (เพื่อยืนยัน)<input name="current_password" type="password" autocomplete="current-password" required></label>
        <p class="error dlg-err" data-for="email" role="alert"></p>
        <div class="dlg-actions" style="margin-top:6px;padding-top:10px"><button type="submit">บันทึกอีเมล</button></div>
      </fieldset>
    </form>
    <form id="accPw" novalidate>
      <fieldset><legend>เปลี่ยนรหัสผ่าน</legend>
        <label>รหัสผ่านปัจจุบัน<input name="current_password" type="password" autocomplete="current-password" required></label>
        <label>รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)<input name="new_password" type="password" minlength="8" autocomplete="new-password" required></label>
        <label>ยืนยันรหัสผ่านใหม่<input name="confirm" type="password" minlength="8" autocomplete="new-password" required></label>
        <p class="error dlg-err" data-for="pw" role="alert"></p>
        <div class="dlg-actions" style="margin-top:6px;padding-top:10px"><button type="submit" class="warn">เปลี่ยนรหัสผ่าน</button></div>
      </fieldset>
    </form>
    <div class="dlg-actions" style="margin-top:0"><button type="button" class="ghost" data-close>ปิด</button></div>
  </div>`;
  document.body.appendChild(d);

  const msg = (k, text, ok) => {
    const el = d.querySelector(`[data-for="${k}"]`);
    el.textContent = text; el.className = (ok ? 'ok-msg' : 'error') + ' dlg-err';
  };

  d.querySelector('#accName').onsubmit = async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return msg('name', 'กรุณากรอกชื่อ');
    try {
      await accountApi('/account/profile', 'PATCH', { name });
      msg('name', 'บันทึกชื่อแล้ว', true);
      if (onChanged) onChanged(name);
    } catch (err) { msg('name', err.message); }
  };

  d.querySelector('#accEmail').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.email.value.trim()) return msg('email', 'กรุณากรอกอีเมล');
    if (!f.current_password.value) return msg('email', 'กรุณากรอกรหัสผ่านปัจจุบันเพื่อยืนยัน');
    try {
      await accountApi('/account/email', 'PATCH', { email: f.email.value.trim(), current_password: f.current_password.value });
      f.current_password.value = '';
      msg('email', 'บันทึกอีเมลแล้ว', true);
    } catch (err) { msg('email', err.message); }
  };

  d.querySelector('#accPw').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.current_password.value) return msg('pw', 'กรุณากรอกรหัสผ่านปัจจุบัน');
    if (f.new_password.value.length < 8) return msg('pw', 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
    if (f.new_password.value !== f.confirm.value) return msg('pw', 'รหัสผ่านใหม่และการยืนยันไม่ตรงกัน');
    try {
      await accountApi('/account/password', 'POST', {
        current_password: f.current_password.value, new_password: f.new_password.value,
      });
      f.reset();
      msg('pw', 'เปลี่ยนรหัสผ่านแล้ว', true);
    } catch (err) { msg('pw', err.message); }
  };

  d.querySelector('[data-close]').onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  d.showModal();
}