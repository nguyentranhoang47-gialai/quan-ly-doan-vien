/**
 * run-tests.js — Kiểm thử nghiệp vụ trên môi trường giả lập Apps Script.
 * Chạy: node tests/run-tests.js      (cần Node.js 18+; CHỈ dành cho người phát triển, không cần khi triển khai)
 * Kết quả ghi ra tests/test-results.json để đưa vào TEST_REPORT.md.
 */
const { SPREADSHEETS } = require('./gas-mock');
const fs = require('fs');
const path = require('path');

const results = [];
let current = null;
function test(name, fn) {
  current = { name, checks: [], ok: true };
  const t0 = Date.now();
  try { fn(); } catch (e) { current.ok = false; current.checks.push({ ok: false, msg: 'Ngoại lệ: ' + (e.stack || e) }); }
  current.ms = Date.now() - t0;
  results.push(current);
  console.log((current.ok ? 'ĐẠT ' : 'LỖI ') + name + (current.ok ? '' : '\n   ' + current.checks.filter(c => !c.ok).map(c => c.msg).join('\n   ')));
}
function check(cond, msg) { current.checks.push({ ok: !!cond, msg }); if (!cond) current.ok = false; }

const { boot, fixture, rid } = require('./fixture');

/* ================================ KIỂM THỬ ================================ */

test('Thiết lập: setupSystem tạo đủ sheet, chạy lại không mất dữ liệu, chặn khi không phải chủ sở hữu', () => {
  const env = boot();
  const names = env.ss.getSheets().map(s => s.name);
  ['SETTINGS', 'UNITS', 'USERS', 'USER_SCOPES', 'MEMBERS', 'CHANGE_REQUESTS', 'APPROVAL_ACTIONS', 'TRANSFER_REQUESTS',
    'MEMBERSHIP_HISTORY', 'DUES', 'AUDIT_LOGS', 'IMPORT_JOBS', 'OPERATIONS', 'SESSIONS', 'AUTH_OTP', 'DUES_HISTORY', 'HUONG_DAN']
    .forEach(n => check(names.includes(n), 'Có sheet ' + n));
  const admins = env.sheetRows('USERS').filter(u => u.is_admin === true);
  check(admins.length === 1 && admins[0].email === 'admin@example.test', 'Quản trị đầu tiên tạo từ Script Property ADMIN_EMAIL');
  check(/^[0-9a-f]{64}$/.test(env.props.AUTH_PEPPER), 'Tạo khóa AUTH_PEPPER');
  const admin = env.login('admin@example.test');
  env.ok(admin, 'admin.unitSave', { code: 'X1', name: 'Đơn vị X1', parent_id: env.sheetRows('UNITS')[0].unit_id });
  const pepper = env.props.AUTH_PEPPER;
  env.props.ADMIN_EMAIL = 'ke-gian@example.test';
  env.ctx.setupSystem();
  check(env.sheetRows('UNITS').length === 2, 'Chạy lại setup không xóa đơn vị đã tạo');
  check(env.props.AUTH_PEPPER === pepper, 'Chạy lại setup không đổi khóa bí mật (phiên cũ vẫn hợp lệ)');
  check(!env.sheetRows('USERS').some(u => u.email === 'ke-gian@example.test'), 'Không tự thêm quản trị mới khi đã có quản trị');
  env.state.activeUser = '';
  let denied = false; try { env.ctx.setupSystem(); } catch (e) { denied = /chủ sở hữu/.test(e.message); }
  check(denied, 'setupSystem bị từ chối khi gọi không phải từ chủ sở hữu (getActiveUser rỗng)');
  env.state.activeUser = 'nguoi-khac@example.test';
  denied = false; try { env.ctx.installDailyBackup(); } catch (e) { denied = true; }
  check(denied, 'installDailyBackup bị từ chối với người khác chủ sở hữu');
  // Thêm cột mới vào schema → setup thêm cột cuối, không làm lệch dữ liệu
  env.state.activeUser = 'owner@example.test';
  env.ctx.SCHEMA.UNITS.columns.push(['extra_col', 'Cột thử', 'text', false]);
  env.ctx.setupSystem();
  const hdr = env.ss.getSheetByName('UNITS').data[0];
  check(hdr[hdr.length - 1] === 'extra_col' && env.sheetRows('UNITS').some(u => u.code === 'X1'), 'Nâng cấp schema: thêm cột, giữ dữ liệu cũ');
});

test('Đăng nhập: email chưa được cấp quyền không đăng nhập được, thông báo không lộ email', () => {
  const env = boot();
  const r1 = env.ok(null, 'auth.requestOtp', { email: 'admin@example.test' });
  const n = env.outbox.length;
  const r2 = env.ok(null, 'auth.requestOtp', { email: 'la@example.test' });
  check(r1.message === r2.message, 'Thông báo giống nhau cho email có và không có quyền');
  check(env.outbox.length === n, 'Không gửi email cho địa chỉ chưa được cấp quyền');
  const v = env.call(null, 'auth.verifyOtp', { email: 'la@example.test', otp: '123456' });
  check(!v.ok && v.error.code === 'AUTH', 'Xác minh OTP cho email lạ bị từ chối');
  const rows = env.sheetRows('AUTH_OTP');
  check(rows.every(r => !JSON.stringify(r).includes(env.outbox[0].body.match(/\d{6}/)[0]) || r.otp_hash.length === 64), 'Không lưu OTP dạng rõ (chỉ có mã băm 64 hex)');
  check(!JSON.stringify(env.sheetRows('AUTH_OTP')).includes('admin@example.test'), 'Bảng OTP không chứa email dạng rõ');
});

test('Đăng nhập: OTP sai, hết hạn, dùng lại, quá số lần thử đều bị từ chối', () => {
  const env = boot();
  env.ok(null, 'auth.requestOtp', { email: 'admin@example.test' });
  const otp = env.outbox[env.outbox.length - 1].body.match(/(\d{6})/)[1];
  const wrong = otp === '000000' ? '111111' : '000000';
  const bad = env.call(null, 'auth.verifyOtp', { email: 'admin@example.test', otp: wrong });
  check(!bad.ok && bad.error.code === 'AUTH', 'OTP sai bị từ chối');
  const good = env.call(null, 'auth.verifyOtp', { email: 'Admin@Example.test', otp });
  check(good.ok && /^[0-9a-f]{64}$/.test(good.data.token), 'OTP đúng (email khác hoa/thường) đăng nhập được, token 256 bit');
  const reuse = env.call(null, 'auth.verifyOtp', { email: 'admin@example.test', otp });
  check(!reuse.ok, 'OTP đã dùng không dùng lại được');
  // Hết hạn
  Object.keys(env.cache).forEach(k => delete env.cache[k]);
  env.ok(null, 'auth.requestOtp', { email: 'admin@example.test' });
  const otp2 = env.outbox[env.outbox.length - 1].body.match(/(\d{6})/)[1];
  env.state.clockOffsetMs = 6 * 60000;
  const exp = env.call(null, 'auth.verifyOtp', { email: 'admin@example.test', otp: otp2 });
  check(!exp.ok && exp.error.code === 'AUTH', 'OTP quá 5 phút bị từ chối');
  env.state.clockOffsetMs = 0;
  // Quá số lần nhập sai
  Object.keys(env.cache).forEach(k => delete env.cache[k]);
  env.ok(null, 'auth.requestOtp', { email: 'admin@example.test' });
  const otp3 = env.outbox[env.outbox.length - 1].body.match(/(\d{6})/)[1];
  const w3 = otp3 === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) env.call(null, 'auth.verifyOtp', { email: 'admin@example.test', otp: w3 });
  const after = env.call(null, 'auth.verifyOtp', { email: 'admin@example.test', otp: otp3 });
  check(!after.ok, 'Sau 5 lần sai, mã đúng cũng bị khóa');
  // Mã cũ bị vô hiệu khi xin mã mới
  Object.keys(env.cache).forEach(k => delete env.cache[k]);
  env.ok(null, 'auth.requestOtp', { email: 'admin@example.test' });
  const o4 = env.outbox[env.outbox.length - 1].body.match(/(\d{6})/)[1];
  env.ok(null, 'auth.requestOtp', { email: 'admin@example.test' });
  const o5 = env.outbox[env.outbox.length - 1].body.match(/(\d{6})/)[1];
  if (o4 !== o5) check(!env.call(null, 'auth.verifyOtp', { email: 'admin@example.test', otp: o4 }).ok, 'Mã cũ vô hiệu khi đã xin mã mới');
  // OTP & token không xuất hiện trong nhật ký
  const logs = JSON.stringify(env.sheetRows('AUDIT_LOGS')) + JSON.stringify(env.sheetRows('OPERATIONS'));
  check(!logs.includes(otp) && !logs.includes(good.data.token), 'Không ghi OTP/token vào nhật ký');
  check(!JSON.stringify(env.sheetRows('SESSIONS')).includes(good.data.token), 'Bảng phiên chỉ lưu mã băm token');
});

