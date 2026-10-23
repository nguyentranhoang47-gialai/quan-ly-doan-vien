/**
 * Approvals.gs — Yêu cầu thay đổi hồ sơ và phê duyệt.
 *
 * Luồng: Nhập dữ liệu → Lưu nháp (DRAFT) → Gửi duyệt (PENDING) → Duyệt (APPROVED) hoặc Trả lại (RETURNED).
 * Dữ liệu chính thức trong MEMBERS chỉ thay đổi khi yêu cầu được duyệt.
 */

/** Nhãn tiếng Việt của trường hồ sơ (tạo khi chạy, không phụ thuộc thứ tự nạp tệp .gs). */
function fieldLabels_() {
  var o = {};
  SCHEMA.MEMBERS.columns.forEach(function (c) { o[c[0]] = c[1]; });
  o.reason = 'Lý do';
  return o;
}

function crSummary_(type, name) { return CR_TYPES[type] + ': ' + name; }

/** Tạo mới hoặc cập nhật bản nháp; nếu submit=true thì gửi duyệt luôn. */
function crSave_(ctx, p, requestId) {
  p = p || {};
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'change.save', null, function () {
      var type = String(p.request_type || '');
      var cr = null, member = null;
      if (p.change_id) {
        cr = findBy_('CHANGE_REQUESTS', 'change_id', String(p.change_id));
        if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
        if (cr.created_by !== ctx.user.email) throw AppError_(ERR.FORBIDDEN, 'Chỉ người lập yêu cầu mới được sửa yêu cầu này.');
        if (cr.status !== 'DRAFT' && cr.status !== 'RETURNED') throw AppError_(ERR.CONFLICT, 'Yêu cầu đã gửi duyệt hoặc đã xử lý, không sửa được nữa.');
        type = cr.request_type;
      }
      if (!CR_TYPES[type]) throw AppError_(ERR.VALIDATION, 'Loại yêu cầu không hợp lệ.');

      var data, unitId, memberId, baseVersion = '', oldSnapshot = '';
      if (type === 'CREATE') {
        var v = validateMember_(p.data, 'create');
        if (Object.keys(v.errors).length) throw AppError_(ERR.VALIDATION, 'Dữ liệu chưa hợp lệ. Vui lòng sửa các ô được đánh dấu.', v.errors);
        data = v.data; unitId = data.unit_id;
        var u = ctx.unitsById[unitId];
        if (!u || u.status !== 'active') throw AppError_(ERR.VALIDATION, 'Đơn vị không tồn tại hoặc đã ngừng hoạt động.', { unit_id: 'Chọn đơn vị đang hoạt động.' });
        assertCan_(ctx, 'edit', unitId, 'UNIT', unitId);
        memberId = cr ? cr.member_id : newId_('M');
        var dup = duplicateErrors_(data, memberId, cr ? cr.change_id : '');
        if (Object.keys(dup).length) throw AppError_(ERR.CONFLICT, 'Có thông tin bị trùng.', dup);
      } else {
        memberId = cr ? cr.member_id : String(p.member_id || '');
        member = findBy_('MEMBERS', 'member_id', memberId);
        if (!member) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy hồ sơ đoàn viên.');
        unitId = member.unit_id;
        assertCan_(ctx, 'edit', unitId, 'MEMBER', memberId);
        baseVersion = parseInt(p.base_version !== undefined ? p.base_version : (cr ? cr.base_version : ''), 10);
        if (!(baseVersion >= 1)) throw AppError_(ERR.VALIDATION, 'Thiếu phiên bản hồ sơ. Hãy tải lại hồ sơ rồi sửa lại.');
        if (baseVersion !== member.version) {
          throw AppError_(ERR.CONFLICT, 'Hồ sơ đã được người khác cập nhật sau khi bạn mở. Hãy tải lại hồ sơ để xem dữ liệu mới rồi sửa lại.');
        }
        var openPending = rows_('CHANGE_REQUESTS').filter(function (c) {
          return c.member_id === memberId && c.status === 'PENDING' && (!cr || c.change_id !== cr.change_id);
        });
        if (openPending.length) throw AppError_(ERR.CONFLICT, 'Hồ sơ này đang có yêu cầu khác chờ duyệt (người lập: ' + openPending[0].created_by + '). Hãy đợi yêu cầu đó được xử lý.');
        if (type === 'UPDATE') {
          if (member.archived) throw AppError_(ERR.CONFLICT, 'Hồ sơ đã lưu trữ. Hãy khôi phục hồ sơ trước khi sửa.');
          var vu = validateMember_(p.data, 'update');
          if (Object.keys(vu.errors).length) throw AppError_(ERR.VALIDATION, 'Dữ liệu chưa hợp lệ. Vui lòng sửa các ô được đánh dấu.', vu.errors);
          data = vu.data;
          if (!data.member_code) data.member_code = member.member_code;
          var changed = MEMBER_EDITABLE.filter(function (f) { return String(data[f] || '') !== String(member[f] || ''); });
          if (!changed.length) throw AppError_(ERR.VALIDATION, 'Bạn chưa thay đổi thông tin nào.');
          var dup2 = duplicateErrors_(data, memberId, cr ? cr.change_id : '');
          if (Object.keys(dup2).length) throw AppError_(ERR.CONFLICT, 'Có thông tin bị trùng.', dup2);
        } else {
          var reason = cleanStr_(p.data && p.data.reason, 500);
          if (!reason) throw AppError_(ERR.VALIDATION, 'Vui lòng ghi lý do.', { reason: 'Vui lòng ghi lý do.' });
          if (type === 'ARCHIVE' && member.archived) throw AppError_(ERR.CONFLICT, 'Hồ sơ đã ở trạng thái lưu trữ.');
          if (type === 'RESTORE' && !member.archived) throw AppError_(ERR.CONFLICT, 'Hồ sơ đang có hiệu lực, không cần khôi phục.');
          data = { reason: reason };
        }
        oldSnapshot = JSON.stringify(plain_(member, MEMBER_EDITABLE.concat(['archived'])));
      }

      var name = type === 'CREATE' ? data.full_name : (type === 'UPDATE' ? data.full_name : member.full_name);
      var submit = !!p.submit;
      var t = now_();
      if (!cr) {
        cr = {
          change_id: newId_('CR'), request_type: type, member_id: memberId, unit_id: unitId, status: 'DRAFT',
          payload_json: JSON.stringify(data), old_json: oldSnapshot, base_version: baseVersion, summary: crSummary_(type, name),
          import_job_id: '', created_by: ctx.user.email, created_at: t, updated_at: t, submitted_at: '',
          decided_by: '', decided_at: '', decision_note: '', version: 1
        };
        if (submit) { cr.status = 'PENDING'; cr.submitted_at = t; }
        insertRow_('CHANGE_REQUESTS', cr);
      } else {
        cr.payload_json = JSON.stringify(data); cr.unit_id = unitId; cr.base_version = baseVersion;
        cr.old_json = oldSnapshot; cr.summary = crSummary_(type, name); cr.updated_at = t; cr.version += 1;
        if (submit) { cr.status = 'PENDING'; cr.submitted_at = t; cr.decision_note = ''; }
        else cr.status = 'DRAFT';
        updateRow_('CHANGE_REQUESTS', cr);
      }
      approvalAction_('CHANGE', cr.change_id, submit ? 'SUBMIT' : 'SAVE_DRAFT', ctx.user.email, '', requestId);
      audit_(ctx, submit ? 'CHANGE_SUBMIT' : 'CHANGE_SAVE_DRAFT', 'CHANGE', cr.change_id, 'OK', requestId, type);
      return { change_id: cr.change_id, status: cr.status,
        message: submit ? 'Đã gửi yêu cầu chờ duyệt. Dữ liệu chính thức chỉ thay đổi sau khi được duyệt.' : 'Đã lưu nháp.' };
    });
  });
}

