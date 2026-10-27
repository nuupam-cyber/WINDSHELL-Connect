// =====================================================================
// src/middleware/errorHandler.js — คลาส HttpError สำหรับโยน error พร้อม status code
// ตัวอย่าง: throw new HttpError(403, 'ไม่มีสิทธิ์ดำเนินการนี้') → ตัวจัดการ error จะตอบ 403 พร้อมข้อความนี้
// =====================================================================
const multer = require('multer');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// errorHandler: ตัวจัดการ error แบบแยกชนิด (ไฟล์ใหญ่เกิน, JSON ผิดรูปแบบ, ข้อมูลซ้ำ ฯลฯ)
// หมายเหตุ: ตอนนี้ server.js ใช้ Global Error Handler ของตัวเองท้ายไฟล์ ฟังก์ชันนี้ไม่ได้ถูก app.use อยู่
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      error: tooLarge ? 'ไฟล์มีขนาดเกินที่กำหนด' : 'อัปโหลดไฟล์ไม่สำเร็จ',
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'รูปแบบข้อมูล JSON ไม่ถูกต้อง' });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  // รหัส error ของ PostgreSQL: 23505 = ค่าซ้ำกับ UNIQUE, 23503 = อ้างอิง Foreign Key ที่ไม่มีอยู่
  if (err.code === '23505') return res.status(409).json({ error: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว' });
  if (err.code === '23503') return res.status(400).json({ error: 'ข้อมูลอ้างอิงไม่ถูกต้อง' });

  console.error(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
}

module.exports = { HttpError, errorHandler };