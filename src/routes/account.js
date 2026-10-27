// =====================================================================
// src/routes/account.js — บัญชีของฉัน และรายชื่อเจ้าหน้าที่ (ผูกที่ /api ทุก Route ต้องล็อกอิน)
//   PATCH /api/account/profile   แก้ชื่อของตัวเอง (ทุก Role)
//   POST  /api/account/password  เปลี่ยนรหัสผ่านของตัวเอง (ทุก Role)
//   GET   /api/directory         รายชื่อเจ้าหน้าที่พร้อมตำแหน่ง ใช้แสดง "ชื่อ (ตำแหน่ง)" ในหน้าเว็บ
// =====================================================================
const bcrypt = require('bcrypt');
const { Router } = require('express');
const db = require('../db');
const { audit } = require('../logger');
const { authenticate, invalidateUser } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');

const router = Router();

// ตรวจข้อมูลฝั่ง server แล้วบันทึก Log
// invalidateUser: ล้าง cache ข้อมูลผู้ใช้ เพื่อให้คำขอถัดไปเห็นชื่อใหม่ทันที
router.patch('/account/profile', authenticate, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 100) throw new HttpError(400, 'กรุณากรอกชื่อ (ไม่เกิน 100 ตัวอักษร)');
  await db.query('UPDATE users SET name = $1 WHERE id = $2', [name, req.user.id]);
  invalidateUser(req.user.id);
  await audit(req, { eventType: 'profile_update', resourceType: 'user', resourceId: req.user.id, result: 'success', detail: 'name' });
  res.json({ ok: true, name });
});

// 1) ตรวจความยาวรหัสใหม่  2) bcrypt.compare ตรวจรหัสเดิมกับ Hash ในฐานข้อมูล
// 3) bcrypt.hash(รหัสใหม่, 12) สร้าง Hash ใหม่ (Salt ถูกสร้างและฝังใน Hash ให้อัตโนมัติ, 12 = ความยากในการคำนวณ)
// ไม่มีการบันทึกรหัสผ่านลง Log บันทึกแค่ผลว่าสำเร็จหรือล้มเหลว
router.post('/account/password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof new_password !== 'string' || new_password.length < 8) {
    throw new HttpError(400, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
  }
  const { rows: [u] } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const ok = u && typeof current_password === 'string' && await bcrypt.compare(current_password, u.password_hash);
  if (!ok) {
    await audit(req, { eventType: 'password_change', resourceType: 'user', resourceId: req.user.id, result: 'failure', detail: 'wrong current password' });
    throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  if (current_password === new_password) throw new HttpError(400, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(new_password, 12), req.user.id]);
  await audit(req, { eventType: 'password_change', resourceType: 'user', resourceId: req.user.id, result: 'success' });
  res.json({ ok: true });
});

// ไม่รวมลูกบ้าน และไม่ส่ง password_hash หรือข้อมูลลับ
router.get('/directory', authenticate, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.position
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.is_active AND r.name <> 'resident'
     ORDER BY u.name`);
  res.json(rows);
});

module.exports = router;
