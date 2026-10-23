/**
 * Members.gs — Tra cứu, xem chi tiết và kiểm tra dữ liệu hồ sơ đoàn viên.
 * Thêm/sửa/lưu trữ đều đi qua yêu cầu phê duyệt (Approvals.gs).
 */

var LIST_FIELDS = ['member_id', 'member_code', 'full_name', 'dob', 'gender', 'phone', 'unit_id', 'member_status',
  'union_position', 'archived', 'version'];
var SORTABLE = { full_name: 'name_search', member_code: 'member_code', dob: 'dob', join_date: 'join_date', updated_at: 'updated_at' };

function maskValue_(field, v) {
  if (!v) return v;
  if (field === 'id_number') return v.length > 4 ? new Array(v.length - 3).join('•') + v.slice(-4) : '••••';
  if (field === 'dob') return v.substring(0, 4) + '-••-••';
  if (field === 'address') return '(ẩn — chỉ cán bộ/người duyệt được xem)';
  return v;
}

/** Bản xem của một hồ sơ theo quyền người xem. */
function memberView_(ctx, m, fields) {
  var o = plain_(m, fields || SCHEMA.MEMBERS.columns.map(function (c) { return c[0]; }));
  delete o.name_search;
  if (viewOnlyAt_(ctx, m.unit_id)) MEMBER_SENSITIVE.forEach(function (f) { if (f in o) o[f] = maskValue_(f, o[f]); });
  o.unit_name = unitName_(ctx, m.unit_id);
  o.status_label = MEMBER_STATUS[m.member_status] || m.member_status;
  return o;
}

/** Lọc hồ sơ trong phạm vi quyền — dùng chung cho danh sách, xuất, báo cáo. */
function queryMembers_(ctx, p) {
  p = p || {};
  var unitIds = unitsWith_(ctx, 'view', p.unit_id || '', p.include_children !== false);
  var allowed = {};
  unitIds.forEach(function (id) { allowed[id] = true; });
  var q = String(p.q || '').trim();
  var qn = normalizeText_(q);
  var qDigits = q.replace(/[^\d]/g, '');
  var archivedMode = p.archived || 'active'; // active | archived | all
  return rows_('MEMBERS').filter(function (m) {
    if (!allowed[m.unit_id]) return false;
    if (archivedMode === 'active' && m.archived) return false;
    if (archivedMode === 'archived' && !m.archived) return false;
    if (p.member_status && m.member_status !== p.member_status) return false;
    if (p.gender && m.gender !== p.gender) return false;
    if (!q) return true;
    if (m.name_search.indexOf(qn) >= 0) return true;
    if (normalizeText_(m.member_code).indexOf(qn) >= 0) return true;
    if (qDigits.length >= 3 && String(m.phone).replace(/[^\d]/g, '').indexOf(qDigits) >= 0) return true;
    // Số giấy tờ: chỉ khớp chính xác và chỉ với người có quyền ghi/duyệt (người xem không tra theo giấy tờ)
    if (m.id_number && q === m.id_number && !viewOnlyAt_(ctx, m.unit_id)) return true;
    return false;
  });
}

function sortMembers_(list, sort, dir) {
  var key = SORTABLE[sort] || 'name_search';
  var mul = dir === 'desc' ? -1 : 1;
  return list.sort(function (a, b) {
    var x = String(a[key] || ''), y = String(b[key] || '');
    return (x < y ? -1 : x > y ? 1 : 0) * mul;
  });
}

function membersList_(ctx, p) {
  var list = sortMembers_(queryMembers_(ctx, p), p && p.sort, p && p.dir);
  var pendingByMember = {};
  rows_('CHANGE_REQUESTS').forEach(function (c) { if (c.status === 'PENDING') pendingByMember[c.member_id] = true; });
  return paginate_(list, p, function (m) {
    var v = memberView_(ctx, m, LIST_FIELDS);
    v.has_pending = !!pendingByMember[m.member_id];
    return v;
  });
}

