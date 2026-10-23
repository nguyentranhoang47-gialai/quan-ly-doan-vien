# Từ điển dữ liệu (DATA_DICTIONARY)

> Tệp này được sinh tự động từ `apps-script/Config.gs` bằng `node tools/build.js`.

Mỗi sheet có **dòng 1 là mã trường ổn định** (dùng trong mã nguồn). Tên tiếng Việt nằm trong ghi chú của ô tiêu đề và trong sheet `HUONG_DAN`.

**Quy ước lưu trữ**

- Mọi chuỗi được ghi với tiền tố `'` nên Google Sheets luôn coi là văn bản: giữ số 0 đầu (mã, điện thoại, giấy tờ) và không bao giờ diễn giải thành công thức.
- Ngày lưu dạng chuỗi `yyyy-MM-dd`, ngày giờ dạng `yyyy-MM-ddTHH:mm:ss` theo giờ Việt Nam (Asia/Ho_Chi_Minh) — không lệch ngày khi đổi múi giờ.
- Tiền là số nguyên VND.
- ID nội bộ là chuỗi ngẫu nhiên có tiền tố (vd `M-…`, `CR-…`), không phụ thuộc số dòng.

**Bảng bổ sung ngoài danh sách yêu cầu:** `DUES_HISTORY` (lịch sử điều chỉnh đoàn phí), `SESSIONS` và `AUTH_OTP` (xác thực OTP, chỉ lưu mã băm), `HUONG_DAN` (giải thích tiếng Việt, tự sinh).

## Danh mục giá trị

- Tình trạng sinh hoạt (`MEMBERS.member_status`): `ACTIVE` = Đang sinh hoạt; `SUSPENDED` = Tạm dừng sinh hoạt; `LEFT` = Thôi sinh hoạt; `RETIRED` = Nghỉ hưu
- Loại yêu cầu (`CHANGE_REQUESTS.request_type`): `CREATE` = Thêm mới; `UPDATE` = Sửa hồ sơ; `ARCHIVE` = Lưu trữ hồ sơ; `RESTORE` = Khôi phục hồ sơ
- Trạng thái yêu cầu (`CHANGE_REQUESTS.status`): `DRAFT` = Nháp; `PENDING` = Chờ duyệt; `APPROVED` = Đã duyệt; `RETURNED` = Trả lại; `CANCELLED` = Đã hủy
- Trạng thái chuyển sinh hoạt (`TRANSFER_REQUESTS.status`): `PENDING` = Chờ đơn vị đến xác nhận; `COMPLETED` = Hoàn tất; `REJECTED` = Từ chối; `CANCELLED` = Đã hủy
- Vai trò (`USER_SCOPES.role`): `officer` = Cán bộ đơn vị; `approver` = Người phê duyệt; `viewer` = Người xem. Quản trị hệ thống = `USERS.is_admin`.
- Giới tính: Nam, Nữ, Khác. Loại giấy tờ: CCCD, CMND, Hộ chiếu, Khác.

> Ba khái niệm được tách riêng: **tình trạng đoàn viên** (`member_status`), **loại yêu cầu** (`request_type`) và **trạng thái yêu cầu** (`status`).

## SETTINGS — Cấu hình hệ thống

Mỗi dòng một tham số. Chỉ sửa cột value khi được hướng dẫn.

**Khóa và quan hệ:** Khóa duy nhất: key.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `key` | Mã tham số | Chuỗi | Có |
| `value` | Giá trị | Chuỗi |  |
| `description` | Mô tả | Chuỗi |  |
| `updated_at` | Cập nhật lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) |  |

## UNITS — Đơn vị (cây tổ chức)

Đơn vị tổ chức theo cây qua parent_id. status: active/inactive.

**Khóa và quan hệ:** parent_id → UNITS.unit_id (cây đơn vị). Khóa duy nhất: unit_id, code.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `unit_id` | ID đơn vị | Mã định danh (chuỗi) | Có |
| `code` | Mã đơn vị (duy nhất) | Chuỗi | Có |
| `name` | Tên đơn vị | Chuỗi | Có |
| `parent_id` | ID đơn vị cấp trên | Mã định danh (chuỗi) |  |
| `level` | Cấp (1 = cao nhất) | Số nguyên | Có |
| `status` | Trạng thái | Danh mục (chuỗi) | Có |
| `sort_order` | Thứ tự | Số nguyên |  |
| `created_at` | Tạo lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `updated_at` | Cập nhật lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) |  |
| `version` | Phiên bản | Số nguyên | Có |

