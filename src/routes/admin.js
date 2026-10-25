const bcrypt = require('bcrypt');
const { Router } = require('express');
const db = require('../db');
const { withTransaction } = db;
const { audit } = require('../logger');
const { requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');
const { parseId } = require('../services/access');
const { CODE_PERMISSIONS, PROTECTED_ADMIN_PERMISSIONS } = require('../config/permissions');

const router = Router();

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,50}$/;
const ROLE_RE = /^[a-z][a-z_]{2,49}$/;
// ชื่อสิทธิ์รูปแบบ resource.action เช่น equipment.read
const PERM_RE = /^[a-z]+(\.[a-z_]+)+$/;

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) {
    throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  }
}

const optText = (v) => (v ? String(v).trim() : null);

// ===== ผู้ใช้ =====
router.get('/users', requirePermission('user.manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.name, u.role_id, r.name AS role,
            u.department_id, d.name AS department, u.is_active
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN departments d ON d.id = u.department_id
     ORDER BY u.id`
  );
  res.json(rows);
});

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

  const detail = await withTransaction(async (client) => {
    const { rows: [cur] } = await client.query(
      `SELECT u.*, r.name AS role_name FROM users u
       JOIN roles r ON r.id = u.role_id WHERE u.id = $1 FOR UPDATE OF u`, [id]);
    if (!cur) throw new HttpError(404, 'ไม่พบผู้ใช้');

    const roleId = b.role_id !== undefined ? parseId(b.role_id) : cur.role_id;
    const { rows: [role] } = await client.query('SELECT id, name FROM roles WHERE id = $1', [roleId]);
    if (!role) throw new HttpError(400, 'ไม่พบ Role');

    const name = b.name !== undefined ? String(b.name).trim() : cur.name;
    if (!name) throw new HttpError(400, 'กรุณาระบุชื่อ');
    const deptId = b.department_id !== undefined ? b.department_id : cur.department_id;
    const isActive = b.is_active !== undefined ? Boolean(b.is_active) : cur.is_active;

    let hash = null;
    if (b.password !== undefined) {
      checkPassword(b.password);
      hash = await bcrypt.hash(b.password, 12);
    }

    // ป้องกันไม่ให้ไม่มี Admin เหลือ
    const losesAdmin = cur.role_name === 'admin' && (role.name !== 'admin' || !isActive);
    if (losesAdmin) {
      const { rows: [{ count }] } = await client.query(
        `SELECT COUNT(*)::int AS count FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'admin' AND u.is_active AND u.id <> $1`, [id]);
      if (count === 0) throw new HttpError(409, 'ต้องมี Admin ที่ใช้งานได้อย่างน้อย 1 คน');
    }

    await client.query(
      `UPDATE users SET name = $1, role_id = $2, department_id = $3, is_active = $4,
              password_hash = COALESCE($5, password_hash)
       WHERE id = $6`,
      [name, role.id, deptId, isActive, hash, id]
    );
    return `role ${cur.role_name}->${role.name}, active ${cur.is_active}->${isActive}${hash ? ', password changed' : ''}`;
  });

  await audit(req, { eventType: 'user_update', resourceType: 'user', resourceId: id, result: 'success', detail });
  res.json({ ok: true });
});

router.get('/departments', requirePermission('user.manage'), async (req, res) => {
  const { rows } = await db.query('SELECT id, name FROM departments ORDER BY id');
  res.json(rows);
});

// ===== Role =====
router.get('/roles', requirePermission('role.manage'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.id, r.name, r.description, COUNT(u.id)::int AS user_count
     FROM roles r LEFT JOIN users u ON u.role_id = r.id
     GROUP BY r.id ORDER BY r.id`);
  res.json(rows);
});

router.post('/roles', requirePermission('role.manage'), async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!ROLE_RE.test(name)) throw new HttpError(400, 'ชื่อ Role ใช้ a-z และ _ ความยาว 3-50 ตัวอักษร');
  const { rows: [role] } = await db.query(
    'INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING *', [name, optText(req.body.description)]);
  await audit(req, { eventType: 'role_create', resourceType: 'role', resourceId: role.id, result: 'success', detail: name });
  res.status(201).json(role);
});

router.patch('/roles/:id', requirePermission('role.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [cur] } = await db.query('SELECT * FROM roles WHERE id = $1', [id]);
  if (!cur) throw new HttpError(404, 'ไม่พบ Role');

  const name = req.body.name !== undefined ? String(req.body.name).trim() : cur.name;
  if (!ROLE_RE.test(name)) throw new HttpError(400, 'ชื่อ Role ไม่ถูกต้อง');
  if (cur.name === 'admin' && name !== 'admin') throw new HttpError(409, 'เปลี่ยนชื่อ Role admin ไม่ได้');
  const description = req.body.description !== undefined ? optText(req.body.description) : cur.description;

  const { rows: [role] } = await db.query(
    'UPDATE roles SET name = $1, description = $2 WHERE id = $3 RETURNING *', [name, description, id]);
  await audit(req, { eventType: 'role_update', resourceType: 'role', resourceId: id, result: 'success', detail: `${cur.name}->${name}` });
  res.json(role);
});

