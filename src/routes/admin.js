// =====================================================================
// src/routes/admin.js — API ส่วน Admin (path: /api/admin/...) แยกจาก API ผู้ใช้ทั่วไปทาง Logical
// ทุก Route ผ่าน authenticate (server.js) แล้วตรวจสิทธิ์เฉพาะของตัวเองด้วย requirePermission
// ผู้ไม่มีสิทธิ์เรียก URL นี้ตรงๆ จะได้ 403 และถูกบันทึก Log access_denied
//
// หมวด → สิทธิ์ที่ต้องมี
//   ผู้ใช้ → user.manage | Role → role.manage | Permission → permission.manage
//   ACL (Role × Permission) → acl.manage | ประเภทงาน → category.manage
//   อาคาร/ห้อง/สัญญา/พื้นที่ส่วนกลาง → property.manage | Log → log.read
// ทุกการเพิ่ม/แก้/ลบ บันทึก Log ไว้ดูย้อนหลัง
// =====================================================================
const bcrypt = require('bcrypt');
const { Router } = require('express');
const db = require('../db');
const { withTransaction } = db;
const { audit } = require('../logger');
const { requirePermission, requireAnyPermission, invalidateUser } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');
const { parseId } = require('../services/access');
const { CODE_PERMISSIONS, OPTIONAL_PERMISSIONS, PROTECTED_ADMIN_PERMISSIONS, CODE_ROLES } = require('../config/permissions');
const { positionsFor, POSITION_DEPT, deptNameFor } = require('../config/positions');

// deptIdFor: id ฝ่ายที่ผูกกับตำแหน่ง (undefined ถ้าตำแหน่งนี้ไม่ได้ผูกฝ่าย) ใช้ตั้งฝ่ายตามตำแหน่งเสมอ
async function deptIdFor(client, position) {
  const name = deptNameFor(position);
  if (!name) return undefined;
  const { rows: [d] } = await client.query('SELECT id FROM departments WHERE name = $1', [name]);
  return d ? d.id : undefined;
}

const router = Router();

// Regex ตรวจรูปแบบข้อมูลฝั่ง server: ชื่อผู้ใช้, ชื่อ Role (a-z และ _)
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,50}$/;
const ROLE_RE = /^[a-z][a-z_]{2,49}$/;

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) {
    throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  }
}

const optText = (v) => (v ? String(v).trim() : null);