## USERS — Người dùng được phép đăng nhập

Email duy nhất. status: active/locked. is_admin: TRUE/FALSE.

**Khóa và quan hệ:** Khóa duy nhất: user_id, email (chữ thường).

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `user_id` | ID người dùng | Mã định danh (chuỗi) | Có |
| `email` | Email (duy nhất) | Chuỗi | Có |
| `full_name` | Họ tên | Chuỗi | Có |
| `status` | Trạng thái | Danh mục (chuỗi) | Có |
| `is_admin` | Quản trị hệ thống | TRUE/FALSE | Có |
| `created_at` | Tạo lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `created_by` | Người tạo | Chuỗi |  |
| `updated_at` | Cập nhật lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) |  |
| `last_login_at` | Đăng nhập gần nhất | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) |  |
| `version` | Phiên bản | Số nguyên | Có |

## USER_SCOPES — Phạm vi quyền của người dùng theo đơn vị

Một người có thể có nhiều dòng (nhiều đơn vị/vai trò). role: officer/approver/viewer.

**Khóa và quan hệ:** user_id → USERS; unit_id → UNITS. Không trùng (user_id, unit_id, role) đang active.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `scope_id` | ID phạm vi | Mã định danh (chuỗi) | Có |
| `user_id` | ID người dùng | Mã định danh (chuỗi) | Có |
| `unit_id` | ID đơn vị | Mã định danh (chuỗi) | Có |
| `role` | Vai trò | Danh mục (chuỗi) | Có |
| `include_children` | Gồm đơn vị cấp dưới | TRUE/FALSE | Có |
| `can_dues` | Được ghi đoàn phí | TRUE/FALSE | Có |
| `status` | Trạng thái | Danh mục (chuỗi) | Có |
| `created_at` | Tạo lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `created_by` | Người tạo | Chuỗi |  |

## MEMBERS — Hồ sơ đoàn viên chính thức (chỉ thay đổi qua phê duyệt)

KHÔNG sửa trực tiếp. Mọi thay đổi phải qua ứng dụng để có phê duyệt và nhật ký.

**Khóa và quan hệ:** unit_id → UNITS. Khóa duy nhất: member_id; member_code (không phân biệt hoa thường); id_number khi có giá trị. last_ref → CHANGE_REQUESTS.change_id hoặc TRANSFER_REQUESTS.transfer_id.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `member_id` | ID nội bộ | Mã định danh (chuỗi) | Có |
| `member_code` | Mã đoàn viên | Chuỗi | Có |
| `full_name` | Họ và tên | Chuỗi | Có |
| `name_search` | Tên không dấu (tự sinh) | Chuỗi | Có |
| `dob` | Ngày sinh | Ngày (chuỗi yyyy-MM-dd) |  |
| `gender` | Giới tính | Danh mục (chuỗi) |  |
| `id_type` | Loại giấy tờ | Danh mục (chuỗi) |  |
| `id_number` | Số giấy tờ | Chuỗi |  |
| `phone` | Số điện thoại | Chuỗi |  |
| `email` | Email | Chuỗi |  |
| `address` | Địa chỉ | Chuỗi |  |
| `unit_id` | ID đơn vị | Mã định danh (chuỗi) | Có |
| `join_date` | Ngày vào công đoàn | Ngày (chuỗi yyyy-MM-dd) |  |
| `union_position` | Chức vụ công đoàn | Chuỗi |  |
| `member_status` | Tình trạng sinh hoạt | Danh mục (chuỗi) | Có |
| `note` | Ghi chú | Chuỗi |  |
| `archived` | Đã lưu trữ | TRUE/FALSE | Có |
| `created_at` | Tạo lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `created_by` | Người tạo | Chuỗi | Có |
| `updated_at` | Cập nhật lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) |  |
| `updated_by` | Người cập nhật | Chuỗi |  |
| `version` | Phiên bản bản ghi | Số nguyên | Có |
| `last_ref` | Mã yêu cầu áp dụng gần nhất | Mã định danh (chuỗi) |  |

## CHANGE_REQUESTS — Yêu cầu thay đổi hồ sơ (thêm/sửa/lưu trữ)

status: DRAFT/PENDING/APPROVED/RETURNED/CANCELLED. payload_json: giá trị mới; old_json: giá trị cũ khi gửi.

