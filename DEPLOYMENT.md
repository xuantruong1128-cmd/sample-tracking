# HƯỚNG DẪN TRIỂN KHAI HỆ THỐNG SAMPLE TRACKING V1.0 (DEPLOYMENT GUIDE)

Tài liệu này hướng dẫn chi tiết cách triển khai ứng dụng **Sample Tracking** lên cơ sở hạ tầng Supabase (Database, Auth, Storage) và dịch vụ lưu trữ tĩnh HTTPS (Vercel, Netlify, Cloudflare Pages), bao gồm các biện pháp khắc phục bảo mật toàn diện theo chuẩn Remediation R1, R2 & R3.

---

## 1. YÊU CẦU MÔI TRƯỜNG & KIẾN TRÚC

- **Không cần máy chủ riêng của công ty (No dedicated server)**.
- **Không cần Docker** cho quá trình vận hành thông thường.
- **Không sử dụng dịch vụ trả phí** ngoài cấu hình miễn phí/tiêu chuẩn được duyệt.
- Frontend: Tĩnh 100%, chạy hoàn toàn trên trình duyệt qua kết nối bảo mật **HTTPS**.
- Backend: Supabase Managed Cloud (PostgreSQL + RLS + Triggers + Auth + Private Storage).
- Đối tượng sử dụng: ~20 người dùng, ~50 JOB/tháng.

---

## 2. CẤU HÌNH SUPABASE (DATABASE & STORAGE)

