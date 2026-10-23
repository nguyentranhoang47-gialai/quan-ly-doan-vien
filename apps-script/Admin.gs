/**
 * Admin.gs — Quản trị đơn vị, người dùng, phạm vi quyền và cấu hình.
 * Mọi hàm đều gọi assertAdmin_ ở phía máy chủ.
 */

function adminOverview_(ctx) {
  assertAdmin_(ctx);
  var units = rows_('UNITS').map(function (u) {
    var o = plain_(u); o.path = unitPath_(ctx, u.unit_id);
    o.member_count = 0; return o;
  });
  var byId = {};
  units.forEach(function (u) { byId[u.unit_id] = u; });
  rows_('MEMBERS').forEach(function (m) { if (!m.archived && byId[m.unit_id]) byId[m.unit_id].member_count++; });
  units.sort(function (a, b) { return a.path.localeCompare(b.path, 'vi'); });
  var scopes = rows_('USER_SCOPES').filter(function (s) { return s.status === 'active'; });
  var users = rows_('USERS').map(function (u) {
    var o = plain_(u);
    o.scopes = scopes.filter(function (s) { return s.user_id === u.user_id; }).map(function (s) {
      return { scope_id: s.scope_id, unit_id: s.unit_id, unit: unitPath_(ctx, s.unit_id), role: s.role, role_label: ROLE_LABELS[s.role],
        include_children: s.include_children, can_dues: s.can_dues };
    });
    o.active_sessions = rows_('SESSIONS').filter(function (s) {
      return s.user_id === u.user_id && !s.revoked && minutesSince_(s.expires_at) < 0;
    }).length;
    return o;
  }).sort(function (a, b) { return a.email.localeCompare(b.email); });
  var settings = rows_('SETTINGS').filter(function (s) { return EDITABLE_SETTINGS.indexOf(s.key) >= 0; })
    .map(function (s) { return { key: s.key, value: s.value, description: s.description }; });
  var quota = null;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { }
  return { units: units, users: users, settings: settings, mailQuota: quota,
    pendingOps: pendingOperations_().map(function (o) { return { op_id: o.op_id, action: o.action, started_at: o.started_at }; }),
    levelNames: String(getSetting_('UNIT_LEVEL_NAMES', '')).split(',').map(function (s) { return s.trim(); }) };
}

function unitSave_(ctx, p, requestId) {
  assertAdmin_(ctx);
  p = p || {};
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'unit.save', null, function () {
      var errors = {};
      var code = cleanStr_(p.code, 30).toUpperCase();
      var name = cleanStr_(p.name, 150);
      if (!/^[A-Z0-9._-]{1,30}$/.test(code)) errors.code = 'Mã đơn vị gồm chữ không dấu, số, . _ - (tối đa 30 ký tự).';
      if (!name) errors.name = 'Vui lòng nhập tên đơn vị.';
      var parentId = String(p.parent_id || '');
      var units = rows_('UNITS');
      var parent = parentId ? findBy_('UNITS', 'unit_id', parentId) : null;
      if (parentId && !parent) errors.parent_id = 'Đơn vị cấp trên không tồn tại.';
      var u = p.unit_id ? findBy_('UNITS', 'unit_id', String(p.unit_id)) : null;
      if (p.unit_id && !u) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy đơn vị.');
      if (units.some(function (x) { return x.code.toUpperCase() === code && (!u || x.unit_id !== u.unit_id); })) errors.code = 'Mã đơn vị đã tồn tại.';
      if (u && parentId) {
        // chống tạo vòng lặp trong cây
        var cur = parent, guard = 0;
        while (cur && guard++ < 50) {
          if (cur.unit_id === u.unit_id) { errors.parent_id = 'Không thể chọn đơn vị cấp dưới (hoặc chính nó) làm cấp trên.'; break; }
          cur = cur.parent_id ? findBy_('UNITS', 'unit_id', cur.parent_id) : null;
        }
      }
      var status = p.status === 'inactive' ? 'inactive' : 'active';
      if (u && status === 'inactive' && u.status === 'active') {
        var activeMembers = rows_('MEMBERS').filter(function (m) { return m.unit_id === u.unit_id && !m.archived; }).length;
        if (activeMembers) errors.status = 'Đơn vị còn ' + activeMembers + ' đoàn viên. Hãy chuyển sinh hoạt hoặc lưu trữ trước khi ngừng hoạt động.';
        if (units.some(function (x) { return x.parent_id === u.unit_id && x.status === 'active'; })) errors.status = 'Đơn vị còn đơn vị cấp dưới đang hoạt động.';
      }
      if (Object.keys(errors).length) throw AppError_(ERR.VALIDATION, 'Thông tin đơn vị chưa hợp lệ.', errors);
      var level = parent ? (parent.level || 1) + 1 : 1;
      if (u) {
        if (p.version !== undefined && parseInt(p.version, 10) !== u.version) throw AppError_(ERR.CONFLICT, 'Đơn vị vừa được người khác sửa. Hãy tải lại.');
        u.code = code; u.name = name; u.parent_id = parentId; u.level = level; u.status = status;
        u.sort_order = parseInt(p.sort_order, 10) || u.sort_order || 0; u.updated_at = now_(); u.version += 1;
        updateRow_('UNITS', u);
        // cập nhật cấp của các đơn vị con
        var changed = [], stack = [u];
        while (stack.length) {
          var x = stack.pop();
          rows_('UNITS').forEach(function (c) {
            if (c.parent_id === x.unit_id && c.level !== x.level + 1) { c.level = x.level + 1; changed.push(c); stack.push(c); }
            else if (c.parent_id === x.unit_id) stack.push(c);
          });
        }
        updateRows_('UNITS', changed);
      } else {
        u = { unit_id: newId_('U'), code: code, name: name, parent_id: parentId, level: level, status: status,
          sort_order: parseInt(p.sort_order, 10) || 0, created_at: now_(), updated_at: '', version: 1 };
        insertRow_('UNITS', u);
      }
      audit_(ctx, 'UNIT_SAVE', 'UNIT', u.unit_id, 'OK', requestId, code);
      return { unit_id: u.unit_id, message: 'Đã lưu đơn vị.' };
    });
  });
}