function memberGet_(ctx, p) {
  var m = findBy_('MEMBERS', 'member_id', String(p && p.member_id || ''));
  if (!m) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy hồ sơ. Có thể hồ sơ đã được chuyển sang đơn vị khác.');
  assertCan_(ctx, 'view', m.unit_id, 'MEMBER', m.member_id);
  var view = memberView_(ctx, m);
  var history = rows_('MEMBERSHIP_HISTORY').filter(function (h) { return h.member_id === m.member_id; })
    .map(function (h) { return { event: h.event, unit_name: unitName_(ctx, h.unit_id), event_date: h.event_date, note: h.note }; });
  var requests = rows_('CHANGE_REQUESTS').filter(function (c) { return c.member_id === m.member_id; })
    .map(function (c) { return { change_id: c.change_id, request_type: c.request_type, type_label: CR_TYPES[c.request_type],
      status: c.status, status_label: CR_STATUS[c.status], created_by: c.created_by, created_at: c.created_at,
      decided_by: c.decided_by, decided_at: c.decided_at }; }).reverse();
  var transfers = rows_('TRANSFER_REQUESTS').filter(function (t) { return t.member_id === m.member_id; })
    .map(function (t) { return { transfer_id: t.transfer_id, from: unitName_(ctx, t.from_unit_id), to: unitName_(ctx, t.to_unit_id),
      status: t.status, status_label: TR_STATUS[t.status], proposed_date: t.proposed_date, effective_date: t.effective_date }; }).reverse();
  return {
    member: view, history: history, requests: requests, transfers: transfers,
    can_edit: can_(ctx, 'edit', m.unit_id), can_transfer: can_(ctx, 'transfer', m.unit_id) && can_(ctx, 'edit', m.unit_id)
  };
}

/**
 * Kiểm tra và chuẩn hóa dữ liệu hồ sơ. Trả { data, errors:{field:message} }.
 * mode: 'create' (cần unit_id) | 'update'.
 */
function validateMember_(input, mode) {
  input = input || {};
  var d = {}, errors = {};
  function str(field, max, required, label) {
    var v = input[field] === undefined || input[field] === null ? '' : String(input[field]).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
    if (v.length > max) errors[field] = label + ' quá dài (tối đa ' + max + ' ký tự).';
    else if (required && !v) errors[field] = 'Vui lòng nhập ' + label.toLowerCase() + '.';
    d[field] = v;
  }
  str('member_code', 20, false, 'Mã đoàn viên');
  if (d.member_code && !/^[A-Za-z0-9._\-\/]+$/.test(d.member_code)) errors.member_code = 'Mã đoàn viên chỉ gồm chữ không dấu, số và các ký tự . _ - /';
  str('full_name', 100, true, 'Họ và tên');
  d.full_name = d.full_name.replace(/\s+/g, ' ');
  if (d.full_name && /[<>{}=]/.test(d.full_name)) errors.full_name = 'Họ và tên không được chứa ký tự < > { } =';

  ['dob', 'join_date'].forEach(function (f) {
    var v = parseDate_(input[f]);
    if (v === null) errors[f] = 'Ngày không hợp lệ. Nhập theo dạng ngày/tháng/năm, ví dụ 05/09/1990.';
    d[f] = v || '';
  });
  var today = today_();
  if (d.dob && d.dob > today) errors.dob = 'Ngày sinh không được sau ngày hôm nay.';
  if (d.join_date && d.join_date > today) errors.join_date = 'Ngày vào công đoàn không được sau ngày hôm nay.';
  if (d.dob && d.join_date && d.join_date < d.dob) errors.join_date = 'Ngày vào công đoàn phải sau ngày sinh.';

  str('gender', 10, false, 'Giới tính');
  if (d.gender && GENDERS.indexOf(d.gender) < 0) errors.gender = 'Giới tính chỉ nhận: ' + GENDERS.join(', ') + '.';
  str('id_type', 20, false, 'Loại giấy tờ');
  if (d.id_type && ID_TYPES.indexOf(d.id_type) < 0) errors.id_type = 'Loại giấy tờ chỉ nhận: ' + ID_TYPES.join(', ') + '.';
  str('id_number', 20, false, 'Số giấy tờ');
  d.id_number = d.id_number.replace(/\s/g, '').toUpperCase();
  if (d.id_number) {
    if (!d.id_type) d.id_type = /^\d{12}$/.test(d.id_number) ? 'CCCD' : '';
    if (d.id_type === 'CCCD' && !/^\d{12}$/.test(d.id_number)) errors.id_number = 'Số CCCD phải gồm đúng 12 chữ số.';
    else if (d.id_type === 'CMND' && !/^(\d{9}|\d{12})$/.test(d.id_number)) errors.id_number = 'Số CMND phải gồm 9 hoặc 12 chữ số.';
    else if (!/^[A-Z0-9]{5,20}$/.test(d.id_number)) errors.id_number = 'Số giấy tờ chỉ gồm chữ và số (5–20 ký tự).';
    if (!d.id_type) errors.id_type = 'Vui lòng chọn loại giấy tờ.';
  }
  str('phone', 20, false, 'Số điện thoại');
  d.phone = d.phone.replace(/[\s.\-()]/g, '');
  if (d.phone && !/^(\+?84|0)\d{8,10}$/.test(d.phone)) errors.phone = 'Số điện thoại chưa đúng. Ví dụ: 0912345678 hoặc +84912345678.';
  str('email', 120, false, 'Email');
  d.email = d.email.toLowerCase();
  if (d.email && !validEmail_(d.email)) errors.email = 'Email chưa đúng định dạng.';
  str('address', 255, false, 'Địa chỉ');
  str('union_position', 100, false, 'Chức vụ công đoàn');
  str('member_status', 20, false, 'Tình trạng sinh hoạt');
  if (!d.member_status) d.member_status = 'ACTIVE';
  if (!MEMBER_STATUS[d.member_status]) errors.member_status = 'Tình trạng sinh hoạt không hợp lệ.';
  str('note', 1000, false, 'Ghi chú');
  if (mode === 'create') {
    d.unit_id = String(input.unit_id || '').trim();
    if (!d.unit_id) errors.unit_id = 'Vui lòng chọn đơn vị.';
  }
  return { data: d, errors: errors };
}

