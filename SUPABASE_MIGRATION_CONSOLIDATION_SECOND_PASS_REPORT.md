# Make Me Topper — Supabase Migration Consolidation: Second-Pass Verification & Technical Audit Report

**Document Version:** 2.0.0  
**Date:** November 20, 2026  
**Auditor:** Senior Principal Database Architect (Antigravity Ponytail Review)  
**Repositories:**
- Primary / Canonical Target: `C:\Projects\mocktest-admin`
- Mobile Reference: `C:\Projects\MockTestApp`
**Target Environment:** Supabase PostgreSQL 16 (Production & Staging)

---

## Executive Summary & Verdict

This second-pass verification resolves all numerical discrepancies, dependency questions, and migration-immutability concerns identified in the initial consolidation proposal. 

Our investigation confirms:
1. **Option A is the optimal and correct architecture:** Centralizing all Supabase database migrations, Edge Functions, configuration, and types in `C:\Projects\mocktest-admin\supabase` is the only sustainable strategy for the Make Me Topper platform.
2. **The 37 vs 55 App Discrepancy is Fully Reconciled:** There are **55** filenames in `MockTestApp` that do not exist under that exact name in `mocktest-admin`. Exactly **18** of those files were previously imported and renumbered in `mocktest-admin` (12 byte-identical, 6 normalized SQL identical). The remaining **37** migrations are genuinely unique to `MockTestApp`.
3. **The 310 vs 345 Category Discrepancy is Fully Reconciled:** The distinct filename universe across both projects is strictly **310** (255 admin + 55 app-only). The 345 figure in the previous report resulted from non-mutually-exclusive functional tags that multi-counted 35 migrations across overlapping categories.
4. **14 Genuinely Missing Schema Migrations Identified:** Of the 37 unmerged app files, exactly 14 define foundational tables, columns, and RPCs required by active production code (`conversations`, `messages`, `mock_attempts.last_question_id`, `mock_attempts.last_activity_at`, `persist_mock_answers_batch`, `persist_mock_answer_live`, `get_public_catalog`, `register_device_token`, etc.). The remaining 23 are either superseded iterations (19), alternative syntax implementations (3), or a single-tenant data repair script (1).
5. **Zero Historical Mutation Invariant:** Historical migrations `001` through `249` in `mocktest-admin` **must remain 100% byte-immutable**. Re-sequencing or modifying applied migrations would corrupt production CLI tracking. Parity must be achieved strictly through a single **Forward-Only Parity Migration** (`250_consolidate_mobile_schema_parity.sql`).
6. **Edge Function Strategy:** `send-msg91-otp` (active Supabase Auth SMS Hook) must be moved into the canonical admin project. `public-catalog` (superseded by `get_public_catalog` RPC) and `apply-migration` (single-use database bypass) are obsolete and must be retired.

---

## 1. Mathematical Reconciliation of Migration Counts

### 1.1 The Exact Migration Universe

An exhaustive cryptographic audit of every `.sql` file in both migration directories reveals the exact universe:

| Metric | Count | Formula / Verification |
| :--- | :---: | :--- |
| **Total Files in `mocktest-admin/supabase/migrations`** | **255** | Count of `.sql` files in admin directory |
| **Total Files in `MockTestApp/supabase/migrations`** | **122** | Count of `.sql` files in app directory |
| **Filename Intersection (Files present in both)** | **67** | Filenames appearing in both directories |
| ↳ *Identical Files (SHA-256 Byte Match)* | *61* | Verified by exact cryptographic hash |
| ↳ *Same Filename, Content Difference* | *6* | 1 substantive SQL (`034`), 4 CRLF-only (`209`-`212`), 1 trailing newline (`249`) |
| **Admin-Only Filenames** | **188** | $255 - 67 = 188$ |
| **App-Only Filenames** | **55** | $122 - 67 = 55$ |
| **Total Distinct Filenames (Union)** | **310** | $67 + 188 + 55 = 310$ |
| **Renumbered App Files Imported into Admin** | **18** | Identical SQL existing under different numbers |
| **Total Distinct Logical Migrations** | **292** | $310 - 18 = 292$ |