// ===== ผู้ใช้ =====
// GET /api/admin/users — รายชื่อผู้ใช้ทั้งหมดพร้อมตำแหน่ง ไม่ SELECT password_hash ออกมา เพื่อไม่ให้ Hash ไปแสดงบนหน้าเว็บ
router.get('/users', requirePermission('user.manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, username, name, position, role_id, department_id, is_active
     FROM users ORDER BY id`);
  res.json(rows);
});

// POST /api/admin/users — Admin สร้างบัญชี (เช่น เจ้าหน้าที่) ตรวจข้อมูล แล้ว Hash รหัสผ่านด้วย bcrypt ก่อนบันทึก
router.post('/users', requirePermission('user.manage'), async (req, res) => {
  const { username, password, name, role_id, department_id = null } = req.body;
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    throw new HttpError(400, 'ชื่อผู้ใช้ใช้ a-z A-Z 0-9 _ . ความยาว 3-50 ตัวอักษร');
  }
  checkPassword(password);
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'กรุณาระบุชื่อ');
  const roleId = parseId(role_id);

  const hash = await bcrypt.hash(password, 12);
  const { rows: [u] } = await db.query(
    `INSERT INTO users (username, password_hash, name, role_id, department_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, name, role_id, department_id, is_active`,
    [username, hash, name.trim(), roleId, department_id]
  );
  await audit(req, { eventType: 'user_create', resourceType: 'user', resourceId: u.id, result: 'success', detail: `role_id=${roleId}` });
  res.status(201).json(u);
});

// แก้ Role, ชื่อ, ฝ่าย, สถานะ หรือรหัสผ่าน ผ่านเว็บ (ไม่แก้ Source Code)
router.patch('/users/:id', requirePermission('user.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const b = req.body;

  // ใช้ Transaction + FOR UPDATE เพื่อตรวจและแก้ข้อมูลผู้ใช้แบบไม่ชนกับคำขออื่น
  const detail = await withTransaction(async (client) => {
    const { rows: [cur] } = await client.query(
      `SELECT u.*, r.name AS role_name FROM users u
       JOIN roles r ON r.id = u.role_id WHERE u.id = $1 FOR UPDATE OF u`, [id]);
    if (!cur) throw new HttpError(404, 'ไม่พบผู้ใช้');

    const roleId = b.role_id !== undefined ? parseId(b.role_id) : cur.role_id;
    const { rows: [role] } = await client.query('SELECT id, name, description FROM roles WHERE id = $1', [roleId]);
    if (!role) throw new HttpError(400, 'ไม่พบ Role');

    const name = b.name !== undefined ? String(b.name).trim() : cur.name;
    if (!name) throw new HttpError(400, 'กรุณาระบุชื่อ');
    let deptId = b.department_id !== undefined ? b.department_id : cur.department_id;
    const isActive = b.is_active !== undefined ? Boolean(b.is_active) : cur.is_active;

    let hash = null;
    if (b.password !== undefined) {
      checkPassword(b.password);
      hash = await bcrypt.hash(b.password, 12);
    }

    // ป้องกันไม่ให้ไม่มี Admin เหลือ
    // losesAdmin = ผู้ใช้นี้เป็น admin อยู่ แล้วกำลังถูกเปลี่ยน Role หรือถูกปิดบัญชี
    // ถ้าไม่เหลือ admin ที่ใช้งานได้คนอื่นเลย → ปฏิเสธ (409) ระบบจะไม่มีวันไม่มี Admin
    const losesAdmin = cur.role_name === 'admin' && (role.name !== 'admin' || !isActive);
    if (losesAdmin) {
      const { rows: [{ count }] } = await client.query(
        `SELECT COUNT(*)::int AS count FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'admin' AND u.is_active AND u.id <> $1`, [id]);
      if (count === 0) throw new HttpError(409, 'ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน');
    }

    // ตำแหน่งผูกกับ Role: เปลี่ยน Role แล้วตำแหน่งเดิมไม่อยู่ในรายการของ Role ใหม่ → ล้างตำแหน่ง (ไปเลือกใหม่)
    const position = positionsFor(role.name, role.description).includes(cur.position) ? cur.position : null;
    // ตำแหน่งที่ผูกกับฝ่าย → ฝ่ายถูกกำหนดตามตำแหน่ง (ค่าที่ส่งมาถูกแทนที่)
    deptId = (await deptIdFor(client, position)) ?? deptId;
    await client.query(
      `UPDATE users SET name = $1, role_id = $2, department_id = $3, is_active = $4,
              password_hash = COALESCE($5, password_hash), position = $6
       WHERE id = $7`,
      [name, role.id, deptId, isActive, hash, position, id]
    );
    return `role ${cur.role_name}->${role.name}, active ${cur.is_active}->${isActive}${hash ? ', password changed' : ''}`;
  });

  invalidateUser(id); // Role/สถานะใหม่มีผลกับคำขอถัดไปของผู้ใช้คนนี้ทันที
  await audit(req, { eventType: 'user_update', resourceType: 'user', resourceId: id, result: 'success', detail });
  res.json({ ok: true });
});

// PATCH /api/admin/users/:id/profile — แก้ชื่อ-นามสกุล และตำแหน่ง (แยกคนละช่อง)
// ตำแหน่งต้องอยู่ในรายการของ Role ผู้ใช้ (config/positions.js) หรือเว้นว่าง หรือเป็นค่าเดิม (ข้อมูลเก่าก่อนมีรายการ)
router.patch('/users/:id/profile', requirePermission('user.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const name = String(req.body.name ?? '').trim();
  const position = String(req.body.position ?? '').trim();
  if (!name || name.length > 100) throw new HttpError(400, 'ชื่อต้องไม่ว่างและยาวไม่เกิน 100 ตัวอักษร');
  const { rows: [cur] } = await db.query(
    'SELECT u.position, r.name AS role_name, r.description AS role_description FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1', [id]);
  if (!cur) throw new HttpError(404, 'ไม่พบผู้ใช้');
  if (position && position !== cur.position && !positionsFor(cur.role_name, cur.role_description).includes(position)) {
    throw new HttpError(400, 'ตำแหน่งนี้ไม่ตรงกับ Role ของผู้ใช้');
  }
  // ตั้งตำแหน่งที่ผูกกับฝ่าย → ตั้งฝ่ายตามตำแหน่งด้วย (ตำแหน่งที่ไม่ผูกฝ่ายไม่แตะฝ่ายเดิม)
  const deptId = position ? await deptIdFor(db, position) : undefined;
  await db.query('UPDATE users SET name = $1, position = $2, department_id = COALESCE($4, department_id) WHERE id = $3',
    [name, position || null, id, deptId ?? null]);
  invalidateUser(id);
  await audit(req, { eventType: 'user_update', resourceType: 'user', resourceId: id, result: 'success', detail: 'name/position' });
  res.json({ ok: true });
});

// POST /api/admin/users/:id/password — Admin ตั้งรหัสผ่านใหม่ให้ผู้ใช้ที่ลืมรหัส
// Hash ด้วย bcrypt ก่อนบันทึก และ Log แค่ว่าตั้งให้ใคร ไม่บันทึกรหัสผ่าน
router.post('/users/:id/password', requirePermission('user.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  checkPassword(req.body.password);
  const hash = await bcrypt.hash(req.body.password, 12);
  const { rowCount } = await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
  if (!rowCount) throw new HttpError(404, 'ไม่พบผู้ใช้');
  await audit(req, { eventType: 'password_reset', resourceType: 'user', resourceId: id, result: 'success' });
  res.json({ ok: true });
});

// รายชื่อฝ่าย ใช้ทั้งแท็บผู้ใช้ และแท็บประเภทงาน (ผูกประเภทกับฝ่าย)
router.get('/departments', requireAnyPermission('user.manage', 'category.manage'), async (req, res) => {
  const { rows } = await db.query('SELECT id, name FROM departments ORDER BY id');
  res.json(rows);
});

// ===== Role =====
// GET /api/admin/roles — รายการ Role พร้อมจำนวนผู้ใช้ในแต่ละ Role (ใช้แสดงและตัดสินว่าลบได้ไหม)
// in_code = Role หลักที่ระบบใช้ชื่อนี้อยู่ (หน้าเว็บล็อกช่องชื่อและซ่อนปุ่มลบ server ตรวจซ้ำอีกชั้น)
// แท็บผู้ใช้ (user.manage) ต้องใช้รายชื่อ Role สำหรับช่องเลือก Role/ตำแหน่ง จึงอ่านได้ทั้งสองสิทธิ์ (แก้ไข Role ยังต้องมี role.manage)
router.get('/roles', requireAnyPermission('role.manage', 'user.manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.description, COUNT(u.id)::int AS user_count
     FROM roles r LEFT JOIN users u ON u.role_id = r.id
     GROUP BY r.id ORDER BY r.id`);
  // positions: ตำแหน่งที่เลือกได้ของ Role นี้ หน้า Admin ใช้สร้าง dropdown ตำแหน่ง
  res.json(rows.map((r) => ({ ...r, in_code: CODE_ROLES.includes(r.name), positions: positionsFor(r.name, r.description),
    // position_depts: ตำแหน่ง → ชื่อฝ่าย (หน้าเว็บใช้ตั้งช่องฝ่ายตามตำแหน่งที่เลือก)
    position_depts: Object.fromEntries(positionsFor(r.name, r.description).filter((p) => POSITION_DEPT[p]).map((p) => [p, POSITION_DEPT[p]])) })));
});

