const db = require('./db');

async function writeLog({ userId = null, usernameAttempted = null, eventType, resourceType = null,
  resourceId = null, result, ip = null, detail = null }) {
  await db.query(
    `INSERT INTO logs (user_id, username_attempted, event_type, resource_type, resource_id, result, ip, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, usernameAttempted, eventType, resourceType, resourceId, result, ip, detail]
  );
}

// เติมข้อมูลผู้ใช้และ IP จาก request ให้อัตโนมัติ ห้ามใส่รหัสผ่านหรือ Session ID ใน detail
function audit(req, fields) {
  return writeLog({
    userId: req.user?.id ?? req.session?.userId ?? null,
    usernameAttempted: req.user?.username ?? null,
    ip: req.ip,
    ...fields,
  });
}

function deny(req, resourceType, resourceId, detail) {
  return audit(req, { eventType: 'access_denied', resourceType, resourceId, result: 'denied', detail });
}

module.exports = { writeLog, audit, deny };