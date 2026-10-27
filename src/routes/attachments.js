const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const db = require('../db');
const { audit, deny } = require('../logger');
const { requirePermission } = require('../middleware/auth');
const { UPLOAD_DIR } = require('../middleware/upload');
const { HttpError } = require('../middleware/errorHandler');
const { parseId, canView, canDeleteAttachment, STATUS_UNCHANGED_SQL } = require('../services/access');

const router = Router();

// withData: ดึงเนื้อไฟล์มาด้วย (ใช้ตอนเปิดดูเท่านั้น)
async function loadAttachment(id, withData = false) {
  const { rows: [a] } = await db.query(
    `SELECT a.id, a.request_id, a.original_name, a.stored_name, a.mime_type, a.uploaded_by,
            ${STATUS_UNCHANGED_SQL} AS status_unchanged,
            ${withData ? 'a.data,' : ''} r.requester_id, r.department_id, r.technician_id
     FROM attachments a JOIN repair_requests r ON r.id = a.request_id
     WHERE a.id = $1`,
    [id]
  );
  return a;
}

// เปิดดูหรือดาวน์โหลด ผ่าน Route ที่ตรวจสิทธิ์ ไม่เปิด static folder
router.get('/:id', requirePermission('attachment.read'), async (req, res) => {
  const id = parseId(req.params.id);
  const a = await loadAttachment(id, true);
  if (!a || !canView(req.user, req.permissions, a)) {
    if (a) await deny(req, 'attachment', id, 'view');
    throw new HttpError(404, 'ไม่พบไฟล์');
  }

  await audit(req, { eventType: 'attachment_view', resourceType: 'attachment', resourceId: id, result: 'success' });

  const disposition = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Type', a.mime_type);
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (a.data) return res.send(a.data);

  // ไฟล์เก่าที่เคยเก็บบนดิสก์ อาจหายไปแล้วหลัง deploy
  const file = path.join(UPLOAD_DIR, a.stored_name);
  if (fs.existsSync(file)) return res.sendFile(file);
  res.removeHeader('Content-Disposition');
  res.status(404).type('text/plain; charset=utf-8')
    .send('ไฟล์นี้ไม่อยู่บนเซิร์ฟเวอร์แล้ว (อัปโหลดก่อนย้ายมาเก็บในฐานข้อมูล) กรุณาแนบไฟล์ใหม่');
});

// ลบไฟล์: ต้องมี attachment.delete หรือ attachment.upload แล้วตรวจเงื่อนไขละเอียดใน canDeleteAttachment
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
      ? 'ลบไม่ได้ เพราะสถานะงานเปลี่ยนไปแล้วหลังแนบไฟล์นี้'
      : 'ลบได้เฉพาะไฟล์ที่ตนอัปโหลด');
  }

  await db.query('DELETE FROM attachments WHERE id = $1', [id]);
  await fs.promises.unlink(path.join(UPLOAD_DIR, a.stored_name)).catch(() => {});
  await audit(req, { eventType: 'attachment_delete', resourceType: 'attachment', resourceId: id, result: 'success' });
  res.json({ ok: true });
});

module.exports = router;