// POST /api/admin/roles — เพิ่ม Role ใหม่ผ่านเว็บ ไม่ต้องแก้โค้ด จากนั้นไปติ๊กสิทธิ์ให้ในหน้า ACL
router.post('/roles', requirePermission('role.manage'), async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!ROLE_RE.test(name)) throw new HttpError(400, 'ชื่อ Role ใช้ a-z และ _ ความยาว 3-50 ตัวอักษร');
  const { rows: [role] } = await db.query(
    'INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING *', [name, optText(req.body.description)]);
  await audit(req, { eventType: 'role_create', resourceType: 'role', resourceId: role.id, result: 'success', detail: name });
  res.status(201).json(role);
});

// PATCH /api/admin/roles/:id — แก้ชื่อ/คำอธิบาย Role
// Role หลัก (CODE_ROLES) แก้ได้เฉพาะคำอธิบาย เพราะโค้ดอ้างชื่อเหล่านี้อยู่ เช่น เลือกช่างจาก Role technician
router.patch('/roles/:id', requirePermission('role.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [cur] } = await db.query('SELECT * FROM roles WHERE id = $1', [id]);
  if (!cur) throw new HttpError(404, 'ไม่พบ Role');

  const name = req.body.name !== undefined ? String(req.body.name).trim() : cur.name;
  if (!ROLE_RE.test(name)) throw new HttpError(400, 'ชื่อ Role ใช้ a-z และ _ ความยาว 3-50 ตัวอักษร');
  if (name !== cur.name && CODE_ROLES.includes(cur.name)) {
    throw new HttpError(409, `เปลี่ยนชื่อ Role ${cur.name} ไม่ได้ เพราะเป็น Role หลักที่ระบบใช้ (แก้ได้เฉพาะคำอธิบาย)`);
  }
  const description = req.body.description !== undefined ? optText(req.body.description) : cur.description;

  const { rows: [role] } = await db.query(
    'UPDATE roles SET name = $1, description = $2 WHERE id = $3 RETURNING *', [name, description, id]);
  await audit(req, { eventType: 'role_update', resourceType: 'role', resourceId: id, result: 'success', detail: `${cur.name}->${name}` });
  res.json(role);
});

