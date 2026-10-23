# Bảo mật

## 1. Danh tính và quyền truy cập

| Câu hỏi | Trả lời |
|---|---|
| Ai sở hữu Apps Script? | Tài khoản Google chủ sở hữu tạo bảng tính (dự án Apps Script gắn với bảng tính). Khuyến nghị dùng tài khoản riêng của tổ chức. |
| Ứng dụng chạy dưới danh tính nào? | **Chủ sở hữu** (`Execute as: Me`). Mọi lần đọc/ghi Sheets, gửi email, tạo bản sao lưu đều dưới tài khoản này. Vì vậy mọi kiểm tra quyền được làm trong mã, ở hàm `api()` của mỗi lần gọi. |
| Ai có thể mở Web App? | Bất kỳ ai có đường dẫn (`Who has access: Anyone`) — nhưng chỉ thấy màn hình đăng nhập. Không có dữ liệu nào trả về khi chưa có phiên hợp lệ. |
| Ai đăng nhập được? | Chỉ email có trong sheet `USERS` với `status = active` **và** nhận được mã OTP gửi tới hộp thư đó. |
| Ai mở trực tiếp được Google Sheets? | Chỉ chủ sở hữu (và người được chủ sở hữu tự chia sẻ — **không khuyến nghị**). Không bao giờ chia sẻ công khai. Người dùng phần mềm không cần quyền trên bảng tính. |
| Thư mục sao lưu? | Trong Drive chủ sở hữu, không chia sẻ; mã không bao giờ thay đổi quyền chia sẻ tệp. |
| Có dựa vào `Session.getActiveUser()` để đăng nhập không? | **Không.** Với Web App chạy dưới quyền chủ sở hữu, hàm này thường trả về chuỗi rỗng cho người dùng khác. Nó chỉ được dùng để **chặn** các hàm vận hành (`setupSystem`, `installDailyBackup`, `restoreFromScriptProperty`…) khi không ở ngữ cảnh chủ sở hữu: kết quả rỗng hoặc khác chủ sở hữu → từ chối. |

## 2. Đăng nhập OTP và phiên

- OTP 6 chữ số sinh từ `Utilities.getUuid()` (dựa trên bộ sinh số ngẫu nhiên an toàn của Java), **không dùng `Math.random`**.
- Chỉ lưu `HMAC-SHA256(otp_id:otp)` với khóa bí mật `AUTH_PEPPER` (Script Properties, 256 bit). Email trong bảng OTP cũng chỉ lưu dạng HMAC.
- Hết hạn 5 phút, dùng 1 lần, tối đa 5 lần sai/mã; xin mã mới làm vô hiệu mã cũ.
- Giới hạn tần suất: 3 lần gửi/email/15 phút (áp dụng cả email không tồn tại), 60 lần/giờ toàn hệ thống; kiểm tra hạn mức Gmail **trước** khi tra email.
- Thông báo công khai giống nhau dù email có được cấp quyền hay không.
- Token phiên 256 bit (`randomHex_(64)`), chỉ lưu HMAC trong sheet `SESSIONS`. Phiên tối đa 8 giờ, hết hạn sau 60 phút không hoạt động, **xác minh lại ở mọi lần gọi** (đọc `SESSIONS` + `USERS` mỗi lần) nên khóa tài khoản / thu hồi phiên / thu hồi phạm vi có hiệu lực ngay.
- Token chỉ giữ trong `sessionStorage` của khung ứng dụng (mất khi đóng thẻ), không dùng `localStorage`, không đặt trong URL, không ghi nhật ký.

## 3. Phân quyền

- Hàm công khai duy nhất: `api(req)` (cộng `doGet`). Mọi hàm nội bộ kết thúc bằng `_` nên `google.script.run` không gọi được. Các hàm vận hành không có `_` đều tự kiểm tra ngữ cảnh chủ sở hữu hoặc tự giới hạn (`runScheduledMaintenance` chỉ chạy nếu chưa sao lưu trong 20 giờ).
- Quyền tính từ `USER_SCOPES` ở máy chủ theo cây đơn vị; **không** tin `role`, `email`, `unit_id`, `is_admin` do trình duyệt gửi. Đơn vị đi của yêu cầu chuyển, đơn vị của hồ sơ khi sửa/duyệt… đều lấy từ dữ liệu máy chủ.
- Danh sách, tìm kiếm, xuất CSV, báo cáo đều **lọc phía máy chủ trước khi trả về**; phân trang phía máy chủ.
- Người xem: số giấy tờ, địa chỉ, ngày sinh bị che; không tra cứu theo số giấy tờ.
- Truy cập trái phép được ghi `AUDIT_LOGS` với `result = DENIED`.

## 4. Toàn vẹn dữ liệu

