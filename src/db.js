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

const query = (text, params) => pool.query(text, params);

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