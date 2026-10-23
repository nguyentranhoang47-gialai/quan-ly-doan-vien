/**
 * Dues.gs — Ghi nhận đoàn phí (không tích hợp thanh toán).
 *  - Mỗi đoàn viên chỉ có MỘT ghi nhận hiệu lực (ACTIVE) cho một kỳ (yyyy-MM).
 *  - Tiền là số nguyên VND, không âm. Hệ thống KHÔNG tự áp mức thu theo quy định pháp lý.
 *  - Mọi tạo/điều chỉnh/hủy đều ghi DUES_HISTORY.
 */

function validPeriod_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})$/);
  return !!(m && +m[1] >= 2000 && +m[1] <= 2100 && +m[2] >= 1 && +m[2] <= 12);
}

function money_(v, label, errors, key, required) {
  var n = parseIntStrict_(v);
  if (n === null) { if (required) errors[key] = 'Vui lòng nhập ' + label + '.'; return 0; }
  if (isNaN(n) || n < 0 || n > 1000000000) { errors[key] = label + ' phải là số nguyên VND từ 0 đến 1.000.000.000.'; return 0; }
  return n;
}

function duesHistory_(duesId, action, oldR, newR, reason, actor) {
  insertRow_('DUES_HISTORY', {
    entry_id: newId_('DH'), dues_id: duesId, action: action,
    old_due: oldR ? oldR.amount_due : '', new_due: newR ? newR.amount_due : '',
    old_paid: oldR ? oldR.amount_paid : '', new_paid: newR ? newR.amount_paid : '',
    reason: reason || '', actor: actor, at: now_()
  });
}

function activeDues_(memberId, period) {
  var rs = rows_('DUES');
  for (var i = 0; i < rs.length; i++) if (rs[i].member_id === memberId && rs[i].period === period && rs[i].status === 'ACTIVE') return rs[i];
  return null;
}

/** Danh sách đoàn viên trong phạm vi + tình trạng đoàn phí của kỳ. */
function duesList_(ctx, p) {
  p = p || {};
  if (!validPeriod_(p.period)) throw AppError_(ERR.VALIDATION, 'Vui lòng chọn kỳ thu (tháng/năm).');
  var members = queryMembers_(ctx, { unit_id: p.unit_id, q: p.q, archived: 'active' });
  var byMember = {};
  rows_('DUES').forEach(function (d) { if (d.period === p.period && d.status === 'ACTIVE') byMember[d.member_id] = d; });
  var list = sortMembers_(members, 'full_name').map(function (m) {
    var d = byMember[m.member_id];
    var state = !d ? 'none' : d.amount_paid >= d.amount_due ? 'paid' : d.amount_paid > 0 ? 'partial' : 'unpaid';
    return { m: m, d: d, state: state };
  }).filter(function (x) { return !p.state || x.state === p.state; });
  var res = paginate_(list, p, function (x) {
    return { member_id: x.m.member_id, member_code: x.m.member_code, full_name: x.m.full_name, unit_name: unitName_(ctx, x.m.unit_id),
      can_record: can_(ctx, 'dues', x.m.unit_id), state: x.state,
      dues: x.d ? plain_(x.d, ['dues_id', 'amount_due', 'amount_paid', 'paid_date', 'note', 'recorded_by', 'recorded_at', 'version']) : null };
  });
  res.summary = duesTotals_(list.map(function (x) { return x.d; }).filter(Boolean), list.length);
  return res;
}

function duesTotals_(records, memberCount) {
  var due = 0, paid = 0;
  records.forEach(function (d) { due += d.amount_due || 0; paid += d.amount_paid || 0; });
  return { members: memberCount, recorded: records.length, due: due, paid: paid, missing: Math.max(due - paid, 0) };
}

