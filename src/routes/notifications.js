// =====================================================================
// src/routes/notifications.js — กระดิ่งแจ้งเตือน (path: /api/notifications)
// ไม่มีตารางแจ้งเตือนแยก สร้างรายการสดจากประวัติสถานะ คำร้องที่รอพิจารณา และประกาศ
// "ยังไม่อ่าน" = เกิดหลังเวลา notif_seen_at ของผู้ใช้ (อัปเดตเมื่อกด "อ่านทั้งหมด")
// =====================================================================
const { Router } = require('express');
const db = require('../db');

const router = Router();

// แจ้งเฉพาะเหตุการณ์ที่ผู้ใช้ต้องรู้หรือต้องลงมือทำ
// ผู้แจ้ง: ได้ผู้รับผิดชอบ / ซ่อมเสร็จรอยืนยัน / ไม่อนุมัติ
// ผู้รับผิดชอบ: ได้รับมอบหมายงานใหม่ / ผู้แจ้งยืนยันปิดเรื่อง
function statusText(h, me) {
  if (h.technician_id === me && h.requester_id !== me) {
    return h.to_status === 'assigned' ? 'คุณได้รับมอบหมายงานใหม่' : 'ผู้แจ้งยืนยันปิดเรื่องแล้ว';
  }
  if (h.to_status === 'assigned') return `มอบหมายให้ ${h.technician_name || 'ผู้รับผิดชอบ'} แล้ว`;
  if (h.to_status === 'done') return 'ซ่อมเสร็จแล้ว กรุณาตรวจงานและกดยืนยันปิดเรื่อง';
  return `ไม่อนุมัติ${h.note ? `: ${h.note}` : ''}`;
}

// GET /api/notifications — คืน { unread: จำนวนที่ยังไม่อ่าน, items: รายการล่าสุดไม่เกิน 20 }
router.get('/', async (req, res) => {
  const me = req.user.id;
  const perms = req.permissions;
  const { rows: [u] } = await db.query('SELECT notif_seen_at FROM users WHERE id = $1', [me]);
  const seen = new Date(u.notif_seen_at);

  // ผู้มีสิทธิ์มอบหมายงาน: เรื่องใหม่ที่ยังรอพิจารณาในฝ่ายของตน (หายไปเองเมื่อพิจารณาแล้ว)
  const canAssign = perms.has('request.assign');
  const allDept = perms.has('request.read.all');

  // 3 แหล่งข้อมูล ดึงพร้อมกัน: ประวัติสถานะที่เกี่ยวกับฉัน (คนอื่นเป็นคนเปลี่ยน), เรื่องรอพิจารณา, ประกาศ
  const [history, pending, notices] = await Promise.all([
    db.query(
      `SELECT h.changed_at AS at, h.to_status, h.note, r.id AS request_id, r.title,
              r.requester_id, r.technician_id, t.name AS technician_name
       FROM request_status_history h
       JOIN repair_requests r ON r.id = h.request_id
       LEFT JOIN users t ON t.id = r.technician_id
       WHERE h.changed_by <> $1
         AND ((r.requester_id = $1 AND h.to_status IN ('assigned', 'done', 'rejected'))
           OR (r.technician_id = $1 AND h.to_status IN ('assigned', 'closed')))
       ORDER BY h.changed_at DESC
       LIMIT 20`, [me]),
    canAssign
      ? db.query(
        `SELECT r.id AS request_id, r.title, r.priority, r.created_at AS at
         FROM repair_requests r
         WHERE r.status = 'pending' AND r.requester_id <> $1
           AND ($2::boolean OR r.department_id = $3)
         ORDER BY r.created_at DESC
         LIMIT 10`, [me, allDept, req.user.department_id])
      : { rows: [] },
    perms.has('announcement.read')
      ? db.query(
        `SELECT id, title, created_at AS at
         FROM announcements
         WHERE is_active AND ends_at >= NOW()
         ORDER BY created_at DESC
         LIMIT 5`)
      : { rows: [] },
  ]);

  const items = [
    ...history.rows.map((h) => ({
      kind: 'status',
      requestId: h.request_id,
      title: `#${h.request_id} ${h.title}`,
      text: statusText(h, me),
      at: h.at,
      isNew: new Date(h.at) > seen,
    })),
    ...pending.rows.map((p) => ({
      kind: 'pending',
      requestId: p.request_id,
      title: `#${p.request_id} ${p.title}`,
      text: p.priority === 'urgent' ? 'เรื่องด่วนใหม่ รอพิจารณาและมอบหมาย' : 'เรื่องใหม่ รอพิจารณาและมอบหมาย',
      at: p.at,
      isNew: new Date(p.at) > seen,
    })),
    ...notices.rows.map((a) => ({
      kind: 'announcement',
      requestId: null,
      title: 'ประกาศจากนิติบุคคล',
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
// POST /api/notifications/read — กด "อ่านทั้งหมด" บันทึกเวลาที่อ่านล่าสุด
router.post('/read', async (req, res) => {
  await db.query('UPDATE users SET notif_seen_at = NOW() WHERE id = $1', [req.user.id]);
  res.json({ ok: true });
});

module.exports = router;