test('Đăng nhập: giới hạn tần suất gửi mã theo email và toàn hệ thống', () => {
  const env = boot();
  const res = [];
  for (let i = 0; i < 5; i++) res.push(env.call(null, 'auth.requestOtp', { email: 'admin@example.test' }));
  check(res.filter(r => r.ok).length === 3 && res[3].error.code === 'RATE_LIMIT', 'Tối đa 3 lần gửi / email / 15 phút');
  const strangers = [];
  for (let i = 0; i < 5; i++) strangers.push(env.call(null, 'auth.requestOtp', { email: 'la@example.test' }));
  check(strangers[3].error && strangers[3].error.code === 'RATE_LIMIT', 'Email không tồn tại cũng bị giới hạn y hệt (không lộ thông tin)');
  let lim = false;
  for (let i = 0; i < 70; i++) { const r = env.call(null, 'auth.requestOtp', { email: 'u' + i + '@example.test' }); if (!r.ok && /giờ này/.test(r.error.message)) lim = true; }
  check(lim, 'Giới hạn tổng số yêu cầu gửi mã toàn hệ thống mỗi giờ');
  env.state.quota = 0;
  const q = env.call(null, 'auth.requestOtp', { email: 'x@example.test' });
  check(!q.ok && /hết lượt gửi email/.test(q.error.message), 'Hết hạn mức email: thông báo rõ cách xử lý');
});

test('Phiên: khóa tài khoản / thu hồi quyền có tác dụng ngay với phiên đang dùng; đăng xuất; token giả', () => {
  const f = fixture(), env = f.env;
  check(env.call(f.tok.offA, 'members.list', {}).ok, 'Cán bộ A đang dùng bình thường');
  env.ok(f.tok.admin, 'admin.userSave', { user_id: f.ids.offA, email: 'canbo.a@example.test', full_name: 'Cán bộ A', status: 'locked', is_admin: false });
  const r = env.call(f.tok.offA, 'members.list', {});
  check(!r.ok && r.error.code === 'AUTH', 'Sau khi khóa, phiên đang mở bị từ chối ngay');
  Object.keys(env.cache).forEach(k => delete env.cache[k]);
  const n = env.outbox.length;
  env.ok(null, 'auth.requestOtp', { email: 'canbo.a@example.test' });
  check(env.outbox.length === n, 'Tài khoản bị khóa không nhận được mã mới');
  // Thu hồi phạm vi quyền → mất quyền ngay
  const ov = env.ok(f.tok.admin, 'admin.overview', {});
  const sc = ov.users.find(u => u.email === 'canbo.b@example.test').scopes[0];
  env.ok(f.tok.admin, 'admin.scopeRemove', { scope_id: sc.scope_id });
  check(env.ok(f.tok.offB, 'members.list', {}).total === 0, 'Thu hồi phạm vi: không còn thấy hồ sơ đơn vị B');
  // Đăng xuất
  env.ok(f.tok.apA, 'auth.logout', {});
  check(env.call(f.tok.apA, 'dashboard', {}).error.code === 'AUTH', 'Token sau đăng xuất bị từ chối');
  check(env.call('f'.repeat(64), 'dashboard', {}).error.code === 'AUTH', 'Token giả bị từ chối');
  check(env.call(undefined, 'dashboard', {}).error.code === 'AUTH', 'Không có token bị từ chối');
  // Hết hạn do không hoạt động
  env.state.clockOffsetMs = 61 * 60000;
  check(env.call(f.tok.apB, 'dashboard', {}).error.code === 'AUTH', 'Phiên hết hạn sau 60 phút không thao tác');
  env.state.clockOffsetMs = 0;
  // Gửi email/role giả trong payload không có tác dụng
  const fake = env.call(f.tok.viewA, 'change.save', { request_type: 'CREATE', email: 'admin@example.test', role: 'admin', is_admin: true,
    data: { full_name: 'Giả mạo', unit_id: f.units.A }, submit: true });
  check(!fake.ok && fake.error.code === 'FORBIDDEN', 'Gửi email/role/is_admin giả trong payload không nâng quyền');
  const unk = env.call(f.tok.admin, 'setupSystem', {});
  check(!unk.ok, 'Không gọi được hàm nội bộ qua api()');
});

test('Phân quyền: đơn vị A không đọc/sửa được dữ liệu đơn vị B khi đổi ID', () => {
  const f = fixture(), env = f.env, A = f.tok.offA;
  const g = env.call(A, 'members.get', { member_id: f.mB.member_id });
  check(!g.ok && g.error.code === 'FORBIDDEN', 'Không xem chi tiết hồ sơ B');
  check(env.ok(A, 'members.list', { unit_id: f.units.B }).total === 0, 'Lọc theo unit_id B trả về rỗng');
  check(env.ok(A, 'members.list', {}).items.every(m => m.unit_id !== f.units.B), 'Danh sách không lẫn hồ sơ B');
  check(env.ok(A, 'members.list', { q: 'Bích' }).total === 0, 'Tìm theo tên không lộ hồ sơ B');
  const c = env.call(A, 'change.save', { request_type: 'CREATE', data: { full_name: 'Chen Vao B', unit_id: f.units.B }, submit: true });
  check(!c.ok && c.error.code === 'FORBIDDEN', 'Không tạo hồ sơ vào đơn vị B');
  const mb = env.ok(f.tok.offB, 'members.get', { member_id: f.mB.member_id }).member;
  const u = env.call(A, 'change.save', { request_type: 'UPDATE', member_id: f.mB.member_id, base_version: mb.version, data: Object.assign({}, mb, { full_name: 'Sua trai phep' }), submit: true });
  check(!u.ok && u.error.code === 'FORBIDDEN', 'Không sửa hồ sơ B');
  const crB = env.ok(f.tok.offB, 'change.save', { request_type: 'UPDATE', member_id: f.mB.member_id, base_version: mb.version, data: Object.assign({}, mb, { note: 'B sửa' }), submit: true });
  const ap = env.call(f.tok.apA, 'change.approve', { change_id: crB.change_id });
  check(!ap.ok && ap.error.code === 'FORBIDDEN', 'Người duyệt A không duyệt được yêu cầu của B');
  check(!env.call(f.tok.apA, 'change.get', { change_id: crB.change_id }).ok, 'Người duyệt A không xem được yêu cầu của B');
  check(env.ok(f.tok.apA, 'change.list', { box: 'approve' }).items.every(x => x.change_id !== crB.change_id), 'Hộp chờ duyệt của A không có yêu cầu B');
  const d = env.ok(A, 'dues.record', { period: '2026-10', items: [{ member_id: f.mB.member_id, amount_due: 50000 }] });
  check(d.created === 0 && d.failed.length === 1, 'Không ghi đoàn phí cho hồ sơ B');
  const t = env.call(A, 'transfer.create', { member_id: f.mB.member_id, to_unit_id: f.units.A, reason: 'x' });
  check(!t.ok && t.error.code === 'FORBIDDEN', 'Không lập chuyển sinh hoạt cho hồ sơ B');
  const ex = env.ok(A, 'export.members', { unit_id: f.units.B });
  check(ex.count === 0, 'Xuất CSV với unit_id B không có dữ liệu');
  const denied = env.sheetRows('AUDIT_LOGS').filter(l => l.result === 'DENIED' && l.actor === 'canbo.a@example.test');
  check(denied.length >= 3, 'Các lần truy cập trái phép được ghi nhật ký DENIED');
  // Người có quyền ở nhiều đơn vị
  const multiList = env.ok(f.tok.multi, 'members.list', {});
  check(multiList.items.some(m => m.unit_id === f.units.B), 'Người nhiều đơn vị thấy được đơn vị B (quyền xem)');
  check(!env.call(f.tok.multi, 'change.save', { request_type: 'CREATE', data: { full_name: 'Thu B', unit_id: f.units.B } }).ok, 'nhưng không ghi được vào B');
  check(env.call(f.tok.multi, 'change.save', { request_type: 'CREATE', data: { full_name: 'Thử A1', unit_id: f.units.A1 } }).ok, 'và ghi được vào A1 (officer A1)');
  check(!env.call(f.tok.multi, 'change.save', { request_type: 'CREATE', data: { full_name: 'Thử A', unit_id: f.units.A } }).ok, 'không ghi được vào A (cấp trên của A1)');
  check(!env.call(f.tok.offA, 'admin.overview', {}).ok, 'Không phải quản trị không vào được Quản trị');
});

