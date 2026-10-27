const CODE_PERMISSIONS = new Set([
  'request.create', 'request.read.own', 'request.read.dept', 'request.read.assigned', 'request.read.all',
  'request.cancel.own', 'request.approve', 'request.assign', 'request.update_status', 'request.close',
  'attachment.upload', 'attachment.read', 'attachment.delete',
  'dashboard.view', 'category.manage',
  'user.manage', 'role.manage', 'permission.manage', 'acl.manage', 'log.read',
]);

const PROTECTED_ADMIN_PERMISSIONS = [  'announcement.read', 'announcement.manage',  'property.manage','user.manage', 'role.manage', 'permission.manage', 'acl.manage'];

module.exports = { CODE_PERMISSIONS, PROTECTED_ADMIN_PERMISSIONS };