function crSubmit_(ctx, p, requestId) {
  var cr = findBy_('CHANGE_REQUESTS', 'change_id', String(p && p.change_id || ''));
  if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
  var data = safeJson_(cr.payload_json, {});
  return crSave_(ctx, { change_id: cr.change_id, data: data, base_version: cr.base_version, submit: true }, requestId);
}

function crCancel_(ctx, p, requestId) {
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'change.cancel', null, function () {
      var cr = findBy_('CHANGE_REQUESTS', 'change_id', String(p && p.change_id || ''));
      if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
      if (cr.created_by !== ctx.user.email && !ctx.isAdmin) throw AppError_(ERR.FORBIDDEN, 'Chỉ người lập hoặc quản trị được hủy yêu cầu.');
      if (['DRAFT', 'PENDING', 'RETURNED'].indexOf(cr.status) < 0) throw AppError_(ERR.CONFLICT, 'Yêu cầu đã được xử lý, không hủy được.');
      cr.status = 'CANCELLED'; cr.updated_at = now_(); cr.version += 1;
      updateRow_('CHANGE_REQUESTS', cr);
      approvalAction_('CHANGE', cr.change_id, 'CANCEL', ctx.user.email, cleanStr_(p.note, 500), requestId);
      audit_(ctx, 'CHANGE_CANCEL', 'CHANGE', cr.change_id, 'OK', requestId, '');
      return { change_id: cr.change_id, status: cr.status, message: 'Đã hủy yêu cầu.' };
    });
  });
}

