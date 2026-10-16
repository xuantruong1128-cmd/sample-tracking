#!/usr/bin/env node
/**
 * ==============================================================================
 * SAMPLE TRACKING V1.0 — SECURE USER PROVISIONING & IDENTITY MANAGEMENT (R2)
 * Features:
 *   - Admin-only execution using SUPABASE_SERVICE_ROLE_KEY
 *   - Unified canonical Vietnamese phone validation
 *   - Protected password inputs (no plain-text in shell history)
 *   - Strictly separated flows:
 *       1. Default: New user provisioning (fails safely if user already exists)
 *       2. --deactivate <phone>: Marks profile inactive, revokes refresh tokens & bans user
 *       3. --activate <phone>: Re-activates profile and lifts ban
 *       4. --recover <phone>: Explicit password reset / recovery for existing users
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
  console.error('\n❌ Lỗi: Cần cấu hình SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Ví dụ trong tệp .env:');
  console.error('  SUPABASE_URL=https://your-project.supabase.co');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=your-secret-service-role-key\n');
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

function canonicalizeVietnamesePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { isValid: false, error: 'Vui lòng cung cấp số điện thoại.' };
  }

  let cleaned = rawPhone.trim().replace(/[\s\-.()]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.substring(1);

  if (!/^\d+$/.test(cleaned)) {
    return { isValid: false, error: 'Số điện thoại chỉ được chứa chữ số.' };
  }

  let nineDigits = '';
  if (cleaned.startsWith('84')) {
    if (cleaned.length !== 11) {
      return { isValid: false, error: 'Số định dạng quốc tế 84 phải có đúng 11 chữ số.' };
    }
    nineDigits = cleaned.substring(2);
  } else if (cleaned.startsWith('0')) {
    if (cleaned.length !== 10) {
      return { isValid: false, error: 'Số điện thoại di động Việt Nam phải có đúng 10 chữ số.' };
    }
    nineDigits = cleaned.substring(1);
  } else if (cleaned.length === 9) {
    nineDigits = cleaned;
  } else {
    return { isValid: false, error: 'Độ dài số điện thoại không hợp lệ.' };
  }

  const prefix = nineDigits.substring(0, 2);
  if (!VALID_VN_MOBILE_PREFIXES.includes(prefix)) {
    return { isValid: false, error: `Đầu số di động "0${prefix}" không hợp lệ tại Việt Nam.` };
  }

  const canonicalPhone = `+84${nineDigits}`;
  const localPhone = `0${nineDigits}`;
  const aliasEmail = `84${nineDigits}@sampletracking.local`;

  return {
    isValid: true,
    canonicalPhone,
    localPhone,
    aliasEmail,
  };
}

function promptHiddenPassword(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    process.stdout.write(query);
    let password = '';

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
            resolve(password);
            break;
          case '\u0003':
            process.exit();
            break;
          case '\u007f':
          case '\b':
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
      });
    } else {
      rl.question('', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function promptText(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const args = process.argv.slice(2);

  // =========================================================================
  // ACTION: DEACTIVATE ACCOUNT
  // =========================================================================
  if (args[0] === '--deactivate') {
    const rawPhone = args[1];
    if (!rawPhone) {
      console.error('❌ Cách dùng: node scripts/provision-user.cjs --deactivate <phone>');
      process.exit(1);
    }

    const phoneRes = canonicalizeVietnamesePhone(rawPhone);
    if (!phoneRes.isValid) {
      console.error(`❌ Số điện thoại không hợp lệ: ${phoneRes.error}`);
      process.exit(1);
    }

    console.log(`\n🔒 Đang vô hiệu hóa tài khoản: ${phoneRes.canonicalPhone} (${phoneRes.localPhone})...`);

    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, role, is_active')
      .eq('phone', phoneRes.canonicalPhone)
      .single();

    if (pErr || !profile) {
      console.error('❌ Không tìm thấy hồ sơ người dùng tương ứng.');
      process.exit(1);
    }

    const previousIsActive = Boolean(profile.is_active);

    // 1. Mark is_active = false in PostgreSQL profiles
    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', profile.id);

    if (updateErr) {
      console.error('❌ Lỗi cập nhật trạng thái trong database:', updateErr.message);
      process.exit(1);
    }

    // 2. Revoke refresh tokens and ban user in GoTrue Auth (Supported SDK Session Revocation)
    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      ban_duration: '876000h', // 100 years ban
    });

    if (banErr) {
      console.error('❌ Lỗi thu hồi phiên và vô hiệu hóa tài khoản trong Auth:', banErr.message);
      // R4-08: Safe rollback to captured previous state and verify rollback execution
      const { error: rollbackErr } = await supabaseAdmin
        .from('profiles')
        .update({ is_active: previousIsActive, updated_at: new Date().toISOString() })
        .eq('id', profile.id);

      if (rollbackErr) {
        console.error('CRITICAL: Rollback failed! Inconsistent state detected:', rollbackErr.message);
      } else {
        console.error(`🔄 Đã khôi phục lại trạng thái hồ sơ profiles về previousIsActive=${previousIsActive} (Rollback).`);
      }
      process.exit(1);
    }

    // 3. Record and verify audit log entry (R4-08)
    const { error: auditErr } = await supabaseAdmin.from('audit_logs').insert({
      action: 'CLI_DEACTIVATE_USER',
      entity_type: 'profiles',
      entity_id: profile.id,
      old_values: { is_active: previousIsActive },
      new_values: { is_active: false, ban_duration: '876000h' },
      created_at: new Date().toISOString(),
    });

    if (auditErr) {
      console.warn('⚠️ Cảnh báo: Thao tác vô hiệu hóa thành công nhưng ghi audit_logs thất bại:', auditErr.message);
    }

    console.log(`🔑 Đã thu hồi toàn bộ token làm mới (Refresh Tokens Revoked & User Banned).`);
    console.log(`🛡️ RLS Database ngay lập tức từ chối mọi truy vấn từ tài khoản này.`);
    console.log(`✅ Đã vô hiệu hóa thành công tài khoản [${profile.full_name} - ${profile.role}].\n`);
    process.exit(0);
  }

  // =========================================================================
  // ACTION: ACTIVATE / UNBAN ACCOUNT
  // =========================================================================
  if (args[0] === '--activate') {
    const rawPhone = args[1];
    if (!rawPhone) {
      console.error('❌ Cách dùng: node scripts/provision-user.cjs --activate <phone>');
      process.exit(1);
    }

    const phoneRes = canonicalizeVietnamesePhone(rawPhone);
    if (!phoneRes.isValid) {
      console.error(`❌ Số điện thoại không hợp lệ: ${phoneRes.error}`);
      process.exit(1);
    }

    console.log(`\n🔓 Đang kích hoạt lại tài khoản: ${phoneRes.canonicalPhone}...`);

    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, role, is_active')
      .eq('phone', phoneRes.canonicalPhone)
      .single();

    if (pErr || !profile) {
      console.error('❌ Không tìm thấy hồ sơ người dùng tương ứng.');
      process.exit(1);
    }

    const previousIsActive = Boolean(profile.is_active);

    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', profile.id);

    if (updateErr) {
      console.error('❌ Lỗi cập nhật trạng thái:', updateErr.message);
      process.exit(1);
    }

    const { error: unbanErr } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      ban_duration: 'none',
    });

    if (unbanErr) {
      console.error('❌ Lỗi gỡ ban trong Auth:', unbanErr.message);
      // R4-08: Safe rollback to captured previous state and verify rollback execution
      const { error: rollbackErr } = await supabaseAdmin
        .from('profiles')
        .update({ is_active: previousIsActive, updated_at: new Date().toISOString() })
        .eq('id', profile.id);

      if (rollbackErr) {
        console.error('CRITICAL: Rollback failed! Inconsistent state detected:', rollbackErr.message);
      } else {
        console.error(`🔄 Đã khôi phục lại trạng thái hồ sơ profiles về previousIsActive=${previousIsActive} (Rollback).`);
      }
      process.exit(1);
    }

    // Record and verify audit log entry (R4-08)
    const { error: auditErr } = await supabaseAdmin.from('audit_logs').insert({
      action: 'CLI_ACTIVATE_USER',
      entity_type: 'profiles',
      entity_id: profile.id,
      old_values: { is_active: previousIsActive },
      new_values: { is_active: true, ban_duration: 'none' },
      created_at: new Date().toISOString(),
    });

    if (auditErr) {
      console.warn('⚠️ Cảnh báo: Thao tác kích hoạt thành công nhưng ghi audit_logs thất bại:', auditErr.message);
    }

    console.log(`✅ Đã kích hoạt lại thành công tài khoản [${profile.full_name}].\n`);
    process.exit(0);
  }

  // =========================================================================
  // ACTION: RECOVER EXISTING USER (RESET PASSWORD)
  // =========================================================================
  if (args[0] === '--recover') {
    const rawPhone = args[1];
    if (!rawPhone) {
      console.error('❌ Cách dùng: node scripts/provision-user.cjs --recover <phone>');
      process.exit(1);
    }

    const phoneRes = canonicalizeVietnamesePhone(rawPhone);
    if (!phoneRes.isValid) {
      console.error(`❌ Số điện thoại không hợp lệ: ${phoneRes.error}`);
      process.exit(1);
    }

    console.log(`\n🔑 KHÔI PHỤC TÀI KHOẢN: ${phoneRes.canonicalPhone} (${phoneRes.localPhone})`);

    const { data: profile, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, role')
      .eq('phone', phoneRes.canonicalPhone)
      .single();

    if (pErr || !profile) {
      console.error('❌ Không tìm thấy hồ sơ người dùng trong hệ thống.');
      process.exit(1);
    }

    const newPassword = await promptHiddenPassword('Nhập mật khẩu mới cho người dùng (tối thiểu 8 ký tự): ');
    if (!newPassword || newPassword.length < 8) {
      console.error('❌ Mật khẩu phải có tối thiểu 8 ký tự.');
      process.exit(1);
    }

    const { error: updateAuthErr } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
      password: newPassword,
    });

    if (updateAuthErr) {
      console.error('❌ Lỗi cập nhật mật khẩu:', updateAuthErr.message);
      process.exit(1);
    }

    // Reactivate mandatory password change workflow upon admin password reset
    const { error: updateProfileErr } = await supabaseAdmin
      .from('profiles')
      .update({ must_change_password: true, updated_at: new Date().toISOString() })
      .eq('id', profile.id);

    if (updateProfileErr) {
      console.warn('⚠️ Cảnh báo: Không thể đánh dấu must_change_password trên profiles:', updateProfileErr.message);
    }

    console.log(`✅ Đã đặt lại mật khẩu thành công cho [${profile.full_name} - ${profile.role}].`);
    console.log(`🛡️ Tài khoản đã được kích hoạt lại quy trình bắt buộc đổi mật khẩu khi đăng nhập lần đầu.\n`);
    process.exit(0);
  }

  // =========================================================================
  // ACTION: PROVISION NEW USER (FAILS SAFELY IF USER ALREADY EXISTS)
  // =========================================================================
  console.log('===========================================================');
  console.log('   SAMPLE TRACKING V1.0 — CẤP PHÁT TÀI KHOẢN MỚI (PROVISION)   ');
  console.log('===========================================================\n');

  let rawPhone = args[0];
  let fullName = args[1];
  let role = args[2];
  let department = args[3];

  if (!rawPhone) {
    rawPhone = await promptText('Nhập số điện thoại nhân viên (ví dụ: 0912345678): ');
  }

  const phoneRes = canonicalizeVietnamesePhone(rawPhone);
  if (!phoneRes.isValid) {
    console.error(`\n❌ Lỗi số điện thoại: ${phoneRes.error}\n`);
    process.exit(1);
  }

  // Check if profile already exists in PostgreSQL
  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role')
    .eq('phone', phoneRes.canonicalPhone)
    .single();

  if (existingProfile) {
    console.error(`\n❌ TÀI KHOẢN ĐÃ TỒN TẠI: Người dùng với số điện thoại ${phoneRes.localPhone} đã có trong hệ thống.`);
    console.error(`Họ tên: ${existingProfile.full_name} | Vai trò: ${existingProfile.role}`);
    console.error(`Để đổi mật khẩu hoặc cập nhật tài khoản, vui lòng sử dụng lệnh phục hồi:`);
    console.error(`  node scripts/provision-user.cjs --recover ${phoneRes.localPhone}\n`);
    process.exit(1);
  }

  if (!fullName) {
    fullName = await promptText('Nhập họ và tên nhân viên: ');
  }

  const VALID_ROLES = ['Planning', 'PE-MFG', 'QA', 'Admin'];
  if (!role || !VALID_ROLES.includes(role)) {
    console.log('\nCác vai trò hợp lệ:');
    VALID_ROLES.forEach((r, idx) => console.log(`  ${idx + 1}. ${r}`));
    const roleChoice = await promptText('Chọn vai trò (Planning / PE-MFG / QA / Admin): ');
    role = VALID_ROLES.find((r) => r.toLowerCase() === roleChoice.toLowerCase()) || roleChoice;
    if (!VALID_ROLES.includes(role)) {
      console.error(`\n❌ Vai trò "${role}" không hợp lệ. Chỉ chấp nhận: ${VALID_ROLES.join(', ')}\n`);
      process.exit(1);
    }
  }

  if (!department) {
    department = (await promptText('Nhập phòng ban (mặc định: Sản xuất): ')) || 'Sản xuất';
  }

  let password = process.env.ADMIN_PROVISION_PASSWORD;
  if (!password) {
    const entered = await promptHiddenPassword('Nhập mật khẩu ban đầu (Nhấn Enter để dùng mật khẩu tạm 123456): ');
    password = entered.trim() || '123456';
  }

  console.log(`\n⏳ Đang tạo tài khoản trong Supabase Auth & PostgreSQL profiles...`);

  // 1. Create user in auth.users
  const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: phoneRes.aliasEmail,
    phone: phoneRes.canonicalPhone,
    password: password,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: {
      phone: phoneRes.canonicalPhone,
      local_phone: phoneRes.localPhone,
      full_name: fullName,
      role: role,
      department: department,
    },
  });

  if (createErr) {
    console.error(`\n❌ LỖI TẠO TÀI KHOẢN AUTH: ${createErr.message}`);
    if (createErr.message.includes('already registered')) {
      console.error('CẢNH BÁO BẢO MẬT: Danh tính xác thực (Email/Phone) đã tồn tại trong Auth.');
      console.error('Để khôi phục hoặc cập nhật, vui lòng dùng lệnh:');
      console.error(`  node scripts/provision-user.cjs --recover ${phoneRes.localPhone}`);
    }
    process.exit(1);
  }

  const userId = createData.user.id;

  // 2. Insert profile record into public.profiles with must_change_password = true
  const { error: profileErr } = await supabaseAdmin.from('profiles').insert({
    id: userId,
    phone: phoneRes.canonicalPhone,
    email: phoneRes.aliasEmail,
    full_name: fullName,
    role: role,
    department: department,
    is_active: true,
    must_change_password: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (profileErr) {
    console.error('❌ Lỗi tạo hồ sơ profiles:', profileErr.message);
    // R4-08: Rollback auth user and verify rollback execution
    const { error: rollbackErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (rollbackErr) {
      console.error('CRITICAL: Rollback failed! Auth user deletion failed:', rollbackErr.message);
    } else {
      console.log('🔄 Đã thu hồi tài khoản Auth tương ứng (Rollback thành công).');
    }
    process.exit(1);
  }

  // R4-08: Record and verify audit log
  const { error: auditErr } = await supabaseAdmin.from('audit_logs').insert({
    action: 'CLI_PROVISION_USER',
    entity_type: 'profiles',
    entity_id: userId,
    new_values: {
      phone: phoneRes.canonicalPhone,
      full_name: fullName,
      role: role,
      department: department,
    },
    created_at: new Date().toISOString(),
  });

  if (auditErr) {
    console.warn('⚠️ Cảnh báo: Cấp phát tài khoản thành công nhưng ghi audit_logs thất bại:', auditErr.message);
  }

  console.log('\n===========================================================');
  console.log('✅ CẤP PHÁT TÀI KHOẢN THÀNH CÔNG!');
  console.log('===========================================================');
  console.log(`• Số điện thoại: ${phoneRes.localPhone} (${phoneRes.canonicalPhone})`);
  console.log(`• Họ và tên:     ${fullName}`);
  console.log(`• Vai trò:       ${role}`);
  console.log(`• Phòng ban:     ${department}`);
  console.log(`• Trạng thái:    Hoạt động (Active)`);
  console.log('===========================================================\n');
}

main().catch((err) => {
  console.error('\n❌ Thực thi thất bại:', err.message || err);
  process.exit(1);
});
