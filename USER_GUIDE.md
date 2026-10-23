# Hướng dẫn sử dụng

Phần mềm dùng được trên máy tính và điện thoại. Trên điện thoại, menu chính nằm thành hàng ngang phía trên — vuốt sang trái để thấy các mục còn lại.

## 1. Đăng nhập

1. Mở trang truy cập của đơn vị → bấm **Mở phần mềm quản lý đoàn viên**.
2. Nhập email đã được quản trị cấp quyền → **Gửi mã đăng nhập**.
3. Mở hộp thư, lấy **mã 6 chữ số** (kiểm tra cả thư mục Spam) → nhập mã → **Đăng nhập**.

- Mã có hiệu lực **5 phút** và chỉ dùng **một lần**. Nhập sai 5 lần phải xin mã mới.
- Phiên đăng nhập kéo dài tối đa 8 giờ, tự hết nếu 60 phút không thao tác. Đóng thẻ trình duyệt cũng phải đăng nhập lại.
- Dùng máy chung: luôn bấm **Đăng xuất** khi xong việc.

## 2. Vai trò và quyền

| Vai trò | Được làm |
|---|---|
| **Người xem** | Xem, tìm, xuất danh sách trong đơn vị được giao. Số giấy tờ, địa chỉ, ngày sinh bị che một phần. Không sửa được gì. |
| **Cán bộ đơn vị** | Như người xem (không bị che) + thêm/sửa/lưu trữ hồ sơ (qua phê duyệt), nhập danh sách CSV, lập yêu cầu chuyển sinh hoạt, xác nhận đoàn viên chuyển đến. Ghi nhận đoàn phí nếu được cấp quyền đoàn phí. |
| **Người phê duyệt** | Xem yêu cầu trong phạm vi phụ trách, **Duyệt** hoặc **Trả lại** kèm lý do, xem lịch sử xử lý, xác nhận đoàn viên chuyển đến. |
| **Quản trị hệ thống** | Toàn quyền: đơn vị, người dùng, cấu hình, sao lưu/khôi phục, nhật ký. |

Một người có thể có nhiều vai trò ở nhiều đơn vị. Quyền "gồm cấp dưới" áp dụng cho cả các đơn vị con.

## 3. Tổng quan

Màn hình đầu tiên cho biết: số đoàn viên, số yêu cầu chờ bạn duyệt, yêu cầu bị trả lại cần sửa, chuyển sinh hoạt chờ xác nhận, đoàn phí tháng hiện tại. Bấm vào ô số để đi tới màn hình tương ứng. Số đỏ cạnh menu là việc đang chờ bạn.

## 4. Đoàn viên

**Tìm kiếm:** gõ tên (gõ không dấu cũng được, ví dụ `nguyen van an`), mã đoàn viên, một phần số điện thoại, hoặc số giấy tờ (khớp đủ số). Lọc theo đơn vị, tình trạng; chọn "Hồ sơ đã lưu trữ" để xem hồ sơ cũ. Bấm vào một dòng để xem chi tiết và lịch sử sinh hoạt.

**Thêm đoàn viên:** bấm **+ Thêm đoàn viên** → điền thông tin (ô có dấu * là bắt buộc) → **Gửi duyệt**, hoặc **Lưu nháp** để làm tiếp sau.

- Ngày gõ dạng ngày/tháng/năm, ví dụ `05091990` sẽ tự thành `05/09/1990`.
- Mục **Thông tin bổ sung** (mã đoàn viên, giấy tờ, email, địa chỉ, chức vụ, ghi chú) bấm để mở ra.
- **Mã đoàn viên** để trống thì hệ thống tự cấp khi được duyệt (dạng `DV000001`).
- Số giấy tờ có thể để trống nếu chưa có. CCCD gồm 12 chữ số.
- Hồ sơ **chỉ xuất hiện chính thức sau khi được duyệt**.

**Sửa hồ sơ:** mở hồ sơ → **Sửa hồ sơ** → sửa → **Gửi duyệt**. Dữ liệu cũ vẫn giữ nguyên cho tới khi được duyệt. Nếu người khác vừa sửa cùng hồ sơ, phần mềm báo **xung đột** — bấm Đóng, mở lại hồ sơ để thấy dữ liệu mới rồi sửa lại. Muốn đổi đơn vị: dùng **Chuyển sinh hoạt** (không sửa trực tiếp).

