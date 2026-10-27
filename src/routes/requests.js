const crypto = require('crypto');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const db = require('../db');
const { audit, deny } = require('../logger');
const { requirePermission } = require('../middleware/auth');
const { upload, detectType } = require('../middleware/upload');
const { HttpError } = require('../middleware/errorHandler');
const { parseId, canView, inScope } = require('../services/access');

const { withTransaction } = db;
const router = Router();

// แจ้งซ่อมพร้อมแนบไฟล์ในคำขอเดียว (สูงสุด 3 ไฟล์) ไฟล์เก็บในหน่วยความจำก่อน ตรวจแล้วค่อยเขียนลงดิสก์
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;
const MAX_CREATE_FILES = 3;
const createUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_CREATE_FILES },
}).array('files', MAX_CREATE_FILES);
function parseCreateUpload(req, res, next) {
  createUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'ไฟล์ใหญ่เกินกำหนด'));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new HttpError(400, `แนบได้สูงสุด ${MAX_CREATE_FILES} ไฟล์`));
    }
    next(err);
  });
}
// งานของฝ่ายนี้ต้องแนบรูปเสมอ (ฝ่ายอื่นแนบหรือไม่ก็ได้)
const PHOTO_REQUIRED_DEPARTMENT = 'ช่างอาคาร';

const PRIORITIES = ['normal', 'urgent'];
const LOCATION_TYPES = ['unit', 'common'];

const TRANSITIONS = {
  reject:   { from: ['pending'],     to: 'rejected',    permission: 'request.approve',       scope: 'dept',       noteRequired: true },
  assign:   { from: ['pending'],     to: 'assigned',    permission: 'request.assign',        scope: 'dept' },
  start:    { from: ['assigned'],    to: 'in_progress', permission: 'request.update_status', scope: 'technician' },
  complete: { from: ['in_progress'], to: 'done',        permission: 'request.update_status', scope: 'technician', noteRequired: true },
  confirm:  { from: ['done'],        to: 'closed',      permission: 'request.close',         scope: 'requester' },
  cancel:   { from: ['pending'],     to: 'cancelled',   permission: 'request.cancel.own',    scope: 'requester' },
};

// คำสั่ง SELECT กลางที่รวมชื่อประเภท สถานที่ และชื่อผู้เกี่ยวข้องไว้ให้แสดงผล
const BASE = `
  SELECT r.id, r.title, r.description, r.status, r.priority,
         r.requester_id, r.department_id, r.technician_id,
         r.created_at, r.updated_at,
         cat.name AS category,
         COALESCE(un.unit_no, ca.name) AS location,
         ru.name AS requester_name,
         t.name  AS technician_name
  FROM repair_requests r
  JOIN issue_categories cat ON cat.id = r.category_id
  LEFT JOIN units un ON un.id = r.unit_id
  LEFT JOIN common_areas ca ON ca.id = r.common_area_id
  JOIN users ru ON ru.id = r.requester_id
  LEFT JOIN users t ON t.id = r.technician_id`;

async function findTechnician(client, techId, departmentId) {
  const id = Number(techId);
  if (!Number.isInteger(id)) throw new HttpError(400, 'กรุณาระบุช่าง');
  const { rows: [t] } = await client.query(
    `SELECT u.id FROM users u JOIN roles ro ON ro.id = u.role_id
     WHERE u.id = $1 AND ro.name = 'technician' AND u.is_active AND u.department_id = $2`,
    [id, departmentId]
  );
  if (!t) throw new HttpError(400, 'ไม่พบช่างที่ใช้งานได้ในฝ่ายนี้');
  return t.id;
}

// รายการที่มองเห็นได้ตามสิทธิ์
router.get('/', async (req, res) => {
  const { user, permissions: perms } = req;
  const params = [];
  const push = (value) => { params.push(value); return `$${params.length}`; };
  const clauses = [];

  if (!perms.has('request.read.all')) {
    const scope = [];
    if (perms.has('request.read.own'))      scope.push(`r.requester_id = ${push(user.id)}`);
    if (perms.has('request.read.dept'))     scope.push(`r.department_id = ${push(user.department_id)}`);
    if (perms.has('request.read.assigned')) scope.push(`r.technician_id = ${push(user.id)}`);
    if (!scope.length) throw new HttpError(403, 'ไม่มีสิทธิ์ดูรายการ');
    clauses.push(`(${scope.join(' OR ')})`);
  }
  if (req.query.status) clauses.push(`r.status = ${push(String(req.query.status))}`);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await db.query(`${BASE} ${where} ORDER BY r.created_at DESC LIMIT 200`, params);
  res.json(rows);
});

