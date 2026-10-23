/**
 * Setup.gs — Khởi tạo và nâng cấp cấu trúc dữ liệu.
 *
 * setupSystem(): chạy từ trình soạn thảo Apps Script (nút Chạy).
 *  - Tạo sheet còn thiếu, thêm cột còn thiếu (không xóa, không ghi đè dữ liệu).
 *  - Tạo tham số mặc định còn thiếu.
 *  - Tạo khóa bí mật AUTH_PEPPER nếu chưa có.
 *  - Tạo quản trị viên đầu tiên CHỈ từ Script Property ADMIN_EMAIL (do chủ sở hữu tự nhập)
 *    và CHỈ khi hệ thống chưa có quản trị viên đang hoạt động.
 *  - Chạy các bước nâng cấp schema theo SCHEMA_VERSION.
 */

/**
 * Chỉ cho phép chạy trong ngữ cảnh chủ sở hữu (trình soạn thảo / trigger của chủ sở hữu).
 * Khi gọi qua Web App bởi người khác, getActiveUser() trả rỗng hoặc khác chủ sở hữu → từ chối.
 */
function assertOwnerContext_() {
  var eff = '', act = '';
  try { eff = Session.getEffectiveUser().getEmail(); } catch (e) { }
  try { act = Session.getActiveUser().getEmail(); } catch (e) { }
  if (!eff || !act || eff.toLowerCase() !== act.toLowerCase()) {
    throw new Error('Hàm này chỉ được chạy bởi chủ sở hữu từ trình soạn thảo Apps Script.');
  }
}

function setupSystem() {
  assertOwnerContext_();
  var report = withLock_(function () { return setupCore_(); });
  console.log(report.join('\n'));
  return report.join('\n');
}

function setupCore_() {
  var report = [];
  var ss = ss_();
  var props = PropertiesService.getScriptProperties();

  if (!props.getProperty('SPREADSHEET_ID')) {
    props.setProperty('SPREADSHEET_ID', ss.getId());
    report.push('Đã ghi SPREADSHEET_ID của bảng tính vào Script Properties.');
  }
  if (!props.getProperty('AUTH_PEPPER')) {
    props.setProperty('AUTH_PEPPER', randomHex_(64));
    report.push('Đã tạo khóa bí mật AUTH_PEPPER (lưu trong Script Properties).');
  }

  SHEET_ORDER.forEach(function (name) {
    var def = SCHEMA[name];
    var sh = ss.getSheetByName(name);
    var codes = def.columns.map(function (c) { return c[0]; });
    if (!sh) {
      sh = ss.insertSheet(name);
      ensureSize_(sh, 1, codes.length);
      sh.getRange(1, 1, 1, codes.length).setValues([codes]);
      report.push('Tạo sheet ' + name + '.');
    } else {
      var lastCol = Math.max(sh.getLastColumn(), 1);
      var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
      var missing = codes.filter(function (c) { return existing.indexOf(c) < 0; });
      if (missing.length) {
        var startCol = existing.filter(function (h) { return h; }).length ? lastCol + 1 : 1;
        ensureSize_(sh, 1, startCol + missing.length - 1);
        sh.getRange(1, startCol, 1, missing.length).setValues([missing]);
        report.push('Thêm cột vào ' + name + ': ' + missing.join(', '));
      }
    }
    formatSheet_(sh, def);
  });
  invalidate_();

  // Tham số mặc định (không ghi đè giá trị đã có)
  var settings = rows_('SETTINGS');
  var have = {};
  settings.forEach(function (r) { have[r.key] = true; });
  var add = DEFAULT_SETTINGS.filter(function (d) { return !have[d[0]]; })
    .map(function (d) { return { key: d[0], value: d[1], description: d[2], updated_at: now_() }; });
  if (add.length) { insertRows_('SETTINGS', add); report.push('Thêm ' + add.length + ' tham số mặc định.'); }

  // Đơn vị gốc nếu chưa có đơn vị nào
  if (!rows_('UNITS').length) {
    insertRow_('UNITS', {
      unit_id: newId_('U'), code: 'GOC', name: 'Đơn vị gốc (đổi tên trong mục Quản trị)', parent_id: '',
      level: 1, status: 'active', sort_order: 1, created_at: now_(), updated_at: '', version: 1
    });
    report.push('Tạo đơn vị gốc.');
  }

  report = report.concat(migrate_());
  report = report.concat(bootstrapAdmin_());
  buildGuideSheet_();
  report.push('Hoàn tất. Phiên bản cấu trúc: ' + getSetting_('SCHEMA_VERSION'));
  return report;
}

