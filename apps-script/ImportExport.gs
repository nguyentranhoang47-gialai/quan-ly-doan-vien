/**
 * ImportExport.gs — Nhập CSV (qua quy trình duyệt), xuất CSV, báo cáo và tổng quan.
 */

/** Cột của file nhập mẫu: mã trường → nhãn tiếng Việt (giao diện dùng để ghép cột). */
var IMPORT_COLUMNS = [
  ['member_code', 'Mã đoàn viên'], ['full_name', 'Họ và tên'], ['dob', 'Ngày sinh'], ['gender', 'Giới tính'],
  ['id_type', 'Loại giấy tờ'], ['id_number', 'Số giấy tờ'], ['phone', 'Số điện thoại'], ['email', 'Email'],
  ['address', 'Địa chỉ'], ['unit_code', 'Mã đơn vị'], ['join_date', 'Ngày vào công đoàn'],
  ['union_position', 'Chức vụ công đoàn'], ['member_status', 'Tình trạng sinh hoạt'], ['note', 'Ghi chú']
];

function statusFromInput_(v) {
  var s = String(v || '').trim();
  if (!s) return 'ACTIVE';
  if (MEMBER_STATUS[s.toUpperCase()]) return s.toUpperCase();
  var n = normalizeText_(s);
  for (var k in MEMBER_STATUS) if (normalizeText_(MEMBER_STATUS[k]) === n) return k;
  return s; // để validateMember_ báo lỗi
}

/** Kiểm tra toàn bộ lô. Không ghi dữ liệu. */
function importAnalyze_(ctx, p) {
  var rows = (p && p.rows) || [];
  if (!rows.length) throw AppError_(ERR.VALIDATION, 'Tệp không có dòng dữ liệu nào.');
  if (rows.length > APP.IMPORT_MAX_ROWS) throw AppError_(ERR.VALIDATION, 'Mỗi lần nhập tối đa ' + APP.IMPORT_MAX_ROWS + ' dòng. Hãy chia tệp nhỏ hơn.');
  var unitByCode = {};
  rows_('UNITS').forEach(function (u) { unitByCode[String(u.code).toUpperCase()] = u; });
  var defaultUnit = String(p.default_unit_id || '');
  var keyNameDob = {};
  rows_('MEMBERS').forEach(function (m) { if (m.dob) keyNameDob[m.name_search + '|' + m.dob + '|' + m.unit_id] = m.member_code; });
  rows_('CHANGE_REQUESTS').forEach(function (c) {
    if ((c.status === 'PENDING' || c.status === 'DRAFT') && c.request_type === 'CREATE') {
      var d = safeJson_(c.payload_json, {});
      if (d.dob) keyNameDob[normalizeText_(d.full_name) + '|' + d.dob + '|' + d.unit_id] = '(yêu cầu đang chờ)';
    }
  });
  var seenCode = {}, seenId = {}, seenKey = {};
  var results = rows.map(function (raw, i) {
    var rowNo = parseInt(raw && raw.__row, 10) || (i + 2);
    var input = {};
    IMPORT_COLUMNS.forEach(function (c) { input[c[0]] = raw && raw[c[0]] !== undefined ? raw[c[0]] : ''; });
    input.member_status = statusFromInput_(input.member_status);
    var errors = {};
    var unitCode = String(input.unit_code || '').trim().toUpperCase();
    var unit = unitCode ? unitByCode[unitCode] : ctx.unitsById[defaultUnit];
    if (!unit) errors.unit_code = unitCode ? 'Không có đơn vị mã "' + unitCode + '".' : 'Thiếu mã đơn vị (hoặc chọn đơn vị mặc định).';
    else if (unit.status !== 'active') errors.unit_code = 'Đơn vị đã ngừng hoạt động.';
    else if (!can_(ctx, 'edit', unit.unit_id)) errors.unit_code = 'Bạn không có quyền nhập cho đơn vị này.';
    input.unit_id = unit ? unit.unit_id : '';
    var v = validateMember_(input, 'create');
    Object.keys(v.errors).forEach(function (k) { if (k !== 'unit_id') errors[k] = v.errors[k]; });
    var d = v.data;
    if (!errors.member_code && !errors.id_number) {
      var dup = duplicateErrors_(d, '__none__', '');
      Object.keys(dup).forEach(function (k) { errors[k] = dup[k]; });
    }
    var codeKey = (d.member_code || '').toUpperCase();
    if (codeKey) { if (seenCode[codeKey]) errors.member_code = 'Trùng mã đoàn viên với dòng ' + seenCode[codeKey] + ' trong tệp.'; else seenCode[codeKey] = rowNo; }
    if (d.id_number) { if (seenId[d.id_number]) errors.id_number = 'Trùng số giấy tờ với dòng ' + seenId[d.id_number] + ' trong tệp.'; else seenId[d.id_number] = rowNo; }
    if (d.dob && d.unit_id && !p.allow_name_dob_dup) {
      var k = normalizeText_(d.full_name) + '|' + d.dob + '|' + d.unit_id;
      if (keyNameDob[k]) errors.full_name = 'Có thể trùng với hồ sơ ' + keyNameDob[k] + ' (cùng họ tên, ngày sinh, đơn vị).';
      else if (seenKey[k]) errors.full_name = 'Trùng họ tên + ngày sinh với dòng ' + seenKey[k] + ' trong tệp.';
      else seenKey[k] = rowNo;
    }
    var msgs = Object.keys(errors).map(function (k) { return (fieldLabels_()[k] || (k === 'unit_code' ? 'Mã đơn vị' : k)) + ': ' + errors[k]; });
    return { row: rowNo, ok: !msgs.length, errors: msgs, data: d, name: d.full_name };
  });
  return results;
}