**Khóa và quan hệ:** member_id → MEMBERS (với CREATE: ID sẽ cấp khi duyệt); unit_id → UNITS; import_job_id → IMPORT_JOBS.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `change_id` | ID yêu cầu | Mã định danh (chuỗi) | Có |
| `request_type` | Loại yêu cầu | Danh mục (chuỗi) | Có |
| `member_id` | ID đoàn viên | Mã định danh (chuỗi) | Có |
| `unit_id` | ID đơn vị | Mã định danh (chuỗi) | Có |
| `status` | Trạng thái yêu cầu | Danh mục (chuỗi) | Có |
| `payload_json` | Giá trị mới (JSON) | Chuỗi JSON | Có |
| `old_json` | Giá trị cũ (JSON) | Chuỗi JSON |  |
| `base_version` | Phiên bản hồ sơ gốc | Số nguyên |  |
| `summary` | Tóm tắt | Chuỗi |  |
| `import_job_id` | ID lô nhập | Mã định danh (chuỗi) |  |
| `created_by` | Người tạo | Chuỗi | Có |
| `created_at` | Tạo lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `updated_at` | Cập nhật lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) |  |
| `submitted_at` | Gửi duyệt lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) |  |
| `decided_by` | Người duyệt/trả lại | Chuỗi |  |
| `decided_at` | Thời gian duyệt/trả lại | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) |  |
| `decision_note` | Lý do/ghi chú xử lý | Chuỗi |  |
| `version` | Phiên bản | Số nguyên | Có |

## APPROVAL_ACTIONS — Lịch sử xử lý yêu cầu

Mỗi lần gửi, duyệt, trả lại, hủy, xác nhận, từ chối đều có một dòng.

**Khóa và quan hệ:** target_id → CHANGE_REQUESTS.change_id hoặc TRANSFER_REQUESTS.transfer_id (theo target_type).

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `action_id` | ID | Mã định danh (chuỗi) | Có |
| `target_type` | Loại (CHANGE/TRANSFER) | Danh mục (chuỗi) | Có |
| `target_id` | ID yêu cầu | Mã định danh (chuỗi) | Có |
| `action` | Hành động | Danh mục (chuỗi) | Có |
| `actor` | Người thực hiện | Chuỗi | Có |
| `at` | Thời gian | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `note` | Ghi chú | Chuỗi |  |
| `request_id` | Mã thao tác | Mã định danh (chuỗi) |  |

## TRANSFER_REQUESTS — Yêu cầu chuyển sinh hoạt

status: PENDING/COMPLETED/REJECTED/CANCELLED. Đơn vị chính thức chỉ đổi khi COMPLETED.

**Khóa và quan hệ:** member_id → MEMBERS; from_unit_id, to_unit_id → UNITS. Tối đa 1 yêu cầu PENDING / đoàn viên.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `transfer_id` | ID yêu cầu chuyển | Mã định danh (chuỗi) | Có |
| `member_id` | ID đoàn viên | Mã định danh (chuỗi) | Có |
| `from_unit_id` | Đơn vị đi | Mã định danh (chuỗi) | Có |
| `to_unit_id` | Đơn vị đến | Mã định danh (chuỗi) | Có |
| `proposed_date` | Ngày đề nghị chuyển | Ngày (chuỗi yyyy-MM-dd) | Có |
| `effective_date` | Ngày hiệu lực | Ngày (chuỗi yyyy-MM-dd) |  |
| `reason` | Lý do | Chuỗi | Có |
| `status` | Trạng thái | Danh mục (chuỗi) | Có |
| `created_by` | Người lập | Chuỗi | Có |
| `created_at` | Lập lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `decided_by` | Người xử lý | Chuỗi |  |
| `decided_at` | Xử lý lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) |  |
| `decision_note` | Ghi chú xử lý | Chuỗi |  |
| `version` | Phiên bản | Số nguyên | Có |

## MEMBERSHIP_HISTORY — Lịch sử sinh hoạt theo đơn vị

event: JOIN/TRANSFER_OUT/TRANSFER_IN/ARCHIVE/RESTORE. Không xóa dòng.

**Khóa và quan hệ:** member_id → MEMBERS; unit_id → UNITS; ref_id → yêu cầu gây ra sự kiện.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `history_id` | ID | Mã định danh (chuỗi) | Có |
| `member_id` | ID đoàn viên | Mã định danh (chuỗi) | Có |
| `unit_id` | ID đơn vị | Mã định danh (chuỗi) | Có |
| `event` | Sự kiện | Danh mục (chuỗi) | Có |
| `event_date` | Ngày | Ngày (chuỗi yyyy-MM-dd) | Có |
| `ref_id` | Mã yêu cầu liên quan | Mã định danh (chuỗi) | Có |
| `note` | Ghi chú | Chuỗi |  |
| `created_at` | Ghi lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `created_by` | Người ghi | Chuỗi | Có |

