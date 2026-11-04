# Guest pay link: pay from the invoice email or PDF, no account (handoff §3A)

Phase 3.2, built 2026-11-04 to the approved designs ("Invoice email",
"Invoice PDF pay section", "Pay an invoice, no account").

**Nothing here is live yet.** The SQL is not applied and no function is
deployed. Connor approves each step below first.

## What changes for a client

- Sending an invoice gives it its own pay code. The email gets a
  **Pay this invoice · $300.00** button, plus the full address as a blue link.
  The PDF card says *"Pay by card or bank, no account needed, at
  triplehenterprisesllc.biz/pay/INV-2026-1112-k7f3qm2xw9"*. That address is
  printed as visible blue, underlined text, so a paper copy still works, and
  it is also a clickable link.
- `/pay/<invoice number>-<code>` shows the invoice number, amount, due date,
  what it was for, "T. Perides", and a PDF download. Below that is Stripe's
  card form and an optional "Email my receipt to" field. After payment it
  shows "Paid. Thank you!" with a link to create a portal account. A later
  visit shows "Paid on Nov 4".
- The email has one subject, `Invoice INV-… from Triple H Enterprises ·
  $300.00 due Nov 15`. **Steve and Connor are bcc'd on every invoice email.**
  Before this, only Steve was bcc'd, and only when a PDF was attached.
- The PDF's payment note no longer says "via a secure Stripe invoice". No
  client could open one.

A downloaded invoice (Download PDF, not Send) gets no code and no link. It
looks the same as before.

## How it works

| Piece | File | What it does |
| --- | --- | --- |
| Code | `tools/invoice-generator.html` `makePayToken()` | 10 characters from `crypto.getRandomValues`, using 31 letters and digits with no look-alikes (31^10 ≈ 8×10^14). Made only when the invoice will really be emailed. Saved on the invoice (`payToken`) and sent to the portal sync. |
| Storage | `sql/payments/02_guest_pay_tokens.sql` | `client_portal_invoices.pay_token`: nullable and unique. A check allows only the code's shape. Existing RLS is unchanged. |
| Sync | `edge-functions/sync-invoice-to-portal-index.ts` | Stores the code. Refuses a malformed one. With no code it leaves the stored one alone. **Before the SQL is applied, it sends the invoice without a pay link instead of failing.** |
| Email | `edge-functions/send-invoice-notification-index.ts` | Approved layout. Adds the Pay button and link when a valid code is given, and bcc's Steve and Connor. The opt-out check is unchanged. |
| Payment | `edge-functions/guest-pay-index.ts` (new, **public**) | `view`, `pdf` and `pay`. Any wrong, malformed or missing code gets the same `404 not_found`. `view` never returns the email. `pay` is a one-time PaymentIntent: no customer, no saved card, so no card-on-file authorization is needed. It has the portal's double-charge guards. Its metadata and the `stripe_payment_intent_id` it writes are what `stripe-webhook` already uses, so the invoice is marked paid, income is logged and Steve is told, exactly as for a portal payment. |
| Page | `pay/index.html` | Public, `noindex`, grid background. Uses Stripe's Payment Element. Loads no Supabase SDK and no Workspace or portal scripts. |
| Pretty URL | `404.html` | Sends `/pay/<x>` to `/pay/?c=<x>` before anything paints. GitHub Pages has no real file at `/pay/<x>`. |

## Turn-on order (each step needs Connor's OK)

1. **Apply the SQL**: `sql/payments/02_guest_pay_tokens.sql`. It is additive
   and safe to re-run, and the undo is at the top of the file.
2. **Deploy the three functions**:

   ```bash
   supabase functions deploy guest-pay --no-verify-jwt
   ```

   ```bash
   supabase functions deploy sync-invoice-to-portal
   ```

   ```bash
   supabase functions deploy send-invoice-notification
   ```

   `guest-pay` must run with JWT verification **off**: the payer has no
   sign-in. It needs only the secrets the project already has
   (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`).
3. **Merge the branch.** This publishes `/pay/`, the 404 redirect and the
   invoice generator change.

If 2 or 3 happen before 1, nothing breaks. Invoices go out as before, just
without a pay link.

## Test before a real client sees it

- **Do not pay against a real invoice or a real card.** No real payment was
  ever run in this build.
- A safe check after deploy: send a test invoice to your own address and
  open the link. You should see the invoice, the due date and the card form.
  Do **not** submit a payment. Wrong-code links like
  `/pay/INV-1-zzzzzzzzzz` should show "This pay link doesn't open an invoice".
- Automated tests (all run in `npm run verify`):
  - `tests/edge-functions/guest-pay.test.js`
  - `tests/payments/guest-pay-tokens-db.test.js` (PGlite)
  - `tests/payments/guest-pay-page.test.js` (jsdom)
  - `tests/workspace/invoice-pdf-pay-link.test.js`
  - `tests/edge-functions/invoice-pdf-email-not-invite.test.js`

## Known limits

- An invoice sent **before** this has no code. Resending it sends the new
  email layout without a pay button, because a resend reuses the invoice's
  code and does not make one. Sending it again from the form gives it one.
- The due date on `/pay/` comes from the invoice's terms on the Workspace's
  own invoice row (`public.invoices`). If that row is missing, the page shows
  no due line.
- "Email my receipt to" starts empty. The page never knows the client's
  email, so leaving it blank sends the receipt to the address the invoice
  went to. The design showed the field pre-filled; it is left empty on
  purpose so the page never shows the client's email.
  **Decided (Connor, 2026-11-04): permanent.**
