-- ===== สิทธิ์จัดการอาคาร ห้อง สัญญา และพื้นที่ส่วนกลาง รันซ้ำได้ =====
INSERT INTO permissions (name, description) VALUES
  ('property.manage', 'จัดการอาคาร ห้อง สัญญา และพื้นที่ส่วนกลาง')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;