function selfApproveAllowed_(ctx) {
  return ctx.isAdmin && String(getSetting_('ALLOW_ADMIN_SELF_APPROVE', 'FALSE')).toUpperCase() === 'TRUE';
}

function crRow_(ctx, c) {
  return { change_id: c.change_id, request_type: c.request_type, type_label: CR_TYPES[c.request_type], member_id: c.member_id,
    unit_name: unitName_(ctx, c.unit_id), status: c.status, status_label: CR_STATUS[c.status], summary: c.summary,
    created_by: c.created_by, created_at: c.created_at, submitted_at: c.submitted_at, decided_by: c.decided_by,
    decided_at: c.decided_at, decision_note: c.decision_note, import_job_id: c.import_job_id };
}

/** box: 'approve' (chờ tôi duyệt) | 'mine' (tôi lập) | 'history' (đã xử lý trong phạm vi duyệt/sửa). */
function crList_(ctx, p) {
  p = p || {};
  var me = ctx.user.email, box = p.box || 'approve';
  var q = normalizeText_(p.q);
  var list = rows_('CHANGE_REQUESTS').filter(function (c) {
    if (box === 'mine') { if (c.created_by !== me) return false; }
    else if (box === 'approve') {
      if (c.status !== 'PENDING' || !can_(ctx, 'approve', c.unit_id)) return false;
      if (c.created_by === me && !selfApproveAllowed_(ctx)) return false;
    } else {
      if (!(can_(ctx, 'approve', c.unit_id) || can_(ctx, 'edit', c.unit_id))) return false;
    }
    if (p.status && c.status !== p.status) return false;
    if (p.import_job_id && c.import_job_id !== p.import_job_id) return false;
    if (q && normalizeText_(c.summary).indexOf(q) < 0) return false;
    return true;
  }).reverse();
  return paginate_(list, p, function (c) { return crRow_(ctx, c); });
}

