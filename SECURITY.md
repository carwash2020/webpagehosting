# Security Policy

This is a private business's internal tooling and public site, not an
open-source project accepting outside contributions -- so most of the
usual template sections (supported versions, a public disclosure
process for external researchers) don't really apply here. This file
exists anyway, for two real reasons: to have one place that states the
actual current security posture plainly, and to give anyone who ever
touches this code later (including a future instance of whoever's
helping build it) a real reporting path and a starting point before
changing anything security-related.

## Reporting an issue

If you find a real security problem in this repo or the systems it
deploys to -- an exposed secret, a way to bypass RLS, a function
callable by someone who shouldn't be able to call it -- tell Connor
Dodart directly. There's no public bug bounty or external disclosure
process; this is a two-person operation (Connor and Steve), and that's
who can actually act on it.

## The actual security model, stated plainly

**Row-Level Security is on for every table**, but the actual policies
vary by what a table is for, and that's deliberate:

- `th_bookings` and `th_leads` allow anyone (including anonymous
  visitors) to `INSERT` -- that's the whole point, since these back
  public-facing forms (the booking flow, the contact form) that
  guests use without ever logging in.
- `site_content`, `site_faq`, and `site_terms` allow any
  `authenticated` account full read/write access, not scoped to a
  specific user. This looks permissive on paper, but the real threat
  model is: exactly two accounts (Connor, Steve) will ever be
  `authenticated` at all, and both are already fully trusted with
  production data. There's no public sign-up path that could ever add
  a third.
- Everything else defaults to locked down, checked against the
  `account_roles` table (see "Account roles system" in
  `DISASTER_RECOVERY.md`) rather than a hardcoded email check.

**`SECURITY DEFINER` functions are used deliberately, not by
accident**, specifically so guests can perform a few narrow actions
(check availability, submit a booking, cancel or reschedule with their
own token) without any login system existing for them at all. Every
one of these:

- Sets `search_path = public` explicitly -- confirmed directly
  (2026-08-26) that every `SECURITY DEFINER` function in the project
  now has this, after finding one (`set_th_bookings_padded_range`)
  that had been missed.
- Is checked against exactly what it should be callable by. Trigger-
  only functions (things like `notify_new_booking_email`,
  `track_booking_changes`) exist purely to run automatically on
  insert/update -- they were never meant to be called directly, and
  as of 2026-08-26 `EXECUTE` is explicitly revoked from `anon` and
  `authenticated` on all of them. Before making that change, this was
  verified directly with an isolated, throwaway test (a temporary
  table/trigger/function, not the real ones) confirming that
  Postgres's trigger mechanism doesn't check the triggering role's
  `EXECUTE` privilege at all -- only direct RPC calls through
  PostgREST do. Revoking it blocks the API path without touching how
  triggers actually fire.
- Whatever is genuinely meant to be public-facing (the 4 booking RPCs
  guests actually call) stays callable by `anon` -- confirmed
  intentional via Supabase's own Advisor, not just left unexamined.

**Content-Security-Policy, on the public site**, restricts scripts to
`'self'` plus Google Tag Manager by exact origin, restricts frames
entirely (`frame-src 'none'`, `frame-ancestors 'none'` -- this site
neither embeds anything nor can be embedded), and restricts outbound
connections to the specific origins the app actually needs (Supabase,
Google Analytics). See the `<meta http-equiv="Content-Security-Policy">`
tag in `index.html` for the exact, current policy.

**Secrets never live in this repo.** API keys, service role keys, and
webhook secrets are stored in Supabase's own Vault or as GitHub
Actions repo secrets, referenced by name only. The publishable/anon
key that does appear in client-side code (`tools/auth.js`) is meant to
be public -- that's what an anon key is for -- and carries no
privilege beyond what RLS already allows it.

## Repo-level hardening (added 2026-08-26)

Beyond the application-level security above, the repo itself has real
protections now, each verified working directly rather than assumed:

- **Branch protection on `main`** blocks force-push and deletion.
  Deliberately does *not* require PRs or status checks before a
  direct push -- this project's real, working history is direct
  pushes to `main` (often by an AI assistant), and gating that would
  fight the actual workflow, not improve it.
- **Tag protection** on `checkpoint-*` blocks deletion and updates.
  Confirmed directly: attempted a real delete of a real checkpoint
  tag via the API, correctly rejected.
- **Actions restricted** to GitHub-owned actions and Marketplace
  verified creators (was "any action from anywhere," the platform
  default), with the one third-party exception actually in use
  (`treosh/lighthouse-ci-action`) explicitly allowlisted rather than
  left to chance.
- **Every action reference is pinned to a commit SHA**, not a mutable
  version tag, with `sha_pinning_required` enforced at the repo level
  so this can't silently drift back to tag-pinning later. Dependabot
  still tracks and proposes version bumps against these pins the same
  way it did against tags.
- **CodeQL's default setup found 35 real findings on 2026-08-26** --
  incomplete escaping enabling real XSS in `onclick` handlers across
  4 tool pages, a genuine open-redirect bypass in `login.html`
  (`startsWith('/')` doesn't exclude `//evil.com`, which browsers
  resolve as protocol-relative), zero HTML escaping anywhere in
  `runway-dashboard.html`, and more. All 35 fixed and reconfirmed at
  zero directly against GitHub's own Code Scanning API after a fresh
  scan, not assumed from local testing. See the commit history around
  this date for the full, itemized breakdown of each finding and fix.

## Known, accepted gaps (not oversights)

- **Leaked-password protection is off** in Supabase Auth. This is a
  dashboard-only toggle, not something scriptable from this repo or
  the Supabase API -- flip it in the Supabase dashboard under
  Authentication settings if this ever matters more than it does for
  a 2-account system.
- **No MFA enforcement** on the two Supabase Auth accounts. Same
  reasoning as above -- worth reconsidering if this ever grows past a
  trusted two-person team.
- **`escapeHtml()` (in `tools-dialogs.js`) is only safe for text-node
  content**, not HTML-attribute-value contexts -- it escapes `&`,
  `<`, `>` but not quotes, since quotes aren't special in the context
  it was originally built for. The CodeQL sweep above fixed every
  attribute-context call site it actually flagged, but that was
  targeted, not an exhaustive codebase-wide audit of every
  `escapeHtml()` call. Worth a real, dedicated pass someday rather
  than assuming the targeted fixes closed every instance of this
  class of gap.

## Where the real detail lives

This file states the model. The actual incident history, the exact
mechanism behind each fix, and step-by-step recovery procedures live
in `DISASTER_RECOVERY.md` at the repo root -- that's the file to read
before touching anything RLS-, auth-, or sync-related, and the one to
extend when the next real issue gets found and fixed.
