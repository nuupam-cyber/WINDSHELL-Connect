// =====================================================================
// src/middleware/errorHandler.js — การจัดการข้อผิดพลาดของทั้งระบบ
// HttpError: โยน error พร้อม status code เช่น throw new HttpError(403, 'ไม่มีสิทธิ์ดำเนินการนี้')
// errorHandler: ผูกไว้ท้ายสุดใน server.js แปลง error ทุกชนิดเป็น JSON { error: 'ข้อความ' } พร้อม status ที่เหมาะสม
// =====================================================================
const multer = require('multer');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Express รู้ว่าเป็น error handler เพราะรับ 4 พารามิเตอร์ (err, req, res, next)
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const send = (status, error) => res.status(status).json({ error });

  // error จาก multer (การอัปโหลดไฟล์) เช่น ไฟล์ใหญ่เกินกำหนด
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return send(413, 'ไฟล์มีขนาดเกิน 5 MB');
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return send(400, 'แนบได้คนละ 1 ไฟล์ต่อเรื่อง');
    return send(400, 'อัปโหลดไฟล์ไม่สำเร็จ');
  }
  if (err.type === 'entity.parse.failed') return send(400, 'รูปแบบข้อมูล JSON ไม่ถูกต้อง');
  if (err instanceof HttpError) return send(err.status, err.message);
  // รหัส error ของ PostgreSQL: 23505 = ค่าซ้ำกับ UNIQUE, 23503 = อ้างอิง Foreign Key ที่ไม่มีอยู่
  if (err.code === '23505') return send(409, 'ข้อมูลซ้ำกับที่มีอยู่แล้ว');
  if (err.code === '23503') return send(400, 'ข้อมูลอ้างอิงไม่ถูกต้อง');
  // error 4xx อื่นจากไลบรารี (เช่น body ใหญ่เกิน) ส่งข้อความเดิมได้
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) return send(err.status, err.message);

  // นอกนั้นคือ error ภายใน: บันทึกไว้ดูใน console แต่ไม่ส่งรายละเอียดให้ผู้ใช้ ป้องกันข้อมูลระบบรั่วไหล
  console.error('API Error:', err);
  send(500, 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์');
}

module.exports = { HttpError, errorHandler };
