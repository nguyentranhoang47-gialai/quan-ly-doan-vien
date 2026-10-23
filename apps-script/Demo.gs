/**
 * Demo.gs — Dữ liệu giả lập để thử nghiệm. TÁCH BIỆT với dữ liệu thật:
 *  - Chỉ chạy khi Script Property DEMO_MODE = TRUE và sheet MEMBERS đang trống.
 *  - Mọi tên có tiền tố "[DEMO]", mã đơn vị bắt đầu "DEMO-", email người dùng dùng tên miền .invalid.
 *  - Khuyến nghị: tạo một bảng tính + Apps Script RIÊNG để chạy demo, không chạy trên bảng tính thật.
 */

function seedDemoData() {
  assertOwnerContext_();
  if (String(PropertiesService.getScriptProperties().getProperty('DEMO_MODE')).toUpperCase() !== 'TRUE') {
    throw new Error('Chỉ chạy được khi Script Property DEMO_MODE = TRUE (dùng cho bảng tính thử nghiệm).');
  }
  return withLock_(function () { return seedDemoCore_(500); });
}

function seedDemoCore_(count) {
  if (rows_('MEMBERS').length) throw new Error('MEMBERS đã có dữ liệu — không nạp dữ liệu demo để tránh lẫn với dữ liệu thật.');
  var t = now_();
  var root = rows_('UNITS').filter(function (u) { return !u.parent_id; })[0];
  var units = [];
  function unit(code, name, parent) {
    var u = { unit_id: newId_('U'), code: code, name: '[DEMO] ' + name, parent_id: parent ? parent.unit_id : '', level: parent ? parent.level + 1 : 1,
      status: 'active', sort_order: units.length + 1, created_at: t, updated_at: '', version: 1 };
    units.push(u); return u;
  }
  var top = unit('DEMO-CT', 'Công đoàn cấp trên', null);
  var a = unit('DEMO-A', 'Công đoàn cơ sở A', top);
  var b = unit('DEMO-B', 'Công đoàn cơ sở B', top);
  var a1 = unit('DEMO-A1', 'Tổ công đoàn A1', a);
  var a2 = unit('DEMO-A2', 'Tổ công đoàn A2', a);
  var b1 = unit('DEMO-B1', 'Tổ công đoàn B1', b);
  insertRows_('UNITS', units);
  var leaves = [a1, a2, b1];
  var ho = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Huỳnh'];
  var dem = ['Văn', 'Thị', 'Hữu', 'Ngọc', 'Minh', 'Thanh', 'Đức', 'Thu'];
  var ten = ['An', 'Bình', 'Cường', 'Dung', 'Giang', 'Hà', 'Hải', 'Hương', 'Khánh', 'Lan', 'Long', 'Mai', 'Nam', 'Phúc', 'Quân', 'Sơn', 'Trang', 'Tuấn', 'Vy', 'Yến'];
  var members = [], hist = [];
  for (var i = 1; i <= count; i++) {
    var name = '[DEMO] ' + ho[i % ho.length] + ' ' + dem[(i * 3) % dem.length] + ' ' + ten[(i * 7) % ten.length];
    var u = leaves[i % leaves.length];
    var y = 1965 + (i % 35), mo = 1 + (i % 12), d = 1 + (i % 28);
    var dob = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
    var m = { member_id: newId_('M'), member_code: 'DEMO' + ('00000' + i).slice(-5), full_name: name, name_search: normalizeText_(name),
      dob: dob, gender: i % 2 ? 'Nam' : 'Nữ', id_type: '', id_number: '', phone: '0900' + ('000000' + i).slice(-6), email: '',
      address: '', unit_id: u.unit_id, join_date: (y + 22) + '-01-15', union_position: i % 50 === 0 ? 'Tổ trưởng' : '',
      member_status: i % 40 === 0 ? 'SUSPENDED' : 'ACTIVE', note: 'Dữ liệu giả lập', archived: false, created_at: t,
      created_by: 'seedDemoData', updated_at: '', updated_by: '', version: 1, last_ref: 'DEMO-SEED' };
    members.push(m);
    hist.push({ history_id: newId_('H'), member_id: m.member_id, unit_id: u.unit_id, event: 'JOIN', event_date: m.join_date,
      ref_id: 'DEMO-SEED-' + i, note: 'Dữ liệu giả lập', created_at: t, created_by: 'seedDemoData' });
  }
  insertRows_('MEMBERS', members);
  insertRows_('MEMBERSHIP_HISTORY', hist);
  insertRow_('AUDIT_LOGS', { log_id: newId_('LOG'), at: t, actor: 'seedDemoData', action: 'DEMO_SEED', object_type: 'SYSTEM',
    object_id: '', result: 'OK', request_id: '', detail: 'Nạp ' + count + ' hồ sơ giả lập' });
  return 'Đã nạp ' + units.length + ' đơn vị và ' + count + ' hồ sơ [DEMO]. Hãy vào Quản trị để cấp quyền cho email thử nghiệm.';
}
