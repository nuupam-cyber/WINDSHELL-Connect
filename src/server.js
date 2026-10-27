// =====================================================================
// src/server.js — จุดเริ่มต้นของระบบ (รันด้วย npm start)
// หน้าที่: สร้างแอป Express, ต่อ Middleware ตามลำดับ, ผูก Route ทั้งหมด แล้วเปิด Port
//
// ลำดับที่ทุกคำขอ (request) วิ่งผ่าน:
//   1) express.json / urlencoded  → แปลง body เป็น object
//   2) session                     → อ่าน cookie "sid" แล้วโหลด session จาก PostgreSQL
//   3) express.static              → ไฟล์หน้าเว็บใน public/ (ไม่ต้องล็อกอิน)
//   4) authenticate                → ตรวจว่าล็อกอินแล้ว + โหลด Role/Permission จากฐานข้อมูล (middleware/auth.js)
//   5) requirePermission('...')    → ตรวจ ACL ของแต่ละ Route ถ้าไม่มีสิทธิ์ตอบ 403 และบันทึก Log
//   6) Route handler               → ตรวจข้อมูล ทำงานกับฐานข้อมูล บันทึก Log แล้วตอบ JSON
//   7) Error handler               → แปลง error ทุกชนิดเป็น JSON พร้อม status code ที่เหมาะสม
// =====================================================================
// ต้องอยู่บรรทัดแรกสุด: ทำให้ error ใน async handler ถูกส่งเข้า error handler
// แทนที่จะทำให้ process ตาย (Express 4)
require('express-async-errors');

const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');
const { HttpError } = require('./middleware/errorHandler');
const { audit } = require('./logger');
const { authenticate, invalidateUser, requirePermission } = require('./middleware/auth');

// bcrypt: ใช้ Hash รหัสผ่านพร้อม Salt (ใช้ในส่วนเปลี่ยนรหัสผ่านของตัวเองด้านล่าง)
const bcrypt = require('bcrypt');
const app = express();

// 1. Trust Proxy สำหรับ Render HTTPS
app.set('trust proxy', 1);

// 2. Middleware อ่าน Body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SESSION_SECRET ใช้เซ็น cookie ของ session กันการปลอม cookie ค่าจริงอยู่ใน Environment ของ Render ไม่อยู่ในโค้ด
// ต้องตั้ง SESSION_SECRET ใน production (ไม่ฝังค่าลับไว้ในโค้ด)
const SESSION_SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-only-secret');
if (!SESSION_SECRET) {
  console.error('ไม่ได้ตั้งค่า SESSION_SECRET: กรุณาตั้งค่าใน Environment ก่อนเริ่มระบบ');
  process.exit(1);
}

// 3. Session: เก็บใน Postgres เพื่อไม่ให้ผู้ใช้ถูกเด้งออกทุกครั้งที่ server restart/deploy
// (ต้อง npm install connect-pg-simple; ถ้ายังไม่ติดตั้งจะใช้ MemoryStore ไปก่อน)
let store;
try {
  const PgStore = require('connect-pg-simple')(session);
  store = new PgStore({ pool: db.pool, createTableIfMissing: true, disableTouch: true }); // ไม่เขียน DB ทุกคำขอ
} catch (e) {
  console.warn('ใช้ MemoryStore เพราะ:', e.message);
}
// ตั้งค่า Session (เลือกใช้ Session ไม่ใช่ Token):
// - Server เก็บข้อมูลว่าใครล็อกอินไว้ในตาราง session ฝั่งเบราว์เซอร์ถือแค่ cookie "sid" ที่สุ่มขึ้นมา
// - httpOnly: JavaScript ในหน้าเว็บอ่าน cookie ไม่ได้ ลดความเสี่ยง XSS ขโมย session
// - secure: ส่ง cookie เฉพาะผ่าน HTTPS (ตอนรันบน Render)
// - sameSite 'lax': ลดความเสี่ยง CSRF จากเว็บอื่น
// - ออกจากระบบแล้ว session ถูกทำลายฝั่ง server ใช้ cookie เดิมเข้าไม่ได้อีก
app.use(session({
  store,
  name: 'sid', // ให้ตรงกับ res.clearCookie('sid') ใน routes/auth.js
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 1 วัน
  }
}));

// 4. ไฟล์ Static
app.use(express.static(path.join(__dirname, '../public')));

