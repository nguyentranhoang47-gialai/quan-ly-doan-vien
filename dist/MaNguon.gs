/**
 * MaNguon.gs — BẢN GỘP TỰ SINH từ thư mục apps-script/ bằng tools/build.js. KHÔNG sửa trực tiếp.
 * Dùng MỘT trong hai cách: dán tệp này (cùng Index.html, Styles.html, App.html) HOẶC dán từng tệp .gs riêng — không dùng cả hai.
 */

/* ======================= Config.gs ======================= */
/**
 * Config.gs — Hằng số, cấu trúc dữ liệu (schema) và nhãn tiếng Việt.
 *
 * QUY ƯỚC QUAN TRỌNG:
 *  - Mọi hàm nội bộ kết thúc bằng dấu gạch dưới "_" để Apps Script KHÔNG cho phép
 *    gọi trực tiếp từ trình duyệt qua google.script.run.
 *  - Hàm công khai duy nhất cho giao diện là api() trong Code.gs.
 */

var APP = {
  NAME: 'Quản lý đoàn viên công đoàn',
  SCHEMA_VERSION: 1,
  TZ: 'Asia/Ho_Chi_Minh',

  OTP_TTL_MIN: 5,              // OTP hết hạn sau 5 phút
  OTP_MAX_ATTEMPTS: 5,         // số lần nhập sai tối đa cho một mã
  OTP_PER_EMAIL_15MIN: 3,      // số lần gửi mã tối đa / email / 15 phút
  OTP_GLOBAL_PER_HOUR: 60,     // số lần gửi mã tối đa toàn hệ thống / giờ

  SESSION_TTL_HOURS: 8,        // phiên tối đa 8 giờ
  SESSION_IDLE_MIN: 60,        // không thao tác 60 phút thì hết phiên

  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 100,
  IMPORT_MAX_ROWS: 1000,
  EXPORT_MAX_ROWS: 10000,
  BULK_MAX: 200,
  LOCK_WAIT_MS: 20000,
  OP_STALE_MIN: 2              // thao tác STARTED quá 2 phút coi là dở dang
};

/** Mã lỗi trả về giao diện. */
var ERR = {
  AUTH: 'AUTH',               // chưa đăng nhập / phiên hết hạn
  FORBIDDEN: 'FORBIDDEN',     // không có quyền
  VALIDATION: 'VALIDATION',   // dữ liệu không hợp lệ
  CONFLICT: 'CONFLICT',       // xung đột phiên bản / trùng
  NOT_FOUND: 'NOT_FOUND',
  BUSY: 'BUSY',               // không lấy được khóa
  RATE_LIMIT: 'RATE_LIMIT',
  INTERNAL: 'INTERNAL'
};

/** Lỗi nghiệp vụ có thông báo tiếng Việt cho người dùng. */
function AppError_(code, message, details) {
  var e = new Error(message);
  e.appCode = code;
  e.details = details || null;
  return e;
}

var ROLES = { OFFICER: 'officer', APPROVER: 'approver', VIEWER: 'viewer' };
var ROLE_LABELS = { officer: 'Cán bộ đơn vị', approver: 'Người phê duyệt', viewer: 'Người xem', admin: 'Quản trị hệ thống' };

var MEMBER_STATUS = {
  ACTIVE: 'Đang sinh hoạt',
  SUSPENDED: 'Tạm dừng sinh hoạt',
  LEFT: 'Thôi sinh hoạt',
  RETIRED: 'Nghỉ hưu'
};
var GENDERS = ['Nam', 'Nữ', 'Khác'];
var ID_TYPES = ['CCCD', 'CMND', 'Hộ chiếu', 'Khác'];

