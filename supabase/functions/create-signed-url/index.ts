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

    if (file_path.includes('..') || file_path.includes('\\')) {
      return new Response(JSON.stringify({ error: 'Directory traversal detected' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const parts = file_path.split('/');
    if (parts.length < 3 || parts.length > 4) {
      return new Response(JSON.stringify({ error: 'Invalid file_path format. Expected <job_id>/<file_type>/<filename> or <job_id>/<category>/<subfolder>/<filename>' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const jobId = parts[0];

    // 4. Authorize caller against permitted roles
    const permittedRoles = ['Admin', 'Planning', 'PE-MFG', 'QA', 'Drawing', 'Viewer', 'BD'];
    if (!permittedRoles.includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden: role cannot access sample documents' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Verify Job exists and is accessible
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

    // 6. Verify document is registered in attachments, engineering_documents, operation_sample_photos, or qa_documents
    const { data: attachment } = await adminClient
      .from('attachments')
      .select('id, job_id, file_path, file_type, owning_department, upload_status')
      .eq('file_path', file_path)
      .maybeSingle();

    let isDocumentRegistered = false;

    if (attachment) {
      if (attachment.job_id !== jobId) {
        return new Response(JSON.stringify({ error: 'Cross-job attachment mismatch detected' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (attachment.upload_status && attachment.upload_status !== 'READY') {
        return new Response(JSON.stringify({ error: 'Attachment upload is not finalized (status is not READY)' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      isDocumentRegistered = true;
    } else {
      // Check engineering_documents
      const { data: engDoc } = await adminClient
        .from('engineering_documents')
        .select('id, job_id')
        .eq('file_path', file_path)
        .maybeSingle();

      if (engDoc && engDoc.job_id === jobId) {
        isDocumentRegistered = true;
      } else {
        // Check operation_sample_photos
        const { data: samplePhoto } = await adminClient
          .from('operation_sample_photos')
          .select('id, job_id')
          .eq('file_path', file_path)
          .maybeSingle();

        if (samplePhoto && samplePhoto.job_id === jobId) {
          isDocumentRegistered = true;
        } else {
          // Check qa_documents
          const { data: qaDoc } = await adminClient
            .from('qa_documents')
            .select('id, job_id')
            .eq('file_path', file_path)
            .maybeSingle();

          if (qaDoc && qaDoc.job_id === jobId) {
            isDocumentRegistered = true;
          }
        }
      }
    }

    if (!isDocumentRegistered) {
      return new Response(JSON.stringify({ error: 'Document not found or not registered in documents catalog' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