function crGet_(ctx, p) {
  var cr = findBy_('CHANGE_REQUESTS', 'change_id', String(p && p.change_id || ''));
  if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
  if (!(cr.created_by === ctx.user.email || can_(ctx, 'approve', cr.unit_id) || can_(ctx, 'edit', cr.unit_id))) {
    assertCan_(ctx, 'approve', cr.unit_id, 'CHANGE', cr.change_id);
  }
  var newer = safeJson_(cr.payload_json, {}), older = safeJson_(cr.old_json, {});
  var member = findBy_('MEMBERS', 'member_id', cr.member_id);
  var fields = cr.request_type === 'CREATE' ? MEMBER_EDITABLE.concat(['unit_id'])
    : cr.request_type === 'UPDATE' ? MEMBER_EDITABLE : ['reason'];
  var diff = fields.map(function (f) {
    var nv = newer[f] === undefined ? '' : newer[f], ov = older[f] === undefined ? '' : older[f];
    if (f === 'unit_id') nv = unitName_(ctx, nv);
    if (f === 'member_status') { nv = MEMBER_STATUS[nv] || nv; ov = MEMBER_STATUS[ov] || ov; }
    return { field: f, label: fieldLabels_()[f] || f, old: cr.request_type === 'CREATE' ? '' : ov, new: nv,
      changed: cr.request_type === 'CREATE' ? !!nv : String(nv) !== String(ov) };
  }).filter(function (d) { return cr.request_type !== 'CREATE' || d.new !== ''; });
  var stale = cr.request_type !== 'CREATE' && member && cr.status === 'PENDING' && member.version !== cr.base_version;
  var actions = rows_('APPROVAL_ACTIONS').filter(function (a) { return a.target_type === 'CHANGE' && a.target_id === cr.change_id; })
    .map(function (a) { return { action: a.action, actor: a.actor, at: a.at, note: a.note }; });
  var me = ctx.user.email;
  return {
    request: crRow_(ctx, cr), data: newer, base_version: cr.base_version, diff: diff, actions: actions,
    stale: !!stale,
    can_approve: cr.status === 'PENDING' && can_(ctx, 'approve', cr.unit_id) && (cr.created_by !== me || selfApproveAllowed_(ctx)),
    can_edit: (cr.status === 'DRAFT' || cr.status === 'RETURNED') && cr.created_by === me,
    can_cancel: ['DRAFT', 'PENDING', 'RETURNED'].indexOf(cr.status) >= 0 && (cr.created_by === me || ctx.isAdmin)
  };
}

/** Kiểm tra điều kiện duyệt; trả về params để áp dụng (dùng cả cho phục hồi). Gọi khi giữ khóa. */
function prepareApproval_(ctx, cr, requestId) {
  if (cr.status === 'APPROVED') throw AppError_(ERR.CONFLICT, 'Yêu cầu này đã được duyệt trước đó.');
  if (cr.status !== 'PENDING') throw AppError_(ERR.CONFLICT, 'Yêu cầu không ở trạng thái chờ duyệt (hiện tại: ' + CR_STATUS[cr.status] + ').');
  assertCan_(ctx, 'approve', cr.unit_id, 'CHANGE', cr.change_id);
  var selfApprove = cr.created_by === ctx.user.email;
  if (selfApprove && !selfApproveAllowed_(ctx)) {
    audit_(ctx, 'DENIED_SELF_APPROVE', 'CHANGE', cr.change_id, 'DENIED', requestId, '');
    throw AppError_(ERR.FORBIDDEN, 'Bạn không thể tự duyệt yêu cầu do chính mình lập. Hãy để người phê duyệt khác xử lý.');
  }
  var data = safeJson_(cr.payload_json, {});
  var member = findBy_('MEMBERS', 'member_id', cr.member_id);
  if (cr.request_type === 'CREATE') {
    if (member) throw AppError_(ERR.CONFLICT, 'Hồ sơ đã tồn tại.');
    var u = ctx.unitsById[cr.unit_id];
    if (!u || u.status !== 'active') throw AppError_(ERR.CONFLICT, 'Đơn vị của hồ sơ đã ngừng hoạt động. Hãy trả lại để chọn đơn vị khác.');
  } else {
    if (!member) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy hồ sơ đoàn viên.');
    if (member.unit_id !== cr.unit_id) throw AppError_(ERR.CONFLICT, 'Đoàn viên đã chuyển sang đơn vị khác sau khi lập yêu cầu. Hãy trả lại yêu cầu.');
    if (member.version !== cr.base_version) {
      throw AppError_(ERR.CONFLICT, 'Hồ sơ đã thay đổi sau khi yêu cầu được lập (xung đột phiên bản). Hãy trả lại để người lập cập nhật.');
    }
  }
  if (cr.request_type === 'CREATE' || cr.request_type === 'UPDATE') {
    var dup = duplicateErrors_(data, cr.member_id, cr.change_id);
    if (Object.keys(dup).length) throw AppError_(ERR.CONFLICT, 'Không duyệt được vì thông tin bị trùng: ' + Object.keys(dup).map(function (k) { return dup[k]; }).join(' '));
  }
  if (cr.request_type === 'CREATE' && !data.member_code) data.member_code = nextMemberCode_();
  return {
    change_id: cr.change_id, type: cr.request_type, member_id: cr.member_id, unit_id: cr.unit_id, data: data,
    base_version: cr.base_version, creator: cr.created_by, approver: ctx.user.email, decided_at: now_(),
    self_approve: selfApprove, request_id: requestId
  };
}

