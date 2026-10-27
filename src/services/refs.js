// =====================================================================
// src/services/refs.js — เลขที่คำร้องที่แสดงให้ผู้ใช้เห็น (เช่น WS-D3WY-TVJ4)
// สร้างจากเลข id ภายในด้วย HMAC + ความลับของระบบ จึงเดาลำดับหรือจำนวนคำร้องไม่ได้ และไม่ต้องเพิ่มคอลัมน์ในฐานข้อมูล
// เลข id เดิมยังใช้ภายใน API เหมือนเดิม
// =====================================================================
const crypto = require('crypto');

const REF_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ตัดตัวที่สับสน I L O 0 1
const secret = () => process.env.REF_SECRET || process.env.SESSION_SECRET || 'dev-only-secret';

function refCode(id) {
  const h = crypto.createHmac('sha256', secret()).update(`request:${id}`).digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += REF_CHARS[h[i] % REF_CHARS.length];
  return `WS-${out.slice(0, 4)}-${out.slice(4)}`;
}

// เติมฟิลด์ ref ให้ทุกคำร้องใน JSON ที่ตอบกลับ และแทน #id ในหัวข้อแจ้งเตือนด้วยเลขที่คำร้อง
function addRefs(body) {
  const one = (r) => {
    if (r && typeof r === 'object' && r.id != null && r.created_at && r.category !== undefined) r.ref = refCode(r.id);
    return r;
  };
  if (Array.isArray(body)) body.forEach(one);
  else if (body && typeof body === 'object') {
    one(body);
    if (Array.isArray(body.items)) {
      body.items.forEach((n) => {
        if (n && n.requestId != null) {
          n.ref = refCode(n.requestId);
          if (typeof n.title === 'string') n.title = n.title.replace(`#${n.requestId} `, `${n.ref} `);
        }
      });
    }
  }
  return body;
}

// withRefs: middleware ที่ห่อ res.json ให้ผ่าน addRefs ก่อนส่งออกไป (ใช้กับ /api/requests และ /api/notifications)
function withRefs(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(addRefs(body));
  next();
}

module.exports = { refCode, withRefs };
