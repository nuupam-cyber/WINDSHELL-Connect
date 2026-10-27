// =====================================================================
// src/db.js — การเชื่อมต่อ PostgreSQL (ใช้ไลบรารี pg)
// ทุกไฟล์ที่ต้องคุยกับฐานข้อมูลจะ require ไฟล์นี้
// ค่าการเชื่อมต่อมาจาก DATABASE_URL ใน .env / Environment (ไม่ฝังรหัสผ่านไว้ในโค้ด)
// =====================================================================
const { Pool } = require('pg');

// ใช้การเชื่อมต่อซ้ำ + keepAlive ลดเวลา handshake กับ Neon ในแต่ละคำขอ
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  keepAlive: true,
  idleTimeoutMillis: 5 * 60 * 1000,
  connectionTimeoutMillis: 15000,
});
pool.on('error', (e) => console.error('pg pool error:', e.message));

// query: รันคำสั่ง SQL หนึ่งคำสั่ง ใช้ $1, $2 ... แทนค่าที่ผู้ใช้ส่งมา (Parameterized Query) ป้องกัน SQL Injection
const query = (text, params) => pool.query(text, params);

// withTransaction: รันหลายคำสั่งให้เป็นก้อนเดียว (BEGIN ... COMMIT)
// ถ้าคำสั่งไหนพัง จะ ROLLBACK ยกเลิกทั้งหมด ข้อมูลไม่ค้างครึ่งๆ กลางๆ
// ตัวอย่าง: สร้างคำร้อง + บันทึกประวัติสถานะ + บันทึกไฟล์แนบ ต้องสำเร็จพร้อมกัน
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };