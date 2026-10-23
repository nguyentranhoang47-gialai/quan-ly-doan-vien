/**
 * Transfers.gs — Chuyển sinh hoạt giữa các đơn vị.
 * Luồng: Đơn vị đi lập yêu cầu → Đơn vị đến xác nhận → Hoàn tất (đổi đơn vị chính thức + ghi lịch sử).
 * Từ chối (đơn vị đến) hoặc hủy (đơn vị đi) được phép trước khi hoàn tất.
 */

function trRow_(ctx, t, m) {
  return {
    transfer_id: t.transfer_id, member_id: t.member_id, member_name: m ? m.full_name : '(không rõ)',
    member_code: m ? m.member_code : '', from_unit: unitPath_(ctx, t.from_unit_id), to_unit: unitPath_(ctx, t.to_unit_id),
    proposed_date: t.proposed_date, effective_date: t.effective_date, reason: t.reason, status: t.status,
    status_label: TR_STATUS[t.status], created_by: t.created_by, created_at: t.created_at, decided_by: t.decided_by,
    decided_at: t.decided_at, decision_note: t.decision_note,
    can_confirm: t.status === 'PENDING' && can_(ctx, 'transfer', t.to_unit_id),
    can_cancel: t.status === 'PENDING' && (can_(ctx, 'edit', t.from_unit_id) || ctx.isAdmin)
  };
}

function trCreate_(ctx, p, requestId) {
  p = p || {};
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'transfer.create', null, function () {
      var m = findBy_('MEMBERS', 'member_id', String(p.member_id || ''));
      if (!m) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy hồ sơ đoàn viên.');
      if (m.archived) throw AppError_(ERR.CONFLICT, 'Hồ sơ đã lưu trữ, không chuyển sinh hoạt được.');
      // Đơn vị đi = đơn vị hiện tại của hồ sơ (lấy từ máy chủ, không tin trình duyệt)
      assertCan_(ctx, 'edit', m.unit_id, 'MEMBER', m.member_id);
      var toId = String(p.to_unit_id || '');
      var to = ctx.unitsById[toId];
      var errors = {};
      if (!to) errors.to_unit_id = 'Vui lòng chọn đơn vị đến.';
      else if (to.status !== 'active') errors.to_unit_id = 'Đơn vị đến đã ngừng hoạt động.';
      else if (toId === m.unit_id) errors.to_unit_id = 'Đơn vị đến trùng với đơn vị hiện tại.';
      var proposed = parseDate_(p.proposed_date || today_());
      if (!proposed) errors.proposed_date = 'Ngày đề nghị không hợp lệ.';
      var eff = parseDate_(p.effective_date);
      if (eff === null) errors.effective_date = 'Ngày hiệu lực không hợp lệ.';
      if (proposed && eff && eff < proposed) errors.effective_date = 'Ngày hiệu lực không được trước ngày đề nghị.';
      var reason = String(p.reason || '').trim();
      if (!reason) errors.reason = 'Vui lòng ghi lý do chuyển.';
      if (reason.length > 500) errors.reason = 'Lý do tối đa 500 ký tự.';
      if (Object.keys(errors).length) throw AppError_(ERR.VALIDATION, 'Thông tin chuyển sinh hoạt chưa hợp lệ.', errors);
      if (rows_('TRANSFER_REQUESTS').some(function (t) { return t.member_id === m.member_id && t.status === 'PENDING'; })) {
        throw AppError_(ERR.CONFLICT, 'Đoàn viên này đang có yêu cầu chuyển sinh hoạt chưa xử lý xong.');
      }
      var t = {
        transfer_id: newId_('TR'), member_id: m.member_id, from_unit_id: m.unit_id, to_unit_id: toId,
        proposed_date: proposed, effective_date: eff || '', reason: reason, status: 'PENDING',
        created_by: ctx.user.email, created_at: now_(), decided_by: '', decided_at: '', decision_note: '', version: 1
      };
      insertRow_('TRANSFER_REQUESTS', t);
      approvalAction_('TRANSFER', t.transfer_id, 'CREATE', ctx.user.email, '', requestId);
      audit_(ctx, 'TRANSFER_CREATE', 'TRANSFER', t.transfer_id, 'OK', requestId, '');
      return { transfer_id: t.transfer_id, message: 'Đã lập yêu cầu chuyển. Đang chờ đơn vị đến xác nhận.' };
    });
  });
}

/** box: 'incoming' (chờ đơn vị tôi xác nhận) | 'outgoing' (đơn vị tôi chuyển đi) | 'all' */
function trList_(ctx, p) {
  p = p || {};
  var box = p.box || 'incoming';
  var membersById = {};
  rows_('MEMBERS').forEach(function (m) { membersById[m.member_id] = m; });
  var list = rows_('TRANSFER_REQUESTS').filter(function (t) {
    var inScope = can_(ctx, 'view', t.from_unit_id) || can_(ctx, 'view', t.to_unit_id);
    if (!inScope) return false;
    if (box === 'incoming' && !(t.status === 'PENDING' && can_(ctx, 'transfer', t.to_unit_id))) return false;
    if (box === 'outgoing' && !can_(ctx, 'view', t.from_unit_id)) return false;
    if (p.status && t.status !== p.status) return false;
    return true;
  }).reverse();
  return paginate_(list, p, function (t) { return trRow_(ctx, t, membersById[t.member_id]); });
}

