// =====================================================================
// scripts/reset-demo.js — รีเซ็ตการสาธิตเพิ่ม/ยกเลิก Permission (รันด้วย npm run demo:reset)
// ลบสิทธิ์ request.export ออกจากฐานข้อมูล ให้กลับไปสภาพ "ยังไม่ได้เพิ่ม"
// ใช้หลังแคปภาพทดสอบเสร็จ เพื่อสาธิตสดได้อีกครั้งตอนนำเสนอ
//
// ทำไมเป็นสคริปต์ ไม่เป็นปุ่มบนเว็บ: request.export อยู่ใน CODE_PERMISSIONS ซึ่งหน้าเว็บห้ามลบ
// ถ้ามีปุ่มลบบนเว็บจะเป็นช่องโหว่ข้ามกฎนี้ สคริปต์นี้รันได้เฉพาะคนที่มีค่า DATABASE_URL เท่านั้น
//
// วิธีใช้: ตั้ง DATABASE_URL ใน .env ให้ชี้ไปฐานข้อมูลที่ต้องการ แล้วรัน npm run demo:reset
// =====================================================================
require('dotenv').config();
const db = require('../src/db');

const DEMO_PERMISSION = 'request.export';

async function main() {
  // แถวใน role_permissions ถูกลบตามอัตโนมัติด้วย ON DELETE CASCADE (ถอนจากทุก Role)
  const { rows } = await db.query('DELETE FROM permissions WHERE name = $1 RETURNING id', [DEMO_PERMISSION]);
  if (!rows.length) {
    console.log(`ไม่มีสิทธิ์ ${DEMO_PERMISSION} ในฐานข้อมูลอยู่แล้ว พร้อมสาธิต`);
  } else {
    // บันทึก Log ไว้ด้วย เพื่อให้ตรวจย้อนหลังได้ว่ามีการรีเซ็ต (ไม่มีผู้ใช้ เพราะรันจากสคริปต์)
    await db.query(
      `INSERT INTO logs (event_type, resource_type, resource_id, result, detail)
       VALUES ('permission_delete', 'permission', $1, 'success', $2)`,
      [rows[0].id, `${DEMO_PERMISSION} (demo reset script)`]);
    console.log(`ลบสิทธิ์ ${DEMO_PERMISSION} แล้ว พร้อมสาธิตใหม่`);
  }
  await db.pool.end();
}

main().catch((err) => {
  console.error('ผิดพลาด:', err.message);
  process.exit(1);
});
