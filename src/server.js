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
  secret: process.env.SESSION_SECRET || 'default_secret_key',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 1 วัน
  }
}));

// 4. ให้บริการไฟล์ Static ใน public
app.use(express.static(path.join(__dirname, '../public')));

// 5. Safe-load เฉพาะ Routes ที่มีอยู่จริงในโปรเจกต์
const loadRoute = (routePath, apiEndpoint) => {
  try {
    const route = require(routePath);
    app.use(apiEndpoint, route);
    console.log(`Loaded route: ${apiEndpoint}`);
  } catch (err) {
    console.log(`Skipped route ${apiEndpoint}: ${err.message}`);
  }
};

loadRoute('./routes/auth', '/api/auth');
loadRoute('./routes/requests', '/api/requests');
loadRoute('./routes/admin', '/api/admin');
loadRoute('./routes/announcements', '/api/announcements');
loadRoute('./routes/notifications', '/api/notifications');
loadRoute('./routes/attachments', '/api/attachments');

// Fallback Route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 6. Port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});