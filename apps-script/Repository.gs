/**
 * Repository.gs — Truy cập Google Sheets theo lô và các tiện ích dùng chung.
 *
 * Nguyên tắc:
 *  - Đọc cả sheet bằng MỘT lần getValues() rồi xử lý trong bộ nhớ.
 *  - Ghi theo lô: thêm nhiều dòng bằng một setValues(); sửa một dòng bằng một setValues().
 *  - Ánh xạ cột theo MÃ TRƯỜNG ở dòng 1 (không phụ thuộc vị trí cột).
 *  - Mọi chuỗi được ghi với tiền tố "'" để Sheets luôn coi là văn bản:
 *    giữ số 0 đầu và KHÔNG diễn giải thành công thức (=, +, -, @).
 *  - Bộ đệm chỉ tồn tại trong MỘT lần thực thi (không chia sẻ giữa người dùng).
 */

var __TABLES = {};      // bộ đệm theo lần thực thi
var __SS = null;

function ss_() {
  if (__SS) return __SS;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  __SS = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!__SS) throw AppError_(ERR.INTERNAL, 'Chưa cấu hình bảng tính. Quản trị cần đặt SPREADSHEET_ID trong Script Properties.');
  return __SS;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw AppError_(ERR.INTERNAL, 'Thiếu sheet ' + name + '. Người vận hành cần chạy setupSystem().');
  return sh;
}

/** Xóa bộ đệm sau khi ghi hoặc khi bắt đầu thao tác ghi có khóa. */
function invalidate_(name) {
  if (name) delete __TABLES[name]; else __TABLES = {};
}

/**
 * Đọc toàn bộ bảng. Trả về { rows: [obj...], headers, index: {key:colIdx} }.
 * Mỗi obj có thuộc tính ẩn _row (số dòng thực trên sheet, chỉ dùng nội bộ để ghi lại).
 */
function table_(name) {
  if (__TABLES[name]) return __TABLES[name];
  var sh = sheet_(name);
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  var values = lastRow > 0 && lastCol > 0 ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var index = {};
  headers.forEach(function (h, i) { if (h) index[h] = i; });
  var schema = SCHEMA[name];
  var types = {};
  schema.columns.forEach(function (c) { types[c[0]] = c[2]; });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var line = values[r];
    var empty = true;
    for (var k = 0; k < line.length; k++) { if (line[k] !== '' && line[k] !== null) { empty = false; break; } }
    if (empty) continue;
    var o = {};
    for (var key in index) o[key] = fromCell_(line[index[key]], types[key]);
    Object.defineProperty(o, '_row', { value: r + 1, enumerable: false, writable: true });
    rows.push(o);
  }
  var t = { name: name, rows: rows, headers: headers, index: index, types: types };
  __TABLES[name] = t;
  return t;
}

function rows_(name) { return table_(name).rows; }

function findBy_(name, key, value) {
  var rs = rows_(name);
  for (var i = 0; i < rs.length; i++) if (rs[i][key] === value) return rs[i];
  return null;
}

function filterBy_(name, pred) { return rows_(name).filter(pred); }

/** Chuyển giá trị ô sang JS. */
function fromCell_(v, type) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    // Người vận hành có thể đã gõ ngày trực tiếp — chuẩn hóa theo múi giờ Việt Nam để không lệch ngày.
    if (type === 'datetime') return Utilities.formatDate(v, APP.TZ, "yyyy-MM-dd'T'HH:mm:ss");
    return Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd');
  }
  if (type === 'int') { if (v === '') return ''; var n = Number(v); return isFinite(n) ? Math.round(n) : ''; }
  if (type === 'bool') return v === true || String(v).toUpperCase() === 'TRUE';
  return typeof v === 'string' ? v : String(v);
}

/** Chuyển giá trị JS sang ô. Chuỗi luôn có tiền tố "'" (giữ văn bản, chống công thức). */
function toCell_(v, type) {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'int') { var n = Number(v); return isFinite(n) ? Math.round(n) : ''; }
  if (type === 'bool') return v === true || String(v).toUpperCase() === 'TRUE';
  if (type === 'json' && typeof v !== 'string') v = JSON.stringify(v);
  return "'" + String(v);
}

function objToLine_(t, obj) {
  var line = new Array(t.headers.length);
  for (var i = 0; i < t.headers.length; i++) {
    var key = t.headers[i];
    line[i] = key && obj.hasOwnProperty(key) ? toCell_(obj[key], t.types[key]) : '';
  }
  return line;
}

/** Bảo đảm sheet đủ số dòng/cột trước khi ghi (getRange vượt kích thước sheet sẽ báo lỗi). */
function ensureSize_(sh, lastRow, lastCol) {
  var maxR = sh.getMaxRows();
  if (lastRow > maxR) sh.insertRowsAfter(maxR, Math.max(lastRow - maxR, 500));
  var maxC = sh.getMaxColumns();
  if (lastCol && lastCol > maxC) sh.insertColumnsAfter(maxC, lastCol - maxC);
}

/** Thêm nhiều dòng trong MỘT lần ghi. Phải gọi khi đang giữ khóa. */
function insertRows_(name, objs) {
  if (!objs.length) return;
  var t = table_(name);
  var sh = sheet_(name);
  var start = Math.max(sh.getLastRow(), 1) + 1;
  ensureSize_(sh, start + objs.length - 1, t.headers.length);
  var lines = objs.map(function (o) { return objToLine_(t, o); });
  sh.getRange(start, 1, lines.length, t.headers.length).setValues(lines);
  objs.forEach(function (o, i) {
    Object.defineProperty(o, '_row', { value: start + i, enumerable: false, writable: true });
    t.rows.push(o);
  });
}

