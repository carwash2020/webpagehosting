# Bug-fix specialist log

Started 2026-09-16, alongside the `tripleh-bugfix` skill. See `README.md` in
this directory for how these logs work.

One seed entry, carried over from before this log existed: the full local
test suite has a known, pre-existing gap in
`tests/workspace/finance-split.test.js` — its "fix-versions actually
corrects a real mismatch" test deliberately writes a wrong version stamp
into the real `tools/workspace.html`, runs the real `fix-versions` script
against the real repo to fix it, then only restores `tools/workspace.html`
in its `finally` block — not the side effect that script run has on
`service-worker.js`'s own CACHE_NAME/fingerprint. Running the full suite
locally can leave `service-worker.js` genuinely modified (to a *correct*
value) afterward, and can make a handful of other "checks the real,
current repo" tests intermittently fail if they happen to run in that
window. Not a real bug in the app — just something to know before
concluding a full-suite failure is real: check whether it's one of the
"real, current codebase" self-check tests, and try it in isolation before
chasing it further.

## 2026-09-16 — two findings from a business-health report pass (reports specialist)

Surfaced while building a Supabase-sourced business health report (job/
invoice/finance data, no code changed). Both are real, verified against
live data, and handed off rather than fixed here:

1. ~~**Invoice `paid` flag can desync from actual payment, causing a false
   overdue push.**~~ **Fixed (2026-09-16, same day).** Root cause:
   `checkOverdueInvoices` in `send-push-index.ts` checked `inv.paid`
   directly instead of deriving "still owed" from `paidAmount`/`total`
   the way `workspace.html` and `send-payment-reminder-index.ts`
   already do. `workspace.html`'s own `togglePaid()` already correctly
   keeps `paid` in sync with `paidAmount` going forward, so this
   invoice's desync was stale data from before that sync existed, not
   an active write-path bug -- the one place that needed a real code
   fix was send-push's read side. Added `getPaidAmount`/`getRemainingCents`
   to `send-push-index.ts` (same whole-cents rounding as the other two
   files) and changed the check to `if (getRemainingCents(inv) <= 0)
   continue;`. Fixed the live data for Cody Grover's invoice
   (`1788658872274`) in both `invoices` and the `workspace_sync` blob's
   `th_invoices` so it stops alerting. New test:
   `tests/edge-functions/overdue-invoice-paid-amount.test.js`. Full
   suite run clean after (see below).

2. ~~**`workspace_sync` realtime channel repeatedly drops.**~~
   **Re-investigated, not actually an open bug — corrected from the
   original finding above.** Two things got conflated in the original
   report: the `CHANNEL_ERROR`/`TIMED_OUT` entries (Sep 5-8) predate a
   real, evidence-based reliability fix already in `sync.js` dated
   2026-09-07 (checked Supabase's own server-side realtime logs at the
   time, found zero matching server errors, concluded these are real
   client-side network transience — most plausibly this business's own
   field conditions, phones/tablets on job sites — and shipped
   exponential backoff, `TIMED_OUT` treated the same as
   `CHANNEL_ERROR`, and an indefinite 30s background retry that
   self-heals with no reload needed). No error entries exist after
   that fix landed. Separately, the `sync-stale` notification firing
   on 2026-09-16 is a *different*, unrelated, and entirely correct
   signal: `workspace_sync.updated_at` really is 5+ days old (last
   push 2026-09-11) because nobody's opened the tool since, not
   because syncing is broken — checked directly against the live row.
   No code change needed here; the original finding read a working
   fix and a correct staleness alert as one open problem.

## 2026-09-16 (later) — payment-reminder/quote-followup crons are silently 401ing, need the right key

Full root cause is written up in `docs/specialist-logs/automation.md`
(the automation specialist found this while verifying a deploy). Short
version for whoever picks this up: `send-payment-reminder` and
`send-quote-followup` both do a strict `token !== SERVICE_ROLE_KEY`
check before doing anything else -- correct, intentional security
(stops the public anon key from triggering client-facing sends). The
problem is the cron jobs authenticate with the vault secret
`send_push_service_role_key`, and that secret's value doesn't equal
these functions' actual `SUPABASE_SERVICE_ROLE_KEY` at runtime -- every
real cron-triggered call gets a 401 and does nothing, and has been
since deploy (confirmed via a manual re-run of the cron's own
`net.http_post`, and zero `invoice-reminder-*`/`quote-followup-*` rows
ever in `notification_log`).