var CR_TYPES = { CREATE: 'Thêm mới', UPDATE: 'Sửa hồ sơ', ARCHIVE: 'Lưu trữ hồ sơ', RESTORE: 'Khôi phục hồ sơ' };
var CR_STATUS = { DRAFT: 'Nháp', PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt', RETURNED: 'Trả lại', CANCELLED: 'Đã hủy' };
var TR_STATUS = { PENDING: 'Chờ đơn vị đến xác nhận', COMPLETED: 'Hoàn tất', REJECTED: 'Từ chối', CANCELLED: 'Đã hủy' };

/** Trường hồ sơ đoàn viên được phép sửa qua yêu cầu (không gồm unit_id — đổi đơn vị phải qua chuyển sinh hoạt). */
var MEMBER_EDITABLE = ['member_code', 'full_name', 'dob', 'gender', 'id_type', 'id_number', 'phone', 'email',
  'address', 'join_date', 'union_position', 'member_status', 'note'];
/** Trường nhạy cảm: người chỉ có vai trò Người xem chỉ thấy dạng che. */
var MEMBER_SENSITIVE = ['id_number', 'address', 'dob'];

/**
 * SCHEMA: mã trường ổn định (dòng 1 của sheet) + nhãn tiếng Việt + kiểu + bắt buộc.
 * type: id | text | date (yyyy-MM-dd) | datetime | int | bool | json | enum
 */
var SCHEMA = {
  SETTINGS: {
    title: 'Cấu hình hệ thống', key: 'key',
    note: 'Mỗi dòng một tham số. Chỉ sửa cột value khi được hướng dẫn.',
    columns: [
      ['key', 'Mã tham số', 'text', true], ['value', 'Giá trị', 'text', false],
      ['description', 'Mô tả', 'text', false], ['updated_at', 'Cập nhật lúc', 'datetime', false]
    ]
  },
  UNITS: {
    title: 'Đơn vị (cây tổ chức)', key: 'unit_id',
    note: 'Đơn vị tổ chức theo cây qua parent_id. status: active/inactive.',
    columns: [
      ['unit_id', 'ID đơn vị', 'id', true], ['code', 'Mã đơn vị (duy nhất)', 'text', true],
      ['name', 'Tên đơn vị', 'text', true], ['parent_id', 'ID đơn vị cấp trên', 'id', false],
      ['level', 'Cấp (1 = cao nhất)', 'int', true], ['status', 'Trạng thái', 'enum', true],
      ['sort_order', 'Thứ tự', 'int', false], ['created_at', 'Tạo lúc', 'datetime', true],
      ['updated_at', 'Cập nhật lúc', 'datetime', false], ['version', 'Phiên bản', 'int', true]
    ]
  },
  USERS: {
    title: 'Người dùng được phép đăng nhập', key: 'user_id',
    note: 'Email duy nhất. status: active/locked. is_admin: TRUE/FALSE.',
    columns: [
      ['user_id', 'ID người dùng', 'id', true], ['email', 'Email (duy nhất)', 'text', true],
      ['full_name', 'Họ tên', 'text', true], ['status', 'Trạng thái', 'enum', true],
      ['is_admin', 'Quản trị hệ thống', 'bool', true], ['created_at', 'Tạo lúc', 'datetime', true],
      ['created_by', 'Người tạo', 'text', false], ['updated_at', 'Cập nhật lúc', 'datetime', false],
      ['last_login_at', 'Đăng nhập gần nhất', 'datetime', false], ['version', 'Phiên bản', 'int', true]
    ]
  },
  USER_SCOPES: {
    title: 'Phạm vi quyền của người dùng theo đơn vị', key: 'scope_id',
    note: 'Một người có thể có nhiều dòng (nhiều đơn vị/vai trò). role: officer/approver/viewer.',
    columns: [
      ['scope_id', 'ID phạm vi', 'id', true], ['user_id', 'ID người dùng', 'id', true],
      ['unit_id', 'ID đơn vị', 'id', true], ['role', 'Vai trò', 'enum', true],
      ['include_children', 'Gồm đơn vị cấp dưới', 'bool', true], ['can_dues', 'Được ghi đoàn phí', 'bool', true],
      ['status', 'Trạng thái', 'enum', true], ['created_at', 'Tạo lúc', 'datetime', true],
      ['created_by', 'Người tạo', 'text', false]
    ]
  },
  MEMBERS: {
    title: 'Hồ sơ đoàn viên chính thức (chỉ thay đổi qua phê duyệt)', key: 'member_id',
    note: 'KHÔNG sửa trực tiếp. Mọi thay đổi phải qua ứng dụng để có phê duyệt và nhật ký.',
    columns: [
      ['member_id', 'ID nội bộ', 'id', true], ['member_code', 'Mã đoàn viên', 'text', true],
      ['full_name', 'Họ và tên', 'text', true], ['name_search', 'Tên không dấu (tự sinh)', 'text', true],
      ['dob', 'Ngày sinh', 'date', false], ['gender', 'Giới tính', 'enum', false],
      ['id_type', 'Loại giấy tờ', 'enum', false], ['id_number', 'Số giấy tờ', 'text', false],
      ['phone', 'Số điện thoại', 'text', false], ['email', 'Email', 'text', false],
      ['address', 'Địa chỉ', 'text', false], ['unit_id', 'ID đơn vị', 'id', true],
      ['join_date', 'Ngày vào công đoàn', 'date', false], ['union_position', 'Chức vụ công đoàn', 'text', false],
      ['member_status', 'Tình trạng sinh hoạt', 'enum', true], ['note', 'Ghi chú', 'text', false],
      ['archived', 'Đã lưu trữ', 'bool', true], ['created_at', 'Tạo lúc', 'datetime', true],
      ['created_by', 'Người tạo', 'text', true], ['updated_at', 'Cập nhật lúc', 'datetime', false],
      ['updated_by', 'Người cập nhật', 'text', false], ['version', 'Phiên bản bản ghi', 'int', true],
      ['last_ref', 'Mã yêu cầu áp dụng gần nhất', 'id', false]
    ]
  },
  CHANGE_REQUESTS: {
    title: 'Yêu cầu thay đổi hồ sơ (thêm/sửa/lưu trữ)', key: 'change_id',
    note: 'status: DRAFT/PENDING/APPROVED/RETURNED/CANCELLED. payload_json: giá trị mới; old_json: giá trị cũ khi gửi.',
    columns: [
      ['change_id', 'ID yêu cầu', 'id', true], ['request_type', 'Loại yêu cầu', 'enum', true],
      ['member_id', 'ID đoàn viên', 'id', true], ['unit_id', 'ID đơn vị', 'id', true],
      ['status', 'Trạng thái yêu cầu', 'enum', true], ['payload_json', 'Giá trị mới (JSON)', 'json', true],
      ['old_json', 'Giá trị cũ (JSON)', 'json', false], ['base_version', 'Phiên bản hồ sơ gốc', 'int', false],
      ['summary', 'Tóm tắt', 'text', false], ['import_job_id', 'ID lô nhập', 'id', false],
      ['created_by', 'Người tạo', 'text', true], ['created_at', 'Tạo lúc', 'datetime', true],
      ['updated_at', 'Cập nhật lúc', 'datetime', false], ['submitted_at', 'Gửi duyệt lúc', 'datetime', false],
      ['decided_by', 'Người duyệt/trả lại', 'text', false], ['decided_at', 'Thời gian duyệt/trả lại', 'datetime', false],
      ['decision_note', 'Lý do/ghi chú xử lý', 'text', false], ['version', 'Phiên bản', 'int', true]
    ]
  },
  APPROVAL_ACTIONS: {
    title: 'Lịch sử xử lý yêu cầu', key: 'action_id',
    note: 'Mỗi lần gửi, duyệt, trả lại, hủy, xác nhận, từ chối đều có một dòng.',
    columns: [
      ['action_id', 'ID', 'id', true], ['target_type', 'Loại (CHANGE/TRANSFER)', 'enum', true],
      ['target_id', 'ID yêu cầu', 'id', true], ['action', 'Hành động', 'enum', true],
      ['actor', 'Người thực hiện', 'text', true], ['at', 'Thời gian', 'datetime', true],
      ['note', 'Ghi chú', 'text', false], ['request_id', 'Mã thao tác', 'id', false]
    ]
  },
  TRANSFER_REQUESTS: {
    title: 'Yêu cầu chuyển sinh hoạt', key: 'transfer_id',
    note: 'status: PENDING/COMPLETED/REJECTED/CANCELLED. Đơn vị chính thức chỉ đổi khi COMPLETED.',
    columns: [
      ['transfer_id', 'ID yêu cầu chuyển', 'id', true], ['member_id', 'ID đoàn viên', 'id', true],
      ['from_unit_id', 'Đơn vị đi', 'id', true], ['to_unit_id', 'Đơn vị đến', 'id', true],
      ['proposed_date', 'Ngày đề nghị chuyển', 'date', true], ['effective_date', 'Ngày hiệu lực', 'date', false],
      ['reason', 'Lý do', 'text', true], ['status', 'Trạng thái', 'enum', true],
      ['created_by', 'Người lập', 'text', true], ['created_at', 'Lập lúc', 'datetime', true],
      ['decided_by', 'Người xử lý', 'text', false], ['decided_at', 'Xử lý lúc', 'datetime', false],
      ['decision_note', 'Ghi chú xử lý', 'text', false], ['version', 'Phiên bản', 'int', true]
    ]
  },
  MEMBERSHIP_HISTORY: {
    title: 'Lịch sử sinh hoạt theo đơn vị', key: 'history_id',
    note: 'event: JOIN/TRANSFER_OUT/TRANSFER_IN/ARCHIVE/RESTORE. Không xóa dòng.',
    columns: [
      ['history_id', 'ID', 'id', true], ['member_id', 'ID đoàn viên', 'id', true],
      ['unit_id', 'ID đơn vị', 'id', true], ['event', 'Sự kiện', 'enum', true],
      ['event_date', 'Ngày', 'date', true], ['ref_id', 'Mã yêu cầu liên quan', 'id', true],
      ['note', 'Ghi chú', 'text', false], ['created_at', 'Ghi lúc', 'datetime', true],
      ['created_by', 'Người ghi', 'text', true]
    ]
  },
  DUES: {
    title: 'Ghi nhận đoàn phí theo kỳ (tháng)', key: 'dues_id',
    note: 'Duy nhất theo (member_id, period) với status ACTIVE. Tiền là số nguyên VND. Điều chỉnh ghi ở DUES_HISTORY.',
    columns: [
      ['dues_id', 'ID', 'id', true], ['member_id', 'ID đoàn viên', 'id', true],
      ['unit_id', 'Đơn vị khi ghi nhận', 'id', true], ['period', 'Kỳ (yyyy-MM)', 'text', true],
      ['amount_due', 'Số phải thu (VND)', 'int', true], ['amount_paid', 'Số đã thu (VND)', 'int', true],
      ['paid_date', 'Ngày thu', 'date', false], ['note', 'Ghi chú', 'text', false],
      ['status', 'Trạng thái (ACTIVE/VOID)', 'enum', true], ['recorded_by', 'Người ghi nhận', 'text', true],
      ['recorded_at', 'Ghi nhận lúc', 'datetime', true], ['updated_by', 'Người điều chỉnh', 'text', false],
      ['updated_at', 'Điều chỉnh lúc', 'datetime', false], ['version', 'Phiên bản', 'int', true]
    ]
  },
  DUES_HISTORY: {
    title: 'Lịch sử điều chỉnh đoàn phí (bảng bổ sung)', key: 'entry_id',
    note: 'Bảng bổ sung: mỗi lần tạo/điều chỉnh/hủy ghi nhận đoàn phí có một dòng.',
    columns: [
      ['entry_id', 'ID', 'id', true], ['dues_id', 'ID ghi nhận', 'id', true], ['action', 'Hành động', 'enum', true],
      ['old_due', 'Phải thu cũ', 'int', false], ['new_due', 'Phải thu mới', 'int', false],
      ['old_paid', 'Đã thu cũ', 'int', false], ['new_paid', 'Đã thu mới', 'int', false],
      ['reason', 'Lý do', 'text', false], ['actor', 'Người thực hiện', 'text', true],
      ['at', 'Thời gian', 'datetime', true]
    ]
  },
  AUDIT_LOGS: {
    title: 'Nhật ký thao tác', key: 'log_id',
    note: 'Chỉ ghi thêm. Không chứa OTP, token hay toàn bộ dữ liệu cá nhân.',
    columns: [
      ['log_id', 'ID', 'id', true], ['at', 'Thời gian', 'datetime', true], ['actor', 'Người thao tác', 'text', true],
      ['action', 'Hành động', 'text', true], ['object_type', 'Loại đối tượng', 'text', false],
      ['object_id', 'ID đối tượng', 'text', false], ['result', 'Kết quả (OK/DENIED/ERROR)', 'enum', true],
      ['request_id', 'Mã thao tác', 'text', false], ['detail', 'Chi tiết ngắn', 'text', false]
    ]
  },
  IMPORT_JOBS: {
    title: 'Các lô nhập dữ liệu', key: 'job_id',
    note: 'Mỗi lô nhập CSV một dòng; report_json chứa lỗi theo dòng (không chứa dữ liệu cá nhân đầy đủ).',
    columns: [
      ['job_id', 'ID lô', 'id', true], ['request_id', 'Mã thao tác', 'id', true], ['file_name', 'Tên tệp', 'text', false],
      ['unit_id', 'Đơn vị mặc định', 'id', false], ['total_rows', 'Tổng dòng', 'int', true],
      ['ok_rows', 'Dòng thành công', 'int', true], ['error_rows', 'Dòng lỗi', 'int', true],
      ['status', 'Trạng thái', 'enum', true], ['report_json', 'Báo cáo (JSON)', 'json', false],
      ['created_by', 'Người nhập', 'text', true], ['created_at', 'Nhập lúc', 'datetime', true]
    ]
  },
  OPERATIONS: {
    title: 'Nhật ký thao tác ghi (chống lặp và phục hồi)', key: 'op_id',
    note: 'request_id chống xử lý lặp. Dòng STARTED quá lâu là thao tác dở dang cần phục hồi.',
    columns: [
      ['op_id', 'ID', 'id', true], ['request_id', 'Mã thao tác (duy nhất theo người dùng)', 'id', true],
      ['actor_user_id', 'ID người thực hiện', 'id', true], ['action', 'Hành động', 'text', true],
      ['status', 'STARTED/DONE/FAILED/RECOVERED', 'enum', true], ['started_at', 'Bắt đầu', 'datetime', true],
      ['finished_at', 'Kết thúc', 'datetime', false], ['params_json', 'Tham số phục hồi (JSON)', 'json', false],
      ['result_json', 'Kết quả (JSON)', 'json', false], ['error', 'Lỗi', 'text', false]
    ]
  },
  SESSIONS: {
    title: 'Phiên đăng nhập (bảng bổ sung cho xác thực)', key: 'session_id',
    note: 'Chỉ lưu MÃ BĂM của token. Không bao giờ lưu token gốc.',
    columns: [
      ['session_id', 'ID phiên', 'id', true], ['token_hash', 'Mã băm token', 'text', true],
      ['user_id', 'ID người dùng', 'id', true], ['created_at', 'Tạo lúc', 'datetime', true],
      ['expires_at', 'Hết hạn lúc', 'datetime', true], ['last_seen_at', 'Hoạt động gần nhất', 'datetime', true],
      ['revoked', 'Đã thu hồi', 'bool', true], ['revoked_reason', 'Lý do thu hồi', 'text', false]
    ]
  },
  AUTH_OTP: {
    title: 'Mã OTP đã phát (bảng bổ sung cho xác thực)', key: 'otp_id',
    note: 'Chỉ lưu mã băm của OTP và của email. Tự dọn dẹp hằng ngày.',
    columns: [
      ['otp_id', 'ID', 'id', true], ['email_hash', 'Mã băm email', 'text', true], ['otp_hash', 'Mã băm OTP', 'text', true],
      ['created_at', 'Tạo lúc', 'datetime', true], ['expires_at', 'Hết hạn lúc', 'datetime', true],
      ['attempts', 'Số lần nhập sai', 'int', true], ['used', 'Đã dùng/khóa', 'bool', true]
    ]
  }
};

/** Thứ tự tạo sheet. */
var SHEET_ORDER = ['SETTINGS', 'UNITS', 'USERS', 'USER_SCOPES', 'MEMBERS', 'CHANGE_REQUESTS', 'APPROVAL_ACTIONS',
  'TRANSFER_REQUESTS', 'MEMBERSHIP_HISTORY', 'DUES', 'DUES_HISTORY', 'AUDIT_LOGS', 'IMPORT_JOBS', 'OPERATIONS',
  'SESSIONS', 'AUTH_OTP'];

/** Sheet không được khôi phục từ bản sao lưu (giữ phiên/OTP hiện tại). */
var NO_RESTORE_SHEETS = ['SESSIONS', 'AUTH_OTP'];

/** Tham số mặc định trong SETTINGS (chỉ thêm khi chưa có, không ghi đè). */
var DEFAULT_SETTINGS = [
  ['ORG_NAME', 'Công đoàn (đổi tên trong SETTINGS)', 'Tên tổ chức hiển thị trên giao diện'],
  ['UNIT_LEVEL_NAMES', 'Công đoàn cấp trên,Công đoàn cơ sở,Tổ công đoàn', 'Tên các cấp tổ chức, phân tách dấu phẩy, cấp 1 trước'],
  ['MEMBER_CODE_PREFIX', 'DV', 'Tiền tố mã đoàn viên tự sinh khi để trống'],
  ['MEMBER_CODE_SEQ', '0', 'Số thứ tự mã đoàn viên tự sinh gần nhất (hệ thống tự tăng)'],
  ['ALLOW_ADMIN_SELF_APPROVE', 'FALSE', 'TRUE: quản trị được tự duyệt yêu cầu của mình (có ghi nhật ký riêng)'],
  ['DUES_DEFAULT_AMOUNT', '', 'Mức phải thu gợi ý (VND). Để trống: người ghi nhận tự nhập. Hệ thống không tự áp mức pháp lý.'],
  ['BACKUP_KEEP', '14', 'Số bản sao lưu tự động giữ lại'],
  ['MEMBERS_WARN_LIMIT', '8000', 'Cảnh báo khi số hồ sơ vượt ngưỡng này'],
  ['LAST_BACKUP_AT', '', 'Thời điểm sao lưu gần nhất (hệ thống tự ghi)'],
  ['SCHEMA_VERSION', '0', 'Phiên bản cấu trúc dữ liệu (hệ thống tự ghi)']
];

/** Các khóa SETTINGS quản trị được sửa từ giao diện. */
var EDITABLE_SETTINGS = ['ORG_NAME', 'UNIT_LEVEL_NAMES', 'MEMBER_CODE_PREFIX', 'ALLOW_ADMIN_SELF_APPROVE',
  'DUES_DEFAULT_AMOUNT', 'BACKUP_KEEP', 'MEMBERS_WARN_LIMIT'];


/* ======================= Repository.gs ======================= */
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


/* ======================= Setup.gs ======================= */
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


/* ======================= Auth.gs ======================= */
/**
 * Auth.gs — Đăng nhập bằng mã OTP gửi qua email và quản lý phiên.
 *
 *  - Chỉ email có trong USERS (status=active) mới nhận được mã.
 *  - Thông báo công khai giống nhau dù email có tồn tại hay không.
 *  - OTP 6 chữ số sinh từ UUID (SecureRandom), chỉ lưu HMAC-SHA256 (khóa AUTH_PEPPER).
 *  - Token phiên 256 bit, chỉ lưu HMAC; được xác minh lại ở MỌI lần gọi api().
 *  - Khóa tài khoản / thu hồi phiên có hiệu lực ngay ở lần gọi tiếp theo.
 */

var GENERIC_OTP_MSG = 'Nếu email này đã được cấp quyền, mã đăng nhập đã được gửi tới hộp thư. Mã có hiệu lực 5 phút. ' +
  'Nếu không thấy, hãy kiểm tra thư mục Spam hoặc liên hệ quản trị.';
var GENERIC_VERIFY_FAIL = 'Mã không đúng hoặc đã hết hạn. Hãy kiểm tra lại mã hoặc bấm "Gửi lại mã".';

function normEmail_(e) { return String(e || '').trim().toLowerCase(); }
function validEmail_(e) { return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(e) && e.length <= 120; }

function generateOtp_() {
  // 8 ký tự hex = 32 bit ngẫu nhiên → 6 chữ số (sai lệch phân phối không đáng kể).
  var n = parseInt(randomHex_(8), 16) % 1000000;
  return ('000000' + n).slice(-6);
}

/** Bộ đếm tần suất dùng CacheService (gọi khi đang giữ khóa). */
function bumpCounter_(key, ttlSec) {
  var cache = CacheService.getScriptCache();
  var n = parseInt(cache.get(key) || '0', 10) + 1;
  cache.put(key, String(n), ttlSec);
  return n;
}

function authRequestOtp_(payload, requestId) {
  var email = normEmail_(payload && payload.email);
  if (!validEmail_(email)) throw AppError_(ERR.VALIDATION, 'Email chưa đúng định dạng. Ví dụ đúng: ten@coquan.vn');

  // Kiểm tra hạn mức gửi thư TRƯỚC khi tra cứu email để không làm lộ email có tồn tại hay không.
  var quota = 0;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { quota = 0; }
  if (quota < 1) {
    audit_(null, 'OTP_QUOTA_EXHAUSTED', 'AUTH', '', 'ERROR', requestId, 'Hết hạn mức gửi email trong ngày');
    throw AppError_(ERR.RATE_LIMIT, 'Hệ thống đã hết lượt gửi email trong hôm nay. Vui lòng thử lại sau 0 giờ hoặc báo quản trị.');
  }

  var emailHash = hmac_('email:' + email);
  var toSend = withLock_(function () {
    var hourBucket = Utilities.formatDate(new Date(), APP.TZ, 'yyyyMMddHH');
    var g = bumpCounter_('otp:g:' + hourBucket, 3600);
    if (g > APP.OTP_GLOBAL_PER_HOUR) {
      audit_(null, 'OTP_GLOBAL_LIMIT', 'AUTH', '', 'DENIED', requestId, '');
      throw AppError_(ERR.RATE_LIMIT, 'Có quá nhiều yêu cầu gửi mã trong giờ này. Vui lòng thử lại sau ít phút.');
    }
    var perEmail = bumpCounter_('otp:e:' + emailHash, 15 * 60);
    if (perEmail > APP.OTP_PER_EMAIL_15MIN) {
      // Áp dụng cho mọi email (kể cả không tồn tại) để không lộ thông tin.
      throw AppError_(ERR.RATE_LIMIT, 'Bạn đã yêu cầu mã quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.');
    }
    var user = findBy_('USERS', 'email', email);
    if (!user || user.status !== 'active') {
      audit_(null, 'OTP_REQUEST', 'AUTH', '', 'DENIED', requestId, 'Email không được cấp quyền');
      return null;
    }
    // Vô hiệu các mã cũ chưa dùng của email này
    var olds = rows_('AUTH_OTP').filter(function (o) { return o.email_hash === emailHash && !o.used; });
    olds.forEach(function (o) { o.used = true; });
    updateRows_('AUTH_OTP', olds);
    var otp = generateOtp_();
    var otpId = newId_('OTP');
    insertRow_('AUTH_OTP', {
      otp_id: otpId, email_hash: emailHash, otp_hash: hmac_('otp:' + otpId + ':' + otp),
      created_at: now_(), expires_at: addMinutes_(now_(), APP.OTP_TTL_MIN), attempts: 0, used: false
    });
    audit_({ user: user }, 'OTP_REQUEST', 'AUTH', user.user_id, 'OK', requestId, '');
    return { email: email, otp: otp, otpId: otpId };
  });

  // Gửi email NGOÀI khóa.
  if (toSend) {
    var org = getSetting_('ORG_NAME', APP.NAME);
    try {
      MailApp.sendEmail({
        to: toSend.email,
        subject: 'Mã đăng nhập ' + APP.NAME,
        body: 'Mã đăng nhập của bạn là: ' + toSend.otp + '\n\nMã có hiệu lực trong ' + APP.OTP_TTL_MIN +
          ' phút và chỉ dùng được một lần.\nNếu bạn không yêu cầu, hãy bỏ qua email này.\n\n' + org,
        name: APP.NAME
      });
    } catch (e) {
      withLock_(function () {
        var row = findBy_('AUTH_OTP', 'otp_id', toSend.otpId);
        if (row) { row.used = true; updateRow_('AUTH_OTP', row); }
      });
      audit_(null, 'OTP_SEND_FAIL', 'AUTH', '', 'ERROR', requestId, String(e && e.message || e).substring(0, 120));
    }
  }
  return { message: GENERIC_OTP_MSG };
}

function authVerifyOtp_(payload, requestId) {
  var email = normEmail_(payload && payload.email);
  var otp = String(payload && payload.otp || '').replace(/\s/g, '');
  if (!validEmail_(email) || !/^\d{6}$/.test(otp)) throw AppError_(ERR.VALIDATION, 'Hãy nhập đúng email và mã gồm 6 chữ số.');
  var emailHash = hmac_('email:' + email);

  return withLock_(function () {
    var cands = rows_('AUTH_OTP').filter(function (o) { return o.email_hash === emailHash && !o.used; });
    var rec = cands.length ? cands[cands.length - 1] : null;
    if (!rec || minutesSince_(rec.expires_at) > 0) {
      audit_(null, 'LOGIN', 'AUTH', '', 'DENIED', requestId, 'Không có mã hợp lệ');
      throw AppError_(ERR.AUTH, GENERIC_VERIFY_FAIL);
    }
    if (hmac_('otp:' + rec.otp_id + ':' + otp) !== rec.otp_hash) {
      rec.attempts = (rec.attempts || 0) + 1;
      if (rec.attempts >= APP.OTP_MAX_ATTEMPTS) rec.used = true;
      updateRow_('AUTH_OTP', rec);
      audit_(null, 'LOGIN', 'AUTH', '', 'DENIED', requestId, 'Sai mã lần ' + rec.attempts);
      if (rec.used) throw AppError_(ERR.AUTH, 'Bạn đã nhập sai quá ' + APP.OTP_MAX_ATTEMPTS + ' lần. Hãy bấm "Gửi lại mã" để nhận mã mới.');
      throw AppError_(ERR.AUTH, GENERIC_VERIFY_FAIL);
    }
    rec.used = true;
    updateRow_('AUTH_OTP', rec);

    var user = findBy_('USERS', 'email', email);
    if (!user || user.status !== 'active') throw AppError_(ERR.AUTH, GENERIC_VERIFY_FAIL);

    var token = randomHex_(64);
    var created = now_();
    insertRow_('SESSIONS', {
      session_id: newId_('SES'), token_hash: hmac_('session:' + token), user_id: user.user_id,
      created_at: created, expires_at: addMinutes_(created, APP.SESSION_TTL_HOURS * 60),
      last_seen_at: created, revoked: false, revoked_reason: ''
    });
    user.last_login_at = created;
    updateRow_('USERS', user);
    audit_({ user: user }, 'LOGIN', 'AUTH', user.user_id, 'OK', requestId, '');
    return { token: token, expiresInMin: APP.SESSION_TTL_HOURS * 60 };
  });
}

/**
 * Xác minh phiên ở mỗi lần gọi. Trả về ngữ cảnh người dùng (ctx) gồm quyền theo đơn vị.
 * Không tin bất kỳ email/role/unit_id nào do trình duyệt gửi.
 */
function authenticate_(token) {
  if (!token || typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
    throw AppError_(ERR.AUTH, 'Bạn chưa đăng nhập hoặc phiên đã hết hạn. Vui lòng đăng nhập lại.');
  }
  var hash = hmac_('session:' + token);
  var sess = findBy_('SESSIONS', 'token_hash', hash);
  if (!sess || sess.revoked) throw AppError_(ERR.AUTH, 'Phiên đăng nhập không còn hiệu lực. Vui lòng đăng nhập lại.');
  if (minutesSince_(sess.expires_at) > 0 || minutesSince_(sess.last_seen_at) > APP.SESSION_IDLE_MIN) {
    throw AppError_(ERR.AUTH, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }
  var user = findBy_('USERS', 'user_id', sess.user_id);
  if (!user || user.status !== 'active') {
    throw AppError_(ERR.AUTH, 'Tài khoản đã bị khóa hoặc thu hồi quyền. Liên hệ quản trị nếu cần hỗ trợ.');
  }
  // Cập nhật thời điểm hoạt động tối đa 1 lần / 5 phút (một ô, không cần khóa).
  if (minutesSince_(sess.last_seen_at) > 5) {
    try {
      var t = table_('SESSIONS');
      sheet_('SESSIONS').getRange(sess._row, t.index.last_seen_at + 1).setValue("'" + now_());
      sess.last_seen_at = now_();
    } catch (e) { /* không chặn thao tác nếu ghi thất bại */ }
  }
  var ctx = buildContext_(user);
  ctx.sessionId = sess.session_id;
  return ctx;
}

function authLogout_(ctx, p, requestId) {
  return withLock_(function () {
    var s = findBy_('SESSIONS', 'session_id', ctx.sessionId);
    if (s && !s.revoked) { s.revoked = true; s.revoked_reason = 'Đăng xuất'; updateRow_('SESSIONS', s); }
    audit_(ctx, 'LOGOUT', 'AUTH', ctx.user.user_id, 'OK', requestId, '');
    return { message: 'Đã đăng xuất.' };
  });
}

/** Thu hồi mọi phiên của người dùng (gọi khi đang giữ khóa). */
function revokeUserSessions_(userId, reason) {
  var list = rows_('SESSIONS').filter(function (s) { return s.user_id === userId && !s.revoked; });
  list.forEach(function (s) { s.revoked = true; s.revoked_reason = reason; });
  updateRows_('SESSIONS', list);
  return list.length;
}

/** Dọn dẹp OTP và phiên cũ — gọi từ tác vụ hằng ngày. */
function cleanupAuth_() {
  return withLock_(function () {
    var removed = 0;
    ['AUTH_OTP', 'SESSIONS'].forEach(function (name) {
      var t = table_(name);
      var keep = t.rows.filter(function (r) {
        var ref = name === 'AUTH_OTP' ? r.created_at : r.expires_at;
        return minutesSince_(ref) < 3 * 24 * 60; // giữ 3 ngày
      });
      removed += t.rows.length - keep.length;
      if (keep.length === t.rows.length) return;
      var sh = sheet_(name);
      if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, t.headers.length).clearContent();
      if (keep.length) sh.getRange(2, 1, keep.length, t.headers.length).setValues(keep.map(function (o) { return objToLine_(t, o); }));
      invalidate_(name);
    });
    return removed;
  });
}


/* ======================= Permissions.gs ======================= */
/**
 * Permissions.gs — Phân quyền theo đơn vị (kiểm tra hoàn toàn phía máy chủ).
 *
 * Năng lực (capability) theo vai trò:
 *   viewer   : view
 *   officer  : view, edit (tạo/sửa yêu cầu, nhập CSV), transfer (lập/hủy/xác nhận chuyển), dues (nếu can_dues)
 *   approver : view, approve, transfer (xác nhận nhận đoàn viên ở đơn vị đến)
 *   admin    : mọi năng lực trên mọi đơn vị + quản trị hệ thống
 * include_children = TRUE: quyền áp dụng cho cả cây đơn vị cấp dưới.
 */

function buildContext_(user) {
  var units = rows_('UNITS');
  var byId = {}, children = {};
  units.forEach(function (u) {
    byId[u.unit_id] = u;
    (children[u.parent_id || ''] = children[u.parent_id || ''] || []).push(u.unit_id);
  });
  var caps = { view: {}, edit: {}, approve: {}, transfer: {}, dues: {} };
  var roles = {};

  function expand(unitId, withChildren) {
    var out = [unitId], stack = withChildren ? [unitId] : [], seen = {};
    seen[unitId] = true;
    while (stack.length) {
      var id = stack.pop();
      (children[id] || []).forEach(function (c) { if (!seen[c]) { seen[c] = true; out.push(c); stack.push(c); } });
    }
    return out;
  }

  if (user.is_admin) {
    units.forEach(function (u) { ['view', 'edit', 'approve', 'transfer', 'dues'].forEach(function (c) { caps[c][u.unit_id] = true; }); });
    roles.admin = true;
  } else {
    rows_('USER_SCOPES').forEach(function (s) {
      if (s.user_id !== user.user_id || s.status !== 'active' || !byId[s.unit_id]) return;
      roles[s.role] = true;
      expand(s.unit_id, s.include_children).forEach(function (uid) {
        caps.view[uid] = true;
        if (s.role === ROLES.OFFICER) { caps.edit[uid] = true; caps.transfer[uid] = true; if (s.can_dues) caps.dues[uid] = true; }
        if (s.role === ROLES.APPROVER) { caps.approve[uid] = true; caps.transfer[uid] = true; }
      });
    });
  }
  return { user: user, isAdmin: !!user.is_admin, caps: caps, roles: roles, unitsById: byId, children: children };
}

function can_(ctx, cap, unitId) { return !!(ctx.caps[cap] && ctx.caps[cap][unitId]); }

function hasAny_(ctx, cap) { return Object.keys(ctx.caps[cap] || {}).length > 0; }

/** Ném lỗi FORBIDDEN và ghi nhật ký DENIED nếu không có quyền. */
function assertCan_(ctx, cap, unitId, objType, objId) {
  if (can_(ctx, cap, unitId)) return;
  audit_(ctx, 'DENIED_' + cap.toUpperCase(), objType || 'UNIT', objId || unitId, 'DENIED', ctx.requestId || '', '');
  throw AppError_(ERR.FORBIDDEN, 'Bạn không có quyền thực hiện thao tác này với đơn vị được chọn. Nếu cần, hãy đề nghị quản trị cấp quyền.');
}

function assertAdmin_(ctx) {
  if (ctx.isAdmin) return;
  audit_(ctx, 'DENIED_ADMIN', 'SYSTEM', '', 'DENIED', ctx.requestId || '', '');
  throw AppError_(ERR.FORBIDDEN, 'Chức năng này chỉ dành cho Quản trị hệ thống.');
}

/** Danh sách unit_id có năng lực cap; nếu rootUnit được chọn thì giao với cây của rootUnit. */
function unitsWith_(ctx, cap, rootUnit, includeChildren) {
  var allowed = ctx.caps[cap] || {};
  if (!rootUnit) return Object.keys(allowed);
  if (!allowed[rootUnit]) return [];
  var out = [rootUnit];
  if (includeChildren !== false) {
    var stack = [rootUnit], seen = {};
    seen[rootUnit] = true;
    while (stack.length) {
      var id = stack.pop();
      (ctx.children[id] || []).forEach(function (c) {
        if (!seen[c]) { seen[c] = true; if (allowed[c]) out.push(c); stack.push(c); }
      });
    }
  }
  return out;
}

/** Người dùng chỉ có quyền xem (không có quyền ghi/duyệt) ở đơn vị này → che trường nhạy cảm. */
function viewOnlyAt_(ctx, unitId) {
  return !(can_(ctx, 'edit', unitId) || can_(ctx, 'approve', unitId) || ctx.isAdmin);
}

/** Đường dẫn tên đơn vị: "Cấp trên › Cơ sở". */
function unitPath_(ctx, unitId) {
  var parts = [], u = ctx.unitsById[unitId], guard = 0;
  while (u && guard++ < 20) { parts.unshift(u.name); u = ctx.unitsById[u.parent_id]; }
  return parts.join(' › ');
}

function unitName_(ctx, unitId) { var u = ctx.unitsById[unitId]; return u ? u.name : '(không rõ)'; }

/** Mô tả quyền gửi cho giao diện (chỉ để hiển thị menu; máy chủ vẫn kiểm tra lại). */
function describeAccess_(ctx) {
  var visibleUnits = Object.keys(ctx.caps.view).map(function (id) {
    var u = ctx.unitsById[id];
    return { unit_id: id, name: u.name, path: unitPath_(ctx, id), level: u.level, status: u.status, parent_id: u.parent_id,
      can_edit: can_(ctx, 'edit', id), can_approve: can_(ctx, 'approve', id), can_dues: can_(ctx, 'dues', id),
      can_transfer: can_(ctx, 'transfer', id) };
  }).sort(function (a, b) { return a.path.localeCompare(b.path, 'vi'); });
  var allActive = rows_('UNITS').filter(function (u) { return u.status === 'active'; })
    .map(function (u) { return { unit_id: u.unit_id, path: unitPath_(ctx, u.unit_id) }; })
    .sort(function (a, b) { return a.path.localeCompare(b.path, 'vi'); });
  return {
    user: { full_name: ctx.user.full_name, email: ctx.user.email },
    isAdmin: ctx.isAdmin,
    roles: Object.keys(ctx.roles).map(function (r) { return ROLE_LABELS[r] || r; }),
    canEdit: hasAny_(ctx, 'edit'), canApprove: hasAny_(ctx, 'approve'), canDues: hasAny_(ctx, 'dues'),
    canTransfer: hasAny_(ctx, 'transfer'),
    units: visibleUnits,
    transferTargets: allActive,   // danh sách đơn vị đến (chỉ tên, không có dữ liệu đoàn viên)
    levelNames: String(getSetting_('UNIT_LEVEL_NAMES', '')).split(',').map(function (s) { return s.trim(); }).filter(String),
    orgName: getSetting_('ORG_NAME', APP.NAME),
    memberStatus: MEMBER_STATUS, genders: GENDERS, idTypes: ID_TYPES,
    duesDefault: getSetting_('DUES_DEFAULT_AMOUNT', '')
  };
}


/* ======================= Audit.gs ======================= */
/**
 * Audit.gs — Nhật ký thao tác và nhật ký thao tác nhiều bước (OPERATIONS).
 */

/**
 * Ghi nhật ký. Dùng appendRow (ghi thêm nguyên tử phía Sheets) nên an toàn khi không giữ khóa.
 * detail chỉ là mô tả ngắn — KHÔNG đưa OTP, token, số giấy tờ, địa chỉ… vào đây.
 */
function audit_(ctx, action, objType, objId, result, requestId, detail) {
  try {
    var t = table_('AUDIT_LOGS');
    var obj = {
      log_id: newId_('LOG'), at: now_(), actor: ctx && ctx.user ? ctx.user.email : 'anonymous',
      action: action, object_type: objType || '', object_id: objId || '', result: result || 'OK',
      request_id: requestId || '', detail: String(detail || '').substring(0, 200)
    };
    sheet_('AUDIT_LOGS').appendRow(objToLine_(t, obj));
    invalidate_('AUDIT_LOGS');
  } catch (e) {
    console.error('Không ghi được nhật ký: ' + (e && e.message));
  }
}

function auditList_(ctx, p) {
  assertAdmin_(ctx);
  var all = rows_('AUDIT_LOGS');
  var q = normalizeText_(p && p.q);
  var list = all.filter(function (r) {
    if (p && p.result && r.result !== p.result) return false;
    if (!q) return true;
    return normalizeText_(r.actor + ' ' + r.action + ' ' + r.object_id + ' ' + r.detail).indexOf(q) >= 0;
  }).reverse();
  return paginate_(list, p, function (r) { return plain_(r); });
}

/* ================== Chống xử lý lặp + nhật ký nhiều bước ================== */

/**
 * Thực hiện một thao tác ghi với request_id:
 *  - Nếu request_id (của cùng người dùng) đã DONE → trả lại kết quả cũ, KHÔNG làm lại.
 *  - Nếu đang STARTED → báo đang xử lý.
 *  - Ghi dòng OPERATIONS trạng thái STARTED kèm params để phục hồi, chạy fn, rồi đánh dấu DONE.
 *  - Nếu fn lỗi nghiệp vụ → FAILED (không có thay đổi dở dang vì kiểm tra hợp lệ được làm trước khi ghi).
 *  - Nếu tiến trình bị dừng giữa chừng (hết thời gian, mất kết nối…) → dòng vẫn STARTED,
 *    quản trị dùng "Phục hồi thao tác dở dang" để chạy lại các bước (các bước đều lũy đẳng).
 * Phải gọi bên trong withLock_.
 */
function runOperation_(ctx, requestId, action, params, fn) {
  if (!requestId || !/^[A-Za-z0-9-]{8,64}$/.test(requestId)) {
    throw AppError_(ERR.VALIDATION, 'Thiếu mã thao tác. Hãy tải lại trang rồi thử lại.');
  }
  var existing = null;
  var ops = rows_('OPERATIONS');
  for (var i = ops.length - 1; i >= 0; i--) {
    if (ops[i].request_id === requestId && ops[i].actor_user_id === ctx.user.user_id) { existing = ops[i]; break; }
  }
  if (existing) {
    if (existing.action !== action) throw AppError_(ERR.CONFLICT, 'Mã thao tác đã được dùng cho việc khác. Hãy tải lại trang.');
    if (existing.status === 'DONE' || existing.status === 'RECOVERED') {
      var prev = safeJson_(existing.result_json, {});
      prev._replayed = true;
      return prev;
    }
    if (existing.status === 'STARTED') throw AppError_(ERR.CONFLICT, 'Thao tác này đang được xử lý hoặc bị gián đoạn. Vui lòng đợi rồi tải lại trang; nếu vẫn lỗi, báo quản trị.');
    // FAILED: cho phép thử lại với cùng request_id
  }
  var op = {
    op_id: newId_('OP'), request_id: requestId, actor_user_id: ctx.user.user_id, action: action,
    status: 'STARTED', started_at: now_(), finished_at: '', params_json: params ? JSON.stringify(params) : '',
    result_json: '', error: ''
  };
  insertRow_('OPERATIONS', op);
  try {
    var result = fn(op);
    op.status = 'DONE'; op.finished_at = now_();
    op.result_json = JSON.stringify(result || {});
    if (op.result_json.length > 40000) op.result_json = JSON.stringify({ ok: true, truncated: true });
    updateRow_('OPERATIONS', op);
    return result;
  } catch (e) {
    if (e && e.__fault) throw e; // lỗi giả lập trong kiểm thử: để nguyên STARTED
    op.status = 'FAILED'; op.finished_at = now_();
    op.error = String(e && e.message || e).substring(0, 300);
    try { updateRow_('OPERATIONS', op); } catch (e2) { }
    throw e;
  }
}

/** Điểm chèn lỗi cho kiểm thử phục hồi (chỉ có tác dụng khi biến toàn cục __FAULT được đặt bởi bộ kiểm thử). */
function faultPoint_(name) {
  if (typeof __FAULT !== 'undefined' && __FAULT === name) {
    var e = new Error('Lỗi giả lập tại ' + name);
    e.__fault = true;
    throw e;
  }
}

/** Danh sách thao tác dở dang (STARTED quá APP.OP_STALE_MIN phút). */
function pendingOperations_() {
  return rows_('OPERATIONS').filter(function (o) {
    return o.status === 'STARTED' && minutesSince_(o.started_at) >= APP.OP_STALE_MIN;
  });
}

/** Các thao tác nhiều bước có thể phục hồi: action → hàm chạy lại các bước (lũy đẳng). */
var RECOVERABLE = {
  'change.approve': function (params, actorEmail) { return applyChange_(params, actorEmail); },
  'transfer.confirm': function (params, actorEmail) { return applyTransfer_(params, actorEmail); }
};

function recoverOperations_(ctx, requestId) {
  return withLock_(function () {
    var list = pendingOperations_();
    var out = [];
    list.forEach(function (op) {
      var fn = RECOVERABLE[op.action];
      var params = safeJson_(op.params_json, null);
      try {
        if (fn && params) {
          var actor = findBy_('USERS', 'user_id', op.actor_user_id);
          var res = fn(params, actor ? actor.email : 'recovery');
          op.status = 'RECOVERED'; op.result_json = JSON.stringify(res || {});
        } else {
          // Thao tác một bước: nếu đã STARTED mà không DONE thì chưa có ghi dữ liệu nghiệp vụ hoặc đã ghi đủ trong 1 lần.
          op.status = 'FAILED'; op.error = 'Bị gián đoạn; thao tác một bước, người dùng cần kiểm tra và thực hiện lại.';
        }
      } catch (e) {
        op.status = 'FAILED'; op.error = 'Phục hồi lỗi: ' + String(e && e.message || e).substring(0, 250);
      }
      op.finished_at = now_();
      updateRow_('OPERATIONS', op);
      out.push({ op_id: op.op_id, action: op.action, status: op.status, error: op.error });
    });
    audit_(ctx, 'RECOVER_OPERATIONS', 'SYSTEM', '', 'OK', requestId, 'Số thao tác: ' + out.length);
    return { items: out };
  });
}

/** Ghi lịch sử xử lý yêu cầu. */
function approvalAction_(targetType, targetId, action, actor, note, requestId) {
  insertRow_('APPROVAL_ACTIONS', {
    action_id: newId_('ACT'), target_type: targetType, target_id: targetId, action: action,
    actor: actor, at: now_(), note: note || '', request_id: requestId || ''
  });
}

/** Phân trang dùng chung. */
function paginate_(list, p, mapFn) {
  var size = Math.min(Math.max(parseInt(p && p.pageSize, 10) || APP.PAGE_SIZE_DEFAULT, 1), APP.PAGE_SIZE_MAX);
  var total = list.length;
  var pages = Math.max(1, Math.ceil(total / size));
  var page = Math.min(Math.max(parseInt(p && p.page, 10) || 1, 1), pages);
  var items = list.slice((page - 1) * size, page * size).map(mapFn || function (x) { return x; });
  return { items: items, total: total, page: page, pages: pages, pageSize: size };
}


/* ======================= Members.gs ======================= */
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


/* ======================= Approvals.gs ======================= */
/**
 * Approvals.gs — Yêu cầu thay đổi hồ sơ và phê duyệt.
 *
 * Luồng: Nhập dữ liệu → Lưu nháp (DRAFT) → Gửi duyệt (PENDING) → Duyệt (APPROVED) hoặc Trả lại (RETURNED).
 * Dữ liệu chính thức trong MEMBERS chỉ thay đổi khi yêu cầu được duyệt.
 */

/** Nhãn tiếng Việt của trường hồ sơ (tạo khi chạy, không phụ thuộc thứ tự nạp tệp .gs). */
function fieldLabels_() {
  var o = {};
  SCHEMA.MEMBERS.columns.forEach(function (c) { o[c[0]] = c[1]; });
  o.reason = 'Lý do';
  return o;
}

function crSummary_(type, name) { return CR_TYPES[type] + ': ' + name; }

/** Tạo mới hoặc cập nhật bản nháp; nếu submit=true thì gửi duyệt luôn. */
function crSave_(ctx, p, requestId) {
  p = p || {};
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'change.save', null, function () {
      var type = String(p.request_type || '');
      var cr = null, member = null;
      if (p.change_id) {
        cr = findBy_('CHANGE_REQUESTS', 'change_id', String(p.change_id));
        if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
        if (cr.created_by !== ctx.user.email) throw AppError_(ERR.FORBIDDEN, 'Chỉ người lập yêu cầu mới được sửa yêu cầu này.');
        if (cr.status !== 'DRAFT' && cr.status !== 'RETURNED') throw AppError_(ERR.CONFLICT, 'Yêu cầu đã gửi duyệt hoặc đã xử lý, không sửa được nữa.');
        type = cr.request_type;
      }
      if (!CR_TYPES[type]) throw AppError_(ERR.VALIDATION, 'Loại yêu cầu không hợp lệ.');

      var data, unitId, memberId, baseVersion = '', oldSnapshot = '';
      if (type === 'CREATE') {
        var v = validateMember_(p.data, 'create');
        if (Object.keys(v.errors).length) throw AppError_(ERR.VALIDATION, 'Dữ liệu chưa hợp lệ. Vui lòng sửa các ô được đánh dấu.', v.errors);
        data = v.data; unitId = data.unit_id;
        var u = ctx.unitsById[unitId];
        if (!u || u.status !== 'active') throw AppError_(ERR.VALIDATION, 'Đơn vị không tồn tại hoặc đã ngừng hoạt động.', { unit_id: 'Chọn đơn vị đang hoạt động.' });
        assertCan_(ctx, 'edit', unitId, 'UNIT', unitId);
        memberId = cr ? cr.member_id : newId_('M');
        var dup = duplicateErrors_(data, memberId, cr ? cr.change_id : '');
        if (Object.keys(dup).length) throw AppError_(ERR.CONFLICT, 'Có thông tin bị trùng.', dup);
      } else {
        memberId = cr ? cr.member_id : String(p.member_id || '');
        member = findBy_('MEMBERS', 'member_id', memberId);
        if (!member) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy hồ sơ đoàn viên.');
        unitId = member.unit_id;
        assertCan_(ctx, 'edit', unitId, 'MEMBER', memberId);
        baseVersion = parseInt(p.base_version !== undefined ? p.base_version : (cr ? cr.base_version : ''), 10);
        if (!(baseVersion >= 1)) throw AppError_(ERR.VALIDATION, 'Thiếu phiên bản hồ sơ. Hãy tải lại hồ sơ rồi sửa lại.');
        if (baseVersion !== member.version) {
          throw AppError_(ERR.CONFLICT, 'Hồ sơ đã được người khác cập nhật sau khi bạn mở. Hãy tải lại hồ sơ để xem dữ liệu mới rồi sửa lại.');
        }
        var openPending = rows_('CHANGE_REQUESTS').filter(function (c) {
          return c.member_id === memberId && c.status === 'PENDING' && (!cr || c.change_id !== cr.change_id);
        });
        if (openPending.length) throw AppError_(ERR.CONFLICT, 'Hồ sơ này đang có yêu cầu khác chờ duyệt (người lập: ' + openPending[0].created_by + '). Hãy đợi yêu cầu đó được xử lý.');
        if (type === 'UPDATE') {
          if (member.archived) throw AppError_(ERR.CONFLICT, 'Hồ sơ đã lưu trữ. Hãy khôi phục hồ sơ trước khi sửa.');
          var vu = validateMember_(p.data, 'update');
          if (Object.keys(vu.errors).length) throw AppError_(ERR.VALIDATION, 'Dữ liệu chưa hợp lệ. Vui lòng sửa các ô được đánh dấu.', vu.errors);
          data = vu.data;
          if (!data.member_code) data.member_code = member.member_code;
          var changed = MEMBER_EDITABLE.filter(function (f) { return String(data[f] || '') !== String(member[f] || ''); });
          if (!changed.length) throw AppError_(ERR.VALIDATION, 'Bạn chưa thay đổi thông tin nào.');
          var dup2 = duplicateErrors_(data, memberId, cr ? cr.change_id : '');
          if (Object.keys(dup2).length) throw AppError_(ERR.CONFLICT, 'Có thông tin bị trùng.', dup2);
        } else {
          var reason = cleanStr_(p.data && p.data.reason, 500);
          if (!reason) throw AppError_(ERR.VALIDATION, 'Vui lòng ghi lý do.', { reason: 'Vui lòng ghi lý do.' });
          if (type === 'ARCHIVE' && member.archived) throw AppError_(ERR.CONFLICT, 'Hồ sơ đã ở trạng thái lưu trữ.');
          if (type === 'RESTORE' && !member.archived) throw AppError_(ERR.CONFLICT, 'Hồ sơ đang có hiệu lực, không cần khôi phục.');
          data = { reason: reason };
        }
        oldSnapshot = JSON.stringify(plain_(member, MEMBER_EDITABLE.concat(['archived'])));
      }

      var name = type === 'CREATE' ? data.full_name : (type === 'UPDATE' ? data.full_name : member.full_name);
      var submit = !!p.submit;
      var t = now_();
      if (!cr) {
        cr = {
          change_id: newId_('CR'), request_type: type, member_id: memberId, unit_id: unitId, status: 'DRAFT',
          payload_json: JSON.stringify(data), old_json: oldSnapshot, base_version: baseVersion, summary: crSummary_(type, name),
          import_job_id: '', created_by: ctx.user.email, created_at: t, updated_at: t, submitted_at: '',
          decided_by: '', decided_at: '', decision_note: '', version: 1
        };
        if (submit) { cr.status = 'PENDING'; cr.submitted_at = t; }
        insertRow_('CHANGE_REQUESTS', cr);
      } else {
        cr.payload_json = JSON.stringify(data); cr.unit_id = unitId; cr.base_version = baseVersion;
        cr.old_json = oldSnapshot; cr.summary = crSummary_(type, name); cr.updated_at = t; cr.version += 1;
        if (submit) { cr.status = 'PENDING'; cr.submitted_at = t; cr.decision_note = ''; }
        else cr.status = 'DRAFT';
        updateRow_('CHANGE_REQUESTS', cr);
      }
      approvalAction_('CHANGE', cr.change_id, submit ? 'SUBMIT' : 'SAVE_DRAFT', ctx.user.email, '', requestId);
      audit_(ctx, submit ? 'CHANGE_SUBMIT' : 'CHANGE_SAVE_DRAFT', 'CHANGE', cr.change_id, 'OK', requestId, type);
      return { change_id: cr.change_id, status: cr.status,
        message: submit ? 'Đã gửi yêu cầu chờ duyệt. Dữ liệu chính thức chỉ thay đổi sau khi được duyệt.' : 'Đã lưu nháp.' };
    });
  });
}