function userSave_(ctx, p, requestId) {
  assertAdmin_(ctx);
  p = p || {};
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'user.save', null, function () {
      var email = normEmail_(p.email);
      var name = cleanStr_(p.full_name, 100);
      var errors = {};
      if (!validEmail_(email)) errors.email = 'Email chưa đúng định dạng.';
      if (!name) errors.full_name = 'Vui lòng nhập họ tên.';
      var u = p.user_id ? findBy_('USERS', 'user_id', String(p.user_id)) : null;
      if (p.user_id && !u) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy người dùng.');
      var other = findBy_('USERS', 'email', email);
      if (other && (!u || other.user_id !== u.user_id)) errors.email = 'Email đã được khai báo cho người dùng khác.';
      if (Object.keys(errors).length) throw AppError_(ERR.VALIDATION, 'Thông tin người dùng chưa hợp lệ.', errors);
      var status = p.status === 'locked' ? 'locked' : 'active';
      var isAdmin = p.is_admin === true || p.is_admin === 'true';
      if (u && u.user_id === ctx.user.user_id && (!isAdmin || status === 'locked')) {
        throw AppError_(ERR.VALIDATION, 'Bạn không thể tự khóa hoặc tự bỏ quyền quản trị của chính mình.');
      }
      if (u && u.is_admin && (!isAdmin || status === 'locked')) {
        var otherAdmins = rows_('USERS').filter(function (x) { return x.is_admin && x.status === 'active' && x.user_id !== u.user_id; });
        if (!otherAdmins.length) throw AppError_(ERR.VALIDATION, 'Phải còn ít nhất một quản trị viên đang hoạt động.');
      }
      var revoked = 0;
      if (u) {
        var wasActive = u.status === 'active', wasAdmin = u.is_admin;
        u.email = email; u.full_name = name; u.status = status; u.is_admin = isAdmin; u.updated_at = now_(); u.version += 1;
        updateRow_('USERS', u);
        if ((wasActive && status === 'locked') || (wasAdmin && !isAdmin)) revoked = revokeUserSessions_(u.user_id, status === 'locked' ? 'Khóa tài khoản' : 'Thay đổi quyền');
      } else {
        u = { user_id: newId_('USR'), email: email, full_name: name, status: status, is_admin: isAdmin, created_at: now_(),
          created_by: ctx.user.email, updated_at: '', last_login_at: '', version: 1 };
        insertRow_('USERS', u);
      }
      audit_(ctx, 'USER_SAVE', 'USER', u.user_id, 'OK', requestId, 'status=' + status + ', admin=' + isAdmin + (revoked ? ', thu hồi ' + revoked + ' phiên' : ''));
      return { user_id: u.user_id, message: 'Đã lưu người dùng.' + (revoked ? ' Đã thu hồi ' + revoked + ' phiên đang dùng.' : '') };
    });
  });
}

