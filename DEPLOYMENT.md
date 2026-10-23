# Hướng dẫn triển khai (dành cho người không chuyên)

Thời gian ước tính: 45–60 phút. Không cần cài phần mềm nào trên máy tính — chỉ cần trình duyệt (Chrome/Edge/Firefox).

> **Quy ước:** tên nút/menu ghi bằng tiếng Việt như giao diện Google tiếng Việt, kèm tên tiếng Anh trong ngoặc nếu máy bạn dùng tiếng Anh.

## 0. Chuẩn bị

- **Một tài khoản Google dành riêng cho công đoàn** (ví dụ `congdoan.tenđơnvị@gmail.com` hoặc tài khoản Google Workspace của cơ quan). Tài khoản này sẽ là **chủ sở hữu** bảng tính, mã Apps Script, thư mục sao lưu và là địa chỉ gửi email mã đăng nhập. Không nên dùng tài khoản cá nhân của một cán bộ (khi người đó nghỉ việc sẽ khó bàn giao).
- **Một tài khoản GitHub** (miễn phí) để lưu mã nguồn và đăng trang truy cập.
- Tải toàn bộ thư mục mã nguồn này về máy (hoặc mở sẵn trên GitHub).

| Ai | Vai trò |
|---|---|
| Chủ sở hữu (tài khoản Google ở trên) | Sở hữu Google Sheets + Apps Script + thư mục sao lưu. Ứng dụng **chạy dưới danh tính tài khoản này**. Là người duy nhất được mở trực tiếp bảng tính. |
| Người vận hành | Người đăng nhập tài khoản chủ sở hữu để triển khai, cập nhật, sao lưu (có thể là cán bộ CNTT). |
| Người dùng (cán bộ, người duyệt, người xem) | Chỉ mở Web App và đăng nhập bằng mã OTP. **Không** được chia sẻ bảng tính. |

---

## 1. Tạo Google Sheets

1. Đăng nhập tài khoản chủ sở hữu, mở <https://sheets.google.com>.
2. Bấm **Trống (Blank)** để tạo bảng tính mới.
3. Đặt tên: `CSDL Quản lý đoàn viên` (bấm vào chữ "Bảng tính không có tiêu đề" ở góc trái trên).
4. **Không bấm "Chia sẻ"**. Bảng tính phải để riêng tư.

## 2. Tạo Apps Script

1. Trong bảng tính vừa tạo, chọn menu **Tiện ích mở rộng (Extensions) → Apps Script**.
2. Một thẻ mới mở ra. Bấm vào "Dự án không có tiêu đề" và đặt tên: `Quan ly doan vien`.
3. Bấm biểu tượng **bánh răng ⚙ Cài đặt dự án (Project Settings)** ở thanh bên trái → tích ô **"Hiển thị tệp kê khai appsscript.json trong trình chỉnh sửa"**. Kiểm tra **Múi giờ** là `(GMT+07:00) Hà Nội` / `Asia/Ho_Chi_Minh`.

## 3. Thêm mã nguồn

Chọn **một** trong hai cách (không làm cả hai — sẽ bị trùng hàm):

### Cách A — nhanh (khuyên dùng): dùng bản gộp trong thư mục `dist/`

1. Bấm biểu tượng **< > Trình chỉnh sửa (Editor)**. Mở tệp `Code.gs` có sẵn, **xóa hết** nội dung, dán toàn bộ nội dung tệp `dist/MaNguon.gs`. Có thể đổi tên tệp thành `MaNguon` (bấm ⋮ cạnh tên tệp → Đổi tên).
2. Mở tệp `appsscript.json`, xóa hết, dán nội dung `dist/appsscript.json`.
3. Tạo 3 tệp HTML: bấm **+** cạnh chữ "Tệp" → **HTML** → gõ tên **chính xác** (phân biệt hoa thường, không gõ đuôi `.html`):
   - `Index` → dán nội dung `dist/Index.html`
   - `Styles` → dán nội dung `dist/Styles.html`
   - `App` → dán nội dung `dist/App.html`
4. Bấm **💾 Lưu dự án** (hoặc Ctrl+S).

### Cách B — từng tệp

