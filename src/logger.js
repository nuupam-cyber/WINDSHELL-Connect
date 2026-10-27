// =====================================================================
// src/logger.js — บันทึก Log การใช้งานลงตาราง logs ใน PostgreSQL
// เก็บถาวรในฐานข้อมูล จึงยังดูย้อนหลังได้แม้ server เริ่มใหม่
// แต่ละแถวมี: วันเวลา, ผู้กระทำ/ชื่อบัญชีที่พยายามล็อกอิน, ประเภทเหตุการณ์, ทรัพยากร+รหัส, ผลลัพธ์, IP, รายละเอียด
// =====================================================================
const db = require('./db');

// writeLog: เขียน Log หนึ่งแถว ใช้ภายในไฟล์นี้ผ่าน audit()
async function writeLog({ userId = null, usernameAttempted = null, eventType, resourceType = null,
  resourceId = null, result, ip = null, detail = null }) {
  await db.query(
    `INSERT INTO logs (user_id, username_attempted, event_type, resource_type, resource_id, result, ip, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, usernameAttempted, eventType, resourceType, resourceId, result, ip, detail]
  );
}

// เติมข้อมูลผู้ใช้และ IP จาก request ให้อัตโนมัติ ห้ามใส่รหัสผ่านหรือ Session ID ใน detail
// audit(req, {...}): ใช้ใน Route ทั่วไป ดึงผู้ใช้และ IP จาก req ให้อัตโนมัติ
// ตัวอย่าง: audit(req, { eventType: 'request_create', resourceType: 'repair_request', resourceId: 5, result: 'success' })
function audit(req, fields) {
  return writeLog({
    userId: req.user?.id ?? req.session?.userId ?? null,
    usernameAttempted: req.user?.username ?? null,
    ip: req.ip,
    ...fields,
  });
}

// deny: บันทึกการเข้าถึงที่ถูกปฏิเสธ (result = 'denied') ใช้ทุกครั้งที่ตอบ 403 หรือไม่ผ่านเงื่อนไขเจ้าของข้อมูล
function deny(req, resourceType, resourceId, detail) {
  return audit(req, { eventType: 'access_denied', resourceType, resourceId, result: 'denied', detail });
}

module.exports = { audit, deny };