### 1.2 Mathematical Proof of the 55 vs 37 Discrepancy

The confusion in the initial report arose from conflating **filename exclusivity** with **logical schema exclusivity**:
- **55 files** exist in `MockTestApp` whose filenames do not exist in `mocktest-admin`.
- When comparing SQL content across all 255 admin files, **18 of those 55 files** were already imported into `mocktest-admin` under higher, renumbered filenames:
  - 12 are exact byte-for-byte SHA-256 duplicates.
  - 6 are normalized SQL duplicates (identical logic, differing only by line endings or migration comment headers).
- Subtracting the 18 renumbered files leaves:
  $$\mathbf{55} \text{ (app-only filenames)} - \mathbf{18} \text{ (renumbered matches)} = \mathbf{37} \text{ (genuinely unmerged app files)}$$

### 1.3 Mathematical Proof of the 310 vs 345 Discrepancy

Section 3 of the first-pass report presented a table totaling 345 migrations:
- Core Schema: 25
- Auth & Identity: 12
- Content & Question Bank: 120
- Test Engine & Attempts: 51
- Analytics: 15
- Batch & Teacher Management: 21
- Commerce & Payments: 18
- Mobile-Specific: 36
- Apple IAP: 10
- Admin-Specific: 37
- **Sum:** $25 + 12 + 120 + 51 + 15 + 21 + 18 + 36 + 10 + 37 = \mathbf{345}$

This discrepancy occurred because migrations were tagged into multiple functional domains (e.g. Test Engine analytics, mobile-specific batch RPCs, renumbered teacher indexes). The categories were **not mutually exclusive partitions**. When deduplicated by physical filename, the true population is strictly **310 distinct files**.

---

## 2. Complete Account of All 55 App-Only Migrations

Every single one of the 55 app-only migration files has been classified into the six rigorous categories specified by the audit protocol:

```
Total App-Only Files: 55
├── Exact Duplicate (different filename in admin): 12
├── Same SQL with a Different Filename (different header/CRLF): 6
├── Same Functionality with Different SQL Implementation: 3
├── Partially Overlapping / Superseded Migration: 19
├── Genuinely Missing Migration (required for schema parity): 14
└── Unrelated Migration (single-tenant data repair): 1
```

### 2.1 Renumbered Migrations Already in Admin (18 Files)

These 18 migrations were authored in `MockTestApp` and subsequently copied into `mocktest-admin` under new sequence numbers. No action is required for these files in the canonical repository.

