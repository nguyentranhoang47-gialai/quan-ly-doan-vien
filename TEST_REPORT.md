# Báo cáo kiểm thử

Ngày chạy: 23/10/2026. Người thực hiện: nhóm phát triển (tự động).

## 1. Tóm tắt

| Bộ kiểm thử | Môi trường | Kết quả |
|---|---|---|
| Nghiệp vụ máy chủ (`tests/run-tests.js`) | Node.js v22.22.0 + **giả lập** Apps Script (`tests/gas-mock.js`), chạy **mã .gs thật** | **21/21 nhóm, 214/214 điểm kiểm tra đạt** |
| Giao diện (`tests/ui-test.js`) | Chromium 153 (Playwright), giao diện HTML **thật**, `google.script.run` nối tới máy chủ giả lập; điện thoại 375×812 và 390×844, máy tính 1366×860; múi giờ trình duyệt `America/Los_Angeles` (cố ý khác Việt Nam) | **35/35 kiểm tra đạt**, không có lỗi JavaScript |
| Trên tài khoản Google thật (Apps Script, Sheets, Gmail, Drive) | — | **CHƯA CHẠY** — môi trường phát triển không có quyền truy cập tài khoản Google. Xem mục 5. |

> **Không tuyên bố triển khai thành công.** Kết quả trên chứng minh logic nghiệp vụ, phân quyền và giao diện đúng **trên mô phỏng**. Hành vi trên hạ tầng Google thật cần được xác nhận bằng danh sách nghiệm thu ở mục 5.

Ảnh chụp giao diện: `tests/screenshots/` (00–11). Kết quả chi tiết dạng máy đọc: `tests/test-results.json`, `tests/ui-results.json`.

## 2. Giả lập mô phỏng những gì

`tests/gas-mock.js` mô phỏng `SpreadsheetApp`, `PropertiesService`, `CacheService`, `LockService`, `MailApp`, `Session`, `Utilities` (HMAC, UUID, formatDate theo múi giờ), `DriveApp`, kèm các đặc điểm quan trọng của Sheets:

- chuỗi có tiền tố `'` lưu dạng văn bản; chuỗi bắt đầu `=` **bị biến thành công thức**; chuỗi dạng số trong cột không định dạng văn bản **bị đổi sang số (mất số 0 đầu)** — để kiểm thử thật sự phát hiện lỗi chèn công thức và mất số 0;
- mỗi lời gọi API là một lần thực thi mới (xóa bộ đệm trong bộ nhớ) như `google.script.run`;
- đồng hồ có thể tua nhanh để kiểm tra hết hạn OTP/phiên/thao tác dở dang;
- tệp `.gs` nạp theo thứ tự chữ cái (Config.gs không đứng đầu) để chắc chắn mã không phụ thuộc thứ tự tệp trong dự án Apps Script.

**Không mô phỏng:** độ trễ mạng/Sheets thật, tranh chấp khóa giữa nhiều tiến trình đồng thời, hạn mức Google, HTML Service iframe/sandbox, gửi email thật, quyền OAuth.

## 3. Kết quả theo yêu cầu nghiệm thu (đặc tả mục 15)