function bootstrapAdmin_() {
  var out = [];
  var admins = rows_('USERS').filter(function (u) { return u.is_admin && u.status === 'active'; });
  if (admins.length) return out;
  var email = String(PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '').trim().toLowerCase();
  if (!email) {
    out.push('CHƯA có quản trị viên. Hãy thêm Script Property ADMIN_EMAIL rồi chạy lại setupSystem().');
    return out;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { out.push('ADMIN_EMAIL không hợp lệ.'); return out; }
  var u = findBy_('USERS', 'email', email);
  if (u) {
    u.is_admin = true; u.status = 'active'; u.updated_at = now_(); u.version = (u.version || 0) + 1;
    updateRow_('USERS', u);
  } else {
    insertRow_('USERS', {
      user_id: newId_('USR'), email: email, full_name: 'Quản trị viên', status: 'active', is_admin: true,
      created_at: now_(), created_by: 'setupSystem', updated_at: '', last_login_at: '', version: 1
    });
  }
  insertRow_('AUDIT_LOGS', {
    log_id: newId_('LOG'), at: now_(), actor: 'setupSystem', action: 'BOOTSTRAP_ADMIN', object_type: 'USER',
    object_id: email, result: 'OK', request_id: '', detail: 'Tạo quản trị viên đầu tiên từ Script Property'
  });
  out.push('Đã cấp quyền quản trị cho ' + email + '.');
  return out;
}

/** Danh sách bước nâng cấp. Mỗi bước chỉ THÊM, không xóa dữ liệu. */
var MIGRATIONS = [
  { to: 1, run: function () { /* Phiên bản đầu: cột đã được tạo bởi setupCore_ */ } }
];

function migrate_() {
  var out = [];
  var cur = parseInt(getSetting_('SCHEMA_VERSION', '0'), 10) || 0;
  MIGRATIONS.forEach(function (m) {
    if (m.to > cur) { m.run(); setSetting_('SCHEMA_VERSION', m.to); cur = m.to; out.push('Nâng cấp cấu trúc lên phiên bản ' + m.to + '.'); }
  });
  return out;
}

function formatSheet_(sh, def) {
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return;
  var header = sh.getRange(1, 1, 1, lastCol);
  header.setFontWeight('bold').setBackground('#e8f0fe').setWrap(false);
  var codes = header.getValues()[0];
  var labels = {};
  def.columns.forEach(function (c) { labels[c[0]] = c; });
  var notes = codes.map(function (c) {
    var col = labels[c];
    return col ? col[1] + (col[3] ? ' (bắt buộc)' : '') + ' — kiểu: ' + col[2] : '';
  });
  header.setNotes([notes]);
  sh.setFrozenRows(1);
  // Định dạng văn bản thuần cho toàn bộ cột chuỗi để giữ số 0 đầu và tránh tự đổi kiểu.
  var maxRows = sh.getMaxRows();
  codes.forEach(function (c, i) {
    var col = labels[c];
    if (col && col[2] !== 'int' && col[2] !== 'bool' && maxRows > 1) sh.getRange(2, i + 1, maxRows - 1, 1).setNumberFormat('@');
  });
  // Bảo vệ dạng cảnh báo: nhắc người vận hành không sửa nhầm dữ liệu nguồn.
  var prot = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (!prot.length) sh.protect().setDescription('Dữ liệu nguồn — chỉ sửa qua ứng dụng').setWarningOnly(true);
}

function buildGuideSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName('HUONG_DAN') || ss.insertSheet('HUONG_DAN', 0);
  var lines = [['Sheet', 'Mã trường', 'Tên tiếng Việt', 'Kiểu', 'Bắt buộc', 'Ghi chú sheet']];
  SHEET_ORDER.forEach(function (name) {
    var def = SCHEMA[name];
    def.columns.forEach(function (c, i) {
      lines.push([name, c[0], c[1], c[2], c[3] ? 'Có' : '', i === 0 ? def.title + '. ' + def.note : '']);
    });
  });
  sh.clearContents();
  ensureSize_(sh, lines.length, lines[0].length);
  sh.getRange(1, 1, lines.length, lines[0].length).setValues(lines);
  sh.getRange(1, 1, 1, lines[0].length).setFontWeight('bold').setBackground('#fff3cd');
  sh.setFrozenRows(1);
}