// DELETE /api/admin/roles/:id — ห้ามลบ Role หลัก และห้ามลบ Role ที่ยังมีผู้ใช้อยู่ (ตอบ 409)
router.delete('/roles/:id', requirePermission('role.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [cur] } = await db.query('SELECT * FROM roles WHERE id = $1', [id]);
  if (!cur) throw new HttpError(404, 'ไม่พบ Role');
  if (CODE_ROLES.includes(cur.name)) throw new HttpError(409, `ลบ Role ${cur.name} ไม่ได้ เพราะเป็น Role หลักที่ระบบใช้`);

  const { rows: [{ count }] } = await db.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE role_id = $1', [id]);
  if (count > 0) throw new HttpError(409, 'ยังมีผู้ใช้ที่ใช้ Role นี้อยู่');

  await db.query('DELETE FROM roles WHERE id = $1', [id]);
  await audit(req, { eventType: 'role_delete', resourceType: 'role', resourceId: id, result: 'success', detail: cur.name });
  res.json({ ok: true });
});

// ===== Permission =====
// GET /api/admin/permissions — รายการ Permission ทั้งหมด
//   in_code = โค้ดตรวจสิทธิ์นี้ด้วย requirePermission จริง (เปลี่ยนชื่อไม่ได้)
//   deletable = ลบผ่านเว็บได้ (สิทธิ์เสริม หรือสิทธิ์เก่าที่ไม่มีโค้ดใช้แล้ว)
//   missing = สิทธิ์ที่โค้ดรองรับแต่ยังไม่มีในฐานข้อมูล (ยังไม่เคยเพิ่ม หรือเคยถูกลบ) เป็นตัวเลือกเดียวที่เพิ่มได้
router.get('/permissions', requirePermission('permission.manage'), async (req, res) => {
  const { rows } = await db.query('SELECT id, name, description FROM permissions ORDER BY name');
  const names = new Set(rows.map((p) => p.name));
  res.json({
    permissions: rows.map((p) => ({
      ...p, in_code: CODE_PERMISSIONS.has(p.name),
      deletable: !CODE_PERMISSIONS.has(p.name) || OPTIONAL_PERMISSIONS.has(p.name),
    })),
    missing: [...CODE_PERMISSIONS].filter((n) => !names.has(n)).sort(),
  });
});

