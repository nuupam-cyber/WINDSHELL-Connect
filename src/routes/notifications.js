const { Router } = require('express');
const db = require('../db');

const router = Router();

const LABEL = {
  pending: 'รอพิจารณา', assigned: 'มอบหมายแล้ว', in_progress: 'กำลังดำเนินการ',
  done: 'เสร็จสิ้น', closed: 'ปิดเรื่อง', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก',
};

// การแจ้งเตือนของผู้ใช้: สถานะที่เปลี่ยนในเรื่องที่ตนเกี่ยวข้อง และประกาศที่ยังใช้งานอยู่
router.get('/', async (req, res) => {
  const me = req.user.id;
  const { rows: [u] } = await db.query('SELECT notif_seen_at FROM users WHERE id = $1', [me]);
  const seen = new Date(u.notif_seen_at);

  const [history, notices] = await Promise.all([
    db.query(
      `SELECT h.changed_at AS at, h.to_status, r.id AS request_id, r.title
       FROM request_status_history h
       JOIN repair_requests r ON r.id = h.request_id
       WHERE (r.requester_id = $1 OR r.technician_id = $1) AND h.changed_by <> $1
       ORDER BY h.changed_at DESC
       LIMIT 20`, [me]),
    db.query(
      `SELECT id, title, created_at AS at
       FROM announcements
       WHERE is_active AND ends_at >= NOW()
       ORDER BY created_at DESC
       LIMIT 10`),
  ]);

  const items = [
    ...history.rows.map((h) => ({
      kind: 'status',
      requestId: h.request_id,
      title: `#${h.request_id} ${h.title}`,
      text: `สถานะเปลี่ยนเป็น ${LABEL[h.to_status]}`,
      at: h.at,
      isNew: new Date(h.at) > seen,
    })),
    ...notices.rows.map((a) => ({
      kind: 'announcement',
      requestId: null,
      title: 'ประกาศใหม่',
      text: a.title,
      at: a.at,
      isNew: new Date(a.at) > seen,
    })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 20);

  res.json({ unread: items.filter((i) => i.isNew).length, items });
});

// ทำเครื่องหมายว่าอ่านทั้งหมดแล้ว
router.post('/read', async (req, res) => {
  await db.query('UPDATE users SET notif_seen_at = NOW() WHERE id = $1', [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;