- Google Sheets **không có giao dịch**; `LockService` chỉ tuần tự hóa các thao tác ghi, **không** tạo giao dịch nguyên tử.
- Mọi thao tác ghi: lấy khóa script → đọc lại dữ liệu mới nhất → kiểm tra hợp lệ **trước** khi ghi → ghi theo lô. Không gửi email hay gọi Drive khi đang giữ khóa lâu.
- `request_id` (sinh ở trình duyệt bằng `crypto.getRandomValues`) + sheet `OPERATIONS` chống xử lý lặp và chống phát lại: cùng người + cùng `request_id` đã xong → trả lại kết quả cũ.
- `version` trên hồ sơ, yêu cầu, đoàn phí, đơn vị, người dùng để phát hiện chỉnh sửa đồng thời.
- Thao tác nhiều bước (duyệt yêu cầu, hoàn tất chuyển sinh hoạt) lưu tham số vào `OPERATIONS` trước khi ghi; các bước **lũy đẳng** (dựa trên `last_ref`, `ref_id`) nên **Phục hồi thao tác dở dang** chạy lại an toàn, không tạo trùng.
- `updateRow_` kiểm tra lại khóa chính ở vị trí dòng trước khi ghi (phòng trường hợp ai đó chèn/xóa dòng trực tiếp trên sheet).

## 5. Chống XSS, chèn công thức, CSRF

- Giao diện dựng DOM bằng `createElement` + `textContent`; **không dùng `innerHTML` với dữ liệu** (kiểm thử trên Chromium với ghi chú chứa `<img onerror>`, `<script>`, `<svg onload>`: không thực thi).
- Họ tên không được chứa `< > { } =`.
- Mọi chuỗi ghi vào Sheets có tiền tố `'` → luôn là văn bản, giữ số 0 đầu, không thành công thức.
- Xuất CSV: ô bắt đầu bằng `= + - @ tab CR` được thêm `'` (chống CSV/formula injection).
- Web App đặt `XFrameOptionsMode.DEFAULT` (trang khác không nhúng được — chống clickjacking).
- Không dùng cookie cho phiên; token gửi tường minh trong mỗi lời gọi `google.script.run` → không có bề mặt CSRF kiểu cookie. Phát lại được chặn bởi `request_id` và thời hạn phiên.

## 6. Nhật ký và dữ liệu cá nhân

- `AUDIT_LOGS`: người thao tác, thời gian, hành động, đối tượng (ID), kết quả, mã thao tác, mô tả ngắn. **Không** ghi OTP, token, số giấy tờ, địa chỉ hay toàn bộ hồ sơ.
- Log kỹ thuật (`console.error`) chỉ ghi mã tham chiếu, tên hành động và thông điệp lỗi — không ghi payload.
- Mã nguồn và dữ liệu mẫu không chứa dữ liệu thật; dữ liệu giả lập có nhãn `[DEMO]`, chỉ nạp khi `DEMO_MODE=TRUE` và bảng tính trống.

## 7. Bí mật

| Bí mật | Nơi lưu | Không bao giờ ở |
|---|---|---|
| `AUTH_PEPPER` | Script Properties | GitHub, mã frontend, URL, Sheets |
| Token phiên | `sessionStorage` của người dùng; máy chủ chỉ giữ HMAC | URL, nhật ký |
| OTP | Email người dùng; máy chủ chỉ giữ HMAC | Nhật ký, Sheets dạng rõ |

Trang GitHub Pages và mã giao diện **không chứa bí mật** nào; `docs/config.js` chỉ có địa chỉ Web App (vốn công khai).

## 8. Rủi ro còn lại và khuyến nghị

1. **Bảo mật hộp thư = bảo mật tài khoản.** Ai chiếm được hộp thư sẽ đăng nhập được. Khuyến nghị người dùng bật xác minh 2 bước cho email.
2. **Tài khoản chủ sở hữu là điểm tập trung rủi ro**: bật xác minh 2 bước, hạn chế người biết mật khẩu, không cài tiện ích lạ.
3. **Người mở trực tiếp bảng tính bỏ qua mọi kiểm tra của phần mềm.** Bảo vệ sheet chỉ ở mức cảnh báo cho chủ sở hữu; không chia sẻ bảng tính.
4. **Bộ đếm tần suất dùng CacheService** (có thể bị Google xóa sớm) — giới hạn 5 lần sai/mã và mã 5 phút vẫn luôn áp dụng vì lưu trong Sheets.
5. **Hạn mức Gmail** (100/ngày với tài khoản thường) có thể bị cạn nếu bị lạm dụng gửi mã → người dùng hợp lệ tạm không đăng nhập được trong ngày. Giới hạn 60 lần/giờ giảm thiểu nhưng không loại trừ hoàn toàn.
6. **sessionStorage** đọc được bởi mã chạy cùng nguồn gốc nếu có lỗ hổng XSS — đã giảm thiểu bằng việc không dùng `innerHTML` với dữ liệu.
7. Phần mềm chưa được kiểm thử xâm nhập độc lập và **chưa chạy trên hạ tầng Google thật trong quá trình xây dựng** — xem TEST_REPORT.md.
8. Tuân thủ quy định bảo vệ dữ liệu cá nhân (Luật Bảo vệ dữ liệu cá nhân 2025, có hiệu lực từ 01/01/2026, và Nghị định 356/2025/NĐ-CP hướng dẫn — đơn vị cần tự kiểm tra văn bản hiện hành): đơn vị vận hành cần tự đánh giá, thông báo mục đích xử lý dữ liệu cho đoàn viên, giới hạn người được cấp quyền, và xác định thời hạn lưu trữ hồ sơ đã lưu trữ. Phần mềm không tự đánh giá tuân thủ pháp lý.
