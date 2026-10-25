-- ===== ประกาศล่วงหน้า รันซ้ำได้ ไม่ลบข้อมูลเดิม =====
CREATE TABLE IF NOT EXISTS announcements (
  id         SERIAL PRIMARY KEY,
  type       VARCHAR(20) NOT NULL
             CHECK (type IN ('elevator','maintenance','water','electric','aircon','general')),
  title      VARCHAR(200) NOT NULL,
  detail     TEXT,
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_announcements_ends ON announcements(ends_at);

INSERT INTO permissions (name, description) VALUES
  ('announcement.read',   'ดูประกาศ'),
  ('announcement.manage', 'สร้างและยกเลิกประกาศ')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('resident',   'announcement.read'),
  ('technician', 'announcement.read'),
  ('dept_head',  'announcement.read'),
  ('dept_head',  'announcement.manage')
) AS m(role_name, perm_name)
JOIN roles r       ON r.name = m.role_name
JOIN permissions p ON p.name = m.perm_name
ON CONFLICT DO NOTHING;