test('Người xem: không ghi được dữ liệu, trường nhạy cảm bị che', () => {
  const f = fixture(), env = f.env, V = f.tok.viewA;
  const m = env.ok(V, 'members.get', { member_id: f.mA.member_id }).member;
  check(m.id_number.endsWith('2345') && m.id_number.includes('•'), 'Số giấy tờ bị che: ' + m.id_number);
  check(!m.address.includes('Lê Lợi'), 'Địa chỉ bị ẩn với người xem');
  check(!env.call(V, 'change.save', { request_type: 'CREATE', data: { full_name: 'X', unit_id: f.units.A } }).ok, 'Không tạo hồ sơ');
  check(!env.call(V, 'change.save', { request_type: 'ARCHIVE', member_id: f.mA.member_id, base_version: 1, data: { reason: 'x' } }).ok, 'Không lưu trữ hồ sơ');
  check(env.ok(V, 'dues.record', { period: '2026-10', items: [{ member_id: f.mA.member_id, amount_due: 1 }] }).created === 0, 'Không ghi đoàn phí');
  check(!env.call(V, 'transfer.create', { member_id: f.mA.member_id, to_unit_id: f.units.B, reason: 'x' }).ok, 'Không chuyển sinh hoạt');
  check(!env.call(V, 'import.commit', { rows: [{ full_name: 'X', unit_code: 'A' }] }).ok, 'Không nhập CSV');
  check(env.ok(V, 'members.list', { q: '001090012345' }).total === 0, 'Người xem không tra cứu theo số giấy tờ');
  const ex = env.ok(V, 'export.members', {});
  check(ex.count === 1 && !ex.csv.includes('001090012345') && !ex.csv.includes('Lê Lợi'), 'Xuất CSV của người xem cũng bị che');
});