| Yêu cầu | Kiểm tra | Kết quả |
|---|---|---|
| Email chưa được cấp quyền không đăng nhập được | Không gửi mail, thông báo giống hệt email hợp lệ, xác minh bị từ chối | Đạt (giả lập) |
| OTP sai, hết hạn, dùng lại bị từ chối | Sai mã; quá 5 phút; dùng lại; 5 lần sai khóa mã; mã cũ vô hiệu khi xin mã mới; OTP/token không xuất hiện trong nhật ký; chỉ lưu mã băm | Đạt (giả lập) |
| Tài khoản bị khóa không tiếp tục thao tác | Khóa → phiên đang mở bị từ chối ngay; không nhận mã mới; thu hồi phạm vi có hiệu lực ngay; giao diện tự về màn hình đăng nhập | Đạt (giả lập + Chromium) |
| Đơn vị A không đọc/sửa dữ liệu B khi đổi ID | Xem chi tiết, lọc, tìm, tạo, sửa, duyệt, xem yêu cầu, ghi đoàn phí, chuyển sinh hoạt, xuất CSV bằng ID của B → đều bị chặn; ghi DENIED vào nhật ký; payload giả `role/is_admin/email` không có tác dụng | Đạt (giả lập) |
| Người xem không ghi được dữ liệu | Không tạo/lưu trữ/chuyển/ghi phí/nhập CSV; trường nhạy cảm bị che cả khi xem và khi xuất | Đạt (giả lập + Chromium) |
| Sửa chưa duyệt không đổi dữ liệu chính thức | Nháp và chờ duyệt không đổi `MEMBERS`; sau duyệt mới đổi và tăng `version` | Đạt (giả lập) |
| Không duyệt hai lần | Lần 2 bị CONFLICT; tự duyệt bị chặn mặc định; bật cấu hình thì được và có nhật ký `SELF_APPROVE` | Đạt (giả lập) |
| Hai người sửa cùng hồ sơ nhận cảnh báo | Người thứ hai bị chặn khi đã có yêu cầu chờ; biểu mẫu mở từ phiên bản cũ bị chặn sau khi bản kia được duyệt; không ghi đè | Đạt (giả lập) |
| Gửi lại cùng request_id không tạo trùng | Lưu yêu cầu, duyệt, ghi đoàn phí, nhập CSV gửi lặp → 1 bản ghi; dùng lại request_id cho hành động khác bị từ chối; bấm nút 2 lần trên giao diện → 1 yêu cầu | Đạt (giả lập + Chromium) |
| Chuyển sinh hoạt không mất lịch sử | Giữ mã; lịch sử JOIN → TRANSFER_OUT → TRANSFER_IN; đổi quyền xem theo đơn vị mới; chặn chuyển về chính đơn vị, đơn vị ngừng hoạt động, 2 yêu cầu song song; từ chối/hủy đúng quyền | Đạt (giả lập) |
| Lỗi giữa chừng phát hiện và phục hồi được | Chèn lỗi sau bước ghi hồ sơ (duyệt) và sau bước đổi đơn vị (chuyển) → thao tác ở trạng thái STARTED, Tổng quan cảnh báo; "Phục hồi" hoàn tất, không trùng hồ sơ/lịch sử; chạy lại không còn gì | Đạt (giả lập) |
| Nhập CSV giữ số 0 đầu | Giá trị lưu trong Sheets giả lập vẫn là chuỗi `0123…`; cả qua giao diện | Đạt (giả lập + Chromium) |
| CSV lỗi hiển thị đúng dòng | Dòng 3,4,5,6,7,8 báo đúng lý do; tệp mẫu `du-lieu-thu-co-loi.csv` báo đúng dòng 3,4,5,6,7,9 | Đạt (giả lập + Chromium) |
| HTML/công thức không gây thực thi | `=1+1`, `=HYPERLINK(...)` lưu dạng chữ; xuất CSV thêm `'`; tên chứa thẻ HTML bị từ chối; ghi chú `<img onerror>`/`<script>`/`<svg onload>` hiển thị dạng chữ, không thực thi trên Chromium | Đạt (giả lập + Chromium) |
| Xuất dữ liệu đúng phạm vi quyền | CSV danh sách, thống kê, đoàn phí chỉ gồm phạm vi người xuất; có nhật ký xuất | Đạt (giả lập + Chromium) |
| Giao diện dùng được trên điện thoại | 375px và 390px: không tràn ngang ở Tổng quan, Đoàn viên, Đoàn phí, Quản trị; bảng chuyển thành thẻ; ảnh chụp 01–06, 10–11 | Đạt (Chromium; **chưa thử điện thoại thật / Safari iOS**) |
| Sao lưu và khôi phục trên dữ liệu thử | Tạo bản sao lưu; khôi phục bắt buộc gõ xác nhận và quyền quản trị; kiểm tra cấu trúc trước; tạo bản `pre-restore`; dữ liệu trở về đúng; phiên hiện tại giữ nguyên; tác vụ hằng ngày tự giới hạn 20 giờ | Đạt (giả lập Drive) |