| # | App Filename | Admin Filename | Classification | Diff Summary |
| :-: | :--- | :--- | :--- | :--- |
| 1 | `036_add_guardian_fields_to_student_details.sql` | `040_add_guardian_fields_to_student_details.sql` | Exact duplicate | SHA-256 match |
| 2 | `068_add_test_filter_to_student_subject_analytics.sql` | `158_reconcile_student_subject_analytics_overload.sql` | Same SQL, diff filename | Comment header text only |
| 3 | `075_optimize_mock_attempt_initialization_and_answers.sql` | `150_optimize_mock_attempt_initialization_and_answers.sql` | Exact duplicate | SHA-256 match |
| 4 | `076_add_question_times_to_submit_and_evaluate_rpc.sql` | `151_add_question_times_to_submit_and_evaluate_rpc.sql` | Exact duplicate | SHA-256 match |
| 5 | `079_add_image_metadata_and_profile.sql` | `153_add_image_metadata_and_profile.sql` | Exact duplicate | SHA-256 match |
| 6 | `082_update_get_home_screen_bootstrap_rpc.sql` | `154_update_get_home_screen_bootstrap_rpc.sql` | Exact duplicate | SHA-256 match |
| 7 | `083_get_courses_content_summary_rpc.sql` | `155_get_courses_content_summary_rpc.sql` | Same SQL, diff filename | Comment header text only |
| 8 | `084_harden_handle_new_user_public_role.sql` | `156_harden_handle_new_user_public_role.sql` | Same SQL, diff filename | Comment header text only |
| 9 | `085_align_student_analytics_to_released_results.sql` | `159_align_student_analytics_to_released_results.sql` | Exact duplicate | SHA-256 match |
| 10 | `086_optimize_submit_and_evaluate_mock_attempt_rpc.sql` | `161_optimize_submit_and_evaluate_mock_attempt_rpc.sql` | Exact duplicate | SHA-256 match |
| 11 | `087_recalculate_mock_results_on_release_and_finalize.sql` | `162_recalculate_mock_results_on_release_and_finalize.sql` | Exact duplicate | SHA-256 match |
| 12 | `088_synchronize_subject_and_chapter_analytics_scores.sql` | `163_synchronize_subject_and_chapter_analytics_scores.sql` | Exact duplicate | SHA-256 match |
| 13 | `089_add_subjective_count_to_chapter_analytics.sql` | `164_add_subjective_count_to_chapter_analytics.sql` | Exact duplicate | SHA-256 match |
| 14 | `091_two_slot_device_sessions.sql` | `186_two_slot_device_sessions.sql` | Same SQL, diff filename | CRLF vs LF only (0 textual diff) |
| 15 | `092_get_student_recording_subjects_rpc.sql` | `187_get_student_recording_subjects_rpc.sql` | Same SQL, diff filename | CRLF vs LF only (0 textual diff) |
| 16 | `094_verify_recording_playback_access_rpc.sql` | `189_verify_recording_playback_access_rpc.sql` | Same SQL, diff filename | CRLF vs LF only (0 textual diff) |
| 17 | `095_get_teacher_lifecycle_counts_rpc.sql` | `191_get_teacher_lifecycle_counts_rpc.sql` | Exact duplicate | SHA-256 match |
| 18 | `096_teacher_management_performance_indexes.sql` | `192_teacher_management_performance_indexes.sql` | Exact duplicate | SHA-256 match |

---

### 2.2 Genuinely Missing Migrations Required for Schema Parity (14 Files)

These 14 migrations define objects that are actively referenced by client applications or subsequent admin migrations, but were **never** committed to `mocktest-admin/supabase/migrations`.

| # | App Filename | Objects Defined | Application Consumers / Rationale |
| :-: | :--- | :--- | :--- |
| 1 | `046_add_courses_read_policy_for_user_role.sql` | Policy: `Users can read published courses` on `courses` | Permits mobile and web students to read course catalog. |
| 2 | `049_add_last_question_id_to_mock_attempts.sql` | Column: `mock_attempts.last_question_id` (UUID FK) | Consumed by Admin Web (`studentTestWebService.ts`) and Mobile (`mockAttemptService.ts`). |
| 3 | `050_add_last_activity_at_to_mock_attempts.sql` | Column: `mock_attempts.last_activity_at` (TIMESTAMPTZ) | Explicitly referenced in Admin migration `098` (line 287) and consumed by Web timer sync. |
| 4 | `052_set_last_activity_at_trigger.sql` | Function & Trigger: `set_last_activity_at()` on `mock_answers` | Automatically maintains `last_activity_at` on answer submission. |
| 5 | `060_live_chat_module.sql` | Tables: `public.conversations`, `public.messages`, Realtime pub, RLS | **Critical foundation:** Required by Admin migration `067` and Account Deletion (`202`-`243`). |
| 6 | `062_fix_content_pdfs_storage_rls.sql` | Storage RLS on bucket `content-pdfs` | Permits authenticated students to read lecture note PDFs. |
| 7 | `063_student_selected_stream.sql` | Column: `student_details.selected_stream` (UUID) | Stores student stream preference on mobile home screen. |
| 8 | `064_profiles_selected_stream.sql` | Column: `profiles.selected_stream` (UUID) | Mirrored stream preference on user profile. |
| 9 | `065_grant_profiles_email_update.sql` | Grant: `UPDATE (email) ON public.profiles` | Permits profile email management workflows. |
| 10 | `066_register_device_token_rpc.sql` | RPC: `public.register_device_token(...)` | Required by Mobile FCM push notification service (`deviceTokenService.ts`). |
| 11 | `074_get_course_batch_subject_ids_rpc.sql` | RPC: `public.get_course_batch_subject_ids(uuid)` | Resolves batch subjects for enrolled course views. |
| 12 | `078_optimize_persist_mock_answer_live_rpc.sql` | RPC: `public.persist_mock_answer_live(...)` | **Critical:** Active real-time test runner RPC in both Admin Web and Mobile. |
| 13 | `080_create_public_catalog_rpc.sql` | RPC: `public.get_public_catalog(uuid)` | **Critical:** Single-call browse catalog RPC powering mobile unauthenticated screen. |
| 14 | `081_create_persist_mock_answers_batch_rpc.sql` | RPC: `public.persist_mock_answers_batch(...)` | **Critical:** Offline queue flush RPC in both Admin Web and Mobile test runners. |

