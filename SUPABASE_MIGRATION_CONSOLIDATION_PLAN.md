# Supabase Migration Consolidation & Staging Environment Architecture Plan

**Product:** Make Me Topper  
**Repositories:**
- Website / Admin Panel: `C:\Projects\mocktest-admin`
- Mobile Application: `C:\Projects\MockTestApp`
**Target Environment:** Shared Supabase Backend (`ocolfottogbybitfpdqy`)  
**Audit Date:** 2026-11-20  
**Mode:** Analysis and Architecture Plan Only (Strictly Read-Only — No files modified, no migrations applied, no remote changes executed)

---

## 1. Executive Summary

### The Core Problem
Make Me Topper operates as a single unified education platform consisting of two frontend repositories: a Next.js web application / admin panel (`mocktest-admin`) and a React Native mobile application (`MockTestApp`). Both applications connect to the **same remote Supabase project** (`https://ocolfottogbybitfpdqy.supabase.co`).

However, database migrations and Supabase configurations are currently split and duplicated across both codebases in a severely desynchronized state:
- `mocktest-admin` contains **255 migration files** and **28 Edge Functions**.
- `MockTestApp` contains **122 migration files** and **6 Edge Functions**.
- Only **61 migration files** are identical across both repositories.
- **63 prefix number collisions** exist between migrations `023` and `098`, where the same numeric prefix in each repository points to completely different database features.
- **37 migrations** exist **only** in `MockTestApp` and were never merged into `mocktest-admin`. These migrations create critical database objects used by both the mobile app and admin panel, including the **Live Chat module (`conversations`, `messages`)**, the **test-runner persistence RPCs (`persist_mock_answer_live`, `persist_mock_answers_batch`)**, the **public catalog RPC (`get_public_catalog`)**, and the **device token registration RPC (`register_device_token`)**.
- **188 migrations** exist **only** in `mocktest-admin` and were never merged into `MockTestApp`, including academic batch management (Domain 17), timetable scheduling, audit infrastructure, admin roles, doubts module, recordings/HLS, installments, and commerce fulfillment.

### The Root Cause
Early in product development (migrations `001` through `025`), both repositories were initialized with identical foundation migrations. As feature development accelerated, web/admin developers and mobile developers worked independently. Each team created new sequential numbered migrations (`036_...`, `048_...`, `060_...`, `075_...`, `090_...`) inside their own local repository without cross-repository coordination.

When developers deployed database changes, they frequently executed SQL scripts directly via the **Supabase Dashboard SQL Editor** or via ad-hoc Edge Functions (such as `MockTestApp/supabase/functions/apply-migration`), rather than through a synchronized CLI migration pipeline (`supabase db push`). 

Over time, this caused the live production database schema to become the union of both migration streams, while **neither repository alone possesses a complete, executable migration history**. Attempting to deploy either repository to a fresh Supabase staging project fails immediately due to missing tables, missing functions, and colliding migration version numbers.

---

## 2. Project Structure Comparison

### Directory Layout