/** Tạo ghi nhận cho nhiều đoàn viên (cá nhân = danh sách 1 dòng). Bỏ qua đoàn viên đã có ghi nhận kỳ này. */
function duesRecord_(ctx, p, requestId) {
  p = p || {};
  if (!validPeriod_(p.period)) throw AppError_(ERR.VALIDATION, 'Vui lòng chọn kỳ thu (tháng/năm).');
  var items = (p.items || []).slice(0, 500);
  if (!items.length) throw AppError_(ERR.VALIDATION, 'Chưa có dòng nào để ghi nhận.');
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'dues.record', null, function () {
      var created = [], skipped = [], failed = [];
      var toInsert = [], seen = {};
      items.forEach(function (it, i) {
        var m = findBy_('MEMBERS', 'member_id', String(it.member_id || ''));
        if (!m || m.archived) { failed.push({ index: i, message: 'Không tìm thấy hồ sơ đang hiệu lực.' }); return; }
        if (!can_(ctx, 'dues', m.unit_id)) {
          audit_(ctx, 'DENIED_DUES', 'MEMBER', m.member_id, 'DENIED', requestId, '');
          failed.push({ index: i, member_code: m.member_code, message: 'Bạn không được cấp quyền ghi đoàn phí cho đơn vị này.' }); return;
        }
        if (seen[m.member_id] || activeDues_(m.member_id, p.period)) { skipped.push({ index: i, member_code: m.member_code, message: 'Đã có ghi nhận kỳ này — dùng "Điều chỉnh".' }); return; }
        var errors = {};
        var due = money_(it.amount_due, 'số phải thu', errors, 'amount_due', true);
        var paid = money_(it.amount_paid === '' || it.amount_paid === undefined ? 0 : it.amount_paid, 'số đã thu', errors, 'amount_paid', false);
        var pd = parseDate_(it.paid_date);
        if (pd === null) errors.paid_date = 'Ngày thu không hợp lệ.';
        if (paid > 0 && !pd) pd = today_();
        var note = String(it.note || '').trim().substring(0, 500);
        if (Object.keys(errors).length) { failed.push({ index: i, member_code: m.member_code, message: Object.keys(errors).map(function (k) { return errors[k]; }).join(' ') }); return; }
        seen[m.member_id] = true;
        toInsert.push({ dues_id: newId_('DUE'), member_id: m.member_id, unit_id: m.unit_id, period: p.period, amount_due: due,
          amount_paid: paid, paid_date: pd || '', note: note, status: 'ACTIVE', recorded_by: ctx.user.email,
          recorded_at: now_(), updated_by: '', updated_at: '', version: 1 });
      });
      insertRows_('DUES', toInsert);
      toInsert.forEach(function (d) {
        created.push(d.dues_id);
      });
      // Lịch sử theo lô
      insertRows_('DUES_HISTORY', toInsert.map(function (d) {
        return { entry_id: newId_('DH'), dues_id: d.dues_id, action: 'CREATE', old_due: '', new_due: d.amount_due, old_paid: '',
          new_paid: d.amount_paid, reason: '', actor: ctx.user.email, at: now_() };
      }));
      audit_(ctx, 'DUES_RECORD', 'DUES', p.period, 'OK', requestId, 'Tạo ' + created.length + ', bỏ qua ' + skipped.length + ', lỗi ' + failed.length);
      return { created: created.length, skipped: skipped, failed: failed,
        message: 'Đã ghi nhận ' + created.length + ' đoàn viên.' + (skipped.length ? ' Bỏ qua ' + skipped.length + ' đã có ghi nhận.' : '') +
          (failed.length ? ' ' + failed.length + ' dòng lỗi.' : '') };
    });
  });
}

