/**
 * Backup.gs — Sao lưu và khôi phục Google Sheets vào thư mục Drive riêng (không chia sẻ công khai).
 *
 *  - backupNow: tạo bản sao toàn bộ bảng tính vào thư mục sao lưu.
 *  - Giữ lại BACKUP_KEEP bản tự động mới nhất; bản cũ hơn chuyển vào Thùng rác (khôi phục được 30 ngày).
 *  - Khôi phục: kiểm tra cấu trúc bản sao → tạo bản sao hiện trạng → chép dữ liệu từng sheet.
 *    Không khôi phục SESSIONS và AUTH_OTP (giữ phiên đăng nhập hiện tại).
 */

var BACKUP_PREFIX = 'SAO LUU - Quan ly doan vien - ';

function backupFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('BACKUP_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  var folder = DriveApp.createFolder('Sao lưu - Quản lý đoàn viên (KHÔNG chia sẻ)');
  props.setProperty('BACKUP_FOLDER_ID', folder.getId());
  return folder;
}

/** Tạo bản sao. kind: 'manual' | 'auto' | 'pre-restore'. KHÔNG gọi khi đang giữ khóa lâu (thao tác Drive). */
function createBackup_(kind, actor) {
  var file = DriveApp.getFileById(ss_().getId());
  var name = BACKUP_PREFIX + Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HH-mm-ss') + ' (' + kind + ')';
  var copy = file.makeCopy(name, backupFolder_());
  copy.setDescription('Sao lưu ' + kind + ' bởi ' + actor);
  withLock_(function () { setSetting_('LAST_BACKUP_AT', now_()); });
  return { file_id: copy.getId(), name: name };
}

function pruneBackups_() {
  var keep = parseInt(getSetting_('BACKUP_KEEP', '14'), 10) || 14;
  var files = [], it = backupFolder_().getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(BACKUP_PREFIX) === 0 && f.getName().indexOf('(auto)') > 0) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  var removed = 0;
  files.slice(keep).forEach(function (f) { f.setTrashed(true); removed++; });
  return removed;
}

function backupList_(ctx) {
  assertAdmin_(ctx);
  var out = [], it = backupFolder_().getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(BACKUP_PREFIX) !== 0) continue;
    out.push({ file_id: f.getId(), name: f.getName(),
      created_at: Utilities.formatDate(f.getDateCreated(), APP.TZ, "yyyy-MM-dd'T'HH:mm:ss") });
  }
  out.sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  return { items: out.slice(0, 60), lastBackupAt: getSetting_('LAST_BACKUP_AT', '') };
}

function backupNowApi_(ctx, p, requestId) {
  assertAdmin_(ctx);
  var r = createBackup_('manual', ctx.user.email);
  audit_(ctx, 'BACKUP', 'SYSTEM', r.file_id, 'OK', requestId, '');
  return { file_id: r.file_id, message: 'Đã tạo bản sao lưu: ' + r.name };
}

/** Kiểm tra cấu trúc bản sao lưu trước khi khôi phục. */
function validateBackup_(backupSs) {
  var problems = [];
  SHEET_ORDER.forEach(function (name) {
    if (NO_RESTORE_SHEETS.indexOf(name) >= 0) return;
    var sh = backupSs.getSheetByName(name);
    if (!sh) { problems.push('Thiếu sheet ' + name); return; }
    var headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
    var key = SCHEMA[name].key;
    if (headers.indexOf(key) < 0) problems.push('Sheet ' + name + ' thiếu cột khóa ' + key);
  });
  return problems;
}

/**
 * Khôi phục từ bản sao lưu (quản trị, phải gõ xác nhận "KHOI PHUC").
 * Bước: kiểm tra cấu trúc → tạo bản sao hiện trạng (pre-restore) → chép dữ liệu theo tên cột.
 */
function restoreApi_(ctx, p, requestId) {
  assertAdmin_(ctx);
  if (String(p && p.confirm || '').trim().toUpperCase() !== 'KHOI PHUC') {
    throw AppError_(ERR.VALIDATION, 'Hãy gõ đúng cụm từ KHOI PHUC để xác nhận.');
  }
  var fileId = String(p.file_id || '');
  var file;
  try { file = DriveApp.getFileById(fileId); } catch (e) { throw AppError_(ERR.NOT_FOUND, 'Không mở được tệp sao lưu.'); }
  var parents = file.getParents(), inFolder = false, folderId = backupFolder_().getId();
  while (parents.hasNext()) if (parents.next().getId() === folderId) inFolder = true;
  if (!inFolder) throw AppError_(ERR.FORBIDDEN, 'Chỉ khôi phục từ tệp nằm trong thư mục sao lưu của hệ thống.');
  var src = SpreadsheetApp.openById(fileId);
  var problems = validateBackup_(src);
  if (problems.length) throw AppError_(ERR.VALIDATION, 'Bản sao lưu không đúng cấu trúc: ' + problems.join('; '));

  var pre = createBackup_('pre-restore', ctx.user.email);
  var counts = restoreFrom_(src);
  audit_(ctx, 'RESTORE', 'SYSTEM', fileId, 'OK', requestId, 'Bản hiện trạng trước khôi phục: ' + pre.file_id);
  return { message: 'Đã khôi phục. Bản hiện trạng trước khi khôi phục đã được lưu: ' + pre.name, counts: counts };
}

