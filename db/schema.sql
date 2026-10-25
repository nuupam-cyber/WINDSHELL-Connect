-- ==== ตาราง ====
CREATE TABLE IF NOT EXISTS departments (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS buildings (
  id   SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id          SERIAL PRIMARY KEY,
  building_id INT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  floor       INT NOT NULL,
  unit_no     VARCHAR(20) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  role_id       INT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  department_id INT REFERENCES departments(id) ON DELETE SET NULL,
  unit_id       INT REFERENCES units(id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- สัญญาเชื่อมห้องกับลูกบ้าน ลูกบ้านสมัครได้ด้วยสัญญาที่ยังไม่เคยถูกใช้
CREATE TABLE IF NOT EXISTS contracts (
  id                 SERIAL PRIMARY KEY,
  contract_no        VARCHAR(30) NOT NULL UNIQUE,
  unit_id            INT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  registered_user_id INT UNIQUE REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS common_areas (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(100) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS issue_categories (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL UNIQUE,
  department_id INT NOT NULL REFERENCES departments(id),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS repair_requests (
  id             SERIAL PRIMARY KEY,
  category_id    INT NOT NULL REFERENCES issue_categories(id),
  unit_id        INT REFERENCES units(id),
  common_area_id INT REFERENCES common_areas(id),
  priority       VARCHAR(10) NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  title          VARCHAR(200) NOT NULL,
  description    TEXT,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','assigned','in_progress','done','closed','rejected','cancelled')),
  requester_id   INT NOT NULL REFERENCES users(id),
  department_id  INT NOT NULL REFERENCES departments(id),
  technician_id  INT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- ต้องระบุสถานที่เพียงหนึ่งอย่าง คือห้องหรือพื้นที่ส่วนกลาง
  CHECK ((unit_id IS NULL) <> (common_area_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_requests_requester  ON repair_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_requests_department ON repair_requests(department_id);
CREATE INDEX IF NOT EXISTS idx_requests_technician ON repair_requests(technician_id);

CREATE TABLE IF NOT EXISTS request_status_history (
  id          SERIAL PRIMARY KEY,
  request_id  INT NOT NULL REFERENCES repair_requests(id) ON DELETE CASCADE,
  from_status VARCHAR(20),
  to_status   VARCHAR(20) NOT NULL,
  changed_by  INT NOT NULL REFERENCES users(id),
  note        TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attachments (
  id            SERIAL PRIMARY KEY,
  request_id    INT NOT NULL REFERENCES repair_requests(id) ON DELETE CASCADE,
  original_name VARCHAR(255) NOT NULL,
  stored_name   VARCHAR(100) NOT NULL UNIQUE,
  mime_type     VARCHAR(50) NOT NULL,
  size_bytes    INT NOT NULL CHECK (size_bytes > 0),
  uploaded_by   INT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS logs (
  id                 BIGSERIAL PRIMARY KEY,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id            INT REFERENCES users(id) ON DELETE SET NULL,
  username_attempted VARCHAR(50),
  event_type         VARCHAR(50) NOT NULL,
  resource_type      VARCHAR(50),
  resource_id        INT,
  result             VARCHAR(20) NOT NULL CHECK (result IN ('success','failure','denied')),
  ip                 VARCHAR(45),
  detail             TEXT
);
CREATE INDEX IF NOT EXISTS idx_logs_occurred ON logs(occurred_at);
CREATE INDEX IF NOT EXISTS idx_logs_user     ON logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_event    ON logs(event_type);

-- ==== ข้อมูลตั้งต้น ====
INSERT INTO departments (name) VALUES ('ช่างอาคาร'), ('นิติบุคคล')
ON CONFLICT (name) DO NOTHING;

INSERT INTO roles (name, description) VALUES
  ('admin',      'ผู้ดูแลระบบ ใช้ได้ทุกฟังก์ชัน'),
  ('dept_head',  'หัวหน้าฝ่าย รับเรื่องและมอบหมายช่าง'),
  ('technician', 'ช่าง ดำเนินการซ่อม'),
  ('resident',   'ลูกบ้าน แจ้งซ่อมและติดตามสถานะของตน')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (name, description) VALUES
  ('request.create',        'แจ้งซ่อมใหม่'),
  ('request.read.own',      'ดูรายการที่ตนแจ้ง'),
  ('request.read.dept',     'ดูรายการในฝ่ายของตน'),
  ('request.read.assigned', 'ดูรายการที่ได้รับมอบหมาย'),
  ('request.read.all',      'ดูรายการทั้งหมด'),
  ('request.cancel.own',    'ยกเลิกรายการที่ตนแจ้ง'),
  ('request.approve',       'อนุมัติหรือปฏิเสธคำขอ'),
  ('request.assign',        'มอบหมายช่าง'),
  ('request.update_status', 'อัปเดตสถานะงานซ่อม'),
  ('request.close',         'ยืนยันปิดงาน'),
  ('attachment.upload',     'อัปโหลดไฟล์แนบ'),
  ('attachment.read',       'ดูหรือดาวน์โหลดไฟล์แนบ'),
  ('attachment.delete',     'ลบไฟล์แนบ'),
  ('user.manage',           'จัดการผู้ใช้'),
  ('role.manage',           'จัดการ Role'),
  ('permission.manage',     'จัดการ Permission'),
  ('acl.manage',            'กำหนด ACL'),
  ('log.read',              'ดู Log')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM (VALUES
  ('resident',   'request.create'),
  ('resident',   'request.read.own'),
  ('resident',   'request.cancel.own'),
  ('resident',   'request.close'),
  ('resident',   'attachment.upload'),
  ('resident',   'attachment.read'),
  ('dept_head',  'request.read.dept'),
  ('dept_head',  'request.approve'),
  ('dept_head',  'request.assign'),
  ('dept_head',  'attachment.upload'),
  ('dept_head',  'attachment.read'),
  ('technician', 'request.read.assigned'),
  ('technician', 'request.update_status'),
  ('technician', 'attachment.upload'),
  ('technician', 'attachment.read')
) AS m(role_name, perm_name)
JOIN roles r       ON r.name = m.role_name
JOIN permissions p ON p.name = m.perm_name
ON CONFLICT DO NOTHING;

-- อาคาร A ชั้น 1-10 ชั้นละ 4 ห้อง ได้ห้อง A-101 ถึง A-1004
INSERT INTO buildings (code, name) VALUES ('A', 'อาคาร A')
ON CONFLICT (code) DO NOTHING;

INSERT INTO units (building_id, floor, unit_no)
SELECT b.id, f, b.code || '-' || f || LPAD(r::text, 2, '0')
FROM buildings b, generate_series(1, 10) AS f, generate_series(1, 4) AS r
WHERE b.code = 'A'
ON CONFLICT (unit_no) DO NOTHING;

-- เลขที่สัญญาทดสอบ เช่น CT-A-101
INSERT INTO contracts (contract_no, unit_id)
SELECT 'CT-' || unit_no, id FROM units
ON CONFLICT (contract_no) DO NOTHING;

INSERT INTO common_areas (name) VALUES
  ('ล็อบบี้'), ('ลิฟต์โดยสาร'), ('ทางเดินส่วนกลาง'), ('ลานจอดรถ'),
  ('สระว่ายน้ำ'), ('ฟิตเนส'), ('ห้องน้ำส่วนกลาง')
ON CONFLICT (name) DO NOTHING;

INSERT INTO issue_categories (name, department_id)
SELECT v.name, d.id FROM (VALUES
  ('ไฟฟ้า', 'ช่างอาคาร'),
  ('ประปา', 'ช่างอาคาร'),
  ('เครื่องปรับอากาศ', 'ช่างอาคาร'),
  ('ลิฟต์', 'ช่างอาคาร'),
  ('ประตูและกุญแจ', 'ช่างอาคาร'),
  ('อื่นๆ', 'นิติบุคคล')
) AS v(name, dept)
JOIN departments d ON d.name = v.dept
ON CONFLICT (name) DO NOTHING;