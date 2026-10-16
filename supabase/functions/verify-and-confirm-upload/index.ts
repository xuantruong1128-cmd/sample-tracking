import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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

    // 1. Authenticate caller using their JWT
    const { data: { user: callerUser }, error: callerError } = await adminClient.auth.getUser(token);
    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Validate caller profile and status

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

    // 3. Parse and validate payload
    const body = await req.json().catch(() => ({}));
    const attachmentId = body.attachment_id || body.attachmentId;

    if (!attachmentId || typeof attachmentId !== 'string' || !UUID_REGEX.test(attachmentId)) {
      return new Response(JSON.stringify({ error: 'Missing or invalid attachment_id (must be UUID)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Fetch registered attachment record
    const { data: attachment, error: attachErr } = await adminClient
      .from('attachments')
      .select('id, job_id, file_path, file_size, mime_type, content_hash, upload_status, uploaded_by')
      .eq('id', attachmentId)
      .single();

    if (attachErr || !attachment) {
      return new Response(JSON.stringify({ error: 'Attachment record not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Authorize caller against the attachment record
    // Admin or original uploader only
    if (callerProfile.role !== 'Admin' && callerUser.id !== attachment.uploaded_by) {
      return new Response(JSON.stringify({ error: 'Forbidden: Only the uploader or Admin can verify and confirm upload' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check parent JOB status
    const { data: job, error: jobErr } = await adminClient
      .from('jobs')
      .select('id, status')
      .eq('id', attachment.job_id)
      .single();

    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: 'Associated job not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (job.status !== 'ACTIVE') {
      return new Response(JSON.stringify({ error: `Cannot confirm upload on ${job.status} JOB (only ACTIVE jobs permit changes)` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If already READY, return idempotently
    if (attachment.upload_status === 'READY') {
      return new Response(JSON.stringify({
        success: true,
        status: 'READY',
        message: 'Attachment is already verified and confirmed READY',
        attachment_id: attachment.id,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (attachment.upload_status !== 'PENDING') {
      return new Response(JSON.stringify({
        error: `Cannot verify attachment in status ${attachment.upload_status} (must be PENDING)`,
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
    const SHA256_REGEX = /^[0-9a-fA-F]{64}$/;

    // Validate MIME type
    if (!attachment.mime_type || !ALLOWED_MIME_TYPES.includes(attachment.mime_type.toLowerCase())) {
      const errMsg = `MIME type '${attachment.mime_type}' is not supported. Must be one of: ${ALLOWED_MIME_TYPES.join(', ')}`;
      await adminClient.rpc('fail_attachment_upload', {
        p_attachment_id: attachment.id,
        p_error: errMsg,
      });
      return new Response(JSON.stringify({ error: errMsg, status: 'FAILED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate file size bounds
    if (typeof attachment.file_size !== 'number' || attachment.file_size <= 0 || attachment.file_size > 52428800) {
      const errMsg = `Invalid file size: ${attachment.file_size} bytes (maximum allowed: 50MB).`;
      await adminClient.rpc('fail_attachment_upload', {
        p_attachment_id: attachment.id,
        p_error: errMsg,
      });
      return new Response(JSON.stringify({ error: errMsg, status: 'FAILED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate mandatory SHA-256 content_hash format (B2-07)
    if (!attachment.content_hash || !SHA256_REGEX.test(attachment.content_hash)) {
      const errMsg = 'Attachment missing valid 64-character hexadecimal SHA-256 content_hash.';
      await adminClient.rpc('fail_attachment_upload', {
        p_attachment_id: attachment.id,
        p_error: errMsg,
      });
      return new Response(JSON.stringify({ error: errMsg, status: 'FAILED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate canonical storage path structure: <job_id>/<file_type>/<filename>
    const pathParts = (attachment.file_path || '').split('/');
    if (
      pathParts.length !== 3 ||
      pathParts[0] !== attachment.job_id ||
      !pathParts[2] ||
      pathParts[2] === '.' ||
      pathParts[2] === '..' ||
      pathParts[2].includes('\\')
    ) {
      const errMsg = `Storage path '${attachment.file_path}' violates canonical structure <job_id>/<file_type>/<filename>.`;
      await adminClient.rpc('fail_attachment_upload', {
        p_attachment_id: attachment.id,
        p_error: errMsg,
      });
      return new Response(JSON.stringify({ error: errMsg, status: 'FAILED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 6. Download physical object from storage to verify real bytes
    const { data: fileBlob, error: downloadError } = await adminClient.storage
      .from('sample-documents')
      .download(attachment.file_path);

    if (downloadError || !fileBlob) {
      const errMsg = `Storage object not found or download error: ${downloadError?.message || 'Missing blob'}`;
      await adminClient.rpc('fail_attachment_upload', {
        p_attachment_id: attachment.id,
        p_error: errMsg,
      });

      return new Response(JSON.stringify({
        error: errMsg,
        attachment_id: attachment.id,
        status: 'FAILED',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 7. Verify byte size matches metadata
    const actualSize = fileBlob.size;
    if (actualSize !== attachment.file_size) {
      const errMsg = `Byte size mismatch: expected ${attachment.file_size} bytes, got ${actualSize} bytes`;
      await adminClient.rpc('fail_attachment_upload', {
        p_attachment_id: attachment.id,
        p_error: errMsg,
      });

      return new Response(JSON.stringify({
        error: errMsg,
        expected_size: attachment.file_size,
        actual_size: actualSize,
        status: 'FAILED',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 8. Inspect binary magic bytes and validate MIME type signature (R1-05)
    const arrayBuffer = await fileBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    function detectSignatureMime(buf: Uint8Array): string | null {
      // PDF: %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
      if (buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d) {
        return 'application/pdf';
      }
      // JPEG: 0xFF, 0xD8, 0xFF
      if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
        return 'image/jpeg';
      }
      // PNG: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
      if (
        buf.length >= 8 &&
        buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
        buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
      ) {
        return 'image/png';
      }
      return null;
    }

    const detectedMime = detectSignatureMime(bytes);
    if (!detectedMime) {
      const errMsg = `Unsupported or unrecognized binary file signature. Only PDF, JPEG, and PNG files are permitted.`;
      await adminClient.rpc('fail_attachment_upload', {
        p_attachment_id: attachment.id,
        p_error: errMsg,
      });
      return new Response(JSON.stringify({ error: errMsg, status: 'FAILED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (detectedMime !== attachment.mime_type.toLowerCase()) {
      const errMsg = `MIME signature mismatch: declared MIME '${attachment.mime_type}' does not match detected file signature '${detectedMime}'.`;
      await adminClient.rpc('fail_attachment_upload', {
        p_attachment_id: attachment.id,
        p_error: errMsg,
      });
      return new Response(JSON.stringify({ error: errMsg, status: 'FAILED' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 9. Compute server-side SHA-256 hash using Web Crypto API
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const computedHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    // Check hash integrity against registered metadata (strictly enforced)
    if (computedHash.toLowerCase() !== attachment.content_hash.toLowerCase()) {
      const errMsg = `SHA-256 checksum mismatch: expected ${attachment.content_hash.toLowerCase()}, computed ${computedHash.toLowerCase()}`;
      await adminClient.rpc('fail_attachment_upload', {
        p_attachment_id: attachment.id,
        p_error: errMsg,
      });

      return new Response(JSON.stringify({
        error: errMsg,
        expected_hash: attachment.content_hash,
        computed_hash: computedHash,
        status: 'FAILED',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 9. All verifications passed! Invoke database canonical RPC confirm_attachment_upload
    const { data: confirmData, error: confirmError } = await adminClient.rpc('confirm_attachment_upload', {
      p_attachment_id: attachment.id,
    });

    if (confirmError || !confirmData?.success) {
      return new Response(JSON.stringify({
        error: `Database confirmation failed: ${confirmError?.message || confirmData?.error || 'Unknown error'}`,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      status: 'READY',
      attachment_id: attachment.id,
      file_size: actualSize,
      content_hash: computedHash,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