/** Điều chỉnh hoặc hủy (void) một ghi nhận — bắt buộc lý do, kiểm tra phiên bản. */
function duesAdjust_(ctx, p, requestId) {
  p = p || {};
  var reason = cleanStr_(p.reason, 500);
  if (!reason) throw AppError_(ERR.VALIDATION, 'Vui lòng ghi lý do điều chỉnh.', { reason: 'Bắt buộc ghi lý do.' });
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'dues.adjust', null, function () {
      var d = findBy_('DUES', 'dues_id', String(p.dues_id || ''));
      if (!d || d.status !== 'ACTIVE') throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy ghi nhận đoàn phí.');
      assertCan_(ctx, 'dues', d.unit_id, 'DUES', d.dues_id);
      if (parseInt(p.version, 10) !== d.version) throw AppError_(ERR.CONFLICT, 'Ghi nhận này vừa được người khác điều chỉnh. Hãy tải lại rồi thử lại.');
      var old = plain_(d);
      if (p.void) {
        d.status = 'VOID';
      } else {
        var errors = {};
        d.amount_due = money_(p.amount_due, 'số phải thu', errors, 'amount_due', true);
        d.amount_paid = money_(p.amount_paid, 'số đã thu', errors, 'amount_paid', true);
        var pd = parseDate_(p.paid_date);
        if (pd === null) errors.paid_date = 'Ngày thu không hợp lệ.';
        if (Object.keys(errors).length) throw AppError_(ERR.VALIDATION, 'Dữ liệu chưa hợp lệ.', errors);
        d.paid_date = pd || (d.amount_paid > 0 ? (d.paid_date || today_()) : '');
        if (p.note !== undefined) d.note = String(p.note || '').trim().substring(0, 500);
      }
      d.updated_by = ctx.user.email; d.updated_at = now_(); d.version += 1;
      updateRow_('DUES', d);
      duesHistory_(d.dues_id, p.void ? 'VOID' : 'ADJUST', old, d, reason, ctx.user.email);
      audit_(ctx, p.void ? 'DUES_VOID' : 'DUES_ADJUST', 'DUES', d.dues_id, 'OK', requestId, '');
      return { dues_id: d.dues_id, message: p.void ? 'Đã hủy ghi nhận.' : 'Đã điều chỉnh ghi nhận.' };
    });
  });
}

function duesHistoryList_(ctx, p) {
  var d = findBy_('DUES', 'dues_id', String(p && p.dues_id || ''));
  if (!d) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy ghi nhận.');
  assertCan_(ctx, 'view', d.unit_id, 'DUES', d.dues_id);
  return { items: rows_('DUES_HISTORY').filter(function (h) { return h.dues_id === d.dues_id; }).map(function (h) { return plain_(h); }) };
}

/** Tổng hợp theo đơn vị cho một kỳ (hoặc khoảng kỳ). */
function duesSummary_(ctx, p) {
  p = p || {};
  var from = p.from || p.period, to = p.to || p.period;
  if (!validPeriod_(from) || !validPeriod_(to)) throw AppError_(ERR.VALIDATION, 'Vui lòng chọn kỳ thu hợp lệ.');
  var units = unitsWith_(ctx, 'view', p.unit_id || '', true);
  var allowed = {};
  units.forEach(function (u) { allowed[u] = true; });
  var agg = {};
  rows_('DUES').forEach(function (d) {
    if (d.status !== 'ACTIVE' || !allowed[d.unit_id] || d.period < from || d.period > to) return;
    var a = agg[d.unit_id] = agg[d.unit_id] || { unit_id: d.unit_id, unit: unitPath_(ctx, d.unit_id), recorded: 0, due: 0, paid: 0 };
    a.recorded++; a.due += d.amount_due; a.paid += d.amount_paid;
  });
  var items = Object.keys(agg).map(function (k) { var a = agg[k]; a.missing = Math.max(a.due - a.paid, 0); return a; })
    .sort(function (a, b) { return a.unit.localeCompare(b.unit, 'vi'); });
  var total = items.reduce(function (s, a) { s.recorded += a.recorded; s.due += a.due; s.paid += a.paid; s.missing += a.missing; return s; },
    { recorded: 0, due: 0, paid: 0, missing: 0 });
  return { from: from, to: to, items: items, total: total };
}