```
Make Me Topper Platform
│
├── C:\Projects\mocktest-admin (Website / Admin Panel)
│   ├── .env.local                            [NEXT_PUBLIC_SUPABASE_URL=ocolfottogbybitfpdqy]
│   └── supabase/
│       ├── config.toml                       [4,382 bytes, 92 lines, 14 Edge Functions configured]
│       ├── migrations/                       [255 .sql files, migrations 001 to 249]
│       ├── functions/                        [28 Edge Functions + _shared]
│       │   ├── admin-identity-create/
│       │   ├── apple-app-store-notifications/
│       │   ├── complete-course-purchase/
│       │   ├── complete-installment-purchase/
│       │   ├── complete-pyq-purchase/
│       │   ├── create-payment-order/
│       │   ├── device-approve/, device-challenge/, device-list/, device-reject/, device-revoke/
│       │   ├── dispatch-notification/
│       │   ├── live-class-watchdog/
│       │   ├── livekit-token/, livekit-webhook/
│       │   ├── razorpay-webhook/
│       │   ├── recording-delete/, recording-egress-start/, recording-egress-stop/, recording-playback-url/, recording-timeout/, recording-webhook/
│       │   ├── teacher-identity-create/
│       │   ├── timetable-materialization/
│       │   ├── user-account-delete/
│       │   ├── verify-apple-purchase/
│       │   └── verify-google-play-purchase/
│       ├── patches/                          [035_fix_course_teachers_recursion.sql]
│       └── tests/                            [installment and preflight SQL test suites]
│
└── C:\Projects\MockTestApp (Mobile React Native Application)
    ├── src/config/supabase.ts                [Hardcoded URL=ocolfottogbybitfpdqy]
    └── supabase/
        ├── config.toml                       [687 bytes, 21 lines, 4 Edge Functions configured]
        ├── migrations/                       [122 .sql files, migrations 001 to 249 with massive gaps]
        ├── functions/                        [6 Edge Functions]
        │   ├── apple-app-store-notifications/
        │   ├── apply-migration/              [Custom SQL executor used for ad-hoc remote DDL]
        │   ├── livekit-token/
        │   ├── public-catalog/               [Mobile-only catalog proxy]
        │   ├── send-msg91-otp/               [Mobile-only MSG91 SMS OTP provider]
        │   └── user-account-delete/
        └── patches/                          [038_fix_weak_strong_chapters_percentage.sql]
```

### Detailed Structural Disparities

| Feature / Artifact | `mocktest-admin` | `MockTestApp` | Architectural Impact |
| :--- | :--- | :--- | :--- |
| **Total Migrations** | 255 SQL files | 122 SQL files | `MockTestApp` lacks 188 migrations present in `mocktest-admin`. |
| **Edge Functions** | 28 functions | 6 functions | `mocktest-admin` owns all webhook and lifecycle functions. `MockTestApp` owns `send-msg91-otp` and `public-catalog`. |
| **`config.toml`** | 92 lines (comprehensive) | 21 lines (partial) | `MockTestApp`'s `config.toml` omits webhook security (`verify_jwt = false`) for Razorpay, Apple, and Cron jobs. |
| **Ad-Hoc DDL Runner** | None | `functions/apply-migration` | An Edge Function was deployed to execute SQL directly from mobile code, bypassing CLI migration tracking. |
| **Client Configuration** | `.env.local` (environment-driven) | `src/config/supabase.ts` (hardcoded URL/anon key) | Mobile app requires build-time config/environment variables to switch to Staging. |

---

## 3. Migration Inventory

An automated cryptographic inventory across both projects (`C:\Projects\mocktest-admin\supabase\migrations` and `C:\Projects\MockTestApp\supabase\migrations`) established:

- **Total Distinct Migration Filenames Across Both Projects:** **310 files**
- **Identical Files (Same Name, Identical SHA-256 Hash):** **61 files**
- **Files With Same Name But Different Hash:** **6 files**
- **Files Existing Only in `mocktest-admin`:** **188 files**
- **Files Existing Only in `MockTestApp`:** **55 files**

