import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_EXPIRES_IN_SECONDS = 300; // Server-enforced 300 seconds limit (Step 6)

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
    const { data: { user: callerUser }, error: callerError } = await adminClient.auth.getUser(token);
    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Check profile active status and role

    const { data: callerProfile, error: profileErr } = await adminClient
      .from('profiles')
      .select('role, is_active')
      .eq('id', callerUser.id)
      .single();

    if (profileErr || !callerProfile || !callerProfile.is_active) {
      return new Response(JSON.stringify({ error: 'Forbidden: Account inactive or profile missing' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Parse and validate file_path
    const body = await req.json();
    const { file_path, expires_in } = body;

    if (!file_path || typeof file_path !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid file_path' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parts = file_path.split('/');
    if (parts.length !== 3) {
      return new Response(JSON.stringify({ error: 'Invalid file_path format. Expected <job_id>/<file_type>/<filename>' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [jobId, fileType, fileName] = parts;
    const allowedTypes = ['DRAWING', 'CHECK_SHEET', 'SETTING_SHEET', 'NG_PHOTO', 'OTHER'];
    if (!allowedTypes.includes(fileType)) {
      return new Response(JSON.stringify({ error: 'Invalid file_type in storage path' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (fileName.includes('..') || fileName.includes('\\')) {
      return new Response(JSON.stringify({ error: 'Directory traversal detected' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Verify Job exists and is accessible
    const { data: job, error: jobErr } = await adminClient
      .from('jobs')
      .select('id, status')
      .eq('id', jobId)
      .single();

    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: 'Job not found or access denied' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (job.status === 'PURGED') {
      return new Response(JSON.stringify({ error: 'Job documents are purged and cannot be accessed' }), {
        status: 410,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Verify document association in attachments table (R4-03 / R4-04 / R7)
    // Every accessible document MUST be registered in the attachments table and match the target job.
    const { data: attachment, error: attachErr } = await adminClient
      .from('attachments')
      .select('id, job_id, file_path, file_type, owning_department, upload_status')
      .eq('file_path', file_path)
      .maybeSingle();

    if (attachErr || !attachment) {
      return new Response(JSON.stringify({ error: 'Attachment not found or not registered in attachments catalog' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (attachment.job_id !== jobId) {
      return new Response(JSON.stringify({ error: 'Cross-job attachment mismatch detected' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // R7: enforce upload lifecycle status. Only finalized (READY) attachments can be accessed.
    if (attachment.upload_status && attachment.upload_status !== 'READY') {
      return new Response(JSON.stringify({ error: 'Attachment upload is not finalized (status is not READY)' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // R6/R7: authorize the caller against the exact registered attachment, not only the JOB.
    // Option A Document Access Policy: all active internal roles may read registered JOB evidence.
    const permittedRoles = ['Admin', 'Planning', 'PE-MFG', 'QA'];
    if (!permittedRoles.includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden: role cannot access sample documents' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (attachment.file_type !== fileType || !attachment.owning_department) {
      return new Response(JSON.stringify({ error: 'Attachment metadata does not match object path' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 6. Enforce strict server maximum expiration of 300 seconds (5 minutes) (R4-03 / R4-04)
    // ARCHITECTURAL NOTE ON SIGNED URL ENFORCEMENT:
    // Client-side Supabase Storage SDK createSignedUrl() requests cannot be restricted to a 300s TTL
    // purely through SQL RLS policies. Supabase Storage signed URLs are signed server-side by the
    // storage service using S3 HMAC / service credentials, which does NOT evaluate SQL RLS on the signing
    // duration itself.
    // Therefore, our application architecture mandates:
    //   1. All client applications MUST request signed URLs through this create-signed-url Edge Function.
    //   2. This endpoint enforces the hard upper limit of MAX_EXPIRES_IN_SECONDS (300 seconds).
    //   3. Direct bucket access from clients is strictly constrained by Storage RLS policies (00008 migration),
    //      which prevent unauthorized reads, updates, and deletes.
    const effectiveExpiry = Math.min(Math.max(1, Number(expires_in) || MAX_EXPIRES_IN_SECONDS), MAX_EXPIRES_IN_SECONDS);

    const { data: signedData, error: signErr } = await adminClient.storage
      .from('sample-documents')
      .createSignedUrl(file_path, effectiveExpiry);

    if (signErr || !signedData?.signedUrl) {
      return new Response(JSON.stringify({ error: signErr?.message || 'Failed to create signed URL' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      signedUrl: signedData.signedUrl,
      expiresIn: effectiveExpiry,
      enforcedMaxExpiry: MAX_EXPIRES_IN_SECONDS,
      note: '300s maximum applies to this gateway only; direct Storage signing requires separate platform controls.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
