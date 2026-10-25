const bcrypt = require('bcrypt');
const { Router } = require('express');
const db = require('../db');
const { audit } = require('../logger');
const { authenticate } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');

const router = Router();

// ฟังก์ชันช่วยจัดการ Session (Promise wrapper)
const regenerate = (req) => new Promise((resolve, reject) =>
  req.session.regenerate((err) => (err ? reject(err) : resolve())));
const destroy = (req) => new Promise((resolve, reject) =>
  req.session.destroy((err) => (err ? reject(err) : resolve())));

// ==========================================
// 1. PUBLIC ROUTES (ไม่ต้องใช้ authenticate)
// ==========================================

// สมัครบัญชีลูกบ้าน (เช็กเลขที่สัญญาในฐานข้อมูล)
router.post('/register', async (req, res, next) => {
  try {
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

    await audit(req, { eventType: 'register', usernameAttempted: username, result: 'success' });

    // บังคับ Save session ให้เสร็จสมบูรณ์ก่อนส่ง response
    req.session.save((err) => {
      if (err) return next(err);
      res.status(201).json({ ok: true });
    });
  } catch (err) {
    if (err instanceof HttpError) {
      await audit(req, { eventType: 'register', usernameAttempted: String(req.body.username ?? '').slice(0, 50), result: 'failure', detail: err.message });
    }
    next(err);
  }
});

// เข้าสู่ระบบ
router.post('/login', async (req, res, next) => {
  try {
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

    req.session.save((err) => {
      if (err) return next(err);
      res.json({ ok: true });
    });
  } catch (err) {
    next(err);
  }
});

// ออกจากระบบ
router.post('/logout', async (req, res, next) => {
  try {
    const userId = req.session.userId;
    if (userId) await audit(req, { userId, eventType: 'logout', result: 'success' });
    await destroy(req);
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 2. PROTECTED ROUTES (ต้องผ่าน authenticate)
// ==========================================

router.get('/me', authenticate, (req, res) => {
  const { id, username, name, role, department_id } = req.user;
  res.json({ id, username, name, role, department_id, permissions: [...req.permissions] });
});

module.exports = router;