function crSubmit_(ctx, p, requestId) {
  var cr = findBy_('CHANGE_REQUESTS', 'change_id', String(p && p.change_id || ''));
  if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
  var data = safeJson_(cr.payload_json, {});
  return crSave_(ctx, { change_id: cr.change_id, data: data, base_version: cr.base_version, submit: true }, requestId);
}

function crCancel_(ctx, p, requestId) {
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'change.cancel', null, function () {
      var cr = findBy_('CHANGE_REQUESTS', 'change_id', String(p && p.change_id || ''));
      if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
      if (cr.created_by !== ctx.user.email && !ctx.isAdmin) throw AppError_(ERR.FORBIDDEN, 'Chỉ người lập hoặc quản trị được hủy yêu cầu.');
      if (['DRAFT', 'PENDING', 'RETURNED'].indexOf(cr.status) < 0) throw AppError_(ERR.CONFLICT, 'Yêu cầu đã được xử lý, không hủy được.');
      cr.status = 'CANCELLED'; cr.updated_at = now_(); cr.version += 1;
      updateRow_('CHANGE_REQUESTS', cr);
      approvalAction_('CHANGE', cr.change_id, 'CANCEL', ctx.user.email, cleanStr_(p.note, 500), requestId);
      audit_(ctx, 'CHANGE_CANCEL', 'CHANGE', cr.change_id, 'OK', requestId, '');
      return { change_id: cr.change_id, status: cr.status, message: 'Đã hủy yêu cầu.' };
    });
  });
}

