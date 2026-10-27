const { HttpError } = require('../middleware/errorHandler');

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'รหัสไม่ถูกต้อง');
  return id;
}

// ดูรายการได้เมื่อมีสิทธิ์ read ที่ตรงกับความสัมพันธ์ของตนกับรายการ
function canView(user, perms, r) {
  if (perms.has('request.read.all')) return true;
  if (perms.has('request.read.own') && r.requester_id === user.id) return true;
  if (perms.has('request.read.dept') && r.department_id === user.department_id) return true;
  if (perms.has('request.read.assigned') && r.technician_id === user.id) return true;
  return false;
}

// เงื่อนไขเจ้าของสำหรับการกระทำ เช่น ช่างทำได้เฉพาะงานของตน
function inScope(scope, user, perms, r) {
  if (perms.has('request.read.all')) return true;
  switch (scope) {
    case 'dept':       return r.department_id === user.department_id;
    case 'technician': return r.technician_id === user.id;
    case 'requester':  return r.requester_id === user.id;
    default:           return false;
  }
}

// SQL: ไฟล์ถูกอัปโหลดหลังการเปลี่ยนสถานะครั้งล่าสุดหรือไม่ (ใช้กับ alias a = attachments)
const STATUS_UNCHANGED_SQL = `a.created_at >= (SELECT MAX(h.changed_at) FROM request_status_history h WHERE h.request_id = a.request_id)`;

// ลบไฟล์แนบได้เมื่อ
// - มี attachment.delete: ไฟล์ของตน หรือมีสิทธิ์ดูทั้งหมด
// - หรือมี attachment.upload: เฉพาะไฟล์ที่ตนอัปโหลด และงานยังไม่เปลี่ยนสถานะหลังอัปโหลด (แนบผิดแล้วลบใหม่ได้)
function canDeleteAttachment(user, perms, a) {
  if (perms.has('attachment.delete') && (a.uploaded_by === user.id || perms.has('request.read.all'))) return true;
  return perms.has('attachment.upload') && a.uploaded_by === user.id && a.status_unchanged === true;
}

module.exports = { parseId, canView, inScope, canDeleteAttachment, STATUS_UNCHANGED_SQL };