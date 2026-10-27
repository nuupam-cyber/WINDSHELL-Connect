// ต้องอยู่บรรทัดแรกสุด: ทำให้ error ใน async handler ถูกส่งเข้า error handler
// แทนที่จะทำให้ process ตาย (Express 4)
require('express-async-errors');

const express = require('express');
const session = require('express-session');
const path = require('path');
const db = require('./db');
const { HttpError } = require('./middleware/errorHandler');
const { authenticate, invalidateUser, requirePermission } = require('./middleware/auth');

const bcrypt = require('bcrypt');
const app = express();

// 1. Trust Proxy สำหรับ Render HTTPS
app.set('trust proxy', 1);

// 2. Middleware อ่าน Body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Session: เก็บใน Postgres เพื่อไม่ให้ผู้ใช้ถูกเด้งออกทุกครั้งที่ server restart/deploy
// (ต้อง npm install connect-pg-simple; ถ้ายังไม่ติดตั้งจะใช้ MemoryStore ไปก่อน)
let store;
try {
  const PgStore = require('connect-pg-simple')(session);
  store = new PgStore({ pool: db.pool, createTableIfMissing: true, disableTouch: true }); // ไม่เขียน DB ทุกคำขอ
} catch (e) {
  console.warn('ใช้ MemoryStore เพราะ:', e.message);
}
app.use(session({
  store,
  name: 'sid', // ให้ตรงกับ res.clearCookie('sid') ใน routes/auth.js
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

// หน้าจัดการระบบ: ไฟล์อยู่ใน private/ (ไม่เปิดให้ทุกคน) ต้องล็อกอินและมีสิทธิ์ user.manage
app.get('/admin',
  (req, res, next) => (req.session.userId ? next() : res.redirect('/')),
  authenticate,
  requirePermission('user.manage'),
  (req, res) => res.sendFile(path.join(__dirname, '../private/admin.html'))
);

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
loadRoute('./routes/recovery', '/api/recovery');

// อีเมล: ตรวจรูปแบบ + ไม่ซ้ำ
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
async function checkEmail(raw, exceptUserId = null) {
  const email = String(raw || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'รูปแบบอีเมลไม่ถูกต้อง');
  const { rows: [t] } = await db.query(
    'SELECT 1 FROM users WHERE lower(email) = $1 AND ($2::int IS NULL OR id <> $2)', [email, exceptUserId]);
  if (t) throw new HttpError(409, 'อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว');
  return email;
}

// สมัครลูกบ้าน: ต้องกรอกอีเมล แล้วบันทึกต่อเมื่อสมัครสำเร็จ
app.post('/api/auth/register', async (req, res, next) => {
  const email = await checkEmail(req.body.email);
  const username = String(req.body.username || '').trim();
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode < 300) {
      db.query('UPDATE users SET email = $1 WHERE username = $2 AND email IS NULL', [email, username])
        .catch((e) => console.error('บันทึกอีเมลไม่สำเร็จ:', e.message));
    }
    return json(body);
  };
  next();
});
loadRoute('./routes/auth', '/api/auth');

// ต้องล็อกอินก่อน

// บัญชีของฉัน: ทุกบทบาทแก้ชื่อและเปลี่ยนรหัสผ่านของตัวเองได้
app.patch('/api/account/profile', authenticate, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 100) throw new HttpError(400, 'กรุณากรอกชื่อ (ไม่เกิน 100 ตัวอักษร)');
  await db.query('UPDATE users SET name = $1 WHERE id = $2', [name, req.user.id]);
  invalidateUser(req.user.id);
  res.json({ ok: true, name });
});

app.get('/api/account', authenticate, async (req, res) => {
  const { rows: [u] } = await db.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
  res.json({ email: u?.email || '' });
});

// เปลี่ยนอีเมล ต้องยืนยันด้วยรหัสผ่านปัจจุบัน
app.patch('/api/account/email', authenticate, async (req, res) => {
  const { rows: [u] } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const pw = req.body.current_password;
  if (!(typeof pw === 'string' && u && await bcrypt.compare(pw, u.password_hash))) {
    throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  const email = await checkEmail(req.body.email, req.user.id);
  await db.query('UPDATE users SET email = $1 WHERE id = $2', [email, req.user.id]);
  res.json({ ok: true, email });
});

app.post('/api/account/password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof new_password !== 'string' || new_password.length < 8) {
    throw new HttpError(400, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
  }
  const { rows: [u] } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const ok = u && typeof current_password === 'string' && await bcrypt.compare(current_password, u.password_hash);
  if (!ok) throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  if (current_password === new_password) throw new HttpError(400, 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(new_password, 12), req.user.id]);
  res.json({ ok: true });
});

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

// ===== เลขที่คำร้อง: รหัสอ้างอิงแบบสลิปธนาคาร (WS-XXXX-XXXX) =====
// สร้างจากเลข id ภายในด้วย HMAC + ความลับของระบบ จึงเดาลำดับ/จำนวนคำร้องไม่ได้ และไม่ต้องแก้ฐานข้อมูล
// (เลข id เดิมยังใช้ภายใน API เหมือนเดิม)
const crypto = require('crypto');
const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ตัดตัวที่สับสน I L O 0 1
function refCode(id) {
  const h = crypto.createHmac('sha256', process.env.REF_SECRET || process.env.SESSION_SECRET || 'default_secret_key')
    .update(`request:${id}`).digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += REF_CHARS[h[i] % REF_CHARS.length];
  return `WS-${out.slice(0, 4)}-${out.slice(4)}`;
}
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
function withRefs(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(addRefs(body));
  next();
}
app.use('/api/requests', withRefs);
app.use('/api/notifications', withRefs);

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
(async () => {
  // เพิ่มคอลัมน์ตำแหน่งให้ตาราง users (ทำซ้ำได้ ไม่เสียหาย)
  try {
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS position varchar(100)');
  } catch (e) {
    console.error('เพิ่มคอลัมน์ position ไม่สำเร็จ:', e.message);
  }
  // อีเมลสำหรับกู้รหัสผ่าน + ตารางรหัส OTP (ทำซ้ำได้ ไม่เสียหาย)
  try {
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email varchar(254)');
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email)) WHERE email IS NOT NULL');
    await db.query(`CREATE TABLE IF NOT EXISTS password_resets (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash text NOT NULL,
      expires_at timestamptz NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      used boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )`);
  } catch (e) {
    console.error('สร้างโครงสร้างกู้รหัสผ่านไม่สำเร็จ:', e.message);
  }
  setInterval(() => db.query('SELECT 1').catch(() => {}), 4 * 60 * 1000).unref();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
})();