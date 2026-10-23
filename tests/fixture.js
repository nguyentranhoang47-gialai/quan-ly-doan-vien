/**
 * fixture.js — Dựng môi trường giả lập + dữ liệu thử dùng chung cho kiểm thử nghiệp vụ và giao diện.
 */
const { createEnv } = require('./gas-mock');
const crypto = require('crypto');
const rid = () => 'T' + crypto.randomBytes(8).toString('hex');

/* ---------------- Môi trường + tiện ích gọi API giống google.script.run ---------------- */
function boot(opts) {
  const env = createEnv(opts);
  env.props.ADMIN_EMAIL = 'admin@example.test';
  env.ctx.setupSystem();
  env.call = (token, action, payload, requestId) => {
    // Mỗi lần gọi google.script.run là một lần thực thi mới: xóa bộ đệm trong bộ nhớ.
    env.ctx.invalidate_(); env.ctx.__DUP_INDEX = null; env.ctx.__SS = null;
    const req = JSON.parse(JSON.stringify({ token, action, payload: payload || {}, requestId: requestId === undefined ? rid() : requestId }));
    return JSON.parse(JSON.stringify(env.ctx.api(req)));
  };
  env.ok = (token, action, payload, requestId) => {
    const r = env.call(token, action, payload, requestId);
    if (!r.ok) throw new Error(action + ' thất bại: ' + JSON.stringify(r.error));
    return r.data;
  };
  env.login = email => {
    env.cache && Object.keys(env.cache).forEach(k => delete env.cache[k]); // bỏ bộ đếm tần suất giữa các lần đăng nhập thử
    const before = env.outbox.length;
    env.ok(null, 'auth.requestOtp', { email });
    const mail = env.outbox[env.outbox.length - 1];
    if (env.outbox.length === before) throw new Error('Không có email OTP cho ' + email);
    const otp = mail.body.match(/(\d{6})/)[1];
    return env.ok(null, 'auth.verifyOtp', { email, otp }).token;
  };
  env.sheetRows = name => {
    const sh = env.ss.getSheetByName(name);
    const [h, ...rows] = sh.data;
    return rows.filter(r => r.some(v => v !== '' && v !== undefined)).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
  };
  return env;
}

/** Dựng cây đơn vị + người dùng dùng chung cho nhiều kiểm thử. */
function fixture() {
  const env = boot();
  const admin = env.login('admin@example.test');
  const root = env.sheetRows('UNITS')[0].unit_id;
  const mk = (code, name, parent) => env.ok(admin, 'admin.unitSave', { code, name, parent_id: parent }).unit_id;
  const A = mk('A', 'Công đoàn cơ sở A', root), B = mk('B', 'Công đoàn cơ sở B', root);
  const A1 = mk('A1', 'Tổ A1', A), C = mk('C', 'Công đoàn C (sẽ ngừng)', root);
  const user = (email, name, scopes) => {
    const id = env.ok(admin, 'admin.userSave', { email, full_name: name, status: 'active', is_admin: false }).user_id;
    scopes.forEach(s => env.ok(admin, 'admin.scopeAdd', Object.assign({ user_id: id }, s)));
    return id;
  };
  const ids = {
    offA: user('canbo.a@example.test', 'Cán bộ A', [{ unit_id: A, role: 'officer', include_children: true, can_dues: true }]),
    offA2: user('canbo2.a@example.test', 'Cán bộ A thứ hai', [{ unit_id: A, role: 'officer', include_children: true, can_dues: false }]),
    apA: user('duyet.a@example.test', 'Duyệt A', [{ unit_id: A, role: 'approver', include_children: true }]),
    offB: user('canbo.b@example.test', 'Cán bộ B', [{ unit_id: B, role: 'officer', include_children: true, can_dues: true }]),
    apB: user('duyet.b@example.test', 'Duyệt B', [{ unit_id: B, role: 'approver', include_children: true }]),
    viewA: user('xem.a@example.test', 'Người xem A', [{ unit_id: A, role: 'viewer', include_children: true }]),
    multi: user('nhieu@example.test', 'Nhiều đơn vị', [{ unit_id: A1, role: 'officer', include_children: false }, { unit_id: B, role: 'viewer', include_children: true }])
  };
  const tok = {
    admin, offA: env.login('canbo.a@example.test'), offA2: env.login('canbo2.a@example.test'), apA: env.login('duyet.a@example.test'),
    offB: env.login('canbo.b@example.test'), apB: env.login('duyet.b@example.test'), viewA: env.login('xem.a@example.test'),
    multi: env.login('nhieu@example.test')
  };
  // Tạo + duyệt một hồ sơ ở mỗi đơn vị
  const create = (tokOff, tokAp, data) => {
    const cr = env.ok(tokOff, 'change.save', { request_type: 'CREATE', data, submit: true });
    return env.ok(tokAp, 'change.approve', { change_id: cr.change_id });
  };
  const mA = create(tok.offA, tok.apA, { full_name: 'Nguyễn Văn Ánh', dob: '05/09/1990', gender: 'Nam', id_type: 'CCCD', id_number: '001090012345', phone: '0912345678', address: '12 Lê Lợi', unit_id: A, member_code: '00123' });
  const mB = create(tok.offB, tok.apB, { full_name: 'Trần Thị Bích', dob: '1992-02-29', gender: 'Nữ', phone: '0987000111', unit_id: B });
  return { env, units: { root, A, B, A1, C }, ids, tok, mA, mB, create };
}


module.exports = { boot, fixture, rid };
