# Phần mềm quản lý đoàn viên công đoàn

Ứng dụng web tiếng Việt giúp cán bộ công đoàn quản lý hồ sơ đoàn viên, phê duyệt thay đổi, chuyển sinh hoạt giữa các đơn vị, ghi nhận đoàn phí, nhập/xuất danh sách và báo cáo — phân quyền theo cây đơn vị.

Chi phí vận hành: **0 đồng** (Google Sheets + Google Apps Script + GitHub Pages). Không cần VPS, máy chủ riêng, Node.js hay cơ sở dữ liệu trả phí.

## Kiến trúc (đã chọn và lý do)

```
 Người dùng ──► GitHub Pages (docs/)            Trang truy cập tĩnh: giới thiệu + nút lớn
                 "Mở phần mềm quản lý đoàn viên"   KHÔNG chứa dữ liệu, KHÔNG gọi máy chủ
                        │ (mở trang riêng)
                        ▼
              Google Apps Script Web App          Giao diện nghiệp vụ (HTML Service: Index/Styles/App.html)
              doGet() + api() ◄── google.script.run   Kiểm tra phiên + quyền ở MỌI lần gọi
                        │
          ┌─────────────┼───────────────┐
          ▼             ▼               ▼
   Google Sheets   Gmail (MailApp)   Google Drive
   (dữ liệu,       gửi mã OTP         thư mục sao lưu riêng
   riêng tư)
```

**Phần nào chạy ở đâu**

| Thành phần | Chạy trên | Ghi chú |
|---|---|---|
| `docs/` (trang truy cập) | GitHub Pages | Chỉ HTML/CSS/JS tĩnh; cấu hình công khai duy nhất là địa chỉ Web App trong `docs/config.js` |
| Giao diện nghiệp vụ (`apps-script/*.html`) | Apps Script HTML Service | Mở ở trang riêng `https://script.google.com/macros/s/…/exec` |
| Xử lý nghiệp vụ (`apps-script/*.gs`) | Apps Script (máy chủ Google) | Chạy dưới danh tính chủ sở hữu |
| Dữ liệu | Google Sheets riêng tư của chủ sở hữu | Không chia sẻ công khai |
| Sao lưu | Thư mục Google Drive riêng | Không chia sẻ công khai |
| Mã nguồn | GitHub | Không chứa bí mật hay dữ liệu thật |

**Vì sao không gọi trực tiếp Apps Script từ trang GitHub Pages?** Đặc tả cho phép chọn phương án này nếu không có giải pháp trực tiếp đáng tin cậy. Đánh giá:

- Web App trả JSON qua `ContentService` thông qua một bước chuyển hướng (redirect) sang `script.googleusercontent.com`; Apps Script không cho tự đặt header CORS, không có `doOptions` để trả lời preflight, nên chỉ dùng được "simple request" (`Content-Type: text/plain`, không header tùy chỉnh) và phải nhét token vào thân yêu cầu.
- Cách đó có thể hoạt động, nhưng **chưa được kiểm chứng trên tài khoản Google thật trong quá trình xây dựng** (môi trường phát triển không có quyền truy cập Google), và phụ thuộc hành vi chuyển hướng/cookie của từng trình duyệt — trái với yêu cầu "chọn phương án đơn giản nhất đã được kiểm chứng".
- `mode: "no-cors"` không đọc được phản hồi; JSONP không an toàn cho dữ liệu cá nhân; proxy bên ngoài bị loại trừ.

→ Chọn **phương án dự phòng trong đặc tả**: GitHub Pages là trang truy cập có nút lớn mở Web App; toàn bộ giao diện nghiệp vụ do HTML Service phục vụ và gọi máy chủ bằng `google.script.run` (cùng nguồn gốc, không có vấn đề CORS/preflight/redirect). Phần mềm **không** tuyên bố chạy hoàn toàn trên GitHub Pages.

## Tính năng

- **Đăng nhập bằng mã OTP qua email** (không mật khẩu): chỉ email được quản trị khai báo; mã 6 số, hết hạn 5 phút, dùng 1 lần, tối đa 5 lần sai; giới hạn tần suất theo email và toàn hệ thống; phiên 8 giờ, hết hạn sau 60 phút không thao tác; khóa tài khoản có hiệu lực ngay.
- **Phân quyền theo cây đơn vị** (cấu hình được tên và số cấp): Quản trị hệ thống, Cán bộ đơn vị, Người phê duyệt, Người xem; một người nhiều đơn vị; kiểm tra hoàn toàn phía máy chủ.
- **Hồ sơ đoàn viên**: thêm, xem, sửa qua phê duyệt, lưu trữ thay cho xóa; tìm theo tên (không dấu), mã, điện thoại, giấy tờ; lọc, sắp xếp, phân trang phía máy chủ; che trường nhạy cảm với Người xem.
- **Phê duyệt**: Nháp → Chờ duyệt → Đã duyệt / Trả lại (bắt buộc lý do) / Đã hủy; so sánh giá trị cũ–mới; chống duyệt lặp; không tự duyệt (ngoại lệ quản trị cấu hình được, có nhật ký); duyệt hàng loạt.
- **Chuyển sinh hoạt**: đơn vị đi lập → đơn vị đến xác nhận/từ chối; giữ mã đoàn viên; lịch sử đơn vị đầy đủ.
- **Đoàn phí**: ghi nhận theo cá nhân hoặc cả danh sách; chống ghi trùng; điều chỉnh có lý do và lịch sử; thống kê phải thu/đã thu/còn thiếu; xuất CSV.
- **Nhập CSV UTF-8** có ghép cột, xem trước lỗi theo dòng, máy chủ kiểm tra lại, đi qua quy trình duyệt; **xuất CSV** đúng phạm vi quyền, chống chèn công thức.
- **Nhật ký thao tác**, **chống xử lý lặp** (request_id), **phục hồi thao tác dở dang**, **sao lưu/khôi phục** có kiểm soát.