**Lưu trữ / Khôi phục:** mở hồ sơ → **Lưu trữ hồ sơ** → ghi lý do → Gửi duyệt. Hồ sơ không bị xóa, chỉ không còn hiệu lực; có thể **Khôi phục hồ sơ** sau này.

**Xuất danh sách:** **Xuất danh sách CSV** xuất đúng các hồ sơ đang lọc và trong phạm vi bạn được xem. Mở tệp bằng Excel (tiếng Việt hiển thị đúng).

## 5. Nhập danh sách từ tệp CSV

1. **Đoàn viên → Nhập từ tệp CSV → Tải tệp mẫu**.
2. Mở tệp mẫu bằng Excel, **xóa dòng [MẪU]**, điền dữ liệu (mỗi người một dòng). Cột **Mã đơn vị** lấy ở Quản trị → Đơn vị (hỏi quản trị), hoặc để trống và chọn "Đơn vị mặc định" khi nhập.
3. Lưu: **Tệp → Lưu dưới dạng → CSV UTF-8 (Phân cách bằng dấu phẩy)**. Để giữ số 0 đầu khi gõ trong Excel, định dạng các cột mã/điện thoại/giấy tờ là **Văn bản (Text)** trước khi gõ.
4. Chọn tệp → kiểm tra phần **ghép cột** (phần mềm tự ghép theo tên cột) → **Kiểm tra dữ liệu**.
5. Xem kết quả: dòng lỗi ghi rõ **số dòng trong tệp** và lý do. Sửa các dòng lỗi trong tệp để nhập lại sau.
6. Bấm **Xác nhận nhập … dòng hợp lệ**. Các dòng hợp lệ trở thành **yêu cầu thêm mới chờ duyệt** — không ghi đè hồ sơ có sẵn. Hồ sơ trùng mã/giấy tờ, hoặc trùng họ tên + ngày sinh trong cùng đơn vị, bị báo lỗi.

Giới hạn: 1.000 dòng và 1 MB mỗi lần.

## 6. Chờ phê duyệt

- **Chờ tôi duyệt** (người phê duyệt): bấm vào yêu cầu để xem. Với yêu cầu sửa, các dòng thay đổi được tô vàng: giá trị cũ gạch ngang, giá trị mới in đậm.
  - **Duyệt**: dữ liệu chính thức được cập nhật ngay.
  - **Trả lại**: bấm "Trả lại", **ghi lý do** (bắt buộc), bấm "Trả lại" lần nữa.
  - Có thể tích chọn nhiều yêu cầu rồi **Duyệt các yêu cầu đã chọn** (tối đa 50/lần) — chỉ dùng khi đã xem nội dung.
  - Bạn không thể duyệt yêu cầu do chính mình lập.
- **Yêu cầu tôi lập**: theo dõi trạng thái *Nháp / Chờ duyệt / Đã duyệt / Trả lại / Đã hủy*. Yêu cầu bị trả lại: mở ra, đọc lý do, bấm **Sửa và gửi lại**; hoặc **Hủy yêu cầu**.
- **Lịch sử xử lý**: mọi yêu cầu trong phạm vi bạn phụ trách.

## 7. Chuyển sinh hoạt

1. Đơn vị đi: **Đoàn viên** → mở hồ sơ → **Chuyển sinh hoạt** → chọn đơn vị đến, ngày đề nghị, lý do → **Gửi yêu cầu chuyển**.
2. Đơn vị đến: **Chuyển sinh hoạt → Chờ đơn vị tôi xác nhận** → **Xác nhận** (chọn ngày hiệu lực) hoặc **Từ chối** (ghi lý do).
3. Khi xác nhận: đoàn viên chuyển sang đơn vị mới, **giữ nguyên mã đoàn viên**, lịch sử ghi cả "Chuyển đi" và "Chuyển đến". Đơn vị cũ không còn xem hồ sơ; đơn vị mới xem được ngay.

Đơn vị đi có thể **Hủy** khi đơn vị đến chưa xác nhận. Mỗi đoàn viên chỉ có một yêu cầu chuyển đang xử lý.

## 8. Đoàn phí