This isn't fixable purely in code -- it needs the real current
`service_role` key pulled from the Supabase dashboard (Project
Settings -> API) and either used to update the `send_push_service_role_key`
vault secret, or a new dedicated secret created for these two crons.
Once that value is in hand, the actual code-side fix is a one-line SQL
update to `vault.decrypted_secrets`/`vault.secrets` -- flagging here in
case whoever has the key wants a bugfix pass to also add something
that makes a future version of this mistake loud instead of silent
(e.g. an alert on repeated 401s from these functions, since a
misconfigured secret currently fails the exact same silent way a
missing one would).

## 2026-09-16 (later still) — pre-existing cache-version drift noticed, not touched

While verifying the invoice fix above, ran `node scripts/check-consistency.js`
and found 19 pre-existing failures unrelated to that change: `styles-tools.css`'s
real content hash no longer matches the `?v=` query string every internal
tool page requests it with, and `service-worker.js`'s precached-file
fingerprint is stale too. `git status` confirms neither file is touched
by this session's edits, so this predates today's work. The fix is
mechanical (`npm run fix-versions`), but touches ~19 unrelated files
outside this session's actual task -- leaving it for a dedicated pass
rather than bundling it into an unrelated invoice-bug fix. Whoever picks
this up next: run `npm run fix-versions`, then `check-consistency.js`
again to confirm clean, then the full suite once more before committing.

## 2026-09-16 (final) — deployed the overdue-invoice fix, and a self-inflicted near-miss

Deployed the `checkOverdueInvoices` fix above to the live `Send-Push`
function via `mcp__Supabase__deploy_edge_function`. **Caught and fixed
a mistake in the same step**: the first deploy call went out with
placeholder file content instead of the real source (a tool-use error
on my part, not a code issue) -- briefly replacing the live,
already-working `Send-Push` function (version 48) with a stub. Verified
the deployed content immediately after (`get_edge_function` on a
different function earlier had already established that "deployed" and
"local repo file" can drift, which is exactly the habit that caught
this), saw the mistake, and redeployed the real file (`edge-functions/send-push-index.ts`,
now version 49) within the same minute. Confirmed recovery by firing a
real `reminder-check` invocation through the same `net.http_post` path
the daily cron uses: `200 {"ok":true,"ran":true,"syncedDataFound":true}`,
and confirmed no wrongful `invoice-overdue` entry for Cody Grover's
invoice in `notification_log` afterward. No user-visible impact --
this cron only fires once daily at 01:00 UTC, well outside the ~1
minute the stub was live -- but noting it plainly: always re-fetch and
sanity-check a deploy's actual live content immediately after any
`deploy_edge_function` call on a function real crons depend on, not
just after finding a bug through one.

3. **Full test suite (`npm test`) shows intermittent, non-deterministic
   failures under `--test-concurrency=1` that don't reproduce when the
   same test files are run in isolation.** Found 2026-09-16 while
   verifying an unrelated visual fix (our-work.html gallery,
   styles.css). Two clean, non-overlapping full-suite runs on the same
   branch each produced the same 4 failing test names
   (`tests/content-quality/text-audit.test.js`'s `checkButtonHandlers`
   test, `tests/scripts/onclick-xss-consistency-rule.test.js`'s
   consistency test, and two others with the identical symptom) --
   all failing with `check-consistency.js` (run as a real subprocess
   against the live repo) reporting a `service-worker.js` precache-
   fingerprint mismatch. The suspicious part: the "recorded" and "real"
   hash values in the error differed between the two runs, and running
   any of the 4 failing test files alone (not as part of the full
   suite) passes clean every time. A control run of the exact same
   full suite against an untouched clone of `main` passed 2193/2193
   with zero failures. So this isn't a stable regression from any
   particular content change -- it looks like an ordering/timing
   sensitivity between test files that each spawn `check-consistency.js`
   as a subprocess and/or temporarily mutate a precached file
   (`service-worker.js`'s own self-check tests, `tools/dev-tools.html`'s
   fixture-injection tests) without full isolation between files.
   **Update: this matches the pre-existing gap already noted at the top
   of this log** (`tests/workspace/finance-split.test.js`'s
   fix-versions test leaves `service-worker.js` genuinely modified after
   a local full-suite run) -- same root cause, independently rediscovered
   from the other direction. Nothing further to chase here; both notes
   now point at the same known gap.