// แยกส่วน Admin ทาง Logical: หน้า /admin ไม่อยู่ใน public/ จึงเปิดตรงๆ ไม่ได้
// ต้องผ่าน 3 ด่าน: มี session → authenticate → requirePermission('user.manage') ถ้าไม่ผ่านจะถูกปฏิเสธแม้พิมพ์ URL เอง
// หน้าจัดการระบบ: ไฟล์อยู่ใน private/ (ไม่เปิดให้ทุกคน) ต้องล็อกอินและมีสิทธิ์ user.manage
app.get('/admin',
  (req, res, next) => (req.session.userId ? next() : res.redirect('/')),
  authenticate,
  requirePermission('user.manage'),
  (req, res) => res.sendFile(path.join(__dirname, '../private/admin.html'))
);

// loadRoute: ผูกไฟล์ Route เข้ากับ path พร้อม middleware ที่ต้องผ่านก่อน (เช่น authenticate)
// ถ้าไฟล์ Route มีปัญหาตอนโหลด จะข้ามไปและพิมพ์ข้อความ แทนที่ทั้ง server จะล่ม
// 5. Safe-Load Routes (รับ middleware เพิ่มได้)
const loadRoute = (routePath, apiEndpoint, ...middlewares) => {
  try {
    const route = require(routePath);
    app.use(apiEndpoint, ...middlewares, route);
    console.log(`Loaded route: ${apiEndpoint}`);
  } catch (err) {
    console.log(`Skipped route ${apiEndpoint}: ${err.message}`);
  }
};

// auth.js ใส่ authenticate ให้ /me เองอยู่แล้ว (login/register ไม่ต้องล็อกอิน)

// ไม่ต้องล็อกอิน
loadRoute('./routes/auth', '/api/auth');

// ต้องล็อกอินก่อน

// บัญชีของฉัน: ทุกบทบาทแก้ชื่อและเปลี่ยนรหัสผ่านของตัวเองได้
// PATCH /api/account/profile — แก้ชื่อของตัวเอง (ทุก Role) ตรวจข้อมูลฝั่ง server แล้วบันทึก Log
// invalidateUser: ล้าง cache ข้อมูลผู้ใช้ เพื่อให้คำขอถัดไปเห็นชื่อใหม่ทันที
app.patch('/api/account/profile', authenticate, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 100) throw new HttpError(400, 'กรุณากรอกชื่อ (ไม่เกิน 100 ตัวอักษร)');
  await db.query('UPDATE users SET name = $1 WHERE id = $2', [name, req.user.id]);
  invalidateUser(req.user.id);
  await audit(req, { eventType: 'profile_update', resourceType: 'user', resourceId: req.user.id, result: 'success', detail: 'name' });
  res.json({ ok: true, name });
});

