# Portal Create account, contract path and contract copies (Phase 3.3)

Built 2026-11-04 to the approved "Portal create account" and "Contract
signing flow" designs, and to Connor's three choices that day:

1. **Server-side sign-up.** Supabase's public sign-up stays OFF.
2. **Add the confirmed-email lock** to the database.
3. **Send the "Please sign" email** for a brand-new client's first contract.

**Nothing here is live.** No SQL is applied and no function is deployed.

## What changes

| For | Change |
| --- | --- |
| Client, sign-in page | **Create account** tab next to Sign in. The flow is email + password, then a 6-digit code by email, then signed in. The footer says how to get in (it replaces "No sign-up here"). |
| Client, sign-in page | **Remember me starts OFF** (handoff §5). The Workspace sign-in is unchanged. |
| Client, from an email | After signing in or creating an account, they land back where the link pointed, e.g. the exact contract (`?return=`, checked against a fixed list of portal pages). |
| Client, offline | The banner shows only when a real request also fails. It now says "You're offline. New information won't load until you're back online." Nothing is cached, so "Showing saved data" was never true. |
| New client's first contract | Gets the **"Please sign"** email, not the "You've been invoiced" invite. The email tells them to tap Review & Sign, then Create account. |
| Every "Please sign" email | **Bcc Steve and Connor.** The button opens that exact contract. |
| Signed | The client gets "Signed on Nov 3, 2026" plus a copy: the contract text and their signature attached. Steve and Connor get the same copy. |
| Declined | Steve and Connor are emailed. |

## Security notes

- `portal-signup` gives the same answer for a new address, an unconfirmed
  account, a confirmed client and a staff address. A stranger learns
  nothing from it.
  - A confirmed client is emailed "you already have an account, sign in"
    instead of a code, and their password is never changed.
  - A staff address is sent nothing, and no portal account is made for it.
- Codes are stored only as an HMAC. They expire after 15 minutes and allow
  5 wrong tries. Each address gets at most 5 codes an hour, and each network
  address (stored as a hash) at most 10 sign-ups an hour.
- The database lock is a **restrictive** "Confirmed email only" policy on
  all 14 client-facing tables. It can only take access away.
  - Checked live on 2026-11-04: 0 unconfirmed staff. The 3 unconfirmed users
    are invited clients who have never signed in, and their invite link
    confirms them.
- `respond-to-contract` refuses an unconfirmed account too.
- `portal_account_status()` was live but missing from the repo. It is now
  recorded verbatim in the SQL file.

## Turn-on order (each step needs Connor's OK)

1. Apply `sql/portal/portal_self_signup_and_confirmed_email_lock.sql`.
   It is additive and safe to re-run; the undo is in the file header.
2. Deploy the functions:

   ```bash
   supabase functions deploy portal-signup --no-verify-jwt
   ```

   ```bash
   supabase functions deploy respond-to-contract
   ```

   ```bash
   supabase functions deploy send-contract-notification
   ```

   ```bash
   supabase functions deploy sync-contract-to-portal
   ```

   `portal-signup` must have JWT verification off, because the visitor has
   no session yet. It uses secrets the project already has.
3. Merge the branch (login page, return path, offline banner, contracts
   toast).

**Do not merge step 3 before step 2.** The Create account tab would call a
function that doesn't exist yet and show "Something went wrong".

## Safe test after deploy

Create an account with an address you control, then enter the code.
- You should land on Home and see only that address's items.
- A wrong code should be refused, and so should an expired one (wait 15
  minutes).
- An address that already has an account should get the "you already have
  an account" email, not a code.

Do not sign a real client's contract.

## Tests

- `tests/edge-functions/portal-signup.test.js`
- `tests/security/portal-confirmed-email-lock-db.test.js` (PGlite)
- `tests/portal/portal-create-account.test.js` (jsdom, the real login page)
- `tests/portal/offline-banner-honest.test.js`
- `tests/edge-functions/contract-emails.test.js`
- Updated sign-in tests: `signin-rebuild`, `one-app-sign-in`,
  `trusted-device-portal`, `face-id-over-2fa`, `portal-mfa`, `contracts`,
  `pull-to-refresh-and-offline`

## Known limits

- No PDF is attached to the signed copy. The portal has no contract PDF
  builder, so the copy is the contract text plus the signature image.
- The sign-in page says "A contract is waiting for your signature" without
  naming it. The page can't read the contract before sign-in, and putting
  the title in the link would let anyone put their own words on our page.
- New accounts made by Create account don't get a referral account code
  until Steve sends them something (an invite still creates one).
