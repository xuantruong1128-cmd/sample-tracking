-- ============================================================================
-- Migration: 00038_cleanup_test_drawing_reviews.sql
-- Description: Clean up temporary test Drawing Review issues, versions,
--              operations, attachments, and test user accounts created
--              during verification runs.
--              Preserves only real customer records (PHINIA 71006806A).
-- ============================================================================

-- 1. Temporarily disable all three immutability triggers to allow clean removal of test records
ALTER TABLE public.drawing_review_versions DISABLE TRIGGER trg_drawing_review_version_immutability;
ALTER TABLE public.drawing_review_operations DISABLE TRIGGER trg_drawing_review_operation_immutability;
ALTER TABLE public.drawing_review_attachments DISABLE TRIGGER trg_drawing_review_attachment_immutability;

-- 2. Remove operations belonging to test review versions
DELETE FROM public.drawing_review_operations
WHERE version_id IN (
    SELECT v.id FROM public.drawing_review_versions v
    JOIN public.drawing_review_issues i ON v.issue_id = i.id
    WHERE i.issue_no IN ('261104-SMK422032', '261104-N002', '261103-N004')
       OR i.id IN (
           '1d77276f-db5d-4a26-946b-bfe62b3797e2',
           '4c6788f9-84b7-46dd-abc2-7e5cd5ec6b33',
           'a639f2f2-bb37-4aa0-a928-9af4c74d56bb'
       )
);

-- 3. Remove attachments belonging to test review versions
DELETE FROM public.drawing_review_attachments
WHERE version_id IN (
    SELECT v.id FROM public.drawing_review_versions v
    JOIN public.drawing_review_issues i ON v.issue_id = i.id
    WHERE i.issue_no IN ('261104-SMK422032', '261104-N002', '261103-N004')
       OR i.id IN (
           '1d77276f-db5d-4a26-946b-bfe62b3797e2',
           '4c6788f9-84b7-46dd-abc2-7e5cd5ec6b33',
           'a639f2f2-bb37-4aa0-a928-9af4c74d56bb'
       )
);

-- 4. Remove test review versions
DELETE FROM public.drawing_review_versions
WHERE issue_id IN (
    SELECT id FROM public.drawing_review_issues
    WHERE issue_no IN ('261104-SMK422032', '261104-N002', '261103-N004')
       OR id IN (
           '1d77276f-db5d-4a26-946b-bfe62b3797e2',
           '4c6788f9-84b7-46dd-abc2-7e5cd5ec6b33',
           'a639f2f2-bb37-4aa0-a928-9af4c74d56bb'
       )
);

-- 5. Remove the test review issues
DELETE FROM public.drawing_review_issues
WHERE issue_no IN ('261104-SMK422032', '261104-N002', '261103-N004')
   OR id IN (
       '1d77276f-db5d-4a26-946b-bfe62b3797e2',
       '4c6788f9-84b7-46dd-abc2-7e5cd5ec6b33',
       'a639f2f2-bb37-4aa0-a928-9af4c74d56bb'
   );

-- 6. Re-enable all three immutability triggers
ALTER TABLE public.drawing_review_versions ENABLE TRIGGER trg_drawing_review_version_immutability;
ALTER TABLE public.drawing_review_operations ENABLE TRIGGER trg_drawing_review_operation_immutability;
ALTER TABLE public.drawing_review_attachments ENABLE TRIGGER trg_drawing_review_attachment_immutability;

-- 7. Remove temporary smoke test accounts from profiles and auth.users
DELETE FROM public.profiles
WHERE id IN (
    'e595f1d8-99fe-435e-a00d-300c25693f7a',
    '6fe35c05-5aab-4ac0-856c-fbbae6d3ee9f',
    'f3ba4ebc-ac60-42e7-afeb-e3a95ae7cd2b',
    '352a6aeb-2dc6-4120-a3a1-10ac78902e3a',
    '51c8c572-2936-4bb8-aa8d-88bec5e00be1'
)
OR email LIKE 'temp_smoke_%'
OR email LIKE '%@sampletracking.local' AND (full_name LIKE '%Smoke%' OR full_name LIKE '%[TEST]%' OR full_name LIKE '%[TEMP-SMOKE]%');

DELETE FROM auth.users
WHERE id IN (
    'e595f1d8-99fe-435e-a00d-300c25693f7a',
    '6fe35c05-5aab-4ac0-856c-fbbae6d3ee9f',
    'f3ba4ebc-ac60-42e7-afeb-e3a95ae7cd2b',
    '352a6aeb-2dc6-4120-a3a1-10ac78902e3a',
    '51c8c572-2936-4bb8-aa8d-88bec5e00be1'
)
OR email LIKE 'temp_smoke_%'
OR (email LIKE '%@sampletracking.local' AND id NOT IN (SELECT id FROM public.profiles));