// รายชื่อช่างในฝ่ายของผู้มอบหมายงาน
router.get('/technicians', requirePermission('request.assign'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.name FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'technician' AND u.is_active AND u.department_id = $1
     ORDER BY u.name`,
    [req.user.department_id]
  );
  res.json(rows);
});

// ตัวเลือกสำหรับฟอร์มแจ้งซ่อม ลูกบ้านไม่ต้องพิมพ์เอง
router.get('/options', requirePermission('request.create'), async (req, res) => {
  const [categories, areas] = await Promise.all([
        db.query('SELECT id, name, requires_detail FROM issue_categories WHERE is_active ORDER BY id'),
    db.query('SELECT id, name FROM common_areas WHERE is_active ORDER BY id'),
  ]);
  const { rows: [unit] } = req.user.unit_id
    ? await db.query('SELECT id, unit_no FROM units WHERE id = $1', [req.user.unit_id])
    : { rows: [null] };
  res.json({ categories: categories.rows, commonAreas: areas.rows, unit: unit ?? null });
});

// แจ้งซ่อม: ตรวจทุกค่าจากฐานข้อมูล ไม่เชื่อค่าที่ส่งมาตรงๆ
router.post('/', requirePermission('request.create'), parseCreateUpload, async (req, res) => {
  const { user } = req;
  const b = req.body;

  if (!user.unit_id) throw new HttpError(400, 'บัญชีนี้ยังไม่ได้ผูกกับห้องชุด กรุณาติดต่อนิติบุคคล');
  const categoryId = parseId(b.category_id);
  if (!PRIORITIES.includes(b.priority)) throw new HttpError(400, 'ระดับความเร่งด่วนไม่ถูกต้อง');
  if (!LOCATION_TYPES.includes(b.location_type)) throw new HttpError(400, 'กรุณาเลือกสถานที่');
  const description = typeof b.description === 'string' ? (b.description.trim().slice(0, 1000) || null) : null;

    const { rows: [cat] } = await db.query(
    'SELECT id, name, department_id, requires_detail FROM issue_categories WHERE id = $1 AND is_active', [categoryId]);
  if (!cat) throw new HttpError(400, 'ประเภทงานไม่ถูกต้อง');
  if (cat.requires_detail && !description) throw new HttpError(400, 'ประเภทนี้ต้องกรอกรายละเอียด');

  // ตรวจไฟล์ฝั่ง Server: ต้องแนบถ้าเป็นงานช่างอาคาร และตรวจชนิดจากเนื้อไฟล์ทุกไฟล์ก่อนบันทึกอะไร
  const files = req.files || [];
  const { rows: [dept] } = await db.query('SELECT name FROM departments WHERE id = $1', [cat.department_id]);
  if (dept && dept.name === PHOTO_REQUIRED_DEPARTMENT && files.length === 0) {
    throw new HttpError(400, 'งานประเภทนี้ต้องแนบรูปอย่างน้อย 1 ไฟล์ เพื่อให้ช่างเห็นปัญหา');
  }
  if (files.length && !req.permissions.has('attachment.upload')) {
    await deny(req, 'repair_request', null, 'create with attachment');
    throw new HttpError(403, 'ไม่มีสิทธิ์อัปโหลดไฟล์');
  }
  const typed = files.map((f) => ({ file: f, type: detectType(f.buffer) }));
  if (typed.some((t) => !t.type)) {
    await audit(req, { eventType: 'attachment_upload', resourceType: 'repair_request', result: 'failure', detail: 'unsupported file type (create)' });
    throw new HttpError(415, 'รองรับเฉพาะไฟล์ JPG, PNG หรือ PDF');
  }

  let unitId = null;
  let areaId = null;
  let placeLabel;
  if (b.location_type === 'unit') {
    const { rows: [unit] } = await db.query('SELECT id, unit_no FROM units WHERE id = $1', [user.unit_id]);
    unitId = unit.id;
    placeLabel = unit.unit_no;
  } else {
    areaId = parseId(b.common_area_id);
    const { rows: [area] } = await db.query(
      'SELECT id, name FROM common_areas WHERE id = $1 AND is_active', [areaId]);
    if (!area) throw new HttpError(400, 'พื้นที่ส่วนกลางไม่ถูกต้อง');
    placeLabel = area.name;
  }

  const created = await withTransaction(async (client) => {
    const { rows: [r] } = await client.query(
      `INSERT INTO repair_requests
         (category_id, unit_id, common_area_id, priority, title, description, requester_id, department_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [cat.id, unitId, areaId, b.priority, `${cat.name} · ${placeLabel}`, description, user.id, cat.department_id]
    );
    await client.query(
      `INSERT INTO request_status_history (request_id, from_status, to_status, changed_by)
       VALUES ($1, NULL, 'pending', $2)`,
      [r.id, user.id]
    );
    for (const { file, type } of typed) {
      // เก็บเนื้อไฟล์ในฐานข้อมูล ดิสก์ของ Render ถูกล้างทุกครั้งที่ deploy
      await client.query(
        `INSERT INTO attachments (request_id, original_name, stored_name, mime_type, size_bytes, uploaded_by, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [r.id, path.basename(file.originalname).slice(0, 255), `${crypto.randomUUID()}${type.ext}`, type.mime, file.size, user.id, file.buffer]
      );
    }
    return r;
  });
  if (typed.length) {
    await audit(req, { eventType: 'attachment_upload', resourceType: 'repair_request', resourceId: created.id, result: 'success', detail: `${typed.length} file(s) at create` });
  }

  await audit(req, { eventType: 'request_create', resourceType: 'repair_request', resourceId: created.id, result: 'success' });
  res.status(201).json(created);
});

// สถิติสำหรับแดชบอร์ด ใช้ขอบเขตข้อมูลเดียวกับรายการ
router.get('/stats', requirePermission('dashboard.view'), async (req, res) => {
  const { user, permissions: perms } = req;
  const params = [];
  const clauses = [];

  if (!perms.has('request.read.all')) {
    const scope = [];
    if (perms.has('request.read.dept')) {
      params.push(user.department_id);
      scope.push(`r.department_id = $${params.length}`);
    }
    if (perms.has('request.read.assigned')) {
      params.push(user.id);
      scope.push(`r.technician_id = $${params.length}`);
    }
    if (!scope.length) throw new HttpError(403, 'ไม่มีสิทธิ์ดูแดชบอร์ด');
    clauses.push(`(${scope.join(' OR ')})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const [byStatus, byCategory, daily, urgent] = await Promise.all([
    db.query(`SELECT r.status, COUNT(*)::int AS n FROM repair_requests r ${where} GROUP BY r.status`, params),
    db.query(
      `SELECT cat.name, COUNT(*)::int AS n
       FROM repair_requests r JOIN issue_categories cat ON cat.id = r.category_id
       ${where} GROUP BY cat.name ORDER BY n DESC`, params),
    db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, COALESCE(c.n, 0)::int AS n
       FROM generate_series(CURRENT_DATE - 6, CURRENT_DATE, '1 day') d
       LEFT JOIN (
         SELECT DATE(r.created_at) AS day, COUNT(*) AS n
         FROM repair_requests r ${where} GROUP BY 1
       ) c ON c.day = d::date
       ORDER BY d`, params),
    db.query(
      `SELECT COUNT(*)::int AS n FROM repair_requests r
       ${where ? where + ' AND' : 'WHERE'} r.priority = 'urgent'
       AND r.status IN ('pending','assigned','in_progress')`, params),
  ]);

  res.json({
    byStatus: byStatus.rows,
    byCategory: byCategory.rows,
    daily: daily.rows,
    urgentOpen: urgent.rows[0].n,
  });
});

// รายละเอียด พร้อมประวัติสถานะและไฟล์แนบ
router.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [r] } = await db.query(`${BASE} WHERE r.id = $1`, [id]);
  if (!r || !canView(req.user, req.permissions, r)) {
    if (r) await deny(req, 'repair_request', id, 'view');
    throw new HttpError(404, 'ไม่พบรายการ');
  }

  const [history, attachments] = await Promise.all([
    db.query(
      `SELECT h.from_status, h.to_status, h.note, h.changed_at, u.name AS changed_by
       FROM request_status_history h JOIN users u ON u.id = h.changed_by
       WHERE h.request_id = $1 ORDER BY h.changed_at, h.id`, [id]),
    db.query(
      `SELECT id, original_name, mime_type, size_bytes, created_at
       FROM attachments WHERE request_id = $1 ORDER BY id`, [id]),
  ]);
  res.json({ ...r, history: history.rows, attachments: attachments.rows });
});

function uploadFile(req, res, next) {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      await audit(req, {
        eventType: 'attachment_upload', resourceType: 'repair_request',
        resourceId: Number(req.params.id) || null, result: 'failure', detail: err.code || 'upload error',
      });
      return next(err);
    }
    next();
  });
}

router.post('/:id/attachments', requirePermission('attachment.upload'), uploadFile, async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [r] } = await db.query('SELECT * FROM repair_requests WHERE id = $1', [id]);
  if (!r || !canView(req.user, req.permissions, r)) {
    if (r) await deny(req, 'repair_request', id, 'attachment upload');
    throw new HttpError(404, 'ไม่พบรายการ');
  }
  if (!req.file) throw new HttpError(400, 'กรุณาเลือกไฟล์');

  const type = detectType(req.file.buffer);
  if (!type) {
    await audit(req, {
      eventType: 'attachment_upload', resourceType: 'repair_request', resourceId: id,
      result: 'failure', detail: 'unsupported file type',
    });
    throw new HttpError(415, 'รองรับเฉพาะไฟล์ JPG, PNG หรือ PDF');
  }

  const storedName = `${crypto.randomUUID()}${type.ext}`;
  const originalName = path.basename(req.file.originalname).slice(0, 255);

  const { rows: [a] } = await db.query(
    `INSERT INTO attachments (request_id, original_name, stored_name, mime_type, size_bytes, uploaded_by, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, original_name, mime_type, size_bytes, created_at`,
    [id, originalName, storedName, type.mime, req.file.size, req.user.id, req.file.buffer]
  );
  await audit(req, {
    eventType: 'attachment_upload', resourceType: 'attachment', resourceId: a.id,
    result: 'success', detail: `request=${id}`,
  });
  res.status(201).json(a);
});

async function runTransition(req, res, action) {
  const rule = TRANSITIONS[action];
  const id = parseId(req.params.id);
  const note = typeof req.body.note === 'string' ? req.body.note.trim() || null : null;
  if (rule.noteRequired && !note) {
    throw new HttpError(400, action === 'complete' ? 'กรุณากรอกรายละเอียดงานที่ทำ' : 'กรุณาระบุเหตุผล');
  }
  if (note && note.length > 1000) throw new HttpError(400, 'รายละเอียดยาวเกิน 1000 ตัวอักษร');

  const updated = await withTransaction(async (client) => {
    const { rows: [r] } = await client.query('SELECT * FROM repair_requests WHERE id = $1 FOR UPDATE', [id]);
    if (!r || !canView(req.user, req.permissions, r)) throw new HttpError(404, 'ไม่พบรายการ');
    if (!inScope(rule.scope, req.user, req.permissions, r)) {
      await deny(req, 'repair_request', id, `action=${action}`);
      throw new HttpError(403, 'ไม่มีสิทธิ์ดำเนินการกับรายการนี้');
    }
    if (!rule.from.includes(r.status)) {
      throw new HttpError(409, `ไม่สามารถ ${action} ขณะสถานะเป็น ${r.status}`);
    }

    const technicianId = action === 'assign'
      ? await findTechnician(client, req.body.technician_id, r.department_id)
      : r.technician_id;

    const { rows: [u] } = await client.query(
      `UPDATE repair_requests SET status = $1, technician_id = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [rule.to, technicianId, id]
    );
    await client.query(
      `INSERT INTO request_status_history (request_id, from_status, to_status, changed_by, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, r.status, rule.to, req.user.id, note]
    );
    return u;
  });

  await audit(req, {
    eventType: 'request_status_change', resourceType: 'repair_request', resourceId: id,
    result: 'success', detail: `${action}: ${rule.to}`,
  });
  res.json(updated);
}

for (const [action, rule] of Object.entries(TRANSITIONS)) {
  router.post(`/:id/${action}`, requirePermission(rule.permission),
    (req, res) => runTransition(req, res, action));
}

// ลบเรื่องถาวร: เฉพาะเจ้าของเรื่อง และยังไม่ถูกมอบหมายงาน (ประวัติ ไฟล์แนบ ความคิดเห็น ลบตามด้วย CASCADE)
router.delete('/:id', requirePermission('request.cancel.own'), async (req, res) => {
  const id = parseId(req.params.id);
  await withTransaction(async (client) => {
    const { rows: [r] } = await client.query('SELECT * FROM repair_requests WHERE id = $1 FOR UPDATE', [id]);
    if (!r || !canView(req.user, req.permissions, r)) throw new HttpError(404, 'ไม่พบรายการ');
    if (r.requester_id !== req.user.id) {
      await deny(req, 'repair_request', id, 'delete: not requester');
      throw new HttpError(403, 'ลบได้เฉพาะเรื่องที่ตนแจ้ง');
    }
    if (r.status !== 'pending' || r.technician_id) {
      throw new HttpError(409, 'ลบไม่ได้ เพราะเรื่องนี้ถูกพิจารณาหรือมอบหมายงานแล้ว');
    }
    await client.query('DELETE FROM repair_requests WHERE id = $1', [id]);
  });
  await audit(req, { eventType: 'request_delete', resourceType: 'repair_request', resourceId: id, result: 'success' });
  res.json({ ok: true });
});

module.exports = router;