## 2026-09-16 (later the same day) — fixed finding #1 above: `paid`/`paidAmount` could diverge across a sync merge

Root-caused and fixed. The actual mechanism wasn't a missing write path —
`tools/workspace.html`'s `togglePaid()` already recomputes `paid` from
`paidAmount`/`total` (whole-cents comparison) every time it's called, and
no other UI call site writes `paidAmount` at all. The divergence comes
from `mergeRecordArrays()` in `tools/sync.js`, which resolves each
field's own 3-way-merge conflict independently: if one device's edit
changed only `paidAmount` (recording a payment) and a different, stale
device's edit changed only `paid` (e.g. an old "mark unpaid" click never
pulled since), the field-level merge can legitimately keep the first
device's `paidAmount` and the second device's `paid` — an internally
inconsistent result even though each field's own merge picked a
defensible value in isolation. `paid` is a *derived* field (must always
equal `paidAmount >= total`), and the generic per-field merge has no way
to know that two fields are coupled like this.

Fix: added `deriveInvoicePaid(inv)` to `sync.js` (same whole-cents
comparison as `invoicePaymentStatus()`), and call it from two places
instead of trusting a raw `paid` boolean: `mirrorInvoiceToRelational()`
(the actual write path the overdue-push check reads from) and a new
post-merge normalization pass on `th_invoices` inside `applySyncData()`
(so the local copy itself, and whatever it mirrors/pushes next, can't
stay inconsistent either). Regression test added:
`tests/sync/applysyncdata-malformed-json.test.js` reproduces the exact
conflict shape (base/local/remote with a real 3-way merge) and asserts
the merged record comes out both correct and consistent.

