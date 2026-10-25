const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const app = express();

// 1. ตั้งค่า Trust Proxy สำหรับ Render (สำคัญมาก: ทำให้ Session/Cookie ผ่าน HTTPS ทำงานได้)
app.set('trust proxy', 1);

// 2. Middleware สำหรับอ่าน Body (JSON & Form Data)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. ตั้งค่า CORS (กรณีมี Request ข้ามโดเมน)
app.use(cors({
  origin: true,
  credentials: true
}));

// 4. ตั้งค่า Session สำหรับ Render และ HTTPS
app.use(session({
  secret: process.env.SESSION_SECRET || 'default_secret_fallback',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // เป็น true เมื่อรันบน HTTPS บน Render
    sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax', // รองรับการส่ง Cookie
    maxAge: 24 * 60 * 60 * 1000 // อายุ Session 1 วัน
  }
}));

// 5. ให้บริการไฟล์ Static ในโฟลเดอร์ public
app.use(express.static(path.join(__dirname, '../public')));

// 6. Import และเรียกใช้ Routes ต่างๆ
const authRoutes = require('./routes/auth');
const requestRoutes = require('./routes/requests');
const adminRoutes = require('./routes/admin');
const announcementRoutes = require('./routes/announcements');
const notificationRoutes = require('./routes/notifications');
const attachmentRoutes = require('./routes/attachments');

app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/attachments', attachmentRoutes);

// Fallback Route ส่งกลับไปหน้าแรก
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 7. ตั้งค่า Port สำหรับ Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});