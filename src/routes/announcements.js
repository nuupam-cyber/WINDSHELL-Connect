// =====================================================================
// src/routes/announcements.js — ประกาศจากนิติบุคคล (path: /api/announcements)
// อ่าน: announcement.read (ทุก Role) | สร้าง/ยกเลิก: announcement.manage
// ยกเลิกได้เฉพาะประกาศที่ตนสร้าง (ตรวจเงื่อนไขเจ้าของข้อมูลฝั่ง server)
// =====================================================================
const { Router } = require('express');
const db = require('../db');
const { audit, deny } = require('../logger');
const { requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');
const { parseId } = require('../services/access');

const router = Router();
// ประเภทประกาศที่อนุญาต ค่าที่ส่งมาต้องอยู่ในรายการนี้เท่านั้น
const TYPES = ['elevator', 'maintenance', 'water', 'electric', 'aircon', 'general'];

// GET /api/announcements — ประกาศที่ยังใช้งานอยู่และยังไม่หมดเวลา เรียงตามเวลาเริ่ม
// mine = ผู้ใช้เป็นคนสร้างประกาศนี้ (หน้าเว็บใช้ตัดสินว่าจะแสดงปุ่ม "ยกเลิกประกาศ" ไหม)
router.get('/', requirePermission('announcement.read'), async (req, res) => {
  const { rows } = await db.query(
    `SELECT a.id, a.type, a.title, a.detail, a.starts_at, a.ends_at, u.name AS author,
            (a.created_by = $1) AS mine
     FROM announcements a JOIN users u ON u.id = a.created_by
     WHERE a.is_active AND a.ends_at >= NOW()
     ORDER BY a.starts_at
     LIMIT 30`, [req.user.id]);
  res.json(rows);
});

// POST /api/announcements — สร้างประกาศ ตรวจ: ประเภท, หัวข้อ, วันเวลาถูกต้อง, เวลาสิ้นสุดอยู่หลังเวลาเริ่ม
router.post('/', requirePermission('announcement.manage'), async (req, res) => {
  const b = req.body;
  if (!TYPES.includes(b.type)) throw new HttpError(400, 'ประเภทประกาศไม่ถูกต้อง');

  const title = String(b.title ?? '').trim();
  if (!title || title.length > 200) throw new HttpError(400, 'หัวข้อต้องไม่ว่างและไม่เกิน 200 ตัวอักษร');
  const detail = String(b.detail ?? '').trim().slice(0, 1000) || null;

  const starts = new Date(b.starts_at);
  const ends = new Date(b.ends_at);
  if (isNaN(starts) || isNaN(ends)) throw new HttpError(400, 'กรุณาระบุวันและเวลาให้ถูกต้อง');
  if (ends <= starts) throw new HttpError(400, 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
  if (ends < new Date()) throw new HttpError(400, 'เวลาสิ้นสุดต้องยังไม่ผ่านไป');

  const { rows: [a] } = await db.query(
    `INSERT INTO announcements (type, title, detail, starts_at, ends_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [b.type, title, detail, starts, ends, req.user.id]);

  await audit(req, {
    eventType: 'announcement_create', resourceType: 'announcement',
    resourceId: a.id, result: 'success', detail: title,
  });
  res.status(201).json(a);
});

// POST /api/announcements/:id/cancel — ไม่ลบจริง แค่ตั้ง is_active = FALSE (Soft delete) ประวัติยังอยู่
router.post('/:id/cancel', requirePermission('announcement.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [a] } = await db.query('SELECT created_by FROM announcements WHERE id = $1 AND is_active', [id]);
  if (!a) throw new HttpError(404, 'ไม่พบประกาศ');
  if (a.created_by !== req.user.id) {
    await deny(req, 'announcement', id, 'cancel: not creator');
    throw new HttpError(403, 'ยกเลิกได้เฉพาะผู้ที่สร้างประกาศนี้เท่านั้น');
  }
  await db.query('UPDATE announcements SET is_active = FALSE WHERE id = $1', [id]);

  await audit(req, {
    eventType: 'announcement_cancel', resourceType: 'announcement',
    resourceId: id, result: 'success',
  });
  res.json({ ok: true });
});

module.exports = router;