/** Áp dụng yêu cầu đã duyệt — LŨY ĐẲNG: chạy lại không tạo trùng (dùng cho phục hồi). */
function applyChange_(pp, actorEmail) {
  var m = findBy_('MEMBERS', 'member_id', pp.member_id);
  var d = pp.data;
  if (pp.type === 'CREATE') {
    if (!m) {
      m = { member_id: pp.member_id, unit_id: pp.unit_id, archived: false, created_at: pp.decided_at, created_by: pp.creator,
        updated_at: '', updated_by: '', version: 1, last_ref: pp.change_id };
      MEMBER_EDITABLE.forEach(function (f) { m[f] = d[f] || ''; });
      m.name_search = normalizeText_(m.full_name);
      insertRow_('MEMBERS', m);
    }
  } else if (m && m.last_ref !== pp.change_id) {
    if (pp.type === 'UPDATE') {
      MEMBER_EDITABLE.forEach(function (f) { if (d.hasOwnProperty(f)) m[f] = d[f]; });
      m.name_search = normalizeText_(m.full_name);
    } else if (pp.type === 'ARCHIVE') m.archived = true;
    else if (pp.type === 'RESTORE') m.archived = false;
    m.version = pp.base_version + 1; m.updated_at = pp.decided_at; m.updated_by = pp.approver; m.last_ref = pp.change_id;
    updateRow_('MEMBERS', m);
  }
  faultPoint_('approve_after_member');

  var event = { CREATE: 'JOIN', ARCHIVE: 'ARCHIVE', RESTORE: 'RESTORE' }[pp.type];
  if (event && !rows_('MEMBERSHIP_HISTORY').some(function (h) { return h.ref_id === pp.change_id; })) {
    insertRow_('MEMBERSHIP_HISTORY', {
      history_id: newId_('H'), member_id: pp.member_id, unit_id: pp.unit_id, event: event,
      event_date: event === 'JOIN' ? (d.join_date || pp.decided_at.substring(0, 10)) : pp.decided_at.substring(0, 10),
      ref_id: pp.change_id, note: event === 'JOIN' ? 'Thêm hồ sơ' : (d.reason || ''), created_at: pp.decided_at, created_by: pp.approver
    });
  }
  var cr = findBy_('CHANGE_REQUESTS', 'change_id', pp.change_id);
  if (cr && cr.status !== 'APPROVED') {
    cr.status = 'APPROVED'; cr.decided_by = pp.approver; cr.decided_at = pp.decided_at; cr.updated_at = pp.decided_at; cr.version += 1;
    updateRow_('CHANGE_REQUESTS', cr);
  }
  if (!rows_('APPROVAL_ACTIONS').some(function (a) { return a.target_id === pp.change_id && (a.action === 'APPROVE' || a.action === 'SELF_APPROVE'); })) {
    approvalAction_('CHANGE', pp.change_id, pp.self_approve ? 'SELF_APPROVE' : 'APPROVE', pp.approver,
      pp.self_approve ? 'Quản trị tự duyệt theo cấu hình ALLOW_ADMIN_SELF_APPROVE' : '', pp.request_id);
  }
  return { change_id: pp.change_id, member_id: pp.member_id, member_code: m ? m.member_code : d.member_code };
}