**Lesson for this codebase's merge system specifically:** `mergeRecordArrays()`
is a generic per-field 3-way merge with no concept of field coupling. Any
future field pair where one is logically derived from another (a status
flag derived from an amount, a computed total, etc.) needs the same
treatment — a post-merge normalization step — rather than assuming the
generic merge will keep them consistent on its own. Worth grepping for
other flag+amount pairs in the synced data model if this class of bug
needs auditing further (quotes' `status` vs. line items, jobs' warranty
status vs. completion date, etc. weren't checked this pass).

Finding #2 (realtime channel drops) is still open, unchanged from
above — no code touched for it this session.

## 2026-09-16 (hub dispatch: bug sweep) — misleading `Send-Push` deploy comment, and a ticking-time-bomb test fixture

**1. `edge-functions/send-push-index.ts`'s own header comment said
`Deploy with: supabase functions deploy send-push` (lowercase) — wrong.**
Every real caller in this codebase (11+ files, grep
`/functions/v1/Send-Push`) and `README.md`'s own edge-function listing
agree the live, deployed slug is capitalized `Send-Push`. Supabase
treats function slugs as case-sensitive, and
`edge-functions/notify-work-order-message-email-index.ts`'s own comment
already documents that this exact mismatch created a real orphaned
duplicate function once before ("confirmed directly the hard way after
an initial deploy accidentally created exactly that orphaned
duplicate"). This file's own deploy instruction was the one place in
the repo that still told a future session (or a human copy-pasting it)
to recreate that mistake. Fixed the comment to say `Send-Push`, with an
explanation of why the casing matters and a pointer to the prior
incident. Not dead code — the real "orphaned function" is whatever got
created live on Supabase by that earlier accidental deploy, which isn't
visible from this repo's source and isn't something a code change here
can remove; the fix here is closing off the one thing in the repo that
could cause it to happen again. Added a regression test
(`tests/edge-functions/push-remaining-triggers.test.js`) asserting no
`edge-functions/*.ts` file contains a lowercase `deploy send-push`
instruction.

**2. `tests/booking/manage-booking.test.js` had 3 tests hardcoding an
absolute future date/time (`2026-09-16T21:00:00+00:00` and a couple
nearby end times) to represent "a booking that hasn't happened yet."**
That's only true until real wall-clock time actually passes 21:00 UTC
on 2026-09-16 — after which the app correctly starts treating it as a
past booking (hides Cancel/Reschedule, exactly like the dedicated
"already passed" test elsewhere in the same file already covers) and
the tests failed for a reason that had nothing to do with the code.
Found during a scheduled regression sweep once real time actually
crossed that mark. Fixed by computing the fixture's start/end times
relative to `Date.now()` (a new `futureBookingTimes()` helper) instead
of a hardcoded calendar date, including the one test that also asserted
the rendered date-label text (now computed the same way the real page
does, via `Intl.DateTimeFormat`, rather than a hardcoded "Wednesday,
September 16" string). **Lesson: grep for other hardcoded
near-future ISO timestamps in test fixtures before assuming a suite is
safe long-term** — `grep -rl "202[0-9]-[0-9]{2}-[0-9]{2}T2[0-3]:" tests/`
found only this one file this time, but the same class of bug can
recur anywhere a test fixture encodes "the future" as a specific
calendar date instead of an offset from execution time.

## 2026-09-17 — full verification sweep, clean; closed out the "npm install gap" question from content.md

Ran a full bug-hunt pass from scratch: fetched/fast-forwarded to the real
`origin/main` (`422cbb3`, PR #255 already merged, matching the "both repos
clean, zero open PRs" state), then ran the complete verification set.

**Everything passed clean:**
- `node --test --test-concurrency=1` (full suite): **2220/2220, 0
  failures**, ~232s.
- `node scripts/check-consistency.js`: clean (16 tool pages + 9 portal
  pages).
- `node scripts/check-undefined-vars.js`: clean (55 pages), once
  `node_modules` existed.
- `python3 scripts/check-links.py`: clean (internal refs across 66 HTML
  files; external-link 403s are this sandbox's outbound proxy blocking
  fetches to the site's own domain and known bot-hostile platforms --
  the script itself already treats those as non-failures, not a bug).

**One real false alarm worth recording, since it looked like a regression
at first:** this container starts with no `node_modules` at all. Running
the full suite *before* `npm install` produced 46 apparent failures and a
smaller total test count (2105 vs. the real 2220) -- test files that
`require('jsdom')` or invoke `eslint` never even registered their tests
when those modules were missing, undercounting rather than reporting a
clean failure per file. Running `npm install` first (adds `eslint`/
`jsdom`, both already correctly pinned in `package-lock.json`) made the
exact same suite pass 2220/2220. **Not a real bug and not a gap in this
repo's actual CI**: `.github/workflows/test.yml` already runs a plain
`npm install` (not `npm ci`) before `npm test`/`check-undefined-vars`, so
real CI has never hit this. The content specialist's 2026-09-16 note
("worth a check on why `npm ci` doesn't already restore them") was aimed
at exactly this gap in *this kind of sandbox session*, not the repo --
closing it out here: nothing to fix in the repo itself, just a "run
`npm install` first" step for any fresh non-CI environment (this one
included) before trusting a first test run's failure count.

No open defects found this pass. Everything in `docs/ACTION-ITEMS.md` is
either already resolved or requires a human with dashboard/account access
(Supabase service-role key rotation, deleting the orphaned `send-push`
function, ad accounts, etc.) -- none of it is a code-side bug for this
lane to pick up.

## 2026-09-17 — Watcher research: link-check coverage hole (not fixed here)

`scripts/check-links.py` `PUBLIC_PAGES` never includes
`handyman-st-george-ut.html`, which is in `sitemap.xml` and is a
real public landing page. External-link pass also skips the 5
service pages, `booking.html`, `about.html`, `our-work.html`, blog,
and legal pages. Internal refs across every HTML file are still
checked. Handed to automation/bugfix rather than patched in the
docs-only Watcher PR — a one-line list add is the actual fix.

## 2026-09-17 — UX-study glitches: empty footer Hours, dead `#` links, portal Send Request overlap

Four concrete public-site + portal defects from the UX study, one PR.

1. **Footer Hours was missing**, not blank HTML. The `#contact` strip,
   JSON-LD, and `business-hours.js` already agreed (Mon–Fri 14–22,
   Sat 7–22, Sun 14–20). The footer had no Hours column at all. Copied
   that same schedule into the homepage footer Contact column. Changed
   the CMS overlay from `querySelector` to `querySelectorAll` so a
   per-day `site_content` value updates both copies. Did not invent
   hours; did not touch GBP.

2. **FAQ / Terms / Cookie Preferences were `href="#"`.** FAQ already
   had a `/#faq` auto-open path used by landing pages — homepage nav
   and footer now use `#faq`. Terms already had `/terms.html`; the
   homepage footer now points there (modal still opens via the existing
   preventDefault handler). Cookie Preferences now falls back to
   `/privacy.html#cookies` (new `id="cookies"` on that heading) and
   still calls `reopenCookiePreferences` when JS is present.

3. **Send Request sat under the fixed portal tab bar.**
   `body.portal-page` padding was 72px, the bar's own height, so a
   full-width button at the bottom of the form was flush with it.
   Worse: `@media (display-mode: standalone)` in `portal-polish.css`
   replaced that padding with *only* `env(safe-area-inset-bottom)`,
   so the installed app dropped the clearance entirely. Bumped
   padding to 96px in both places and added a `.portal-nav-clearance`
   spacer under the button.

4. Cheap date-row scrollbar polish on `booking.html` and the Request
   Work picker (`scrollbar-width: thin` + a 6px webkit thumb).

Did not change AggregateRating / reviewCount (separate PR #281). Did
not redesign tools.

## 2026-09-17 — smoke test hung CI after togglePaid switched to showConfirm

PR #283 swapped workspace `togglePaid()` from `window.prompt` to
`showConfirm()`. `tests/workspace/smoke-job-invoice-paid.test.js` stubbed
`showConfirm` in jsdom `beforeParse`, then `injectSharedScripts()` loads
the real `tools-dialogs.js`, which replaces that stub with a Promise that
waits for a click nobody ever makes. `await togglePaid()` never finished;
GitHub Actions sat on "Run automated tests" for 20+ minutes. Isolated
with `node --test --test-timeout=15000`: smoke timed out, the new
`workspace-quick-actions.test.js` file passed in <1s (it never injects
`tools-dialogs.js`). Fix: re-stub `showConfirm` after shared scripts,
same as the existing `showToast` re-stub. No product-code change.

## 2026-09-18 — `styles.css` truncated to its header comment on a Cursor branch, and a full-codebase check after merging its fix

Root cause of every single `test.yml` failure across ~8 consecutive
Cursor pushes to `cursor/visual-and-audit-fixes-19fd`: `styles.css` on
that branch had been overwritten down to just its ~1KB header comment
(160KB of real rules gone), almost certainly a bad full-file MCP write —
the same class of mistake that separately took `main`'s `index.html`
down to an 11-byte placeholder earlier the same day. With the stylesheet
gone, ~100 CSS-dependent design tests failed for a reason that had
nothing to do with what any individual commit actually changed, which is
why re-pushing the "same" fix 5 times in a row never turned CI green —
the branch was passing its own actual diff and failing on unrelated
content that had quietly disappeared underneath it.

Fixed by restoring `styles.css` from `main` and re-applying the branch's
one real addition on top (hiding `.chat-bubble-btn`/`.chat-panel` on
pages with `.sticky-call-sms`, confirmed correctly scoped inside the
existing `max-width:760px` block and winning the cascade via
`!important`, not selector order). Diffing the restored file against the
pre-truncation blob confirmed that one hunk was the *only* difference —
nothing else was lost or silently altered in the restore.

Separately (real, pre-existing, unrelated to the truncation): 11 pages
(`about.html`, `our-work.html`, 9 blog posts) were missing the footer's
Terms & Conditions / Privacy Policy link pair entirely — not a wording
bug, the `<li>`s were just absent. `booking.html`'s Confirm Booking had
no legal line. 15 `tools/` pages never declared `color-scheme: dark`
(real white-flash-on-load FOUC) and the shared theme snippet never set
`documentElement.style.colorScheme`; `styles-tools.css` had no
`.login-box` rule at all even though `login.html`/`reset-password.html`
already referenced that class, and no `.checkbox-row label` override
against the sitewide bare `label{text-transform:uppercase}` rule.

Merged as PR #300. Full-codebase check afterward, since the branch had
diverged and merge-conflicted against several PRs that landed on `main`
in the meantime (booking-cta gap fix, workspace jump-nav fix, lead-form
fix): fresh clone, `npm install`, full suite (**2457/2457**),
`check-consistency`, `check-undefined-vars`, and `check-links.py` all
clean; manually re-verified (jsdom-parsed, not just regex-matched) that
all 11 footer-link insertions and the booking legal line actually landed
in the right DOM location; confirmed the one `tools/login.html`/
`reset-password.html` inline `body { background: #0a0a0a; ... }` addition
uses the plain (non-th-tool-page) login layout with no `background-image`
on `body` to lose — the shorthand-reset footgun documented elsewhere in
this file's history doesn't apply here, since it's a different body
selector than the one carrying the ambient gradient.

Also noted (not a bug): mid-review, `git status` on the working checkout
briefly showed `tools/dev-tools.html` as modified with an empty diff and
a matching content hash before and after — a live test in the suite
writes to that real file as part of what it tests and had a save in
flight at the exact moment `git status` ran from a separate process.
Re-running `git status` a moment later showed clean. Matches this file's
existing "isolate before assuming a flake" guidance, just at the
git-status layer instead of test-runner layer.

## 2026-09-19 — POS/Dev Tools/Clients missing from the sidebar and mobile "More" sheet

Reported directly by the user ("Dev tools and POS is missing as well for
both me and Steve") -- first misdiagnosed as a permissions/data problem,
since `hasDevToolsAccess()`/`canManageInvoices()` are exactly the kind of
thing that silently hides a tile. Queried the live `account_roles` table
directly for both `connor@triplehenterprisesllc.biz` and
`steve@triplehenterprisesllc.biz`: both already had
`can_access_dev_tools: true` and `can_manage_invoices: true`, and a
simulated authenticated RLS read confirmed the data comes back fine --
ruled out backend/permissions entirely. User corrected the report: "No we
removed the bottom bar and put it under more the buttons themselves are
missing" -- the real bug was structural, in the nav itself, not data.

Two real bugs in `tools/tools-nav-pwa.js`, found by reading it in full:

1. **`SIDEBAR_DESTS` never had POS, Dev Tools, or Clients in it at all.**
   This one array drives both the desktop sidebar (`injectSidebar()`) and
   the mobile "More" overflow sheet (`MORE_DESTS = SIDEBAR_DESTS.filter(...)`)
   -- the redesign that moved secondary tools off the 5-item bottom bar
   and into "More" (2026-08-20) simply never carried these 3 real pages
   over into the list that "More" reads from, even though `pos.html`,
   `dev-tools.html`, and `clients.html` all already existed and were
   linked from `workspace.html`'s own tile grid. Fixed by adding all
   three (`icon-dollar`, `icon-terminal`, `icon-inbox` -- all already
   present in this file's own SVG sprite, confirmed by grep before using
   them, so no new icon art was needed).
2. **`hideRestrictedNavLinks()` was silently dead code.** It called
   `canManageBusinessFinances()`, superseded by 5 granular permission
   functions during the 2026-09-02 refactor (see `auth.js`) and now
   nonexistent -- confirmed by grep returning zero matches for its
   definition. The function's own guard (`typeof ... !== 'function' ||
   ...`) took the early-return branch on every single page load, so it
   never hid a single restricted link for anyone, regardless of role.
   Rewritten as a per-href map (`NAV_PERMISSION_CHECKS`), mirroring
   `workspace.html`'s own `TILE_PERMISSION_CHECKS` so the dashboard tiles
   and this nav can't drift apart again: `can_view_finance` for
   finance.html, `can_view_runway` for runway-dashboard.html,
   `can_manage_invoices` for invoice-generator.html/pos.html/clients.html
   (same permission workspace.html already gates all three tiles behind),
   `can_manage_contracts` for contract-generator.html, `can_manage_reviews`
   for review-request.html, and `hasDevToolsAccess()` for the new Dev
   Tools entry specifically (a genuinely separate permission from the
   other 6, same as it is on the dashboard).

Verified: `npm run check-undefined-vars` clean, `npm run fix-versions`
(this is a shared file every tool page references by content-hashed
query string, so the edit correctly triggered the 20-page cache-bust
staleness + service-worker `CACHE_NAME` bump `check-consistency` already
watches for), full suite **2457/2457** passing afterward.

## 2026-09-19 -- bugfix/security: portal + Workspace audit findings, "fix everything you can"

A read-only audit of `portal/*.html` and `tools/*.html` returned 7
findings; fixed the ones that were real and tractable without a
separate schema-design conversation.

1. **Work orders had no cancel path.** `client_portal_work_orders`
   deliberately had no client UPDATE/DELETE policy at all (see that
   table's own create-migration comment #3, which specifically
   anticipated this: "an explicit status transition through an edge
   function, not a raw delete"). Added a `cancelled` status value
   (`sql/portal/add_work_order_cancel.sql`, applied live) and
   `cancel-work-order` (new edge function, deployed live) -- service-role
   write, same pattern as `respond-to-quote`, only reachable from
   `submitted` (past that point Steve has already started working it,
   and workspace.html's own queue filters on an explicit "open" status
   list that never included `cancelled` -- cancelling later would just
   make the request silently vanish from his queue with no record of
   why). `portal/work-orders.html` gets a "Cancel request" button,
   shown only while still `submitted`.
2. **Declining a quote was a one-way dead end.** No text field for why,
   and the "Ask a question" button disappeared entirely once responded
   to. Added `decline_reason` (`sql/portal/add_quote_decline_reason.sql`,
   applied live), threaded through `respond-to-quote` (deployed live),
   captured via a new `portalPromptTextarea()` dialog (`portal-app.js`,
   mirrors `portalConfirm()`'s own overlay/focus-trap pattern) instead
   of a plain yes/no confirm. The reason shows back to the client on
   their own card and to Steve on `tools/invoice-generator.html`'s
   existing quote log (the same place client questions already surface
   -- not a new screen). "Ask a question" moved outside the
   `isPending` branch entirely, so it's available on a declined (or
   approved) quote too, not just a pending one.
3. **Disabling 2FA had no confirmation**, unlike removing a saved card
   two sections above it on the same page. Added the same
   `portalConfirm()` gate `removeSavedCard()` already uses.
4. **Several native, unstyled `prompt()`/`confirm()` dialogs** still
   popped the browser's own system look next to an otherwise
   consistently dark-themed app suite -- `job-tracker.html`'s recurring
   job templates (3 stacked prompts) and a photo-caption prompt,
   `finance.html`'s custom price-reference label, `workspace.html`'s
   license entries, and 6 destructive actions on `runway-dashboard.html`
   that never used the `showConfirm()` it already loads for other
   things. Added `showPromptForm()` (`tools/tools-dialogs.js`) -- a
   generic multi-field styled dialog reusing the same overlay/focus-trap
   infrastructure as `showConfirm()`/`showAlert()` -- and converted
   every one of those call sites to it (or to `showConfirm()` for the
   runway-dashboard ones). Real bug fixed along the way, not just a
   style pass: the recurring-template flow's `prompt(...) || ''` could
   never tell a genuine Cancel (native `prompt()` returns `null`) apart
   from OK on a deliberately blank field (returns `''`), so cancelling
   the 2nd of 3 stacked prompts used to silently continue with a blank
   client name instead of aborting the whole thing -- same root cause
   independently found a second time in the photo-caption prompt's own
   dead `caption === null` check (already unreachable, since `|| ''`
   upstream of it had already erased the only value that check could
   ever have caught).

Not done, and deliberately not attempted here: the audit's two
lower-priority notes (whether a slot picked in quotes.html's post-
approval scheduling could conflict with one picked in work-orders.html
before Steve reviews either -- flagged for whoever has time to trace
both paths against the same availability data, not confirmed as an
active bug; and the card-add-vs-remove asymmetry in
`portal/settings.html`, which is a reasonable Stripe-driven trade-off,
not a bug).

Verified: full suite **2556/2556** passing (2 pre-existing
`quotes.test.js` tests needed real updates, not just new columns
added to an allowlist -- the "Ask a question only for pending" behavior
they asserted was the actual dead-end this fix removes). New tests for
every fix (`work-order-cancel.test.js`, `settings-mfa-disable-confirm.test.js`,
`prompt-form-dialog.test.js` including a real jsdom round-trip of
`showPromptForm()`'s cancel/validate/submit paths, `runway-native-confirm-fix.test.js`).
`check-consistency`/`check-undefined-vars`/`check-links.py` all clean.
Both new edge functions and both schema migrations applied/deployed
live via Supabase MCP, not just committed as SQL files waiting on a
manual step.
