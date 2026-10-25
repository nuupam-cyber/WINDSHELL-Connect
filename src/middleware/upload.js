const fs = require('fs');
const path = require('path');
const multer = require('multer');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ตรวจชนิดไฟล์จาก Signature ของเนื้อไฟล์ ไม่เชื่อ mimetype หรือนามสกุลที่ Client ส่งมา
const SIGNATURES = [
  { mime: 'image/jpeg', ext: '.jpg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'application/pdf', ext: '.pdf',
    test: (b) => b.subarray(0, 4).toString('latin1') === '%PDF' },
];

function detectType(buffer) {
  return SIGNATURES.find((s) => s.test(buffer));
}

// เก็บในหน่วยความจำก่อน ตรวจแล้วค่อยเขียนลงดิสก์ ไฟล์ที่ไม่ผ่านจะไม่ถูกบันทึก
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

module.exports = { upload, detectType, UPLOAD_DIR };