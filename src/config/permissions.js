// =====================================================================
// src/config/permissions.js — รายชื่อ Permission ที่โค้ดเรียกใช้ใน requirePermission จริง
// CODE_PERMISSIONS: ห้ามลบหรือเปลี่ยนชื่อผ่านหน้าเว็บ (ถ้าลบ ฟังก์ชันที่ผูกอยู่จะใช้ไม่ได้)
// Permission ที่ Admin เพิ่มใหม่ผ่านเว็บ ลบได้ตามปกติ
// =====================================================================
const CODE_PERMISSIONS = new Set([
  'request.create', 'request.read.own', 'request.read.dept', 'request.read.assigned', 'request.read.all',
  'request.cancel.own', 'request.approve', 'request.assign', 'request.update_status', 'request.close',
  'attachment.upload', 'attachment.read', 'attachment.delete',
  'dashboard.view', 'category.manage',
  'user.manage', 'role.manage', 'permission.manage', 'acl.manage', 'log.read',
]);

// PROTECTED_ADMIN_PERMISSIONS: ห้ามถอนสิทธิ์เหล่านี้ออกจาก Role admin
// กันไม่ให้ Admin ถอนสิทธิ์ตัวเองจนไม่มีใครเข้าหน้าจัดการระบบได้อีก
const PROTECTED_ADMIN_PERMISSIONS = [  'announcement.read', 'announcement.manage',  'property.manage','user.manage', 'role.manage', 'permission.manage', 'acl.manage'];

module.exports = { CODE_PERMISSIONS, PROTECTED_ADMIN_PERMISSIONS };