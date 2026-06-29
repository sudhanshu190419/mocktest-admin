# EdTech Platform — Database Schema Specification
## Domain 13: Teacher Management (HR & Business Operations)
### Tables: `teacher_employment_records` · `teacher_specializations` · `teacher_qualifications` · `teacher_experiences` · `teacher_documents` · `teacher_bank_details` · `teacher_availability` · `teacher_leave_requests`

**Document version:** 1.0
**ERD reference:** Expands upon `TeacherDetails` (ERD v2.0, Domain 1)
**PostgreSQL target:** 16
**Supabase compatibility:** Yes
**Domain sequence:** Phase 13 of 15

---

## Domain Overview

While Domain 1 handles the public-facing identity of a teacher (`TeacherDetails` with bio, rating, and public summary), **Domain 13 handles the backend business, HR, and operational realities**. 

Teachers are not just users; they are employees or contractors who need to be verified, scheduled, and paid. This domain structures a teacher's professional life cycle on the platform:
- **Financial & Contractual:** How much they are paid (`teacher_employment_records`), where they are paid (`teacher_bank_details`), and their verified KYC (`teacher_documents`).
- **Academic Pedigree:** Structured records of what they know (`teacher_qualifications`), where they have worked (`teacher_experiences`), and exactly which subjects they are authorized to teach (`teacher_specializations`).
- **Operational:** When they can take live classes (`teacher_availability`) and when they are off duty (`teacher_leave_requests`).

This data is strictly confidential. Unlike public profiles, RLS policies here ensure that only the teacher and authorized institute administrators can access these records.

---

## New Enum Types Defined in This Domain

| Enum Name | Values | Used By | Reason |
|-----------|--------|---------|--------|
| `employment_type` | `full_time`, `part_time`, `contract`, `freelance` | `teacher_employment_records.emp_type` | Determines leave eligibility and payroll logic. |
| `salary_basis_type` | `monthly_fixed`, `hourly_rate`, `revenue_share`, `per_class` | `teacher_employment_records.salary_basis` | Defines the compensation model. |
| `verification_status_type` | `pending`, `verified`, `rejected` | `teacher_documents.status`, `teacher_bank_details.status` | Standardized KYC workflow states. |
| `document_category_type` | `identity_proof`, `address_proof`, `education_cert`, `contract`, `cancelled_cheque` | `teacher_documents.category` | Classifies sensitive uploads. |
| `day_of_week_type` | `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday` | `teacher_availability.day_of_week` | Standardized weekly scheduling. |
| `leave_category_type` | `casual`, `sick`, `unpaid`, `maternity_paternity`, `compensatory` | `teacher_leave_requests.leave_category` | Categorizes time-off for payroll deductions. |
| `leave_status_type` | `pending`, `approved`, `rejected`, `cancelled` | `teacher_leave_requests.status` | Tracks the workflow of a leave request. |

---

## Table 1: `teacher_employment_records`

### 1. Purpose
The core HR and business record for a teacher. While `TeacherDetails` holds public bios and ratings, this table stores sensitive compensation details, notice periods, and hiring dates. It acts as the single source of truth for payroll calculation.

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `employment_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `teacher_id` | `UUID` | NOT NULL | — | FK → `TeacherDetails.teacher_id`. |
| `institute_id` | `UUID` | NOT NULL | — | FK → `Institute.institute_id`. The institute employing the teacher. |
| `emp_type` | `employment_type` | NOT NULL | `'contract'` | Nature of the employment. |
| `salary_basis` | `salary_basis_type` | NOT NULL | — | How compensation is calculated. |
| `base_salary` | `NUMERIC(10, 2)` | NULL | `NULL` | Fixed amount (monthly/hourly/per-class) depending on `salary_basis`. |
| `revenue_share_percent` | `NUMERIC(5, 2)` | NULL | `NULL` | Percentage cut if `salary_basis` is `revenue_share` (e.g., `30.00` for 30%). |
| `date_of_joining` | `DATE` | NOT NULL | — | Official start date. |
| `notice_period_days` | `SMALLINT` | NOT NULL | `30` | Required days of notice before resignation. |
| `is_active_employee` | `BOOLEAN` | NOT NULL | `TRUE` | False indicates the teacher has left the institute. |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Record creation timestamp. |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL | `NOW()` | Last modification timestamp. |

### 6. Primary Key
`PRIMARY KEY (employment_id)`

### 7. Foreign Keys
* `teacher_id → TeacherDetails.teacher_id (ON DELETE RESTRICT ON UPDATE RESTRICT)`
* `institute_id → Institute.institute_id (ON DELETE RESTRICT ON UPDATE RESTRICT)`

### 8. Composite Keys
None.

### 9. Unique Constraints
`UNIQUE (teacher_id)`
> A teacher can only have one active employment record per account profile. If they change terms, the existing row is updated (with audit logs tracking the history).

### 10. CHECK Constraints
* `CHECK (base_salary IS NULL OR base_salary >= 0)`
* `CHECK (revenue_share_percent IS NULL OR (revenue_share_percent >= 0 AND revenue_share_percent <= 100))`
* `CHECK (notice_period_days >= 0)`

### 11. Recommended Indexes
* `idx_teacher_emp_institute_active` `(institute_id, is_active_employee)`: HR dashboard filtering.

### 12. Soft Delete Strategy
`is_active_employee = FALSE`. Never physically delete HR records due to compliance and historical payroll integrity.

### 13. Audit Fields
* `created_at`, `updated_at`. All updates to salary fields MUST trigger an insert into the Domain 15 `AuditLog`.

### 14. Cascade Rules
* DELETE `TeacherDetails`: RESTRICT.
* DELETE `Institute`: RESTRICT.

### 15. Supabase Row Level Security Considerations
* **Teachers:** `SELECT` their own record (`teacher_id = auth.uid()` via profile join). No `INSERT/UPDATE/DELETE`.
* **Admins:** `ALL` for their `institute_id`.
* **Students:** Blocked.

### 16. Notes for Backend Developers
* Compensation logic varies heavily by `salary_basis`. Ensure backend payroll services validate which numeric field to pull based on this enum.

---

## Table 2: `teacher_specializations`

### 1. Purpose
Replaces the flat comma-separated text string with a structured M:N junction linking a teacher to the specific academic `Subject`s they are authorized to teach. This powers the scheduling system, ensuring a Physics teacher cannot accidentally be assigned to a Biology Live Class.

### 2–5. Column Specification

| Column | PostgreSQL Type | Nullable | Default | Notes |
|--------|----------------|----------|---------|-------|
| `specialization_id` | `UUID` | NOT NULL | `gen_random_uuid()` | Primary key. |
| `teacher_id` | `UUID` | NOT NULL | — | FK → `TeacherDetails.teacher_id`. |
| `subject_id` | `UUID` | NOT NULL | — | FK → `Subject.subject_id`. |
| `proficiency_level` | `SMALLINT` | NOT NULL | `3` | Scale