function selfApproveAllowed_(ctx) {
  return ctx.isAdmin && String(getSetting_('ALLOW_ADMIN_SELF_APPROVE', 'FALSE')).toUpperCase() === 'TRUE';
}

function crRow_(ctx, c) {
  return { change_id: c.change_id, request_type: c.request_type, type_label: CR_TYPES[c.request_type], member_id: c.member_id,
    unit_name: unitName_(ctx, c.unit_id), status: c.status, status_label: CR_STATUS[c.status], summary: c.summary,
    created_by: c.created_by, created_at: c.created_at, submitted_at: c.submitted_at, decided_by: c.decided_by,
    decided_at: c.decided_at, decision_note: c.decision_note, import_job_id: c.import_job_id };
}

/** box: 'approve' (chờ tôi duyệt) | 'mine' (tôi lập) | 'history' (đã xử lý trong phạm vi duyệt/sửa). */
function crList_(ctx, p) {
  p = p || {};
  var me = ctx.user.email, box = p.box || 'approve';
  var q = normalizeText_(p.q);
  var list = rows_('CHANGE_REQUESTS').filter(function (c) {
    if (box === 'mine') { if (c.created_by !== me) return false; }
    else if (box === 'approve') {
      if (c.status !== 'PENDING' || !can_(ctx, 'approve', c.unit_id)) return false;
      if (c.created_by === me && !selfApproveAllowed_(ctx)) return false;
    } else {
      if (!(can_(ctx, 'approve', c.unit_id) || can_(ctx, 'edit', c.unit_id))) return false;
    }
    if (p.status && c.status !== p.status) return false;
    if (p.import_job_id && c.import_job_id !== p.import_job_id) return false;
    if (q && normalizeText_(c.summary).indexOf(q) < 0) return false;
    return true;
  }).reverse();
  return paginate_(list, p, function (c) { return crRow_(ctx, c); });
}

