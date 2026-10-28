// src/routes/admin-extra.js — ตั้งรหัสผ่านใหม่ให้ผู้ใช้ (เฉพาะผู้มีสิทธิ์ user.manage)
const bcrypt = require('bcrypt');
const { Router } = require('express');
const db = require('../db');
const { audit } = require('../logger');
const { requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');

const router = Router();

router.post('/users/:id/password', requirePermission('user.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!Number.isInteger(id)) throw new HttpError(400, 'รหัสผู้ใช้ไม่ถูกต้อง');
  if (password.length < 8) throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');

  const hash = await bcrypt.hash(password, 12);
  const { rowCount } = await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
  if (!rowCount) throw new HttpError(404, 'ไม่พบผู้ใช้');

  try {
    await audit(req, { userId: req.user.id, eventType: 'password_reset', resourceType: 'user', result: 'success', detail: `user ${id}` });
  } catch (e) { console.error('audit failed:', e.message); }
  res.json({ ok: true });
});

// รายชื่อผู้ใช้ (รวมตำแหน่ง) สำหรับหน้าจัดการระบบ
router.get('/users', requirePermission('user.manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, username, name, position, role_id, department_id, is_active
     FROM users ORDER BY id`);
  res.json(rows);
});

// แก้ชื่อ-นามสกุล และตำแหน่ง (แยกคนละช่อง)
router.patch('/users/:id/profile', requirePermission('user.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name ?? '').trim();
  const position = String(req.body.position ?? '').trim();
  if (!Number.isInteger(id)) throw new HttpError(400, 'รหัสผู้ใช้ไม่ถูกต้อง');
  if (!name || name.length > 100) throw new HttpError(400, 'ชื่อต้องไม่ว่างและยาวไม่เกิน 100 ตัวอักษร');
  if (position.length > 100) throw new HttpError(400, 'ตำแหน่งยาวเกิน 100 ตัวอักษร');
  const { rowCount } = await db.query(
    'UPDATE users SET name = $1, position = $2 WHERE id = $3', [name, position || null, id]);
  if (!rowCount) throw new HttpError(404, 'ไม่พบผู้ใช้');
  res.json({ ok: true });
});

module.exports = router;