function restoreFrom_(src) {
  return withLock_(function () {
    var counts = {};
    SHEET_ORDER.forEach(function (name) {
      if (NO_RESTORE_SHEETS.indexOf(name) >= 0) return;
      var from = src.getSheetByName(name);
      var to = sheet_(name);
      var data = from.getLastRow() > 0 ? from.getRange(1, 1, from.getLastRow(), Math.max(from.getLastColumn(), 1)).getValues() : [[]];
      var srcHeaders = data[0].map(String);
      var t = table_(name);
      // Ghép theo tên cột để chịu được khác biệt thứ tự/cột mới.
      var lines = data.slice(1).filter(function (r) { return r.some(function (v) { return v !== ''; }); }).map(function (r) {
        return t.headers.map(function (h) {
          var i = srcHeaders.indexOf(h);
          var v = i >= 0 ? r[i] : '';
          var type = t.types[h];
          return toCell_(fromCell_(v, type), type);
        });
      });
      if (to.getLastRow() > 1) to.getRange(2, 1, to.getLastRow() - 1, t.headers.length).clearContent();
      if (lines.length) { ensureSize_(to, lines.length + 1, t.headers.length); to.getRange(2, 1, lines.length, t.headers.length).setValues(lines); }
      counts[name] = lines.length;
      invalidate_(name);
    });
    setSetting_('LAST_BACKUP_AT', now_()); // bản pre-restore vừa được tạo
    return counts;
  });
}

/* ============ Hàm chủ sở hữu chạy từ trình soạn thảo / trigger ============ */

/** Cài lịch sao lưu tự động hằng ngày lúc khoảng 1 giờ sáng. */
function installDailyBackup() {
  assertOwnerContext_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runScheduledMaintenance') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runScheduledMaintenance').timeBased().everyDays(1).atHour(1).inTimezone(APP.TZ).create();
  return 'Đã cài lịch sao lưu và dọn dẹp hằng ngày lúc 1 giờ sáng.';
}

function removeDailyBackup() {
  assertOwnerContext_();
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runScheduledMaintenance') { ScriptApp.deleteTrigger(t); n++; }
  });
  return 'Đã gỡ ' + n + ' lịch.';
}

/**
 * Tác vụ hằng ngày: sao lưu, xóa bản cũ, dọn OTP/phiên hết hạn.
 * Có thể bị gọi qua google.script.run bởi bất kỳ ai nên tự giới hạn: chỉ chạy nếu bản sao lưu gần nhất đã quá 20 giờ.
 */
function runScheduledMaintenance() {
  var last = getSetting_('LAST_BACKUP_AT', '');
  if (last && minutesSince_(last) < 20 * 60) return 'Bỏ qua: đã sao lưu trong 20 giờ qua.';
  var r = createBackup_('auto', 'scheduler');
  var removed = pruneBackups_();
  var cleaned = cleanupAuth_();
  audit_(null, 'SCHEDULED_MAINTENANCE', 'SYSTEM', r.file_id, 'OK', '', 'Xóa ' + removed + ' bản cũ, dọn ' + cleaned + ' dòng xác thực');
  return 'Đã sao lưu ' + r.name;
}

/** Khôi phục từ trình soạn thảo: đặt Script Property RESTORE_FILE_ID rồi chạy hàm này. */
function restoreFromScriptProperty() {
  assertOwnerContext_();
  var props = PropertiesService.getScriptProperties();
  var fileId = props.getProperty('RESTORE_FILE_ID');
  if (!fileId) throw new Error('Chưa đặt Script Property RESTORE_FILE_ID.');
  var src = SpreadsheetApp.openById(fileId);
  var problems = validateBackup_(src);
  if (problems.length) throw new Error('Bản sao lưu không đúng cấu trúc: ' + problems.join('; '));
  var pre = createBackup_('pre-restore', 'owner');
  var counts = restoreFrom_(src);
  props.deleteProperty('RESTORE_FILE_ID');
  audit_(null, 'RESTORE_OWNER', 'SYSTEM', fileId, 'OK', '', 'pre-restore: ' + pre.file_id);
  return 'Đã khôi phục: ' + JSON.stringify(counts) + '. Bản hiện trạng trước đó: ' + pre.name;
}

/** Phục hồi thao tác dở dang từ trình soạn thảo. */
function recoverFromEditor() {
  assertOwnerContext_();
  return JSON.stringify(recoverOperations_({ user: { email: 'owner', user_id: 'owner' } }, 'owner-' + randomHex_(12)));
}
