-- ===== เวลาที่ผู้ใช้อ่านการแจ้งเตือนล่าสุด รันซ้ำได้ =====
-- ผู้ใช้เดิมจะเริ่มที่เวลาปัจจุบัน จึงไม่เห็นเหตุการณ์เก่าเป็นรายการใหม่
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();