---

### 2.3 Partially Overlapping & Superseded Migrations (19 Files)

These 19 migrations represent early developmental iterations whose functionality was subsequently replaced, improved, or superseded by higher-numbered migrations in `mocktest-admin`:

| # | App Filename | Replaced / Superseded By in Admin |
| :-: | :--- | :--- |
| 1 | `048_initialize_mock_attempt_rpc.sql` | Superseded by Admin `098` and `150_optimize_mock_attempt_initialization_and_answers.sql` |
| 2 | `051_update_initialize_mock_attempt_timer_recovery.sql` | Superseded by Admin `098` and `150` |
| 3 | `052_student_analytics_rpcs.sql` | Superseded by Admin `036`-`038` and `158`-`164` |
| 4 | `053_live_class_phase_0.sql` | Covered by Admin live class structure and `067` |
| 5 | `054_fix_live_class_rls_recursion.sql` | Covered by Admin `067` and `074` |
| 6 | `055_add_live_sessions_insert_policy.sql` | Covered by Admin live session policies |
| 7 | `056_add_student_batch_teacher_rls_policies.sql` | Covered by Admin batch-teacher policies |
| 8 | `057_fix_rls_recursion.sql` | Helper functions superseded by Admin `067` / `091` |
| 9 | `058_add_teacher_details_student_read_policy.sql` | Teacher read policy superseded by Admin `134` / `135` |
| 10 | `059_add_live_class_batch_student_read_policy.sql` | Batch student read policy superseded by Admin `067` |
| 11 | `061_live_chat_rpc_get_or_create_conversation.sql` | Superseded and hardened in Admin `067_authorize_live_class_access_rpc.sql` |
| 12 | `069_filter_weak_and_strong_chapters_by_accuracy.sql` | Superseded by Admin `159` and `163` |
| 13 | `070_submit_and_evaluate_mock_attempt_rpc.sql` | Superseded by Admin `151` (from App 076) and `161` (from App 086) |
| 14 | `071_update_submit_and_evaluate_mock_attempt_rpc.sql` | Superseded by Admin `151` and `161` |
| 15 | `072_persist_mock_answer_live_rpc.sql` | Superseded by App `078_optimize_persist_mock_answer_live_rpc.sql` |
| 16 | `073_align_persist_mock_answer_live_lock_order.sql` | Superseded by App `078` |
| 17 | `077_get_home_screen_bootstrap_rpc.sql` | Superseded by Admin `154` (from App 082) and Admin `243` |
| 18 | `090_fix_validate_active_device_unauthenticated.sql` | Superseded by Admin `119_user_device_sessions.sql` and `186` |
| 19 | `097_user_account_deletion_rpc.sql` | Comprehensively superseded by Admin `202`, `210`, `211`, `212`, `232`, `236`, `243` |

---

### 2.4 Same Functionality with Different SQL Implementation (3 Files)

| # | App Filename | Admin Counterpart | Technical Difference |
| :-: | :--- | :--- | :--- |
| 1 | `047_device_tokens.sql` | `048_device_tokens.sql` | Admin version uses sequence number `048` and contains slightly different index syntax. |
| 2 | `093_temp_perf_test_harness.sql` | `188_temp_perf_test_harness.sql` | Admin version `188` contains the comprehensive seed and cleanup harness. |
| 3 | `098_add_google_play_gateway_enum.sql` | `214_add_google_play_billing.sql` | Admin added `google_play` enum value inside its complete Google Play billing migration. |

