const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();

// 1. ตั้งค่า Trust Proxy สำหรับ Render HTTPS
app.set('trust proxy', 1);

// 2. Middleware อ่าน Body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. ตั้งค่า Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'default_secret_fallback',
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

// 4. ให้บริการไฟล์ Static ในโฟลเดอร์ public
app.use(express.static(path.join(__dirname, '../public')));

// 5. Import Routes ที่มีในโปรเจกต์
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

// Fallback Route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 6. Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});