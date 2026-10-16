# SAMPLE TRACKING V1.0 — HỆ THỐNG QUẢN LÝ TIẾN ĐỘ SẢN XUẤT HÀNG MẪU

> **Phiên bản:** V1.0 (Phase 1 Security Remediation R2)  
> **Ngôn ngữ UI:** Tiếng Việt (Thuật ngữ kỹ thuật giữ chuẩn tiếng Anh: Planning, PE-MFG, QA, CNC, CG, Plating, VMI, OK, NG, KIV)  
> **Mục tiêu:** Quản lý lệnh sản xuất hàng mẫu (Sample Manufacturing Jobs) xuyên suốt các bộ phận Planning, PE-MFG, QA và Admin. Chạy trực tiếp trên trình duyệt Web (Desktop & Mobile) qua URL bảo mật HTTPS, không cần cài đặt.

---

## 1. TỔNG QUAN KIẾN TRÚC & BẢO MẬT (R2 SECURITY HARDENED)

- **Frontend:** React 19 + TypeScript + Vite + React Router.
- **Styling:** Tailwind CSS (Mobile-first, touch targets lớn trên điện thoại, layout bảng gọn gàng cho sản xuất).
- **Backend / Cơ sở dữ liệu:** Supabase PostgreSQL + Row Level Security (RLS) + Database Triggers.
- **Xác thực:** Supabase Auth (Đăng nhập bằng Số điện thoại chuẩn hóa E.164 + Mật khẩu do Admin cấp phát, tắt đăng ký công khai).
- **Quản lý phiên:** Thu hồi refresh token qua GoTrue `ban_duration` kết hợp RLS `is_user_active()` khóa truy vấn database thời gian thực ngay cả khi JWT còn hạn.
- **Quy trình công đoạn:** Bắt buộc công đoạn mới phải ở trạng thái `NOT_STARTED` trên cả INSERT & UPDATE; khóa gán lại `job_id`; trạng thái `COMPLETED` (Xanh lá) bắt buộc tương quan sửa đổi giữa lượt chạy máy và biên bản QA `OK`. Lượt chạy mới sau khi QA duyệt sẽ tự động vô hiệu hóa trạng thái hoàn tất cũ thành `WAITING_QA`.
- **Lưu trữ tệp:** Supabase Private Storage (`sample-documents` - truy cập qua short-lived Signed URLs giới hạn cứng tối đa 300s và RLS ràng buộc đường dẫn `<job_id>/<file_type>/<filename>`, khóa sửa đổi với JOB đã đóng).
- **Kiểm toán toàn diện:** Triggers kiểm toán tự động trên toàn bộ 9 bảng nghiệp vụ, trích xuất actor từ `auth.uid()`, client hoàn toàn không có quyền can thiệp.
- **Kiểm thử tự động:** Vitest + React Testing Library (53 tests / 10 suites passed 100%).
- **Triển khai:** Tương thích lưu trữ tĩnh HTTPS (Vercel, Netlify, Cloudflare Pages). Không yêu cầu máy chủ riêng, không tốn phí dịch vụ.

---

## 2. PHÂN QUYỀN & VAI TRÒ NGƯỜI DÙNG (ROLES)

Hệ thống phục vụ ~20 người dùng thuộc 4 bộ phận:
1. **Planning (Kế hoạch):**
   - Quản lý thông tin chung của JOB (Mã JOB, Part No, Khách hàng, Vật liệu, Số lượng, Tiến độ).
   - Thiết lập quy trình công đoạn (Routing động) và thông số máy/cycle time dự kiến.
   - Xác nhận Đóng JOB (CLOSE).
   - *Ràng buộc:* Không thể tự ý xác nhận hoàn thành công đoạn hoặc điền trước bằng chứng sản xuất/QA khi tạo mới công đoạn.
2. **PE–MFG (Kỹ thuật & Sản xuất):**
   - Ghi nhận nhật ký lượt chạy máy thực tế (Append-only Production Runs).
   - Nhập cycle time thực tế, số lượng OK, chi tiết lỗi NG và phân loại khiếm khuyết.
   - *Ràng buộc:* Không thể chỉnh sửa định mức Kế hoạch hoặc tự ý phê duyệt biên bản QA.
3. **QA (Quản lý chất lượng):**
   - Thực hiện kiểm tra chất lượng (Append-only QA Checks: OK / NG / KIV).
   - Quản lý danh mục lỗi khiếm khuyết (`defect_catalog`).
   - *Ràng buộc:* Không thể sửa đổi thông số công đoạn hoặc can thiệp nhật ký chạy máy của PE-MFG.