function crGet_(ctx, p) {
  var cr = findBy_('CHANGE_REQUESTS', 'change_id', String(p && p.change_id || ''));
  if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
  if (!(cr.created_by === ctx.user.email || can_(ctx, 'approve', cr.unit_id) || can_(ctx, 'edit', cr.unit_id))) {
    assertCan_(ctx, 'approve', cr.unit_id, 'CHANGE', cr.change_id);
  }
  var newer = safeJson_(cr.payload_json, {}), older = safeJson_(cr.old_json, {});
  var member = findBy_('MEMBERS', 'member_id', cr.member_id);
  var fields = cr.request_type === 'CREATE' ? MEMBER_EDITABLE.concat(['unit_id'])
    : cr.request_type === 'UPDATE' ? MEMBER_EDITABLE : ['reason'];
  var diff = fields.map(function (f) {
    var nv = newer[f] === undefined ? '' : newer[f], ov = older[f] === undefined ? '' : older[f];
    if (f === 'unit_id') nv = unitName_(ctx, nv);
    if (f === 'member_status') { nv = MEMBER_STATUS[nv] || nv; ov = MEMBER_STATUS[ov] || ov; }
    return { field: f, label: fieldLabels_()[f] || f, old: cr.request_type === 'CREATE' ? '' : ov, new: nv,
      changed: cr.request_type === 'CREATE' ? !!nv : String(nv) !== String(ov) };
  }).filter(function (d) { return cr.request_type !== 'CREATE' || d.new !== ''; });
  var stale = cr.request_type !== 'CREATE' && member && cr.status === 'PENDING' && member.version !== cr.base_version;
  var actions = rows_('APPROVAL_ACTIONS').filter(function (a) { return a.target_type === 'CHANGE' && a.target_id === cr.change_id; })
    .map(function (a) { return { action: a.action, actor: a.actor, at: a.at, note: a.note }; });
  var me = ctx.user.email;
  return {
    request: crRow_(ctx, cr), data: newer, base_version: cr.base_version, diff: diff, actions: actions,
    stale: !!stale,
    can_approve: cr.status === 'PENDING' && can_(ctx, 'approve', cr.unit_id) && (cr.created_by !== me || selfApproveAllowed_(ctx)),
    can_edit: (cr.status === 'DRAFT' || cr.status === 'RETURNED') && cr.created_by === me,
    can_cancel: ['DRAFT', 'PENDING', 'RETURNED'].indexOf(cr.status) >= 0 && (cr.created_by === me || ctx.isAdmin)
  };
}

/** Kiểm tra điều kiện duyệt; trả về params để áp dụng (dùng cả cho phục hồi). Gọi khi giữ khóa. */
function prepareApproval_(ctx, cr, requestId) {
  if (cr.status === 'APPROVED') throw AppError_(ERR.CONFLICT, 'Yêu cầu này đã được duyệt trước đó.');
  if (cr.status !== 'PENDING') throw AppError_(ERR.CONFLICT, 'Yêu cầu không ở trạng thái chờ duyệt (hiện tại: ' + CR_STATUS[cr.status] + ').');
  assertCan_(ctx, 'approve', cr.unit_id, 'CHANGE', cr.change_id);
  var selfApprove = cr.created_by === ctx.user.email;
  if (selfApprove && !selfApproveAllowed_(ctx)) {
    audit_(ctx, 'DENIED_SELF_APPROVE', 'CHANGE', cr.change_id, 'DENIED', requestId, '');
    throw AppError_(ERR.FORBIDDEN, 'Bạn không thể tự duyệt yêu cầu do chính mình lập. Hãy để người phê duyệt khác xử lý.');
  }
  var data = safeJson_(cr.payload_json, {});
  var member = findBy_('MEMBERS', 'member_id', cr.member_id);
  if (cr.request_type === 'CREATE') {
    if (member) throw AppError_(ERR.CONFLICT, 'Hồ sơ đã tồn tại.');
    var u = ctx.unitsById[cr.unit_id];
    if (!u || u.status !== 'active') throw AppError_(ERR.CONFLICT, 'Đơn vị của hồ sơ đã ngừng hoạt động. Hãy trả lại để chọn đơn vị khác.');
  } else {
    if (!member) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy hồ sơ đoàn viên.');
    if (member.unit_id !== cr.unit_id) throw AppError_(ERR.CONFLICT, 'Đoàn viên đã chuyển sang đơn vị khác sau khi lập yêu cầu. Hãy trả lại yêu cầu.');
    if (member.version !== cr.base_version) {
      throw AppError_(ERR.CONFLICT, 'Hồ sơ đã thay đổi sau khi yêu cầu được lập (xung đột phiên bản). Hãy trả lại để người lập cập nhật.');
    }
  }
  if (cr.request_type === 'CREATE' || cr.request_type === 'UPDATE') {
    var dup = duplicateErrors_(data, cr.member_id, cr.change_id);
    if (Object.keys(dup).length) throw AppError_(ERR.CONFLICT, 'Không duyệt được vì thông tin bị trùng: ' + Object.keys(dup).map(function (k) { return dup[k]; }).join(' '));
  }
  if (cr.request_type === 'CREATE' && !data.member_code) data.member_code = nextMemberCode_();
  return {
    change_id: cr.change_id, type: cr.request_type, member_id: cr.member_id, unit_id: cr.unit_id, data: data,
    base_version: cr.base_version, creator: cr.created_by, approver: ctx.user.email, decided_at: now_(),
    self_approve: selfApprove, request_id: requestId
  };
}

/** Áp dụng yêu cầu đã duyệt — LŨY ĐẲNG: chạy lại không tạo trùng (dùng cho phục hồi). */
function applyChange_(pp, actorEmail) {
  var m = findBy_('MEMBERS', 'member_id', pp.member_id);
  var d = pp.data;
  if (pp.type === 'CREATE') {
    if (!m) {
      m = { member_id: pp.member_id, unit_id: pp.unit_id, archived: false, created_at: pp.decided_at, created_by: pp.creator,
        updated_at: '', updated_by: '', version: 1, last_ref: pp.change_id };
      MEMBER_EDITABLE.forEach(function (f) { m[f] = d[f] || ''; });
      m.name_search = normalizeText_(m.full_name);
      insertRow_('MEMBERS', m);
    }
  } else if (m && m.last_ref !== pp.change_id) {
    if (pp.type === 'UPDATE') {
      MEMBER_EDITABLE.forEach(function (f) { if (d.hasOwnProperty(f)) m[f] = d[f]; });
      m.name_search = normalizeText_(m.full_name);
    } else if (pp.type === 'ARCHIVE') m.archived = true;
    else if (pp.type === 'RESTORE') m.archived = false;
    m.version = pp.base_version + 1; m.updated_at = pp.decided_at; m.updated_by = pp.approver; m.last_ref = pp.change_id;
    updateRow_('MEMBERS', m);
  }
  faultPoint_('approve_after_member');

  var event = { CREATE: 'JOIN', ARCHIVE: 'ARCHIVE', RESTORE: 'RESTORE' }[pp.type];
  if (event && !rows_('MEMBERSHIP_HISTORY').some(function (h) { return h.ref_id === pp.change_id; })) {
    insertRow_('MEMBERSHIP_HISTORY', {
      history_id: newId_('H'), member_id: pp.member_id, unit_id: pp.unit_id, event: event,
      event_date: event === 'JOIN' ? (d.join_date || pp.decided_at.substring(0, 10)) : pp.decided_at.substring(0, 10),
      ref_id: pp.change_id, note: event === 'JOIN' ? 'Thêm hồ sơ' : (d.reason || ''), created_at: pp.decided_at, created_by: pp.approver
    });
  }
  var cr = findBy_('CHANGE_REQUESTS', 'change_id', pp.change_id);
  if (cr && cr.status !== 'APPROVED') {
    cr.status = 'APPROVED'; cr.decided_by = pp.approver; cr.decided_at = pp.decided_at; cr.updated_at = pp.decided_at; cr.version += 1;
    updateRow_('CHANGE_REQUESTS', cr);
  }
  if (!rows_('APPROVAL_ACTIONS').some(function (a) { return a.target_id === pp.change_id && (a.action === 'APPROVE' || a.action === 'SELF_APPROVE'); })) {
    approvalAction_('CHANGE', pp.change_id, pp.self_approve ? 'SELF_APPROVE' : 'APPROVE', pp.approver,
      pp.self_approve ? 'Quản trị tự duyệt theo cấu hình ALLOW_ADMIN_SELF_APPROVE' : '', pp.request_id);
  }
  return { change_id: pp.change_id, member_id: pp.member_id, member_code: m ? m.member_code : d.member_code };
}

function crApproveOne_(ctx, changeId, requestId) {
  return runOperation_(ctx, requestId, 'change.approve', null, function (op) {
    var cr = findBy_('CHANGE_REQUESTS', 'change_id', String(changeId || ''));
    if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
    var params = prepareApproval_(ctx, cr, requestId);
    op.params_json = JSON.stringify(params);
    updateRow_('OPERATIONS', op); // lưu tham số phục hồi trước khi ghi dữ liệu nghiệp vụ
    var res = applyChange_(params, ctx.user.email);
    audit_(ctx, params.self_approve ? 'CHANGE_SELF_APPROVE' : 'CHANGE_APPROVE', 'CHANGE', cr.change_id, 'OK', requestId, cr.request_type);
    res.message = 'Đã duyệt. Hồ sơ chính thức đã được cập nhật.';
    return res;
  });
}

function crApprove_(ctx, p, requestId) {
  return withLock_(function () { return crApproveOne_(ctx, p && p.change_id, requestId); });
}

function crApproveMany_(ctx, p, requestId) {
  var ids = (p && p.change_ids || []).slice(0, 50);
  if (!ids.length) throw AppError_(ERR.VALIDATION, 'Chưa chọn yêu cầu nào.');
  return withLock_(function () {
    var results = ids.map(function (id, i) {
      try {
        crApproveOne_(ctx, id, requestId.substring(0, 50) + '-' + i);
        return { change_id: id, ok: true };
      } catch (e) {
        if (e && e.__fault) throw e;
        return { change_id: id, ok: false, message: e.appCode ? e.message : 'Lỗi hệ thống' };
      }
    });
    var ok = results.filter(function (r) { return r.ok; }).length;
    return { results: results, message: 'Đã duyệt ' + ok + '/' + results.length + ' yêu cầu.' };
  });
}

