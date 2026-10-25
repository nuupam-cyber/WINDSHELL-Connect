const multer = require('multer');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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
  if (err.code === '23505') return res.status(409).json({ error: 'ข้อมูลซ้ำกับที่มีอยู่แล้ว' });
  if (err.code === '23503') return res.status(400).json({ error: 'ข้อมูลอ้างอิงไม่ถูกต้อง' });

  console.error(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
}

module.exports = { HttpError, errorHandler };