Kiểm tra bổ sung đã đạt: setupSystem chạy lại không mất dữ liệu, không đổi khóa bí mật, không tự thêm quản trị, nâng cấp schema thêm cột giữ dữ liệu; hàm vận hành bị chặn khi `getActiveUser()` rỗng; giới hạn tần suất OTP theo email (kể cả email không tồn tại) và toàn hệ thống; hết hạn mức email có thông báo; ngày `dd/MM/yyyy` không lệch khi trình duyệt ở múi giờ khác; 30/02 bị từ chối; tìm kiếm không dấu; mã tự sinh; đoàn phí chống trùng, điều chỉnh có lý do + lịch sử, chặn chỉnh theo phiên bản cũ, thống kê đúng; cây đơn vị chống vòng lặp; luôn còn ít nhất một quản trị; tệp mẫu `samples/` và bản gộp `dist/MaNguon.gs` chạy đúng; trang GitHub Pages dưới `/quan-ly-doan-vien/` tải đủ tài nguyên bằng đường dẫn tương đối, nút bị vô hiệu khi chưa cấu hình hoặc cấu hình địa chỉ không phải Web App Google.

## 4. Hiệu năng

### 4.1. Số liệu trên giả lập (5.000 hồ sơ + 1.000 dòng nhập, ~190.000 ô)

Đây là thời gian **xử lý logic** trên máy phát triển, **không gồm** độ trễ đọc/ghi Google Sheets thật.

| Thao tác | Thời gian (ms) |
|---|---|
| Danh sách trang 1 (đọc toàn bảng, lọc quyền, sắp xếp, phân trang) | ~100 |
| Tìm tên không dấu | ~75 |
| Kiểm tra 1.000 dòng CSV | ~160 |
| Ghi 1.000 yêu cầu từ CSV (ghi `CHANGE_REQUESTS` bằng **2** lần `setValues`) | ~250 |
| Duyệt hàng loạt 50 yêu cầu | ~620 |
| Xem chi tiết hồ sơ | ~110 |
| Xuất toàn bộ 5.000 hồ sơ ra CSV | ~270 |
| Tổng quan | ~110 |
| Danh sách đoàn phí | ~100 |

### 4.2. Đánh giá cho môi trường thật — CẦN ĐO

Mỗi lần gọi đọc toàn bộ các sheet liên quan bằng một lần `getValues()` mỗi sheet; ghi theo lô; không gọi `getRange` từng ô trong vòng lặp. Thời gian thật phụ thuộc chủ yếu vào số lần đọc/ghi Sheets và độ trễ của Google, **chưa đo được**. Các rủi ro đã biết:

- Mọi thao tác ghi được tuần tự hóa bằng một khóa script (chờ tối đa 20 giây). Với ~10 người dùng thao tác thông thường thì xung đột chờ khóa là ngắn, nhưng **nhập CSV lớn hoặc duyệt hàng loạt sẽ làm người khác phải chờ** trong thời gian đó.
- Ứng dụng chạy dưới tài khoản chủ sở hữu nên tất cả người dùng dùng chung giới hạn **30 lần thực thi đồng thời/người dùng** và **6 phút/lần thực thi** của Apps Script.
- Sheet `AUDIT_LOGS`, `OPERATIONS`, `APPROVAL_ACTIONS` tăng dần theo thời gian; nên định kỳ (ví dụ mỗi năm) sao lưu rồi chuyển dữ liệu cũ sang bảng tính lưu trữ. Ngưỡng cảnh báo số hồ sơ: `MEMBERS_WARN_LIMIT` (mặc định 8.000).

Mẫu ghi số liệu đo thật (điền sau khi triển khai):

| Thao tác (5.000 hồ sơ thật/giả lập trên Sheets thật) | Lần 1 (giây) | Lần 2 | Lần 3 | Ghi chú |
|---|---|---|---|---|
| Mở phần mềm → thấy Tổng quan | | | | |
| Tìm kiếm tên | | | | |
| Mở chi tiết hồ sơ | | | | |
| Gửi duyệt một hồ sơ | | | | |
| Duyệt một yêu cầu | | | | |
| Nhập 500 dòng CSV | | | | |
| Xuất danh sách CSV | | | | |
| 10 người cùng thao tác trong 5 phút: số lần gặp "Hệ thống đang bận" | | | | |

Cách tạo 5.000 hồ sơ thử trên Sheets thật: dùng môi trường thử nghiệm (DEPLOYMENT.md, Phụ lục B), sửa tạm `seedDemoData` để gọi `seedDemoCore_(5000)`.