// POST /api/account/password — เปลี่ยนรหัสผ่านของตัวเอง
// 1) ตรวจความยาวรหัสใหม่  2) bcrypt.compare ตรวจรหัสเดิมกับ Hash ในฐานข้อมูล
// 3) bcrypt.hash(รหัสใหม่, 12) สร้าง Hash ใหม่ (Salt ถูกสร้างและฝังใน Hash ให้อัตโนมัติ, 12 = ความยากในการคำนวณ)
// ไม่มีการบันทึกรหัสผ่านลง Log บันทึกแค่ผลว่าสำเร็จหรือล้มเหลว
app.post('/api/account/password', authenticate, async (req, res) => {
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

// GET /api/directory — ใช้แสดง "ชื่อ (ตำแหน่ง)" ของเจ้าหน้าที่ในหน้าเว็บ ไม่ส่ง password_hash หรือข้อมูลลับ
// รายชื่อเจ้าหน้าที่พร้อมตำแหน่ง ใช้แสดงผลในหน้าต่างๆ (ไม่รวมลูกบ้าน)
app.get('/api/directory', authenticate, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.position
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.is_active AND r.name <> 'resident'
     ORDER BY u.name`);
  res.json(rows);
});

// ประกาศ: ยกเลิกได้เฉพาะผู้ที่สร้างประกาศนั้นเท่านั้น
// หาคอลัมน์ผู้สร้างจากตาราง announcements อัตโนมัติ (ชื่อคอลัมน์มาจากรายการคงที่ด้านล่างเท่านั้น)
const OWNER_COLS = ['created_by', 'author_id', 'user_id', 'created_by_user_id', 'posted_by', 'owner_id'];
async function annOwnerColumn() {
  const { rows } = await db.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'announcements'");
  const names = rows.map((r) => r.column_name);
  const col = OWNER_COLS.find((c) => names.includes(c)) || null;
  if (!col) console.error('ไม่พบคอลัมน์ผู้สร้างประกาศ คอลัมน์ที่มี:', names.join(', '));
  return col;
}
// เพิ่มฟิลด์ mine ในรายการประกาศ เพื่อให้หน้าเว็บรู้ว่าอันไหนเป็นของผู้ใช้
// เทคนิค: ห่อ res.json ไว้ก่อน แล้ว next() ไปให้ routes/announcements.js ตอบ
// ตอนตอบจะเติม mine=true/false ให้แต่ละประกาศ (ใช้ตัดสินว่าแสดงปุ่ม "ยกเลิกประกาศ" ไหม)
app.get('/api/announcements', authenticate, async (req, res, next) => {
  const col = await annOwnerColumn();
  const send = res.json.bind(res);
  if (col) {
    res.json = (body) => {
      if (!Array.isArray(body) || !body.length) return send(body);
      db.query(`SELECT id, ${col} AS owner FROM announcements WHERE id = ANY($1)`, [body.map((x) => x.id)])
        .then(({ rows }) => {
          const owners = new Map(rows.map((r) => [String(r.id), String(r.owner)]));
          send(body.map((x) => ({ ...x, mine: owners.get(String(x.id)) === String(req.user.id) })));
        })
        .catch(() => send(body));
      return res;
    };
  }
  next();
});
// ตรวจเจ้าของข้อมูลก่อนยกเลิกประกาศ: ถ้าไม่ใช่ผู้สร้างตอบ 403 ทันที ถ้าใช่ next() ไปยัง route ยกเลิกจริง
app.post('/api/announcements/:id/cancel', authenticate, async (req, res, next) => {
  const col = await annOwnerColumn();
  if (!col) throw new HttpError(500, 'ไม่สามารถตรวจสอบผู้สร้างประกาศได้');
  const { rows: [a] } = await db.query(`SELECT ${col} AS owner FROM announcements WHERE id = $1`, [req.params.id]);
  if (!a) throw new HttpError(404, 'ไม่พบประกาศ');
  if (String(a.owner) !== String(req.user.id)) {
    throw new HttpError(403, 'ยกเลิกได้เฉพาะผู้ที่สร้างประกาศนี้เท่านั้น');
  }
  next();
});

// ===== เลขที่คำร้อง =====
// สร้างจากเลข id ภายในด้วย HMAC + ความลับของระบบ จึงเดาลำดับ/จำนวนคำร้องไม่ได้ และไม่ต้องแก้ฐานข้อมูล
const crypto = require('crypto');
const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ตัดตัวที่สับสน I L O 0 1
function refCode(id) {
  const h = crypto.createHmac('sha256', process.env.REF_SECRET || SESSION_SECRET)
    .update(`request:${id}`).digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += REF_CHARS[h[i] % REF_CHARS.length];
  return `WS-${out.slice(0, 4)}-${out.slice(4)}`;
}
// addRefs: เติมฟิลด์ ref (เลขที่คำร้อง) ให้ทุกคำร้องใน JSON ที่ตอบกลับ และแทน #id ในหัวข้อแจ้งเตือนด้วยเลขที่คำร้อง
function addRefs(body) {
  const one = (r) => {
    if (r && typeof r === 'object' && r.id != null && r.created_at && r.category !== undefined) r.ref = refCode(r.id);
    return r;
  };
  if (Array.isArray(body)) body.forEach(one);
  else if (body && typeof body === 'object') {
    one(body);
    if (Array.isArray(body.items)) {
      body.items.forEach((n) => {
        if (n && n.requestId != null) {
          n.ref = refCode(n.requestId);
          if (typeof n.title === 'string') n.title = n.title.replace(`#${n.requestId} `, `${n.ref} `);
        }
      });
    }
  }
  return body;
}
// withRefs: middleware ที่ห่อ res.json ให้ผ่าน addRefs ก่อนส่งออกไป
function withRefs(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(addRefs(body));
  next();
}
// ประเภทงานของฝ่ายช่างอาคารต้องแนบรูป: ส่งธงให้หน้าฟอร์มตามฝ่ายในฐานข้อมูล
app.get('/api/requests/options', authenticate, async (req, res, next) => {
  const { rows } = await db.query(
    `SELECT c.id FROM issue_categories c JOIN departments d ON d.id = c.department_id
     WHERE d.name = 'ช่างอาคาร'`);
  const ids = new Set(rows.map((r) => r.id));
  const json = res.json.bind(res);
  res.json = (b) => json(b && Array.isArray(b.categories)
    ? { ...b, categories: b.categories.map((c) => ({ ...c, needs_photo: ids.has(c.id) })) }
    : b);
  next();
});

