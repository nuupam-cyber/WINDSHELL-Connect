require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('../src/db');

// รหัสผ่านทดสอบเท่านั้น ใช้เฉพาะเครื่องพัฒนา
const PASSWORD = process.env.SEED_PASSWORD || 'Test@12345';

const STAFF = [
  // ผู้ดูแลระบบ
  { username: 'admin01', name: 'ผู้ดูแลระบบ',          role: 'admin',     dept: null },

  // ฝ่ายช่างอาคาร
  { username: 'head01',  name: 'หัวหน้าช่างอาคาร',      role: 'dept_head', dept: 'ช่างอาคาร' },
  { username: 'tech01',  name: 'ช่างไฟฟ้า สมชาย',       role: 'technician', dept: 'ช่างอาคาร' },
  { username: 'tech02',  name: 'ช่างประปา สมหมาย',      role: 'technician', dept: 'ช่างอาคาร' },
  { username: 'tech03',  name: 'ช่างแอร์ สมปอง',        role: 'technician', dept: 'ช่างอาคาร' },
  { username: 'tech04',  name: 'ช่างลิฟต์ สมพร',        role: 'technician', dept: 'ช่างอาคาร' },
  { username: 'tech05',  name: 'ช่างประตูและกุญแจ สมใจ', role: 'technician', dept: 'ช่างอาคาร' },

  // ฝ่ายนิติบุคคล
  { username: 'head02',  name: 'หัวหน้านิติบุคคล',      role: 'dept_head', dept: 'นิติบุคคล' },
  { username: 'tech06',  name: 'เจ้าหน้าที่ความสะอาด สมศรี', role: 'technician', dept: 'นิติบุคคล' },
  { username: 'tech07',  name: 'เจ้าหน้าที่รักษาความปลอดภัย สมชัย', role: 'technician', dept: 'นิติบุคคล' },
  { username: 'tech08',  name: 'เจ้าหน้าที่ธุรการ สมหญิง', role: 'technician', dept: 'นิติบุคคล' },
];

// ไฟล์ SQL เรียงตามลำดับเวอร์ชัน รันซ้ำได้
const SQL_FILES = ['schema.sql', 'v2.sql', 'v3.sql', 'v4.sql', 'v5.sql'];

async function main() {
  for (const file of SQL_FILES) {
    await db.query(fs.readFileSync(path.join(__dirname, '../db', file), 'utf8'));
  }

  const hash = await bcrypt.hash(PASSWORD, 12);

  for (const u of STAFF) {
    await db.query(
      `INSERT INTO users (username, password_hash, name, role_id, department_id)
       SELECT $1, $2, $3, r.id, d.id
       FROM roles r LEFT JOIN departments d ON d.name = $5::text
       WHERE r.name = $4
       ON CONFLICT (username) DO NOTHING`,
      [u.username, hash, u.name, u.role, u.dept]
    );
  }

  // ลูกบ้านทดสอบ ผูกกับสัญญา CT-A-101
  const { rows: [c] } = await db.query(
    `SELECT id, unit_id FROM contracts WHERE contract_no = 'CT-A-101'`);
  const { rows: [u] } = await db.query(
    `INSERT INTO users (username, password_hash, name, role_id, unit_id)
     VALUES ('user01', $1, 'ลูกบ้านทดสอบ', (SELECT id FROM roles WHERE name = 'resident'), $2)
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
    [hash, c.unit_id]);
  await db.query(
    'UPDATE contracts SET registered_user_id = $1 WHERE id = $2 AND registered_user_id IS NULL',
    [u.id, c.id]);

  console.log('Database ready. Staff: admin01, head01, head02, tech01 | Resident: user01 (CT-A-101)');
  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});