Tạo lần lượt các tệp `.gs` trong thư mục `apps-script/` (Config, Repository, Setup, Auth, Permissions, Audit, Members, Approvals, Transfers, Dues, ImportExport, Admin, Backup, Demo, Code) và 3 tệp HTML như cách A, rồi dán nội dung tương ứng. Thứ tự tệp không quan trọng.

## 4. Cấu hình Script Properties

1. Bấm **⚙ Cài đặt dự án** → kéo xuống **Thuộc tính tập lệnh (Script Properties)** → **Thêm thuộc tính tập lệnh**.
2. Thêm:

| Thuộc tính | Giá trị | Bắt buộc |
|---|---|---|
| `ADMIN_EMAIL` | Email của quản trị viên đầu tiên (người sẽ đăng nhập đầu tiên), viết thường | Có |

3. Bấm **Lưu thuộc tính tập lệnh**.

Các thuộc tính sau **hệ thống tự tạo**, không cần nhập, **không bao giờ đưa lên GitHub**:
`SPREADSHEET_ID` (mã bảng tính), `AUTH_PEPPER` (khóa bí mật dùng băm OTP/phiên), `BACKUP_FOLDER_ID` (thư mục sao lưu).

> Nếu `AUTH_PEPPER` bị xóa hoặc đổi, mọi phiên đăng nhập và mã OTP đang dùng sẽ mất hiệu lực (người dùng chỉ cần đăng nhập lại).

## 5. Chạy thiết lập

1. Quay lại **Trình chỉnh sửa**. Ở thanh trên, trong ô chọn hàm, chọn **`setupSystem`** → bấm **▶ Chạy (Run)**.
2. Lần đầu sẽ hiện hộp thoại cấp quyền — làm theo bước 7 rồi chạy lại nếu cần.
3. Xem **Nhật ký thực thi (Execution log)** ở dưới. Kết quả đúng có các dòng như:
   `Tạo sheet SETTINGS.` … `Đã cấp quyền quản trị cho …` … `Hoàn tất. Phiên bản cấu trúc: 1`.
4. Mở lại bảng tính: sẽ có các sheet `HUONG_DAN`, `SETTINGS`, `UNITS`, `USERS`, `MEMBERS`… Sheet `HUONG_DAN` giải thích từng cột bằng tiếng Việt.

`setupSystem` **chạy lại bao nhiêu lần cũng an toàn**: chỉ tạo sheet/cột/tham số còn thiếu, không xóa và không ghi đè dữ liệu.

## 6. Khai báo email quản trị đầu tiên

Đã làm ở bước 4 (`ADMIN_EMAIL`) và được tạo ở bước 5. Quy tắc an toàn:

- Hệ thống **chỉ** tạo quản trị từ `ADMIN_EMAIL` khi **chưa có** quản trị nào đang hoạt động — chạy lại setup không thể "chen" thêm quản trị.
- Quản trị viên tiếp theo được thêm trong phần mềm: **Quản trị → Người dùng & phân quyền**.
- Nếu lỡ khóa mất quản trị cuối cùng (phần mềm đã chặn trường hợp này): mở sheet `USERS`, sửa cột `status` của một quản trị về `active`, cột `is_admin` về `TRUE`.

## 7. Cấp các quyền cần thiết

Khi chạy `setupSystem` lần đầu, Google hỏi quyền:

1. Bấm **Xem lại quyền (Review permissions)** → chọn tài khoản chủ sở hữu.
2. Nếu thấy "Google chưa xác minh ứng dụng này" (bình thường với ứng dụng tự viết): bấm **Nâng cao (Advanced)** → **Đi tới Quan ly doan vien (không an toàn)**.
3. Bấm **Cho phép (Allow)**.

| Quyền | Dùng để |
|---|---|
| Xem, sửa bảng tính Google Sheets | Đọc/ghi dữ liệu |
| Xem, quản lý tệp Google Drive | Tạo bản sao lưu, khôi phục |
| Gửi email thay bạn | Gửi mã đăng nhập OTP |
| Quản lý trình kích hoạt | Lịch sao lưu hằng ngày |
| Xem địa chỉ email | Xác định chủ sở hữu khi chạy hàm quản trị từ trình chỉnh sửa |