### Category Breakdown of All 310 Migrations

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                    CONSOLIDATED MIGRATION POPULATION (310 Files)                 │
├────────────────────────────────────────┬────────┬────────────────────────────────┤
│ Category / Range                       │ Count  │ Characteristics                │
├────────────────────────────────────────┼────────┼────────────────────────────────┤
│ Foundation (001–025)                   │ 25     │ Identical in both projects.    │
│ Early Divergence (026–035)             │ 12     │ Admin added admin/storage.     │
│ Independent Collisions (036–098)       │ 120    │ Colliding numbers in app/admin │
│ Admin Platform Expansion (099–149)     │ 51     │ Timetable, audit, doubts.      │
│ App Renumbering Import (150–164)       │ 15     │ Admin imported App 075–089.    │
│ Academic & Attendance (165–185)        │ 21     │ Teacher attendance, batch RPCs.│
│ Second App Renumbering (186–203)       │ 18     │ Admin imported App 091–097.    │
│ Google Play & Installments (204–239)   │ 36     │ Admin Play RTDN & installments.│
│ Retirement & Apple IAP (240–249)       │ 10     │ Present in both projects.      │
│ Truly Unique App Migrations            │ 37     │ Never imported into admin.     │
└────────────────────────────────────────┴────────┴────────────────────────────────┘
```

---

## 4. Migration Conflicts & Discrepancies

### A. Same-Name Content Differences (6 Files)

An exhaustive unified diff of the 6 files with matching names but different SHA-256 hashes revealed:

1. **`034_domain_16_course_enrollments.sql` (GENUINE SQL CONTENT DIFFERENCE):**
   - In `mocktest-admin`, this file contains an essential `SECURITY DEFINER` helper function `is_student_enrolled_in_course(p_course_id uuid)` and updates the `course_teachers` SELECT policy to break an infinite RLS recursion loop between `course_teachers` and `course_enrollments`.
   - In `MockTestApp`, this file contains the unpatched, recursive inline subquery that causes PostgreSQL infinite recursion errors.
   - **Resolution:** The `mocktest-admin` version is authoritative and must be kept.
2. **`209_fix_subscription_end_date_constraint.sql`:** 0 lines of textual difference. Disparity is strictly CRLF vs LF line endings.
3. **`210_fix_account_deletion_rpc_and_fk_indexes.sql`:** 0 lines of textual difference (CRLF vs LF).
4. **`211_fix_account_deletion_rpc_schema_alignment.sql`:** 0 lines of textual difference (CRLF vs LF).
5. **`212_capture_pending_doubt_storage_paths.sql`:** 0 lines of textual difference (CRLF vs LF).
6. **`249_apple_server_notifications.sql`:** 1 trailing newline difference at EOF. 100% logic and SQL identity.

### B. Prefix Collisions (63 Collisions Between 023 and 098)

In 63 instances, both projects defined migrations with the exact same prefix number but completely different file names, purposes, and tables:

| Prefix | `mocktest-admin` Migration | `MockTestApp` Migration | Overlap / Conflict |
| :--- | :--- | :--- | :--- |
| `036` | `036_student_dashboard_summary_rpc.sql` | `036_add_guardian_fields_to_student_details.sql` | Totally different. App's `036` was added to Admin as `040`. |
| `048` | `048_device_tokens.sql` (table & RLS) | `048_initialize_mock_attempt_rpc.sql` (test runner RPC) | Major conflict. |
| `053` | `053_live_class_attendance.sql` | `053_live_class_phase_0.sql` | Major conflict. |
| `060` | `060_add_teacher_subject_insert_policy.sql` | `060_live_chat_module.sql` | Major conflict. App's `060` creates `conversations` & `messages`. |
| `066` | `066_domain_17_batch_subject_core.sql` | `066_register_device_token_rpc.sql` | Major conflict. Admin creates batch tables; App creates token RPC. |
| `070` | `070_domain_17_batch_subject_live_classes.sql` | `070_submit_and_evaluate_mock_attempt_rpc.sql` | Major conflict. Admin creates class tables; App creates test engine. |
| `080` | `080_soft_delete_foundation.sql` | `080_create_public_catalog_rpc.sql` | Major conflict. Admin creates audit soft deletes; App creates catalog. |
| `098` | `098_mock_test_attempt_entitlement.sql` | `098_add_google_play_gateway_enum.sql` | Admin creates mock attempt guards; App adds enum value. |

### C. Missing Migrations: 37 App-Only Migrations Missing from `mocktest-admin`

Cross-referencing codebase calls against database DDL confirmed that `mocktest-admin` is **missing 37 migrations** originally written in `MockTestApp`. The most critical missing components include:

1. **Live Chat Module (`060_live_chat_module.sql`, `061_live_chat_rpc_get_or_create_conversation.sql`):**
   - Creates `public.conversations` and `public.messages`.
   - Configures Supabase Realtime publication on `messages`.
   - Configures RLS policies for 1-to-1 teacher/student chat.
   - **Critical Dependency:** `mocktest-admin` migrations `202`, `210`, and `211` (`delete_user_account_data`) issue explicit DDL/DML targeting `public.conversations` and `public.messages`. Running `mocktest-admin` on a clean staging database aborts because these tables do not exist!
2. **Atomic Test Runner Engine (`072`, `073`, `078`, `081`):**
   - Defines `public.persist_mock_answer_live(...)` and `public.persist_mock_answers_batch(...)`.
   - Used by the mobile test engine (`src/services/testEngineService.ts`) to flush answers during live examinations.
3. **Public Catalog Composite RPC (`080_create_public_catalog_rpc.sql`):**
   - Defines `public.get_public_catalog(p_stream_id uuid)`.
   - Called by `MockTestApp/src/services/home/publicCatalogService.ts` to power the mobile course store and unauthenticated home screen bootstrap.
4. **Device Token Registration RPC (`066_register_device_token_rpc.sql`):**
   - Defines `public.register_device_token(...)`.
   - Used by mobile push notification services for FCM token registration.
5. **Exam Attempt Tracking Columns (`049`, `050`, `052`):**
   - Adds `last_question_id`, `last_activity_at`, and trigger `set_last_activity_at` to `public.mock_attempts`.

---

## 5. Current Migration State & Production History

### How Supabase CLI Tracks Migrations
Supabase CLI records applied migrations in a dedicated internal PostgreSQL table:
```sql
supabase_migrations.schema_migrations (
    version text PRIMARY KEY,
    statements text[],
    name text
)
```
When `supabase db push` executes, it compares the local migration directory against the rows in `supabase_migrations.schema_migrations`:
- If a local version exists that is not in `schema_migrations`, it executes the SQL file.
- If a version is in `schema_migrations` but missing locally, CLI warns of a remote drift.
- If a local migration file has a version number matching an existing row in `schema_migrations`, **it is completely skipped**, regardless of whether the file's SQL contents differ.

### Why Neither Project Can Safely Run `supabase db push` Today
1. **Version Collisions Would Skip Crucial DDL:**
   If `schema_migrations` on the remote database recorded version `060` from `MockTestApp` (`060_live_chat_module.sql`), running `supabase db push` from `mocktest-admin` would **skip** `060_add_teacher_subject_insert_policy.sql` because version `060` is considered applied!
2. **Missing Prerequisite Objects:**
   If `supabase db push` runs from `mocktest-admin` on a new staging database, it fails on migration `202` because `conversations` does not exist.
   If it runs from `MockTestApp`, it fails immediately because over 130 migrations (Domain 17 batch subjects, timetables, soft deletes, commerce) are missing.
3. **Historical SQL Editor Execution:**
   Past reports (e.g. `REVISION_219_MANUAL_APPLY_PREFLIGHT.md`) confirm that because of this divergence, developers stopped using `supabase db push` and applied migrations manually in the Supabase Dashboard SQL Editor. As a result, the remote database has tables and functions whose version numbers may not even be recorded in `schema_migrations`.

---

## 6. Evaluation of Consolidation Strategies

### Option A: Centralized Migrations in `mocktest-admin` (RECOMMENDED)

Keep all Supabase migrations, Edge Functions, and configuration in:
```text
C:\Projects\mocktest-admin\supabase
```
`MockTestApp` deletes its local `supabase/migrations` directory and acts solely as a client of the Supabase API.

- **Advantages:**
  - `mocktest-admin` already owns **82% of all migrations** (255 files) and **93% of all Edge Functions** (28 functions).
  - The admin/web panel repository is naturally managed by backend-focused engineers.
  - Eliminates migration drift at the root: developers only have one place to add SQL files.
  - Keeps the React Native mobile repository lightweight, clean, and free of backend Deno/Supabase CLI dependencies.
- **Disadvantages:** Mobile developers making schema changes must open a PR in `mocktest-admin`.
- **Complexity:** Low to Moderate (one-time reconciliation of the 37 missing mobile migrations).
- **Risk:** Very Low for production; high stability for staging.

### Option B: Centralized Migrations in `MockTestApp`

Keep all migrations in `C:\Projects\MockTestApp\supabase\migrations`.

- **Advantages:** Mobile developers have local access to migrations.
- **Disadvantages:**
  - `MockTestApp` is missing 188 migrations. Importing 188 migrations and 28 Edge Functions into a React Native repository adds unnecessary bloat.
  - Web developers would have to clone the mobile app to run database migrations.
- **Verdict:** **REJECTED** (Illogical and counterproductive).

### Option C: Dedicated Database Repository (`makemetopper-database`)

Create a third, independent Git repository exclusively for database migrations, Edge Functions, seeds, and Supabase CI/CD workflows.

- **Advantages:** Pure separation of concerns. Both `mocktest-admin` and `MockTestApp` treat the database as an external dependency.
- **Disadvantages:**
  - Overhead of managing a third repository for a small-to-medium development team.
  - Triples PR coordination: adding a new feature requires 3 separate PRs across 3 repos.
  - Over-engineered for the current team size.
- **Verdict:** **NOT RECOMMENDED AT THIS STAGE** (Can be revisited if the team scales to dedicated database engineers).

### Option D: Git Submodule or Monorepo

Convert the two repositories into a monorepo or share `supabase/migrations` via a Git submodule.

- **Advantages:** Code is physically shared between repositories.
- **Disadvantages:**
  - Windows Git submodules frequently suffer from path and line-ending (CRLF vs LF) synchronization issues.
  - Monorepo migration requires massive restructuring of CI/CD, EAS build pipelines, and Vercel deployments.
- **Verdict:** **REJECTED** (High risk and unnecessary disruption).

---

## 7. Consolidation Feasibility & Architecture

### Is Safe Consolidation Feasible?
**YES.** Consolidation can be achieved cleanly without modifying production by establishing `mocktest-admin\supabase\migrations` as the **Canonical Migration Source**.

### What Must Be Reconciled (The "Do Not Blindly Copy" Rule)
1. **Do NOT blindly copy `MockTestApp/supabase/migrations` into `mocktest-admin`:**
   Copying files directly would overwrite or collide with 63 admin migration files sharing numbers `036` through `098`.
2. **Re-sequence the 37 Missing Mobile Migrations:**
   The 37 unique mobile migrations must be integrated into `mocktest-admin` by placing them into logical, non-colliding migration slots:
   - Early structural dependencies (such as `060_live_chat_module.sql` creating `conversations` and `messages`) must be sequenced **before** migrations that reference them (e.g. before migration `067` or `202`).
   - Mobile test runner RPCs (`persist_mock_answer_live`, `persist_mock_answers_batch`, `get_public_catalog`) should be sequenced cleanly where their dependent tables already exist.
3. **Incorporate Mobile Edge Functions:**
   - Copy `send-msg91-otp` from `MockTestApp/supabase/functions/` to `mocktest-admin/supabase/functions/`.
   - Copy `public-catalog` from `MockTestApp/supabase/functions/` to `mocktest-admin/supabase/functions/`.
   - Update `mocktest-admin/supabase/config.toml` to declare both functions.
   - Delete `apply-migration` (the dangerous ad-hoc SQL executor).

---

## 8. Staging Environment Setup Plan

### Objective
Create a separate, isolated Supabase Staging project (e.g. `makemetopper-staging`) containing the 100% complete database schema, RLS policies, triggers, and Edge Functions, allowing end-to-end testing of both the web panel and mobile app before production deployment.

### Step-by-Step Staging Setup Workflow

```
[Phase A: Local Preparation in mocktest-admin]
  1. Reconcile 37 missing mobile migrations into mocktest-admin.
  2. Validate canonical sequence with a local test validation runner.
       │
       ▼