// POST /api/admin/permissions — เพิ่ม Permission ผ่านเว็บ แล้วให้ Role admin อัตโนมัติ (Admin ใช้ได้ทุกฟังก์ชันรวมถึงที่เพิ่มภายหลัง)
// เพิ่มได้เฉพาะชื่อที่โค้ดตรวจด้วย requirePermission อยู่แล้ว (CODE_PERMISSIONS) เช่น request.export ใน routes/requests.js
// กันการเพิ่มชื่อที่ไม่มีฟังก์ชันรองรับ ซึ่งจะไม่ได้ป้องกันอะไรจริง · ชื่อที่มีอยู่แล้วตอบ 409 (UNIQUE)
router.post('/permissions', requirePermission('permission.manage'), async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!CODE_PERMISSIONS.has(name)) {
    await audit(req, { eventType: 'permission_create', resourceType: 'permission', result: 'failure', detail: `${name.slice(0, 60)} (no code support)` });
    throw new HttpError(400, 'เพิ่มได้เฉพาะสิทธิ์ที่ระบบมีฟังก์ชันรองรับแล้ว (เลือกจากรายการ)');
  }
  const p = await withTransaction(async (client) => {
    const { rows: [created] } = await client.query(
      'INSERT INTO permissions (name, description) VALUES ($1, $2) RETURNING *', [name, optText(req.body.description)]);
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT id, $1 FROM roles WHERE name = 'admin' ON CONFLICT DO NOTHING`, [created.id]);
    return created;
  });
  invalidateUser();
  await audit(req, { eventType: 'permission_create', resourceType: 'permission', resourceId: p.id, result: 'success', detail: name });
  res.status(201).json(p);
});

// PATCH /api/admin/permissions/:id — แก้ได้เฉพาะคำอธิบาย ห้ามเปลี่ยนชื่อ
// (ชื่อต้องตรงกับที่โค้ดตรวจ เปลี่ยนชื่อจะทำให้ฟังก์ชันใช้ไม่ได้ หรือกลายเป็นชื่อที่ไม่มีฟังก์ชันรองรับ)
router.patch('/permissions/:id', requirePermission('permission.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [cur] } = await db.query('SELECT * FROM permissions WHERE id = $1', [id]);
  if (!cur) throw new HttpError(404, 'ไม่พบ Permission');

  if (req.body.name !== undefined && String(req.body.name).trim() !== cur.name) {
    throw new HttpError(409, 'เปลี่ยนชื่อสิทธิ์ไม่ได้ แก้ได้เฉพาะคำอธิบาย');
  }
  const description = req.body.description !== undefined ? optText(req.body.description) : cur.description;

  const { rows: [p] } = await db.query(
    'UPDATE permissions SET description = $1 WHERE id = $2 RETURNING *', [description, id]);
  await audit(req, { eventType: 'permission_update', resourceType: 'permission', resourceId: id, result: 'success', detail: `${cur.name} description` });
  res.json(p);
});

// DELETE /api/admin/permissions/:id — ลบได้เฉพาะสิทธิ์เสริม (OPTIONAL_PERMISSIONS) หรือสิทธิ์ที่ไม่มีโค้ดใช้
// แถวใน role_permissions ถูกลบตาม (CASCADE) ฟังก์ชันที่ผูกอยู่จึงปิดสำหรับทุกคนทันที และเพิ่มคืนได้ในแท็บ Permission
router.delete('/permissions/:id', requirePermission('permission.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [cur] } = await db.query('SELECT * FROM permissions WHERE id = $1', [id]);
  if (!cur) throw new HttpError(404, 'ไม่พบ Permission');
  if (CODE_PERMISSIONS.has(cur.name) && !OPTIONAL_PERMISSIONS.has(cur.name)) {
    throw new HttpError(409, 'สิทธิ์หลักของระบบ ลบไม่ได้');
  }

  await db.query('DELETE FROM permissions WHERE id = $1', [id]);
  invalidateUser(); // ล้าง cache สิทธิ์ของทุกคน ให้มีผลทันที
  await audit(req, { eventType: 'permission_delete', resourceType: 'permission', resourceId: id, result: 'success', detail: cur.name });
  res.json({ ok: true });
});

// ===== ACL: Role x Permission =====
// GET /api/admin/acl — ข้อมูลสำหรับวาดตาราง ACL: Role ทั้งหมด, Permission ทั้งหมด, คู่ที่ติ๊กไว้ (grants)
router.get('/acl', requirePermission('acl.manage'), async (req, res) => {
  const [roles, permissions, grants] = await Promise.all([
    db.query('SELECT id, name, description FROM roles ORDER BY id'),
    db.query('SELECT id, name FROM permissions ORDER BY name'),
    db.query('SELECT role_id, permission_id FROM role_permissions'),
  ]);
  res.json({ roles: roles.rows, permissions: permissions.rows, grants: grants.rows });
});

// POST /api/admin/acl — ติ๊กให้สิทธิ์ (เพิ่มแถวใน role_permissions) ON CONFLICT DO NOTHING กันแถวซ้ำ
// มีผลกับผู้ใช้ทันที (ภายใน cache 10 วินาทีของ middleware/auth.js) ไม่ต้องรีสตาร์ต server
router.post('/acl', requirePermission('acl.manage'), async (req, res) => {
  const roleId = parseId(req.body.role_id);
  const permId = parseId(req.body.permission_id);
  await db.query(
    'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [roleId, permId]);
  invalidateUser(); // ล้าง cache สิทธิ์ของทุกคน ให้มีผลทันทีโดยไม่ต้องรีสตาร์ต
  await audit(req, { eventType: 'permission_grant', resourceType: 'role_permission', resourceId: roleId, result: 'success', detail: `permission_id=${permId}` });
  res.json({ ok: true });
});

// DELETE /api/admin/acl/:roleId/:permissionId — ถอนสิทธิ์ (ห้ามถอนสิทธิ์จัดการระบบจาก admin)
router.delete('/acl/:roleId/:permissionId', requirePermission('acl.manage'), async (req, res) => {
  const roleId = parseId(req.params.roleId);
  const permId = parseId(req.params.permissionId);
  const { rows: [g] } = await db.query(
    'SELECT r.name AS role, p.name AS permission FROM roles r, permissions p WHERE r.id = $1 AND p.id = $2',
    [roleId, permId]);
  if (!g) throw new HttpError(404, 'ไม่พบข้อมูล');
  if (g.role === 'admin' && PROTECTED_ADMIN_PERMISSIONS.includes(g.permission)) {
    throw new HttpError(409, 'ถอนสิทธิ์นี้จาก Admin ไม่ได้');
  }

  await db.query('DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2', [roleId, permId]);
  invalidateUser();
  await audit(req, { eventType: 'permission_revoke', resourceType: 'role_permission', resourceId: roleId, result: 'success', detail: `${g.role} -/- ${g.permission}` });
  res.json({ ok: true });
});

// ===== ประเภทงาน =====
// ประเภทงาน: เพิ่ม/เปิด-ปิด/กำหนดฝ่ายที่รับผิดชอบ/บังคับกรอกรายละเอียด
router.get('/categories', requirePermission('category.manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.requires_detail, c.is_active, c.department_id, d.name AS department
     FROM issue_categories c JOIN departments d ON d.id = c.department_id
     ORDER BY c.id`);
  res.json(rows);
});