function scopeAdd_(ctx, p, requestId) {
  assertAdmin_(ctx);
  p = p || {};
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'scope.add', null, function () {
      var u = findBy_('USERS', 'user_id', String(p.user_id || ''));
      var unit = findBy_('UNITS', 'unit_id', String(p.unit_id || ''));
      if (!u) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy người dùng.');
      if (!unit) throw AppError_(ERR.VALIDATION, 'Vui lòng chọn đơn vị.', { unit_id: 'Chọn đơn vị.' });
      if ([ROLES.OFFICER, ROLES.APPROVER, ROLES.VIEWER].indexOf(p.role) < 0) throw AppError_(ERR.VALIDATION, 'Vui lòng chọn vai trò.', { role: 'Chọn vai trò.' });
      var exists = rows_('USER_SCOPES').some(function (s) { return s.user_id === u.user_id && s.unit_id === unit.unit_id && s.role === p.role && s.status === 'active'; });
      if (exists) throw AppError_(ERR.CONFLICT, 'Người dùng đã có vai trò này tại đơn vị này.');
      var s = { scope_id: newId_('SC'), user_id: u.user_id, unit_id: unit.unit_id, role: p.role,
        include_children: p.include_children !== false && p.include_children !== 'false',
        can_dues: p.role === ROLES.OFFICER && (p.can_dues === true || p.can_dues === 'true'),
        status: 'active', created_at: now_(), created_by: ctx.user.email };
      insertRow_('USER_SCOPES', s);
      audit_(ctx, 'SCOPE_ADD', 'USER', u.user_id, 'OK', requestId, p.role + '@' + unit.code);
      return { scope_id: s.scope_id, message: 'Đã cấp quyền.' };
    });
  });
}

function scopeRemove_(ctx, p, requestId) {
  assertAdmin_(ctx);
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'scope.remove', null, function () {
      var s = findBy_('USER_SCOPES', 'scope_id', String(p && p.scope_id || ''));
      if (!s || s.status !== 'active') throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy quyền.');
      s.status = 'revoked';
      updateRow_('USER_SCOPES', s);
      audit_(ctx, 'SCOPE_REMOVE', 'USER', s.user_id, 'OK', requestId, s.role);
      return { message: 'Đã thu hồi quyền. Có hiệu lực ngay ở thao tác kế tiếp của người dùng.' };
    });
  });
}

function revokeSessionsApi_(ctx, p, requestId) {
  assertAdmin_(ctx);
  return withLock_(function () {
    var n = revokeUserSessions_(String(p && p.user_id || ''), 'Quản trị thu hồi');
    audit_(ctx, 'SESSIONS_REVOKE', 'USER', p && p.user_id, 'OK', requestId, 'Số phiên: ' + n);
    return { message: 'Đã thu hồi ' + n + ' phiên đăng nhập.' };
  });
}

function settingsSave_(ctx, p, requestId) {
  assertAdmin_(ctx);
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'settings.save', null, function () {
      var values = (p && p.values) || {};
      var errors = {};
      Object.keys(values).forEach(function (k) {
        if (EDITABLE_SETTINGS.indexOf(k) < 0) { errors[k] = 'Không được sửa tham số này.'; return; }
        var v = cleanStr_(values[k], 500);
        if (k === 'ALLOW_ADMIN_SELF_APPROVE' && ['TRUE', 'FALSE'].indexOf(v.toUpperCase()) < 0) errors[k] = 'Chỉ nhận TRUE hoặc FALSE.';
        if ((k === 'BACKUP_KEEP' || k === 'MEMBERS_WARN_LIMIT') && !/^\d{1,6}$/.test(v)) errors[k] = 'Phải là số nguyên dương.';
        if (k === 'DUES_DEFAULT_AMOUNT' && v && !/^\d{1,10}$/.test(v)) errors[k] = 'Số tiền nguyên VND hoặc để trống.';
        if (k === 'MEMBER_CODE_PREFIX' && !/^[A-Z0-9]{0,6}$/i.test(v)) errors[k] = 'Tối đa 6 chữ/số không dấu.';
      });
      if (Object.keys(errors).length) throw AppError_(ERR.VALIDATION, 'Cấu hình chưa hợp lệ.', errors);
      Object.keys(values).forEach(function (k) {
        var v = cleanStr_(values[k], 500);
        if (k === 'ALLOW_ADMIN_SELF_APPROVE') v = v.toUpperCase();
        setSetting_(k, v);
      });
      audit_(ctx, 'SETTINGS_SAVE', 'SYSTEM', '', 'OK', requestId, Object.keys(values).join(','));
      return { message: 'Đã lưu cấu hình.' };
    });
  });
}