**Cài sao lưu tự động hằng ngày (khuyến nghị):** chọn hàm **`installDailyBackup`** → **Chạy**. Lịch chạy khoảng 1 giờ sáng: sao lưu, xóa bản tự động quá cũ, dọn mã OTP/phiên hết hạn.

## 8. Triển khai Web App

1. Bấm nút **Triển khai (Deploy)** (góc phải trên) → **Tùy chọn triển khai mới (New deployment)**.
2. Bấm bánh răng cạnh "Chọn loại" → chọn **Ứng dụng web (Web app)**.
3. Điền:
   - **Nội dung mô tả:** `Phiên bản 1`
   - **Thực thi với tư cách (Execute as):** **Tôi** (email chủ sở hữu)
   - **Người có quyền truy cập (Who has access):** **Bất kỳ ai (Anyone)**
4. Bấm **Triển khai** → sao chép **URL ứng dụng web**, dạng `https://script.google.com/macros/s/AKfy…/exec`.

**Vì sao chọn như vậy?**

- *Thực thi với tư cách: Tôi* — mã chạy dưới quyền chủ sở hữu nên đọc/ghi được bảng tính riêng tư; người dùng **không cần** và **không được** chia sẻ bảng tính.
- *Bất kỳ ai* — người dùng không bắt buộc có tài khoản Google; ai có đường dẫn chỉ thấy **màn hình đăng nhập**. Muốn vào phải có email đã được quản trị khai báo **và** nhận được mã OTP trong hộp thư đó. Mọi dữ liệu đều được máy chủ kiểm tra phiên và quyền trước khi trả về.
- Nếu tất cả người dùng đều có tài khoản Google, có thể chọn *Bất kỳ ai có Tài khoản Google*; với Google Workspace có thể chọn *Bất kỳ ai trong <tên miền>* — vẫn phải đăng nhập OTP như trên.
- Người dùng tài khoản Google thường sẽ thấy dòng chữ của Google phía trên "Ứng dụng này do một người dùng Google Apps Script tạo" — đây là hành vi bắt buộc của Google, không phải lỗi.

## 9. Tạo repository GitHub

1. Đăng nhập <https://github.com> → bấm **+** (góc phải trên) → **New repository**.
2. **Repository name:** `quan-ly-doan-vien`. Chọn **Public** (GitHub Pages miễn phí yêu cầu repository công khai; mã nguồn không chứa bí mật hay dữ liệu thật nên công khai được. Dùng gói GitHub trả phí nếu muốn để Private).
3. Bấm **Create repository** → bấm liên kết **uploading an existing file** → kéo thả **toàn bộ nội dung** thư mục mã nguồn (các thư mục `docs`, `apps-script`, `dist`, `samples`, `tests`, `tools` và các tệp `.md`) → **Commit changes**.

**Kiểm tra trước khi tải lên:** không có tệp nào chứa email người dùng thật, dữ liệu đoàn viên thật, `AUTH_PEPPER` hay tệp xuất CSV thật.

## 10. Bật GitHub Pages

1. Trong repository: **Settings → Pages**.
2. **Build and deployment → Source:** `Deploy from a branch`.
3. **Branch:** `main`, thư mục **`/docs`** → **Save**.
4. Đợi 1–3 phút, tải lại trang Settings → Pages sẽ hiện địa chỉ, dạng `https://<tên-tài-khoản>.github.io/quan-ly-doan-vien/`.

Trang dùng **đường dẫn tương đối** (`./style.css`, `./config.js`) nên chạy đúng dưới thư mục con `/quan-ly-doan-vien/` (đã kiểm thử).

## 11. Cấu hình địa chỉ phần mềm cho trang GitHub Pages

1. Trong repository, mở `docs/config.js` → bấm biểu tượng **bút chì (Edit)**.
2. Dán URL Web App ở bước 8 vào `webAppUrl`, sửa `orgName` thành tên công đoàn:

```js
window.APP_CONFIG = {
  webAppUrl: 'https://script.google.com/macros/s/AKfy…/exec',
  orgName: 'Công đoàn cơ sở …',
  guideUrl: 'https://github.com/<tên-tài-khoản>/quan-ly-doan-vien/blob/main/USER_GUIDE.md'
};
```