---

### 2.5 Unrelated / Single-Tenant Migration (1 File)

| # | App Filename | Nature & Scope | Verdict |
| :-: | :--- | :--- | :--- |
| 1 | `reconcile_acknowledged_google_play_subscription.sql` | Contains an ad-hoc `DO $$` block specifically hardcoded to user UUID `'66d9f563-5180-401e-9adc-193c0f9963c7'`. | **Omit from canonical sequence.** This is a one-off operational data fix, not a schema definition. |

---

## 3. Cross-Repository Dependency & Architectural Discovery

Our deep audit uncovered a critical architectural reality: **`mocktest-admin` migrations already implicitly depend on `MockTestApp` migrations.**

### 3.1 The Missing Table Dependency in Migration 067
In `mocktest-admin/supabase/migrations/067_authorize_live_class_access_rpc.sql`:
```sql
create or replace function public.get_or_create_conversation(p_class_id uuid)
returns public.conversations  -- <-- Table public.conversations MUST exist!
language plpgsql
security definer
...
insert into public.conversations (class_id, teacher_id, student_id)
values (p_class_id, v_teacher_id, v_student_id)
```
- `public.conversations` is **never created anywhere** in `mocktest-admin/supabase/migrations`.
- It was created exclusively in `MockTestApp/supabase/migrations/060_live_chat_module.sql`.
- If an engineer attempts to build a fresh database using only `mocktest-admin` migrations `001` to `249`, **Postgres crashes at Migration 067** with:
  `ERROR: type "public.conversations" does not exist`.

### 3.2 The Missing Column Dependency in Migration 098
In `mocktest-admin/supabase/migrations/098_mock_test_attempt_entitlement.sql`:
```sql
-- Line 287:
--   - If last_activity_at is NULL (legacy data before migration 050),
if v_last_activity_at is not null and v_stored_remaining is not null then
    ...
-- Line 395:
insert into mock_attempts (..., last_activity_at) values (..., now());
```
- The author of Admin Migration 098 literally references **"legacy data before migration 050"** (referring to `MockTestApp` Migration 050).
- `last_activity_at` was **never added** to `mock_attempts` in `mocktest-admin`.
- Fresh replay of `mocktest-admin` fails at `098` with:
  `ERROR: column "last_activity_at" of relation "mock_attempts" does not exist`.

### 3.3 Test Runner Dual-Consumption
Both client applications actively consume the batch and live persistence RPCs:
- `persist_mock_answers_batch` is called by:
  - Admin Web: `src/services/student/studentTestWebService.ts` and `webPersistenceQueue.ts`
  - Mobile: `src/services/test/testEngineService.ts` and `persistenceQueue.ts`
- `persist_mock_answer_live` is called by:
  - Admin Web: `src/services/student/studentTestWebService.ts`
  - Mobile: `src/services/test/testEngineService.ts`
- These functions **only exist in MockTestApp migrations 078 and 081**. They are completely absent from `mocktest-admin` migrations.

---

## 4. Assessment of Migration 034 (`course_enrollments`)

Both repositories contain `034_domain_16_course_enrollments.sql`, but their contents differ:

```sql
<<<<<<< MockTestApp/034
create policy "Students can read course_teachers for enrolled courses"
  on public.course_teachers
  for select
  to authenticated
  using (exists (
    select 1 from public.course_enrollments ce
    where ce.course_id = course_teachers.course_id
    and ce.student_id = public.get_my_student_id()
  ));
======= mocktest-admin/034
create or replace function public.is_student_enrolled_in_course(p_course_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
    select exists (
        select 1 from public.course_enrollments ce
        where ce.course_id = p_course_id
          and ce.student_id = public.get_my_student_id()
          and ce.is_active = true
    );
$$;

create policy "Students can read course_teachers for enrolled courses"
  on public.course_teachers
  for select
  to authenticated
  using (
      public.is_student_enrolled_in_course(course_id)
  );
>>>>>>>
```

