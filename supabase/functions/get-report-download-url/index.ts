import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_EXPIRES_IN_SECONDS = 300; // Enforce strict 5-minute maximum TTL (Gate B)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Authenticate caller
    let callerUser: any = null;
    let callerProfile: any = null;

    const isServiceKeyMatch = (token === serviceRoleKey && serviceRoleKey.length > 0);
    let isServiceRoleJwt = false;
    const currentProjectRef = (supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/) || [])[1];
    try {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(atob(parts[1]));
        if (payload.role === 'service_role' && (!payload.ref || payload.ref === currentProjectRef || payload.ref === 'hosppagbopdghlupnhlr')) {
          isServiceRoleJwt = true;
        }
      }
    } catch {
      // not a JWT
    }

    if (isServiceKeyMatch || isServiceRoleJwt) {
      const { data: adminProf } = await adminClient
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'Admin')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      callerUser = { id: adminProf?.id || null };
      callerProfile = {
        id: adminProf?.id || null,
        role: 'Admin',
        is_department_leader: true,
        is_active: true,
        full_name: adminProf?.full_name || 'Admin System',
      };
    } else {
      const { data: { user }, error: callerError } = await adminClient.auth.getUser(token);
      if (callerError || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      callerUser = user;

      // 2. Authorize caller: ONLY PE-MFG Leader or Admin
      const { data: profile, error: profileErr } = await adminClient
        .from('profiles')
        .select('id, role, is_department_leader, is_active, full_name')
        .eq('id', callerUser.id)
        .single();

      if (profileErr || !profile || !profile.is_active) {
        return new Response(JSON.stringify({ error: 'Forbidden: Account inactive or profile missing' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      callerProfile = profile;
    }

    const isPeMfgLeader = callerProfile.role === 'PE-MFG' && callerProfile.is_department_leader === true;
    const isAdmin = callerProfile.role === 'Admin';

    if (!isPeMfgLeader && !isAdmin) {
      return new Response(
        JSON.stringify({
          error: 'Quyền hạn bị từ chối: Chỉ Trưởng nhóm PE-MFG (PE-MFG Leader) hoặc Quản trị viên (Admin) mới được phép tải tệp báo cáo gốc (PDF/ZIP). Các vai trò khác chỉ có quyền xem nội dung tóm tắt qua hệ thống.',
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Parse and validate input
    const body = await req.json();
    const { job_id, file_type } = body;

    if (!job_id || !file_type || !['pdf', 'zip'].includes(file_type)) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid parameters. Expected job_id and file_type ("pdf" | "zip").' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Retrieve report record
    const { data: report, error: reportErr } = await adminClient
      .from('sample_final_reports')
      .select('*')
      .eq('job_id', job_id)
      .single();

    if (reportErr || !report) {
      return new Response(JSON.stringify({ error: 'Không tìm thấy hồ sơ báo cáo cho Lệnh sản xuất này.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (report.generation_status !== 'Ready') {
      return new Response(
        JSON.stringify({
          error: `Báo cáo chưa sẵn sàng để tải xuống (Trạng thái hiện tại: ${report.generation_status}).`,
          status: report.generation_status,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const targetPath = file_type === 'pdf' ? report.pdf_file_path : report.zip_file_path;
    const targetName = file_type === 'pdf' ? report.pdf_file_name : report.zip_file_name;

    if (!targetPath) {
      return new Response(JSON.stringify({ error: `Tệp ${file_type.toUpperCase()} chưa được lưu trữ.` }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Generate secure short-lived signed URL (max 300s)
    const { data: signedData, error: signErr } = await adminClient.storage
      .from('sample-documents')
      .createSignedUrl(targetPath, MAX_EXPIRES_IN_SECONDS, {
        download: targetName,
      });

    if (signErr || !signedData?.signedUrl) {
      return new Response(JSON.stringify({ error: signErr?.message || 'Không thể tạo liên kết tải an toàn.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 6. Record Audit Log for Download Event
    await adminClient.from('audit_logs').insert({
      user_id: callerUser?.id || null,
      action: file_type === 'pdf' ? 'DOWNLOAD_FINAL_REPORT_PDF' : 'DOWNLOAD_FINAL_REPORT_ZIP',
      entity_type: 'sample_final_reports',
      entity_id: report.id,
      old_values: null,
      new_values: {
        file_type,
        file_name: targetName,
        downloaded_by: callerProfile.full_name,
        role: callerProfile.role,
        is_leader: callerProfile.is_department_leader,
      },
    });

    return new Response(
      JSON.stringify({
        signedUrl: signedData.signedUrl,
        fileName: targetName,
        fileSize: file_type === 'pdf' ? report.pdf_file_size : report.zip_file_size,
        fileSha256: file_type === 'pdf' ? report.pdf_sha256 : report.zip_sha256,
        expiresIn: MAX_EXPIRES_IN_SECONDS,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
