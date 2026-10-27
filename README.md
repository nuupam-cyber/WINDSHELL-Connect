# WINDSHELL Connect — ระบบแจ้งซ่อมคอนโด

Node.js + Express + PostgreSQL · Session (เก็บใน PostgreSQL) · RBAC/ACL แก้ได้ผ่านหน้า Admin · บันทึก Log ลงฐานข้อมูล

## ติดตั้งและเริ่มใช้งาน
1. `npm install`
2. คัดลอก `.env.example` เป็น `.env` แล้วตั้ง `DATABASE_URL` และ `SESSION_SECRET`
3. `npm run db:setup` — สร้างตาราง (`db/schema.sql`, `v2`–`v6`) ข้อมูลตัวอย่าง และบัญชีทดสอบ (รันซ้ำได้)
4. `npm start` แล้วเปิด http://localhost:3000 (หน้า Admin: `/admin`)

บน Render: ตั้ง Environment `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`
(ถ้าไม่ตั้ง `SESSION_SECRET` ใน production ระบบจะไม่เริ่มทำงาน) (ไฟล์แนบเก็บในฐานข้อมูล ตาราง `attachments` คอลัมน์ `data` จึงไม่หายหลัง deploy)

## บัญชีทดสอบ (รหัสผ่านตาม `SEED_PASSWORD`; ถ้าไม่ตั้ง `db:setup` ใช้ค่าทดสอบสำหรับเครื่องพัฒนา ให้เปลี่ยนก่อนใช้งานจริง)
| Role | username |
|---|---|
| Admin | admin01 |
| หัวหน้าฝ่าย | head01 (ช่างอาคาร), head02 (นิติบุคคล) |
| ช่าง/เจ้าหน้าที่ | tech01 – tech08 |
| ลูกบ้าน | user01 (สัญญา CT-A-101) |

## เอกสาร
- ER Diagram: `docs/er-diagram.png` (ต้นฉบับ `docs/er.mmd`)
- Access Matrix: `docs/ACCESS_MATRIX.md`

## โครงสร้าง
- `src/middleware/auth.js` — ตรวจ Session โหลดผู้ใช้และสิทธิ์จาก DB ทุกคำขอ (แก้สิทธิ์มีผลทันที), `requirePermission`
- `src/routes/*` — Route แยกตามงาน · `/api/admin/*` สำหรับ Admin · `src/services/access.js` เงื่อนไขเจ้าของข้อมูล
- `src/logger.js` — เขียน Log ลงตาราง `logs` (ไม่บันทึกรหัสผ่าน/Session ID)
- `src/middleware/upload.js` — อัปโหลดไฟล์ ตรวจชนิดจากเนื้อไฟล์ (JPG/PNG/PDF ≤ 5 MB) ตั้งชื่อด้วย UUID เปิดดูผ่าน Route ที่ตรวจสิทธิ์เท่านั้น
- `public/` หน้าผู้ใช้ทั่วไป · `private/admin.html` หน้า Admin (ต้องล็อกอินและมีสิทธิ์ `user.manage`)
