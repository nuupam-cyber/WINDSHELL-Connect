# WINDSHELL Connect — ระบบแจ้งซ่อมคอนโด

Node.js + Express + PostgreSQL · Session (เก็บใน PostgreSQL) · RBAC/ACL แก้ได้ผ่านหน้า Admin · บันทึก Log ลงฐานข้อมูล

## ติดตั้งและเริ่มใช้งาน
1. `npm install`
2. คัดลอก `env.example` เป็น `.env` แล้วตั้ง `DATABASE_URL` และ `SESSION_SECRET`
3. `npm run db:setup` — สร้างตาราง (`db/schema.sql`, `v2`–`v6`) ข้อมูลตัวอย่าง และบัญชีทดสอบ (รันซ้ำได้)
4. `npm start` แล้วเปิด http://localhost:3000 (หน้า Admin: `/admin`)

บน Render: ตั้ง Environment `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`
(ถ้าไม่ตั้ง `SESSION_SECRET` ใน production ระบบจะไม่เริ่มทำงาน) ไฟล์แนบเก็บในฐานข้อมูล ตาราง `attachments` คอลัมน์ `data` จึงไม่หายหลัง deploy

## บัญชีทดสอบ (รหัสผ่านตาม `SEED_PASSWORD`; ถ้าไม่ตั้ง `db:setup` ใช้ค่าทดสอบสำหรับเครื่องพัฒนา ให้เปลี่ยนก่อนใช้งานจริง)
| Role | username |
|---|---|
| Admin | admin01 |
| หัวหน้าฝ่าย | head01 (ช่างอาคาร), head02 (นิติบุคคล) |
| ช่าง/เจ้าหน้าที่ | tech01 – tech08 |
| ลูกบ้าน | user01 (สัญญา CT-A-101) |

## เอกสาร
- Access Matrix: `ACCESS_MATRIX.md`
- ความสัมพันธ์ของตาราง (สำหรับ ER Diagram): ส่วนหัวของ `db/schema.sql`

## โครงสร้าง
- `src/server.js` — ลำดับ Middleware และการผูก Route ทั้งหมด
- `src/middleware/auth.js` — ตรวจ Session โหลดผู้ใช้และสิทธิ์จาก DB (แก้สิทธิ์มีผลทันที), `requirePermission`
- `src/middleware/upload.js` — รับไฟล์ ตรวจชนิดจากเนื้อไฟล์ (JPG/PNG/PDF ≤ 5 MB)
- `src/middleware/errorHandler.js` — แปลง error ทุกชนิดเป็น JSON พร้อมข้อความภาษาไทย
- `src/routes/*` — Route แยกตามงาน · `/api/admin/*` สำหรับ Admin
- `src/services/access.js` — เงื่อนไขเจ้าของข้อมูล · `src/services/refs.js` — เลขที่คำร้อง
- `src/config/permissions.js` — Permission และ Role ที่โค้ดใช้อยู่ (ลบหรือเปลี่ยนชื่อผ่านเว็บไม่ได้)
- `src/logger.js` — เขียน Log ลงตาราง `logs` (ไม่บันทึกรหัสผ่าน/Session ID)
- `public/` หน้าผู้ใช้ทั่วไป · `private/admin.html` หน้า Admin (ต้องล็อกอินและมีสิทธิ์ส่วน Admin อย่างน้อย 1 อย่าง แต่ละแท็บแสดงตามสิทธิ์ที่มี)
- `scripts/` — `setup-db.js` สร้างฐานข้อมูล · `seed-staff.js` เพิ่มบัญชีเจ้าหน้าที่ · `reset-demo.js` รีเซ็ตการสาธิต Permission

## สาธิตการเพิ่ม/ยกเลิก Permission (โจทย์ข้อ 6–7)
ฟังก์ชัน "ส่งออก CSV" (`GET /api/requests/export`) ตรวจสิทธิ์ `request.export` ซึ่งไม่ได้สร้างไว้ตอนติดตั้ง
1. Admin → แท็บ Permission → ช่อง "เพิ่ม Permission" เลือก `request.export` → กดเพิ่ม (Admin ได้สิทธิ์ทันที)
   (ช่องนี้เลือกได้เฉพาะสิทธิ์ที่ระบบมีฟังก์ชันรองรับ เพิ่มชื่ออื่นที่ไม่มีฟังก์ชันไม่ได้)
2. แท็บ สิทธิ์ (ACL) → ติ๊ก `request.export` ให้ Role หัวหน้าฝ่าย
3. เข้าสู่ระบบ head01 → ปุ่ม "ส่งออก CSV" ปรากฏในรายการแจ้งเรื่องและดาวน์โหลดได้
4. Admin เอาติ๊กออก → head01 กดปุ่มเดิมถูกปฏิเสธ (403) และเรียก `/api/requests/export` ตรงๆ ก็ถูกปฏิเสธ โดยไม่ต้องรีสตาร์ต server
5. แท็บ Permission → กด "ลบ" ที่ `request.export` (สิทธิ์เสริม) → ปุ่มส่งออกหายจากทุก Role และกลับมาเพิ่มคืนได้ในข้อ 1
6. แท็บ Log กรองประเภท `permission_create`, `permission_grant`, `permission_revoke`, `permission_delete`, `access_denied` เพื่อดูหลักฐาน

ต้องการสาธิตซ้ำ: ลบ `request.export` ผ่านเว็บตามข้อ 5 หรือรัน `npm run demo:reset` (ลบผ่านฐานข้อมูลตาม `DATABASE_URL` ใน `.env` และบันทึก Log)