3. **Commit changes**. Sau 1–2 phút, trang truy cập sẽ có nút "Mở phần mềm quản lý đoàn viên" hoạt động. Trang chỉ chấp nhận địa chỉ dạng `https://script.google.com/.../exec` (chống cấu hình nhầm sang trang giả mạo).

## 12. Thử đăng nhập và tạo hồ sơ

1. Mở trang GitHub Pages → bấm **Mở phần mềm quản lý đoàn viên**.
2. Nhập `ADMIN_EMAIL` → **Gửi mã đăng nhập** → mở hộp thư lấy mã 6 số → **Đăng nhập**.
3. **Quản trị → Đơn vị:** bấm vào "Đơn vị gốc…" để đổi tên/mã; thêm các đơn vị cấp dưới.
4. **Quản trị → Cấu hình:** sửa `ORG_NAME`, `UNIT_LEVEL_NAMES` (tên các cấp, cách nhau dấu phẩy).
5. **Quản trị → Người dùng & phân quyền:** thêm ít nhất một **Cán bộ đơn vị** và một **Người phê duyệt** (người khác nhau), cấp đơn vị cho từng người.
6. Đăng nhập bằng email cán bộ (trình duyệt khác hoặc cửa sổ ẩn danh) → **Đoàn viên → + Thêm đoàn viên** → **Gửi duyệt**.
7. Đăng nhập bằng email người phê duyệt → **Chờ phê duyệt** → mở yêu cầu → **Duyệt**. Hồ sơ xuất hiện trong danh sách.
8. Làm tiếp danh sách nghiệm thu trong [TEST_REPORT.md](TEST_REPORT.md) mục 5.

> Mặc định người lập **không tự duyệt** được yêu cầu của mình (kể cả quản trị). Nếu đơn vị chỉ có một người, quản trị có thể đặt `ALLOW_ADMIN_SELF_APPROVE = TRUE` trong Quản trị → Cấu hình; mọi lần tự duyệt được ghi nhật ký riêng.

## 13. Cập nhật phiên bản

1. **Sao lưu trước:** Quản trị → Sao lưu → **Sao lưu ngay**.
2. Thay mã trong Apps Script bằng mã mới (cách A hoặc B ở bước 3), **Lưu**.
3. Chạy lại **`setupSystem`** (an toàn — chỉ thêm cột/sheet mới nếu có, nâng `SCHEMA_VERSION`).
4. **Triển khai → Quản lý các bản triển khai (Manage deployments)** → chọn bản đang dùng → **bút chì ✎** → **Phiên bản: Phiên bản mới (New version)** → **Triển khai**. **Địa chỉ Web App giữ nguyên**, không phải sửa `docs/config.js`.
   (Không chọn "Tùy chọn triển khai mới" — cách đó tạo địa chỉ mới.)
5. Cập nhật mã trên GitHub (Add file → Upload files, ghi đè tệp cũ).
6. Người dùng tải lại trang phần mềm.

## 14. Sao lưu và khôi phục

**Sao lưu**

- Tự động: đã cài ở bước 7 (`installDailyBackup`). Giữ số bản theo tham số `BACKUP_KEEP` (mặc định 14); bản cũ hơn chuyển vào Thùng rác Drive (khôi phục được trong 30 ngày).
- Thủ công: Quản trị → Sao lưu → **Sao lưu ngay**.
- Bản sao lưu nằm trong thư mục Drive **"Sao lưu - Quản lý đoàn viên (KHÔNG chia sẻ)"** của chủ sở hữu. Không chia sẻ thư mục này.
- Bản sao lưu là bản sao nguyên bảng tính; Google cũng sao chép kèm một bản mã Apps Script gắn với bảng tính đó (không có bản triển khai Web App, không tự chạy) — đây là hành vi bình thường của Google Drive.

**Khôi phục (khi dữ liệu bị nhập sai, xóa nhầm…)**

