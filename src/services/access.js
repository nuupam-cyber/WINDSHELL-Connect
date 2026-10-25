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

module.exports = { parseId, canView, inScope };