function crApproveOne_(ctx, changeId, requestId) {
  return runOperation_(ctx, requestId, 'change.approve', null, function (op) {
    var cr = findBy_('CHANGE_REQUESTS', 'change_id', String(changeId || ''));
    if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
    var params = prepareApproval_(ctx, cr, requestId);
    op.params_json = JSON.stringify(params);
    updateRow_('OPERATIONS', op); // lưu tham số phục hồi trước khi ghi dữ liệu nghiệp vụ
    var res = applyChange_(params, ctx.user.email);
    audit_(ctx, params.self_approve ? 'CHANGE_SELF_APPROVE' : 'CHANGE_APPROVE', 'CHANGE', cr.change_id, 'OK', requestId, cr.request_type);
    res.message = 'Đã duyệt. Hồ sơ chính thức đã được cập nhật.';
    return res;
  });
}

function crApprove_(ctx, p, requestId) {
  return withLock_(function () { return crApproveOne_(ctx, p && p.change_id, requestId); });
}

function crApproveMany_(ctx, p, requestId) {
  var ids = (p && p.change_ids || []).slice(0, 50);
  if (!ids.length) throw AppError_(ERR.VALIDATION, 'Chưa chọn yêu cầu nào.');
  return withLock_(function () {
    var results = ids.map(function (id, i) {
      try {
        crApproveOne_(ctx, id, requestId.substring(0, 50) + '-' + i);
        return { change_id: id, ok: true };
      } catch (e) {
        if (e && e.__fault) throw e;
        return { change_id: id, ok: false, message: e.appCode ? e.message : 'Lỗi hệ thống' };
      }
    });
    var ok = results.filter(function (r) { return r.ok; }).length;
    return { results: results, message: 'Đã duyệt ' + ok + '/' + results.length + ' yêu cầu.' };
  });
}

function crReturn_(ctx, p, requestId) {
  var note = cleanStr_(p && p.note, 500);
  if (!note) throw AppError_(ERR.VALIDATION, 'Vui lòng ghi lý do trả lại để người lập biết cần sửa gì.', { note: 'Bắt buộc ghi lý do.' });
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'change.return', null, function () {
      var cr = findBy_('CHANGE_REQUESTS', 'change_id', String(p.change_id || ''));
      if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
      if (cr.status !== 'PENDING') throw AppError_(ERR.CONFLICT, 'Yêu cầu không còn ở trạng thái chờ duyệt.');
      assertCan_(ctx, 'approve', cr.unit_id, 'CHANGE', cr.change_id);
      cr.status = 'RETURNED'; cr.decided_by = ctx.user.email; cr.decided_at = now_(); cr.decision_note = note;
      cr.updated_at = cr.decided_at; cr.version += 1;
      updateRow_('CHANGE_REQUESTS', cr);
      approvalAction_('CHANGE', cr.change_id, 'RETURN', ctx.user.email, note, requestId);
      audit_(ctx, 'CHANGE_RETURN', 'CHANGE', cr.change_id, 'OK', requestId, '');
      return { change_id: cr.change_id, status: cr.status, message: 'Đã trả lại yêu cầu kèm lý do.' };
    });
  });
}