[Phase B: Supabase Staging Project Provisioning]
  3. Create new Supabase project in Supabase Dashboard: "makemetopper-staging".
  4. Obtain Staging Project Ref: <staging-ref>, Staging Database Password, Staging URL & Anon Key.
       │
       ▼
[Phase C: Staging Migration & Function Deployment]
  5. Link CLI locally to staging:
     supabase link --project-ref <staging-ref>
  6. Push entire canonical migration sequence to staging:
     supabase db push
  7. Deploy all 30 Edge Functions to staging:
     supabase functions deploy
  8. Set Staging Edge Function Secrets:
     supabase secrets set --env-file .env.staging.secrets
       │
       ▼
[Phase D: Client Applications Staging Integration]
  9. Web: Configure .env.staging with Staging URL & Anon Key; deploy to staging preview.
  10. App: Add staging build variant / environment variable in src/config/supabase.ts.
       │
       ▼
[Phase E: End-to-End Validation on Staging]
  11. Test Mobile: Login with MSG91 OTP -> Home Screen Catalog -> Test Attempt Persistence -> Live Chat.
  12. Test Web: Admin Dashboard -> Batch Management -> Live Class Scheduling -> Test Result Release.
```

---

## 9. Future Development Workflow

To permanently eliminate migration drift, all future database changes must follow this single-source workflow:

```
                      DEVELOPER WANTS A DATABASE CHANGE
                                      │
                                      ▼
           Create new migration exclusively in mocktest-admin:
           C:\Projects\mocktest-admin\supabase\migrations\<timestamp>_<feature>.sql
                                      │
                                      ▼
                      Test migration locally or in Staging:
                      supabase db push (linked to Staging)
                                      │
                                      ▼
                 Generate updated TypeScript database types:
                 supabase gen types typescript --linked > src/types/database.ts
                                      │
                                      ▼
                   Commit & Push PR to mocktest-admin repo
                                      │
                                      ▼
              Staging Validation with both Web and Mobile App
                                      │
                                      ▼
                     PRODUCTION DEPLOYMENT GATE (Approved)
                 Migration applied to Production via CI/CD