function importCheck_(ctx, p) {
  if (!hasAny_(ctx, 'edit')) assertCan_(ctx, 'edit', '__none__');
  var res = importAnalyze_(ctx, p);
  return {
    total: res.length, ok: res.filter(function (r) { return r.ok; }).length,
    rows: res.map(function (r) { return { row: r.row, ok: r.ok, errors: r.errors, name: r.name }; })
  };
}

function importCommit_(ctx, p, requestId) {
  if (!hasAny_(ctx, 'edit')) assertCan_(ctx, 'edit', '__none__');
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'import.commit', null, function () {
      var res = importAnalyze_(ctx, p); // máy chủ kiểm tra lại toàn bộ
      var good = res.filter(function (r) { return r.ok; });
      var bad = res.filter(function (r) { return !r.ok; });
      var jobId = newId_('IMP');
      var t = now_();
      var submit = p.submit !== false;
      var crs = good.map(function (r) {
        return {
          change_id: newId_('CR'), request_type: 'CREATE', member_id: newId_('M'), unit_id: r.data.unit_id,
          status: submit ? 'PENDING' : 'DRAFT', payload_json: JSON.stringify(r.data), old_json: '', base_version: '',
          summary: crSummary_('CREATE', r.data.full_name), import_job_id: jobId, created_by: ctx.user.email,
          created_at: t, updated_at: t, submitted_at: submit ? t : '', decided_by: '', decided_at: '', decision_note: '', version: 1
        };
      });
      insertRows_('CHANGE_REQUESTS', crs);
      insertRows_('APPROVAL_ACTIONS', crs.map(function (c) {
        return { action_id: newId_('ACT'), target_type: 'CHANGE', target_id: c.change_id, action: submit ? 'SUBMIT' : 'SAVE_DRAFT',
          actor: ctx.user.email, at: t, note: 'Nhập từ tệp, lô ' + jobId, request_id: requestId };
      }));
      var report = bad.map(function (r) { return { row: r.row, errors: r.errors }; });
      insertRow_('IMPORT_JOBS', {
        job_id: jobId, request_id: requestId, file_name: cleanStr_(p.file_name || '', 200).substring(0, 200),
        unit_id: p.default_unit_id || '', total_rows: res.length, ok_rows: good.length, error_rows: bad.length,
        status: 'DONE', report_json: JSON.stringify(report).substring(0, 45000), created_by: ctx.user.email, created_at: t
      });
      audit_(ctx, 'IMPORT', 'IMPORT_JOB', jobId, 'OK', requestId, 'Thành công ' + good.length + ', lỗi ' + bad.length);
      return { job_id: jobId, ok: good.length, failed: bad.length, report: report,
        message: 'Đã tạo ' + good.length + ' yêu cầu thêm mới' + (submit ? ' chờ duyệt' : ' (nháp)') + '. ' +
          (bad.length ? bad.length + ' dòng lỗi không được nhập.' : '') };
    });
  });
}

function importJobs_(ctx, p) {
  var list = rows_('IMPORT_JOBS').filter(function (j) { return ctx.isAdmin || j.created_by === ctx.user.email; }).reverse();
  return paginate_(list, p, function (j) {
    return { job_id: j.job_id, file_name: j.file_name, total_rows: j.total_rows, ok_rows: j.ok_rows, error_rows: j.error_rows,
      created_by: j.created_by, created_at: j.created_at, report: safeJson_(j.report_json, []) };
  });
}

/* ============================ XUẤT CSV ============================ */