function crReturn_(ctx, p, requestId) {
  var note = cleanStr_(p && p.note, 500);
  if (!note) throw AppError_(ERR.VALIDATION, 'Vui lòng ghi lý do trả lại để người lập biết cần sửa gì.', { note: 'Bắt buộc ghi lý do.' });
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'change.return', null, function () {
      var cr = findBy_('CHANGE_REQUESTS', 'change_id', String(p.change_id || ''));
      if (!cr) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu.');
      if (cr.status !== 'PENDING') throw AppError_(ERR.CONFLICT, 'Yêu cầu không còn ở trạng thái chờ duyệt.');
      assertCan_(ctx, 'approve', cr.unit_id, 'CHANGE', cr.change_id);
      cr.status = 'RETURNED'; cr.decided_by = ctx.user.email; cr.decided_at = now_(); cr.decision_note = note;
      cr.updated_at = cr.decided_at; cr.version += 1;
      updateRow_('CHANGE_REQUESTS', cr);
      approvalAction_('CHANGE', cr.change_id, 'RETURN', ctx.user.email, note, requestId);
      audit_(ctx, 'CHANGE_RETURN', 'CHANGE', cr.change_id, 'OK', requestId, '');
      return { change_id: cr.change_id, status: cr.status, message: 'Đã trả lại yêu cầu kèm lý do.' };
    });
  });
}


/* ======================= Transfers.gs ======================= */
/**
 * Transfers.gs — Chuyển sinh hoạt giữa các đơn vị.
 * Luồng: Đơn vị đi lập yêu cầu → Đơn vị đến xác nhận → Hoàn tất (đổi đơn vị chính thức + ghi lịch sử).
 * Từ chối (đơn vị đến) hoặc hủy (đơn vị đi) được phép trước khi hoàn tất.
 */

function trRow_(ctx, t, m) {
  return {
    transfer_id: t.transfer_id, member_id: t.member_id, member_name: m ? m.full_name : '(không rõ)',
    member_code: m ? m.member_code : '', from_unit: unitPath_(ctx, t.from_unit_id), to_unit: unitPath_(ctx, t.to_unit_id),
    proposed_date: t.proposed_date, effective_date: t.effective_date, reason: t.reason, status: t.status,
    status_label: TR_STATUS[t.status], created_by: t.created_by, created_at: t.created_at, decided_by: t.decided_by,
    decided_at: t.decided_at, decision_note: t.decision_note,
    can_confirm: t.status === 'PENDING' && can_(ctx, 'transfer', t.to_unit_id),
    can_cancel: t.status === 'PENDING' && (can_(ctx, 'edit', t.from_unit_id) || ctx.isAdmin)
  };
}

function trCreate_(ctx, p, requestId) {
  p = p || {};
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'transfer.create', null, function () {
      var m = findBy_('MEMBERS', 'member_id', String(p.member_id || ''));
      if (!m) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy hồ sơ đoàn viên.');
      if (m.archived) throw AppError_(ERR.CONFLICT, 'Hồ sơ đã lưu trữ, không chuyển sinh hoạt được.');
      // Đơn vị đi = đơn vị hiện tại của hồ sơ (lấy từ máy chủ, không tin trình duyệt)
      assertCan_(ctx, 'edit', m.unit_id, 'MEMBER', m.member_id);
      var toId = String(p.to_unit_id || '');
      var to = ctx.unitsById[toId];
      var errors = {};
      if (!to) errors.to_unit_id = 'Vui lòng chọn đơn vị đến.';
      else if (to.status !== 'active') errors.to_unit_id = 'Đơn vị đến đã ngừng hoạt động.';
      else if (toId === m.unit_id) errors.to_unit_id = 'Đơn vị đến trùng với đơn vị hiện tại.';
      var proposed = parseDate_(p.proposed_date || today_());
      if (!proposed) errors.proposed_date = 'Ngày đề nghị không hợp lệ.';
      var eff = parseDate_(p.effective_date);
      if (eff === null) errors.effective_date = 'Ngày hiệu lực không hợp lệ.';
      if (proposed && eff && eff < proposed) errors.effective_date = 'Ngày hiệu lực không được trước ngày đề nghị.';
      var reason = String(p.reason || '').trim();
      if (!reason) errors.reason = 'Vui lòng ghi lý do chuyển.';
      if (reason.length > 500) errors.reason = 'Lý do tối đa 500 ký tự.';
      if (Object.keys(errors).length) throw AppError_(ERR.VALIDATION, 'Thông tin chuyển sinh hoạt chưa hợp lệ.', errors);
      if (rows_('TRANSFER_REQUESTS').some(function (t) { return t.member_id === m.member_id && t.status === 'PENDING'; })) {
        throw AppError_(ERR.CONFLICT, 'Đoàn viên này đang có yêu cầu chuyển sinh hoạt chưa xử lý xong.');
      }
      var t = {
        transfer_id: newId_('TR'), member_id: m.member_id, from_unit_id: m.unit_id, to_unit_id: toId,
        proposed_date: proposed, effective_date: eff || '', reason: reason, status: 'PENDING',
        created_by: ctx.user.email, created_at: now_(), decided_by: '', decided_at: '', decision_note: '', version: 1
      };
      insertRow_('TRANSFER_REQUESTS', t);
      approvalAction_('TRANSFER', t.transfer_id, 'CREATE', ctx.user.email, '', requestId);
      audit_(ctx, 'TRANSFER_CREATE', 'TRANSFER', t.transfer_id, 'OK', requestId, '');
      return { transfer_id: t.transfer_id, message: 'Đã lập yêu cầu chuyển. Đang chờ đơn vị đến xác nhận.' };
    });
  });
}

/** box: 'incoming' (chờ đơn vị tôi xác nhận) | 'outgoing' (đơn vị tôi chuyển đi) | 'all' */
function trList_(ctx, p) {
  p = p || {};
  var box = p.box || 'incoming';
  var membersById = {};
  rows_('MEMBERS').forEach(function (m) { membersById[m.member_id] = m; });
  var list = rows_('TRANSFER_REQUESTS').filter(function (t) {
    var inScope = can_(ctx, 'view', t.from_unit_id) || can_(ctx, 'view', t.to_unit_id);
    if (!inScope) return false;
    if (box === 'incoming' && !(t.status === 'PENDING' && can_(ctx, 'transfer', t.to_unit_id))) return false;
    if (box === 'outgoing' && !can_(ctx, 'view', t.from_unit_id)) return false;
    if (p.status && t.status !== p.status) return false;
    return true;
  }).reverse();
  return paginate_(list, p, function (t) { return trRow_(ctx, t, membersById[t.member_id]); });
}

function trDecide_(ctx, p, requestId, decision) {
  p = p || {};
  return withLock_(function () {
    var actionName = decision === 'confirm' ? 'transfer.confirm' : decision === 'reject' ? 'transfer.reject' : 'transfer.cancel';
    return runOperation_(ctx, requestId, actionName, null, function (op) {
      var t = findBy_('TRANSFER_REQUESTS', 'transfer_id', String(p.transfer_id || ''));
      if (!t) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy yêu cầu chuyển.');
      if (t.status !== 'PENDING') throw AppError_(ERR.CONFLICT, 'Yêu cầu chuyển đã được xử lý (' + TR_STATUS[t.status] + ').');
      var note = cleanStr_(p.note, 500);
      if (decision === 'cancel') {
        if (!(can_(ctx, 'edit', t.from_unit_id) || ctx.isAdmin)) assertCan_(ctx, 'edit', t.from_unit_id, 'TRANSFER', t.transfer_id);
      } else {
        assertCan_(ctx, 'transfer', t.to_unit_id, 'TRANSFER', t.transfer_id);
      }
      if (decision === 'reject' && !note) throw AppError_(ERR.VALIDATION, 'Vui lòng ghi lý do từ chối.', { note: 'Bắt buộc ghi lý do.' });

      if (decision === 'confirm') {
        var m = findBy_('MEMBERS', 'member_id', t.member_id);
        if (!m) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy hồ sơ đoàn viên.');
        if (m.unit_id !== t.from_unit_id) throw AppError_(ERR.CONFLICT, 'Đơn vị hiện tại của đoàn viên không còn khớp với đơn vị đi. Hãy hủy yêu cầu này.');
        var to = ctx.unitsById[t.to_unit_id];
        if (!to || to.status !== 'active') throw AppError_(ERR.CONFLICT, 'Đơn vị đến đã ngừng hoạt động.');
        var eff = parseDate_(p.effective_date || t.effective_date || today_());
        if (!eff) throw AppError_(ERR.VALIDATION, 'Ngày hiệu lực không hợp lệ.', { effective_date: 'Ngày không hợp lệ.' });
        var params = { transfer_id: t.transfer_id, member_id: m.member_id, from_unit_id: t.from_unit_id, to_unit_id: t.to_unit_id,
          base_version: m.version, effective_date: eff, actor: ctx.user.email, at: now_(), note: note, request_id: requestId };
        op.params_json = JSON.stringify(params);
        updateRow_('OPERATIONS', op);
        applyTransfer_(params);
        audit_(ctx, 'TRANSFER_CONFIRM', 'TRANSFER', t.transfer_id, 'OK', requestId, '');
        return { transfer_id: t.transfer_id, status: 'COMPLETED', message: 'Đã xác nhận. Đoàn viên đã chuyển sang đơn vị mới, mã đoàn viên giữ nguyên.' };
      }
      t.status = decision === 'reject' ? 'REJECTED' : 'CANCELLED';
      t.decided_by = ctx.user.email; t.decided_at = now_(); t.decision_note = note; t.version += 1;
      updateRow_('TRANSFER_REQUESTS', t);
      approvalAction_('TRANSFER', t.transfer_id, decision === 'reject' ? 'REJECT' : 'CANCEL', ctx.user.email, note, requestId);
      audit_(ctx, decision === 'reject' ? 'TRANSFER_REJECT' : 'TRANSFER_CANCEL', 'TRANSFER', t.transfer_id, 'OK', requestId, '');
      return { transfer_id: t.transfer_id, status: t.status, message: decision === 'reject' ? 'Đã từ chối yêu cầu chuyển.' : 'Đã hủy yêu cầu chuyển.' };
    });
  });
}

/** Hoàn tất chuyển — LŨY ĐẲNG (dùng cho phục hồi). */
function applyTransfer_(pp) {
  var m = findBy_('MEMBERS', 'member_id', pp.member_id);
  if (m && m.last_ref !== pp.transfer_id) {
    m.unit_id = pp.to_unit_id; m.version = pp.base_version + 1; m.updated_at = pp.at; m.updated_by = pp.actor; m.last_ref = pp.transfer_id;
    updateRow_('MEMBERS', m);
  }
  faultPoint_('transfer_after_member');
  var hist = rows_('MEMBERSHIP_HISTORY');
  var has = function (ev) { return hist.some(function (h) { return h.ref_id === pp.transfer_id && h.event === ev; }); };
  var add = [];
  if (!has('TRANSFER_OUT')) add.push({ history_id: newId_('H'), member_id: pp.member_id, unit_id: pp.from_unit_id, event: 'TRANSFER_OUT',
    event_date: pp.effective_date, ref_id: pp.transfer_id, note: 'Chuyển đi', created_at: pp.at, created_by: pp.actor });
  if (!has('TRANSFER_IN')) add.push({ history_id: newId_('H'), member_id: pp.member_id, unit_id: pp.to_unit_id, event: 'TRANSFER_IN',
    event_date: pp.effective_date, ref_id: pp.transfer_id, note: 'Chuyển đến', created_at: pp.at, created_by: pp.actor });
  insertRows_('MEMBERSHIP_HISTORY', add);
  var t = findBy_('TRANSFER_REQUESTS', 'transfer_id', pp.transfer_id);
  if (t && t.status !== 'COMPLETED') {
    t.status = 'COMPLETED'; t.effective_date = pp.effective_date; t.decided_by = pp.actor; t.decided_at = pp.at;
    t.decision_note = pp.note || ''; t.version += 1;
    updateRow_('TRANSFER_REQUESTS', t);
  }
  if (!rows_('APPROVAL_ACTIONS').some(function (a) { return a.target_id === pp.transfer_id && a.action === 'CONFIRM'; })) {
    approvalAction_('TRANSFER', pp.transfer_id, 'CONFIRM', pp.actor, pp.note || '', pp.request_id);
  }
  return { transfer_id: pp.transfer_id };
}


/* ======================= Dues.gs ======================= */
/**
 * Dues.gs — Ghi nhận đoàn phí (không tích hợp thanh toán).
 *  - Mỗi đoàn viên chỉ có MỘT ghi nhận hiệu lực (ACTIVE) cho một kỳ (yyyy-MM).
 *  - Tiền là số nguyên VND, không âm. Hệ thống KHÔNG tự áp mức thu theo quy định pháp lý.
 *  - Mọi tạo/điều chỉnh/hủy đều ghi DUES_HISTORY.
 */

function validPeriod_(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})$/);
  return !!(m && +m[1] >= 2000 && +m[1] <= 2100 && +m[2] >= 1 && +m[2] <= 12);
}

function money_(v, label, errors, key, required) {
  var n = parseIntStrict_(v);
  if (n === null) { if (required) errors[key] = 'Vui lòng nhập ' + label + '.'; return 0; }
  if (isNaN(n) || n < 0 || n > 1000000000) { errors[key] = label + ' phải là số nguyên VND từ 0 đến 1.000.000.000.'; return 0; }
  return n;
}

function duesHistory_(duesId, action, oldR, newR, reason, actor) {
  insertRow_('DUES_HISTORY', {
    entry_id: newId_('DH'), dues_id: duesId, action: action,
    old_due: oldR ? oldR.amount_due : '', new_due: newR ? newR.amount_due : '',
    old_paid: oldR ? oldR.amount_paid : '', new_paid: newR ? newR.amount_paid : '',
    reason: reason || '', actor: actor, at: now_()
  });
}

function activeDues_(memberId, period) {
  var rs = rows_('DUES');
  for (var i = 0; i < rs.length; i++) if (rs[i].member_id === memberId && rs[i].period === period && rs[i].status === 'ACTIVE') return rs[i];
  return null;
}