router.post('/categories', requirePermission('category.manage'), async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!name || name.length > 100) throw new HttpError(400, 'ชื่อประเภทต้องไม่ว่างและไม่เกิน 100 ตัวอักษร');
  const deptId = parseId(req.body.department_id);

  const { rows: [c] } = await db.query(
    'INSERT INTO issue_categories (name, department_id, requires_detail) VALUES ($1, $2, $3) RETURNING *',
    [name, deptId, Boolean(req.body.requires_detail)]);
  await audit(req, { eventType: 'category_create', resourceType: 'issue_category', resourceId: c.id, result: 'success', detail: name });
  res.status(201).json(c);
});

router.patch('/categories/:id', requirePermission('category.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const b = req.body;
  const { rows: [cur] } = await db.query('SELECT * FROM issue_categories WHERE id = $1', [id]);
  if (!cur) throw new HttpError(404, 'ไม่พบประเภทงาน');

  const { rows: [c] } = await db.query(
    `UPDATE issue_categories
     SET is_active = $1, requires_detail = $2, department_id = $3
     WHERE id = $4 RETURNING *`,
    [
      b.is_active !== undefined ? Boolean(b.is_active) : cur.is_active,
      b.requires_detail !== undefined ? Boolean(b.requires_detail) : cur.requires_detail,
      b.department_id !== undefined ? parseId(b.department_id) : cur.department_id,
      id,
    ]);
  await audit(req, { eventType: 'category_update', resourceType: 'issue_category', resourceId: id, result: 'success', detail: cur.name });
  res.json(c);
});

// ===== อาคาร ห้อง สัญญา และพื้นที่ส่วนกลาง =====
// ข้อมูลโครงการ: อาคาร ห้อง สัญญาเช่า/ซื้อ (ใช้ยืนยันตอนลูกบ้านสมัคร) และพื้นที่ส่วนกลาง
router.get('/property/buildings', requirePermission('property.manage'), async (req, res) => {
  const { rows } = await db.query('SELECT id, code, name FROM buildings ORDER BY code');
  res.json(rows);
});