- Chọn **Tháng, Năm, Đơn vị** → danh sách đoàn viên kèm tình trạng: *Chưa ghi nhận / Chưa thu / Thu một phần / Đã thu đủ*. Phía trên là tổng phải thu, đã thu, còn thiếu.
- **Ghi nhận** (từng người) hoặc **Ghi nhận cho cả trang đang xem**: nhập số phải thu (áp cho tất cả, có thể sửa từng dòng), tích "Đánh dấu đã thu đủ" nếu đã thu, chọn ngày thu → **Lưu ghi nhận**. Người đã có ghi nhận trong kỳ sẽ được bỏ qua (không ghi trùng).
- **Điều chỉnh**: sửa số tiền/ngày thu, **bắt buộc ghi lý do**; mọi lần điều chỉnh được lưu lịch sử. **Hủy ghi nhận** dùng khi ghi nhầm (lịch sử vẫn giữ).
- Số tiền nhập số nguyên VND, có thể gõ `50000` hoặc `50.000`. Phần mềm không tự áp mức thu theo quy định — người có quyền tự nhập hoặc quản trị cấu hình mức gợi ý.
- **Xuất CSV chi tiết kỳ này** để nộp báo cáo.

## 9. Báo cáo

- **Thống kê đoàn viên theo đơn vị**: tổng số, nam/nữ, theo tình trạng sinh hoạt; **Tải CSV thống kê**, **Tải CSV danh sách đoàn viên**.
- **Tổng hợp đoàn phí** theo khoảng tháng → **Tải CSV đoàn phí**.

Mọi báo cáo chỉ gồm dữ liệu trong phạm vi bạn được xem; mỗi lần xuất được ghi nhật ký.

## 10. Quản trị (chỉ Quản trị hệ thống)

- **Đơn vị:** thêm, đổi tên, đổi mã, chọn cấp trên, ngừng hoạt động (chỉ khi không còn đoàn viên và đơn vị con đang hoạt động). Cấp của đơn vị tự tính theo cây; tên các cấp đặt trong Cấu hình (`UNIT_LEVEL_NAMES`).
- **Người dùng & phân quyền:** thêm người dùng (họ tên + email) → mở người dùng → **Cấp quyền** (đơn vị, vai trò, gồm cấp dưới, được ghi đoàn phí). **Khóa** tài khoản hoặc **Thu hồi** quyền có hiệu lực ngay ở thao tác kế tiếp của người đó. **Thu hồi tất cả phiên** để buộc đăng xuất.
- **Cấu hình:** tên tổ chức, tên các cấp, tiền tố mã đoàn viên, cho phép quản trị tự duyệt (TRUE/FALSE), mức đoàn phí gợi ý, số bản sao lưu giữ lại, ngưỡng cảnh báo số hồ sơ.
- **Sao lưu:** **Sao lưu ngay**, xem danh sách, **Khôi phục…** (gõ `KHOI PHUC` để xác nhận; hệ thống tự lưu bản hiện trạng trước).
- **Vận hành & nhật ký:** hạn mức email còn lại, **Phục hồi thao tác dở dang** khi có cảnh báo, tra cứu nhật ký thao tác (ai, lúc nào, làm gì, kết quả).

## 11. Thông báo lỗi thường gặp

| Thông báo | Nên làm |
|---|---|
| "Mã không đúng hoặc đã hết hạn" | Kiểm tra lại 6 số; nếu quá 5 phút, bấm **Gửi lại mã**. |
| "Bạn đã yêu cầu mã quá nhiều lần" | Đợi 15 phút rồi thử lại. |
| "Phiên đăng nhập đã hết hạn" | Đăng nhập lại. |
| "Bạn không có quyền…" | Đề nghị quản trị cấp quyền cho đơn vị cần làm. |
| "Hồ sơ đã được người khác cập nhật…" | Mở lại hồ sơ để xem dữ liệu mới rồi sửa lại. |
| "Hồ sơ này đang có yêu cầu khác chờ duyệt" | Đợi yêu cầu kia được xử lý. |
| "Hệ thống đang bận…" / "Không nhận được phản hồi…" | Đợi vài giây rồi bấm lại — thao tác không bị ghi trùng. |
| "Có lỗi hệ thống … mã XXXXXXXX" | Chụp màn hình gửi quản trị kèm mã. |