/** Danh sách đoàn viên trong phạm vi + tình trạng đoàn phí của kỳ. */
function duesList_(ctx, p) {
  p = p || {};
  if (!validPeriod_(p.period)) throw AppError_(ERR.VALIDATION, 'Vui lòng chọn kỳ thu (tháng/năm).');
  var members = queryMembers_(ctx, { unit_id: p.unit_id, q: p.q, archived: 'active' });
  var byMember = {};
  rows_('DUES').forEach(function (d) { if (d.period === p.period && d.status === 'ACTIVE') byMember[d.member_id] = d; });
  var list = sortMembers_(members, 'full_name').map(function (m) {
    var d = byMember[m.member_id];
    var state = !d ? 'none' : d.amount_paid >= d.amount_due ? 'paid' : d.amount_paid > 0 ? 'partial' : 'unpaid';
    return { m: m, d: d, state: state };
  }).filter(function (x) { return !p.state || x.state === p.state; });
  var res = paginate_(list, p, function (x) {
    return { member_id: x.m.member_id, member_code: x.m.member_code, full_name: x.m.full_name, unit_name: unitName_(ctx, x.m.unit_id),
      can_record: can_(ctx, 'dues', x.m.unit_id), state: x.state,
      dues: x.d ? plain_(x.d, ['dues_id', 'amount_due', 'amount_paid', 'paid_date', 'note', 'recorded_by', 'recorded_at', 'version']) : null };
  });
  res.summary = duesTotals_(list.map(function (x) { return x.d; }).filter(Boolean), list.length);
  return res;
}

function duesTotals_(records, memberCount) {
  var due = 0, paid = 0;
  records.forEach(function (d) { due += d.amount_due || 0; paid += d.amount_paid || 0; });
  return { members: memberCount, recorded: records.length, due: due, paid: paid, missing: Math.max(due - paid, 0) };
}

/** Tạo ghi nhận cho nhiều đoàn viên (cá nhân = danh sách 1 dòng). Bỏ qua đoàn viên đã có ghi nhận kỳ này. */
function duesRecord_(ctx, p, requestId) {
  p = p || {};
  if (!validPeriod_(p.period)) throw AppError_(ERR.VALIDATION, 'Vui lòng chọn kỳ thu (tháng/năm).');
  var items = (p.items || []).slice(0, 500);
  if (!items.length) throw AppError_(ERR.VALIDATION, 'Chưa có dòng nào để ghi nhận.');
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'dues.record', null, function () {
      var created = [], skipped = [], failed = [];
      var toInsert = [], seen = {};
      items.forEach(function (it, i) {
        var m = findBy_('MEMBERS', 'member_id', String(it.member_id || ''));
        if (!m || m.archived) { failed.push({ index: i, message: 'Không tìm thấy hồ sơ đang hiệu lực.' }); return; }
        if (!can_(ctx, 'dues', m.unit_id)) {
          audit_(ctx, 'DENIED_DUES', 'MEMBER', m.member_id, 'DENIED', requestId, '');
          failed.push({ index: i, member_code: m.member_code, message: 'Bạn không được cấp quyền ghi đoàn phí cho đơn vị này.' }); return;
        }
        if (seen[m.member_id] || activeDues_(m.member_id, p.period)) { skipped.push({ index: i, member_code: m.member_code, message: 'Đã có ghi nhận kỳ này — dùng "Điều chỉnh".' }); return; }
        var errors = {};
        var due = money_(it.amount_due, 'số phải thu', errors, 'amount_due', true);
        var paid = money_(it.amount_paid === '' || it.amount_paid === undefined ? 0 : it.amount_paid, 'số đã thu', errors, 'amount_paid', false);
        var pd = parseDate_(it.paid_date);
        if (pd === null) errors.paid_date = 'Ngày thu không hợp lệ.';
        if (paid > 0 && !pd) pd = today_();
        var note = String(it.note || '').trim().substring(0, 500);
        if (Object.keys(errors).length) { failed.push({ index: i, member_code: m.member_code, message: Object.keys(errors).map(function (k) { return errors[k]; }).join(' ') }); return; }
        seen[m.member_id] = true;
        toInsert.push({ dues_id: newId_('DUE'), member_id: m.member_id, unit_id: m.unit_id, period: p.period, amount_due: due,
          amount_paid: paid, paid_date: pd || '', note: note, status: 'ACTIVE', recorded_by: ctx.user.email,
          recorded_at: now_(), updated_by: '', updated_at: '', version: 1 });
      });
      insertRows_('DUES', toInsert);
      toInsert.forEach(function (d) {
        created.push(d.dues_id);
      });
      // Lịch sử theo lô
      insertRows_('DUES_HISTORY', toInsert.map(function (d) {
        return { entry_id: newId_('DH'), dues_id: d.dues_id, action: 'CREATE', old_due: '', new_due: d.amount_due, old_paid: '',
          new_paid: d.amount_paid, reason: '', actor: ctx.user.email, at: now_() };
      }));
      audit_(ctx, 'DUES_RECORD', 'DUES', p.period, 'OK', requestId, 'Tạo ' + created.length + ', bỏ qua ' + skipped.length + ', lỗi ' + failed.length);
      return { created: created.length, skipped: skipped, failed: failed,
        message: 'Đã ghi nhận ' + created.length + ' đoàn viên.' + (skipped.length ? ' Bỏ qua ' + skipped.length + ' đã có ghi nhận.' : '') +
          (failed.length ? ' ' + failed.length + ' dòng lỗi.' : '') };
    });
  });
}

/** Điều chỉnh hoặc hủy (void) một ghi nhận — bắt buộc lý do, kiểm tra phiên bản. */
function duesAdjust_(ctx, p, requestId) {
  p = p || {};
  var reason = cleanStr_(p.reason, 500);
  if (!reason) throw AppError_(ERR.VALIDATION, 'Vui lòng ghi lý do điều chỉnh.', { reason: 'Bắt buộc ghi lý do.' });
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'dues.adjust', null, function () {
      var d = findBy_('DUES', 'dues_id', String(p.dues_id || ''));
      if (!d || d.status !== 'ACTIVE') throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy ghi nhận đoàn phí.');
      assertCan_(ctx, 'dues', d.unit_id, 'DUES', d.dues_id);
      if (parseInt(p.version, 10) !== d.version) throw AppError_(ERR.CONFLICT, 'Ghi nhận này vừa được người khác điều chỉnh. Hãy tải lại rồi thử lại.');
      var old = plain_(d);
      if (p.void) {
        d.status = 'VOID';
      } else {
        var errors = {};
        d.amount_due = money_(p.amount_due, 'số phải thu', errors, 'amount_due', true);
        d.amount_paid = money_(p.amount_paid, 'số đã thu', errors, 'amount_paid', true);
        var pd = parseDate_(p.paid_date);
        if (pd === null) errors.paid_date = 'Ngày thu không hợp lệ.';
        if (Object.keys(errors).length) throw AppError_(ERR.VALIDATION, 'Dữ liệu chưa hợp lệ.', errors);
        d.paid_date = pd || (d.amount_paid > 0 ? (d.paid_date || today_()) : '');
        if (p.note !== undefined) d.note = String(p.note || '').trim().substring(0, 500);
      }
      d.updated_by = ctx.user.email; d.updated_at = now_(); d.version += 1;
      updateRow_('DUES', d);
      duesHistory_(d.dues_id, p.void ? 'VOID' : 'ADJUST', old, d, reason, ctx.user.email);
      audit_(ctx, p.void ? 'DUES_VOID' : 'DUES_ADJUST', 'DUES', d.dues_id, 'OK', requestId, '');
      return { dues_id: d.dues_id, message: p.void ? 'Đã hủy ghi nhận.' : 'Đã điều chỉnh ghi nhận.' };
    });
  });
}

function duesHistoryList_(ctx, p) {
  var d = findBy_('DUES', 'dues_id', String(p && p.dues_id || ''));
  if (!d) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy ghi nhận.');
  assertCan_(ctx, 'view', d.unit_id, 'DUES', d.dues_id);
  return { items: rows_('DUES_HISTORY').filter(function (h) { return h.dues_id === d.dues_id; }).map(function (h) { return plain_(h); }) };
}

/** Tổng hợp theo đơn vị cho một kỳ (hoặc khoảng kỳ). */
function duesSummary_(ctx, p) {
  p = p || {};
  var from = p.from || p.period, to = p.to || p.period;
  if (!validPeriod_(from) || !validPeriod_(to)) throw AppError_(ERR.VALIDATION, 'Vui lòng chọn kỳ thu hợp lệ.');
  var units = unitsWith_(ctx, 'view', p.unit_id || '', true);
  var allowed = {};
  units.forEach(function (u) { allowed[u] = true; });
  var agg = {};
  rows_('DUES').forEach(function (d) {
    if (d.status !== 'ACTIVE' || !allowed[d.unit_id] || d.period < from || d.period > to) return;
    var a = agg[d.unit_id] = agg[d.unit_id] || { unit_id: d.unit_id, unit: unitPath_(ctx, d.unit_id), recorded: 0, due: 0, paid: 0 };
    a.recorded++; a.due += d.amount_due; a.paid += d.amount_paid;
  });
  var items = Object.keys(agg).map(function (k) { var a = agg[k]; a.missing = Math.max(a.due - a.paid, 0); return a; })
    .sort(function (a, b) { return a.unit.localeCompare(b.unit, 'vi'); });
  var total = items.reduce(function (s, a) { s.recorded += a.recorded; s.due += a.due; s.paid += a.paid; s.missing += a.missing; return s; },
    { recorded: 0, due: 0, paid: 0, missing: 0 });
  return { from: from, to: to, items: items, total: total };
}


/* ======================= ImportExport.gs ======================= */
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


/* ======================= Admin.gs ======================= */
/**
 * Admin.gs — Quản trị đơn vị, người dùng, phạm vi quyền và cấu hình.
 * Mọi hàm đều gọi assertAdmin_ ở phía máy chủ.
 */

function adminOverview_(ctx) {
  assertAdmin_(ctx);
  var units = rows_('UNITS').map(function (u) {
    var o = plain_(u); o.path = unitPath_(ctx, u.unit_id);
    o.member_count = 0; return o;
  });
  var byId = {};
  units.forEach(function (u) { byId[u.unit_id] = u; });
  rows_('MEMBERS').forEach(function (m) { if (!m.archived && byId[m.unit_id]) byId[m.unit_id].member_count++; });
  units.sort(function (a, b) { return a.path.localeCompare(b.path, 'vi'); });
  var scopes = rows_('USER_SCOPES').filter(function (s) { return s.status === 'active'; });
  var users = rows_('USERS').map(function (u) {
    var o = plain_(u);
    o.scopes = scopes.filter(function (s) { return s.user_id === u.user_id; }).map(function (s) {
      return { scope_id: s.scope_id, unit_id: s.unit_id, unit: unitPath_(ctx, s.unit_id), role: s.role, role_label: ROLE_LABELS[s.role],
        include_children: s.include_children, can_dues: s.can_dues };
    });
    o.active_sessions = rows_('SESSIONS').filter(function (s) {
      return s.user_id === u.user_id && !s.revoked && minutesSince_(s.expires_at) < 0;
    }).length;
    return o;
  }).sort(function (a, b) { return a.email.localeCompare(b.email); });
  var settings = rows_('SETTINGS').filter(function (s) { return EDITABLE_SETTINGS.indexOf(s.key) >= 0; })
    .map(function (s) { return { key: s.key, value: s.value, description: s.description }; });
  var quota = null;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) { }
  return { units: units, users: users, settings: settings, mailQuota: quota,
    pendingOps: pendingOperations_().map(function (o) { return { op_id: o.op_id, action: o.action, started_at: o.started_at }; }),
    levelNames: String(getSetting_('UNIT_LEVEL_NAMES', '')).split(',').map(function (s) { return s.trim(); }) };
}

function unitSave_(ctx, p, requestId) {
  assertAdmin_(ctx);
  p = p || {};
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'unit.save', null, function () {
      var errors = {};
      var code = cleanStr_(p.code, 30).toUpperCase();
      var name = cleanStr_(p.name, 150);
      if (!/^[A-Z0-9._-]{1,30}$/.test(code)) errors.code = 'Mã đơn vị gồm chữ không dấu, số, . _ - (tối đa 30 ký tự).';
      if (!name) errors.name = 'Vui lòng nhập tên đơn vị.';
      var parentId = String(p.parent_id || '');
      var units = rows_('UNITS');
      var parent = parentId ? findBy_('UNITS', 'unit_id', parentId) : null;
      if (parentId && !parent) errors.parent_id = 'Đơn vị cấp trên không tồn tại.';
      var u = p.unit_id ? findBy_('UNITS', 'unit_id', String(p.unit_id)) : null;
      if (p.unit_id && !u) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy đơn vị.');
      if (units.some(function (x) { return x.code.toUpperCase() === code && (!u || x.unit_id !== u.unit_id); })) errors.code = 'Mã đơn vị đã tồn tại.';
      if (u && parentId) {
        // chống tạo vòng lặp trong cây
        var cur = parent, guard = 0;
        while (cur && guard++ < 50) {
          if (cur.unit_id === u.unit_id) { errors.parent_id = 'Không thể chọn đơn vị cấp dưới (hoặc chính nó) làm cấp trên.'; break; }
          cur = cur.parent_id ? findBy_('UNITS', 'unit_id', cur.parent_id) : null;
        }
      }
      var status = p.status === 'inactive' ? 'inactive' : 'active';
      if (u && status === 'inactive' && u.status === 'active') {
        var activeMembers = rows_('MEMBERS').filter(function (m) { return m.unit_id === u.unit_id && !m.archived; }).length;
        if (activeMembers) errors.status = 'Đơn vị còn ' + activeMembers + ' đoàn viên. Hãy chuyển sinh hoạt hoặc lưu trữ trước khi ngừng hoạt động.';
        if (units.some(function (x) { return x.parent_id === u.unit_id && x.status === 'active'; })) errors.status = 'Đơn vị còn đơn vị cấp dưới đang hoạt động.';
      }
      if (Object.keys(errors).length) throw AppError_(ERR.VALIDATION, 'Thông tin đơn vị chưa hợp lệ.', errors);
      var level = parent ? (parent.level || 1) + 1 : 1;
      if (u) {
        if (p.version !== undefined && parseInt(p.version, 10) !== u.version) throw AppError_(ERR.CONFLICT, 'Đơn vị vừa được người khác sửa. Hãy tải lại.');
        u.code = code; u.name = name; u.parent_id = parentId; u.level = level; u.status = status;
        u.sort_order = parseInt(p.sort_order, 10) || u.sort_order || 0; u.updated_at = now_(); u.version += 1;
        updateRow_('UNITS', u);
        // cập nhật cấp của các đơn vị con
        var changed = [], stack = [u];
        while (stack.length) {
          var x = stack.pop();
          rows_('UNITS').forEach(function (c) {
            if (c.parent_id === x.unit_id && c.level !== x.level + 1) { c.level = x.level + 1; changed.push(c); stack.push(c); }
            else if (c.parent_id === x.unit_id) stack.push(c);
          });
        }
        updateRows_('UNITS', changed);
      } else {
        u = { unit_id: newId_('U'), code: code, name: name, parent_id: parentId, level: level, status: status,
          sort_order: parseInt(p.sort_order, 10) || 0, created_at: now_(), updated_at: '', version: 1 };
        insertRow_('UNITS', u);
      }
      audit_(ctx, 'UNIT_SAVE', 'UNIT', u.unit_id, 'OK', requestId, code);
      return { unit_id: u.unit_id, message: 'Đã lưu đơn vị.' };
    });
  });
}

