# Make Me Topper — Canonical Subscription & Installment Business Rules

1. The subscription's `end_date` represents the last paid-through calendar day (inclusive).

2. If the student purchases or funds another installment milestone before `end_date`,
   extend continuously from the existing scheduled entitlement milestone.

3. Zero Grace Period for Overdue Installments (Decision A):
   An installment must be paid by its contractual due date ($D_k^{\text{due}}$).
   If it remains unpaid, live-class access is suspended beginning at 00:00 Asia/Kolkata
   time on the following calendar day (due_date + 1 day).
   No 3-day, 5-day, or configurable grace periods exist.
   The former seven-day full-access grace period after subscription expiry is permanently removed.
   (Automated reminder notifications at 5, 3, and 1 day prior to due date are a later-phase feature).

4. Entitlement Restoration Through Next Scheduled Milestone (Decision B):
   When a student has overdue installments and the previous paid-through date has expired,
   live-class access may be restored only after all overdue installments have been settled (overdue_balance = 0).
   After successful settlement:
   a. Allocate verified payments against oldest applicable outstanding installments using FIFO.
   b. Recalculate outstanding and overdue balances atomically.
   c. Determine the highest consecutively funded installment milestone ($k$).
   d. Recalculate the paid-through date using the immutable original calendar anchor ($D_0$):
      - For intermediate milestones ($k < N$): advance to the next scheduled entitlement milestone:
        $D_{k+1}^{\text{due}} = \text{CalculateAnchorDate}(D_0, k \times I)$.
      - When all installments are paid ($k = N$): advance to the terminal entitlement date:
        $D_N^{\text{end}} = \text{CalculateAnchorDate}(D_0, N \times I)$.
   e. Contractual installment due dates are fixed and never shift because a payment is late.
   f. If the final installment is paid after the terminal entitlement date has already passed,
      paying it clears ledger debt but does not grant an unearned fresh subscription term or content window.
   g. Restore live-class access only if the Server-Side Quad-Check (batch assignment, batch not ended,
      valid entitlement, and zero arrears) permits access.

5. Content-Only Access Window (30 Days):
   When live-class access ends upon subscription expiry or overdue installment suspension,
   the student retains access to eligible course content and past recordings for the following
   30 calendar days ($D_k^{\text{end}} + 30\text{ days}$), calculated from the actual earned
   paid-through date, not automatically from the terminal course date.
   Recordings of classes held during an unpaid suspension gap remain locked until the applicable
   arrears are cleared.

6. Content Access Expiration:
   When `content_access_end_date` passes without payment, revoke the remaining
   subscription-based content access.

7. Strict Batch Cutoff for Live Classes:
   Do not accept new payments or extensions after the batch cutoff.
   An ended batch (`batches.end_date < today`) never authorizes joining live classes,
   including for permanent course owners. Ending a batch does not revoke purchased content.

8. Platform Parity:
   Apply the same entitlement rules to Google Play Billing and Razorpay, while respecting
   each payment provider's actual transaction state.

9. Transaction Integrity:
   A successful payment must never be recorded as a successful extension unless the
   corresponding entitlement calculation has also succeeded atomically.

10. Idempotent Processing:
    Prevent duplicate payments, duplicate credits, duplicate top-ups, and duplicate
    entitlement extensions through idempotent backend processing and row-level locking.
