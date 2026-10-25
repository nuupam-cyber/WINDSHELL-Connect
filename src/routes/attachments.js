const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const db = require('../db');
const { audit, deny } = require('../logger');
const { requirePermission } = require('../middleware/auth');
const { UPLOAD_DIR } = require('../middleware/upload');
const { HttpError } = require('../middleware/errorHandler');
const { parseId, canView } = require('../services/access');

const router = Router();

async function loadAttachment(id) {
  const { rows: [a] } = await db.query(
    `SELECT a.*, r.requester_id, r.department_id, r.technician_id
     FROM attachments a JOIN repair_requests r ON r.id = a.request_id
     WHERE a.id = $1`,
    [id]
  );
  return a;
}

// เปิดดูหรือดาวน์โหลด ผ่าน Route ที่ตรวจสิทธิ์ ไม่เปิด static folder
router.get('/:id', requirePermission('attachment.read'), async (req, res) => {
  const id = parseId(req.params.id);
  const a = await loadAttachment(id);
  if (!a || !canView(req.user, req.permissions, a)) {
    if (a) await deny(req, 'attachment', id, 'view');
    throw new HttpError(404, 'ไม่พบไฟล์');
  }

  await audit(req, { eventType: 'attachment_view', resourceType: 'attachment', resourceId: id, result: 'success' });

  const disposition = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Type', a.mime_type);
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(a.original_name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(path.join(UPLOAD_DIR, a.stored_name));
});

router.delete('/:id', requirePermission('attachment.delete'), async (req, res) => {
  const id = parseId(req.params.id);
  const a = await loadAttachment(id);
  if (!a || !canView(req.user, req.permissions, a)) {
    if (a) await deny(req, 'attachment', id, 'delete');
    throw new HttpError(404, 'ไม่พบไฟล์');
  }
  if (a.uploaded_by !== req.user.id && !req.permissions.has('request.read.all')) {
    await deny(req, 'attachment', id, 'delete: not uploader');
    throw new HttpError(403, 'ลบได้เฉพาะไฟล์ที่ตนอัปโหลด');
  }

  await db.query('DELETE FROM attachments WHERE id = $1', [id]);
  await fs.promises.unlink(path.join(UPLOAD_DIR, a.stored_name)).catch(() => {});
  await audit(req, { eventType: 'attachment_delete', resourceType: 'attachment', resourceId: id, result: 'success' });
  res.json({ ok: true });
});

module.exports = router;