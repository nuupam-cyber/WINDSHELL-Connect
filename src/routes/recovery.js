// ลืมรหัสผ่าน: ส่งรหัส OTP 6 หลักทางอีเมล แล้วตั้งรหัสผ่านใหม่
// ต้องตั้งค่าบน Render: BREVO_API_KEY และ MAIL_FROM (อีเมลผู้ส่งที่ยืนยันกับ Brevo แล้ว)
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const db = require('../db');
const { HttpError } = require('../middleware/errorHandler');

const router = express.Router();
const SECRET = () => process.env.REF_SECRET || process.env.SESSION_SECRET || 'default_secret_key';
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_15_MIN = 3;

const hashCode = (code, userId) =>
  crypto.createHash('sha256').update(`${code}:${userId}:${SECRET()}`).digest('hex');

// จำกัดจำนวนคำขอต่อ IP (ในหน่วยความจำ)
const hits = new Map();
function ipLimit(req, max = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const arr = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(req.ip, arr);
  if (hits.size > 2000) hits.clear();
  if (arr.length > max) throw new HttpError(429, 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
}

async function sendMail(to, subject, html) {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    console.warn('ยังไม่ได้ตั้งค่า BREVO_API_KEY / MAIL_FROM จึงส่งอีเมลไม่ได้');
    return false;
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'WINDSHELL Connect', email: from },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    console.error('ส่งอีเมลไม่สำเร็จ:', res.status, await res.text().catch(() => ''));
    return false;
  }
  return true;
}

const findUser = async (identifier) => {
  const id = String(identifier || '').trim().toLowerCase();
  if (!id) return null;
  const { rows: [u] } = await db.query(
    `SELECT id, name, email FROM users
     WHERE is_active AND email IS NOT NULL AND (lower(username) = $1 OR lower(email) = $1)
     LIMIT 1`, [id]);
  return u || null;
};

// ขอรหัส OTP (ตอบเหมือนกันเสมอ เพื่อไม่บอกว่ามีบัญชีนี้หรือไม่)
router.post('/request', async (req, res) => {
  ipLimit(req);
  const u = await findUser(req.body.identifier);
  if (u) {
    const { rows: [c] } = await db.query(
      `SELECT count(*)::int AS n FROM password_resets
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '15 minutes'`, [u.id]);
    if (c.n < MAX_CODES_PER_15_MIN) {
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      await db.query('UPDATE password_resets SET used = true WHERE user_id = $1 AND NOT used', [u.id]);
      await db.query(
        `INSERT INTO password_resets (user_id, code_hash, expires_at)
         VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
        [u.id, hashCode(code, u.id), String(CODE_TTL_MIN)]);
      const sent = await sendMail(u.email, 'รหัสยืนยันสำหรับตั้งรหัสผ่านใหม่ - WINDSHELL Connect', `
        <p>สวัสดี ${u.name.replace(/[<>&]/g, '')}</p>
        <p>รหัสยืนยันของคุณคือ</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
        <p>รหัสนี้ใช้ได้ ${CODE_TTL_MIN} นาที หากคุณไม่ได้ขอ ไม่ต้องทำอะไร และไม่ควรบอกรหัสนี้กับใคร</p>`);
      if (!sent && process.env.NODE_ENV !== 'production') console.log(`[DEV] OTP ของ ${u.email}: ${code}`);
    }
  }
  res.json({ ok: true });
});

// ยืนยันรหัส + ตั้งรหัสผ่านใหม่
router.post('/confirm', async (req, res) => {
  ipLimit(req, 20);
  const { identifier, code, new_password } = req.body || {};
  if (typeof new_password !== 'string' || new_password.length < 8) {
    throw new HttpError(400, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
  }
  const fail = () => new HttpError(400, 'รหัสไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่');
  const u = await findUser(identifier);
  if (!u || !/^\d{6}$/.test(String(code || ''))) throw fail();

  const { rows: [r] } = await db.query(
    `UPDATE password_resets SET attempts = attempts + 1
     WHERE id = (SELECT id FROM password_resets
                 WHERE user_id = $1 AND NOT used AND expires_at > NOW() AND attempts < $2
                 ORDER BY created_at DESC LIMIT 1)
     RETURNING id, code_hash`, [u.id, MAX_ATTEMPTS]);
  if (!r) throw fail();

  const a = Buffer.from(r.code_hash, 'hex');
  const b = Buffer.from(hashCode(String(code), u.id), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw fail();

  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(new_password, 12), u.id]);
  await db.query('UPDATE password_resets SET used = true WHERE user_id = $1', [u.id]);
  // ออกจากระบบทุกอุปกรณ์ที่เคยเข้าสู่ระบบไว้
  await db.query(`DELETE FROM session WHERE (sess->>'userId')::text = $1`, [String(u.id)]).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;