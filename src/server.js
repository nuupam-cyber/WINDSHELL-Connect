const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

// 1. ตั้งค่า Trust Proxy สำหรับ Render
app.set('trust proxy', 1);

// 2. Middleware อ่าน Body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. ตั้งค่า Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'default_secret_key',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// 4. เสิร์ฟไฟล์ Static ใน public
app.use(express.static(path.join(__dirname, '../public')));

// 5. Import เฉพาะ Routes หลักที่มีอยู่แน่นอน
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// ตรวจสอบเช็กไฟล์ requests route ก่อนเรียกใช้
try {
  const requestRoutes = require('./routes/requests');
  app.use('/api/requests', requestRoutes);
} catch (e) {
  console.log('Note: requests route not loaded');
}

// Fallback Route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 6. Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});