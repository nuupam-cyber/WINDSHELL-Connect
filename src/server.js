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
//   7) errorHandler                → แปลง error ทุกชนิดเป็น JSON พร้อม status code ที่เหมาะสม
// =====================================================================

// อ่านค่าจากไฟล์ .env ตอนรันบนเครื่อง (บน Render ใช้ Environment ของระบบ)
require('dotenv').config();
// ต้องโหลดก่อน Express: ทำให้ error ใน async handler ถูกส่งเข้า errorHandler แทนที่จะทำให้ process ตาย
require('express-async-errors');

const path = require('path');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const db = require('./db');
const { authenticate, requirePermission } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');
const { withRefs } = require('./services/refs');

const app = express();

// Render ให้บริการผ่าน HTTPS proxy: ต้องเชื่อ proxy เพื่อให้ cookie แบบ secure และ req.ip ถูกต้อง
app.set('trust proxy', 1);

// 1) อ่าน body ของคำขอ
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// SESSION_SECRET ใช้เซ็น cookie ของ session กันการปลอม cookie ค่าจริงอยู่ใน Environment ของ Render ไม่อยู่ในโค้ด
const SESSION_SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-only-secret');
if (!SESSION_SECRET) {
  console.error('ไม่ได้ตั้งค่า SESSION_SECRET: กรุณาตั้งค่าใน Environment ก่อนเริ่มระบบ');
  process.exit(1);
}

// 2) Session (เลือกใช้ Session ไม่ใช่ Token):
// - Server เก็บข้อมูลว่าใครล็อกอินไว้ในตาราง session ของ PostgreSQL ฝั่งเบราว์เซอร์ถือแค่ cookie "sid" ที่สุ่มขึ้นมา
//   (server รีสตาร์ตหรือ deploy ใหม่ ผู้ใช้ไม่หลุดจากระบบ)
// - httpOnly: JavaScript ในหน้าเว็บอ่าน cookie ไม่ได้ ลดความเสี่ยง XSS ขโมย session
// - secure: ส่ง cookie เฉพาะผ่าน HTTPS (ตอนรันบน Render)
// - sameSite 'lax': ลดความเสี่ยง CSRF จากเว็บอื่น
// - ออกจากระบบแล้ว session ถูกทำลายฝั่ง server ใช้ cookie เดิมเข้าไม่ได้อีก
app.use(session({
  store: new PgStore({ pool: db.pool, createTableIfMissing: true, disableTouch: true }), // disableTouch: ไม่เขียน DB ทุกคำขอ
  name: 'sid', // ให้ตรงกับ res.clearCookie('sid') ใน routes/auth.js
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 1 วัน
  },
}));

// 3) ไฟล์หน้าเว็บ (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, '../public')));

// แยกส่วน Admin ทาง Logical: หน้า /admin ไม่อยู่ใน public/ จึงเปิดตรงๆ ไม่ได้
// ต้องผ่าน 3 ด่าน: มี session → authenticate → requirePermission('user.manage') ถ้าไม่ผ่านจะถูกปฏิเสธแม้พิมพ์ URL เอง
app.get('/admin',
  (req, res, next) => (req.session.userId ? next() : res.redirect('/')),
  authenticate,
  requirePermission('user.manage'),
  (req, res) => res.sendFile(path.join(__dirname, '../private/admin.html'))
);

// 4-6) API
// /api/auth: เข้าสู่ระบบ/สมัคร ไม่ต้องล็อกอิน (ยกเว้น /me ซึ่งใส่ authenticate ไว้ในไฟล์เอง)
// /api/account, /api/directory: ใส่ authenticate ไว้ในไฟล์เองทุก Route
// ที่เหลือต้องผ่าน authenticate ก่อน (ยังไม่ล็อกอิน → 401)
// /api/admin/... คือกลุ่ม API ของ Admin แยกจาก API ผู้ใช้ทั่วไป และตรวจสิทธิ์ทุก Route ด้านใน
// withRefs: เติมเลขที่คำร้อง (เช่น WS-D3WY-TVJ4) ให้ JSON ที่ตอบกลับ (services/refs.js)
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/account'));
app.use('/api/requests', authenticate, withRefs, require('./routes/requests'));
app.use('/api/notifications', authenticate, withRefs, require('./routes/notifications'));
app.use('/api/attachments', authenticate, require('./routes/attachments'));
app.use('/api/announcements', authenticate, require('./routes/announcements'));
app.use('/api/admin', authenticate, require('./routes/admin'));

// API ที่ไม่มีอยู่ ให้ตอบ 404 เป็น JSON (ไม่ส่ง index.html)
app.use('/api', (req, res) => res.status(404).json({ error: 'ไม่พบ API นี้' }));

// ทุก path อื่นที่ไม่ใช่ API ส่งหน้า index.html (หน้าเว็บตัดสินเองว่าจะแสดงหน้าล็อกอินหรือหน้าหลัก)
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

// 7) ตัวจัดการ error ต้องอยู่หลังทุก Route
app.use(errorHandler);

// กันไม่ให้ process ตายจาก error ที่หลุดมา (log ไว้ดูแทน)
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));

// ping ฐานข้อมูลทุก 4 นาที กันการเชื่อมต่อกับ Neon หลับ ทำให้คำขอแรกไม่ช้า
setInterval(() => db.query('SELECT 1').catch(() => {}), 4 * 60 * 1000).unref();

// Render กำหนด Port ผ่าน Environment PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