router.get('/property/units', requirePermission('property.manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT un.id, un.unit_no, un.floor, b.code AS building_code
     FROM units un JOIN buildings b ON b.id = un.building_id
     ORDER BY b.code, un.floor, un.unit_no`);
  res.json(rows);
});

router.post('/property/units', requirePermission('property.manage'), async (req, res) => {
  const buildingId = parseId(req.body.building_id);
  const floor = Number(req.body.floor);
  const unitNo = String(req.body.unit_no ?? '').trim().toUpperCase();
  if (!Number.isInteger(floor) || floor < 1 || floor > 100) throw new HttpError(400, 'ชั้นต้องเป็นตัวเลข 1-100');
  if (!/^[A-Z0-9-]{2,20}$/.test(unitNo)) throw new HttpError(400, 'เลขห้องใช้ได้เฉพาะ A-Z 0-9 และ - ยาว 2-20 ตัวอักษร');

  const { rows: [u] } = await db.query(
    'INSERT INTO units (building_id, floor, unit_no) VALUES ($1, $2, $3) RETURNING id, unit_no',
    [buildingId, floor, unitNo]);
  await audit(req, { eventType: 'property_unit_create', resourceType: 'unit', resourceId: u.id, result: 'success', detail: unitNo });
  res.status(201).json(u);
});

router.get('/property/contracts', requirePermission('property.manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.contract_no, c.is_active, c.registered_user_id,
            un.unit_no, b.code AS building_code,
            u.name AS resident_name, u.username
     FROM contracts c
     JOIN units un ON un.id = c.unit_id
     JOIN buildings b ON b.id = un.building_id
     LEFT JOIN users u ON u.id = c.registered_user_id
     ORDER BY b.code, un.unit_no, c.contract_no`);
  res.json(rows);
});

router.post('/property/contracts', requirePermission('property.manage'), async (req, res) => {
  const contractNo = String(req.body.contract_no ?? '').trim().toUpperCase();
  const unitId = parseId(req.body.unit_id);
  if (!/^[A-Z0-9-]{3,30}$/.test(contractNo)) throw new HttpError(400, 'เลขที่สัญญาใช้ได้เฉพาะ A-Z 0-9 และ - ยาว 3-30 ตัวอักษร');

  const { rows: [c] } = await db.query(
    'INSERT INTO contracts (contract_no, unit_id) VALUES ($1, $2) RETURNING id, contract_no',
    [contractNo, unitId]);
  await audit(req, { eventType: 'property_contract_create', resourceType: 'contract', resourceId: c.id, result: 'success', detail: contractNo });
  res.status(201).json(c);
});

// เปิดหรือปิดสัญญา หรือถอนผู้สมัคร (ปิดบัญชีผู้ใช้เดิม เพื่อให้เลขที่สัญญาสมัครใหม่ได้)
// unlink: ปิดบัญชีผู้ใช้เดิมของสัญญานี้ และปล่อยเลขสัญญาให้ผู้อยู่ใหม่สมัครได้ (เช่น ผู้เช่าย้ายออก)
router.patch('/property/contracts/:id', requirePermission('property.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const detail = await withTransaction(async (client) => {
    const { rows: [c] } = await client.query('SELECT * FROM contracts WHERE id = $1 FOR UPDATE', [id]);
    if (!c) throw new HttpError(404, 'ไม่พบสัญญา');

    if (req.body.unlink === true) {
      if (!c.registered_user_id) throw new HttpError(409, 'สัญญานี้ยังไม่มีผู้สมัคร');
      await client.query('UPDATE users SET is_active = FALSE WHERE id = $1', [c.registered_user_id]);
      await client.query('UPDATE contracts SET registered_user_id = NULL WHERE id = $1', [id]);
      return `unlink user_id=${c.registered_user_id}`;
    }
    if (typeof req.body.is_active === 'boolean') {
      await client.query('UPDATE contracts SET is_active = $1 WHERE id = $2', [req.body.is_active, id]);
      return `is_active ${c.is_active}->${req.body.is_active}`;
    }
    throw new HttpError(400, 'ไม่มีการเปลี่ยนแปลง');
  });

  await audit(req, { eventType: 'property_contract_update', resourceType: 'contract', resourceId: id, result: 'success', detail });
  res.json({ ok: true });
});

router.get('/property/common-areas', requirePermission('property.manage'), async (req, res) => {
  const { rows } = await db.query('SELECT id, name, is_active FROM common_areas ORDER BY id');
  res.json(rows);
});

