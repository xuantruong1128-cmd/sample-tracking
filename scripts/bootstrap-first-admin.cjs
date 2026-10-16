#!/usr/bin/env node
/**
 * ==============================================================================
 * SAMPLE TRACKING V1.0 — FIRST ADMIN BOOTSTRAP SCRIPT (R2 Remediation)
 * Safely provisions the initial system administrator with masked password prompts.
 * Strictly prevents Auth identity takeover: fails safely if identity already exists.
 * ==============================================================================
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load .env if present
const envPath = path.resolve(process.cwd(), '.env');
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

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('\n❌ Lỗi: Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Vui lòng cấu hình biến môi trường trước khi khởi tạo tài khoản Admin đầu tiên.\n');
  process.exit(1);
}

// Unified Vietnamese Mobile Prefixes (Matching authUtils.ts)
const VALID_VN_MOBILE_PREFIXES = [
  '32', '33', '34', '35', '36', '37', '38', '39', // Viettel
  '52', '55', '56', '58', '59',                   // Vietnamobile, Gmobile, Itelecom
  '70', '76', '77', '78', '79',                   // Mobifone
  '81', '82', '83', '84', '85',                   // Vinaphone
  '86', '87', '88', '89',                         // Viettel, Wintel, Vinaphone, Mobifone
  '90', '91', '92', '93', '94', '96', '97', '98', '99', // Classic prefixes
];

function canonicalizePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  let cleaned = rawPhone.trim().replace(/[\s\-.()]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.substring(1);
  if (!/^\d+$/.test(cleaned)) return null;

  let nineDigits = '';
  if (cleaned.startsWith('84')) {
    if (cleaned.length !== 11) return null;
    nineDigits = cleaned.substring(2);
  } else if (cleaned.startsWith('0')) {
    if (cleaned.length !== 10) return null;
    nineDigits = cleaned.substring(1);
  } else if (cleaned.length === 9) {
    nineDigits = cleaned;
  } else {
    return null;
  }

  const prefix = nineDigits.substring(0, 2);
  if (!VALID_VN_MOBILE_PREFIXES.includes(prefix)) {
    return null;
  }

  return {
    canonical: `+84${nineDigits}`,
    local: `0${nineDigits}`,
    email: `84${nineDigits}@sampletracking.local`,
  };
}

function promptHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    process.stdout.write(query);
    let pass = '';
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', (char) => {
        char = char + '';
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            process.stdin.setRawMode(false);
            process.stdout.write('\n');
            rl.close();
            resolve(pass);
            break;
          case '\u0003':
            process.exit();
            break;
          case '\u007f':
          case '\b':
            if (pass.length > 0) {
              pass = pass.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            pass += char;
            process.stdout.write('*');
            break;
        }
      });
    } else {
      rl.question('', (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    }
  });
}

function promptText(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function bootstrap() {
  console.log('\n============================================================');
  console.log('   SAMPLE TRACKING V1.0 — KHỞI TẠO TÀI KHOẢN ADMIN ĐẦU TIÊN   ');
  console.log('============================================================\n');

  // Check if an Admin already exists
  const { data: existingAdmins, error: adminCheckErr } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, phone')
    .eq('role', 'Admin')
    .eq('is_active', true);

  if (adminCheckErr) {
    console.error('❌ Lỗi kiểm tra cơ sở dữ liệu profiles:', adminCheckErr.message);
    process.exit(1);
  }

  if (existingAdmins && existingAdmins.length > 0) {
    console.log(`⚠️ Lưu ý: Hệ thống đã có ${existingAdmins.length} tài khoản Admin đang hoạt động:`);
    existingAdmins.forEach((a) => console.log(`   - ${a.full_name} (${a.phone})`));
    const confirm = await promptText('\nBạn có chắc chắn muốn khởi tạo thêm một Admin mới? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes') {
      console.log('Đã hủy thao tác.');
      process.exit(0);
    }
  }

  const rawPhone = await promptText('Nhập số điện thoại Admin (ví dụ: 0901234567): ');
  const phoneObj = canonicalizePhone(rawPhone);
  if (!phoneObj) {
    console.error('❌ Số điện thoại không hợp lệ. Vui lòng nhập số di động 10 chữ số với đầu số viễn thông Việt Nam hợp lệ (03x, 05x, 07x, 08x, 09x).');
    process.exit(1);
  }

  // Check if identity already exists in profiles or auth
  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role')
    .eq('phone', phoneObj.canonical)
    .single();

  if (existingProfile) {
    console.error(`\n❌ LỖI BẢO MẬT: Hồ sơ với số điện thoại ${phoneObj.local} đã tồn tại trong hệ thống (Họ tên: ${existingProfile.full_name}, Vai trò: ${existingProfile.role}).`);
    console.error('Không thể tự động ghi đè hoặc nâng cấp tài khoản qua script bootstrap.');
    console.error('Vui lòng đăng nhập bằng tài khoản Admin hiện có hoặc sử dụng quy trình quản trị người dùng riêng biệt.\n');
    process.exit(1);
  }

  const fullName = await promptText('Nhập họ và tên Admin: ');
  if (!fullName) {
    console.error('❌ Vui lòng nhập họ và tên.');
    process.exit(1);
  }

  const password = await promptHidden('Nhập mật khẩu an toàn (tối thiểu 8 ký tự): ');
  if (!password || password.length < 8) {
    console.error('❌ Mật khẩu phải có tối thiểu 8 ký tự.');
    process.exit(1);
  }

  const passwordConfirm = await promptHidden('Xác nhận lại mật khẩu: ');
  if (password !== passwordConfirm) {
    console.error('❌ Mật khẩu xác nhận không trùng khớp.');
    process.exit(1);
  }

  console.log('\n⏳ Đang tạo tài khoản Admin...');

  // Create Auth user
  const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: phoneObj.email,
    phone: phoneObj.canonical,
    password: password,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: {
      phone: phoneObj.canonical,
      local_phone: phoneObj.local,
      full_name: fullName,
      role: 'Admin',
      department: 'Hệ thống Quản trị',
    },
  });

  if (authErr) {
    // FAIL SAFELY: Never promote or overwrite an existing unexpected Auth identity (F-05 Takeover Prevention)
    console.error(`\n❌ LỖI TẠO TÀI KHOẢN AUTH: ${authErr.message}`);
    if (authErr.message.includes('already registered')) {
      console.error('CẢNH BÁO BẢO MẬT: Danh tính xác thực (Email/Phone) đã tồn tại trong Supabase Auth nhưng chưa có hồ sơ hợp lệ.');
      console.error('Hệ thống từ chối tự động nâng cấp danh tính chưa xác thực thành Admin.');
      console.error('Vui lòng kiểm tra Supabase Auth Dashboard và xóa danh tính mồ côi nếu có.');
    }
    process.exit(1);
  }

  const userId = authUser.user.id;

  // Insert profile record
  const { error: pErr } = await supabaseAdmin.from('profiles').insert({
    id: userId,
    phone: phoneObj.canonical,
    email: phoneObj.email,
    full_name: fullName,
    role: 'Admin',
    department: 'Ban Quản Trị Hệ Thống',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (pErr) {
    console.error('❌ Lỗi khởi tạo hồ sơ profiles:', pErr.message);
    // Cleanup auth user to prevent orphaned identity
    await supabaseAdmin.auth.admin.deleteUser(userId);
    process.exit(1);
  }

  console.log('\n✅ KHỞI TẠO ADMIN THÀNH CÔNG!');
  console.log(`• SĐT: ${phoneObj.local} (${phoneObj.canonical})`);
  console.log(`• Họ tên: ${fullName}`);
  console.log(`• Vai trò: Admin\n`);
}

bootstrap().catch((err) => {
  console.error('\n❌ Khởi tạo thất bại:', err.message || err);
  process.exit(1);
});