// ใช้ withRefs กับ API คำร้องและแจ้งเตือน (ต้องประกาศก่อน loadRoute ของ path เดียวกัน)
app.use('/api/requests', withRefs);
app.use('/api/notifications', withRefs);

// ผูก Route หลักทั้งหมด ทุกตัวต้องผ่าน authenticate ก่อน (ยังไม่ล็อกอิน → 401)
// /api/admin/... คือกลุ่ม API ของ Admin แยกจาก API ผู้ใช้ทั่วไป และตรวจสิทธิ์ทุก Route ด้านใน
loadRoute('./routes/requests', '/api/requests', authenticate);
loadRoute('./routes/admin-extra', '/api/admin', authenticate); // ตั้งรหัสผ่านใหม่
loadRoute('./routes/admin', '/api/admin', authenticate);
loadRoute('./routes/announcements', '/api/announcements', authenticate);
loadRoute('./routes/notifications', '/api/notifications', authenticate);
loadRoute('./routes/attachments', '/api/attachments', authenticate);

// API ที่ไม่มีอยู่ ให้ตอบ 404 เป็น JSON (ไม่ส่ง index.html)
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, message: 'ไม่พบ API นี้' });
});

// ทุก path อื่นที่ไม่ใช่ API ส่งหน้า index.html (หน้าเว็บตัดสินเองว่าจะแสดงหน้าล็อกอินหรือหน้าหลัก)
// Fallback Route ส่งกลับไปหน้า index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Express รู้ว่าเป็น error handler เพราะรับ 4 พารามิเตอร์ (err, req, res, next)
// error 500 จะไม่ส่งรายละเอียดภายในให้ผู้ใช้เห็น ป้องกันข้อมูลระบบรั่วไหล
// Global Error Handler (ต้องอยู่หลังทุก route)
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  const candidates = [err.status, err.statusCode, err.httpStatus];
  const status = candidates.find((n) => Number.isInteger(n) && n >= 400 && n < 600) || 500;
  res.status(status).json({
    ok: false,
    error: status === 500 ? 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' : err.message, // หน้าเว็บอ่านจาก error
    message: status === 500 ? 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' : err.message
  });
});

// กันไม่ให้ process ตายจาก error ที่หลุดมา (log ไว้ดูแทน)
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// 6. Port สำหรับ Render
const PORT = process.env.PORT || 3000;
// เตรียมฐานข้อมูลเล็กน้อยตอนเริ่ม (ทุกคำสั่งรันซ้ำได้ไม่เสียหาย) แล้วเปิด Port
(async () => {
  // เพิ่มคอลัมน์ตำแหน่งให้ตาราง users (ทำซ้ำได้ ไม่เสียหาย)
  try {
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS position varchar(100)');
  } catch (e) {
    console.error('เพิ่มคอลัมน์ position ไม่สำเร็จ:', e.message);
  }
  // เก็บเนื้อไฟล์แนบในฐานข้อมูล เพราะดิสก์ของ Render ถูกล้างทุกครั้งที่ deploy
  try {
    await db.query('ALTER TABLE attachments ADD COLUMN IF NOT EXISTS data bytea');
  } catch (e) {
    console.error('เพิ่มคอลัมน์ data ไม่สำเร็จ:', e.message);
  }
  // เลิกใช้ฟังก์ชันความคิดเห็นแล้ว ลบสิทธิ์ที่ไม่ได้ผูกกับ API ใดออก (role_permissions ลบตามด้วย CASCADE)
  try {
    await db.query("DELETE FROM permissions WHERE name = 'comment.create'");
  } catch (e) {
    console.error('ลบสิทธิ์ comment.create ไม่สำเร็จ:', e.message);
  }
  // ping ฐานข้อมูลทุก 4 นาที กันการเชื่อมต่อกับ Neon หลับ ทำให้คำขอแรกไม่ช้า
  setInterval(() => db.query('SELECT 1').catch(() => {}), 4 * 60 * 1000).unref();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
})();