### 4.1 Production State & Immutability Determination
1. The admin implementation of `034` is technically superior: it eliminates circular RLS recursion between `course_teachers` and `course_enrollments` by using a `SECURITY DEFINER` helper function.
2. In production, this helper function is already referenced and expected by subsequent migrations (e.g. `091_unified_course_entitlement_helpers.sql` lines 87-88).
3. **Immutability Invariant:** Neither historical file should be retroactively edited. The admin version in `mocktest-admin` already represents the desired, un-recursed definition. To guarantee that production and staging environments have this helper function and policy active regardless of which historical version was originally applied, `250_consolidate_mobile_schema_parity.sql` will include `CREATE OR REPLACE FUNCTION public.is_student_enrolled_in_course` and reaffirm the policy idempotently.

---

## 5. Evaluation of Consolidation Strategies

We evaluated four strategies for consolidating migrations into `mocktest-admin/supabase`:

| Strategy | Description | Staging Viability | Production Safety | Recommendation |
| :--- | :--- | :---: | :---: | :--- |
| **Strategy A: Historical Retrofit** | Renumber the 14 missing migrations and insert them between `040` and `098`. | ⚠️ High Risk (Fails if numbers collide) | ❌ **Fatal** (Corrupts `schema_migrations`, attempts out-of-order execution) | **REJECTED** |
| **Strategy B: Forward-Only Parity Migration** | Keep `001`-`249` immutable in admin. Add `250_consolidate_mobile_schema_parity.sql` applying all 14 missing objects idempotently. | ⚠️ Needs baseline snapshot for fresh replay | ✅ **100% Safe** (Zero production risk, no-ops cleanly on existing objects) | **RECOMMENDED FOR PROD** |
| **Strategy C: Production Schema Baseline + Forward-Only** | Dump production schema into a baseline snapshot for fresh staging setup; apply forward-only migrations from `250` onwards. | ✅ **Flawless** (Guaranteed exact production parity) | ✅ **100% Safe** (Production remains untouched) | **RECOMMENDED FOR STAGING** |
| **Strategy D: Dual-Branch Maintenance** | Continue maintaining separate migration streams. | ❌ Fails (Continuous divergence) | ❌ High ongoing operational risk | **REJECTED** |

### 5.1 The Winning Combined Architecture (Strategy B + C)
1. **For Production:** Apply `250_consolidate_mobile_schema_parity.sql`. Because production already contains `conversations`, `messages`, and `mock_attempts` columns from earlier executions, every statement in `250` uses `IF NOT EXISTS` / `CREATE OR REPLACE`. It acts as a safe, non-destructive synchronization barrier.
2. **For Staging:** Because fresh replay of `001`-`249` hits the missing dependency traps in `067` and `098`, the staging database should be initialized from a **Production Schema Snapshot Baseline** (`supabase db dump --schema-only`). Once initialized to baseline version `249`, staging applies `250` and all subsequent migrations identically to production.

---

## 6. Edge Function Consolidation Assessment

### 6.1 Audit of the 3 Mobile-Only Edge Functions

| Function Name | Status in Mobile | Active Callers in Code | Rationale & Recommendation |
| :--- | :---: | :---: | :--- |
| **`send-msg91-otp`** | Active | Supabase Auth SMS Hook (`sms-provider.ts`, tests) | **MIGRATE TO ADMIN:** This is the live Supabase Auth SMS provider hook for phone OTP authentication. It must reside in `mocktest-admin/supabase/functions` with `verify_jwt = false`. |
| **`public-catalog`** | Obsolete | 0 callers | **RETIRE / DO NOT MIGRATE:** Mobile application `publicCatalogService.ts` calls RPC `get_public_catalog` directly. The Edge Function was an early REST prototype. |
| **`apply-migration`** | Obsolete / Insecure | 0 callers | **RETIRE / DO NOT MIGRATE:** Hardcoded one-off migration runner for Migration 088. Leaving direct arbitrary SQL runners in production is a severe security liability. |