/** Chống CSV/Formula injection: ô bắt đầu bằng = + - @ tab CR được thêm dấu ' phía trước. */
function csvCell_(v) {
  var s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCsv_(header, rows) {
  return '﻿' + [header].concat(rows).map(function (r) { return r.map(csvCell_).join(','); }).join('\r\n');
}
function fmtDateVN_(s) { return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.substring(8, 10) + '/' + s.substring(5, 7) + '/' + s.substring(0, 4) : (s || ''); }

var EXPORT_FIELDS = ['member_code', 'full_name', 'dob', 'gender', 'id_type', 'id_number', 'phone', 'email', 'address',
  'unit', 'join_date', 'union_position', 'member_status', 'note'];

function exportMembers_(ctx, p, requestId) {
  p = p || {};
  var list = sortMembers_(queryMembers_(ctx, p), p.sort, p.dir);
  if (list.length > APP.EXPORT_MAX_ROWS) throw AppError_(ERR.VALIDATION, 'Quá nhiều dòng (' + list.length + '). Hãy lọc theo đơn vị để xuất từng phần.');
  var fields = (p.fields && p.fields.length ? p.fields : EXPORT_FIELDS).filter(function (f) { return EXPORT_FIELDS.indexOf(f) >= 0; });
  var header = fields.map(function (f) { return f === 'unit' ? 'Đơn vị' : fieldLabels_()[f]; });
  var rows = list.map(function (m) {
    var v = memberView_(ctx, m);
    return fields.map(function (f) {
      if (f === 'unit') return unitPath_(ctx, m.unit_id);
      if (f === 'member_status') return v.status_label;
      if ((f === 'dob' || f === 'join_date') && /^\d{4}-\d{2}-\d{2}$/.test(v[f])) return fmtDateVN_(v[f]);
      return v[f];
    });
  });
  audit_(ctx, 'EXPORT_MEMBERS', 'MEMBER', '', 'OK', requestId, 'Số dòng: ' + rows.length);
  return { filename: 'danh-sach-doan-vien-' + today_() + '.csv', csv: toCsv_(header, rows), count: rows.length };
}

/** Thống kê theo đơn vị: tổng, theo tình trạng, theo giới tính. */
function reportByUnit_(ctx, p) {
  var list = queryMembers_(ctx, { unit_id: p && p.unit_id, archived: 'active' });
  var agg = {};
  list.forEach(function (m) {
    var a = agg[m.unit_id] = agg[m.unit_id] || { unit_id: m.unit_id, unit: unitPath_(ctx, m.unit_id), total: 0, male: 0, female: 0, other: 0, byStatus: {} };
    a.total++;
    if (m.gender === 'Nam') a.male++; else if (m.gender === 'Nữ') a.female++; else a.other++;
    a.byStatus[m.member_status] = (a.byStatus[m.member_status] || 0) + 1;
  });
  var items = Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (a, b) { return a.unit.localeCompare(b.unit, 'vi'); });
  var total = { total: list.length, male: 0, female: 0, other: 0, byStatus: {} };
  items.forEach(function (a) {
    total.male += a.male; total.female += a.female; total.other += a.other;
    Object.keys(a.byStatus).forEach(function (s) { total.byStatus[s] = (total.byStatus[s] || 0) + a.byStatus[s]; });
  });
  return { items: items, total: total, statusLabels: MEMBER_STATUS };
}

