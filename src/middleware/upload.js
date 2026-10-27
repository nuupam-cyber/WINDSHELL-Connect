// =====================================================================
// src/middleware/upload.js — ตั้งค่าการรับไฟล์อัปโหลด (ใช้ไลบรารี multer)
// กติกา: รับเฉพาะ JPG, PNG, PDF ขนาดไม่เกิน 5 MB ต่อไฟล์ ตรวจทั้งหมดที่ฝั่ง server
// ตัวไฟล์เก็บในตาราง attachments คอลัมน์ data (ดู routes/requests.js) ส่วน UPLOAD_DIR ใช้อ่านไฟล์เก่าที่เคยเก็บบนดิสก์
// =====================================================================
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ตรวจชนิดไฟล์จาก Signature ของเนื้อไฟล์ ไม่เชื่อ mimetype หรือนามสกุลที่ Client ส่งมา
// "Magic number" คือไบต์แรกๆ ของไฟล์ที่บอกชนิดจริง เช่น JPG ขึ้นต้นด้วย FF D8 FF, PDF ขึ้นต้นด้วย "%PDF"
// แม้ผู้ใช้เปลี่ยนนามสกุล .exe เป็น .jpg ก็ตรวจจับได้ เพราะเนื้อไฟล์ไม่ตรง signature
const SIGNATURES = [
  { mime: 'image/jpeg', ext: '.jpg',
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'application/pdf', ext: '.pdf',
    test: (b) => b.subarray(0, 4).toString('latin1') === '%PDF' },
];

// detectType: คืนชนิดไฟล์ที่ตรงกับ signature หรือ undefined ถ้าไม่ใช่ชนิดที่อนุญาต
function detectType(buffer) {
  return SIGNATURES.find((s) => s.test(buffer));
}

// เก็บในหน่วยความจำก่อน ตรวจแล้วค่อยเขียนลงดิสก์ ไฟล์ที่ไม่ผ่านจะไม่ถูกบันทึก
// limits.fileSize: ไฟล์ใหญ่เกินจะถูก multer ปฏิเสธทันที (error LIMIT_FILE_SIZE) ก่อนถึงโค้ดของเรา
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

module.exports = { upload, detectType, UPLOAD_DIR };