/**
 * Kiểm tra trùng mã đoàn viên / số giấy tờ với hồ sơ chính thức và yêu cầu đang chờ.
 * excludeMemberId: bỏ qua chính hồ sơ đang sửa.  extra: danh sách dữ liệu khác trong cùng lô nhập.
 */
var __DUP_INDEX = null;

/** Chỉ mục mã/giấy tờ của hồ sơ chính thức và yêu cầu đang mở — dựng 1 lần cho mỗi phiên bản dữ liệu. */
function dupIndex_() {
  var mRows = rows_('MEMBERS'), cRows = rows_('CHANGE_REQUESTS');
  if (__DUP_INDEX && __DUP_INDEX.m === mRows && __DUP_INDEX.c === cRows && __DUP_INDEX.mLen === mRows.length && __DUP_INDEX.cLen === cRows.length) return __DUP_INDEX;
  var idx = { m: mRows, c: cRows, mLen: mRows.length, cLen: cRows.length, code: {}, idn: {} };
  function add(map, key, owner) { if (!key) return; (map[key] = map[key] || []).push(owner); }
  mRows.forEach(function (m) {
    add(idx.code, String(m.member_code).toUpperCase(), { member_id: m.member_id });
    add(idx.idn, m.id_number, { member_id: m.member_id });
  });
  cRows.forEach(function (c) {
    if ((c.status !== 'PENDING' && c.status !== 'DRAFT') || (c.request_type !== 'CREATE' && c.request_type !== 'UPDATE')) return;
    var x = safeJson_(c.payload_json, {});
    add(idx.code, String(x.member_code || '').toUpperCase(), { member_id: c.member_id, change_id: c.change_id });
    add(idx.idn, x.id_number || '', { member_id: c.member_id, change_id: c.change_id });
  });
  __DUP_INDEX = idx;
  return idx;
}

function duplicateErrors_(d, excludeMemberId, excludeChangeId) {
  var errors = {};
  var idx = dupIndex_();
  function clash(list) {
    return (list || []).some(function (o) { return o.member_id !== excludeMemberId && (!o.change_id || o.change_id !== excludeChangeId); });
  }
  var code = (d.member_code || '').toUpperCase();
  if (code && clash(idx.code[code])) errors.member_code = 'Mã đoàn viên đã tồn tại hoặc đang có yêu cầu khác dùng mã này.';
  if (d.id_number && clash(idx.idn[d.id_number])) errors.id_number = 'Số giấy tờ đã có trong hồ sơ khác hoặc yêu cầu đang chờ. Không tạo trùng.';
  return errors;
}

/** Sinh mã đoàn viên tiếp theo (gọi khi giữ khóa). */
function nextMemberCode_() {
  var prefix = getSetting_('MEMBER_CODE_PREFIX', 'DV');
  var seq = parseInt(getSetting_('MEMBER_CODE_SEQ', '0'), 10) || 0;
  var existing = {};
  rows_('MEMBERS').forEach(function (m) { existing[String(m.member_code).toUpperCase()] = true; });
  var code;
  do { seq++; code = prefix + ('000000' + seq).slice(-6); } while (existing[code.toUpperCase()]);
  setSetting_('MEMBER_CODE_SEQ', seq);
  return code;
}
