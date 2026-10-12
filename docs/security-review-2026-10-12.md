# Rà soát bảo mật và lịch sử thưởng — 12/10/2026

Đã rà soát mã xử lý đăng nhập, quyền admin/biên tập viên/thành viên, EXP, đánh giá, nhiệm vụ, cửa hàng, rút và hoàn Linh Thạch. Kiểm tra chạy trên D1 cục bộ dùng dữ liệu giả, không ghi vào database thật.

## Các lỗi được sửa

| Vấn đề | Sửa và kiểm tra |
| --- | --- |
| Vật phẩm vĩnh viễn được cấp trước khi trừ tiền | Đã tái hiện việc tài khoản không đủ tiền vẫn bật được hiệu ứng khi yêu cầu dùng vật phẩm chen vào. Mua, trừ tiền, cấp quyền, dùng vật phẩm, đếm lượt bán và ghi lịch sử hiện chạy trong một giao dịch D1. |
| Giao dịch bị dở dang khi một bước ghi database thất bại | Mua VIP, rút và hoàn tiền dùng giao dịch nguyên tử. Thử gây lỗi ở bước ghi lượt bán/nhật ký: số dư, quyền sở hữu, yêu cầu rút và trạng thái đều hoàn tác. Gửi nhiều lần chỉ hoàn tiền một lần. |
| EXP và thưởng đột phá/lịch sử có thể lệch khi cập nhật đồng thời | EXP, Linh Thạch đột phá và nhật ký chạy chung một giao dịch; so khớp EXP trước khi ghi. Sáu phần thưởng đồng thời vượt mốc cấp chỉ tạo một thưởng đột phá, các số dư ghi đúng thứ tự. |
| Email chưa xác minh giữ được mật khẩu/phiên cũ khi gộp Google | Token Google phải có email đã xác minh. Khi gộp tài khoản email chưa chứng minh quyền sở hữu, hủy mật khẩu và phiên cũ. Mật khẩu đã được xác minh qua link đặt lại được giữ. Lịch sử/tài sản không bị xóa. |
| Gửi nhiều đăng ký cùng lúc có thể vượt số tài khoản/IP | Giới hạn được kiểm tra ngay trong câu lệnh tạo tài khoản, cho cả email và Google. Thử bốn đăng ký đồng thời với giới hạn hai: chỉ có hai tài khoản được tạo. |
| Lần báo thời gian đầu được cộng sẵn 20/120 giây | Tính từ mốc hoạt động đã ghi phía máy chủ; gửi thời gian khống và song song không nhận thời gian miễn phí, không tăng nhanh hơn đồng hồ thực. |
| Giới hạn đánh giá/thả tim bằng 0 vẫn lọt lượt đầu trong ngày | Chặn trước khi giữ lượt; đã kiểm tra cấu hình 0 và gửi lặp. Sao đánh giá phải là số nguyên 1–10. |
| Bình luận của truyện chưa xuất bản có thể đọc qua API | API bình luận chỉ trả dữ liệu truyện đã xuất bản; số tim cũng không lấy từ truyện ẩn. |
| Dữ liệu rút tiền không được kiểm tra đầy đủ về miền số | Chỉ nhận lượng Linh Thạch dương, hữu hạn, trong miền số nguyên an toàn; kiểm tra cả giá trị quy đổi. Giá/độ dài gói cửa hàng cũng được kiểm tra. |

Cookie phiên vẫn dùng chữ ký, HttpOnly/Secure; phiên hết hạn/đã thu hồi/tài khoản khóa bị từ chối. Các API riêng không nhận ID người dùng do máy khách chỉ định. Demo chỉ được xem; biên tập viên không vào được giao dịch, cài đặt hoặc bảng cảnh báo của admin. Form ghi có kiểm tra nguồn; dữ liệu JSON/multipart có giới hạn byte thực. Truy vấn dữ liệu người dùng dùng tham số SQL.

