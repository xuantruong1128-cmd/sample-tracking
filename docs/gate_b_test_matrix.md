# SAMPLE TRACKING V1.0 — REAL GATE B INTEGRATION TEST MATRIX
**Project:** `C:\Sample report - AI`  
**Role:** Senior Supabase/PostgreSQL Architect and Security Engineer  
**Scope:** Specification of real cloud integration tests using ordinary-user JWTs, direct Supabase REST APIs, and Storage endpoints.  
**Date:** October 11, 2026  

---

## 1. GATE B OBJECTIVES & ARCHITECTURAL PRINCIPLES

### 1.1 Beyond Mocked Tests
Previous audit cycles passed unit tests in Vitest (`npm test`) using mocked Supabase clients, but failed when tested against real PostgreSQL instances.
**Gate B mandates testing against a REAL, live Supabase instance with:**
1. **Real User Personas & JWTs:** Each test must log in via Supabase Auth (`signInWithPassword`) to obtain authentic JSON Web Tokens. No cheating with `service_role` to bypass RLS!
2. **Real PostgreSQL Trigger Execution:** All workflow transitions, immutable closed job triggers, monotonic QA counters, and attachment integrity rules execute within the live database engine.
3. **Real Supabase Storage Objects:** File uploads, signed URL generation, and existence verification interact with actual cloud storage buckets.
4. **Honest Reporting:** Gate B status is reported as **BLOCKED** until executed with live disposable credentials, and **PASS** only upon 100% green execution of the matrix below.

---

## 2. PERSONA DEFINITION & TEST CREDENTIAL MATRIX

The automated Gate B test suite provisions and authenticates 7 distinct user personas:

| Persona ID | Role | Account Description | Decision Privilege | Phone Number |
| :--- | :--- | :--- | :---: | :--- |
| `P-ADMIN` | `Admin` | System Administrator | Override Authority | `+84981111111` |
| `P-PLAN` | `Planning` | Production Planner | Spec creation only | `+84982222222` |
| `P-PE-LEAD` | `PE-MFG` | Designated PE Owner | `can_make_pe_decisions = TRUE` | `+84983333333` |
| `P-PE-OPER` | `PE-MFG` | Shop-floor Machine Operator | `can_make_pe_decisions = FALSE` | `+84984444444` |
| `P-QA` | `QA` | Quality Assurance Inspector | Independent evaluation | `+84985555555` |
| `P-INACTIVE`| `PE-MFG` | Deactivated Employee | `is_active = FALSE` | `+84986666666` |
| `P-ANON` | N/A | Unauthenticated Client (Anon key only) | None | N/A |

---

## 3. COMPREHENSIVE 20-SCENARIO GATE B TEST MATRIX

