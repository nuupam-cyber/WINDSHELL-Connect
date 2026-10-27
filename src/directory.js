// src/routes/directory.js — รายชื่อเจ้าหน้าที่พร้อมตำแหน่ง ใช้แสดงผลในหน้าต่างๆ (ไม่รวมลูกบ้าน)
const { Router } = require('express');
const db = require('../db');

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.position
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.is_active AND r.name <> 'resident'
     ORDER BY u.name`);
  res.json(rows);
});

module.exports = router;