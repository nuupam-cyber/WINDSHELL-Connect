require('dotenv').config();
require('express-async-errors');

const path = require('path');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const db = require('./db');
const { authenticate, requirePermission } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errorHandler');

if (!process.env.SESSION_SECRET) throw new Error('ต้องตั้งค่า SESSION_SECRET ใน .env');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.use(session({
  store: new PgSession({ pool: db.pool, createTableIfMissing: true }),
  name: 'sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/requests', authenticate, require('./routes/requests'));
app.use('/api/attachments', authenticate, require('./routes/attachments'));
app.use('/api/admin', authenticate, require('./routes/admin'));
app.use('/api/announcements', authenticate, require('./routes/announcements'));
app.use('/api/notifications', authenticate, require('./routes/notifications'));

// หน้าเว็บทั่วไปจากโฟลเดอร์ public
app.use(express.static(path.join(__dirname, '../public')));

// หน้า Admin อยู่นอก public จึงเข้าโดยตรงไม่ได้ ต้องผ่านการตรวจสิทธิ์ก่อนส่งไฟล์
app.get('/admin',
  (req, res, next) => (req.session.userId ? next() : res.redirect('/')),
  authenticate,
  requirePermission('user.manage'),
  (req, res) => res.sendFile(path.join(__dirname, '../private/admin.html')));

app.use((req, res) => res.status(404).json({ error: 'ไม่พบเส้นทาง' }));
app.use(errorHandler);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));