router.delete('/roles/:id', requirePermission('role.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [cur] } = await db.query('SELECT * FROM roles WHERE id = $1', [id]);
  if (!cur) throw new HttpError(404, 'ไม่พบ Role');
  if (cur.name === 'admin') throw new HttpError(409, 'ลบ Role admin ไม่ได้');

  const { rows: [{ count }] } = await db.query(
    'SELECT COUNT(*)::int AS count FROM users WHERE role_id = $1', [id]);
  if (count > 0) throw new HttpError(409, 'ยังมีผู้ใช้ที่ใช้ Role นี้อยู่');

  await db.query('DELETE FROM roles WHERE id = $1', [id]);
  await audit(req, { eventType: 'role_delete', resourceType: 'role', resourceId: id, result: 'success', detail: cur.name });
  res.json({ ok: true });
});

// ===== Permission =====
router.get('/permissions', requirePermission('permission.manage'), async (req, res) => {
  const { rows } = await db.query('SELECT id, name, description FROM permissions ORDER BY name');
  res.json(rows);
});

// หมายเหตุ: Permission ที่เพิ่มที่นี่จะป้องกันอะไรจริงก็ต่อเมื่อโค้ดตรวจด้วย requirePermission(name)
router.post('/permissions', requirePermission('permission.manage'), async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!PERM_RE.test(name)) throw new HttpError(400, 'ชื่อสิทธิ์รูปแบบ resource.action เช่น equipment.read');
  const { rows: [p] } = await db.query(
    'INSERT INTO permissions (name, description) VALUES ($1, $2) RETURNING *', [name, optText(req.body.description)]);
  await audit(req, { eventType: 'permission_create', resourceType: 'permission', resourceId: p.id, result: 'success', detail: name });
  res.status(201).json(p);
});

router.patch('/permissions/:id', requirePermission('permission.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [cur] } = await db.query('SELECT * FROM permissions WHERE id = $1', [id]);
  if (!cur) throw new HttpError(404, 'ไม่พบ Permission');

  const name = req.body.name !== undefined ? String(req.body.name).trim() : cur.name;
  if (!PERM_RE.test(name)) throw new HttpError(400, 'ชื่อสิทธิ์ไม่ถูกต้อง');
  if (name !== cur.name && CODE_PERMISSIONS.has(cur.name)) {
    throw new HttpError(409, 'แก้ชื่อสิทธิ์ที่ใช้ในโค้ดไม่ได้');
  }
  const description = req.body.description !== undefined ? optText(req.body.description) : cur.description;

  const { rows: [p] } = await db.query(
    'UPDATE permissions SET name = $1, description = $2 WHERE id = $3 RETURNING *', [name, description, id]);
  await audit(req, { eventType: 'permission_update', resourceType: 'permission', resourceId: id, result: 'success', detail: `${cur.name}->${name}` });
  res.json(p);
});

router.delete('/permissions/:id', requirePermission('permission.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [cur] } = await db.query('SELECT * FROM permissions WHERE id = $1', [id]);
  if (!cur) throw new HttpError(404, 'ไม่พบ Permission');
  if (CODE_PERMISSIONS.has(cur.name)) throw new HttpError(409, 'สิทธิ์นี้ถูกใช้ในโค้ด ลบไม่ได้');

  await db.query('DELETE FROM permissions WHERE id = $1', [id]);
  await audit(req, { eventType: 'permission_delete', resourceType: 'permission', resourceId: id, result: 'success', detail: cur.name });
  res.json({ ok: true });
});

// ===== ACL: Role x Permission =====
router.get('/acl', requirePermission('acl.manage'), async (req, res) => {
  const [roles, permissions, grants] = await Promise.all([
    db.query('SELECT id, name FROM roles ORDER BY id'),
    db.query('SELECT id, name FROM permissions ORDER BY name'),
    db.query('SELECT role_id, permission_id FROM role_permissions'),
  ]);
  res.json({ roles: roles.rows, permissions: permissions.rows, grants: grants.rows });
});

router.post('/acl', requirePermission('acl.manage'), async (req, res) => {
  const roleId = parseId(req.body.role_id);
  const permId = parseId(req.body.permission_id);
  await db.query(
    'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [roleId, permId]);
  await audit(req, { eventType: 'permission_grant', resourceType: 'role_permission', resourceId: roleId, result: 'success', detail: `permission_id=${permId}` });
  res.json({ ok: true });
});

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
  await audit(req, { eventType: 'permission_revoke', resourceType: 'role_permission', resourceId: roleId, result: 'success', detail: `${g.role} -/- ${g.permission}` });
  res.json({ ok: true });
});

// ===== ประเภทงาน =====
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
router.get('/logs', requirePermission('log.read'), async (req, res) => {
  const { from, to, user_id, event_type, result } = req.query;
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
  if (event_type) conds.push(`l.event_type = ${push(String(event_type))}`);
  if (result) conds.push(`l.result = ${push(String(result))}`);

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limitRef = push(limit);
  const offsetRef = push((page - 1) * limit);

  const { rows } = await db.query(
    `SELECT l.id, l.occurred_at, l.user_id, u.username, l.username_attempted,
            l.event_type, l.resource_type, l.resource_id, l.result, l.ip, l.detail
     FROM logs l LEFT JOIN users u ON u.id = l.user_id
     ${where}
     ORDER BY l.occurred_at DESC, l.id DESC
     LIMIT ${limitRef} OFFSET ${offsetRef}`,
    params
  );
  res.json(rows);
});

module.exports = router;