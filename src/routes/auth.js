const bcrypt = require('bcrypt');
const { Router } = require('express');
const db = require('../db');
const { audit } = require('../logger');
const { authenticate } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');

const router = Router();

// เปลี่ยน Session ID หลังเข้าสู่ระบบ ป้องกัน Session Fixation
const regenerate = (req) => new Promise((resolve, reject) =>
  req.session.regenerate((err) => (err ? reject(err) : resolve())));
const destroy = (req) => new Promise((resolve, reject) =>
  req.session.destroy((err) => (err ? reject(err) : resolve())));

router.post('/login', async (req, res) => {
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!username || !password) throw new HttpError(400, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

  const { rows: [user] } = await db.query(
    'SELECT id, password_hash, is_active FROM users WHERE username = $1', [username]);
  const valid = !!user && user.is_active && await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    await audit(req, { eventType: 'login', usernameAttempted: username.slice(0, 50), result: 'failure' });
    throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  await regenerate(req);
  req.session.userId = user.id;
  await audit(req, { userId: user.id, usernameAttempted: username.slice(0, 50), eventType: 'login', result: 'success' });
  res.json({ ok: true });
});

router.post('/logout', async (req, res) => {
  const userId = req.session.userId;
  if (userId) await audit(req, { userId, eventType: 'logout', result: 'success' });
  await destroy(req); // ลบ Session ในฐานข้อมูล ใช้สถานะเดิมเข้าถึงไม่ได้อีก
  res.clearCookie('sid');
  res.json({ ok: true });
});

router.get('/me', authenticate, (req, res) => {
  const { id, username, name, role, department_id } = req.user;
  res.json({ id, username, name, role, department_id, permissions: [...req.permissions] });
});

// สมัครบัญชีลูกบ้าน ต้องใช้เลขที่สัญญาที่ยังไม่เคยถูกใช้สมัคร
router.post('/register', async (req, res) => {
  const username = String(req.body.username ?? '').trim();
  const name = String(req.body.name ?? '').trim();
  const contractNo = String(req.body.contract_no ?? '').trim().toUpperCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!/^[A-Za-z0-9_.]{3,50}$/.test(username)) {
    throw new HttpError(400, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z A-Z 0-9 _ . ความยาว 3-50 ตัวอักษร');
  }
  if (!name || name.length > 100) throw new HttpError(400, 'กรุณากรอกชื่อ-สกุล');
  if (password.length < 8) throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  if (!contractNo) throw new HttpError(400, 'กรุณากรอกเลขที่สัญญา');

  try {
    await db.withTransaction(async (client) => {
      const { rows: [c] } = await client.query(
        'SELECT id, unit_id, is_active, registered_user_id FROM contracts WHERE contract_no = $1 FOR UPDATE',
        [contractNo]
      );
      if (!c || !c.is_active || c.registered_user_id) {
        throw new HttpError(400, 'ไม่สามารถใช้เลขที่สัญญานี้สมัครได้ กรุณาตรวจสอบเลขที่สัญญา');
      }
      const { rows: [taken] } = await client.query('SELECT 1 FROM users WHERE username = $1', [username]);
      if (taken) throw new HttpError(409, 'ชื่อผู้ใช้นี้ถูกใช้แล้ว');

      const hash = await bcrypt.hash(password, 12);
      const { rows: [u] } = await client.query(
        `INSERT INTO users (username, password_hash, name, role_id, unit_id)
         VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name = 'resident'), $4)
         RETURNING id`,
        [username, hash, name, c.unit_id]
      );
      await client.query('UPDATE contracts SET registered_user_id = $1 WHERE id = $2', [u.id, c.id]);
    });
  } catch (err) {
    if (err instanceof HttpError) {
      await audit(req, { eventType: 'register', usernameAttempted: username.slice(0, 50), result: 'failure', detail: err.message });
    }
    throw err;
  }

  await audit(req, { eventType: 'register', usernameAttempted: username, result: 'success' });
  res.status(201).json({ ok: true });
});

module.exports = router;