- Trong phần mềm: Quản trị → Sao lưu → chọn bản → **Khôi phục…** → gõ `KHOI PHUC` → **Khôi phục**. Hệ thống: (1) kiểm tra cấu trúc bản sao lưu, (2) **tự tạo bản sao hiện trạng** (tên có `pre-restore`) để quay lại được, (3) chép dữ liệu. Phiên đăng nhập và mã OTP hiện tại được giữ nguyên.
- Từ trình chỉnh sửa (khi không vào được phần mềm): mở bản sao lưu trên Drive, sao chép mã tệp trong địa chỉ (`…/spreadsheets/d/<MÃ>/edit`) → thêm Script Property `RESTORE_FILE_ID = <MÃ>` → chạy hàm **`restoreFromScriptProperty`**.
- Lưu ý: khôi phục cả sheet `USERS`/`USER_SCOPES` — người dùng/quyền được thêm sau thời điểm sao lưu sẽ mất.

**Khi bảng tính chính bị mất hoặc hỏng hẳn:** mở một bản sao lưu → **Tệp → Tạo bản sao** (đặt tên mới) → lấy mã tệp của bản sao mới → trong Apps Script đang chạy, sửa Script Property `SPREADSHEET_ID` thành mã đó → chạy `setupSystem`. Web App giữ nguyên địa chỉ.

## Phụ lục A — Hạn mức gửi email (mã đăng nhập)

| Loại tài khoản chủ sở hữu | Số người nhận email / ngày |
|---|---|
| Gmail thường | 100 |
| Google Workspace | 1.500 |

Mỗi lần đăng nhập tốn 1 email. Hệ thống đã giới hạn: tối đa 3 lần gửi mã / email / 15 phút và 60 lần / giờ cho toàn hệ thống. Khi hết hạn mức trong ngày, người dùng thấy thông báo "Hệ thống đã hết lượt gửi email trong hôm nay…", quản trị thấy cảnh báo trên Tổng quan khi còn dưới 10 lượt. Cách xử lý: đợi hạn mức đặt lại (24 giờ sau lần gửi đầu tiên), hoặc dùng tài khoản Google Workspace làm chủ sở hữu. Phiên đăng nhập kéo dài 8 giờ nên mỗi người thường chỉ cần 1–2 email/ngày.

## Phụ lục B — Môi trường thử nghiệm với dữ liệu giả lập

Không chạy dữ liệu demo trên bảng tính thật. Làm như sau:

1. Lặp lại bước 1–7 với **một bảng tính khác** (tên `THU NGHIEM - Quản lý đoàn viên`).
2. Thêm Script Property `DEMO_MODE = TRUE` → chạy hàm **`seedDemoData`**: tạo 6 đơn vị `[DEMO]` (mã `DEMO-…`) và 500 hồ sơ `[DEMO]`.
3. Hoặc dùng tệp `samples/du-lieu-thu-demo.csv` (60 dòng) và `samples/du-lieu-thu-co-loi.csv` (có lỗi cố ý) để thử chức năng nhập.

## Phụ lục C — Xử lý sự cố thường gặp

| Hiện tượng | Cách khắc phục |
|---|---|
| Nhật ký setup báo "CHƯA có quản trị viên" | Thêm `ADMIN_EMAIL` (bước 4) rồi chạy lại `setupSystem`. |
| "Hàm này chỉ được chạy bởi chủ sở hữu từ trình soạn thảo" | Đăng nhập đúng tài khoản chủ sở hữu khi mở Apps Script. |
| Mở Web App báo lỗi không tìm thấy tệp HTML (vd "No HTML file named Styles") | Kiểm tra đã tạo đủ 3 tệp HTML tên đúng `Index`, `Styles`, `App`. |
| Không nhận được mã | Kiểm tra Spam; kiểm tra email đã được khai báo và trạng thái "Hoạt động"; xem Quản trị → Vận hành → hạn mức email. |
| "Hệ thống đang bận…" | Có thao tác ghi khác đang chạy; đợi vài giây rồi bấm lại (không bị ghi trùng). |
| Tổng quan báo "thao tác bị gián đoạn" | Quản trị → Vận hành & nhật ký → **Phục hồi thao tác dở dang**. |
| Lỗi có "mã XXXXXXXX" | Apps Script → **Lần thực thi (Executions)**, tìm mã đó để xem chi tiết kỹ thuật. |
