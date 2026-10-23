/**
 * ui-test.js — Kiểm thử giao diện thật trên trình duyệt Chromium (Playwright), nối với máy chủ giả lập.
 * google.script.run được thay bằng cầu nối tới Apps Script giả lập (cùng mã .gs thật).
 * Chạy: NODE_PATH=<thư mục chứa playwright> node tests/ui-test.js
 * Kết quả: tests/ui-results.json và ảnh chụp trong tests/screenshots/.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { fixture } = require('./fixture');

const ROOT = path.join(__dirname, '..', 'apps-script');
const SHOTS = path.join(__dirname, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

function buildHtml() {
  let html = fs.readFileSync(path.join(ROOT, 'Index.html'), 'utf8');
  html = html.replace("<?!= include_('Styles'); ?>", fs.readFileSync(path.join(ROOT, 'Styles.html'), 'utf8'));
  html = html.replace("<?!= include_('App'); ?>", fs.readFileSync(path.join(ROOT, 'App.html'), 'utf8'));
  if (html.includes('<?')) throw new Error('Còn scriptlet chưa xử lý');
  return html;
}

// Cầu nối giả lập google.script.run → hàm api() của Apps Script giả lập (bất đồng bộ như thật).
const BRIDGE = `
window.google = { script: { run: (function () {
  function runner(ok, fail) {
    return {
      withSuccessHandler: function (f) { return runner(f, fail); },
      withFailureHandler: function (f) { return runner(ok, f); },
      api: function (req) { window.__api(JSON.stringify(req)).then(function (r) { setTimeout(function(){ ok && ok(JSON.parse(r)); }, 30); }, function (e) { fail && fail(e); }); }
    };
  }
  return runner(null, null);
})() } };`;

const results = [];
function rec(name, ok, note) { results.push({ name, ok: !!ok, note: note || '' }); console.log((ok ? 'ĐẠT ' : 'LỖI ') + name + (note ? ' — ' + note : '')); }

(async () => {
  const f = fixture();
  const env = f.env;
  // Thêm hồ sơ có ghi chú chứa mã HTML độc để kiểm tra XSS
  const xss = env.ok(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Thử Bảo Mật', unit_id: f.units.A,
    note: '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>', address: '"><svg onload="window.__xss=3">' }, submit: true });
  env.ok(f.tok.apA, 'change.approve', { change_id: xss.change_id });
  for (let i = 0; i < 25; i++) {
    const c = env.ok(f.tok.offA, 'change.save', { request_type: 'CREATE', data: { full_name: 'Đoàn Viên Thử ' + (i + 1), unit_id: f.units.A1, phone: '09' + String(10000000 + i), dob: '0' + (1 + i % 9) + '/03/1988', gender: i % 2 ? 'Nam' : 'Nữ' }, submit: true });
    env.ok(f.tok.apA, 'change.approve', { change_id: c.change_id });
  }
  const html = buildHtml();
  const browser = await chromium.launch();

  async function newPage(viewport) {
    const ctx = await browser.newContext({ viewport, locale: 'vi-VN', timezoneId: 'America/Los_Angeles' }); // múi giờ trình duyệt khác VN để kiểm tra lệch ngày
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.exposeFunction('__api', reqJson => {
      env.ctx.invalidate_(); env.ctx.__DUP_INDEX = null;
      return JSON.stringify(JSON.parse(JSON.stringify(env.ctx.api(JSON.parse(reqJson)))));
    });
    await page.addInitScript(BRIDGE);
    await page.route('http://app.test/', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
    await page.goto('http://app.test/');
    page.errors = errors;
    return page;
  }
  async function login(page, email) {
    Object.keys(env.cache).forEach(k => delete env.cache[k]);
    await page.fill('#login-email', email);
    await page.click('button:has-text("Gửi mã đăng nhập")');
    await page.waitForSelector('#login-otp');
    const otp = env.outbox[env.outbox.length - 1].body.match(/(\d{6})/)[1];
    await page.fill('#login-otp', otp);
    await page.click('button:has-text("Đăng nhập")');
    await page.waitForSelector('nav.menu');
  }
  const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  try {
    /* ---------- Điện thoại: cán bộ đơn vị ---------- */
    const phone = await newPage({ width: 375, height: 812 });
    await phone.screenshot({ path: path.join(SHOTS, '01-dang-nhap-dien-thoai.png') });
    // Email sai định dạng → thông báo lỗi rõ
    await phone.fill('#login-email', 'abc');
    await phone.click('button:has-text("Gửi mã đăng nhập")');
    rec('Báo lỗi email sai định dạng kèm ví dụ', await phone.isVisible('text=Ví dụ: ten@coquan.vn'));
    // OTP sai
    Object.keys(env.cache).forEach(k => delete env.cache[k]);
    await phone.fill('#login-email', 'canbo.a@example.test');
    await phone.click('button:has-text("Gửi mã đăng nhập")');
    await phone.waitForSelector('#login-otp');
    const realOtp = env.outbox[env.outbox.length - 1].body.match(/(\d{6})/)[1];
    await phone.fill('#login-otp', realOtp === '000000' ? '111111' : '000000');
    await phone.click('button:has-text("Đăng nhập")');
    await phone.waitForSelector('.alert.error');
    rec('OTP sai: hiển thị lỗi và hướng dẫn gửi lại mã', /Gửi lại mã/.test(await phone.textContent('.alert.error')));
    await phone.fill('#login-otp', realOtp);
    await phone.click('button:has-text("Đăng nhập")');
    await phone.waitForSelector('nav.menu');
    await phone.waitForSelector('.stat');
    await phone.screenshot({ path: path.join(SHOTS, '02-tong-quan-dien-thoai.png'), fullPage: true });
    rec('Tổng quan trên điện thoại không bị tràn ngang', await noHScroll(phone));
    const stored = await phone.evaluate(() => ({ ls: JSON.stringify(localStorage), ss: Object.keys(sessionStorage) }));
    rec('Không lưu token trong localStorage (chỉ sessionStorage, mất khi đóng thẻ)', stored.ls === '{}' && stored.ss.includes('qldv.session'));
    rec('Menu cán bộ không có mục Quản trị', !(await phone.isVisible('nav.menu button[data-view="admin"]')));

    await phone.click('nav.menu button[data-view="members"]');
    await phone.waitForSelector('table.data');
    await phone.screenshot({ path: path.join(SHOTS, '03-danh-sach-dien-thoai.png'), fullPage: true });
    rec('Danh sách đoàn viên trên điện thoại hiển thị dạng thẻ, không tràn ngang', await noHScroll(phone));
    const pagerTxt = await phone.textContent('.pager');
    rec('Phân trang phía máy chủ (20 dòng/trang)', /Trang 1\/2/.test(pagerTxt), pagerTxt);
    await phone.fill('#m-q', 'doan vien thu 1');
    await phone.press('#m-q', 'Enter');
    await phone.waitForFunction(() => document.querySelectorAll('table.data tbody tr').length > 0 && /Đoàn Viên Thử 1/.test(document.querySelector('table.data').textContent));
    rec('Tìm kiếm tên không dấu trên giao diện', true);

    // Thêm đoàn viên: lỗi bỏ trống, rồi gửi duyệt
    await phone.click('button:has-text("+ Thêm đoàn viên")');
    await phone.waitForSelector('.dialog');
    await phone.screenshot({ path: path.join(SHOTS, '04-bieu-mau-them-dien-thoai.png'), fullPage: true });
    rec('Biểu mẫu chia nhóm Cơ bản / Liên hệ / Công đoàn + Thông tin bổ sung thu gọn',
      await phone.isVisible('legend:has-text("Thông tin cơ bản")') && await phone.isVisible('legend:has-text("Thông tin liên hệ")') &&
      await phone.isVisible('legend:has-text("Thông tin công đoàn")') && !(await phone.isVisible('label:has-text("Số giấy tờ định danh")')));
    await phone.click('.dialog button:has-text("Gửi duyệt")');
    rec('Bỏ trống họ tên: báo lỗi ngay tại ô', await phone.isVisible('.field.invalid >> text=Vui lòng nhập họ và tên.'));
    await phone.fill('.dialog input[id$="_full_name"]', 'Phạm Thị Giao Diện');
    await phone.fill('.dialog input[id$="_dob"]', '0102199');
    await phone.type('.dialog input[id$="_dob"]', '5');
    const dobVal = await phone.inputValue('.dialog input[id$="_dob"]');
    rec('Ô ngày tự định dạng dd/mm/yyyy khi gõ số', dobVal === '01/02/1995', dobVal);
    await phone.selectOption('.dialog select[id$="_unit_id"]', { index: 1 });
    await phone.click('.dialog summary');
    await phone.fill('.dialog input[id$="_phone"]', '0901234567');
    await phone.fill('.dialog input[id$="_id_number"]', '012345678901');
    await phone.selectOption('.dialog select[id$="_id_type"]', 'CCCD');
    // Bấm 2 lần liên tiếp: nút bị khóa, chỉ tạo 1 yêu cầu
    const before = env.sheetRows('CHANGE_REQUESTS').length;
    const btn = phone.locator('.dialog button:has-text("Gửi duyệt")');
    await btn.click();
    await btn.click({ force: true, noWaitAfter: true, timeout: 500 }).catch(() => { });
    await phone.waitForSelector('#toast .msg');
    const toastTxt = await phone.textContent('#toast .msg');
    rec('Thông báo thành công sau khi gửi duyệt', /chờ duyệt/.test(toastTxt), toastTxt);
    rec('Bấm gửi lặp chỉ tạo một yêu cầu', env.sheetRows('CHANGE_REQUESTS').length === before + 1);
    const created = env.sheetRows('CHANGE_REQUESTS').slice(-1)[0];
    const payload = JSON.parse(created.payload_json);
    rec('Ngày nhập ở trình duyệt múi giờ khác vẫn lưu đúng 1995-02-01', payload.dob === '1995-02-01', payload.dob);
    rec('Số điện thoại/giấy tờ giữ số 0 đầu khi gửi từ giao diện', payload.phone === '0901234567' && payload.id_number === '012345678901');

    // XSS: mở hồ sơ có ghi chú độc hại
    await phone.click('nav.menu button[data-view="members"]');
    await phone.waitForSelector('table.data');
    await phone.fill('#m-q', 'thu bao mat');
    await phone.press('#m-q', 'Enter');
    await phone.waitForFunction(() => /Thử Bảo Mật/.test(document.querySelector('main').textContent));
    await phone.click('td:has-text("Thử Bảo Mật")');
    await phone.waitForSelector('.dialog .kv');
    await phone.waitForTimeout(300);
    const xssState = await phone.evaluate(() => ({ flag: window.__xss, imgs: document.querySelectorAll('.dialog img, .dialog svg, .dialog script').length,
      text: document.querySelector('.dialog').textContent }));
    rec('Dữ liệu chứa HTML/script hiển thị dạng chữ, không thực thi (chống XSS)', xssState.flag === undefined && xssState.imgs === 0 && xssState.text.includes('<img src=x'));
    await phone.screenshot({ path: path.join(SHOTS, '05-chi-tiet-ho-so-dien-thoai.png'), fullPage: true });
    await phone.click('.dialog footer button:has-text("Đóng")');

    // Nhập CSV qua giao diện
    await phone.click('nav.menu button[data-view="members"]');
    await phone.click('button:has-text("Nhập từ tệp CSV")');
    const csv = '﻿Mã đoàn viên;Họ và tên;Ngày sinh;Số điện thoại;Mã đơn vị\r\n000555;Võ Văn Nhập;12/12/1980;0987654321;A\r\n000556;;01/01/1990;0911;A\r\n';
    const tmp = path.join(__dirname, 'tmp-import.csv'); fs.writeFileSync(tmp, csv);
    await phone.setInputFiles('#imp-file', tmp);
    await phone.waitForSelector('text=Bước 2');
    await phone.click('button:has-text("Bước 3: Kiểm tra dữ liệu")');
    await phone.waitForSelector('text=Kết quả kiểm tra');
    const prev = await phone.textContent('.dialog');
    rec('Xem trước nhập CSV: báo lỗi đúng dòng 3', /1\/2 dòng hợp lệ/.test(prev) && /Vui lòng nhập họ và tên/.test(prev));
    await phone.screenshot({ path: path.join(SHOTS, '06-nhap-csv-dien-thoai.png'), fullPage: true });
    await phone.click('button:has-text("Bước 4")');
    await phone.waitForSelector('text=Mã lô');
    const crImp = env.sheetRows('CHANGE_REQUESTS').find(c => c.summary === 'Thêm mới: Võ Văn Nhập');
    rec('Nhập CSV qua giao diện tạo yêu cầu chờ duyệt, giữ số 0 đầu', crImp && JSON.parse(crImp.payload_json).member_code === '000555' && crImp.status === 'PENDING');
    fs.unlinkSync(tmp);
    await phone.click('.dialog footer button:has-text("Đóng")');
    rec('Không có lỗi JavaScript trên trang (điện thoại)', phone.errors.length === 0, phone.errors.join(' | '));

    /* ---------- Máy tính: người phê duyệt ---------- */
    const desk = await newPage({ width: 1366, height: 860 });
    await login(desk, 'duyet.a@example.test');
    await desk.click('nav.menu button[data-view="approvals"]');
    await desk.waitForSelector('table.data');
    await desk.screenshot({ path: path.join(SHOTS, '07-cho-duyet-may-tinh.png') });
    await desk.click('td:has-text("Phạm Thị Giao Diện")');
    await desk.waitForSelector('.dialog h3');
    await desk.click('.dialog button:has-text("Trả lại")');
    await desk.click('.dialog button:has-text("Trả lại")');
    rec('Trả lại không ghi lý do bị chặn ở giao diện', await desk.isVisible('.dialog .alert.error'));
    await desk.fill('#ret-note', 'Bổ sung ngày vào công đoàn');
    await desk.click('.dialog button:has-text("Trả lại")');
    await desk.waitForSelector('#toast .msg');
    rec('Trả lại kèm lý do thành công', env.sheetRows('CHANGE_REQUESTS').some(c => c.status === 'RETURNED' && c.decision_note === 'Bổ sung ngày vào công đoàn'));
    // Duyệt yêu cầu nhập từ tệp, xem diff
    await desk.waitForTimeout(400);
    await desk.click('td:has-text("Võ Văn Nhập")');
    await desk.waitForSelector('.dialog h3');
    await desk.screenshot({ path: path.join(SHOTS, '08-chi-tiet-yeu-cau-may-tinh.png') });
    await desk.click('.dialog button.ok:has-text("Duyệt")');
    await desk.waitForSelector('#toast .msg');
    rec('Duyệt từ giao diện cập nhật hồ sơ chính thức', env.sheetRows('MEMBERS').some(m => m.member_code === '000555' && m.phone === '0987654321'));
    // Sửa hồ sơ → so sánh cũ/mới
    const tokOff = f.tok.offA;
    const mm = env.ok(tokOff, 'members.get', { member_id: f.mA.member_id }).member;
    env.ok(tokOff, 'change.save', { request_type: 'UPDATE', member_id: mm.member_id, base_version: mm.version, data: Object.assign({}, mm, { phone: '0999888777', union_position: 'Tổ phó' }), submit: true });
    await desk.click('nav.menu button[data-view="approvals"]');
    await desk.waitForSelector('td:has-text("Sửa hồ sơ")');
    await desk.click('td:has-text("Sửa hồ sơ")');
    await desk.waitForSelector('.diff-new');
    const diffTxt = await desk.textContent('.dialog table');
    rec('Màn hình duyệt hiển thị giá trị cũ và mới', diffTxt.includes('0912345678') && diffTxt.includes('0999888777'));
    await desk.screenshot({ path: path.join(SHOTS, '09-so-sanh-cu-moi-may-tinh.png') });
    await desk.click('.dialog footer button:has-text("Đóng")');
    rec('Không có lỗi JavaScript trên trang (máy tính)', desk.errors.length === 0, desk.errors.join(' | '));

    /* ---------- Điện thoại: quản trị + đoàn phí + báo cáo ---------- */
    const adm = await newPage({ width: 390, height: 844 });
    await login(adm, 'admin@example.test');
    await adm.click('nav.menu button[data-view="dues"]');
    await adm.waitForSelector('table.data');
    await adm.click('button:has-text("Ghi nhận cho cả trang đang xem")');
    await adm.waitForSelector('#dr-due');
    await adm.fill('#dr-due', '25000');
    await adm.check('#dr-full');
    await adm.click('.dialog button:has-text("Lưu ghi nhận")');
    await adm.waitForSelector('#toast .msg');
    const dues = env.sheetRows('DUES');
    rec('Ghi nhận đoàn phí hàng loạt từ giao diện (số nguyên VND)', dues.length > 0 && dues.every(d => d.amount_due === 25000 && d.amount_paid === 25000));
    await adm.waitForTimeout(400);
    await adm.screenshot({ path: path.join(SHOTS, '10-doan-phi-dien-thoai.png'), fullPage: true });
    rec('Trang đoàn phí trên điện thoại không tràn ngang', await noHScroll(adm));
    await adm.click('nav.menu button[data-view="reports"]');
    await adm.waitForSelector('text=TỔNG CỘNG');
    const dl = adm.waitForEvent('download');
    await adm.click('button:has-text("Tải CSV thống kê")');
    const file = await dl;
    const content = fs.readFileSync(await file.path(), 'utf8');
    rec('Tải tệp CSV báo cáo (UTF-8 có BOM)', content.charCodeAt(0) === 0xFEFF && content.includes('TỔNG CỘNG'), file.suggestedFilename());
    await adm.click('nav.menu button[data-view="admin"]');
    await adm.waitForSelector('text=Thêm đơn vị');
    await adm.screenshot({ path: path.join(SHOTS, '11-quan-tri-dien-thoai.png'), fullPage: true });
    rec('Trang quản trị trên điện thoại không tràn ngang', await noHScroll(adm));
    await adm.click('button[role="tab"]:has-text("Người dùng")');
    await adm.waitForSelector('td:has-text("canbo2.a@example.test")');
    await adm.click('td:has-text("canbo2.a@example.test")');
    await adm.waitForSelector('.dialog select[id$="_status"]');
    await adm.selectOption('.dialog select[id$="_status"]', 'locked');
    await adm.click('.dialog button:has-text("Lưu thông tin người dùng")');
    await adm.waitForSelector('#toast .msg');
    rec('Khóa tài khoản từ giao diện quản trị', env.sheetRows('USERS').find(u => u.email === 'canbo2.a@example.test').status === 'locked');
    rec('Không có lỗi JavaScript trên trang (quản trị)', adm.errors.length === 0, adm.errors.join(' | '));

    /* ---------- Phiên hết hiệu lực: tự quay về màn hình đăng nhập ---------- */
    const p2 = await newPage({ width: 375, height: 700 });
    await login(p2, 'xem.a@example.test');
    rec('Người xem không có nút thêm đoàn viên', !(await p2.isVisible('button:has-text("+ Thêm đoàn viên")')));
    const vu = env.sheetRows('USERS').find(u => u.email === 'xem.a@example.test');
    env.ok(f.tok.admin, 'admin.revokeSessions', { user_id: vu.user_id });
    await p2.click('nav.menu button[data-view="members"]');
    await p2.waitForSelector('#login-email');
    rec('Phiên bị thu hồi: giao diện tự quay về đăng nhập kèm thông báo', await p2.isVisible('.alert.info'));

    /* ---------- Trang GitHub Pages dưới đường dẫn /ten-repository/ ---------- */
    const DOCS = path.join(__dirname, '..', 'docs');
    for (const cfgUrl of ['', 'https://script.google.com/macros/s/AKfycbTEST_123-abc/exec', 'https://evil.example/exec']) {
      const ctx = await browser.newContext({ viewport: { width: 375, height: 760 } });
      const pg = await ctx.newPage();
      let missing = 0;
      await pg.route('http://pages.test/**', r => {
        const u = new URL(r.request().url());
        if (!u.pathname.startsWith('/quan-ly-doan-vien/')) { missing++; return r.fulfill({ status: 404, body: 'not found' }); }
        let rel = u.pathname.replace('/quan-ly-doan-vien/', '') || 'index.html';
        if (rel === 'config.js') return r.fulfill({ contentType: 'text/javascript', body: `window.APP_CONFIG={webAppUrl:${JSON.stringify(cfgUrl)},orgName:'Công đoàn Thử nghiệm'};` });
        const fp = path.join(DOCS, rel);
        if (!fs.existsSync(fp)) { missing++; return r.fulfill({ status: 404, body: 'not found' }); }
        r.fulfill({ contentType: rel.endsWith('.css') ? 'text/css' : rel.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8', body: fs.readFileSync(fp) });
      });
      await pg.goto('http://pages.test/quan-ly-doan-vien/');
      const href = await pg.getAttribute('#open-app', 'href');
      const bg = await pg.evaluate(() => getComputedStyle(document.querySelector('.top')).backgroundColor);
      if (cfgUrl.includes('script.google.com')) {
        rec('GitHub Pages dưới /ten-repository/: tải đủ CSS/JS bằng đường dẫn tương đối, nút mở đúng Web App', missing === 0 && bg === 'rgb(29, 79, 145)' && href === cfgUrl);
        await pg.screenshot({ path: path.join(SHOTS, '00-github-pages-dien-thoai.png'), fullPage: true });
      } else if (!cfgUrl) rec('GitHub Pages chưa cấu hình: nút bị vô hiệu và có hướng dẫn', href === null && await pg.isVisible('#config-warning'));
      else rec('GitHub Pages từ chối địa chỉ không phải Web App của Google', href === null);
      await ctx.close();
    }
  } catch (e) {
    rec('Kịch bản giao diện chạy hết', false, e.message.split('\n')[0]);
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(__dirname, 'ui-results.json'), JSON.stringify({ ranAt: new Date().toISOString(), browser: 'Chromium (Playwright)', results }, null, 2));
  const pass = results.filter(r => r.ok).length;
  console.log(`\n${pass}/${results.length} kiểm tra giao diện đạt.`);
  process.exit(pass === results.length ? 0 : 1);
})();
