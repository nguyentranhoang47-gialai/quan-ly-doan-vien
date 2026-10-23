/**
 * Permissions.gs — Phân quyền theo đơn vị (kiểm tra hoàn toàn phía máy chủ).
 *
 * Năng lực (capability) theo vai trò:
 *   viewer   : view
 *   officer  : view, edit (tạo/sửa yêu cầu, nhập CSV), transfer (lập/hủy/xác nhận chuyển), dues (nếu can_dues)
 *   approver : view, approve, transfer (xác nhận nhận đoàn viên ở đơn vị đến)
 *   admin    : mọi năng lực trên mọi đơn vị + quản trị hệ thống
 * include_children = TRUE: quyền áp dụng cho cả cây đơn vị cấp dưới.
 */

function buildContext_(user) {
  var units = rows_('UNITS');
  var byId = {}, children = {};
  units.forEach(function (u) {
    byId[u.unit_id] = u;
    (children[u.parent_id || ''] = children[u.parent_id || ''] || []).push(u.unit_id);
  });
  var caps = { view: {}, edit: {}, approve: {}, transfer: {}, dues: {} };
  var roles = {};

  function expand(unitId, withChildren) {
    var out = [unitId], stack = withChildren ? [unitId] : [], seen = {};
    seen[unitId] = true;
    while (stack.length) {
      var id = stack.pop();
      (children[id] || []).forEach(function (c) { if (!seen[c]) { seen[c] = true; out.push(c); stack.push(c); } });
    }
    return out;
  }

  if (user.is_admin) {
    units.forEach(function (u) { ['view', 'edit', 'approve', 'transfer', 'dues'].forEach(function (c) { caps[c][u.unit_id] = true; }); });
    roles.admin = true;
  } else {
    rows_('USER_SCOPES').forEach(function (s) {
      if (s.user_id !== user.user_id || s.status !== 'active' || !byId[s.unit_id]) return;
      roles[s.role] = true;
      expand(s.unit_id, s.include_children).forEach(function (uid) {
        caps.view[uid] = true;
        if (s.role === ROLES.OFFICER) { caps.edit[uid] = true; caps.transfer[uid] = true; if (s.can_dues) caps.dues[uid] = true; }
        if (s.role === ROLES.APPROVER) { caps.approve[uid] = true; caps.transfer[uid] = true; }
      });
    });
  }
  return { user: user, isAdmin: !!user.is_admin, caps: caps, roles: roles, unitsById: byId, children: children };
}

function can_(ctx, cap, unitId) { return !!(ctx.caps[cap] && ctx.caps[cap][unitId]); }

function hasAny_(ctx, cap) { return Object.keys(ctx.caps[cap] || {}).length > 0; }

/** Ném lỗi FORBIDDEN và ghi nhật ký DENIED nếu không có quyền. */
function assertCan_(ctx, cap, unitId, objType, objId) {
  if (can_(ctx, cap, unitId)) return;
  audit_(ctx, 'DENIED_' + cap.toUpperCase(), objType || 'UNIT', objId || unitId, 'DENIED', ctx.requestId || '', '');
  throw AppError_(ERR.FORBIDDEN, 'Bạn không có quyền thực hiện thao tác này với đơn vị được chọn. Nếu cần, hãy đề nghị quản trị cấp quyền.');
}

function assertAdmin_(ctx) {
  if (ctx.isAdmin) return;
  audit_(ctx, 'DENIED_ADMIN', 'SYSTEM', '', 'DENIED', ctx.requestId || '', '');
  throw AppError_(ERR.FORBIDDEN, 'Chức năng này chỉ dành cho Quản trị hệ thống.');
}

/** Danh sách unit_id có năng lực cap; nếu rootUnit được chọn thì giao với cây của rootUnit. */
function unitsWith_(ctx, cap, rootUnit, includeChildren) {
  var allowed = ctx.caps[cap] || {};
  if (!rootUnit) return Object.keys(allowed);
  if (!allowed[rootUnit]) return [];
  var out = [rootUnit];
  if (includeChildren !== false) {
    var stack = [rootUnit], seen = {};
    seen[rootUnit] = true;
    while (stack.length) {
      var id = stack.pop();
      (ctx.children[id] || []).forEach(function (c) {
        if (!seen[c]) { seen[c] = true; if (allowed[c]) out.push(c); stack.push(c); }
      });
    }
  }
  return out;
}

/** Người dùng chỉ có quyền xem (không có quyền ghi/duyệt) ở đơn vị này → che trường nhạy cảm. */
function viewOnlyAt_(ctx, unitId) {
  return !(can_(ctx, 'edit', unitId) || can_(ctx, 'approve', unitId) || ctx.isAdmin);
}

/** Đường dẫn tên đơn vị: "Cấp trên › Cơ sở". */
function unitPath_(ctx, unitId) {
  var parts = [], u = ctx.unitsById[unitId], guard = 0;
  while (u && guard++ < 20) { parts.unshift(u.name); u = ctx.unitsById[u.parent_id]; }
  return parts.join(' › ');
}

function unitName_(ctx, unitId) { var u = ctx.unitsById[unitId]; return u ? u.name : '(không rõ)'; }

/** Mô tả quyền gửi cho giao diện (chỉ để hiển thị menu; máy chủ vẫn kiểm tra lại). */
function describeAccess_(ctx) {
  var visibleUnits = Object.keys(ctx.caps.view).map(function (id) {
    var u = ctx.unitsById[id];
    return { unit_id: id, name: u.name, path: unitPath_(ctx, id), level: u.level, status: u.status, parent_id: u.parent_id,
      can_edit: can_(ctx, 'edit', id), can_approve: can_(ctx, 'approve', id), can_dues: can_(ctx, 'dues', id),
      can_transfer: can_(ctx, 'transfer', id) };
  }).sort(function (a, b) { return a.path.localeCompare(b.path, 'vi'); });
  var allActive = rows_('UNITS').filter(function (u) { return u.status === 'active'; })
    .map(function (u) { return { unit_id: u.unit_id, path: unitPath_(ctx, u.unit_id) }; })
    .sort(function (a, b) { return a.path.localeCompare(b.path, 'vi'); });
  return {
    user: { full_name: ctx.user.full_name, email: ctx.user.email },
    isAdmin: ctx.isAdmin,
    roles: Object.keys(ctx.roles).map(function (r) { return ROLE_LABELS[r] || r; }),
    canEdit: hasAny_(ctx, 'edit'), canApprove: hasAny_(ctx, 'approve'), canDues: hasAny_(ctx, 'dues'),
    canTransfer: hasAny_(ctx, 'transfer'),
    units: visibleUnits,
    transferTargets: allActive,   // danh sách đơn vị đến (chỉ tên, không có dữ liệu đoàn viên)
    levelNames: String(getSetting_('UNIT_LEVEL_NAMES', '')).split(',').map(function (s) { return s.trim(); }).filter(String),
    orgName: getSetting_('ORG_NAME', APP.NAME),
    memberStatus: MEMBER_STATUS, genders: GENDERS, idTypes: ID_TYPES,
    duesDefault: getSetting_('DUES_DEFAULT_AMOUNT', '')
  };
}