Kiểm tra phản hồi công khai không thấy khóa ký phiên, khóa proxycheck/Resend hay thông tin cấu hình riêng được đưa ra ngoài. Không có API xuất database công khai; lỗi máy chủ trả thông báo chung, không trả stack/database error cho khách.

## Theo dõi tài khoản

- Menu trong bảng tài khoản: **Lịch sử Linh Thạch & EXP**, `/lich-su-thuong`. Hiển thị thời điểm, lý do, số nhận/chi và số dư sau giao dịch; lọc loại và xem tiếp từng 50 dòng. API chỉ lấy tài khoản từ cookie đã xác thực, dùng `no-store`, không lưu lịch sử giao dịch vào localStorage. Đổi bộ lọc, đăng xuất/chuyển tài khoản hoặc chuyển trang không để phản hồi cũ hiển thị nhầm dữ liệu.
- Admin vẫn xem toàn bộ nhật ký từng tài khoản trong **Thành viên → hồ sơ → Lịch sử Kinh nghiệm & Linh Thạch**.
- Admin thêm **Thưởng bất thường**: số dư âm, lệch nhật ký, một số nguồn thưởng ngày ghi trùng, tổng thưởng ngày vượt giới hạn hiện tại. Có phân trang và liên kết hồ sơ để dùng các thao tác khóa/thu hồi phiên/điều chỉnh đã có.
- Trần thưởng ngày tính cả VIP x2; loại riêng cộng tay của admin, hoàn tiền, hoa hồng và thưởng đột phá. Đợi hai phút sau giao dịch mới đối chiếu số dư. Cảnh báo cần đối chiếu, không tự kết luận gian lận hoặc tự khóa tài khoản. Đổi mức thưởng trong ngày có thể làm phát sinh cảnh báo hợp lệ.
- Nhật ký cũ đã bị dọn hoặc giao dịch trước thời điểm bắt đầu ghi nhật ký không thể được tái dựng chính xác; không tự bịa lịch sử còn thiếu. Cơ chế dọn nhật ký sau một năm vẫn được giữ.

Thanh EXP trong bảng tài khoản giữ nguyên chiều dài, cao 18px: màu đơn khi thấp, phối xanh/tím/vàng theo tiến độ; từ 80% có ánh sáng lướt nhẹ. Tắt chuyển động khi thiết bị yêu cầu giảm chuyển động.

## Kiểm tra lặp lại

Node.js 22 trở lên; Miniflare chỉ dùng cho kiểm tra cục bộ, không phải thư viện chạy web. Đã kiểm tra với `miniflare@5.20261006.1-alpha`:

```sh
npm install --prefix /tmp/nghe-audio-security --no-save --no-package-lock miniflare@5.20261006.1-alpha
MINIFLARE_MODULE=/tmp/nghe-audio-security/node_modules/miniflare/dist/src/index.js node tests/security-check.mjs
```

Kiểm tra gồm: dữ liệu/phiên giả mạo, giới hạn payload cả streaming, CSRF, SQL injection, quyền sở hữu dữ liệu, gửi đồng thời, số dư không âm, hoàn tác khi database lỗi, điểm danh/đánh giá/thả tim/nhiệm vụ, lên cấp, đăng ký theo IP, gộp Google, bảng cảnh báo và phân trang. Browser kiểm tra thêm lịch sử riêng tư, escape nội dung, phản hồi đến muộn, đăng xuất, thanh EXP/reduced motion và hình học giao diện 320–1920px. Không tạo ảnh demo.

## Giới hạn của lần rà soát

Chưa xác minh trực tiếp database, khóa API, quyền Cloudflare/GitHub, log tấn công hoặc cấu hình WAF của môi trường thật. Giới hạn yêu cầu trong bộ nhớ từng worker không thay thế bảo vệ DDoS/rate limiting ở Cloudflare. Đồng hồ thực và giới hạn thưởng giảm lạm dụng, nhưng web không thể chứng minh chắc chắn một người đang nghe bằng tai hoặc đang xem link nhiệm vụ. Không có kết luận hệ thống đã hoặc chưa từng bị xâm nhập từ các kiểm tra mã/cục bộ này.