test('Phê duyệt: chưa duyệt thì dữ liệu chính thức không đổi; không duyệt hai lần; không tự duyệt', () => {
  const f = fixture(), env = f.env;
  const m = env.ok(f.tok.offA, 'members.get', { member_id: f.mA.member_id }).member;
  const draft = env.ok(f.tok.offA, 'change.save', { request_type: 'UPDATE', member_id: m.member_id, base_version: m.version, data: Object.assign({}, m, { phone: '0900000001' }) });
  check(draft.status === 'DRAFT', 'Lưu nháp');
  check(env.sheetRows('MEMBERS').find(x => x.member_id === m.member_id).phone === '0912345678', 'Nháp không đổi dữ liệu chính thức');
  env.ok(f.tok.offA, 'change.submit', { change_id: draft.change_id });
  check(env.sheetRows('MEMBERS').find(x => x.member_id === m.member_id).phone === '0912345678', 'Chờ duyệt: dữ liệu chính thức chưa đổi');
  const detail = env.ok(f.tok.apA, 'change.get', { change_id: draft.change_id });
  const ph = detail.diff.find(d => d.field === 'phone');
  check(ph.old === '0912345678' && ph.new === '0900000001' && ph.changed, 'Màn hình duyệt có giá trị cũ và mới');
  const ret = env.call(f.tok.apA, 'change.return', { change_id: draft.change_id, note: '' });
  check(!ret.ok && ret.error.code === 'VALIDATION', 'Trả lại bắt buộc ghi lý do');
  env.ok(f.tok.apA, 'change.return', { change_id: draft.change_id, note: 'Kiểm tra lại số điện thoại' });
  check(env.ok(f.tok.offA, 'dashboard', {}).myReturned === 1, 'Người lập thấy yêu cầu bị trả lại');
  env.ok(f.tok.offA, 'change.save', { change_id: draft.change_id, data: Object.assign({}, m, { phone: '0900000002' }), submit: true });
  env.ok(f.tok.apA, 'change.approve', { change_id: draft.change_id });
  const after = env.sheetRows('MEMBERS').find(x => x.member_id === m.member_id);
  check(after.phone === '0900000002' && after.version === 2, 'Sau duyệt: cập nhật chính thức, tăng phiên bản');
  const cr = env.sheetRows('CHANGE_REQUESTS').find(c => c.change_id === draft.change_id);
  check(cr.decided_by === 'duyet.a@example.test' && /^\d{4}-\d{2}-\d{2}T/.test(cr.decided_at), 'Ghi người duyệt và thời gian duyệt');
  const twice = env.call(f.tok.apA, 'change.approve', { change_id: draft.change_id });
  check(!twice.ok && twice.error.code === 'CONFLICT', 'Không duyệt hai lần');
  // Tự duyệt
  const own = env.ok(f.tok.admin, 'change.save', { request_type: 'CREATE', data: { full_name: 'Quản trị tự tạo', unit_id: f.units.A }, submit: true });
  const self = env.call(f.tok.admin, 'change.approve', { change_id: own.change_id });
  check(!self.ok && self.error.code === 'FORBIDDEN', 'Mặc định quản trị không tự duyệt yêu cầu của mình');
  env.ok(f.tok.admin, 'admin.settingsSave', { values: { ALLOW_ADMIN_SELF_APPROVE: 'TRUE' } });
  check(env.call(f.tok.admin, 'change.approve', { change_id: own.change_id }).ok, 'Khi bật cấu hình ngoại lệ thì quản trị tự duyệt được');
  check(env.sheetRows('APPROVAL_ACTIONS').some(a => a.target_id === own.change_id && a.action === 'SELF_APPROVE'), 'Tự duyệt có nhật ký riêng SELF_APPROVE');
  const offSelf = env.ok(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Thử', unit_id: f.units.A }, submit: true });
  check(env.ok(f.tok.offA, 'change.list', { box: 'approve' }).total === 0, 'Cán bộ không có hộp chờ duyệt');
  check(!env.call(f.tok.offA, 'change.approve', { change_id: offSelf.change_id }).ok, 'Cán bộ không duyệt được');
  // Lưu trữ thay cho xóa
  const mm = env.ok(f.tok.offA, 'members.get', { member_id: f.mA.member_id }).member;
  const arc = env.ok(f.tok.offA, 'change.save', { request_type: 'ARCHIVE', member_id: mm.member_id, base_version: mm.version, data: { reason: 'Nghỉ việc' }, submit: true });
  env.ok(f.tok.apA, 'change.approve', { change_id: arc.change_id });
  check(env.ok(f.tok.offA, 'members.list', {}).items.every(x => x.member_id !== mm.member_id), 'Hồ sơ lưu trữ không hiện ở danh sách mặc định');
  check(env.ok(f.tok.offA, 'members.list', { archived: 'archived' }).total === 1, 'Vẫn xem được trong mục đã lưu trữ');
  check(env.sheetRows('MEMBERS').some(x => x.member_id === mm.member_id), 'Không xóa vật lý');
});

test('Xung đột: hai người cùng sửa một hồ sơ nhận cảnh báo, không ghi đè âm thầm', () => {
  const f = fixture(), env = f.env;
  const m1 = env.ok(f.tok.offA, 'members.get', { member_id: f.mA.member_id }).member;
  const m2 = env.ok(f.tok.offA2, 'members.get', { member_id: f.mA.member_id }).member;
  const s1 = env.ok(f.tok.offA, 'change.save', { request_type: 'UPDATE', member_id: m1.member_id, base_version: m1.version, data: Object.assign({}, m1, { note: 'Người 1' }), submit: true });
  const s2 = env.call(f.tok.offA2, 'change.save', { request_type: 'UPDATE', member_id: m2.member_id, base_version: m2.version, data: Object.assign({}, m2, { note: 'Người 2' }), submit: true });
  check(!s2.ok && s2.error.code === 'CONFLICT', 'Người thứ hai nhận cảnh báo: đang có yêu cầu khác chờ duyệt');
  env.ok(f.tok.apA, 'change.approve', { change_id: s1.change_id });
  // Người 2 vẫn đang giữ biểu mẫu mở từ phiên bản cũ (version 1) và bấm gửi
  const sub2 = env.call(f.tok.offA2, 'change.save', { request_type: 'UPDATE', member_id: m2.member_id, base_version: m2.version, data: Object.assign({}, m2, { note: 'Người 2' }), submit: true });
  check(!sub2.ok && sub2.error.code === 'CONFLICT' && /người khác cập nhật/.test(sub2.error.message), 'Biểu mẫu mở từ phiên bản cũ bị chặn khi gửi (xung đột phiên bản)');
  check(env.sheetRows('MEMBERS').find(x => x.member_id === m1.member_id).note === 'Người 1', 'Dữ liệu của người 1 không bị ghi đè');
});

test('Chống lặp: gửi lại cùng request_id không tạo bản ghi trùng', () => {
  const f = fixture(), env = f.env;
  const r = rid();
  const a = env.ok(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Lặp Lại', unit_id: f.units.A }, submit: true }, r);
  const b = env.ok(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Lặp Lại', unit_id: f.units.A }, submit: true }, r);
  check(a.change_id === b.change_id && b._replayed, 'Trả lại kết quả cũ, không tạo mới');
  check(env.sheetRows('CHANGE_REQUESTS').filter(c => c.summary === 'Thêm mới: Lặp Lại').length === 1, 'Chỉ có 1 yêu cầu');
  const ra = rid();
  env.ok(f.tok.apA, 'change.approve', { change_id: a.change_id }, ra);
  const again = env.call(f.tok.apA, 'change.approve', { change_id: a.change_id }, ra);
  check(again.ok && again.data._replayed, 'Bấm duyệt lặp (cùng request_id) không xử lý lại');
  check(env.sheetRows('MEMBERS').filter(m => m.full_name === 'Lặp Lại').length === 1, 'Chỉ 1 hồ sơ được tạo');
  const rd = rid();
  env.ok(f.tok.offA, 'dues.record', { period: '2026-09', items: [{ member_id: f.mA.member_id, amount_due: 30000, amount_paid: 30000 }] }, rd);
  env.ok(f.tok.offA, 'dues.record', { period: '2026-09', items: [{ member_id: f.mA.member_id, amount_due: 30000, amount_paid: 30000 }] }, rd);
  check(env.sheetRows('DUES').filter(d => d.period === '2026-09').length === 1, 'Ghi đoàn phí lặp chỉ 1 bản ghi');
  const ri = rid();
  const rows = [{ __row: 2, full_name: 'Nhập Lặp', unit_code: 'A', member_code: 'NL01' }];
  env.ok(f.tok.offA, 'import.commit', { rows }, ri);
  env.ok(f.tok.offA, 'import.commit', { rows }, ri);
  check(env.sheetRows('IMPORT_JOBS').length === 1 && env.sheetRows('CHANGE_REQUESTS').filter(c => c.summary === 'Thêm mới: Nhập Lặp').length === 1, 'Gửi lại lô nhập không tạo trùng');
  const other = env.call(f.tok.offA, 'import.commit', { rows }, rid());
  check(other.ok && other.data.ok === 0 && other.data.failed === 1, 'Nhập lại cùng tệp với mã thao tác mới: dòng trùng bị báo lỗi, không tạo thêm');
  const wrongAction = env.call(f.tok.offA, 'change.cancel', { change_id: a.change_id }, r);
  check(!wrongAction.ok && wrongAction.error.code === 'CONFLICT', 'Dùng lại request_id cho hành động khác bị từ chối');
  check(!env.call(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Không mã', unit_id: f.units.A } }, '').ok, 'Thao tác ghi thiếu request_id bị từ chối');
});

test('Chuyển sinh hoạt: giữ mã, giữ lịch sử, đổi quyền xem theo đơn vị mới, chặn trường hợp sai', () => {
  const f = fixture(), env = f.env;
  const id = f.mA.member_id;
  const same = env.call(f.tok.offA, 'transfer.create', { member_id: id, to_unit_id: f.units.A, reason: 'x' });
  check(!same.ok && same.error.details && same.error.details.to_unit_id, 'Không chuyển đến chính đơn vị hiện tại');
  env.ok(f.tok.admin, 'admin.unitSave', { unit_id: f.units.C, code: 'C', name: 'C', parent_id: f.units.root, status: 'inactive' });
  check(!env.call(f.tok.offA, 'transfer.create', { member_id: id, to_unit_id: f.units.C, reason: 'x' }).ok, 'Không chuyển đến đơn vị ngừng hoạt động');
  const noReason = env.call(f.tok.offA, 'transfer.create', { member_id: id, to_unit_id: f.units.B, reason: '' });
  check(!noReason.ok, 'Bắt buộc lý do');
  const t = env.ok(f.tok.offA, 'transfer.create', { member_id: id, to_unit_id: f.units.B, reason: 'Điều động công tác', proposed_date: '20/10/2026' });
  check(!env.call(f.tok.offA, 'transfer.create', { member_id: id, to_unit_id: f.units.B, reason: 'lần 2' }).ok, 'Không có hai yêu cầu chuyển đang xử lý');
  check(env.sheetRows('MEMBERS').find(m => m.member_id === id).unit_id === f.units.A, 'Chưa xác nhận: đơn vị chính thức chưa đổi');
  check(!env.call(f.tok.offA, 'transfer.confirm', { transfer_id: t.transfer_id }).ok, 'Đơn vị đi không tự xác nhận được');
  check(env.ok(f.tok.offB, 'transfer.list', { box: 'incoming' }).total === 1, 'Đơn vị đến thấy yêu cầu chờ xác nhận');
  check(!env.call(f.tok.offB, 'members.get', { member_id: id }).ok, 'Trước khi hoàn tất, đơn vị đến chưa xem được hồ sơ');
  env.ok(f.tok.apB, 'transfer.confirm', { transfer_id: t.transfer_id, effective_date: '01/11/2026' });
  const m = env.sheetRows('MEMBERS').find(x => x.member_id === id);
  check(m.unit_id === f.units.B && m.member_code === '00123', 'Hoàn tất: đổi đơn vị, giữ nguyên mã đoàn viên');
  const hist = env.sheetRows('MEMBERSHIP_HISTORY').filter(h => h.member_id === id).map(h => h.event);
  check(JSON.stringify(hist) === JSON.stringify(['JOIN', 'TRANSFER_OUT', 'TRANSFER_IN']), 'Lịch sử đầy đủ: ' + hist.join(','));
  check(!env.call(f.tok.offA, 'members.get', { member_id: id }).ok, 'Đơn vị cũ không còn xem được');
  check(env.call(f.tok.offB, 'members.get', { member_id: id }).ok, 'Đơn vị mới xem được');
  const detail = env.ok(f.tok.offB, 'members.get', { member_id: id });
  check(detail.history.length === 3, 'Màn hình chi tiết có lịch sử đơn vị');
  check(!env.call(f.tok.apB, 'transfer.confirm', { transfer_id: t.transfer_id }).ok, 'Không xác nhận lại lần hai');
  // Từ chối & hủy
  const t2 = env.ok(f.tok.offB, 'transfer.create', { member_id: f.mB.member_id, to_unit_id: f.units.A, reason: 'thử' });
  check(!env.call(f.tok.offA, 'transfer.reject', { transfer_id: t2.transfer_id }).ok, 'Từ chối bắt buộc lý do');
  env.ok(f.tok.offA, 'transfer.reject', { transfer_id: t2.transfer_id, note: 'Không đủ chỉ tiêu' });
  const t3 = env.ok(f.tok.offB, 'transfer.create', { member_id: f.mB.member_id, to_unit_id: f.units.A, reason: 'thử lại' });
  check(!env.call(f.tok.offA, 'transfer.cancel', { transfer_id: t3.transfer_id }).ok, 'Đơn vị đến không hủy thay đơn vị đi');
  env.ok(f.tok.offB, 'transfer.cancel', { transfer_id: t3.transfer_id });
  check(env.sheetRows('MEMBERS').find(x => x.member_id === f.mB.member_id).unit_id === f.units.B, 'Từ chối/hủy không đổi đơn vị');
});

test('Phục hồi: lỗi giữa chừng được phát hiện và phục hồi không tạo trùng', () => {
  const f = fixture(), env = f.env;
  const cr = env.ok(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Gián Đoạn', unit_id: f.units.A }, submit: true });
  env.ctx.__FAULT = 'approve_after_member';
  const r = env.call(f.tok.apA, 'change.approve', { change_id: cr.change_id });
  env.ctx.__FAULT = undefined;
  check(!r.ok, 'Thao tác bị gián đoạn trả lỗi');
  const op = env.sheetRows('OPERATIONS').find(o => o.action === 'change.approve' && o.status === 'STARTED');
  check(!!op, 'Nhật ký thao tác còn trạng thái STARTED');
  check(env.sheetRows('MEMBERS').some(m => m.full_name === 'Gián Đoạn') &&
    env.sheetRows('CHANGE_REQUESTS').find(c => c.change_id === cr.change_id).status === 'PENDING', 'Trạng thái dở dang: đã có hồ sơ nhưng yêu cầu chưa APPROVED');
  env.state.clockOffsetMs = 3 * 60000;
  const admin2 = env.login('admin@example.test');
  const dash = env.ok(admin2, 'dashboard', {});
  check(dash.warnings.some(w => /gián đoạn/.test(w)), 'Tổng quan quản trị cảnh báo thao tác gián đoạn');
  const rec = env.ok(admin2, 'admin.recover', {});
  check(rec.items.length === 1 && rec.items[0].status === 'RECOVERED', 'Phục hồi thành công');
  check(env.sheetRows('CHANGE_REQUESTS').find(c => c.change_id === cr.change_id).status === 'APPROVED', 'Yêu cầu được hoàn tất');
  check(env.sheetRows('MEMBERS').filter(m => m.full_name === 'Gián Đoạn').length === 1, 'Không tạo trùng hồ sơ');
  const mid = env.sheetRows('MEMBERS').find(m => m.full_name === 'Gián Đoạn').member_id;
  check(env.sheetRows('MEMBERSHIP_HISTORY').filter(h => h.member_id === mid).length === 1, 'Không trùng lịch sử');
  // Chuyển sinh hoạt bị gián đoạn
  const t = env.ok(f.tok.offA, 'transfer.create', { member_id: mid, to_unit_id: f.units.B, reason: 'thử' });
  env.ctx.__FAULT = 'transfer_after_member';
  check(!env.call(f.tok.apB, 'transfer.confirm', { transfer_id: t.transfer_id }).ok, 'Xác nhận chuyển bị gián đoạn');
  env.ctx.__FAULT = undefined;
  env.state.clockOffsetMs = 6 * 60000;
  const admin3 = env.login('admin@example.test');
  env.ok(admin3, 'admin.recover', {});
  const tr = env.sheetRows('TRANSFER_REQUESTS').find(x => x.transfer_id === t.transfer_id);
  check(tr.status === 'COMPLETED', 'Chuyển sinh hoạt được hoàn tất khi phục hồi');
  check(env.sheetRows('MEMBERSHIP_HISTORY').filter(h => h.ref_id === t.transfer_id).length === 2, 'Lịch sử chuyển đủ 2 dòng, không trùng');
  check(env.ok(admin3, 'admin.recover', {}).items.length === 0, 'Chạy phục hồi lần nữa không còn gì để xử lý');
  env.state.clockOffsetMs = 0;
});

test('Nhập CSV: giữ số 0 đầu, báo lỗi đúng dòng, kiểm tra lại phía máy chủ, theo quy trình duyệt', () => {
  const f = fixture(), env = f.env;
  const rows = [
    { __row: 2, member_code: '000777', full_name: 'Lê Văn Không', dob: '01/02/1985', gender: 'Nam', id_type: 'CCCD', id_number: '012345678901', phone: '0123456789', unit_code: 'A', member_status: 'Đang sinh hoạt' },
    { __row: 3, member_code: '000778', full_name: '', unit_code: 'A' },
    { __row: 4, member_code: '000779', full_name: 'Sai Ngày', dob: '31/02/1990', unit_code: 'A' },
    { __row: 5, member_code: '000780', full_name: 'Sai Đơn Vị', unit_code: 'B' },
    { __row: 6, member_code: '000777', full_name: 'Trùng Mã Trong Tệp', unit_code: 'A' },
    { __row: 7, member_code: '000781', full_name: 'Trùng Giấy Tờ', id_number: '001090012345', unit_code: 'A' },
    { __row: 8, member_code: '000782', full_name: '=HYPERLINK("http://x","bấm")', unit_code: 'A' },
    { __row: 9, member_code: '000783', full_name: 'Ghi Chú Công Thức', note: '=1+1', unit_code: 'A', phone: '+84912000111' }
  ];
  const chk = env.ok(f.tok.offA, 'import.check', { rows });
  const bad = chk.rows.filter(r => !r.ok).map(r => r.row);
  check(JSON.stringify(bad) === JSON.stringify([3, 4, 5, 6, 7, 8]), 'Lỗi đúng dòng 3,4,5,6,7,8 — thực tế: ' + bad.join(','));
  check(/Họ và tên/.test(chk.rows[1].errors[0]) && /Ngày không hợp lệ/.test(chk.rows[2].errors.join()), 'Thông báo lỗi nêu rõ trường và cách sửa');
  check(chk.rows.find(r => r.row === 5).errors.join().includes('không có quyền'), 'Dòng thuộc đơn vị không có quyền bị chặn');
  check(env.sheetRows('CHANGE_REQUESTS').filter(c => c.import_job_id).length === 0, 'Bước kiểm tra không ghi dữ liệu');
  const res = env.ok(f.tok.offA, 'import.commit', { rows, file_name: 'mau.csv' });
  check(res.ok === 2 && res.failed === 6, 'Chỉ nhập dòng hợp lệ (2), báo 6 dòng lỗi');
  check(env.sheetRows('MEMBERS').every(m => m.member_code !== '000777'), 'Dữ liệu nhập chưa vào hồ sơ chính thức khi chưa duyệt');
  const pend = env.ok(f.tok.apA, 'change.list', { box: 'approve', import_job_id: res.job_id });
  check(pend.total === 2, 'Các dòng nhập thành yêu cầu chờ duyệt');
  env.ok(f.tok.apA, 'change.approveMany', { change_ids: pend.items.map(i => i.change_id) });
  const raw = env.ss.getSheetByName('MEMBERS').data;
  const hdr = raw[0];
  const row = raw.find(r => r[hdr.indexOf('member_code')] === '000777');
  check(row && row[hdr.indexOf('phone')] === '0123456789' && row[hdr.indexOf('id_number')] === '012345678901', 'Giá trị trong Sheets giữ số 0 đầu (kiểu văn bản)');
  const row2 = raw.find(r => r[hdr.indexOf('member_code')] === '000783');
  check(row2 && row2[hdr.indexOf('note')] === '=1+1' && typeof row2[hdr.indexOf('note')] === 'string', 'Nội dung "=1+1" lưu dạng văn bản, không thành công thức');
  check(row2[hdr.indexOf('phone')] === '+84912000111', 'Số +84… giữ nguyên');
  const ex = env.ok(f.tok.offA, 'export.members', {});
  check(ex.csv.includes("'=1+1"), 'Xuất CSV: ô bắt đầu bằng "=" được vô hiệu hóa bằng dấu \'');
  check(ex.csv.charCodeAt(0) === 0xFEFF, 'CSV có BOM UTF-8 để Excel đọc đúng tiếng Việt');
  check(ex.csv.includes('000777') && ex.csv.includes('05/09/1990'), 'CSV giữ số 0 đầu và ngày dd/MM/yyyy');
  check(!env.call(f.tok.offA, 'import.check', { rows: new Array(1001).fill({ full_name: 'x', unit_code: 'A' }) }).ok, 'Giới hạn 1000 dòng mỗi lần nhập');
});

test('Dữ liệu HTML/ký tự đặc biệt không gây thực thi phía máy chủ; ngày không lệch múi giờ', () => {
  const f = fixture(), env = f.env;
  const x = env.call(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: '<img src=x onerror=alert(1)>', unit_id: f.units.A } });
  check(!x.ok && x.error.details.full_name, 'Tên chứa thẻ HTML bị từ chối');
  const n = env.ok(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Ghi Chú HTML', note: '<script>alert(1)</script>', dob: '31/12/1999', unit_id: f.units.A }, submit: true });
  env.ok(f.tok.apA, 'change.approve', { change_id: n.change_id });
  const m = env.sheetRows('MEMBERS').find(r => r.full_name === 'Ghi Chú HTML');
  check(m.note === '<script>alert(1)</script>', 'Ghi chú lưu nguyên văn (giao diện hiển thị bằng textContent — xem kiểm thử giao diện)');
  check(m.dob === '1999-12-31', 'Ngày 31/12/1999 lưu đúng 1999-12-31 (chuỗi, không lệch múi giờ)');
  const v = env.call(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Ngày Sai', dob: '30/02/2000', unit_id: f.units.A } });
  check(!v.ok && v.error.details.dob, 'Ngày 30/02 bị từ chối');
  const fut = env.call(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Tương Lai', dob: '01/01/2999', unit_id: f.units.A } });
  check(!fut.ok, 'Ngày sinh trong tương lai bị từ chối');
  const cccd = env.call(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'CCCD Sai', id_type: 'CCCD', id_number: '12345', unit_id: f.units.A } });
  check(!cccd.ok && cccd.error.details.id_number, 'CCCD phải 12 số');
  const dupCode = env.call(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Trùng Mã', member_code: '00123', unit_id: f.units.A } });
  check(!dupCode.ok && dupCode.error.details.member_code, 'Mã đoàn viên không trùng');
  const auto = env.sheetRows('MEMBERS').find(r => r.full_name === 'Ghi Chú HTML').member_code;
  check(/^DV\d{6}$/.test(auto), 'Mã tự sinh khi để trống: ' + auto);
  // Tìm kiếm không dấu
  check(env.ok(f.tok.offA, 'members.list', { q: 'nguyen van anh' }).total === 1, 'Tìm "nguyen van anh" thấy "Nguyễn Văn Ánh"');
  check(env.ok(f.tok.offA, 'members.list', { q: 'ÁNH' }).total === 1, 'Tìm không phân biệt hoa thường');
  check(env.ok(f.tok.offA, 'members.list', { q: '345678' }).total === 1, 'Tìm theo một phần số điện thoại');
  check(env.ok(f.tok.offA, 'members.list', { q: '001090012345' }).total === 1, 'Cán bộ tìm theo số giấy tờ (khớp chính xác)');
});

test('Đoàn phí: chống ghi trùng, điều chỉnh có lý do + lịch sử, thống kê đúng, phân quyền ghi', () => {
  const f = fixture(), env = f.env;
  const r = env.ok(f.tok.offA, 'dues.record', { period: '2026-10', items: [
    { member_id: f.mA.member_id, amount_due: '50.000', amount_paid: '20000', note: 'thu đợt 1' }] });
  check(r.created === 1, 'Ghi nhận cá nhân');
  const d = env.sheetRows('DUES')[0];
  check(d.amount_due === 50000 && d.amount_paid === 20000 && Number.isInteger(d.amount_due), 'Tiền lưu số nguyên VND ("50.000" → 50000)');
  const dup = env.ok(f.tok.offA, 'dues.record', { period: '2026-10', items: [{ member_id: f.mA.member_id, amount_due: 50000 }] });
  check(dup.created === 0 && dup.skipped.length === 1, 'Không ghi trùng cùng kỳ');
  check(env.ok(f.tok.offA2, 'dues.record', { period: '2026-11', items: [{ member_id: f.mA.member_id, amount_due: 1 }] }).created === 0, 'Cán bộ không có can_dues không ghi được');
  const neg = env.ok(f.tok.offA, 'dues.record', { period: '2026-11', items: [{ member_id: f.mA.member_id, amount_due: -5 }] });
  check(neg.failed.length === 1, 'Số tiền âm bị từ chối');
  const noReason = env.call(f.tok.offA, 'dues.adjust', { dues_id: d.dues_id, version: 1, amount_due: 50000, amount_paid: 50000 });
  check(!noReason.ok, 'Điều chỉnh bắt buộc lý do');
  env.ok(f.tok.offA, 'dues.adjust', { dues_id: d.dues_id, version: 1, amount_due: 50000, amount_paid: 50000, paid_date: '15/10/2026', reason: 'Thu đủ' });
  const stale = env.call(f.tok.offA, 'dues.adjust', { dues_id: d.dues_id, version: 1, amount_due: 1, amount_paid: 1, reason: 'cũ' });
  check(!stale.ok && stale.error.code === 'CONFLICT', 'Điều chỉnh dựa trên phiên bản cũ bị chặn');
  const h = env.ok(f.tok.offA, 'dues.history', { dues_id: d.dues_id }).items;
  check(h.length === 2 && h[1].old_paid === 20000 && h[1].new_paid === 50000 && h[1].reason === 'Thu đủ', 'Lịch sử điều chỉnh có giá trị cũ/mới, lý do');
  const s = env.ok(f.tok.admin, 'dues.summary', { period: '2026-10' });
  check(s.total.due === 50000 && s.total.paid === 50000 && s.total.missing === 0, 'Thống kê phải thu/đã thu/còn thiếu');
  env.ok(f.tok.offB, 'dues.record', { period: '2026-10', items: [{ member_id: f.mB.member_id, amount_due: 40000, amount_paid: 10000 }] });
  const sA = env.ok(f.tok.offA, 'dues.summary', { period: '2026-10' });
  check(sA.total.due === 50000, 'Cán bộ A chỉ thấy tổng của phạm vi A');
  const sAll = env.ok(f.tok.admin, 'dues.summary', { period: '2026-10' });
  check(sAll.total.missing === 30000, 'Tổng còn thiếu toàn hệ thống = 30.000');
  const list = env.ok(f.tok.offB, 'dues.list', { period: '2026-10', state: 'partial' });
  check(list.total === 1 && list.items[0].state === 'partial', 'Lọc theo tình trạng thu một phần');
  const csv = env.ok(f.tok.offB, 'export.report', { type: 'dues_detail', period: '2026-10' }).csv;
  check(csv.includes('Thu một phần') && !csv.includes('Ánh'), 'Xuất CSV đoàn phí đúng phạm vi');
  env.ok(f.tok.offA, 'dues.adjust', { dues_id: d.dues_id, version: 2, void: true, reason: 'Ghi nhầm' });
  check(env.ok(f.tok.offA, 'dues.record', { period: '2026-10', items: [{ member_id: f.mA.member_id, amount_due: 50000 }] }).created === 1, 'Sau khi hủy ghi nhầm có thể ghi lại');
});

test('Báo cáo và xuất dữ liệu đúng phạm vi quyền', () => {
  const f = fixture(), env = f.env;
  const rA = env.ok(f.tok.offA, 'report.byUnit', {});
  check(rA.total.total === 1 && rA.items.every(i => i.unit.includes('A')), 'Thống kê của A chỉ gồm A');
  const rAll = env.ok(f.tok.admin, 'report.byUnit', {});
  check(rAll.total.total === 2 && rAll.total.male === 1 && rAll.total.female === 1, 'Quản trị thấy toàn hệ thống, đếm theo giới tính đúng');
  const csv = env.ok(f.tok.offB, 'export.report', { type: 'by_unit' }).csv;
  check(csv.includes('TỔNG CỘNG') && !csv.includes('cơ sở A'), 'CSV thống kê của B không có A');
  const ex = env.ok(f.tok.offA, 'export.members', { fields: ['member_code', 'full_name', 'phone'] });
  check(ex.csv.split('\r\n')[0].includes('Mã đoàn viên') && !ex.csv.includes('Số giấy tờ'), 'Chọn được cột xuất');
  check(env.sheetRows('AUDIT_LOGS').some(l => l.action === 'EXPORT_MEMBERS' && l.actor === 'canbo.a@example.test'), 'Xuất dữ liệu được ghi nhật ký');
  const dash = env.ok(f.tok.offA, 'dashboard', {});
  check(dash.totalMembers === 1, 'Tổng quan theo phạm vi');
});

test('Quản trị: cây đơn vị chống vòng lặp, không ngừng đơn vị còn đoàn viên, luôn còn quản trị', () => {
  const f = fixture(), env = f.env, adm = f.tok.admin;
  const loop = env.call(adm, 'admin.unitSave', { unit_id: f.units.A, code: 'A', name: 'A', parent_id: f.units.A1 });
  check(!loop.ok && loop.error.details.parent_id, 'Không cho đơn vị con làm cấp trên');
  const off = env.call(adm, 'admin.unitSave', { unit_id: f.units.A, code: 'A', name: 'A', parent_id: f.units.root, status: 'inactive' });
  check(!off.ok && off.error.details.status, 'Không ngừng đơn vị còn đoàn viên');
  const dupCode = env.call(adm, 'admin.unitSave', { code: 'b', name: 'Trùng mã' });
  check(!dupCode.ok && dupCode.error.details.code, 'Mã đơn vị không trùng (không phân biệt hoa thường)');
  const meId = env.sheetRows('USERS').find(u => u.email === 'admin@example.test').user_id;
  check(!env.call(adm, 'admin.userSave', { user_id: meId, email: 'admin@example.test', full_name: 'QT', status: 'locked', is_admin: true }).ok, 'Không tự khóa mình');
  const levels = env.sheetRows('UNITS').find(u => u.unit_id === f.units.A1).level;
  check(levels === 3, 'Cấp đơn vị tự tính theo cây (A1 là cấp 3)');
  const bad = env.call(adm, 'admin.settingsSave', { values: { AUTH_PEPPER: 'x' } });
  check(!bad.ok, 'Không sửa được tham số ngoài danh sách cho phép');
  const lst = env.ok(adm, 'admin.audit', { q: 'LOGIN' });
  check(lst.total > 0, 'Xem nhật ký thao tác');
});

test('Sao lưu và khôi phục trên dữ liệu thử', () => {
  const f = fixture(), env = f.env, adm = f.tok.admin;
  const b = env.ok(adm, 'admin.backupNow', {});
  const list = env.ok(adm, 'admin.backupList', {});
  check(list.items.length === 1 && list.items[0].file_id === b.file_id, 'Tạo bản sao lưu trong thư mục riêng');
  // Thay đổi sau sao lưu
  const cr = env.ok(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Sau Sao Lưu', unit_id: f.units.A }, submit: true });
  env.ok(f.tok.apA, 'change.approve', { change_id: cr.change_id });
  check(env.sheetRows('MEMBERS').length === 3, 'Có 3 hồ sơ trước khi khôi phục');
  check(!env.call(adm, 'admin.restore', { file_id: b.file_id, confirm: 'ok' }).ok, 'Khôi phục bắt buộc gõ xác nhận');
  check(!env.call(f.tok.offA, 'admin.restore', { file_id: b.file_id, confirm: 'KHOI PHUC' }).ok, 'Không phải quản trị không khôi phục được');
  // Bản sao lưu hỏng cấu trúc
  const broken = SPREADSHEETS[b.file_id];
  const saved = broken.sheets;
  broken.sheets = saved.filter(s => s.name !== 'MEMBERS');
  check(/không đúng cấu trúc/.test(env.call(adm, 'admin.restore', { file_id: b.file_id, confirm: 'KHOI PHUC' }).error.message), 'Kiểm tra cấu trúc trước khi khôi phục');
  broken.sheets = saved;
  const res = env.ok(adm, 'admin.restore', { file_id: b.file_id, confirm: 'KHOI PHUC' });
  check(env.sheetRows('MEMBERS').length === 2, 'Dữ liệu trở về thời điểm sao lưu');
  check(env.ok(adm, 'admin.backupList', {}).items.some(i => /pre-restore/.test(i.name)), 'Tạo bản sao hiện trạng trước khi khôi phục');
  check(env.call(adm, 'dashboard', {}).ok, 'Phiên đăng nhập hiện tại vẫn hoạt động sau khôi phục');
  const m = env.sheetRows('MEMBERS').find(x => x.member_code === '00123');
  check(m && m.phone === '0912345678', 'Sau khôi phục vẫn giữ số 0 đầu');
  // Tác vụ hằng ngày tự giới hạn
  check(/Bỏ qua/.test(env.ctx.runScheduledMaintenance()), 'Tác vụ hằng ngày không chạy lại trong 20 giờ (chống lạm dụng)');
});

/* ---------------------- Hiệu năng (logic, trên giả lập) ---------------------- */
test('Hiệu năng giả lập: 5.000 hồ sơ — đo thời gian xử lý logic và số lần gọi Sheets', () => {
  const env = boot();
  env.state.activeUser = 'owner@example.test';
  env.props.DEMO_MODE = 'TRUE';
  env.ctx.seedDemoCore_(5000);
  env.ctx.invalidate_();
  const adm = env.login('admin@example.test');
  const ms = (fn) => { const t = process.hrtime.bigint(); const r = fn(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };
  const sh = env.ss.getSheetByName('MEMBERS');
  const perf = {};
  let [t1, l] = ms(() => env.ok(adm, 'members.list', { page: 1, pageSize: 20 }));
  perf.list_page1_ms = Math.round(t1); check(l.total === 5000, 'Đếm đủ 5.000 hồ sơ');
  [t1, l] = ms(() => env.ok(adm, 'members.list', { q: 'nguyen van an' }));
  perf.search_no_accent_ms = Math.round(t1);
  const before = { r: sh.reads, w: sh.writes };
  const units = env.sheetRows('UNITS');
  const leaf = units.find(u => u.code === 'DEMO-A1');
  const rows = Array.from({ length: 1000 }, (_, i) => ({ __row: i + 2, full_name: 'Nhập Thử ' + i, member_code: 'IMP' + String(i).padStart(5, '0'), unit_code: 'DEMO-A1', phone: '09' + String(i).padStart(8, '0') }));
  [t1] = ms(() => env.ok(adm, 'import.check', { rows }));
  perf.import_check_1000_ms = Math.round(t1);
  let res;
  [t1, res] = ms(() => env.ok(adm, 'import.commit', { rows }));
  perf.import_commit_1000_ms = Math.round(t1);
  check(res.ok === 1000, 'Nhập 1.000 dòng thành công');
  const crSheet = env.ss.getSheetByName('CHANGE_REQUESTS');
  perf.import_commit_writes_change_requests = crSheet.writes;
  check(crSheet.writes <= 3, 'Nhập theo lô: ghi CHANGE_REQUESTS bằng ít lần setValues (' + crSheet.writes + ')');
  const ids = env.ok(adm, 'change.list', { box: 'history', pageSize: 50 }).items.map(i => i.change_id);
  env.ok(adm, 'admin.settingsSave', { values: { ALLOW_ADMIN_SELF_APPROVE: 'TRUE' } });
  [t1, res] = ms(() => env.ok(adm, 'change.approveMany', { change_ids: ids }));
  perf.approve_50_ms = Math.round(t1);
  check(res.results.filter(r => r.ok).length === 50, 'Duyệt hàng loạt 50 yêu cầu');
  const mem = env.ok(adm, 'members.list', { q: 'DEMO00010' }).items[0];
  [t1] = ms(() => env.ok(adm, 'members.get', { member_id: mem.member_id }));
  perf.member_get_ms = Math.round(t1);
  [t1] = ms(() => env.ok(adm, 'export.members', {}));
  perf.export_all_ms = Math.round(t1);
  [t1] = ms(() => env.ok(adm, 'dashboard', {}));
  perf.dashboard_ms = Math.round(t1);
  [t1] = ms(() => env.ok(adm, 'dues.list', { period: '2026-10', pageSize: 100 }));
  perf.dues_list_ms = Math.round(t1);
  const cells = env.ss.getSheets().reduce((s, x) => s + x.data.reduce((a, r) => a + r.length, 0), 0);
  perf.total_cells = cells;
  current.perf = perf;
  check(true, 'Số liệu: ' + JSON.stringify(perf));
});

/* ---------------------- Bộ phân tích CSV của giao diện ---------------------- */
test('Bộ đọc CSV phía giao diện: BOM, dấu ngoặc kép, xuống dòng trong ô, dấu ; và số 0 đầu', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'App.html'), 'utf8');
  const m = html.match(/\/\* CSV-PARSER-START \*\/([\s\S]*?)\/\* CSV-PARSER-END \*\//);
  check(!!m, 'Tìm thấy bộ đọc CSV trong App.html');
  const parseCsv = new Function(m[1] + '; return parseCsv;')();
  const r = parseCsv('﻿Mã đoàn viên,Họ và tên,Ghi chú\r\n00123,"Nguyễn ""Văn"" A","dòng 1\ndòng 2"\r\n,,\r\n0045,Lê B,=1+1\r\n');
  check(r.length === 4 && r[1][0] === '00123' && r[1][1] === 'Nguyễn "Văn" A' && r[1][2] === 'dòng 1\ndòng 2', 'Đọc đúng ô có ngoặc kép và xuống dòng');
  check(r[0][0] === 'Mã đoàn viên', 'Bỏ BOM ở đầu tệp');
  const s = parseCsv('a;b;c\n1;2;3');
  check(s[1][2] === '3' && s[0].length === 3, 'Tự nhận dấu phân cách ; (Excel tiếng Việt)');
});

/* ---------------------- Tệp mẫu và bản gộp ---------------------- */
test('Tệp mẫu trong samples/ và bản gộp dist/MaNguon.gs hoạt động', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'App.html'), 'utf8');
  const parseCsv = new Function(html.match(/\/\* CSV-PARSER-START \*\/([\s\S]*?)\/\* CSV-PARSER-END \*\//)[1] + '; return parseCsv;')();
  const cols = [['member_code', 'Mã đoàn viên'], ['full_name', 'Họ và tên'], ['dob', 'Ngày sinh'], ['gender', 'Giới tính'], ['id_type', 'Loại giấy tờ'],
    ['id_number', 'Số giấy tờ'], ['phone', 'Số điện thoại'], ['email', 'Email'], ['address', 'Địa chỉ'], ['unit_code', 'Mã đơn vị'],
    ['join_date', 'Ngày vào công đoàn'], ['union_position', 'Chức vụ công đoàn'], ['member_status', 'Tình trạng sinh hoạt'], ['note', 'Ghi chú']];
  const load = f => {
    const rows = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'samples', f), 'utf8')).filter(r => r.some(c => c.trim()));
    const hdr = rows[0];
    return rows.slice(1).map((r, i) => { const o = { __row: i + 2 }; cols.forEach(c => { o[c[0]] = r[hdr.indexOf(c[1])] || ''; }); return o; });
  };
  const env = boot({ dir: path.join(__dirname, '..', 'dist') });
  check(typeof env.ctx.api === 'function' && typeof env.ctx.setupSystem === 'function', 'Bản gộp dist/MaNguon.gs nạp được và setupSystem chạy');
  env.ctx.seedDemoCore_(0);
  const adm = env.login('admin@example.test');
  const demo = env.ok(adm, 'import.check', { rows: load('du-lieu-thu-demo.csv') });
  check(demo.total === 60 && demo.ok === 60, 'du-lieu-thu-demo.csv: 60/60 dòng hợp lệ');
  const bad = env.ok(adm, 'import.check', { rows: load('du-lieu-thu-co-loi.csv') });
  const badRows = bad.rows.filter(r => !r.ok).map(r => r.row);
  check(JSON.stringify(badRows) === '[3,4,5,6,7,9]', 'du-lieu-thu-co-loi.csv: lỗi đúng các dòng 3,4,5,6,7,9 — thực tế ' + badRows);
  const tpl = env.ok(adm, 'import.check', { rows: load('mau-nhap-doan-vien.csv') });
  check(tpl.ok === 0 && /đơn vị/.test(tpl.rows[0].errors.join()), 'Dòng [MẪU] trong tệp mẫu không vô tình nhập được (mã đơn vị mẫu)');
  const res = env.ok(adm, 'import.commit', { rows: load('du-lieu-thu-demo.csv') });
  env.ok(adm, 'admin.settingsSave', { values: { ALLOW_ADMIN_SELF_APPROVE: 'TRUE' } });
  const ids = env.ok(adm, 'change.list', { box: 'approve', pageSize: 100 }).items.map(i => i.change_id);
  env.ok(adm, 'change.approveMany', { change_ids: ids.slice(0, 50) });
  const approved = env.sheetRows('MEMBERS').filter(x => /^070/.test(x.member_code));
  const m = approved.find(x => x.id_number);
  check(res.ok === 60 && approved.length === 50 && m && /^0\d{11}$/.test(m.id_number) && /^09/.test(m.phone) && /^0700/.test(m.member_code), 'Sau duyệt: mã, giấy tờ, điện thoại giữ số 0 đầu');
});

/* ---------------------- Kết quả ---------------------- */
const out = { ranAt: new Date().toISOString(), node: process.version, total: results.length,
  passed: results.filter(r => r.ok).length, results: results.map(r => ({ name: r.name, ok: r.ok, ms: r.ms, checks: r.checks, perf: r.perf })) };
fs.writeFileSync(path.join(__dirname, 'test-results.json'), JSON.stringify(out, null, 2));
const nChecks = results.reduce((s, r) => s + r.checks.length, 0), nFail = results.reduce((s, r) => s + r.checks.filter(c => !c.ok).length, 0);
console.log(`\n${out.passed}/${out.total} nhóm kiểm thử đạt; ${nChecks - nFail}/${nChecks} điểm kiểm tra đạt.`);
process.exit(out.passed === out.total ? 0 : 1);
