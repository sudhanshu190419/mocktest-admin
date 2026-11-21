# Make Me Topper — Transactional Email Notification System
# Production Smoke Test Execution Guide

**Target Repository:** `C:\Projects\mocktest-admin`  
**Production Supabase Project:** `ocolfottogbybitfpdqy`  
**Target Function:** `email-worker` (`https://ocolfottogbybitfpdqy.supabase.co/functions/v1/email-worker`)  
**Target Webhook:** `email-webhook` (`https://ocolfottogbybitfpdqy.supabase.co/functions/v1/email-webhook`)  
**Template Used:** `test_email` (defined in `supabase/functions/_shared/email/templates.ts`)  
**Database Tables:** `public.email_queue`, `public.email_delivery_logs`, `public.email_suppressions`

---

## Overview & Safety Pre-Conditions

This guide provides the exact step-by-step procedure to execute a single, isolated end-to-end smoke test of the deployed transactional email system in production without modifying codebase logic or affecting real students.

### Safety Rules:
1. **Never hardcode secrets into scripts or version control.** Always supply secrets via temporary environment variables or session tokens.
2. **Use your own recipient email address** for `<YOUR_EMAIL_ADDRESS>`.
3. **Reconciliation service remains dormant.** Do not set `EMAIL_INTEGRATION_ACTIVATION_TIMESTAMP` or run historical backfills.
4. **Isolated Test Identifier:** Uses a unique idempotency key (`smoke_test_<timestamp>`) and event type (`SMOKE-TEST`) so the test row is easily auditable and cannot duplicate.

---

## Step 1: Enqueue One Test Email Job via SQL

