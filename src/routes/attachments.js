// =====================================================================
// src/routes/attachments.js — เปิดดู / ดาวน์โหลด / ลบไฟล์แนบ (path: /api/attachments/:id)
// ไฟล์ไม่ได้เปิดเป็น URL สาธารณะ ทุกครั้งที่เปิดต้องผ่านการตรวจสิทธิ์ในไฟล์นี้
// (การอัปโหลดอยู่ใน routes/requests.js)
// =====================================================================
const { Router } = require('express');
const db = require('../db');
const { audit, deny } = require('../logger');
const { requirePermission } = require('../middleware/auth');
const { HttpError } = require('../middleware/errorHandler');
const { parseId, canView, canDeleteAttachment, STATUS_UNCHANGED_SQL } = require('../services/access');

const router = Router();

// loadAttachment: ดึงข้อมูลไฟล์พร้อมข้อมูลเจ้าของคำร้อง (ผู้แจ้ง, ฝ่าย, ช่าง) เพื่อใช้ตรวจสิทธิ์ด้วย canView
// withData: ดึงเนื้อไฟล์มาด้วย (ใช้ตอนเปิดดูเท่านั้น ตอนลบไม่ต้องโหลดไฟล์)
async function loadAttachment(id, withData = false) {
  const { rows: [a] } = await db.query(
    `SELECT a.id, a.request_id, a.original_name, a.mime_type, a.uploaded_by,
            ${STATUS_UNCHANGED_SQL} AS status_unchanged,
            ${withData ? 'a.data,' : ''} r.requester_id, r.department_id, r.technician_id
     FROM attachments a JOIN repair_requests r ON r.id = a.request_id
     WHERE a.id = $1`,
    [id]
  );
  return a;
}

// GET /api/attachments/:id — ด่านตรวจ: สิทธิ์ attachment.read → ต้องดูคำร้องที่ไฟล์นี้ผูกอยู่ได้ → ส่งไฟล์
// ?download=1 → ให้เบราว์เซอร์ดาวน์โหลด, ไม่ใส่ → เปิดดูในแท็บ
// nosniff: บังคับให้เบราว์เซอร์เชื่อ Content-Type ที่ server กำหนด ไม่เดาชนิดไฟล์เอง
router.get('/:id', requirePermission('attachment.read'), async (req, res) => {
  const id = parseId(req.params.id);
  const a = await loadAttachment(id, true);
  if (!a || !canView(req.user, req.permissions, a)) {
    if (a) await deny(req, 'attachment', id, 'view');
    throw new HttpError(404, 'ไม่พบไฟล์');
  }

  // ไฟล์ที่อัปโหลดก่อนย้ายมาเก็บในฐานข้อมูลไม่มีเนื้อไฟล์แล้ว (ดิสก์ของ Render ถูกล้างตอน deploy)
  if (!a.data) {
    return res.status(404).type('text/plain; charset=utf-8').send('ไม่พบเนื้อไฟล์นี้บนเซิร์ฟเวอร์ กรุณาแนบไฟล์ใหม่');
  }

  await audit(req, { eventType: 'attachment_view', resourceType: 'attachment', resourceId: id, result: 'success' });

  const disposition = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Type', a.mime_type);
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(a.data);
});

// DELETE /api/attachments/:id — ต้องมี attachment.delete หรือ attachment.upload แล้วตรวจกติกาละเอียดใน canDeleteAttachment (services/access.js)
// ลบแล้วบันทึก Log attachment_delete ถ้าไม่ผ่านบันทึก Log access_denied พร้อมเหตุผล
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!req.permissions.has('attachment.delete') && !req.permissions.has('attachment.upload')) {
    await deny(req, 'attachment', id, 'delete: no permission');
    throw new HttpError(403, 'ไม่มีสิทธิ์ลบไฟล์');
  }
  const a = await loadAttachment(id);
  if (!a || !canView(req.user, req.permissions, a)) {
    if (a) await deny(req, 'attachment', id, 'delete');
    throw new HttpError(404, 'ไม่พบไฟล์');
  }
  if (!canDeleteAttachment(req.user, req.permissions, a)) {
    await deny(req, 'attachment', id, a.uploaded_by === req.user.id ? 'delete: status changed' : 'delete: not uploader');
    throw new HttpError(403, a.uploaded_by === req.user.id
      ? 'ลบไม่ได้ เพราะสถานะงานเปลี่ยนไปแล้วหลังแนบไฟล์นี้ (ถ้ายังรอพิจารณา กด "ยกเลิกเพื่อแก้ไข" ก่อน)'
      : 'ลบได้เฉพาะไฟล์ที่ตนอัปโหลด');
  }

  await db.query('DELETE FROM attachments WHERE id = $1', [id]);
  await audit(req, { eventType: 'attachment_delete', resourceType: 'attachment', resourceId: id, result: 'success' });
  res.json({ ok: true });
});

module.exports = router;