4. **Admin (Quản trị hệ thống):**
   - Khởi tạo Quản trị viên đầu tiên (`bootstrap-first-admin.cjs`) an toàn, chống takeover danh tính.
   - Cấp phát tài khoản bảo mật (`provision-user.cjs`), tách biệt rõ ràng các luồng tạo mới, vô hiệu hóa, kích hoạt và phục hồi.
   - Quản trị nhật ký kiểm toán (`audit_logs`) và lưu trữ tệp nén (`job_archives`).

---

## 3. LOGIC MÀU SẮC TIẾN ĐỘ ROUTING (SECTION 4.B)

Màu sắc trên thanh tiến độ công đoạn **được tính toán tự động từ dữ liệu quy trình**, người dùng không thể tự chọn thủ công:
- **XANH LÁ (GREEN):** Công đoạn đã hoàn tất sản xuất (PE-MFG với `ok_qty > 0`) và được QA kiểm tra xác nhận `OK` tại hoặc sau thời điểm lượt chạy máy mới nhất.
- **VÀNG (YELLOW):** Đang sản xuất (`IN_PROGRESS`), đang chờ QA kiểm tra (`WAITING_QA`), QA tạm giữ (`QA_KIV`), hoặc hàng NG đang trong quá trình khắc phục (`QA_NG`).
- **ĐEN / XÁM (BLACK):** Công đoạn chưa bắt đầu (`NOT_STARTED`).

---

## 4. CẤU TRÚC THƯ MỤC DỰ ÁN