```

### Mobile Developer Rule
Mobile developers **never create migration files inside `MockTestApp`**. When a mobile feature requires a new table, column, or RPC:
1. The developer adds the migration to `mocktest-admin/supabase/migrations`.
2. Tests it on Staging.
3. Generates types and consumes the RPC in `MockTestApp`.

---

## 10. Production Safety & Safeguards

To ensure that the existing production database (`https://ocolfottogbybitfpdqy.supabase.co`) remains completely untouched during this transition:

1. **Never Link Production Locally:**
   Developers must **never** run `supabase link --project-ref ocolfottogbybitfpdqy` on their local machines. Local development must be linked exclusively to Staging (`<staging-ref>`).
2. **Explicit Project Ref Flags:**
   Any CI/CD script running migrations must use explicit target flags:
   `supabase db push --project-ref <target-ref> --password <db-password>`.
3. **No Blind `db reset` or `db push` on Production:**
   - `supabase db reset` must be strictly prohibited on remote databases (it destroys and recreates the public schema).
   - `supabase migration repair` must never be run without a prior dry-run comparison between local migration files and `schema_migrations`.
4. **Environment Isolation in Git:**
   - `.env.local` and `.supabase/` must remain in `.gitignore`.
   - Production secrets must reside strictly in GitHub Actions Secrets with protected branch environments.