function exportReport_(ctx, p, requestId) {
  p = p || {};
  var csv, filename;
  if (p.type === 'dues') {
    var s = duesSummary_(ctx, p);
    csv = toCsv_(['Đơn vị', 'Số ghi nhận', 'Phải thu (VND)', 'Đã thu (VND)', 'Còn thiếu (VND)'],
      s.items.map(function (a) { return [a.unit, a.recorded, a.due, a.paid, a.missing]; })
        .concat([['TỔNG CỘNG', s.total.recorded, s.total.due, s.total.paid, s.total.missing]]));
    filename = 'doan-phi-' + s.from + (s.to !== s.from ? '-den-' + s.to : '') + '.csv';
  } else if (p.type === 'dues_detail') {
    if (!validPeriod_(p.period)) throw AppError_(ERR.VALIDATION, 'Vui lòng chọn kỳ thu.');
    var all = duesList_(ctx, { period: p.period, unit_id: p.unit_id, pageSize: APP.PAGE_SIZE_MAX, page: 1 });
    var items = [];
    for (var pg = 1; pg <= all.pages; pg++) items = items.concat(pg === 1 ? all.items : duesList_(ctx, { period: p.period, unit_id: p.unit_id, pageSize: APP.PAGE_SIZE_MAX, page: pg }).items);
    var stateLabel = { none: 'Chưa ghi nhận', paid: 'Đã thu đủ', partial: 'Thu một phần', unpaid: 'Chưa thu' };
    csv = toCsv_(['Mã đoàn viên', 'Họ và tên', 'Đơn vị', 'Kỳ', 'Phải thu (VND)', 'Đã thu (VND)', 'Còn thiếu (VND)', 'Ngày thu', 'Tình trạng', 'Ghi chú'],
      items.map(function (x) {
        var d = x.dues;
        return [x.member_code, x.full_name, x.unit_name, p.period, d ? d.amount_due : '', d ? d.amount_paid : '',
          d ? Math.max(d.amount_due - d.amount_paid, 0) : '', d ? fmtDateVN_(d.paid_date) : '', stateLabel[x.state], d ? d.note : ''];
      }));
    filename = 'doan-phi-chi-tiet-' + p.period + '.csv';
  } else {
    var r = reportByUnit_(ctx, p);
    var statusKeys = Object.keys(MEMBER_STATUS);
    csv = toCsv_(['Đơn vị', 'Tổng số', 'Nam', 'Nữ', 'Khác/chưa ghi'].concat(statusKeys.map(function (k) { return MEMBER_STATUS[k]; })),
      r.items.map(function (a) { return [a.unit, a.total, a.male, a.female, a.other].concat(statusKeys.map(function (k) { return a.byStatus[k] || 0; })); })
        .concat([['TỔNG CỘNG', r.total.total, r.total.male, r.total.female, r.total.other].concat(statusKeys.map(function (k) { return r.total.byStatus[k] || 0; }))]));
    filename = 'thong-ke-theo-don-vi-' + today_() + '.csv';
  }
  audit_(ctx, 'EXPORT_REPORT', 'REPORT', p.type || 'by_unit', 'OK', requestId, '');
  return { filename: filename, csv: csv };
}

/* ============================ TỔNG QUAN ============================ */

function dashboard_(ctx) {
  var members = queryMembers_(ctx, { archived: 'active' });
  var byStatus = {};
  members.forEach(function (m) { byStatus[m.member_status] = (byStatus[m.member_status] || 0) + 1; });
  var me = ctx.user.email;
  var crs = rows_('CHANGE_REQUESTS');
  var toApprove = crs.filter(function (c) { return c.status === 'PENDING' && can_(ctx, 'approve', c.unit_id) && (c.created_by !== me || selfApproveAllowed_(ctx)); }).length;
  var myReturned = crs.filter(function (c) { return c.created_by === me && c.status === 'RETURNED'; }).length;
  var myDrafts = crs.filter(function (c) { return c.created_by === me && c.status === 'DRAFT'; }).length;
  var myPending = crs.filter(function (c) { return c.created_by === me && c.status === 'PENDING'; }).length;
  var incoming = rows_('TRANSFER_REQUESTS').filter(function (t) { return t.status === 'PENDING' && can_(ctx, 'transfer', t.to_unit_id); }).length;
  var period = today_().substring(0, 7);
  var duesNow = duesSummary_(ctx, { period: period }).total;
  var warnings = [];
  var totalAll = rows_('MEMBERS').length;
  var limit = parseInt(getSetting_('MEMBERS_WARN_LIMIT', '8000'), 10) || 8000;
  if (ctx.isAdmin) {
    if (totalAll >= limit) warnings.push('Số hồ sơ (' + totalAll + ') đã vượt ngưỡng ' + limit + '. Tốc độ có thể chậm; cân nhắc lưu trữ bớt hoặc tách dữ liệu.');
    else if (totalAll >= limit * 0.8) warnings.push('Số hồ sơ (' + totalAll + ') sắp đạt ngưỡng vận hành ' + limit + '.');
    var stale = pendingOperations_().length;
    if (stale) warnings.push('Có ' + stale + ' thao tác bị gián đoạn. Vào Quản trị → Vận hành → "Phục hồi thao tác dở dang".');
    var last = getSetting_('LAST_BACKUP_AT', '');
    if (!last || minutesSince_(last) > 48 * 60) warnings.push('Chưa có bản sao lưu trong 2 ngày gần đây. Vào Quản trị → Sao lưu.');
    try { var q = MailApp.getRemainingDailyQuota(); if (q < 10) warnings.push('Hạn mức gửi email hôm nay còn ' + q + ' lượt — người dùng có thể không nhận được mã đăng nhập.'); } catch (e) { }
  }
  return {
    totalMembers: members.length, byStatus: byStatus, statusLabels: MEMBER_STATUS,
    toApprove: toApprove, myReturned: myReturned, myDrafts: myDrafts, myPending: myPending, incomingTransfers: incoming,
    duesPeriod: period, dues: duesNow, warnings: warnings
  };
}