### 6.2 Consolidated `mocktest-admin/supabase/config.toml` Settings
When `send-msg91-otp` is moved into `mocktest-admin`, add the following block to `mocktest-admin/supabase/config.toml`:

```toml
[functions.send-msg91-otp]
enabled = true
verify_jwt = false
import_map = "./functions/send-msg91-otp/deno.json"
entrypoint = "./functions/send-msg91-otp/index.ts"
```

---

## 7. Application Environment Separation (Staging vs Production)

### 7.1 Website / Admin Panel (`mocktest-admin`)
- **Current State:** Already configured for 12-factor environment separation. `src/lib/supabase.ts` reads `process.env.NEXT_PUBLIC_SUPABASE_URL` and `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **Staging Readiness:** 100% Ready. Simply supply staging project credentials in `.env.local` or Vercel Staging Environment.

### 7.2 Mobile Application (`MockTestApp`)
- **Current State:** Hardcoded in `src/config/supabase.ts`:
  ```ts
  const supabaseUrl = 'https://ocolfottogbybitfpdqy.supabase.co';
  const supabaseAnonKey = 'sb_publishable_BoCDWniQc9wIgovNGYuEUQ_Gwt7_55N';
  ```
- **Required Change for Staging:**
  Refactor `src/config/supabase.ts` to read from Expo environment variables with the existing production strings as fallback:
  ```ts
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://ocolfottogbybitfpdqy.supabase.co';
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_BoCDWniQc9wIgovNGYuEUQ_Gwt7_55N';
  ```
  This allows EAS Build profiles (`development`, `preview`, `production`) to inject staging credentials via `eas.json` without breaking local or production builds.

---

## 8. Explicit Answers to the 9 Verdict Questions

### 1. Is Option A still the best architecture?
**YES.** Centralizing all database migrations, Edge Functions, configuration, and types in `C:\Projects\mocktest-admin\supabase` is unquestionably the best architecture. `mocktest-admin` already hosts 255 migrations, 25 backend Edge Functions, the admin console, and full-stack Next.js tooling.

### 2. Are all migration files accounted for?
**YES. 100% of the 310 distinct filenames are mathematically and semantically accounted for:**
- 255 in admin.
- 122 in app.
- 67 intersection (61 byte-identical, 6 content-diff).
- 188 admin-only.
- 55 app-only (18 renumbered in admin, 14 genuinely missing, 19 superseded, 3 syntax variants, 1 unrelated data fix).
- The 310 vs 345 discrepancy in the first report was caused by non-mutually-exclusive overlapping category tags.

### 3. Which app migrations are genuinely missing from admin?
**Exactly 14 migrations:**
`046`, `049`, `050`, `052` (trigger), `060`, `062`, `063`, `064`, `065`, `066`, `074`, `078`, `080`, and `081`.

### 4. Can those migrations be safely incorporated without modifying previously applied production migrations?
**YES.** By encapsulating all missing objects into a single **Forward-Only Parity Migration** (`250_consolidate_mobile_schema_parity.sql`) in `mocktest-admin`. Using `IF NOT EXISTS` and `CREATE OR REPLACE`, it safely applies to production as a non-destructive zero-downtime no-op for existing structures, while guaranteeing complete schema parity.

### 5. Can we create a clean staging database from the resulting canonical source?
**YES.** By adopting the standard Supabase baseline pattern: dump the unified production schema into a baseline (`supabase db dump --schema-only`) to bootstrap the staging database, and then track all subsequent changes via forward-only migrations (`250+`).

### 6. Does production require migration-history reconciliation?
**YES, but strictly at the version tracking level (`supabase_migrations.schema_migrations`), NOT by rewriting historical SQL files.** Production simply needs to record that version `250` has been applied so future automated CI/CD deployments proceed cleanly.

### 7. What is the safest way to perform that reconciliation?
Apply `250_consolidate_mobile_schema_parity.sql` using standard Supabase CLI or SQL editor. Because all statements are guarded (`IF NOT EXISTS`), it introduces zero schema disruption while recording the new canonical version.

### 8. What must remain untouched?
1. Historical migration files `001` through `249` in `mocktest-admin/supabase/migrations` (must remain byte-immutable).
2. Existing production database tables, columns, indexes, and user data.
3. Mobile app's fallback credentials in `src/config/supabase.ts` (ensuring existing releases continue to connect seamlessly).
4. All 25 active production Edge Functions in `mocktest-admin`.

### 9. What should be implemented first?
**Order of Execution:**
1. **Step 1:** Author `250_consolidate_mobile_schema_parity.sql` in `mocktest-admin/supabase/migrations` incorporating the 14 missing objects.
2. **Step 2:** Copy `send-msg91-otp` into `mocktest-admin/supabase/functions` and register it in `config.toml`.
3. **Step 3:** Refactor `MockTestApp/src/config/supabase.ts` to support `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
4. **Step 4:** Provision the Staging Supabase project using the unified schema baseline.
5. **Step 5:** Deprecate `MockTestApp/supabase/migrations` by replacing its contents with a symlink/pointer README designating `mocktest-admin/supabase` as canonical.

