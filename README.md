# Web nghe audio trên Cloudflare (miễn phí)

Web nghe audio truyện chạy trên **Cloudflare Pages + Functions + D1**, audio lưu ở **R2**.
Không cần server, không cần cài thư viện. Mỗi lần đẩy code lên GitHub, Cloudflare tự cập nhật web.

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
3. Trang quản trị nằm ở `/admin`.

### Bước 5: Gắn tên miền (tùy chọn)
Dự án → **Custom domains → Set up a custom domain** → nhập tên miền. Nếu tên miền đang dùng DNS của Cloudflare thì mọi thứ tự cấu hình.

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
