const db = require('../db');
const { audit, deny } = require('../logger');
const { HttpError } = require('./errorHandler');

// โหลดผู้ใช้และสิทธิ์ด้วย query เดียว + แคชสั้น ๆ 10 วินาที
// (แก้ Role/ปิดบัญชีมีผลภายใน 10 วินาที โดยไม่ต้องรีสตาร์ต และลดภาระฐานข้อมูลมาก)
const TTL = 10 * 1000;
const cache = new Map();

async function loadUser(userId) {
  const hit = cache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.val;

  const { rows } = await db.query(
    `SELECT u.id, u.username, u.name, u.role_id, u.department_id, u.unit_id, u.is_active, r.name AS role,
            COALESCE((SELECT array_agg(p.name) FROM role_permissions rp
                      JOIN permissions p ON p.id = rp.permission_id
                      WHERE rp.role_id = u.role_id), '{}') AS perms
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId]
  );
  const val = rows[0] || null;
  cache.set(userId, { val, exp: Date.now() + TTL });
  if (cache.size > 500) cache.clear();
  return val;
}

async function authenticate(req, res, next) {
  const userId = req.session.userId;
  if (!userId) {
    await audit(req, {
      eventType: 'access_denied', resourceType: 'route', result: 'denied',
      detail: `unauthenticated ${req.method} ${req.path}`,
    });
    throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  }

  const row = await loadUser(userId);
  if (!row || !row.is_active) {
    cache.delete(userId);
    req.session.destroy(() => {});
    throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  }

  const { perms, ...user } = row;
  req.user = user;
  req.permissions = new Set(perms);
  next();
}

function requirePermission(name) {
  return async (req, res, next) => {
    if (req.permissions.has(name)) return next();
    await deny(req, 'route', null, `${req.method} ${req.originalUrl} requires ${name}`);
    throw new HttpError(403, 'ไม่มีสิทธิ์ดำเนินการนี้');
  };
}

const invalidateUser = (id) => cache.delete(id);

module.exports = { authenticate, requirePermission, invalidateUser };