-- db/v2.sql — เพิ่ม: ประเภทงานที่บังคับกรอกรายละเอียด, สิทธิ์แดชบอร์ด, สิทธิ์จัดการประเภทงาน, ประเภทงานฝ่ายนิติบุคคล
-- ===== อัปเกรดเป็นเวอร์ชัน 2 รันซ้ำได้ ไม่ลบข้อมูลเดิม =====

-- ประเภทงานที่บังคับให้กรอกรายละเอียด
ALTER TABLE issue_categories ADD COLUMN IF NOT EXISTS requires_detail BOOLEAN NOT NULL DEFAULT FALSE;

-- สิทธิ์ใหม่
INSERT INTO permissions (name, description) VALUES
  ('dashboard.view',  'ดูแดชบอร์ด'),
  ('category.manage', 'จัดการประเภทงาน')
ON CONFLICT (name) DO NOTHING;

-- admin ได้ทุกสิทธิ์
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM (VALUES
  ('dept_head',  'dashboard.view'),
  ('technician', 'dashboard.view')
) AS m(role_name, perm_name)
JOIN roles r       ON r.name = m.role_name
JOIN permissions p ON p.name = m.perm_name
ON CONFLICT DO NOTHING;

-- เรื่องอื่นๆ ที่ต้องกรอกรายละเอียด
UPDATE issue_categories SET requires_detail = TRUE WHERE name = 'อื่นๆ';

INSERT INTO issue_categories (name, department_id, requires_detail)
SELECT v.name, d.id, v.req FROM (VALUES
  ('ความสะอาด',           'นิติบุคคล', FALSE),
  ('ความปลอดภัย/รปภ.',    'นิติบุคคล', TRUE),
  ('เสียงรบกวน',          'นิติบุคคล', TRUE),
  ('ขอเอกสาร/ข้อมูล',     'นิติบุคคล', TRUE),
  ('ร้องเรียนเพื่อนบ้าน', 'นิติบุคคล', TRUE)
) AS v(name, dept, req)
JOIN departments d ON d.name = v.dept
ON CONFLICT (name) DO NOTHING;