Open the **Supabase Dashboard SQL Editor** for project `ocolfottogbybitfpdqy`:
[https://supabase.com/dashboard/project/ocolfottogbybitfpdqy/sql](https://supabase.com/dashboard/project/ocolfottogbybitfpdqy/sql)

Execute the following SQL using named parameter syntax matching `public.enqueue_email_job`:

```sql
-- Step 1: Enqueue one test_email job to your personal email address
SELECT public.enqueue_email_job(
    p_recipient_email       := '<YOUR_EMAIL_ADDRESS>',
    p_subject               := 'Production Smoke Test — Make Me Topper',
    p_template_id           := 'test_email',
    p_payload               := jsonb_build_object(
        'title', 'Production Smoke Test Verification',
        'message', 'This is an end-to-end production smoke test verifying the Make Me Topper transactional email system.',
        'testId', 'SMOKE-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS'),
        'actionUrl', 'https://makemetopper.com',
        'actionText', 'Verify Make Me Topper Portal'
    ),
    p_recipient_profile_id  := NULL,
    p_recipient_name        := 'Smoke Test Reviewer',
    p_event_type            := 'SMOKE-TEST',
    p_priority              := 'critical'::public.email_priority,
    p_idempotency_key       := 'smoke_test_' || to_char(clock_timestamp(), 'YYYYMMDD_HH24MISS'),
    p_max_attempts          := 5
);
```

### Expected Output:
```json
{
  "code": "ENQUEUED",
  "queue_id": "<generated-uuid>",
  "status": "pending",
  "success": true
}
```
*Note the returned `queue_id` for tracking.*

---

## Step 2: Verify the Job Entered `email_queue`

Immediately run this query in the SQL Editor to verify the job is queued with `pending` status:

```sql
-- Step 2: Verify pending queue entry
SELECT 
    queue_id,
    recipient_email,
    recipient_name,
    event_type,
    subject,
    template_id,
    priority,
    status,
    delivery_status,
    attempts,
    max_attempts,
    idempotency_key,
    provider_message_id,
    created_at,
    next_retry_at
FROM public.email_queue
WHERE recipient_email = lower(trim('<YOUR_EMAIL_ADDRESS>'))
ORDER BY created_at DESC
LIMIT 1;
```

### Expected Verification Checklist:
- `status`: **`pending`**
- `delivery_status`: **`unsent`**
- `priority`: **`critical`**
- `attempts`: **`0`**
- `provider_message_id`: **`NULL`**
- `locked_at`: **`NULL`**
- `locked_by`: **`NULL`**

---

## Step 3: Invoke the Deployed `email-worker` Edge Function

Open PowerShell on your local workstation. You can invoke the worker using either authentication method supported by `email-worker/index.ts`:

### Method A: Using Service-Role Key (Recommended for Admin CLI)

```powershell
# Set variables (replace placeholders with actual values)
$ProjectRef = "ocolfottogbybitfpdqy"
$WorkerUrl = "https://$ProjectRef.supabase.co/functions/v1/email-worker?batch=10"
$ServiceRoleKey = "<YOUR_SUPABASE_SERVICE_ROLE_KEY>"

$Headers = @{
    "Authorization" = "Bearer $ServiceRoleKey"
    "Content-Type"  = "application/json"
}

# Invoke worker batch execution
$Response = Invoke-RestMethod -Uri $WorkerUrl -Method Post -Headers $Headers
$Response | ConvertTo-Json -Depth 5
```

### Method B: Using Dedicated Worker Secret (`X-Worker-Key`)

```powershell
# Set variables (replace placeholders with actual values)
$ProjectRef = "ocolfottogbybitfpdqy"
$WorkerUrl = "https://$ProjectRef.supabase.co/functions/v1/email-worker?batch=10"
$WorkerSecret = "<YOUR_EMAIL_WORKER_SECRET>"

$Headers = @{
    "X-Worker-Key" = $WorkerSecret
    "Content-Type" = "application/json"
}

# Invoke worker batch execution
$Response = Invoke-RestMethod -Uri $WorkerUrl -Method Post -Headers $Headers
$Response | ConvertTo-Json -Depth 5
```

### Expected HTTP 200 Response:
```json
{
  "cancelled": 0,
  "durationMs": 348,
  "failed": 0,
  "provider": "resend",
  "retried": 0,
  "succeeded": 1,
  "success": true,
  "totalClaimed": 1
}
```

---

## Step 4: Verify Final Queue Status and Delivery Logs in SQL

Run the following queries in the Supabase Dashboard SQL Editor:

### 4.1. Verify Queue Item Transition to `sent`
```sql
-- Step 4.1: Check queue item status post-dispatch
SELECT 
    queue_id,
    recipient_email,
    event_type,
    subject,
    status,
    delivery_status,
    attempts,
    provider_message_id,
    sent_at,
    last_error,
    updated_at
FROM public.email_queue
WHERE recipient_email = lower(trim('<YOUR_EMAIL_ADDRESS>'))
ORDER BY created_at DESC
LIMIT 1;
```

#### Expected Values:
- `status`: **`sent`**
- `delivery_status`: **`accepted`** (immediately after provider dispatch) or **`delivered`** (if webhook has already arrived)
- `attempts`: **`1`**
- `provider_message_id`: **Populated** with Resend message ID (e.g. `re_1234567890abcdef...`)
- `sent_at`: **Populated** with current timestamp
- `last_error`: **`NULL`**

---

### 4.2. Verify Audit Records in `email_delivery_logs`
```sql
-- Step 4.2: Inspect delivery logs for the smoke test
SELECT 
    l.log_id,
    l.queue_id,
    l.provider,
    l.event_type,
    l.provider_message_id,
    l.svix_event_id,
    l.payload,
    l.created_at
FROM public.email_delivery_logs l
WHERE l.queue_id = (
    SELECT q.queue_id 
    FROM public.email_queue q 
    WHERE q.recipient_email = lower(trim('<YOUR_EMAIL_ADDRESS>')) 
    ORDER BY q.created_at DESC 
    LIMIT 1
)
ORDER BY l.created_at ASC;
```

#### Expected Log Progression:
1. **Initial Dispatch Log:**
   - `provider`: `'resend'`
   - `event_type`: `'sent'`
   - `provider_message_id`: matches Resend ID
   - `payload`: `{"success": true, "recorded_at": "..."}`
2. **Webhook Confirmation Log (upon delivery):**
   - `provider`: `'resend'`
   - `event_type`: `'email.delivered'`
   - `svix_event_id`: populated (e.g. `msg_...`)
   - `payload`: full Resend event payload containing recipient, timestamp, and headers

---

## Step 5: Verify the Resend Delivery Event

Verify end-to-end receipt across all three external channels:

### 5.1. Recipient Mailbox Inspection
1. Open the inbox for `<YOUR_EMAIL_ADDRESS>`.
2. Check for the email:
   - **From:** `Make Me Topper <info@makemetopper.com>`
   - **Subject:** `Production Smoke Test — Make Me Topper`
   - **Content:** Branded Make Me Topper header, "Hello Smoke Test Reviewer", "Test Identifier: SMOKE-...", and "Visit Make Me Topper" button.
   - **Footer:** Links to support (`support@inovoxy.com`), terms, and copyright.

### 5.2. Resend Web Dashboard Inspection
1. Log in to [https://resend.com/emails](https://resend.com/emails).
2. Locate the email sent to `<YOUR_EMAIL_ADDRESS>`.
3. Confirm status badge is **Delivered**.
4. Click on the email to view delivery metadata, TLS handshake details, and transmission logs.

### 5.3. Resend Webhooks Delivery Verification
1. Navigate to **Resend Dashboard → Settings → Webhooks**.
2. Select the webhook endpoint pointing to:
   `https://ocolfottogbybitfpdqy.supabase.co/functions/v1/email-webhook`
3. Click on the most recent delivery attempt corresponding to the test message.
4. Confirm:
   - **Event Type:** `email.delivered`
   - **HTTP Status:** `200 OK`
   - **Response Body:** `{"action": "PROCESSED", "event_type": "email.delivered", "success": true}`

---

## Troubleshooting Reference

| Symptom | Probable Cause | Verification & Resolution |
| :--- | :--- | :--- |
| **Worker returns HTTP 401 Unauthorized** | Missing or incorrect `Authorization` or `X-Worker-Key` header. | Confirm `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` or `X-Worker-Key: <EMAIL_WORKER_SECRET>`. User tokens (`anon` or `authenticated`) are deliberately rejected. |
| **Worker returns `provider: "mock"`** | `MOCK_EMAIL=true` environment variable is active. | Ensure production environment variables do not include `MOCK_EMAIL=true`. Production must use `RESEND_API_KEY`. |
| **Worker returns 500 `CONFIGURATION_ERROR`** | `RESEND_API_KEY` secret is unset or empty in Supabase. | Run `supabase secrets set RESEND_API_KEY="re_..."` and redeploy or restart the function. |
| **Job stays in `pending` after worker run** | `batchSize` was too small, or job was claimed by concurrent run. | Check `SELECT locked_at, locked_by FROM public.email_queue` to see if a lock was acquired. |
| **`delivery_status` remains `accepted`** | Webhook is still in transit or `email-webhook` failed signature check. | Inspect Resend Dashboard Webhooks tab to see if the webhook delivery returned 200 or failed with 401 (signature mismatch / `RESEND_WEBHOOK_SECRET` issue). |

