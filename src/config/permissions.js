// =====================================================================
// src/config/permissions.js — รายชื่อ Permission ที่โค้ดเรียกใช้ใน requirePermission จริง
// CODE_PERMISSIONS: เพิ่มผ่านหน้าเว็บได้เฉพาะชื่อในรายการนี้ (มีฟังก์ชันรองรับแล้ว) และห้ามเปลี่ยนชื่อ
//   สิทธิ์ที่เคยมีแล้วถูกลบไป กลับมาเพิ่มคืนได้จากรายการ "ยังไม่ได้เพิ่ม" ในแท็บ Permission
// OPTIONAL_PERMISSIONS: สิทธิ์เสริมที่ลบผ่านเว็บได้ (ลบแล้วฟังก์ชันนั้นปิดสำหรับทุกคน เพิ่มคืนได้)
//   สิทธิ์ที่เหลือเป็นสิทธิ์หลักของระบบ ลบผ่านเว็บไม่ได้
// =====================================================================
const CODE_PERMISSIONS = new Set([
  'request.create', 'request.read.own', 'request.read.dept', 'request.read.assigned', 'request.read.all',
  'request.cancel.own', 'request.approve', 'request.assign', 'request.update_status', 'request.close',
  'request.export',
  'attachment.upload', 'attachment.read', 'attachment.delete',
  'announcement.read', 'announcement.manage',
  'dashboard.view', 'category.manage', 'property.manage',
  'user.manage', 'role.manage', 'permission.manage', 'acl.manage', 'log.read','xyz',
]);

// สิทธิ์เสริม: ใช้สาธิตเพิ่ม → กำหนดให้ Role → ถอน → ลบ Permission ผ่านเว็บ (โจทย์ข้อ 4.3, 6–7)
const OPTIONAL_PERMISSIONS = new Set(['request.export','xyz']);


// PROTECTED_ADMIN_PERMISSIONS: ห้ามถอนสิทธิ์เหล่านี้ออกจาก Role admin
// กันไม่ให้ Admin ถอนสิทธิ์ตัวเองจนไม่มีใครเข้าหน้าจัดการระบบได้อีก
const PROTECTED_ADMIN_PERMISSIONS = [
  'announcement.read', 'announcement.manage', 'property.manage',
  'user.manage', 'role.manage', 'permission.manage', 'acl.manage',
];

// CODE_ROLES: Role หลักที่โค้ดอ้างชื่อโดยตรง ห้ามลบหรือเปลี่ยนชื่อผ่านเว็บ
// admin = ผู้ดูแล, dept_head = หัวหน้าฝ่าย, technician = รายชื่อช่างที่มอบหมายได้, resident = Role ของผู้สมัครด้วยเลขสัญญา
const CODE_ROLES = ['admin', 'dept_head', 'technician', 'resident'];

// ADMIN_AREA_PERMISSIONS: มีสิทธิ์ใดสิทธิ์หนึ่งในนี้ → เข้าหน้า /admin ได้ และเห็นเฉพาะแท็บที่ตรงกับสิทธิ์ที่มี
// เช่น Role ที่ได้แค่ log.read จะเห็นแท็บ Log อย่างเดียว
const ADMIN_AREA_PERMISSIONS = [
  'user.manage', 'role.manage', 'permission.manage', 'acl.manage', 'category.manage', 'property.manage', 'log.read',
];

module.exports = { CODE_PERMISSIONS, OPTIONAL_PERMISSIONS, PROTECTED_ADMIN_PERMISSIONS, CODE_ROLES, ADMIN_AREA_PERMISSIONS };
