const db = require('../db');
const { audit, deny } = require('../logger');
const { HttpError } = require('./errorHandler');

// ตรวจ Session ทุกครั้ง โหลดผู้ใช้และสิทธิ์จากฐานข้อมูล (แก้ Role มีผลทันที ไม่ต้องรีสตาร์ต)
async function authenticate(req, res, next) {
  const userId = req.session.userId;
  if (!userId) {
    await audit(req, {
      eventType: 'access_denied', resourceType: 'route', result: 'denied',
      detail: `unauthenticated ${req.method} ${req.path}`,
    });
    throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  }

  const { rows: [user] } = await db.query(
  `SELECT u.id, u.username, u.name, u.role_id, u.department_id, u.unit_id, u.is_active, r.name AS role
   FROM users u JOIN roles r ON r.id = u.role_id
   WHERE u.id = $1`,
  [userId]
);
  if (!user || !user.is_active) {
    req.session.destroy(() => {});
    throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  }

  const { rows } = await db.query(
    `SELECT p.name FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [user.role_id]
  );
  req.user = user;
  req.permissions = new Set(rows.map((r) => r.name));
  next();
}

function requirePermission(name) {
  return async (req, res, next) => {
    if (req.permissions.has(name)) return next();
    await deny(req, 'route', null, `${req.method} ${req.originalUrl} requires ${name}`);
    throw new HttpError(403, 'ไม่มีสิทธิ์ดำเนินการนี้');
  };
}

module.exports = { authenticate, requirePermission };