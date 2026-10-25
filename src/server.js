// ต้องอยู่บรรทัดแรกสุด: ทำให้ error ใน async handler ถูกส่งเข้า error handler
// แทนที่จะทำให้ process ตาย (Express 4)
require('express-async-errors');

const express = require('express');
const session = require('express-session');
const path = require('path');
const { authenticate } = require('./middleware/auth');

const app = express();

// 1. Trust Proxy สำหรับ Render HTTPS
app.set('trust proxy', 1);

// 2. Middleware อ่าน Body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'default_secret_key',
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

// /api/auth/me ต้องรู้ว่าใครล็อกอินอยู่ (login/logout ไม่ต้องผ่าน authenticate)
// ถ้า /me ของคุณจัดการกรณียังไม่ล็อกอินเองอยู่แล้ว ให้ลบบรรทัดนี้ออก
app.get('/api/auth/me', authenticate);

// ไม่ต้องล็อกอิน
loadRoute('./routes/auth', '/api/auth');

// ต้องล็อกอินก่อน
loadRoute('./routes/requests', '/api/requests', authenticate);
loadRoute('./routes/admin', '/api/admin', authenticate);
loadRoute('./routes/announcements', '/api/announcements', authenticate);
loadRoute('./routes/notifications', '/api/notifications', authenticate);
loadRoute('./routes/attachments', '/api/attachments', authenticate);

// API ที่ไม่มีอยู่ ให้ตอบ 404 เป็น JSON (ไม่ส่ง index.html)
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, message: 'ไม่พบ API นี้' });
});

// Fallback Route ส่งกลับไปหน้า index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Global Error Handler (ต้องอยู่หลังทุก route)
app.use((err, req, res, next) => {
  console.error('API Error:', err);
  const candidates = [err.status, err.statusCode, err.httpStatus];
  const status = candidates.find((n) => Number.isInteger(n) && n >= 400 && n < 600) || 500;
  res.status(status).json({
    ok: false,
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});