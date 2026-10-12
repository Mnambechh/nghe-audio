# Web nghe audio trên Cloudflare (miễn phí)

Web nghe audio truyện chạy trên **Cloudflare Pages + Functions + D1**, audio lưu ở **R2**.
Không cần server, không cần cài thư viện. Mỗi lần đẩy code lên GitHub, Cloudflare tự cập nhật web.

Lịch sử giao dịch cá nhân nằm trong bảng tài khoản → **Lịch sử Linh Thạch & EXP**. Admin xem nhật ký trong hồ sơ thành viên và mục **Thưởng bất thường** để đối chiếu các dấu hiệu cần kiểm tra. Chi tiết sửa bảo mật và cách chạy kiểm tra cục bộ: [rà soát 12/10/2026](docs/security-review-2026-10-12.md).

## Cài đặt lần đầu (khoảng 10 phút)

### Bước 1: Tạo cơ sở dữ liệu D1
1. Vào [dash.cloudflare.com](https://dash.cloudflare.com) → **Storage & Databases → D1 SQL Database → Create**.
2. Đặt tên, ví dụ `audio-db`, rồi bấm **Create**. (Không cần chạy lệnh SQL nào, web tự tạo bảng.)

### Bước 2: Tạo dự án Pages từ GitHub
1. Vào **Workers & Pages → Create → Pages → Connect to Git**.
2. Chọn repo này, bấm **Begin setup**.
3. Cấu hình build:
   - **Framework preset:** `None`
   - **Build command:** để trống
   - **Build output directory:** `public`
4. Bấm **Save and Deploy** và chờ khoảng 1 phút.

### Bước 3: Gắn D1 vào dự án
1. Mở dự án vừa tạo → **Settings → Bindings → Add → D1 database**.
2. **Variable name:** `DB` (viết hoa đúng như vậy). **D1 database:** chọn `audio-db`. Bấm **Save**.
3. Vào tab **Deployments**, ở bản mới nhất bấm **⋯ → Retry deployment**. Phải deploy lại thì D1 mới có hiệu lực.

### Bước 4: Cài đặt web
1. Mở link `https://ten-du-an.pages.dev`, trang cài đặt sẽ hiện ra.
2. Nhập tên web, tài khoản và mật khẩu admin. **Hãy cài ngay** để người khác không chiếm trước được.
3. Trang quản trị nằm ở **`/quanly-199x`**. Link `/admin` không tồn tại (trả về 404) để tránh bot dò.

### Bước 5: Gắn tên miền (tùy chọn)
Dự án → **Custom domains → Set up a custom domain** → nhập tên miền. Nếu tên miền đang dùng DNS của Cloudflare thì mọi thứ tự cấu hình.

## Bật bình luận (đăng nhập Google)
1. Vào [console.cloud.google.com](https://console.cloud.google.com), tạo một project, ví dụ `truyengi`.
2. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding): điền tên app, email hỗ trợ.
   - Audience/User type: **External**. Bấm **Publish app** để ai cũng đăng nhập được.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins:** thêm `https://truyengi.info` và `https://nghe-audio.pages.dev`
   - Không cần Redirect URI. Bấm **Create**.
4. Copy **Client ID** (dạng `123456-abc.apps.googleusercontent.com`) → vào trang quản trị **Cài đặt & SEO → Bình luận & đăng nhập Google** → dán vào → **Lưu**.

Người nghe bấm **Đăng nhập** ở góc trên (hoặc trong phần bình luận) để đăng nhập bằng Google. Đăng nhập xong có **Lịch sử nghe** (menu tài khoản → Lịch sử nghe): lưu tập và phút đang nghe, mở trên máy khác vẫn nghe tiếp được. Bình luận mới mặc định **chờ duyệt** (quản trị → **Bình luận**), muốn hiện ngay thì bỏ tick "Duyệt bình luận trước khi hiện". Bình luận có link luôn phải chờ duyệt.
Chống spam: mỗi người cách nhau tối thiểu 15 giây, tối đa 50 bình luận/ngày. Admin có thể **Khóa người này** (ẩn mọi bình luận của họ).

## Tu luyện: cấp độ, Linh Thạch, điểm danh, đánh giá, thông báo
- **70 cấp theo Phàm Nhân Tu Tiên:** Luyện Khí 1–10, rồi Trúc Cơ, Kết Đan, Nguyên Anh, Hóa Thần, Luyện Hư, Hợp Thể, Đại Thừa, Độ Kiếp, Chân Tiên, Kim Tiên, Thái Ất, Đại La (mỗi cảnh giới 5 bậc: Sơ Kỳ → Đại Viên Mãn). Mỗi cảnh giới một màu.
- **EXP tính lại từ 0 mỗi cấp:** cấp N cần N × 100 EXP (cấp 1→2: 100, cấp 2→3: 200…). Số 100 chỉnh trong Cài đặt.
- **Nguồn EXP / Linh Thạch** (chỉnh trong Cài đặt & SEO → Tu luyện): điểm danh (+10 Linh Thạch, +5 EXP, phải online 3 phút trong ngày), đánh giá truyện (+1 EXP, 15 truyện/ngày, mỗi truyện 1 lần), bình luận được duyệt (+2 EXP, tối đa 10/ngày), lên cấp (+20 Linh Thạch).
- **Chuông thông báo:** có người trả lời, thả tim bình luận, bình luận được duyệt, lên cấp, đến giờ điểm danh.
- **Bảng xếp hạng:** `/bang-xep-hang`.

## Rút Linh Thạch
- Người dùng thêm tối đa 3 **tài khoản nhận tiền**: ngân hàng (danh sách ngân hàng VN), MoMo, ViettelPay, ZaloPay.
- Gửi yêu cầu rút (tối thiểu 10.000 Linh Thạch). Linh Thạch bị **tạm giữ** ngay khi gửi.
- Admin → **Rút Linh Thạch**: xem số tài khoản, tên chủ tài khoản, nội dung chuyển khoản (bấm để sao chép), cấp độ, số tài khoản cùng IP.
  Chuyển khoản thủ công rồi bấm **Đã chuyển**, hoặc **Từ chối** (tự hoàn Linh Thạch). Người dùng nhận thông báo.
- Cài đặt & SEO → Rút Linh Thạch: bật/tắt, tỷ giá (mặc định 1 Linh Thạch = 1đ), mức tối thiểu, số lần/ngày. Đủ Linh Thạch là rút được, không cần cấp.

## Audio trên R2
- Tạo bucket R2, vào **Settings → Public access → Custom domain**, gắn một tên miền phụ như `cdn.tenmien.com`.
- Upload file `.mp3` hoặc `.m4a` lên bucket, rồi dán link dạng `https://cdn.tenmien.com/ten-file.mp3` vào trang admin. Thời lượng sẽ tự lấy.
- Giọng đọc nên để 64–96 kbps: nghe rõ, file nhẹ. `.ogg/.opus` không phát được trên iPhone đời cũ.

## Quản trị
- **Audio:** đăng/sửa/xóa truyện, nhiều phần, dán nhiều link một lần, ẩn/hiện, đưa lên đầu.
- **Quảng cáo:** sản phẩm Shopee (link, ảnh, giá), hiển thị ngẫu nhiên. Chỉnh được số giờ giữa hai lần hiện (6 = mỗi 6 tiếng, 24 = mỗi ngày). Có thống kê lượt hiện và lượt bấm.
- **Cài đặt & SEO:** tên web, logo, favicon, màu chủ đạo, title, description, từ khóa, mã Google Analytics/Search Console. Sitemap tự tạo tại `/sitemap.xml`.
- **Trang:** Giới thiệu, Liên hệ, Chính sách… hiện ở chân trang.
- Ảnh logo và ảnh quảng cáo tải lên tối đa **1MB**, lưu thẳng trong D1.

## Bảo mật
- **Link quản trị ẩn:** `/quanly-199x`. Muốn đổi thì sửa `ADMIN` trong `src/security.js`.
- **Chống dò mật khẩu:** sai 5 lần / 15 phút → khóa IP đó 15 phút. Sai 10 lần / 10 phút → chặn IP 24 giờ. Tổng mọi IP sai 30 lần / 15 phút → khóa đăng nhập 15 phút.
- **Chặn bot dò lỗ hổng:** truy cập các link như `/wp-login.php`, `/.env`, `/phpmyadmin`, `/admin`, file `.sql/.bak`… sẽ được ghi nhật ký. Dò 20 lần / 10 phút → tự chặn IP 24 giờ.
- **Chống bơm lượt nghe:** mỗi thiết bị tính 1 lượt / truyện / ngày, mỗi IP tối đa 300 lượt / ngày.
- **Chống gửi form giả mạo (CSRF):** form admin chỉ nhận yêu cầu từ chính tên miền của web.
- **Trang Bảo mật** trong admin: xem nhật ký tấn công 30 ngày (IP, quốc gia, đường dẫn, trình duyệt), chặn hoặc bỏ chặn IP, đăng xuất khỏi mọi thiết bị.
- **Cơ sở dữ liệu D1** không mở ra internet. Chỉ code của web đọc được, mọi truy vấn đều dùng tham số nên không bị SQL injection.
- Header bảo mật: HSTS, chống nhúng iframe, CSP cho trang admin. Phiên đăng nhập 7 ngày, cookie chỉ gửi trong link quản trị.

**Nên làm thêm (miễn phí):**
- Bảo vệ link quản trị bằng **Cloudflare Zero Trust → Access**: tạo ứng dụng cho `truyengi.info/quanly-199x*`, chỉ cho email của bạn (nhận mã OTP qua email). Người lạ sẽ không thấy được cả trang đăng nhập.
- **Security → WAF → Rate limiting rules:** giới hạn ví dụ 60 yêu cầu / 10 giây mỗi IP cho `/api/`.
- **Security → Bots → Bot Fight Mode:** bật lên.

## Giới hạn gói miễn phí (tham khảo)
| Dịch vụ | Miễn phí |
|---|---|
| Pages Functions (Workers) | ~100.000 lượt/ngày |
| D1 | ~5 triệu dòng đọc, ~100.000 dòng ghi mỗi ngày, 5GB |
| R2 | 10GB lưu trữ, không tính phí băng thông |

Tốn lượt nhiều nhất là tính năng "đang nghe": mỗi người đang nghe gửi 1 tín hiệu mỗi 60 giây.
Gói miễn phí chịu được khoảng **1.000–1.500 giờ nghe mỗi ngày**. Đông hơn thì nâng Workers Paid (5 USD/tháng).
Các trang nặng (top, tổng số…) đã được lưu đệm 10 phút để tiết kiệm lượt đọc.

## Sửa code
- Mã server: `src/` (`app.js` định tuyến, `admin.js` quản trị, `api.js` đếm lượt, `views/` giao diện).
- Giao diện: `public/assets/` (`app.css`, `app.js`). **Sau khi sửa CSS/JS, tăng `ASSET_V` trong `src/views/public.js`** để trình duyệt tải bản mới.
- Đẩy code lên nhánh chính (`main`), Cloudflare sẽ tự deploy.

## Quên mật khẩu admin
Vào **D1 → audio-db → Console**, chạy:
```sql
DELETE FROM settings WHERE k IN ('admin_user', 'admin_pass');
```
Mở lại web, trang cài đặt sẽ hiện để tạo tài khoản mới. Dữ liệu audio vẫn còn nguyên.
