# Tệp mẫu và dữ liệu giả lập

Tất cả dữ liệu trong thư mục này là **giả lập** (tên có nhãn `[DEMO]` hoặc `[MẪU]`), không có dữ liệu thật.

| Tệp | Dùng để |
|---|---|
| `mau-nhap-doan-vien.csv` | Tệp mẫu để điền dữ liệu thật (giống nút "Tải tệp mẫu" trong phần mềm). Xóa dòng `[MẪU]` trước khi nhập. |
| `du-lieu-thu-demo.csv` | 60 đoàn viên giả lập hợp lệ, mã đơn vị `DEMO-A1`, `DEMO-A2`, `DEMO-B1` (có sẵn khi chạy `seedDemoData`). Có số 0 đầu ở mã, giấy tờ, điện thoại. |
| `du-lieu-thu-co-loi.csv` | 8 dòng; các dòng 3, 4, 5, 6, 7, 9 cố ý sai (thiếu họ tên, ngày 31/02, CCCD thiếu số, mã đơn vị không có, trùng mã, điện thoại sai). Dòng 8 hợp lệ nhưng ghi chú bắt đầu bằng `=HYPERLINK(...)` để kiểm tra chống chèn công thức. |

Tất cả tệp là **CSV UTF-8 có BOM**, phân cách dấu phẩy. Phần mềm cũng đọc được tệp phân cách dấu chấm phẩy (Excel tiếng Việt).

Các tệp này được sinh bởi `node tools/build.js`.
