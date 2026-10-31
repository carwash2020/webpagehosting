# Stripe hardening (2026-10-31)

This follows the read-only audit of 2026-10-30. All Stripe keys were verified **live** on 2026-10-31. The `stripe-webhook` endpoint already receives `payment_intent.succeeded`, `payment_intent.payment_failed` and `charge.refunded`. Until this change only the first was acted on, so a refunded invoice stayed "paid" with no trace of the refund.

**Nothing here has been applied, deployed or turned on.** The PR contains a migration file, five edge-function sources, one portal UI change and one tools-page change. No Stripe objects were created and no messages were sent. See [Turning it on](#turning-it-on).

## What changed

| Outcome | Where |
|---|---|
| Event ledger, unique `event_id` | `stripe_events` table. `stripe_record_event()` inserts the event first. An event already processed returns `duplicate` and does nothing. A failed one keeps its `error`, the webhook answers 500, and Stripe retries it. |
| Refunds, full and partial | `refunds` table. The webhook reads the charge's refund list (a GET) and records each refund. Invoices get `refunded_amount` and `refund_status` (`none` / `partial` / `full`). A refund that later fails (`refund.updated`) gives the amount back. |
| Failed payments | `payments.status = 'failed'` with the decline code, plus `failure_count`. Nothing about the invoice changes. A late "failed" never overrides "succeeded". |
| Disputes | `payment_disputes` table, plus a staff push on `charge.dispute.created` with the amount, reason and response deadline. The net-paid view counts the funds as withdrawn while the dispute is open or lost. |
| Idempotency keys | Every Stripe POST in `create-payment-intent`, `create-bulk-payment-intent`, `create-pos-charge` and `manage-saved-card` goes through `stripePost()` with an `Idempotency-Key`. Network errors, 5xx and 409 are retried with the same key. See the key table below. |
| Payments table | `payments` (one row per PaymentIntent) and `payment_allocations` (which invoices it paid, and how much each). |
| Net-paid view | `invoice_payment_status`: one row per `public.invoices` row with `stripe_paid_cents`, `refunded_cents`, `disputed_cents`, `net_paid_cents`, `paid_via` (`stripe` / `manual` / `none`) and `payment_status` (`unpaid` / `partially_paid` / `paid` / `partially_refunded` / `refunded` / `disputed`). `payment_allocation_net` has the same figures per allocation. |
| UI | Portal → Invoices: a fully refunded invoice shows a grey **Refunded** pill. A partial refund keeps **Paid** and adds "$X refunded". |

### One transaction instead of three writes

Before, the webhook wrote to three places. `client_portal_invoices` was written first; a failure there returned 500. `public.invoices` and the `workspace_sync` blob were best effort. If the relational write failed, the webhook still returned 200 and Stripe never retried. Now the ledger row, the payment, the refunds and disputes, and **both** invoice tables are written by one Postgres function in one transaction. Either all of them change or none do, and on failure Stripe retries.

The `workspace_sync` blob (`th_invoices`, `th_income_log`) is still best effort after the commit, as before. It's a whole-blob read-modify-write, and retrying it on every redelivery would raise the collision risk the old comment warns about.

### Decision: a refund does not un-pay the invoice

`paid` and `paid_amount` are left alone on a refund. `send-payment-reminder` emails a client whenever `paid_amount` is below the total. Lowering it would start emailing a refunded client to pay again, and a partial refund is usually a goodwill discount, not money owed. Instead:
- `refund_status` and `refunded_amount` record the refund, and the portal shows it.
- `invoice_payment_status.net_paid_cents` is the true figure for Finance.
- If Steve wants a refunded invoice paid again, he marks it unpaid on purpose (`set-invoice-paid`). `create-payment-intent` already allows a fresh payment after a full refund.

**Owner call:** if refunded invoices should instead read as unpaid and owed, that's a one-line change in `stripe_refresh_invoice_refunds()`. It should come with a matching change to `send-payment-reminder`.

### Idempotency keys

| Call | Key | Why |
|---|---|---|
| Create Customer (all 4 functions) | `cust-v1-<sha256(lower(email))>` | Two concurrent calls for a new email get one Customer back, not two (audit risk 5). The email is hashed, never sent in the key. |
| Single-invoice PaymentIntent | `pi-inv-v1-<invoice>-<cents>-<customer>-<previous PI or none>` | A double tap or two tabs get the same PI. Including the previous PI means a new one is still made after a cancel or full refund. |
| Pay All Outstanding | `pi-bulk-v1-<sha256(sorted ids, cents, customer, previous PIs)>` | The ids are also sorted in the metadata, so the same batch in another order is the same request. |
| **POS charge saved card** (charges immediately) | `pos-saved-v1-<request_id>` | `tools/invoice-generator.html` makes one `request_id` per charge attempt. It keeps it while the outcome is unknown (dropped signal, 5xx) and the fields are unchanged, and drops it after a definite answer. A second tap after a lost response gets the first charge back (`replayed: true`), not a second charge. An old cached page without a request_id gets a one-off key, no worse than before. |
| POS new card | `pos-new-v1-<request_id>` | Same. |
| SetupIntent (add card) | `seti-v1-<customer>-<request_id or one-off>` | Never charges; covers retries. |
| Detach card | `pm-detach-v1-<pm id>` | Detach is already idempotent; the key is for consistency. |

Also fixed: `charge_saved` used to log income without claiming `stripe_pos_charges_logged`. The webhook's own claim for that same PaymentIntent then always succeeded, so it could log the sale a second time. Both paths now claim first, and only the winner logs the income and sends the receipt.

### Other additive schema

- `stripe_customers.client_id` and `card_authorizations.client_id` reference `clients(id)`. They're backfilled by email and filled by a trigger on insert. `stripe_customers.client_id` is unique (partial index). The trigger never sets a second mapping for a client, because the edge functions ignore a failed mapping insert.
- `card_authorizations.stripe_payment_method_id` is a new column, not populated yet.
- New index `client_portal_invoices_pi_idx` on `stripe_payment_intent_id`, which the webhook looks rows up by.
- Backfill: every portal invoice paid by card before this change gets a `payments` row (`source = 'backfill'`, `livemode` null) and allocations. Today that's the 2 distinct PaymentIntents. Re-running it adds nothing.

### Security

- RLS is enabled on all five new tables. Internal accounts in the same tenant can read them through `current_user_has_any_role()` (which includes the internal-MFA gate). Clients and anon read nothing; the portal uses the denormalised columns on its own `client_portal_invoices` rows.
- INSERT/UPDATE/DELETE/TRUNCATE are revoked from `anon` and `authenticated`, so only the service role writes.
- `stripe_record_event` can be executed only by `service_role`. Every helper function is revoked from PUBLIC, anon and authenticated.
- Both views are `security_invoker`, so they never show more than the caller's table policies allow.
- The ledger stores full event payloads, which contain client emails. It's internal-only for that reason.

## Events to add in the Stripe dashboard (Connor)

Stripe dashboard → **Developers → Webhooks** → the `stripe-webhook` endpoint → **Add events**. It already has the first three.

| Event | Status |
|---|---|
| `payment_intent.succeeded` | already subscribed |
| `payment_intent.payment_failed` | already subscribed; **now handled** |
| `charge.refunded` | already subscribed; **now handled** |
| `payment_intent.canceled` | **add** |
| `payment_intent.processing` | **add** (bank-debit style methods; harmless for cards) |
| `charge.refund.updated` | **add** (a refund that fails or is canceled after the fact) |
| `charge.dispute.created` | **add** (staff push) |
| `charge.dispute.updated` | **add** |
| `charge.dispute.closed` | **add** (won / lost) |
| `charge.dispute.funds_withdrawn` | **add** |
| `charge.dispute.funds_reinstated` | **add** |

`refund.created`, `refund.updated` and `refund.failed` are handled too, if Stripe offers them on this account's API version; `charge.refund.updated` covers the same changes. Anything else that arrives is recorded as `ignored` and answered 200.

## Turning it on

Order matters: **migration first (ideally just before merging), then functions.**
- The new webhook returns 500 until `stripe_record_event` exists. That's safe, because Stripe keeps retrying for about 3 days, but there's no reason to wait.
- The daily private backup (`backup-sensitive-data.yml`) checks the live table list against `scripts/backup-tables.json`. This PR adds the five new tables and two views there, so the backup fails, loudly and naming them, on any day the merge is in but the migration isn't.
- Applying the migration before the merge is safe. The current code ignores the new tables and columns.

1. Apply `sql/payments/01_stripe_event_ledger_payments_refunds.sql`, using the Supabase SQL editor or `apply_migration`. It's additive and re-runnable.
2. Run `get_advisors` (security) and check that it reports nothing new for `stripe_events`, `payments`, `payment_allocations`, `refunds`, `payment_disputes` or the `stripe_*` functions.
3. Deploy `stripe-webhook` with **`--no-verify-jwt`** (unchanged). Then deploy `create-payment-intent`, `create-bulk-payment-intent`, `create-pos-charge` and `manage-saved-card` (JWT on, unchanged). The Monday drift check (`edge-function-drift.yml`) lists any that were missed.
4. Add the events above in the Stripe dashboard.
5. Check it worked. In Stripe → Webhooks → the endpoint → **Resend** a recent `payment_intent.succeeded`. Expect HTTP 200 with `"received":true` and `"invoices_marked_paid":0` the first time, then `"duplicate":true` the second time. A row should appear in `stripe_events` with `processed_at` set. Resending a past event is safe: the invoice is already paid, so nothing changes.

**Rollback:** redeploy the previous `stripe-webhook`. The new tables and columns are additive and can stay; nothing else reads them.

## Replaying sample events

The sample events are in `tests/payments/fixtures/` (API 2024-06-20 shapes, fake ids). They cover:
- success (single invoice and Pay All Outstanding);
- a short payment;
- a POS sale, delivered twice;
- a decline, and a late decline after success;
- partial, full and failed refunds, including one on a bulk payment;
- a dispute created and then won;
- an unhandled type.

Two test files replay them in CI:
- `tests/payments/stripe-ledger-replay-db.test.js` (30 tests) runs the real migration in PGlite and replays each event through `stripe_record_event`. It also checks RLS and grants, running the migration twice, and the backfill.
- `tests/payments/stripe-webhook-replay.test.js` (12 tests) runs the **real** `stripe-webhook-index.ts` with a fake `Deno`, a fake Stripe SDK that checks a real Stripe-style HMAC signature, and `fetch` routed to that PGlite database. It covers a bad signature, a duplicate delivery, the RPC not deployed yet, a Stripe API outage while listing refunds, and a database failure followed by a successful retry. Push and receipt counts are checked as well.

`tests/payments/stripe-idempotency-keys.test.js` (11 tests) runs the real `create-pos-charge`, `create-payment-intent`, `create-bulk-payment-intent` and `manage-saved-card` handlers against a fake Stripe that enforces idempotency keys the way the real API does.

```bash
cd tests && node --test payments/
```

## Not done here (left on purpose)

- **Staff tools UI.** Workspace and Invoices don't show refunds yet. `public.invoices` carries `refunded_amount` and `refund_status`, and `invoice_payment_status` has the net, ready for a later UI change. The scope here was the portal status only.
- **Reconcile cron.** `reconcile-stripe-payments` is unchanged. A follow-up could re-run `stripe_events` rows with `processed_at is null` older than 3 days, and compare `payments` with Stripe.
- **Mode guard.** There's no `STRIPE_MODE` check, since all keys were verified live. `stripe_events.livemode` and `payments.livemode` now record the mode of every event, so a test-mode event reaching the live endpoint is visible.
- **`npm:stripe@latest`** in `stripe-webhook` is still unpinned (the API version is pinned to 2024-06-20). Pinning the SDK version is worth doing at the next deploy.
- **Receipt email on the PaymentIntent** (`receipt_email`). Turning it on would make Stripe send its own receipts, which is a new outbound email, so it's left off.