---

## 11. Phased Implementation Roadmap

| Phase | Title | Prerequisites | Expected Changes | Risks | Validation Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | **Inventory & Verification** | Read access to both repos | Detailed mapping of all 310 migrations (Completed). | None (Read-only). | All 310 files cataloged and classified. |
| **Phase 2** | **Architecture Approval** | Review of this report | User approval of Option A (Centralize in `mocktest-admin`). | None. | Explicit user sign-off on strategy. |
| **Phase 3** | **Migration Consolidation** | Phase 2 approved | Integrate 37 mobile migrations into `mocktest-admin`; import `send-msg91-otp` & `public-catalog` functions. | Numbering collisions if done incorrectly. | Zero colliding numbers; all referenced objects present in canonical folder. |
| **Phase 4** | **Dry-Run Validation** | Consolidated SQL sequence | Run the consolidated migration sequence in a fresh local or containerized test DB. | Syntax or ordering errors in SQL. | All migrations execute from 001 to 249 with 0 errors. |
| **Phase 5** | **Staging Setup** | New Supabase project created | Link CLI to Staging project; push migrations; deploy 30 Edge Functions; configure secrets. | Cloud quota limits; missing extensions. | Staging database matches production schema; all Edge Functions return 200/healthy. |
| **Phase 6** | **App & Web Staging Testing** | Staging DB ready | Configure `.env.staging` for web; update mobile app config to point to Staging; test all flows. | Staging auth/storage misconfigurations. | Mobile app and Web admin panel function seamlessly against Staging backend. |
| **Phase 7** | **Production Alignment** | Staging testing passed | Audit production schema against canonical migrations; safely align `schema_migrations` table; deprecate `MockTestApp/supabase/migrations`. | Accidental schema alteration on production. | Production schema verified identical to canonical migrations; 0 production downtime. |

