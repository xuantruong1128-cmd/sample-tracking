#!/usr/bin/env node
/**
 * ==============================================================================
 * SAMPLE TRACKING V1.0 — SECURE ADMIN PASSWORD RESET TOOL
 * Target Project: hosppagbopdghlupnhlr (Supabase TEST)
 * Account: 0968041128 (84968041128@sampletracking.local)
 * ==============================================================================
 * Security Invariants:
 *  - Uses auth.admin.updateUserById() via SUPABASE_SERVICE_ROLE_KEY
 *  - Prompts for new password with masked hidden input (*)
 *  - Verifies confirmation password match and minimum 8-character length
 *  - Zero password or secret logging in terminal, stdout, stderr, or reports
 *  - Preserves user ID, phone, role, profiles, and all JOB data
 * ==============================================================================
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// 1. Load environment variables
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...rest] = trimmed.split('=');
      const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = val;
      }
    }
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_TEST_SERVICE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('\n❌ Lỗi: Thiếu cấu hình SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong file .env.');
  console.error('Vui lòng kiểm tra file .env trên máy để đảm bảo có khóa quản trị trước khi chạy script.\n');
  process.exit(1);
}

// 2. Target safety validation: ensure only targeting Supabase TEST
if (!supabaseUrl.includes('hosppagbopdghlupnhlr')) {
  console.error('\n❌ CẢNH BÁO BẢO VỆ: Script chỉ được phép chạy trên Supabase TEST (hosppagbopdghlupnhlr).');
  console.error(`URL hiện tại: ${supabaseUrl}`);
  process.exit(1);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const anonClient = createClient(supabaseUrl, anonKey || '', {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Helper: Masked hidden password input
function promptHiddenPassword(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    process.stdout.write(promptText);
    let password = '';

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const onData = (chunk) => {
        const char = chunk.toString();
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl+D
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            rl.close();
            resolve(password);
            break;
          case '\u0003': // Ctrl+C
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write('\nĐã hủy thao tác.\n');
            process.exit(0);
            break;
          case '\u007f': // Backspace (Unix)
          case '\b':     // Backspace (Windows)
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            password += char;
            process.stdout.write('*');
            break;
        }
      };

      process.stdin.on('data', onData);
    } else {
      // Non-TTY fallback (piped input)
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function main() {
  console.log('================================================================================');
  console.log('       SAMPLE TRACKING — CÔNG CỤ ĐẶT LẠI MẬT KHẨU ADMIN (TEST)');
  console.log('================================================================================');
  console.log(`Dự án mục tiêu:  hosppagbopdghlupnhlr (Supabase TEST)`);
  console.log(`Tài khoản Admin: SĐT 0968041128 | Auth Email: 84968041128@sampletracking.local\n`);

  // Step 1: Identify exact Admin account in Supabase Auth
  console.log('🔍 Bước 1: Đang tìm kiếm và xác thực tài khoản Admin trong hệ thống...');
  const { data: usersData, error: listErr } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    console.error(`❌ Lỗi truy vấn Auth users: ${listErr.message}`);
    process.exit(1);
  }

  const targetEmail = '84968041128@sampletracking.local';
  const targetPhone = '84968041128';
  const adminUser = usersData.users.find(
    (u) => u.email?.toLowerCase() === targetEmail || u.phone === targetPhone
  );

  if (!adminUser) {
    console.error(`❌ Không tìm thấy tài khoản Admin với email [${targetEmail}] hoặc phone [${targetPhone}] trong Supabase Auth.`);
    process.exit(1);
  }

  // Step 2: Verify corresponding profile in public.profiles
  const { data: profile, error: profErr } = await adminClient
    .from('profiles')
    .select('id, full_name, phone, role, is_active, must_change_password')
    .eq('id', adminUser.id)
    .single();

  if (profErr || !profile) {
    console.error(`❌ Không tìm thấy hồ sơ tương ứng trong bảng profiles: ${profErr?.message || 'Không có bản ghi'}`);
    process.exit(1);
  }

  if (profile.role !== 'Admin') {
    console.error(`❌ Cảnh báo an toàn: Tài khoản này có vai trò [${profile.role}], không phải [Admin]. Dừng thao tác.`);
    process.exit(1);
  }

  console.log('  ✅ Đã xác định chính xác tài khoản Admin:');
  console.log(`     - User ID:     ${adminUser.id}`);
  console.log(`     - Họ tên:      ${profile.full_name}`);
  console.log(`     - Vai trò:     ${profile.role}`);
  console.log(`     - SĐT Profile: ${profile.phone}`);
  console.log(`     - Trạng thái:  ${profile.is_active ? 'Đang hoạt động (Active)' : 'Bị vô hiệu'}\n`);

  // Step 3: Prompt for new password with hidden input and confirmation
  console.log('🔒 Bước 2: Nhập mật khẩu mới bằng phương thức ẩn ký tự (*)...');
  let newPassword = '';
  let confirmPassword = '';

  while (true) {
    newPassword = await promptHiddenPassword('👉 Nhập mật khẩu mới (tối thiểu 8 ký tự): ');
    newPassword = newPassword.trim();

    if (!newPassword || newPassword.length < 8) {
      console.log('   ⚠️ Mật khẩu phải có tối thiểu 8 ký tự. Vui lòng thử lại.\n');
      continue;
    }

    if (newPassword === '123456') {
      console.log('   ⚠️ Mật khẩu không được là mật khẩu mặc định "123456". Vui lòng chọn mật khẩu an toàn.\n');
      continue;
    }

    confirmPassword = await promptHiddenPassword('👉 Xác nhận lại mật khẩu mới: ');
    confirmPassword = confirmPassword.trim();

    if (newPassword !== confirmPassword) {
      console.log('   ⚠️ Hai lần nhập mật khẩu không trùng khớp. Vui lòng nhập lại từ đầu.\n');
      continue;
    }

    break;
  }

  // Step 4: Execute updateUserById
  console.log('\n⏳ Bước 3: Đang cập nhật mật khẩu qua Supabase Admin API auth.admin.updateUserById()...');
  const { error: updateErr } = await adminClient.auth.admin.updateUserById(adminUser.id, {
    password: newPassword,
    email_confirm: true,
  });

  if (updateErr) {
    console.error(`\n❌ Cập nhật mật khẩu thất bại: ${updateErr.message}`);
    process.exit(1);
  }

  // Step 5: Ensure profile must_change_password is false so user can log in directly
  await adminClient
    .from('profiles')
    .update({
      must_change_password: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminUser.id);

  // Step 6: Verify login via anonClient (Authentication Verification)
  console.log('🧪 Bước 4: Kiểm tra xác thực tự động (Verify authentic login)...');
  const { data: testLogin, error: testLoginErr } = await anonClient.auth.signInWithPassword({
    email: targetEmail,
    password: newPassword,
  });

  if (testLoginErr || !testLogin?.user) {
    console.error(`\n⚠️ Cảnh báo: Cập nhật thành công nhưng đăng nhập thử nghiệm thất bại: ${testLoginErr?.message}`);
    process.exit(1);
  }

  await anonClient.auth.signOut();
  console.log('  ✅ Đăng nhập kiểm tra thành công 100%!');

  // Final Output
  console.log('\n================================================================================');
  console.log('🎉 ĐẶT LẠI MẬT KHẨU ADMIN THÀNH CÔNG!');
  console.log('================================================================================');
  console.log(`• Trang web:      https://sample-tracking-89b.pages.dev`);
  console.log(`• Số điện thoại:  0968041128`);
  console.log(`• Mật khẩu:       [Đã được cập nhật thành mật khẩu mới bạn vừa nhập]`);
  console.log(`• Trạng thái:     Sẵn sàng đăng nhập ngay lập tức`);
  console.log('================================================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Lỗi thực thi không mong muốn:', err.message || err);
  process.exit(1);
});