## Cấu trúc mã nguồn

```
docs/                 Trang GitHub Pages (index.html, style.css, config.js)
apps-script/          Mã Apps Script — dán vào dự án Apps Script
  appsscript.json     Cấu hình dự án (múi giờ, quyền, Web App)
  Code.gs             doGet() + api(): điểm vào duy nhất, bảng hành động
  Config.gs           Hằng số, SCHEMA các sheet, nhãn tiếng Việt
  Setup.gs            setupSystem(): tạo/nâng cấp sheet không mất dữ liệu
  Repository.gs       Đọc/ghi Sheets theo lô, tiện ích, khóa
  Auth.gs             OTP, phiên đăng nhập
  Permissions.gs      Phân quyền theo đơn vị
  Members.gs          Tra cứu, kiểm tra dữ liệu hồ sơ
  Approvals.gs        Yêu cầu thay đổi + phê duyệt
  Transfers.gs        Chuyển sinh hoạt
  Dues.gs             Đoàn phí
  ImportExport.gs     Nhập/xuất CSV, báo cáo, tổng quan
  Admin.gs            Quản trị đơn vị, người dùng, cấu hình
  Audit.gs            Nhật ký, chống lặp, phục hồi
  Backup.gs           Sao lưu/khôi phục, tác vụ hằng ngày
  Demo.gs             Nạp dữ liệu giả lập (chỉ khi DEMO_MODE=TRUE)
  Index.html, Styles.html, App.html   Giao diện HTML Service
dist/                 Bản gộp tự sinh: MaNguon.gs + 3 tệp HTML (cách dán nhanh)
samples/              Tệp CSV mẫu và dữ liệu giả lập
tests/                Kiểm thử nghiệp vụ (giả lập Apps Script) + kiểm thử giao diện (Chromium)
tools/build.js        Sinh dist/, DATA_DICTIONARY.md, samples/ (dành cho người phát triển)
```

## Tài liệu

| Tệp | Nội dung |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Hướng dẫn triển khai từng bước cho người không chuyên |
| [USER_GUIDE.md](USER_GUIDE.md) | Hướng dẫn sử dụng theo vai trò |
| [DATA_DICTIONARY.md](DATA_DICTIONARY.md) | Cấu trúc Google Sheets, kiểu dữ liệu, khóa, quan hệ |
| [SECURITY.md](SECURITY.md) | Danh tính chạy ứng dụng, quyền truy cập, biện pháp bảo mật, rủi ro còn lại |
| [TEST_REPORT.md](TEST_REPORT.md) | Đã kiểm tra gì, kết quả, môi trường, phần chưa xác minh |

## Cấu hình: phần nào ở đâu

| Cấu hình | Nơi lưu | Đưa lên GitHub? |
|---|---|---|
| `webAppUrl`, tên tổ chức hiển thị ở trang truy cập | `docs/config.js` | Có (thông tin công khai) |
| `ADMIN_EMAIL`, `AUTH_PEPPER`, `SPREADSHEET_ID`, `BACKUP_FOLDER_ID`, `DEMO_MODE`, `RESTORE_FILE_ID` | Script Properties của Apps Script | **Không** |
| Tham số nghiệp vụ (tên tổ chức, tên cấp, tiền tố mã, mức đoàn phí gợi ý, số bản sao lưu…) | Sheet `SETTINGS` (sửa trong mục Quản trị) | **Không** |
| Dữ liệu đoàn viên, người dùng, nhật ký | Google Sheets | **Không** |

## Kiểm thử (dành cho người phát triển)

```bash
node tests/run-tests.js                 # 21 nhóm / 214 điểm kiểm tra nghiệp vụ trên giả lập Apps Script
NODE_PATH=<đường dẫn playwright> node tests/ui-test.js   # 35 kiểm tra giao diện trên Chromium
node tools/build.js                     # sinh lại dist/, DATA_DICTIONARY.md, samples/
```

Kết quả và giới hạn của kiểm thử: xem [TEST_REPORT.md](TEST_REPORT.md). **Chưa có lần chạy trên tài khoản Google thật** — các bước nghiệm thu sau triển khai nằm trong TEST_REPORT.md mục 5.
