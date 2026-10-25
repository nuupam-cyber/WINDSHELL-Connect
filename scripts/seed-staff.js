// สร้างเฉพาะบัญชีเจ้าหน้าที่ (ไม่รัน schema.sql / v2-v5.sql จึงไม่กระทบข้อมูลเดิม)
//
// วิธีใช้ (รันจากโฟลเดอร์ repair-system):
//   Windows PowerShell:  $env:SEED_PASSWORD='รหัสผ่านที่คุณตั้ง'; node scripts/seed-staff.js
//   Mac/Linux:           SEED_PASSWORD='รหัสผ่านที่คุณตั้ง' node scripts/seed-staff.js
//
// บัญชีที่มีอยู่แล้ว (username ซ้ำ) จะถูกข้าม ไม่ถูกเขียนทับ

try { require('dotenv').config(); } catch (e) {}

let bcrypt;
try { bcrypt = require('bcrypt'); }
catch (e) { bcrypt = require('bcryptjs'); }

const db = require('../src/db');

const PASSWORD = process.env.SEED_PASSWORD;

const STAFF = [
  // ผู้ดูแลระบบ
  { username: 'admin01', name: 'ผู้ดูแลระบบ', role: 'admin', dept: null },

  // ฝ่ายช่างอาคาร
  { username: 'head01', name: 'หัวหน้าช่างอาคาร', role: 'dept_head', dept: 'ช่างอาคาร' },
  { username: 'tech01', name: 'ช่างไฟฟ้า สมชาย', role: 'technician', dept: 'ช่างอาคาร' },
  { username: 'tech02', name: 'ช่างประปา สมหมาย', role: 'technician', dept: 'ช่างอาคาร' },
  { username: 'tech03', name: 'ช่างแอร์ สมปอง', role: 'technician', dept: 'ช่างอาคาร' },
  { username: 'tech04', name: 'ช่างดิจิทัล สมพร', role: 'technician', dept: 'ช่างอาคาร' },
  { username: 'tech05', name: 'ช่างประตูและกุญแจ สมใจ', role: 'technician', dept: 'ช่างอาคาร' },

  // ฝ่ายนิติบุคคล
  { username: 'head02', name: 'หัวหน้านิติบุคคล', role: 'dept_head', dept: 'นิติบุคคล' },
  { username: 'tech06', name: 'เจ้าหน้าที่ความสะอาด สมศรี', role: 'technician', dept: 'นิติบุคคล' },
  { username: 'tech07', name: 'เจ้าหน้าที่รักษาความปลอดภัย สมชัย', role: 'technician', dept: 'นิติบุคคล' },
  { username: 'tech08', name: 'เจ้าหน้าที่ธุรการ สมหญิง', role: 'technician', dept: 'นิติบุคคล' },
];

async function main() {
  if (!PASSWORD || PASSWORD.length < 8) {
    console.log('ต้องตั้ง SEED_PASSWORD (อย่างน้อย 8 ตัวอักษร) ก่อนรัน ดูวิธีใช้ที่ด้านบนของไฟล์');
    process.exit(1);
  }

  const hash = await bcrypt.hash(PASSWORD, 12);

  for (const u of STAFF) {
    const r = await db.query(
      `INSERT INTO users (username, password_hash, name, role_id, department_id, is_active)
       SELECT $1, $2, $3, r.id, d.id, true
       FROM roles r LEFT JOIN departments d ON d.name = $5::text
       WHERE r.name = $4
       ON CONFLICT (username) DO NOTHING`,
      [u.username, hash, u.name, u.role, u.dept]
    );
    console.log(`${u.username}: ${r.rowCount ? 'สร้างแล้ว' : 'ข้าม (มีอยู่แล้ว หรือหา role ไม่เจอ)'}`);
  }

  // แจ้งเตือนถ้าชื่อแผนกไม่ตรงกับในฐานข้อมูล
  const { rows } = await db.query(
    `SELECT username FROM users WHERE department_id IS NULL AND username <> 'admin01'
     AND username = ANY($1)`,
    [STAFF.filter((s) => s.dept).map((s) => s.username)]
  );
  if (rows.length) {
    console.log('\nคำเตือน: บัญชีเหล่านี้ไม่มีแผนก (ชื่อแผนกอาจไม่ตรงกับตาราง departments):',
      rows.map((x) => x.username).join(', '));
    console.log('เช็กด้วย: SELECT id, name FROM departments;');
  }

  await db.pool.end();
}

main().catch((err) => {
  console.error('ผิดพลาด:', err.message);
  process.exit(1);
});