// =====================================================================
// src/services/access.js — กติกาสิทธิ์ระดับ "เจ้าของข้อมูล" (Row-level)
// requirePermission ตอบแค่ว่า "ทำการนี้ได้ไหม" ไฟล์นี้ตอบว่า "ทำกับรายการนี้ได้ไหม"
// เช่น ลูกบ้านมี request.read.own แต่ดูได้เฉพาะเรื่องที่ตัวเองแจ้ง ไม่ใช่ของห้องอื่น
// =====================================================================
const { HttpError } = require('../middleware/errorHandler');

// parseId: แปลง id จาก URL เป็นตัวเลข ถ้าไม่ใช่จำนวนเต็มบวกตอบ 400 (ตรวจข้อมูลฝั่ง server)
function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'รหัสไม่ถูกต้อง');
  return id;
}

// ดูรายการได้เมื่อมีสิทธิ์ read ที่ตรงกับความสัมพันธ์ของตนกับรายการ
// read.all = Admin ดูทุกเรื่อง, read.own = ผู้แจ้ง, read.dept = หัวหน้าฝ่ายดูเรื่องในฝ่าย, read.assigned = ช่างดูงานที่ได้รับ
// ผ่านเงื่อนไขข้อใดข้อหนึ่งก็ดูได้
function canView(user, perms, r) {
  if (perms.has('request.read.all')) return true;
  if (perms.has('request.read.own') && r.requester_id === user.id) return true;
  if (perms.has('request.read.dept') && r.department_id === user.department_id) return true;
  if (perms.has('request.read.assigned') && r.technician_id === user.id) return true;
  return false;
}

// เงื่อนไขเจ้าของสำหรับการกระทำ เช่น ช่างทำได้เฉพาะงานของตน
// scope มาจากตาราง TRANSITIONS ใน routes/requests.js
// 'dept' = อนุมัติ/มอบหมายได้เฉพาะเรื่องในฝ่ายตน, 'technician' = เริ่ม/ปิดงานได้เฉพาะงานที่ได้รับมอบหมาย,
// 'requester' = ยกเลิกเพื่อแก้ไข/ยืนยันปิดได้เฉพาะเรื่องที่ตนแจ้ง
function inScope(scope, user, perms, r) {
  if (perms.has('request.read.all')) return true;
  switch (scope) {
    case 'dept':       return r.department_id === user.department_id;
    case 'technician': return r.technician_id === user.id;
    case 'requester':  return r.requester_id === user.id;
    default:           return false;
  }
}

// SQL: ไฟล์นี้ยังลบได้ตามกติกาสถานะหรือไม่ (ใช้กับ alias a = attachments) จริงเมื่อ
// - เรื่องอยู่ในสถานะ cancelled (ผู้แจ้งยกเลิกเพื่อแก้ไข จึงลบไฟล์ที่แนบผิดแล้วแนบใหม่ได้ก่อนส่งอีกครั้ง) หรือ
// - ไฟล์ถูกอัปโหลดหลังการเปลี่ยนสถานะครั้งล่าสุด
const STATUS_UNCHANGED_SQL = `((SELECT rr.status FROM repair_requests rr WHERE rr.id = a.request_id) = 'cancelled'
  OR a.created_at >= (SELECT MAX(h.changed_at) FROM request_status_history h WHERE h.request_id = a.request_id))`;

// ลบไฟล์แนบได้เมื่อ
// - มี attachment.delete: ไฟล์ของตน หรือมีสิทธิ์ดูทั้งหมด
// - หรือมี attachment.upload: เฉพาะไฟล์ที่ตนอัปโหลด และงานยังไม่เปลี่ยนสถานะหลังอัปโหลด หรืออยู่ระหว่างยกเลิกเพื่อแก้ไข
function canDeleteAttachment(user, perms, a) {
  if (perms.has('attachment.delete') && (a.uploaded_by === user.id || perms.has('request.read.all'))) return true;
  return perms.has('attachment.upload') && a.uploaded_by === user.id && a.status_unchanged === true;
}

module.exports = { parseId, canView, inScope, canDeleteAttachment, STATUS_UNCHANGED_SQL };