## 5. Danh sách nghiệm thu trên tài khoản Google thật (chủ tài khoản thực hiện)

Thực hiện trên **bảng tính thử nghiệm** trước, sau đó lặp lại các mục chính trên bảng tính thật.

| # | Bước | Kết quả mong đợi | Đạt? |
|---|---|---|---|
| 1 | Chạy `setupSystem` lần 1, rồi lần 2 | Đủ 16 sheet + `HUONG_DAN`; lần 2 không mất dữ liệu | |
| 2 | Mở Web App từ trang GitHub Pages trên máy tính và điện thoại | Thấy màn hình đăng nhập tiếng Việt | |
| 3 | Đăng nhập bằng `ADMIN_EMAIL` | Nhận email mã trong ~1 phút; vào được Tổng quan | |
| 4 | Nhập một email chưa khai báo | Thông báo chung, **không** nhận được email | |
| 5 | Nhập sai mã; đợi 6 phút rồi nhập mã cũ | Bị từ chối cả hai | |
| 6 | Tạo 2 đơn vị A, B; tạo cán bộ A, người duyệt A, cán bộ B | Lưu thành công | |
| 7 | Cán bộ A thêm hồ sơ (có SĐT `09…`, CCCD `0…`) → người duyệt A duyệt | Hồ sơ xuất hiện; trong sheet `MEMBERS` giữ số 0 đầu | |
| 8 | Cán bộ B tìm tên hồ sơ của A | Không thấy | |
| 9 | Cán bộ A sửa SĐT → kiểm tra sheet `MEMBERS` trước khi duyệt | Chưa đổi; sau khi duyệt mới đổi | |
| 10 | Quản trị khóa cán bộ A trong lúc cán bộ A đang mở phần mềm → cán bộ A bấm menu | Bị đưa về màn hình đăng nhập | |
| 11 | Chuyển hồ sơ từ A sang B, cán bộ B xác nhận | Hồ sơ sang B, giữ mã, có 3 dòng lịch sử | |
| 12 | Nhập `samples/du-lieu-thu-co-loi.csv` (đổi mã đơn vị thành mã thật) | Báo lỗi đúng các dòng 3,4,5,6,7,9 | |
| 13 | Xuất CSV danh sách, mở bằng Excel | Tiếng Việt đúng, giữ số 0 đầu, ô `=…` không thành công thức | |
| 14 | Tải tệp CSV trên điện thoại (Android Chrome, iPhone Safari) | Tải được tệp | |
| 15 | Ghi đoàn phí cả trang, điều chỉnh 1 dòng | Thống kê đúng, có lịch sử | |
| 16 | Quản trị → Sao lưu ngay; sửa 1 hồ sơ; Khôi phục bản vừa tạo | Dữ liệu trở lại; có bản `pre-restore` trong thư mục sao lưu | |
| 17 | Chạy `installDailyBackup`; hôm sau xem thư mục sao lưu | Có bản `(auto)` | |
| 18 | Kiểm tra quyền chia sẻ của bảng tính và thư mục sao lưu | Chỉ chủ sở hữu | |
| 19 | Đo thời gian theo bảng mục 4.2 | Ghi số liệu thật | |

## 6. Phần chưa thể xác minh

- Toàn bộ hành vi trên hạ tầng Google thật: quyền OAuth, `HtmlService` iframe, `google.script.run` thật, gửi Gmail, tạo bản sao Drive, trigger hằng ngày, hạn mức.
- Tranh chấp khóa thật khi nhiều người ghi đồng thời; độ trễ thật với 5.000 hồ sơ và 10 người dùng.
- Tải tệp CSV bên trong khung (iframe) của Apps Script trên các trình duyệt di động — tính năng dùng `Blob` + liên kết `download`; đã chạy trên Chromium nhưng chưa thử trong sandbox thật của Google và Safari iOS.
- Giao diện trên điện thoại thật, Safari, Firefox; trình đọc màn hình.
- Kiểm thử xâm nhập độc lập.

## 7. Cách chạy lại kiểm thử (người phát triển)

```bash
node tests/run-tests.js
# Cần Playwright + Chromium:
NODE_PATH=/đường/dẫn/node_modules node tests/ui-test.js
```