function trDecide_(ctx, p, requestId, decision) {
  p = p || {};
  return withLock_(function () {
    var actionName = decision === 'confirm' ? 'transfer.confirm' : decision === 'reject' ? 'transfer.reject' : 'transfer.cancel';
    return runOperation_(ctx, requestId, actionName, null, function (op) {
      var t = findBy_('TRANSFER_REQUESTS', 'transfer_id', String(p.transfer_id || ''));
      if (!t) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu chuyển.');
      if (t.status !== 'PENDING') throw AppError_(ERR.CONFLICT, 'Yêu cầu chuyển đã được xử lý (' + TR_STATUS[t.status] + ').');
      var note = cleanStr_(p.note, 500);
      if (decision === 'cancel') {
        if (!(can_(ctx, 'edit', t.from_unit_id) || ctx.isAdmin)) assertCan_(ctx, 'edit', t.from_unit_id, 'TRANSFER', t.transfer_id);
      } else {
        assertCan_(ctx, 'transfer', t.to_unit_id, 'TRANSFER', t.transfer_id);
      }
      if (decision === 'reject' && !note) throw AppError_(ERR.VALIDATION, 'Vui lòng ghi lý do từ chối.', { note: 'Bắt buộc ghi lý do.' });

      if (decision === 'confirm') {
        var m = findBy_('MEMBERS', 'member_id', t.member_id);
        if (!m) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy hồ sơ đoàn viên.');
        if (m.unit_id !== t.from_unit_id) throw AppError_(ERR.CONFLICT, 'Đơn vị hiện tại của đoàn viên không còn khớp với đơn vị đi. Hãy hủy yêu cầu này.');
        var to = ctx.unitsById[t.to_unit_id];
        if (!to || to.status !== 'active') throw AppError_(ERR.CONFLICT, 'Đơn vị đến đã ngừng hoạt động.');
        var eff = parseDate_(p.effective_date || t.effective_date || today_());
        if (!eff) throw AppError_(ERR.VALIDATION, 'Ngày hiệu lực không hợp lệ.', { effective_date: 'Ngày không hợp lệ.' });
        var params = { transfer_id: t.transfer_id, member_id: m.member_id, from_unit_id: t.from_unit_id, to_unit_id: t.to_unit_id,
          base_version: m.version, effective_date: eff, actor: ctx.user.email, at: now_(), note: note, request_id: requestId };
        op.params_json = JSON.stringify(params);
        updateRow_('OPERATIONS', op);
        applyTransfer_(params);
        audit_(ctx, 'TRANSFER_CONFIRM', 'TRANSFER', t.transfer_id, 'OK', requestId, '');
        return { transfer_id: t.transfer_id, status: 'COMPLETED', message: 'Đã xác nhận. Đoàn viên đã chuyển sang đơn vị mới, mã đoàn viên giữ nguyên.' };
      }
      t.status = decision === 'reject' ? 'REJECTED' : 'CANCELLED';
      t.decided_by = ctx.user.email; t.decided_at = now_(); t.decision_note = note; t.version += 1;
      updateRow_('TRANSFER_REQUESTS', t);
      approvalAction_('TRANSFER', t.transfer_id, decision === 'reject' ? 'REJECT' : 'CANCEL', ctx.user.email, note, requestId);
      audit_(ctx, decision === 'reject' ? 'TRANSFER_REJECT' : 'TRANSFER_CANCEL', 'TRANSFER', t.transfer_id, 'OK', requestId, '');
      return { transfer_id: t.transfer_id, status: t.status, message: decision === 'reject' ? 'Đã từ chối yêu cầu chuyển.' : 'Đã hủy yêu cầu chuyển.' };
    });
  });
}

/** Hoàn tất chuyển — LŨY ĐẲNG (dùng cho phục hồi). */
function applyTransfer_(pp) {
  var m = findBy_('MEMBERS', 'member_id', pp.member_id);
  if (m && m.last_ref !== pp.transfer_id) {
    m.unit_id = pp.to_unit_id; m.version = pp.base_version + 1; m.updated_at = pp.at; m.updated_by = pp.actor; m.last_ref = pp.transfer_id;
    updateRow_('MEMBERS', m);
  }
  faultPoint_('transfer_after_member');
  var hist = rows_('MEMBERSHIP_HISTORY');
  var has = function (ev) { return hist.some(function (h) { return h.ref_id === pp.transfer_id && h.event === ev; }); };
  var add = [];
  if (!has('TRANSFER_OUT')) add.push({ history_id: newId_('H'), member_id: pp.member_id, unit_id: pp.from_unit_id, event: 'TRANSFER_OUT',
    event_date: pp.effective_date, ref_id: pp.transfer_id, note: 'Chuyển đi', created_at: pp.at, created_by: pp.actor });
  if (!has('TRANSFER_IN')) add.push({ history_id: newId_('H'), member_id: pp.member_id, unit_id: pp.to_unit_id, event: 'TRANSFER_IN',
    event_date: pp.effective_date, ref_id: pp.transfer_id, note: 'Chuyển đến', created_at: pp.at, created_by: pp.actor });
  insertRows_('MEMBERSHIP_HISTORY', add);
  var t = findBy_('TRANSFER_REQUESTS', 'transfer_id', pp.transfer_id);
  if (t && t.status !== 'COMPLETED') {
    t.status = 'COMPLETED'; t.effective_date = pp.effective_date; t.decided_by = pp.actor; t.decided_at = pp.at;
    t.decision_note = pp.note || ''; t.version += 1;
    updateRow_('TRANSFER_REQUESTS', t);
  }
  if (!rows_('APPROVAL_ACTIONS').some(function (a) { return a.target_id === pp.transfer_id && a.action === 'CONFIRM'; })) {
    approvalAction_('TRANSFER', pp.transfer_id, 'CONFIRM', pp.actor, pp.note || '', pp.request_id);
  }
  return { transfer_id: pp.transfer_id };
}