---

## 12. Final Verdict: Explicit Answers to the 8 Core Questions

### 1. Why are migrations currently spread across two projects?
Migrations are spread across both repositories due to historical organic drift. The platform started with shared migrations 001–025. Web developers and mobile developers subsequently added features in parallel inside their respective repositories without a centralized database workflow or cross-repository synchronization. Both teams independently assigned numbers `036`–`098` to different migrations, and deployed changes directly via the Supabase Dashboard SQL Editor when CLI tools conflicted.

### 2. Is this arrangement actually preventing staging deployment, or is there another underlying issue?
**YES, it directly prevents staging deployment.** Neither repository has a complete database schema. `mocktest-admin` lacks the live chat tables (`conversations`, `messages`) and mobile test-engine RPCs, causing fresh deployments to fail. `MockTestApp` lacks over 188 admin, academic, and commerce migrations. Furthermore, the 63 prefix number collisions prevent merging the directories without manual re-sequencing.

### 3. Can both migration directories be safely consolidated?
**YES.** Consolidation is 100% feasible and safe because it can be planned, sequenced, and validated locally and against a new Staging database without touching or risking the live production database.

### 4. Which repository should own migrations?
**`mocktest-admin`** (`C:\Projects\mocktest-admin\supabase`). It already contains 82% of all migrations, 93% of all Edge Functions, and the comprehensive Supabase configuration. The mobile repository should be a pure API consumer.

### 5. Is a dedicated migration repository necessary?
**NO.** A dedicated third repository would introduce unnecessary maintenance overhead, extra CI/CD pipelines, and triple-PR coordination for a team of this size. Centralizing in `mocktest-admin` accomplishes the exact same architectural goals with significantly lower operational friction.

### 6. Can we build a clean staging database using the existing migration files?
**YES, but only by combining the reconciled migrations into `mocktest-admin`.** You cannot build it using `mocktest-admin` alone today, nor using `MockTestApp` alone. Once the 37 missing mobile migrations are integrated into `mocktest-admin`, a fresh staging database can be built cleanly from scratch using `supabase db push`.

### 7. What existing migration-history inconsistencies must be resolved first?
1. **63 Prefix Collisions:** Re-sequencing the 37 mobile migrations to avoid conflicting with admin migration numbers `036`–`098`.
2. **Missing Live Chat Tables:** Ensuring `060_live_chat_module.sql` (creating `conversations` and `messages`) is sequenced before migrations `202`, `210`, and `211`.
3. **Missing Mobile Edge Functions:** Moving `send-msg91-otp` and `public-catalog` into `mocktest-admin/supabase/functions/`.
4. **Outdated Recursion Policy in App's 034:** Enforcing the `mocktest-admin` version of `034_domain_16_course_enrollments.sql` as canonical.
5. **Mobile Hardcoded Supabase Config:** Updating `MockTestApp/src/config/supabase.ts` to support environment variables for Staging vs Production switching.

### 8. What is the safest implementation approach?
The safest approach is **Option A (Centralize in `mocktest-admin`) executed strictly in the proposed 7-Phase Roadmap**. 
No changes will be made to the live production database until the complete consolidated migration sequence has been pushed to a new Staging Supabase project, verified by running both the web admin panel and mobile application against Staging, and reviewed for zero-drift alignment.

