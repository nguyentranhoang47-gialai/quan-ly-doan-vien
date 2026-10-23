# Kiểm thử

Dành cho người phát triển — **không cần** khi triển khai hay sử dụng.

| Tệp | Nội dung |
|---|---|
| `gas-mock.js` | Giả lập tối thiểu Apps Script (Sheets, Properties, Cache, Lock, Mail, Drive, Utilities, Session) |
| `fixture.js` | Dựng môi trường + cây đơn vị A/B/A1/C + 8 người dùng + 2 hồ sơ |
| `run-tests.js` | 21 nhóm kiểm thử nghiệp vụ (chạy mã `.gs` thật trên giả lập) |
| `ui-test.js` | Kiểm thử giao diện thật trên Chromium (điện thoại + máy tính), XSS, tải tệp, GitHub Pages dưới thư mục con |
| `test-results.json`, `ui-results.json` | Kết quả lần chạy gần nhất |
| `screenshots/` | Ảnh chụp giao diện |

```bash
node tests/run-tests.js
NODE_PATH=<thư mục node_modules có playwright> node tests/ui-test.js
```

Biến `__FAULT` (chỉ đặt bởi bộ kiểm thử) chèn lỗi giả tại `faultPoint_()` để kiểm tra phục hồi thao tác dở dang; trong môi trường thật biến này không tồn tại nên `faultPoint_` không làm gì.