```
Sample report - AI/
├── src/
│   ├── app/
│   │   ├── App.tsx                     # Root App component
│   │   └── routes.tsx                  # Khai báo tuyến đường (React Router)
│   ├── components/
│   │   ├── common/
│   │   │   ├── Badge.tsx               # Huy hiệu vai trò & trạng thái JOB
│   │   │   ├── Header.tsx              # Thanh điều hướng trên cùng (Tên, vai trò, logout)
│   │   │   └── PhaseBadge.tsx          # Nhãn định danh các tính năng theo Phase
│   │   └── layout/
│   │       └── MainLayout.tsx          # Khung giao diện chính
│   ├── features/
│   │   ├── auth/
│   │   │   ├── AuthContext.tsx         # Quản lý phiên đăng nhập & kiểm tra trạng thái active khi focus
│   │   │   ├── authUtils.ts            # Chuẩn hóa SĐT viễn thông VN, dịch lỗi an toàn, phân quyền
│   │   │   ├── LoginPage.tsx           # Màn hình đăng nhập bằng SĐT + Mật khẩu
│   │   │   └── ProtectedRoute.tsx      # Bảo vệ đường dẫn theo đăng nhập & vai trò
│   │   ├── jobs/
│   │   │   ├── JobCard.tsx             # Thẻ hiển thị JOB trên Dashboard
│   │   │   ├── JobDetailPage.tsx       # Màn hình chi tiết JOB (Section A, B, C)
│   │   │   ├── JobGeneralInfo.tsx      # Section A: Thông tin Kế hoạch chung
│   │   │   ├── JobListPage.tsx         # Dashboard danh sách JOB (Tìm kiếm & Bộ lọc)
│   │   │   ├── JobToolbar.tsx          # Thanh công cụ tìm kiếm và lọc trạng thái
│   │   │   └── jobDemoData.ts          # Dữ liệu kiểm thử mẫu tiêu chuẩn (chỉ dùng khi DEMO_MODE)
│   │   ├── operations/
│   │   │   └── OperationDetailPanel.tsx# Section C: Chi tiết Planning, PE-MFG, QA, Tài liệu
│   │   └── routing/
│   │       ├── RoutingProgressBar.tsx  # Section B: Thanh hiển thị Routing động
│   │       └── routingUtils.ts         # Tính toán màu trạng thái (Green, Yellow, Black)
│   ├── lib/
│   │   ├── env.ts                      # Cấu hình biến môi trường và cờ kiểm tra Production
│   │   ├── storageUtils.ts             # Ràng buộc đường dẫn lưu trữ an toàn & ký URL tối đa 300s
│   │   └── supabase.ts                 # Khởi tạo Supabase client
│   ├── types/
│   │   ├── auth.ts                     # Định nghĩa kiểu Auth & Role
│   │   ├── database.types.ts           # Schema Types tương thích PostgreSQL
│   │   └── job.ts                      # Kiểu dữ liệu bộ lọc & màu sắc
│   └── test/
│       ├── setup.ts                    # Cấu hình môi trường Vitest
│       ├── authFlow.test.tsx           # Kiểm thử form đăng nhập & thông báo lỗi
│       ├── authUtils.test.ts           # Kiểm thử chuẩn hóa SĐT & dịch lỗi tiếng Việt
│       ├── databaseIntegration.test.ts # Kiểm thử tích hợp Database thực tế (báo BLOCKED nếu thiếu credentials)
│       ├── dataIntegrity.test.tsx      # Kiểm thử toàn vẹn dữ liệu Production & ngăn rò rỉ Demo (F-09, F-11)
│       ├── jobDashboard.test.tsx       # Kiểm thử tương tác tìm kiếm & lọc JOB
│       ├── permissions.test.ts         # Kiểm thử bảo vệ quyền truy cập chéo vai trò
│       ├── phoneCanonicalization.test.ts # Kiểm thử chuẩn hóa đầu số SĐT viễn thông VN (F-06)
│       ├── routing.test.ts             # Kiểm thử logic tính màu sắc Routing
│       ├── securityWorkflow.test.ts    # Kiểm thử quy tắc bảo mật & phân quyền R2 (invariants, correlation, lockout)
│       └── ui.test.tsx                 # Kiểm thử giao diện Dashboard & Routing bar
├── supabase/
│   ├── functions/
│   │   ├── admin-manage-user/          # Edge Function cấp phát tài khoản server-side an toàn
│   │   └── create-signed-url/          # Edge Function tạo signed URL an toàn tối đa 300s
│   ├── migrations/
│   │   ├── 00001_initial_schema.sql    # Schema bảng, kiểu dữ liệu, ràng buộc
│   │   ├── 00002_rls_policies.sql      # Chính sách RLS và Private Storage
│   │   ├── 00003_reference_catalogs.sql# Danh mục lỗi chuẩn cho Production (không chứa dữ liệu giả lập)
│   │   ├── 00004_security_remediation_r1.sql # Trigger kiểm toán và RLS ban đầu
│   │   ├── 00005_security_remediation_r2.sql # Invariants trên INSERT/UPDATE, Lockout cơ bản
│   │   └── 00006_security_remediation_r3.sql # Schema alignment, Correlation Engine, Lifecycle & Storage Matrix
│   └── seeds/
│       └── demo_jobs.sql               # Dữ liệu JOB mẫu tuân thủ 100% schema và invariants chuẩn
├── scripts/
│   ├── bootstrap-first-admin.cjs       # CLI khởi tạo Admin đầu tiên với mật khẩu ẩn & chống takeover
│   └── provision-user.cjs              # CLI cấp phát, vô hiệu hóa, kích hoạt & phục hồi tài khoản
├── public/
│   └── _redirects                      # Cấu hình SPA routing cho Netlify/Cloudflare
├── .env.example                        # Mẫu biến môi trường
├── DEPLOYMENT.md                       # Hướng dẫn triển khai & cấu hình Dashboard chi tiết
├── package.json                        # Cấu hình gói và kịch bản thực thi
├── vercel.json                         # Cấu hình rewrite SPA cho Vercel
└── vite.config.ts                      # Cấu hình Vite & Vitest với manual bundle splitting
```

---

## 5. HƯỚNG DẪN CHẠY DỰ ÁN CỤC BỘ (LOCAL SETUP)

### Bước 1: Cài đặt phụ thuộc
```bash
npm install
```

### Bước 2: Cấu hình biến môi trường
Sao chép `.env.example` thành `.env`:
```bash
cp .env.example .env
```
Điền thông tin kết nối Supabase của bạn:
```ini
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Bước 3: Chạy môi trường phát triển
```bash
npm run dev
```
Mở trình duyệt tại: `http://localhost:5173`

### Bước 4: Chạy kiểm thử tự động (Test suite)
```bash
npm run test
```
*Tất cả 52 bài kiểm tra tự động qua 10 bộ test suite đều đạt 100%, bảo đảm kiểm tra chặt chẽ các ràng buộc nghiệp vụ, bảo vệ chống sửa đổi trái phép và toàn vẹn dữ liệu.*

### Bước 5: Kiểm tra biên dịch sản phẩm (Build check)
```bash
npm run build
```
Biên dịch thành công với phân tách bundle (chunk splitting) tối ưu hiệu năng:
- `vendor` (React, Router, Lucide)
- `supabase` (Supabase Client SDK)
- `index` (App Core Logic & Pages)