function userSave_(ctx, p, requestId) {
  assertAdmin_(ctx);
  p = p || {};
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'user.save', null, function () {
      var email = normEmail_(p.email);
      var name = cleanStr_(p.full_name, 100);
      var errors = {};
      if (!validEmail_(email)) errors.email = 'Email chưa đúng định dạng.';
      if (!name) errors.full_name = 'Vui lòng nhập họ tên.';
      var u = p.user_id ? findBy_('USERS', 'user_id', String(p.user_id)) : null;
      if (p.user_id && !u) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy người dùng.');
      var other = findBy_('USERS', 'email', email);
      if (other && (!u || other.user_id !== u.user_id)) errors.email = 'Email đã được khai báo cho người dùng khác.';
      if (Object.keys(errors).length) throw AppError_(ERR.VALIDATION, 'Thông tin người dùng chưa hợp lệ.', errors);
      var status = p.status === 'locked' ? 'locked' : 'active';
      var isAdmin = p.is_admin === true || p.is_admin === 'true';
      if (u && u.user_id === ctx.user.user_id && (!isAdmin || status === 'locked')) {
        throw AppError_(ERR.VALIDATION, 'Bạn không thể tự khóa hoặc tự bỏ quyền quản trị của chính mình.');
      }
      if (u && u.is_admin && (!isAdmin || status === 'locked')) {
        var otherAdmins = rows_('USERS').filter(function (x) { return x.is_admin && x.status === 'active' && x.user_id !== u.user_id; });
        if (!otherAdmins.length) throw AppError_(ERR.VALIDATION, 'Phải còn ít nhất một quản trị viên đang hoạt động.');
      }
      var revoked = 0;
      if (u) {
        var wasActive = u.status === 'active', wasAdmin = u.is_admin;
        u.email = email; u.full_name = name; u.status = status; u.is_admin = isAdmin; u.updated_at = now_(); u.version += 1;
        updateRow_('USERS', u);
        if ((wasActive && status === 'locked') || (wasAdmin && !isAdmin)) revoked = revokeUserSessions_(u.user_id, status === 'locked' ? 'Khóa tài khoản' : 'Thay đổi quyền');
      } else {
        u = { user_id: newId_('USR'), email: email, full_name: name, status: status, is_admin: isAdmin, created_at: now_(),
          created_by: ctx.user.email, updated_at: '', last_login_at: '', version: 1 };
        insertRow_('USERS', u);
      }
      audit_(ctx, 'USER_SAVE', 'USER', u.user_id, 'OK', requestId, 'status=' + status + ', admin=' + isAdmin + (revoked ? ', thu hồi ' + revoked + ' phiên' : ''));
      return { user_id: u.user_id, message: 'Đã lưu người dùng.' + (revoked ? ' Đã thu hồi ' + revoked + ' phiên đang dùng.' : '') };
    });
  });
}

function scopeAdd_(ctx, p, requestId) {
  assertAdmin_(ctx);
  p = p || {};
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'scope.add', null, function () {
      var u = findBy_('USERS', 'user_id', String(p.user_id || ''));
      var unit = findBy_('UNITS', 'unit_id', String(p.unit_id || ''));
      if (!u) throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy người dùng.');
      if (!unit) throw AppError_(ERR.VALIDATION, 'Vui lòng chọn đơn vị.', { unit_id: 'Chọn đơn vị.' });
      if ([ROLES.OFFICER, ROLES.APPROVER, ROLES.VIEWER].indexOf(p.role) < 0) throw AppError_(ERR.VALIDATION, 'Vui lòng chọn vai trò.', { role: 'Chọn vai trò.' });
      var exists = rows_('USER_SCOPES').some(function (s) { return s.user_id === u.user_id && s.unit_id === unit.unit_id && s.role === p.role && s.status === 'active'; });
      if (exists) throw AppError_(ERR.CONFLICT, 'Người dùng đã có vai trò này tại đơn vị này.');
      var s = { scope_id: newId_('SC'), user_id: u.user_id, unit_id: unit.unit_id, role: p.role,
        include_children: p.include_children !== false && p.include_children !== 'false',
        can_dues: p.role === ROLES.OFFICER && (p.can_dues === true || p.can_dues === 'true'),
        status: 'active', created_at: now_(), created_by: ctx.user.email };
      insertRow_('USER_SCOPES', s);
      audit_(ctx, 'SCOPE_ADD', 'USER', u.user_id, 'OK', requestId, p.role + '@' + unit.code);
      return { scope_id: s.scope_id, message: 'Đã cấp quyền.' };
    });
  });
}

function scopeRemove_(ctx, p, requestId) {
  assertAdmin_(ctx);
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'scope.remove', null, function () {
      var s = findBy_('USER_SCOPES', 'scope_id', String(p && p.scope_id || ''));
      if (!s || s.status !== 'active') throw AppError_(ERR.NOT_FOUND, 'Không tìm thấy quyền.');
      s.status = 'revoked';
      updateRow_('USER_SCOPES', s);
      audit_(ctx, 'SCOPE_REMOVE', 'USER', s.user_id, 'OK', requestId, s.role);
      return { message: 'Đã thu hồi quyền. Có hiệu lực ngay ở thao tác kế tiếp của người dùng.' };
    });
  });
}

function revokeSessionsApi_(ctx, p, requestId) {
  assertAdmin_(ctx);
  return withLock_(function () {
    var n = revokeUserSessions_(String(p && p.user_id || ''), 'Quản trị thu hồi');
    audit_(ctx, 'SESSIONS_REVOKE', 'USER', p && p.user_id, 'OK', requestId, 'Số phiên: ' + n);
    return { message: 'Đã thu hồi ' + n + ' phiên đăng nhập.' };
  });
}

function settingsSave_(ctx, p, requestId) {
  assertAdmin_(ctx);
  return withLock_(function () {
    return runOperation_(ctx, requestId, 'settings.save', null, function () {
      var values = (p && p.values) || {};
      var errors = {};
      Object.keys(values).forEach(function (k) {
        if (EDITABLE_SETTINGS.indexOf(k) < 0) { errors[k] = 'Không được sửa tham số này.'; return; }
        var v = cleanStr_(values[k], 500);
        if (k === 'ALLOW_ADMIN_SELF_APPROVE' && ['TRUE', 'FALSE'].indexOf(v.toUpperCase()) < 0) errors[k] = 'Chỉ nhận TRUE hoặc FALSE.';
        if ((k === 'BACKUP_KEEP' || k === 'MEMBERS_WARN_LIMIT') && !/^\d{1,6}$/.test(v)) errors[k] = 'Phải là số nguyên dương.';
        if (k === 'DUES_DEFAULT_AMOUNT' && v && !/^\d{1,10}$/.test(v)) errors[k] = 'Số tiền nguyên VND hoặc để trống.';
        if (k === 'MEMBER_CODE_PREFIX' && !/^[A-Z0-9]{0,6}$/i.test(v)) errors[k] = 'Tối đa 6 chữ/số không dấu.';
      });
      if (Object.keys(errors).length) throw AppError_(ERR.VALIDATION, 'Cấu hình chưa hợp lệ.', errors);
      Object.keys(values).forEach(function (k) {
        var v = cleanStr_(values[k], 500);
        if (k === 'ALLOW_ADMIN_SELF_APPROVE') v = v.toUpperCase();
        setSetting_(k, v);
      });
      audit_(ctx, 'SETTINGS_SAVE', 'SYSTEM', '', 'OK', requestId, Object.keys(values).join(','));
      return { message: 'Đã lưu cấu hình.' };
    });
  });
}


/* ======================= Backup.gs ======================= */
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


/* ======================= Demo.gs ======================= */
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


/* ======================= Code.gs ======================= */
/**
 * Code.gs — Điểm vào của Web App.
 *
 * KIẾN TRÚC: Giao diện nghiệp vụ do Apps Script HTML Service phục vụ (doGet) và gọi máy chủ
 * bằng google.script.run.api(...). Trang GitHub Pages chỉ là trang giới thiệu có nút mở Web App.
 *
 * HÀM CÔNG KHAI (gọi được từ trình duyệt): doGet, api.
 * Các hàm chạy từ trình soạn thảo (setupSystem, installDailyBackup, ...) tự kiểm tra ngữ cảnh chủ sở hữu.
 * Mọi hàm còn lại kết thúc bằng "_" nên google.script.run KHÔNG gọi được.
 */

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle(APP.NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT); // không cho trang khác nhúng (chống clickjacking)
}

/** Dùng trong Index.html: <?!= include_('Styles') ?> — chỉ chèn tệp tĩnh của dự án. */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Bảng hành động: name → [hàm, cần đăng nhập?, là thao tác ghi (cần request_id)?]
 * Hàm đọc nhận (ctx, payload); hàm ghi nhận (ctx, payload, requestId).
 * Tạo trong hàm (không phải biến toàn cục) vì Apps Script nạp các tệp .gs theo thứ tự,
 * hàm ở tệp sau chưa tồn tại khi mã cấp cao nhất của tệp trước chạy.
 */
function actions_() {
  return {
  'auth.requestOtp': [function (ctx, p, rid) { return authRequestOtp_(p, rid); }, false, false],
  'auth.verifyOtp': [function (ctx, p, rid) { return authVerifyOtp_(p, rid); }, false, false],
  'auth.logout': [authLogout_, true, false],
  'me': [function (ctx) { return describeAccess_(ctx); }, true, false],
  'dashboard': [dashboard_, true, false],

  'members.list': [membersList_, true, false],
  'members.get': [memberGet_, true, false],

  'change.save': [crSave_, true, true],
  'change.submit': [crSubmit_, true, true],
  'change.cancel': [crCancel_, true, true],
  'change.list': [crList_, true, false],
  'change.get': [crGet_, true, false],
  'change.approve': [crApprove_, true, true],
  'change.approveMany': [crApproveMany_, true, true],
  'change.return': [crReturn_, true, true],

  'transfer.create': [trCreate_, true, true],
  'transfer.list': [trList_, true, false],
  'transfer.confirm': [function (c, p, r) { return trDecide_(c, p, r, 'confirm'); }, true, true],
  'transfer.reject': [function (c, p, r) { return trDecide_(c, p, r, 'reject'); }, true, true],
  'transfer.cancel': [function (c, p, r) { return trDecide_(c, p, r, 'cancel'); }, true, true],

  'dues.list': [duesList_, true, false],
  'dues.record': [duesRecord_, true, true],
  'dues.adjust': [duesAdjust_, true, true],
  'dues.history': [duesHistoryList_, true, false],
  'dues.summary': [duesSummary_, true, false],

  'import.check': [importCheck_, true, false],
  'import.commit': [importCommit_, true, true],
  'import.jobs': [importJobs_, true, false],
  'export.members': [exportMembers_, true, true],
  'export.report': [exportReport_, true, true],
  'report.byUnit': [reportByUnit_, true, false],

  'admin.overview': [adminOverview_, true, false],
  'admin.unitSave': [unitSave_, true, true],
  'admin.userSave': [userSave_, true, true],
  'admin.scopeAdd': [scopeAdd_, true, true],
  'admin.scopeRemove': [scopeRemove_, true, true],
  'admin.revokeSessions': [revokeSessionsApi_, true, true],
  'admin.settingsSave': [settingsSave_, true, true],
  'admin.audit': [auditList_, true, false],
  'admin.backupList': [backupList_, true, false],
  'admin.backupNow': [backupNowApi_, true, true],
  'admin.restore': [restoreApi_, true, true],
  'admin.recover': [function (c, p, r) { assertAdmin_(c); return recoverOperations_(c, r); }, true, true]
  };
}

/**
 * Hàm công khai duy nhất cho giao diện.
 * req = { token, action, payload, requestId }
 * Trả về { ok: true, data } hoặc { ok: false, error: { code, message, details } }.
 */
function api(req) {
  var action = req && typeof req.action === 'string' ? req.action : '';
  var requestId = req && typeof req.requestId === 'string' ? req.requestId.substring(0, 64) : '';
  var ACTIONS = actions_();
  var def = ACTIONS.hasOwnProperty(action) ? ACTIONS[action] : null;
  try {
    if (!def) throw AppError_(ERR.VALIDATION, 'Chức năng không tồn tại. Hãy tải lại trang.');
    var payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
    if (JSON.stringify(payload).length > 2000000) throw AppError_(ERR.VALIDATION, 'Dữ liệu gửi lên quá lớn. Hãy chia nhỏ tệp.');
    var ctx = null;
    if (def[1]) {
      ctx = authenticate_(req.token);
      ctx.requestId = requestId;
    }
    if (def[2] && !requestId) throw AppError_(ERR.VALIDATION, 'Thiếu mã thao tác. Hãy tải lại trang rồi thử lại.');
    var data = def[0](ctx, payload, requestId);
    return { ok: true, data: data === undefined ? null : data };
  } catch (e) {
    if (e && e.appCode) {
      return { ok: false, error: { code: e.appCode, message: e.message, details: e.details || null } };
    }
    var ref = randomHex_(8).toUpperCase();
    // Log kỹ thuật: chỉ ghi tên hành động, mã tham chiếu và thông điệp lỗi — không ghi payload/token.
    console.error('[' + ref + '] ' + action + ': ' + (e && e.stack ? e.stack : e));
    return { ok: false, error: { code: ERR.INTERNAL, message: 'Có lỗi hệ thống. Vui lòng thử lại; nếu vẫn lỗi, báo quản trị kèm mã ' + ref + '.' } };
  }
}