## DUES — Ghi nhận đoàn phí theo kỳ (tháng)

Duy nhất theo (member_id, period) với status ACTIVE. Tiền là số nguyên VND. Điều chỉnh ghi ở DUES_HISTORY.

**Khóa và quan hệ:** member_id → MEMBERS; unit_id → UNITS. Duy nhất (member_id, period) với status ACTIVE.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `dues_id` | ID | Mã định danh (chuỗi) | Có |
| `member_id` | ID đoàn viên | Mã định danh (chuỗi) | Có |
| `unit_id` | Đơn vị khi ghi nhận | Mã định danh (chuỗi) | Có |
| `period` | Kỳ (yyyy-MM) | Chuỗi | Có |
| `amount_due` | Số phải thu (VND) | Số nguyên | Có |
| `amount_paid` | Số đã thu (VND) | Số nguyên | Có |
| `paid_date` | Ngày thu | Ngày (chuỗi yyyy-MM-dd) |  |
| `note` | Ghi chú | Chuỗi |  |
| `status` | Trạng thái (ACTIVE/VOID) | Danh mục (chuỗi) | Có |
| `recorded_by` | Người ghi nhận | Chuỗi | Có |
| `recorded_at` | Ghi nhận lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `updated_by` | Người điều chỉnh | Chuỗi |  |
| `updated_at` | Điều chỉnh lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) |  |
| `version` | Phiên bản | Số nguyên | Có |

## DUES_HISTORY — Lịch sử điều chỉnh đoàn phí (bảng bổ sung)

Bảng bổ sung: mỗi lần tạo/điều chỉnh/hủy ghi nhận đoàn phí có một dòng.

**Khóa và quan hệ:** dues_id → DUES.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `entry_id` | ID | Mã định danh (chuỗi) | Có |
| `dues_id` | ID ghi nhận | Mã định danh (chuỗi) | Có |
| `action` | Hành động | Danh mục (chuỗi) | Có |
| `old_due` | Phải thu cũ | Số nguyên |  |
| `new_due` | Phải thu mới | Số nguyên |  |
| `old_paid` | Đã thu cũ | Số nguyên |  |
| `new_paid` | Đã thu mới | Số nguyên |  |
| `reason` | Lý do | Chuỗi |  |
| `actor` | Người thực hiện | Chuỗi | Có |
| `at` | Thời gian | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |

## AUDIT_LOGS — Nhật ký thao tác

Chỉ ghi thêm. Không chứa OTP, token hay toàn bộ dữ liệu cá nhân.

**Khóa và quan hệ:** Chỉ ghi thêm.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `log_id` | ID | Mã định danh (chuỗi) | Có |
| `at` | Thời gian | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `actor` | Người thao tác | Chuỗi | Có |
| `action` | Hành động | Chuỗi | Có |
| `object_type` | Loại đối tượng | Chuỗi |  |
| `object_id` | ID đối tượng | Chuỗi |  |
| `result` | Kết quả (OK/DENIED/ERROR) | Danh mục (chuỗi) | Có |
| `request_id` | Mã thao tác | Chuỗi |  |
| `detail` | Chi tiết ngắn | Chuỗi |  |

## IMPORT_JOBS — Các lô nhập dữ liệu

Mỗi lô nhập CSV một dòng; report_json chứa lỗi theo dòng (không chứa dữ liệu cá nhân đầy đủ).

**Khóa và quan hệ:** request_id → OPERATIONS.request_id.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `job_id` | ID lô | Mã định danh (chuỗi) | Có |
| `request_id` | Mã thao tác | Mã định danh (chuỗi) | Có |
| `file_name` | Tên tệp | Chuỗi |  |
| `unit_id` | Đơn vị mặc định | Mã định danh (chuỗi) |  |
| `total_rows` | Tổng dòng | Số nguyên | Có |
| `ok_rows` | Dòng thành công | Số nguyên | Có |
| `error_rows` | Dòng lỗi | Số nguyên | Có |
| `status` | Trạng thái | Danh mục (chuỗi) | Có |
| `report_json` | Báo cáo (JSON) | Chuỗi JSON |  |
| `created_by` | Người nhập | Chuỗi | Có |
| `created_at` | Nhập lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |

## OPERATIONS — Nhật ký thao tác ghi (chống lặp và phục hồi)

request_id chống xử lý lặp. Dòng STARTED quá lâu là thao tác dở dang cần phục hồi.

**Khóa và quan hệ:** Duy nhất (actor_user_id, request_id).

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `op_id` | ID | Mã định danh (chuỗi) | Có |
| `request_id` | Mã thao tác (duy nhất theo người dùng) | Mã định danh (chuỗi) | Có |
| `actor_user_id` | ID người thực hiện | Mã định danh (chuỗi) | Có |
| `action` | Hành động | Chuỗi | Có |
| `status` | STARTED/DONE/FAILED/RECOVERED | Danh mục (chuỗi) | Có |
| `started_at` | Bắt đầu | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `finished_at` | Kết thúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) |  |
| `params_json` | Tham số phục hồi (JSON) | Chuỗi JSON |  |
| `result_json` | Kết quả (JSON) | Chuỗi JSON |  |
| `error` | Lỗi | Chuỗi |  |

## SESSIONS — Phiên đăng nhập (bảng bổ sung cho xác thực)

Chỉ lưu MÃ BĂM của token. Không bao giờ lưu token gốc.

**Khóa và quan hệ:** user_id → USERS. token_hash duy nhất.

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `session_id` | ID phiên | Mã định danh (chuỗi) | Có |
| `token_hash` | Mã băm token | Chuỗi | Có |
| `user_id` | ID người dùng | Mã định danh (chuỗi) | Có |
| `created_at` | Tạo lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `expires_at` | Hết hạn lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `last_seen_at` | Hoạt động gần nhất | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `revoked` | Đã thu hồi | TRUE/FALSE | Có |
| `revoked_reason` | Lý do thu hồi | Chuỗi |  |

## AUTH_OTP — Mã OTP đã phát (bảng bổ sung cho xác thực)

Chỉ lưu mã băm của OTP và của email. Tự dọn dẹp hằng ngày.

**Khóa và quan hệ:** email_hash là HMAC của email (không lưu email rõ).

| Mã trường | Tên tiếng Việt | Kiểu | Bắt buộc |
|---|---|---|---|
| `otp_id` | ID | Mã định danh (chuỗi) | Có |
| `email_hash` | Mã băm email | Chuỗi | Có |
| `otp_hash` | Mã băm OTP | Chuỗi | Có |
| `created_at` | Tạo lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `expires_at` | Hết hạn lúc | Ngày giờ (chuỗi yyyy-MM-ddTHH:mm:ss, giờ VN) | Có |
| `attempts` | Số lần nhập sai | Số nguyên | Có |
| `used` | Đã dùng/khóa | TRUE/FALSE | Có |

## SETTINGS — các tham số mặc định

| Mã | Giá trị mặc định | Ý nghĩa |
|---|---|---|
| `ORG_NAME` | Công đoàn (đổi tên trong SETTINGS) | Tên tổ chức hiển thị trên giao diện |
| `UNIT_LEVEL_NAMES` | Công đoàn cấp trên,Công đoàn cơ sở,Tổ công đoàn | Tên các cấp tổ chức, phân tách dấu phẩy, cấp 1 trước |
| `MEMBER_CODE_PREFIX` | DV | Tiền tố mã đoàn viên tự sinh khi để trống |
| `MEMBER_CODE_SEQ` | 0 | Số thứ tự mã đoàn viên tự sinh gần nhất (hệ thống tự tăng) |
| `ALLOW_ADMIN_SELF_APPROVE` | FALSE | TRUE: quản trị được tự duyệt yêu cầu của mình (có ghi nhật ký riêng) |
| `DUES_DEFAULT_AMOUNT` | (trống) | Mức phải thu gợi ý (VND). Để trống: người ghi nhận tự nhập. Hệ thống không tự áp mức pháp lý. |
| `BACKUP_KEEP` | 14 | Số bản sao lưu tự động giữ lại |
| `MEMBERS_WARN_LIMIT` | 8000 | Cảnh báo khi số hồ sơ vượt ngưỡng này |
| `LAST_BACKUP_AT` | (trống) | Thời điểm sao lưu gần nhất (hệ thống tự ghi) |
| `SCHEMA_VERSION` | 0 | Phiên bản cấu trúc dữ liệu (hệ thống tự ghi) |
