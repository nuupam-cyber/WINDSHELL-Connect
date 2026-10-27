// =====================================================================
// src/middleware/auth.js — Middleware ยืนยันตัวตน (Authentication) และตรวจสิทธิ์ (Authorization / ACL)
//
// authenticate          : ด่านแรก ตรวจว่าล็อกอินแล้ว แล้วโหลดข้อมูลผู้ใช้ + รายการ Permission จากฐานข้อมูล
// requirePermission(x)  : ด่านที่สอง ตรวจว่า Role ของผู้ใช้มี Permission x ในตาราง role_permissions หรือไม่
//
// สิทธิ์อ่านจากฐานข้อมูลทุกครั้ง (ผ่าน cache 10 วินาที) ไม่ได้เขียนตายตัวในโค้ด
// → Admin ติ๊กเพิ่ม/ถอนสิทธิ์ในหน้า ACL แล้วมีผลทันทีโดยไม่ต้องรีสตาร์ต server
// =====================================================================
const db = require('../db');
const { audit, deny } = require('../logger');
const { HttpError } = require('./errorHandler');

// โหลดผู้ใช้และสิทธิ์ด้วย query เดียว + แคชสั้น ๆ 10 วินาที
// (แก้ Role/ปิดบัญชีมีผลภายใน 10 วินาที โดยไม่ต้องรีสตาร์ต และลดภาระฐานข้อมูลมาก)
const TTL = 10 * 1000;
const cache = new Map();

// loadUser: ดึงผู้ใช้ 1 คน พร้อมชื่อ Role และรายชื่อ Permission ทั้งหมดของ Role นั้น
// SQL: users JOIN roles แล้วใช้ array_agg รวมชื่อสิทธิ์จาก role_permissions JOIN permissions เป็น array เดียว
async function loadUser(userId) {
  const hit = cache.get(userId);
  if (hit && hit.exp > Date.now()) return hit.val;

  const { rows } = await db.query(
    `SELECT u.id, u.username, u.name, u.position, u.role_id, u.department_id, u.unit_id, u.is_active, r.name AS role,
            r.description AS role_description,
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

// authenticate: ใช้ก่อนทุก API ที่ต้องล็อกอิน
// 1) ไม่มี userId ใน session → บันทึก Log ว่าถูกปฏิเสธ แล้วตอบ 401
// 2) บัญชีถูกลบหรือถูกปิดใช้งาน → ทำลาย session ทิ้ง แล้วตอบ 401
// 3) ผ่าน → เก็บ req.user (ข้อมูลผู้ใช้) และ req.permissions (Set ของชื่อสิทธิ์) ให้ middleware/route ถัดไปใช้
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

// requirePermission('request.create'): สร้าง middleware ที่ตรวจสิทธิ์ 1 ชื่อ
// ใช้ใน route เช่น router.post('/', requirePermission('request.create'), handler)
// ไม่มีสิทธิ์ → บันทึก Log access_denied แล้วตอบ 403 (ตรวจฝั่ง server เสมอ ไม่ได้อาศัยแค่การซ่อนปุ่มในหน้าเว็บ)
function requirePermission(name) {
  return async (req, res, next) => {
    if (req.permissions.has(name)) return next();
    await deny(req, 'route', null, `${req.method} ${req.originalUrl} requires ${name}`);
    throw new HttpError(403, 'ไม่มีสิทธิ์ดำเนินการนี้');
  };
}

// invalidateUser(id): ล้าง cache ของผู้ใช้คนหนึ่ง เรียกหลังแก้ข้อมูล/Role ของผู้ใช้ ให้มีผลทันที
// invalidateUser(): ล้างทั้งหมด เรียกหลังเปลี่ยน ACL เพราะกระทบผู้ใช้ทุกคนใน Role นั้น
const invalidateUser = (id) => (id === undefined ? cache.clear() : cache.delete(id));

module.exports = { authenticate, requirePermission, invalidateUser };