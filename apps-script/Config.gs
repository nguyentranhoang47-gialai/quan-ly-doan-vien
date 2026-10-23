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
