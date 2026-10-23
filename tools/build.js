/**
 * tools/build.js — Công cụ cho NGƯỜI PHÁT TRIỂN (không cần khi triển khai/vận hành).
 * Chạy: node tools/build.js
 *  1. Sinh dist/MaNguon.gs: gộp mọi tệp .gs thành MỘT tệp để dán vào Apps Script cho nhanh.
 *  2. Sinh DATA_DICTIONARY.md từ SCHEMA trong Config.gs (luôn khớp với mã).
 *  3. Sinh tệp mẫu và dữ liệu giả lập trong samples/.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'apps-script');

// 1. Gộp mã nguồn
const order = ['Config.gs', 'Repository.gs', 'Setup.gs', 'Auth.gs', 'Permissions.gs', 'Audit.gs', 'Members.gs', 'Approvals.gs',
  'Transfers.gs', 'Dues.gs', 'ImportExport.gs', 'Admin.gs', 'Backup.gs', 'Demo.gs', 'Code.gs'];
const all = fs.readdirSync(SRC).filter(f => f.endsWith('.gs'));
const missing = all.filter(f => !order.includes(f));
if (missing.length) throw new Error('Thiếu trong danh sách gộp: ' + missing.join(', '));
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const bundle = '/**\n * MaNguon.gs — BẢN GỘP TỰ SINH từ thư mục apps-script/ bằng tools/build.js. KHÔNG sửa trực tiếp.\n' +
  ' * Dùng MỘT trong hai cách: dán tệp này (cùng Index.html, Styles.html, App.html) HOẶC dán từng tệp .gs riêng — không dùng cả hai.\n */\n\n' +
  order.map(f => '/* ======================= ' + f + ' ======================= */\n' + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n\n');
fs.writeFileSync(path.join(ROOT, 'dist', 'MaNguon.gs'), bundle);
['Index.html', 'Styles.html', 'App.html', 'appsscript.json'].forEach(f => fs.copyFileSync(path.join(SRC, f), path.join(ROOT, 'dist', f)));

// 2. Từ điển dữ liệu
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(SRC, 'Config.gs'), 'utf8'), ctx);
const typeVN = { id: 'Mã định danh (chuỗi)', text: 'Chuỗi', date: 'Ngày (chuỗi yyyy-MM-dd)', datetime: 'Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN)',
  int: 'Số nguyên', bool: 'TRUE/FALSE', json: 'Chuỗi JSON', enum: 'Danh mục (chuỗi)' };
