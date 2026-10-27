-- db/v6.sql — เพิ่มคอลัมน์ รันซ้ำได้
-- users.position: ตำแหน่งของเจ้าหน้าที่ เช่น "หัวหน้าช่างอาคาร" ใช้แสดง "ชื่อ (ตำแหน่ง)" และจับคู่ช่างกับประเภทงาน
ALTER TABLE users ADD COLUMN IF NOT EXISTS position VARCHAR(100);

-- attachments.data: เนื้อไฟล์แนบ เก็บในฐานข้อมูลเพราะดิสก์ของ Render ถูกล้างทุกครั้งที่ deploy
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS data BYTEA;