| Test ID | Category | Persona / JWT | Action / Direct API Request | Expected Outcome | Security Invariant Verified |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **TC-01** | **Authentication** | `P-ANON` | `GET /rest/v1/jobs`<br>`GET /rest/v1/attachments`<br>`GET /rest/v1/qa_checks` | HTTP 200 with empty array `[]` or HTTP 401 | Fail-closed security: Anonymous clients cannot access internal data. |
| **TC-02** | **Authentication** | `P-INACTIVE` | `GET /rest/v1/jobs`<br>`POST /rest/v1/production_runs` | HTTP 200 `[]` or HTTP 403 Forbidden | Deactivated accounts are immediately blocked from all data operations. |
| **TC-03** | **Job Lifecycle** | `P-PLAN` | `POST /rest/v1/jobs` with `status='ACTIVE'`, valid planned dates | HTTP 201 Created | Planning can create new jobs; default initial state must be `ACTIVE`. |
| **TC-04** | **Job Lifecycle** | `P-PLAN`<br>`P-PE-OPER` | `PATCH /rest/v1/jobs?id=eq.{id}` setting `pe_owner_id = P-PE-LEAD.id` | Planning: HTTP 200 OK.<br>PE-OPER: HTTP 403 / Error. | Only Planning or Admin can assign PE Owner; operators cannot self-assign. |
| **TC-05** | **Operations** | `P-PLAN` | `POST /rest/v1/job_operations` with `status='NOT_STARTED'`, `step_order=1` | HTTP 201 Created | Planning defines initial routing operations in `NOT_STARTED` status. |
| **TC-06** | **Manufacturing** | `P-PE-OPER` | `POST /rest/v1/production_runs` for operation.<br>`PATCH /rest/v1/job_operations` to `IN_PROGRESS` | HTTP 201 Created.<br>HTTP 200 OK. | Operator can record first run and advance operation from `NOT_STARTED` to `IN_PROGRESS`. |
| **TC-07** | **PE Ownership** | `P-PE-OPER` | `PATCH /rest/v1/job_operations` attempting `status='COMPLETED'` | HTTP 400 / 403 Exception: User is not designated PE Owner | Separation of duty: Shop-floor operator CANNOT complete operation. |
| **TC-08** | **QA Evaluation** | `P-QA` | `POST /rest/v1/qa_checks` with `result='NG'`, `ok_qty=5`, `ng_qty=5` | HTTP 201 Created.<br>`event_seq = 1` allocated automatically. | Monotonic sequence allocation; unique constraint; QA cannot edit operation status. |
| **TC-09** | **QA Immutability**| `P-QA`<br>`P-ADMIN` | `PATCH /rest/v1/qa_checks?id=eq.{id}` attempting to edit `result` | HTTP 400 / 403 Exception: QA evaluation records are immutable | Historical audit integrity: Neither QA nor Admin can alter recorded evaluations. |
| **TC-10** | **PE Completion** | `P-PE-LEAD` | `PATCH /rest/v1/job_operations` to `COMPLETED` while latest QA is `NG` | HTTP 400 Exception: Cannot complete with outstanding QA NG without disposition | Quality gate: PE cannot complete operation with NG QA check without technical justification. |
| **TC-11** | **PE Disposition** | `P-PE-LEAD` | `POST /rest/v1/pe_technical_dispositions` with `decision_type='CONTINUE_AS_IS'`, linked to QA check | HTTP 201 Created.<br>Then `status='COMPLETED'` succeeds. | Valid PE technical disposition resolves QA issue and permits completion. |
| **TC-12** | **Reopen Guard** | `P-PE-LEAD` | `PATCH /rest/v1/job_operations` from `COMPLETED` to `IN_PROGRESS` with `reopen_reason='Chỉnh sửa dao'` | HTTP 200 OK.<br>`reopened_at` & `reopened_by` stamped by server. | Authorized PE reopen requires valid reason (>= 5 chars); server stamps actor and time. |
| **TC-13** | **Anti-Reuse** | `P-PE-LEAD` | Re-attempt `status='COMPLETED'` after reopen using old pre-reopen disposition | HTTP 400 Exception: Disposition must be issued after reopen | Pre-reopen technical decisions cannot be recycled to authorize post-reopen completion. |
| **TC-14** | **Attachment Reg**| `P-PE-LEAD` | `POST /rest/v1/attachments` with `upload_status='READY'`, `file_path='{jobId}/DRAWING/spec.pdf'` | HTTP 201 Created.<br>`upload_status` is forced to `PENDING`. | Forged READY prevented: Trigger unconditionally overrides client status to `PENDING`. |
| **TC-15** | **Storage Upload**| `P-PE-LEAD` | `POST /storage/v1/object/sample-documents/{filePath}` binary payload | HTTP 200 OK | Storage RLS permits upload only when matching `PENDING` attachment row exists. |
| **TC-16** | **Confirmation** | `P-PE-LEAD` | `POST /rpc/confirm_attachment_upload` `{ p_attachment_id }` | HTTP 200 with `status='READY'` | Server verifies physical presence and file size before marking `READY`. |
| **TC-17** | **Direct Update** | `P-PE-LEAD`<br>`P-ADMIN` | `PATCH /rest/v1/attachments?id=eq.{id}` setting `upload_status='READY'` | HTTP 403 Permission Denied | Database grant level protection: Direct client UPDATE is completely revoked. |
| **TC-18** | **Fail Guard** | `P-PE-LEAD` | `POST /rpc/fail_attachment_upload` on a `READY` attachment | HTTP 400 Exception: only PENDING attachments can fail | Anti-downgrade invariant: Verified READY attachments can never be downgraded to FAILED. |
| **TC-19** | **Option A Read & Signed URL** | `P-QA`<br>`P-PLAN`<br>`P-INACTIVE`<br>`P-ANON` | 1. `GET /rest/v1/attachments` (QA/Planning)<br>2. `POST /functions/v1/create-signed-url`<br>3. HTTP `GET {signedUrl}` and SHA-256 byte verification<br>4. Negative tests: `P-INACTIVE` (403), `P-ANON` (401), direct bucket access (rejected) | 1. HTTP 200 `[1 record]`<br>2. HTTP 200 with signed URL (TTL <= 300s)<br>3. HTTP 200; bytes match original SHA-256<br>4. Rejections confirmed | Option A policy: Internal roles have read access to all registered job evidence with byte verification; unauthenticated and inactive access blocked. |
| **TC-20** | **Closed Job Lock**| `P-ADMIN`<br>`P-PLAN` | 1. `PATCH /rest/v1/jobs` to `CLOSE`<br>2. `POST /rest/v1/production_runs`<br>3. `POST /rest/v1/attachments` | 1. HTTP 200 (Closed)<br>2. HTTP 400 Locked<br>3. HTTP 400 Locked | Absolute closed job immutability: Child records cannot be added, edited, or deleted once closed. |

---

## 4. GATE B PREREQUISITES & EXECUTION PROCEDURE

### 4.1 Environment Setup
1. Provision a disposable Supabase project.
2. In project root `.env`:
   ```env
   SUPABASE_TEST_URL="https://your-disposable-project.supabase.co"
   SUPABASE_TEST_SERVICE_KEY="eyJhbGciOi..."
   SUPABASE_TEST_ANON_KEY="eyJhbGciOi..."
   SUPABASE_TEST_IS_DISPOSABLE="true"
   SUPABASE_TEST_PROJECT_ALLOWLIST="your-disposable-project"
   ```

### 4.2 Automated Test Execution Command
Execute the comprehensive test runner:
```bash
node scripts/run-gate-b-live-tests.cjs
```

The runner automatically:
1. Provisions the 6 test accounts via Admin API.
2. Performs real password logins to obtain active JWTs.
3. Runs all 20 scenarios in strict sequence.
4. Asserts response status codes, JSON payloads, and database constraints.
5. Emits a clean, auditable report with zero mocked calls.