const relations = {
  UNITS: 'parent_id → UNITS.unit_id (cây đơn vị). Khóa duy nhất: unit_id, code.',
  USERS: 'Khóa duy nhất: user_id, email (chữ thường).',
  USER_SCOPES: 'user_id → USERS; unit_id → UNITS. Không trùng (user_id, unit_id, role) đang active.',
  MEMBERS: 'unit_id → UNITS. Khóa duy nhất: member_id; member_code (không phân biệt hoa thường); id_number khi có giá trị. last_ref → CHANGE_REQUESTS.change_id hoặc TRANSFER_REQUESTS.transfer_id.',
  CHANGE_REQUESTS: 'member_id → MEMBERS (với CREATE: ID sẽ cấp khi duyệt); unit_id → UNITS; import_job_id → IMPORT_JOBS.',
  APPROVAL_ACTIONS: 'target_id → CHANGE_REQUESTS.change_id hoặc TRANSFER_REQUESTS.transfer_id (theo target_type).',
  TRANSFER_REQUESTS: 'member_id → MEMBERS; from_unit_id, to_unit_id → UNITS. Tối đa 1 yêu cầu PENDING / đoàn viên.',
  MEMBERSHIP_HISTORY: 'member_id → MEMBERS; unit_id → UNITS; ref_id → yêu cầu gây ra sự kiện.',
  DUES: 'member_id → MEMBERS; unit_id → UNITS. Duy nhất (member_id, period) với status ACTIVE.',
  DUES_HISTORY: 'dues_id → DUES.',
  AUDIT_LOGS: 'Chỉ ghi thêm.',
  IMPORT_JOBS: 'request_id → OPERATIONS.request_id.',
  OPERATIONS: 'Duy nhất (actor_user_id, request_id).',
  SESSIONS: 'user_id → USERS. token_hash duy nhất.',
  AUTH_OTP: 'email_hash là HMAC của email (không lưu email rõ).',
  SETTINGS: 'Khóa duy nhất: key.'
};
let md = '# Từ điển dữ liệu (DATA_DICTIONARY)\n\n> Tệp này được sinh tự động từ `apps-script/Config.gs` bằng `node tools/build.js`.\n\n' +
  'Mỗi sheet có **dòng 1 là mã trường ổn định** (dùng trong mã nguồn). Tên tiếng Việt nằm trong ghi chú của ô tiêu đề và trong sheet `HUONG_DAN`.\n\n' +
  '**Quy ước lưu trữ**\n\n- Mọi chuỗi được ghi với tiền tố `\'` nên Google Sheets luôn coi là văn bản: giữ số 0 đầu (mã, điện thoại, giấy tờ) và không bao giờ diễn giải thành công thức.\n' +
  '- Ngày lưu dạng chuỗi `yyyy-MM-dd`, ngày giờ dạng `yyyy-MM-ddTHH:mm:ss` theo giờ Việt Nam (Asia/Ho_Chi_Minh) — không lệch ngày khi đổi múi giờ.\n' +
  '- Tiền là số nguyên VND.\n- ID nội bộ là chuỗi ngẫu nhiên có tiền tố (vd `M-…`, `CR-…`), không phụ thuộc số dòng.\n\n' +
  '**Bảng bổ sung ngoài danh sách yêu cầu:** `DUES_HISTORY` (lịch sử điều chỉnh đoàn phí), `SESSIONS` và `AUTH_OTP` (xác thực OTP, chỉ lưu mã băm), `HUONG_DAN` (giải thích tiếng Việt, tự sinh).\n\n' +
  '## Danh mục giá trị\n\n' +
  '- Tình trạng sinh hoạt (`MEMBERS.member_status`): ' + Object.keys(ctx.MEMBER_STATUS).map(k => '`' + k + '` = ' + ctx.MEMBER_STATUS[k]).join('; ') + '\n' +
  '- Loại yêu cầu (`CHANGE_REQUESTS.request_type`): ' + Object.keys(ctx.CR_TYPES).map(k => '`' + k + '` = ' + ctx.CR_TYPES[k]).join('; ') + '\n' +
  '- Trạng thái yêu cầu (`CHANGE_REQUESTS.status`): ' + Object.keys(ctx.CR_STATUS).map(k => '`' + k + '` = ' + ctx.CR_STATUS[k]).join('; ') + '\n' +
  '- Trạng thái chuyển sinh hoạt (`TRANSFER_REQUESTS.status`): ' + Object.keys(ctx.TR_STATUS).map(k => '`' + k + '` = ' + ctx.TR_STATUS[k]).join('; ') + '\n' +
  '- Vai trò (`USER_SCOPES.role`): `officer` = Cán bộ đơn vị; `approver` = Người phê duyệt; `viewer` = Người xem. Quản trị hệ thống = `USERS.is_admin`.\n' +
  '- Giới tính: ' + ctx.GENDERS.join(', ') + '. Loại giấy tờ: ' + ctx.ID_TYPES.join(', ') + '.\n\n' +
  '> Ba khái niệm được tách riêng: **tình trạng đoàn viên** (`member_status`), **loại yêu cầu** (`request_type`) và **trạng thái yêu cầu** (`status`).\n\n';
ctx.SHEET_ORDER.forEach(name => {
  const d = ctx.SCHEMA[name];
  md += '## ' + name + ' — ' + d.title + '\n\n' + d.note + '\n\n**Khóa và quan hệ:** ' + (relations[name] || '') + '\n\n' +
    '| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |\n|---|---|---|---|\n' +
    d.columns.map(c => '| `' + c[0] + '` | ' + c[1] + ' | ' + typeVN[c[2]] + ' | ' + (c[3] ? 'Có' : '') + ' |').join('\n') + '\n\n';
});
md += '## SETTINGS — các tham số mặc định\n\n| Mã | Giá trị mặc định | Ý nghĩa |\n|---|---|---|\n' +
  ctx.DEFAULT_SETTINGS.map(s => '| `' + s[0] + '` | ' + (s[1] || '(trống)') + ' | ' + s[2] + ' |').join('\n') + '\n';
fs.writeFileSync(path.join(ROOT, 'DATA_DICTIONARY.md'), md);