function insertRow_(name, obj) { insertRows_(name, [obj]); return obj; }

/**
 * Ghi đè một dòng đã đọc. Kiểm tra lại khóa chính ở vị trí dòng để không ghi nhầm
 * nếu người vận hành đã chèn/xóa dòng trên sheet.
 */
function updateRow_(name, obj) {
  var t = table_(name);
  var sh = sheet_(name);
  var keyCol = t.index[SCHEMA[name].key];
  var current = sh.getRange(obj._row, keyCol + 1).getValue();
  if (String(current) !== String(obj[SCHEMA[name].key])) {
    invalidate_(name);
    throw AppError_(ERR.CONFLICT, 'Dữ liệu vừa bị thay đổi bởi thao tác khác. Vui lòng tải lại và thử lại.');
  }
  sh.getRange(obj._row, 1, 1, t.headers.length).setValues([objToLine_(t, obj)]);
}

/** Ghi nhiều dòng đã sửa: gom các dòng liền nhau để giảm số lần gọi. */
function updateRows_(name, objs) {
  if (!objs.length) return;
  if (objs.length === 1) return updateRow_(name, objs[0]);
  var t = table_(name);
  var sh = sheet_(name);
  var sorted = objs.slice().sort(function (a, b) { return a._row - b._row; });
  var i = 0;
  while (i < sorted.length) {
    var j = i;
    while (j + 1 < sorted.length && sorted[j + 1]._row === sorted[j]._row + 1) j++;
    var block = sorted.slice(i, j + 1);
    sh.getRange(block[0]._row, 1, block.length, t.headers.length).setValues(block.map(function (o) { return objToLine_(t, o); }));
    i = j + 1;
  }
}

/* ===================== Tiện ích chung ===================== */

function now_() { return Utilities.formatDate(new Date(), APP.TZ, "yyyy-MM-dd'T'HH:mm:ss"); }
function today_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'); }
function addMinutes_(iso, mins) {
  var d = parseIsoLocal_(iso);
  return Utilities.formatDate(new Date(d.getTime() + mins * 60000), APP.TZ, "yyyy-MM-dd'T'HH:mm:ss");
}
/** Phân tích chuỗi yyyy-MM-ddTHH:mm:ss theo giờ Việt Nam (+07:00, không có giờ mùa hè). */
function parseIsoLocal_(iso) { return new Date(String(iso).substring(0, 19) + '+07:00'); }
function minutesSince_(iso) { return (Date.now() - parseIsoLocal_(iso).getTime()) / 60000; }

/** Sinh ID khó đoán từ UUID (Java SecureRandom), không dùng Math.random. */
function newId_(prefix) { return prefix + '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 16).toUpperCase(); }
function randomHex_(n) {
  var s = '';
  while (s.length < n) s += Utilities.getUuid().replace(/-/g, '');
  return s.substring(0, n);
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}
function pepper_() {
  var p = PropertiesService.getScriptProperties().getProperty('AUTH_PEPPER');
  if (!p) throw AppError_(ERR.INTERNAL, 'Hệ thống chưa được thiết lập. Người vận hành cần chạy setupSystem().');
  return p;
}
function hmac_(value) { return bytesToHex_(Utilities.computeHmacSha256Signature(String(value), pepper_())); }

/** Bỏ dấu tiếng Việt, chữ thường, gọn khoảng trắng — dùng cho tìm kiếm. */
function normalizeText_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Chuỗi gọn, giới hạn độ dài, bỏ ký tự điều khiển. */
function cleanStr_(v, max) {
  if (v === null || v === undefined) return '';
  var s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (max && s.length > max) throw AppError_(ERR.VALIDATION, 'Nội dung quá dài (tối đa ' + max + ' ký tự).');
  return s;
}

/** Ngày hợp lệ dạng yyyy-MM-dd (chấp nhận dd/MM/yyyy). Trả '' nếu trống, null nếu sai. */
function parseDate_(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3];
  }
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  var dim = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (d > dim) return null;
  return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
}

function parseIntStrict_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var s = String(v).replace(/[.,\s]/g, '');
  if (!/^-?\d+$/.test(s)) return NaN;
  return parseInt(s, 10);
}

function getSetting_(key, dflt) {
  var r = findBy_('SETTINGS', 'key', key);
  return r && r.value !== '' ? r.value : (dflt === undefined ? '' : dflt);
}

function setSetting_(key, value) {
  var r = findBy_('SETTINGS', 'key', key);
  if (r) { r.value = String(value); r.updated_at = now_(); updateRow_('SETTINGS', r); }
  else insertRow_('SETTINGS', { key: key, value: String(value), description: '', updated_at: now_() });
}

function safeJson_(s, dflt) {
  if (!s) return dflt;
  try { return JSON.parse(s); } catch (e) { return dflt; }
}

/** Trả về bản sao "sạch" (không có _row) để gửi về trình duyệt. */
function plain_(o, fields) {
  var r = {};
  (fields || Object.keys(o)).forEach(function (k) { r[k] = o[k]; });
  return r;
}

/** Thực thi fn khi giữ khóa script. Không gửi email/gọi mạng bên trong fn. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_WAIT_MS)) {
    throw AppError_(ERR.BUSY, 'Hệ thống đang bận xử lý thao tác khác. Vui lòng đợi vài giây rồi bấm lại.');
  }
  try {
    invalidate_(); // luôn đọc lại dữ liệu mới nhất sau khi có khóa
    return fn();
  } finally {
    lock.releaseLock();
  }
}