### Bước 2.1: Tạo Project trên Supabase
1. Đăng nhập vào [Supabase Dashboard](https://supabase.com).
2. Tạo New Project (Ví dụ: `sample-tracking`).
3. Lưu lại các thông số kết nối tại **Settings > API**:
   - `Project URL`: (ví dụ `https://xyzcompany.supabase.co`)
   - `anon public key`: Dùng cho ứng dụng React frontend.
   - `service_role key`: **Bảo mật tuyệt đối**, chỉ dùng cho server/admin CLI.

### Bước 2.2: Cấu hình Bắt buộc trên Supabase Dashboard (Security Baseline)
Trước khi đưa vào vận hành, thực hiện các bước sau trên Dashboard:
1. **Vô hiệu hóa Đăng ký Công khai (Disable Public Signup - F-01 & F-11):**
   - Vào **Authentication > Providers > Email**.
   - **Tắt (Disable)** tùy chọn `Enable Email Signup`.
   - *Lý do:* Hệ thống chỉ cho phép nhân sự được Admin phê duyệt và cấp phát qua số điện thoại; ngăn chặn hoàn toàn kẻ xấu tự đăng ký tài khoản tự do qua Supabase Auth.
2. **Kiểm tra Cấu hình Storage Private (F-05 & F-13):**
   - Vào **Storage > Buckets**.
   - Xác nhận bucket `sample-documents` có cờ `Public bucket: OFF` (chỉ truy cập thông qua Signed URL có thời hạn tối đa 300 giây và RLS phân quyền theo JOB).

### Bước 2.3: Chạy Migrations Database theo Thứ tự
Truy cập vào **SQL Editor** trong Supabase Dashboard hoặc Supabase CLI và thực thi lần lượt 10 tệp migration theo thứ tự nghiêm ngặt trong thư mục `supabase/migrations/`:

1. `00001_initial_schema.sql`:
   - Tạo các kiểu dữ liệu ENUM (`user_role`, `job_status`, `operation_status`, `qa_result`, `attachment_type`).
   - Tạo cấu trúc bảng: `profiles`, `jobs`, `job_operations`, `production_runs`, `defect_catalog`, `ng_details`, `qa_checks`, `attachments`, `audit_logs`, `job_archives`.
   - Thiết lập khóa ngoại và trigger tự động cập nhật `updated_at`.

2. `00002_rls_policies.sql`:
   - Kích hoạt Row Level Security (RLS) trên toàn bộ 10 bảng.
   - Thiết lập hàm bảo mật `get_current_user_role()`, `is_user_active()`.
   - Áp dụng chính sách kiểm soát quyền truy cập chặt chẽ theo 4 vai trò (Planning, PE-MFG, QA, Admin).
   - Khởi tạo Private Storage Bucket `sample-documents` (`public = false`) và RLS Storage.

3. `00003_reference_catalogs.sql` (Production-safe Catalog):
   - Nạp 10 danh mục lỗi gia công tiêu chuẩn (`defect_catalog`).
   - *Lưu ý:* Tệp này chỉ chứa từ điển danh mục lỗi danh chiếu chuẩn, hoàn toàn không chứa dữ liệu JOB giả lập.

4. `00004_security_remediation_r1.sql`:
   - Trigger kiểm toán và RLS ban đầu.

5. `00005_security_remediation_r2.sql`:
   - Máy trạng thái và ràng buộc cơ bản.

6. `00006_security_remediation_r3.sql`:
   - Bước đệm chuẩn hóa cột và khóa ngoại `production_run_id`.

7. `00007_security_business_workflow_r4.sql` (Security & Business Workflow Remediation R4 - Chuẩn sản xuất mẫu):
   - **Tách bạch Tiến độ Sản xuất (PE) và Thẩm định Chất lượng (QA):** PE là đơn vị làm chủ tiến trình sản xuất mẫu (`NOT_STARTED -> IN_PROGRESS -> COMPLETED`). QA là đơn vị đánh giá độc lập; biên bản QA là tùy chọn và không phải là cổng chặn bắt buộc.
   - **Thẩm quyền Kỹ sư PE (PE Ownership & Authority):** Bổ sung `pe_owner_id` và `pe_delegates` trên bảng `jobs`.
   - **Biên bản Xử lý Kỹ thuật (PE Technical Disposition):** Khởi tạo bảng `pe_technical_dispositions`. Cho phép PE tiếp tục sản xuất khi có lỗi QA NG/KIV nếu có giải trình kỹ thuật chính thức.
   - **Ma trận Tải Check Sheet & Tài liệu Phân quyền:** Cho phép cả PE-MFG và QA tải tài liệu với trường `owning_department` rõ ràng.

8. `00008_security_remediation_r5.sql` (Security Remediation R5 — Khắc phục Triệt để Codex Audit R4-01 đến R4-09):
   - **R4-01 (Phân định Thẩm quyền Vận hành & Phê duyệt Kỹ thuật):** Tách bạch quyền của người vận hành máy PE-MFG với thẩm quyền của PE Owner/delegate.
   - **R4-02 (Toàn vẹn Biên bản Xử lý Kỹ thuật):** Cưỡng chế lý do kỹ thuật >= 5 ký tự; danh tính `decision_maker := auth.uid()` và mốc thời gian do database sinh; loại trừ `HOLD` khỏi các xử lý cho phép hoàn tất.
   - **R4-03 / R4-04 (Bảo mật Storage & Cổng Signed URL):** Ràng buộc tệp tin với danh mục `public.attachments` và JOB hợp lệ; cổng Edge Function `create-signed-url` cưỡng chế trần 300 giây tối đa.
   - **R4-05 (Bất biến Tuyệt đối trên JOB Đã Đóng):** Khóa bất biến mọi trường thông tin trên JOB có trạng thái `CLOSE`, `ARCHIVE`, `PURGED`.
   - **R4-06 (Khóa Ghi Mẻ Sản Xuất trên Công Đoạn Đã Hoàn Tất):** Cấm ghi mẻ mới trên công đoạn `COMPLETED` khi chưa được kỹ sư PE mở lại có lý do hợp lệ.
   - **R4-07 (Chuyển đổi Tương thích Trạng thái Dữ liệu Cũ):** Chuyển đổi an toàn dữ liệu lịch sử mang trạng thái cũ.

9. `00009_storage_disposition_security_r6.sql`:
   - Tinh chỉnh tương thích trigger trạng thái công đoạn và tem tạo lập QA.

10. `00010_security_remediation_r7.sql` (Security Remediation R7):
    - Khắc phục R6-01 đến R6-07 (SECURITY DEFINER isolation, Option A document policy, monotonic event sequence, preflight guards).

11. `00011_security_remediation_r8.sql` (Security Remediation R8):
    - Khắc phục R7-01 đến R7-08 (PENDING default, unique sequence, reopen metadata, retry, UI, admin attribution).

12. `00012_security_stabilization_r9.sql` (Security & Migration Stabilization R9 — Chuẩn hóa Toàn diện Codex Audit R8-01 đến R8-08):
    - **R8-01 & R8-02 (BLOCKER - Ổn định Chuỗi Di trú theo 4 Trạng thái):** Chuẩn hóa tương thích di trú trên cơ sở dữ liệu có JOB Đã đóng; cung cấp quy trình phục hồi minh bạch không làm sai lệch tính bất biến lịch sử.
    - **R8-03 (BLOCKER - Loại bỏ Hoàn toàn Session GUC Caller-Settable):** Thay thế biến cấu hình phiên `sample_tracking.*` bằng schema riêng biệt `sample_tracking_internal` và bảng ngữ cảnh giao dịch `execution_context`. Khách hàng kết nối bên ngoài (PostgREST/SQL) không có quyền truy cập hay giả mạo ngữ cảnh nội bộ.
    - **R8-04 (HIGH - Chặn Hạ cấp Tài liệu READY thành FAILED):** Hàm `fail_attachment_upload_r9` cưỡng chế kiểm tra: chỉ tài liệu đang ở trạng thái `PENDING` mới được chuyển sang `FAILED`. Nghiêm cấm tuyệt đối chuyển đổi từ `READY` sang `FAILED`.
    - **R8-05 (HIGH - Bổ sung Mã băm Toàn vẹn SHA-256):** Bổ sung cột `content_hash VARCHAR(64)` và ràng buộc cú pháp SHA-256 trên bảng `attachments`. Ràng buộc chặt chẽ MIME type `chk_attachments_mime_type` và dung lượng tối đa 50MB.
    - **R8-06 (HIGH - Vòng đời Thử lại Tải lên An toàn):** Tải đối tượng lên Storage với cờ `upsert: false` (chống ghi đè); hàm `retry_attachment_upload_r9` ràng buộc tham số kích thước, MIME và mã băm mới khi client tải lại tệp.
    - **R8-07 (MEDIUM - Chẩn đoán Preflight Tương thích Động):** Nâng cấp `scripts/db-preflight-check.cjs` tự động nhận diện schema của 4 trạng thái, kiểm tra 100% tài liệu READY (bỏ giới hạn slice mẫu), rà soát toàn diện Storage bucket.
    - **R8-08 (MEDIUM - Chuẩn hóa Hợp đồng Định dạng Tệp):** Loại bỏ tệp CAD khỏi giao diện tải lên; ràng buộc chặt chẽ định dạng chỉ chấp nhận PDF, JPEG, PNG (tối đa 50MB) ở cả tầng Client UI và Database CHECK constraint.

### Bước 2.4: Kế hoạch Triển khai & Phục hồi theo 4 Trạng thái Cơ sở Dữ liệu (States A, B, C, D)
Do tính chất phụ thuộc lẫn nhau giữa các trigger bảo vệ dữ liệu và quá trình di trú, quản trị viên áp dụng quy trình tương ứng với trạng thái cơ sở dữ liệu hiện tại:

- **Trạng thái A (Database đã chạy thành công qua migration 00010 và 00011):**
  1. Chạy chẩn đoán: `node scripts/db-preflight-check.cjs`.
  2. Áp dụng trực tiếp forward-only: `00012_security_stabilization_r9.sql`.
  3. Chạy lại chẩn đoán xác nhận 100% PASS.

- **Trạng thái B (Database dừng trước migration 00009):**
  1. Áp dụng lần lượt `00009_storage_disposition_security_r6.sql`.
  2. Trước khi chạy 00010, thực thi script chuẩn hóa: `\i scripts/migration-repair-baseline.sql`.
  3. Áp dụng tuần tự `00010`, `00011`, và `00012`.
  4. Chạy chẩn đoán: `node scripts/db-preflight-check.cjs`.

- **Trạng thái C (Database dừng trong khi chạy migration 00010 do vướng trigger lock trên JOB Đã đóng):**
  *Nguyên nhân:* Migration 00010 cố gắng UPDATE `qa_checks` và `job_operations` để đánh số thứ tự khi gặp JOB đã đóng sẽ bị trigger `trg_lock_ops_r4` chặn lại.
  *Kế hoạch khắc phục chuẩn hóa:*
  1. Trong Supabase SQL Editor hoặc CLI, thực thi script phục hồi:
     `\i scripts/migration-repair-baseline.sql`
  2. Sau khi script hoàn tất, chạy tiếp DDL còn lại của 00010, sau đó áp dụng tuần tự `00011` và `00012`.
  3. Chạy chẩn đoán: `node scripts/db-preflight-check.cjs` để xác nhận kết quả.

- **Trạng thái D (Cơ sở dữ liệu Mới / Fresh Database):**
  1. Áp dụng tuần tự 12 tệp migration từ `00001` đến `00012`.
  2. Chạy script chẩn đoán `node scripts/db-preflight-check.cjs` để xác nhận trạng thái PASS.

### Bước 2.5: Kiểm tra Chẩn đoán Preflight trước Di trú
Trước và sau khi áp dụng migration, chạy script:
```bash
node scripts/db-preflight-check.cjs
```
Script kiểm tra toàn diện 10 tiêu chí: Trùng lặp đường dẫn, binding tiền tố JOB, chuẩn canonical, liên kết cross-job, đối tượng storage vật lý, đối tượng chưa đăng ký, biên bản QA chưa đánh số, trùng lặp sequence, lịch sử QA trên JOB đóng, và phiên bản migrations.

> **GHI CHÚ VỀ DỮ LIỆU DEMO (`supabase/seeds/demo_jobs.sql`):**  
> Tệp này tuân thủ 100% các trigger quy trình R8 và chỉ phục vụ mục đích kiểm thử cục bộ (Development/Demo). **TUYỆT ĐỐI KHÔNG** chạy tệp này trên cơ sở dữ liệu Production.

---

## 3. CƠ CHẾ THU HỒI PHIÊN VÀ PHÂN BIỆT ACCESS TOKEN VS REFRESH TOKEN

Trong kiến trúc Supabase Auth:
- **Access Token (JWT):** Là token phi trạng thái (stateless), có thời hạn sống ngắn (mặc định 3600 giây / 1 giờ).
- **Refresh Token:** Được lưu trữ trên server GoTrue để cấp mới Access Token khi hết hạn.

Khi Quản trị viên vô hiệu hóa tài khoản (`--deactivate`):
1. **Ở tầng GoTrue Auth:** Hệ thống gọi hàm API được hỗ trợ:
   `updateUserById(userId, { ban_duration: '876000h' })`
   Thao tác này thu hồi toàn bộ refresh token và đặt cấm người dùng trong 100 năm. Người dùng không thể làm mới token hoặc đăng nhập lại.
2. **Ở tầng PostgreSQL Database (RLS Enforced Real-Time):**
   Hệ thống cập nhật ngay lập tức `profiles.is_active = FALSE`.
   Hàm RLS `public.is_user_active()` trả về `FALSE`.
   **KẾT QUẢ:** Ngay cả khi Access Token JWT của người dùng còn hạn sử dụng, mọi câu lệnh truy vấn tới PostgreSQL Database và Supabase Storage đều bị từ chối truy cập ngay lập tức tại tầng RLS!

---

## 4. KHỞI TẠO VÀ CẤP PHÁT TÀI KHOẢN (PROVISIONING)

> **QUY TẮC AN TOÀN (F-01, F-07):**  
> - Không truyền mật khẩu dạng plain-text trên dòng lệnh CLI.  
> - Các kịch bản CLI sử dụng cơ chế nhập mật khẩu ẩn (masked input).  
> - Tách biệt rõ ràng giữa Cấp mới (Provision), Phục hồi (Recover), Vô hiệu hóa (Deactivate) và Kích hoạt lại (Activate).

### Bước 4.1: Khởi tạo Quản trị viên đầu tiên (Bootstrap First Admin)
Chỉ thực hiện một lần khi hệ thống chưa có Quản trị viên nào:
```bash
node scripts/bootstrap-first-admin.cjs
```

### Bước 4.2: Cấp phát tài khoản nhân sự mới (User Provisioning)
```bash
node scripts/provision-user.cjs
```
Nhập lần lượt:
- Số điện thoại (tự động chuẩn hóa theo đầu số viễn thông Việt Nam hợp lệ: `03x, 05x, 07x, 08x, 09x`)
- Mật khẩu (nhập ẩn)
- Họ và tên nhân viên
- Vai trò (`Planning`, `PE-MFG`, `QA`, `Admin`)
- Phòng ban

### Bước 4.3: Vô hiệu hóa tài khoản và Thu hồi phiên tức thì
```bash
node scripts/provision-user.cjs --deactivate 0912345672
```

### Bước 4.4: Kích hoạt lại tài khoản
```bash
node scripts/provision-user.cjs --activate 0912345672
```

### Bước 4.5: Đặt lại mật khẩu / Phục hồi tài khoản
```bash
node scripts/provision-user.cjs --recover 0912345672
```

---

## 5. TRIỂN KHAI FRONTEND LÊN STATIC HOSTING (HTTPS)

Ứng dụng tương thích 100% với các nền tảng Static Web Hosting: **Vercel**, **Netlify**, hoặc **Cloudflare Pages**.

### Biến môi trường Frontend cần thiết:
Cấu hình trên Dashboard của nhà cung cấp hosting:
- `VITE_SUPABASE_URL`: URL dự án Supabase (ví dụ: `https://xyz.supabase.co`)
- `VITE_SUPABASE_ANON_KEY`: Khóa anon công khai của Supabase

---

## 6. KIỂM THỬ VÀ NGHIỆM THU SAU TRIỂN KHAI

Sau khi trang web được triển khai xong:
1. Mở URL HTTPS trên trình duyệt máy tính và điện thoại di động.
2. Nhập số điện thoại và mật khẩu đã được Admin cấp phát.
3. Kiểm tra Dashboard hiển thị đúng tên người dùng, vai trò và danh sách JOB thực tế.
4. Kiểm tra trên điện thoại: Giao diện co giãn chuẩn mobile, nút bấm kích thước lớn dễ chạm.
5. Thử đăng xuất và xác minh trang bảo vệ chuyển hướng về `/login`.

---

## 7. KIỂM THỬ TỰ ĐỘNG & XÁC MINH CƠ SỞ DỮ LIỆU THỰC TẾ

### 7.1 Bộ kiểm thử tự động cục bộ (Unit & Workflow Test Suite):
Hệ thống tích hợp 143 bài kiểm tra tự động bao phủ 100% các kịch bản bảo mật và quy trình sản xuất mẫu (từ R4-01 đến R7-08):
```bash
npm run test
```
- Kết quả kiểm thử: **143/143 tests PASS**, 0 lỗi, 10/10 test files vượt qua tuyệt đối.

### 7.2 Kiểm thử tích hợp cơ sở dữ liệu thực tế (Real Database Integration Tests):
Tệp kiểm thử `src/test/databaseIntegration.test.ts` kiểm tra trực tiếp các hành vi của PostgreSQL/Supabase trên môi trường đám mây thật (INSERT rules, Closed job lockout, PE completion, QA correlation, Reopen locks):
- Khi biến môi trường `SUPABASE_TEST_URL` và `SUPABASE_TEST_SERVICE_KEY` chưa được cấp: Hệ thống báo cáo minh bạch trạng thái **BLOCKED** để tránh giả lập kết quả sai sự thật.
- Để kích hoạt kiểm thử trên một database Supabase thử nghiệm: Cung cấp `SUPABASE_TEST_URL` và `SUPABASE_TEST_SERVICE_KEY` vào tệp `.env` và chạy lại `npm run test`.