---

## 9. Phased Implementation Roadmap

```mermaid
flowchart TD
    subgraph Phase 1: Canonical Preparation
        A["Author 250_consolidate_mobile_schema_parity.sql in mocktest-admin"] --> B["Copy send-msg91-otp to mocktest-admin/supabase/functions"]
        B --> C["Update mocktest-admin/supabase/config.toml"]
        C --> D["Retire apply-migration & public-catalog"]
    end

    subgraph Phase 2: Production Parity
        E["Review 250 idempotent DDL against production"] --> F["Apply Migration 250 to Production Database"]
        F --> G["Verify zero downtime & record version 250 in schema_migrations"]
    end

    subgraph Phase 3: Staging Provisioning
        H["Dump production schema baseline (supabase db dump)"] --> I["Apply baseline to new Staging Supabase Project"]
        I --> J["Deploy Edge Functions to Staging Project"]
    end

    subgraph Phase 4: Client Staging Configuration
        K["Configure Vercel Staging Environment (NEXT_PUBLIC_*)"] --> L["Configure EAS Build Profiles in eas.json (EXPO_PUBLIC_*)"]
        L --> M["Add Canonical Pointer README in MockTestApp/supabase"]
    end

    Phase 1 --> Phase 2
    Phase 2 --> Phase 3
    Phase 3 --> Phase 4
```

---

## Appendix: Specification for Migration 250

When implementation is approved, `supabase/migrations/250_consolidate_mobile_schema_parity.sql` must contain:

1. **Columns on `mock_attempts`:**
   ```sql
   ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS last_question_id uuid REFERENCES public.questions(question_id);
   ALTER TABLE public.mock_attempts ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
   ```
2. **Trigger `set_last_activity_at`:**
   ```sql
   CREATE OR REPLACE FUNCTION public.set_last_activity_at() RETURNS trigger ...
   ```
3. **Tables `conversations` and `messages`:**
   ```sql
   CREATE TABLE IF NOT EXISTS public.conversations (...);
   CREATE TABLE IF NOT EXISTS public.messages (...);
   ```
4. **Columns on `student_details` and `profiles`:**
   ```sql
   ALTER TABLE public.student_details ADD COLUMN IF NOT EXISTS selected_stream uuid REFERENCES public.streams(stream_id);
   ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS selected_stream uuid REFERENCES public.streams(stream_id);
   ```
5. **RPCs:**
   - `public.persist_mock_answers_batch(p_attempt_id uuid, p_answers jsonb)`
   - `public.persist_mock_answer_live(p_answer_id uuid, p_is_answered boolean, ...)`
   - `public.get_public_catalog(p_stream_id uuid)`
   - `public.register_device_token(p_device_token text, ...)`
   - `public.get_course_batch_subject_ids(p_course_id uuid)`
   - `public.is_student_enrolled_in_course(p_course_id uuid)` (reaffirm non-recursive RLS helper)
6. **Policies & Permissions:**
   - `Users can read published courses` on `public.courses`.
   - `content-pdfs` storage bucket read policy for authenticated students.
   - `GRANT UPDATE (email) ON public.profiles TO authenticated;`