// 3. Tệp mẫu + dữ liệu giả lập
const IMPORT_HEADER = ['Mã đoàn viên', 'Họ và tên', 'Ngày sinh', 'Giới tính', 'Loại giấy tờ', 'Số giấy tờ', 'Số điện thoại', 'Email', 'Địa chỉ',
  'Mã đơn vị', 'Ngày vào công đoàn', 'Chức vụ công đoàn', 'Tình trạng sinh hoạt', 'Ghi chú'];
const csvLine = r => r.map(v => /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(',');
const writeCsv = (f, rows) => fs.writeFileSync(path.join(ROOT, 'samples', f), '﻿' + rows.map(csvLine).join('\r\n') + '\r\n');
fs.mkdirSync(path.join(ROOT, 'samples'), { recursive: true });
writeCsv('mau-nhap-doan-vien.csv', [IMPORT_HEADER,
  ['', '[MẪU] Nguyễn Văn A', '05/09/1990', 'Nam', 'CCCD', '001090000000', '0912000000', '', '', 'MA-DON-VI', '01/03/2015', '', 'Đang sinh hoạt', 'Xóa dòng mẫu này trước khi nhập']]);
const ho = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Huỳnh'], dem = ['Văn', 'Thị', 'Hữu', 'Ngọc', 'Minh', 'Thanh'];
const ten = ['An', 'Bình', 'Cường', 'Dung', 'Giang', 'Hà', 'Hải', 'Hương', 'Khánh', 'Lan', 'Long', 'Mai', 'Nam', 'Phúc', 'Quân'];
const units = ['DEMO-A1', 'DEMO-A2', 'DEMO-B1'];
const demo = [IMPORT_HEADER];
for (let i = 1; i <= 60; i++) {
  const g = i % 2 ? 'Nam' : 'Nữ';
  demo.push(['0' + String(70000 + i), '[DEMO] ' + ho[i % 10] + ' ' + (g === 'Nữ' ? 'Thị' : dem[i % 6]) + ' ' + ten[(i * 7) % 15],
    String(1 + i % 28).padStart(2, '0') + '/' + String(1 + i % 12).padStart(2, '0') + '/' + (1970 + i % 30), g,
    i % 3 ? 'CCCD' : '', i % 3 ? '0' + String(99000000000 + i) : '', '09' + String(80000000 + i), '', '', units[i % 3],
    '15/0' + (1 + i % 9) + '/' + (2000 + i % 20), i % 20 === 0 ? 'Tổ trưởng' : '', i % 15 === 0 ? 'Tạm dừng sinh hoạt' : 'Đang sinh hoạt', 'Dữ liệu giả lập']);
}
writeCsv('du-lieu-thu-demo.csv', demo);
writeCsv('du-lieu-thu-co-loi.csv', [IMPORT_HEADER,
  ['0DEMO1', '[DEMO] Dòng Hợp Lệ', '01/01/1990', 'Nam', 'CCCD', '012345678999', '0911222333', '', '', 'DEMO-A1', '', '', 'Đang sinh hoạt', 'Dòng 2: hợp lệ'],
  ['0DEMO2', '', '01/01/1990', '', '', '', '', '', '', 'DEMO-A1', '', '', '', 'Dòng 3: thiếu họ tên'],
  ['0DEMO3', '[DEMO] Sai Ngày', '31/02/1990', '', '', '', '', '', '', 'DEMO-A1', '', '', '', 'Dòng 4: ngày không tồn tại'],
  ['0DEMO4', '[DEMO] Sai CCCD', '', '', 'CCCD', '12345', '', '', '', 'DEMO-A1', '', '', '', 'Dòng 5: CCCD không đủ 12 số'],
  ['0DEMO5', '[DEMO] Sai Đơn Vị', '', '', '', '', '', '', '', 'KHONG-CO', '', '', '', 'Dòng 6: mã đơn vị không tồn tại'],
  ['0DEMO1', '[DEMO] Trùng Mã', '', '', '', '', '', '', '', 'DEMO-A1', '', '', '', 'Dòng 7: trùng mã với dòng 2'],
  ['0DEMO7', '[DEMO] Công Thức', '', '', '', '', '+84912000999', '', '', 'DEMO-A1', '', '', '', '=HYPERLINK("http://vi-du","bấm") — dòng 8 hợp lệ, ghi chú phải lưu dạng chữ'],
  ['0DEMO8', '[DEMO] Sai Điện Thoại', '', '', '', '', '12345', '', '', 'DEMO-A1', '', '', '', 'Dòng 9: điện thoại sai']]);
console.log('Đã sinh dist/, DATA_DICTIONARY.md và samples/.');