router.post('/property/common-areas', requirePermission('property.manage'), async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!name || name.length > 100) throw new HttpError(400, 'ชื่อพื้นที่ต้องไม่ว่างและไม่เกิน 100 ตัวอักษร');

  const { rows: [a] } = await db.query(
    'INSERT INTO common_areas (name) VALUES ($1) RETURNING id, name, is_active', [name]);
  await audit(req, { eventType: 'property_common_area_create', resourceType: 'common_area', resourceId: a.id, result: 'success', detail: name });
  res.status(201).json(a);
});

router.patch('/property/common-areas/:id', requirePermission('property.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  if (typeof req.body.is_active !== 'boolean') throw new HttpError(400, 'ค่าสถานะไม่ถูกต้อง');

  const { rows: [a] } = await db.query(
    'UPDATE common_areas SET is_active = $1 WHERE id = $2 RETURNING id, name', [req.body.is_active, id]);
  if (!a) throw new HttpError(404, 'ไม่พบพื้นที่');
  await audit(req, { eventType: 'property_common_area_update', resourceType: 'common_area', resourceId: id, result: 'success', detail: `${a.name} is_active=${req.body.is_active}` });
  res.json({ ok: true });
});

// ===== Log =====
// GET /api/admin/logs/event-types — ประเภทเหตุการณ์ที่มีใน Log จริง ใช้ทำตัวเลือกในช่องกรอง
router.get('/logs/event-types', requirePermission('log.read'), async (req, res) => {
  const { rows } = await db.query('SELECT DISTINCT event_type FROM logs ORDER BY event_type');
  res.json(rows.map((r) => r.event_type));
});

// GET /api/admin/logs — ดู Log ย้อนหลัง (สิทธิ์ log.read) กรองได้ตาม: ช่วงเวลา (from/to), ผู้ใช้, ประเภทเหตุการณ์, ผลลัพธ์
// ผู้ใช้: user = คำค้นบางส่วนของชื่อบัญชี/ชื่อจริง/ชื่อที่พยายามล็อกอิน (รองรับผู้ใช้หลักร้อยคน ไม่ต้องเลื่อนหาในรายการ)
//         user_id = ระบุคนเดียว (ใช้ตอนคลิกชื่อในตาราง)
// ทุกเงื่อนไขใช้ Parameterized Query และแบ่งหน้า (page/limit สูงสุด 200 แถว) ตอบ { rows, page, limit, has_more }
router.get('/logs', requirePermission('log.read'), async (req, res) => {
  const { from, to, user_id, user, event_type, result } = req.query;
  const params = [];
  const push = (value) => { params.push(value); return `$${params.length}`; };
  const conds = [];

  if (from) {
    const d = new Date(from);
    if (isNaN(d)) throw new HttpError(400, 'รูปแบบวันที่เริ่มต้นไม่ถูกต้อง');
    conds.push(`l.occurred_at >= ${push(d)}`);
  }
  if (to) {
    const d = new Date(to);
    if (isNaN(d)) throw new HttpError(400, 'รูปแบบวันที่สิ้นสุดไม่ถูกต้อง');
    conds.push(`l.occurred_at <= ${push(d)}`);
  }
  if (user_id) conds.push(`l.user_id = ${push(parseId(user_id))}`);
  if (user) {
    // ILIKE + escape อักขระ % _ \ ที่ผู้ใช้พิมพ์ ให้ค้นเป็นข้อความธรรมดา
    const ref = push(`%${String(user).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    conds.push(`(u.username ILIKE ${ref} OR u.name ILIKE ${ref} OR l.username_attempted ILIKE ${ref})`);
  }
  if (event_type) conds.push(`l.event_type = ${push(String(event_type))}`);
  if (result) conds.push(`l.result = ${push(String(result))}`);

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  // ดึงเกินมา 1 แถว (limit + 1) เพื่อรู้ว่ามีหน้าถัดไปไหม แล้วตัดออกก่อนส่ง
  const limitRef = push(limit + 1);
  const offsetRef = push((page - 1) * limit);

  const { rows } = await db.query(
    `SELECT l.id, l.occurred_at, l.user_id, u.username, u.name AS user_name, l.username_attempted,
            l.event_type, l.resource_type, l.resource_id, l.result, l.ip, l.detail
     FROM logs l LEFT JOIN users u ON u.id = l.user_id
     ${where}
     ORDER BY l.occurred_at DESC, l.id DESC
     LIMIT ${limitRef} OFFSET ${offsetRef}`,
    params
  );
  res.json({ rows: rows.slice(0, limit), page, limit, has_more: rows.length > limit });
});

module.exports = router;