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

## 2026-09-22 — fixed the link-check coverage hole flagged above

Rebuilt `PUBLIC_PAGES` directly from `sitemap.xml` instead of a
hand-maintained subset — added a comment saying to keep the two in
sync going forward. Was missing `locations/handyman-st-george-ut.html`,
4 of 7 service pages, `about.html`/`careers.html`/`our-work.html`/
`booking.html`, the whole `blog/`, and `terms.html`/`privacy.html` --
all previously getting zero external-link coverage despite being real,
crawled pages.

Confirmed internal-link checks still pass (88 HTML files, all resolve).
External checks can't be fully verified from this sandbox: newly-covered
blog posts reference `images.unsplash.com` (Unsplash hotlinks), and this
environment's egress proxy blocks that domain outright (`WebFetch`
against one of the URLs returned an explicit `EGRESS_BLOCKED` error, not
a real 404/timeout) -- same class of sandbox-only limitation this log
already documents for the site's own domain and the bot-hostile
platforms list. Real GitHub Actions CI has unrestricted egress and will
actually validate these; not adding `unsplash.com` to `BOT_HOSTILE_DOMAINS`
since that would suppress a genuinely-dead hotlink there too, not just
this sandbox's artifact.

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

## 2026-09-21: Another manage-booking.test.js time-bomb (6 tests)

Found incidentally while running the full suite for an unrelated
content fix -- 6 of 13 tests in `tests/booking/manage-booking.test.js`
were failing on a clean `main`, not from anything in the change being
shipped. Root cause: the exact time-bomb pattern this same file
already had one documented fix for (see its own 2026-09-16 comment,
"a real bug found... several tests below hardcoded an absolute
future date/time") -- but that earlier fix only touched the tests it
was actively working on; the reschedule-flow tests added later still
hardcoded `'2026-09-20T21:00:00+00:00'` as a stand-in for "a booking
that hasn't happened yet." That date is now in the past (today is
2026-09-21), so the app correctly treated it as an already-passed
booking and hid the Cancel/Reschedule buttons the tests were looking
for -- a real app behavior working exactly as intended, breaking a
test that assumed the clock would never catch up to its fixture data.

Fixed the same way the existing 2026-09-16 fix did: replaced every
hardcoded absolute timestamp in the reschedule tests with the file's
own `futureBookingTimes(45)` helper (computed relative to
`Date.now()`), so these tests stay valid no matter when they actually
run. Left the "already cancelled" test's `2026-09-16` date alone --
that one tests cancelled-status display, which doesn't depend on the
date being in the future, so it wasn't actually broken and didn't
need touching.

Verified: `tests/booking/manage-booking.test.js` 13/13 passing (was
7/13). Full suite **2575/2575**.

## 2026-09-21: booking.html audit -- race condition, a11y, and an inaccurate promise

Direct request: "audit and improve booking.html further," no specific
bug reported -- a fresh, open-ended re-look at the file (two of the
three earlier candidate improvements, address autocomplete and SMS
confirmation, are blocked on external API accounts nobody has
provided; slot re-validation was already confirmed solid via the
DB's own buffer/exclusion constraint). Used an Explore subagent to
read the whole file cold and rank real findings by impact; verified
and fixed the ones worth fixing:

- **Real race condition** (highest impact): `selectDate()` is async
  with nothing previously stopping two overlapping calls -- tapping
  date A then quickly date B fired two concurrent fetches, and
  whichever response landed LAST won regardless of which date the
  visitor actually has selected now. Fixed with a request-id guard
  (`selectDateRequestId`), discarding any response from a call that's
  since been superseded. Verified with a real jsdom test using
  controllable, independently-resolvable fetch promises, resolving
  the stale (first) request last -- the exact ordering that silently
  won before this fix -- and confirming the second, current date
  stays selected.
- **No focus management between wizard steps**: `goToStep()` never
  moved keyboard/screen-reader focus, so a screen-reader user
  advancing steps (or bounced back after a real booking conflict) had
  no cue the page changed. Every `.step-panel` now carries
  `tabindex="-1"` and `goToStep()` focuses the new one
  (`{ preventScroll: true }`, since the existing `window.scrollTo`
  call already handles visual scrolling).
- **Selection state invisible to assistive tech**: `.service-option`/
  `.date-btn`/`.slot-btn` toggled only a CSS class; none exposed
  `aria-pressed`. Also found the service-option's own `.is-selected`
  CSS rule was dead code -- nothing had ever actually toggled that
  class, only date/slot buttons did. Fixed both the missing
  `aria-pressed` and the dead `is-selected` toggle together.
- **Submission errors and slot updates not announced**: `#statusMsg`
  and `#slotsGrid` had no `aria-live`, unlike the existing
  `#phoneError`/`#emailError` which already do -- added
  `aria-live="polite"` to both, matching that existing convention.
- **Inaccurate unconditional promise**: sidebar copy and the
  post-booking "what happens next" list both unconditionally promised
  "a confirmation email with a link to reschedule or cancel," but
  email is optional and `manage-booking.html`'s only lookup path is a
  token that arrives via that email -- a phone-only booking had no
  real way to reschedule/cancel online despite the on-page promise.
  Made the post-booking step's text conditional on whether an email
  was actually given (verified with a real jsdom submit through the
  whole flow, deliberately leaving email blank); softened the
  persistent sidebar note to not overstate it before the form is even
  filled in.
- **Name/email/address sent untrimmed**: the submit payload sent
  `formData.get('name')` raw even though a trimmed `nameVal` already
  existed for validation just above it (email had the same gap,
  newly given the same `emailVal` treatment). Now sends the already-
  trimmed values for all three, not the raw FormData ones.

Fixing the `tabindex="-1"` addition broke 3 existing test files that
matched the step-panel `<section>` tags with brittle exact-attribute
regexes (`id="stepConfirmed">` with nothing else expected between
the id and `>`) -- updated all of them (`next-steps-timeline.test.js`,
`success-checkmark.test.js`, `referral-program.test.js`) to tolerate
extra attributes, plus one similarly brittle fixed-length `.slice()`
window in `analytics-events.test.js` that no longer reached the
`booking_completed` gtag call after the new conditional-copy code was
inserted above it -- widened the window rather than shrinking the
new code to fit an arbitrary slice length.

New test file: `tests/booking/booking-a11y-and-race-fix.test.js` (6
tests, including the real concurrent-fetch race simulation and a full
jsdom submit-through-confirmation run for the email-conditional
copy).

Verified: full suite **2583/2583** passing. `check-undefined-vars`/
`check-consistency`/`check-links.py` all clean.

## 2026-09-21 -- Fixed a silent 401 on send-payment-reminder/send-quote-followup: every automated payment-reminder and quote-followup email had never actually sent

Found from a user-shared screenshot of Dev Tools' Cron Health panel:
a recurring daily "HTTP call failed -- status 401" alert, every day
since 2026-09-16, plus intermittent "Cron job #N run failed" alerts.

Root cause: every net.http_post cron job authenticates with
`vault.decrypted_secrets['send_push_service_role_key']`, saved into
Vault on 2026-08-14. Sometime after that, this Supabase project's
auto-provisioned `SUPABASE_SERVICE_ROLE_KEY` moved to the newer
`sb_secret_...` key format -- the vault copy was still the old legacy
JWT. Confirmed live via a temporary diagnostic Edge Function that
compared the vault-stored value against `Deno.env.get(...)` **without
ever printing either secret** (only a boolean match result, plus
non-sensitive metadata like length/prefix/role for the mismatch
case) -- the actual key values never appeared in any tool output or
this conversation.

Only `send-payment-reminder`/`send-quote-followup` (added 2026-09-16)
ever noticed, since they're the only two cron-driven functions doing
a strict `token !== SERVICE_ROLE_KEY` check (see each file's own
header comment) rather than relying solely on Supabase's platform
`verify_jwt` (signature-only, doesn't check role). The stale vault
key was still a validly *signed* JWT -- the project's JWT secret
itself never rotated -- so it kept passing the platform check for
every other net.http_post caller (`Send-Push`,
`reconcile-stripe-payments`, `send-appointment-reminder`), and nothing
ever surfaced the mismatch until these two stricter functions hit it.

Fixed live via the diagnostic function invoking a scoped
`security definer` RPC with the correct live key read directly from
its own `Deno.env` -- the value was never typed, logged, or returned
in any tool response. Verified by directly invoking both previously-
broken functions afterward: both now return real 200s (`checked`/
`sent` counts) instead of 401. Real user-facing impact: this means
**no automated overdue-invoice reminder or quote-followup email had
ever actually reached a client** since the feature shipped 5 days
earlier -- worth knowing since nothing in the UI itself would have
shown this (Cron Health's alerts were the only signal, and they went
unacknowledged until this session).

Kept a permanent maintenance function,
`sql/infra/resync_cron_service_role_key.sql`
(`resync_cron_service_role_key(new_value text)`), for if this ever
happens again after a future key-format change -- it never reads or
returns the secret itself, only accepts a value the caller already
has in hand. The one-off diagnostic Edge Function used to confirm/fix
this was left deployed but neutralized (returns a static 410, no
logic) rather than removed, since no MCP tool exists to delete an
Edge Function outright.

## 2026-09-22 -- Invoice Type field icon overlap: the report's own theory of the bug was wrong

Reported symptom: a screenshot of invoice-generator.html's "Invoice
Type" field showing "Standard" visually truncated to "andard" by a
search icon and a warning-triangle icon. The report (reasonably)
guessed a CSS icon-in-input padding bug. It wasn't -- reproducing it in
a real headless Chromium at 390x844 (serving over local HTTP, never
`file://`) showed the two icons were `.th-cmdk-btn` (search/command-
palette launcher) and `.th-flag-btn` ("flag this page"), both
`position: fixed` and floating at a constant offset above the mobile
bottom nav on every tool page -- nothing to do with the select element
itself.

**Root cause, confirmed with exact measurements, not guessed:**
`getBoundingClientRect()` on the real page showed the buttons' band
(`top:708, bottom:752`) overlapping the Invoice Type field's own box
(`top:669, bottom:717`) by 9px, on a 390x844 viewport. The real
available whitespace between the field and the bottom nav's actual
rendered top (`759.2`, not the `76px` a comment nearby assumed) is
under 44px -- smaller than the buttons' own diameter -- so **no choice
of fixed offset for these buttons can avoid the overlap on this
viewport height**, and the height itself is common (measured the exact
overlap range as any 761-853px-tall viewport; iPhone 12/13/14 all fall
inside it). Shrinking the buttons below 44px was ruled out since that's
this app's own documented minimum touch target.

**Fix:** behavioral, not positional -- both buttons fade out only while
a scrollable page is still at its very top (`tools-nav-pwa.js`,
`updateFabTopFade()`, toggling `body.th-fab-hide-at-top`/`th-scrolled`),
and fade back in once scrolled past 24px, comfortably enough to carry
whatever was covered out of the fixed band. A page too short to ever
scroll that far keeps both buttons visible throughout, so search/flag
stay reachable there too. Desktop (`min-width:1024px`) is unaffected --
`.th-cmdk-btn` is already `display:none` there and `.th-flag-btn` sits
in a free corner with no bottom nav to collide with.

**Lesson:** don't debug a fixed/floating-element overlap by reading the
CSS of the element that's *reported* as covered -- neither
`.th-cmdk-btn` nor `.th-flag-btn` is defined anywhere near
invoice-generator.html's own styles, and reading that file alone would
never have found the real cause. Reproduce visually first, then use
`getBoundingClientRect()` on the actual rendered elements to see which
two things are really colliding, before assuming the report's own
theory of the bug.

## 2026-09-22 -- Dev Tools' "Client errors" log kept resurrecting after Clear, second root cause

Reported directly by the user: "we havent had any since 9/7/2026 but
everytime i clear them they come back." A fix for this exact symptom
already shipped 2026-08-21 (`tests/sync/client-error-log.test.js`) --
that one made Clear push immediately instead of relying on a debounced
`scheduleSync()`, closing a same-device race. It did nothing for the
actual mechanism still causing this report: `th_client_errors` is the
only real record type in this whole sync system with no delete-tracking
at all. Every other array key (`th_clients`, `th_tracker_jobs`,
`th_invoices`, 12+ others) has a paired `*_tombstones` array so a stale
device's old local copy can never resurrect a real deletion --
`th_client_errors` and `th_graveyard` are the two explicit exceptions
in `applySyncData`'s own code (`k !== 'th_sync_conflicts' && k !==
'th_parts_reference_units' && k !== 'th_client_errors' && k !==
'th_graveyard'`). A plain union merge (`mergeRecordArrays`) can't tell
"a genuinely new error" apart from "an old local copy nobody ever
cleared on this device" -- so any device that still had pre-9/7 entries
sitting in its own localStorage (a rarely-opened tab, a device nobody's
opened Dev Tools on since) would keep re-injecting them into the shared
log on every sync, forever, no matter how many times the log was
cleared elsewhere. This matches the report exactly: no *new* errors
since 9/7, but the log never actually empties.

Per-record tombstones don't fit here the way they do for a real record
-- Clear wipes the whole log at once, and a log entry has no identity
worth preserving across a clear the way a client or invoice does. Used
a single cutoff instead: `th_client_errors_cleared_at`, a new synced
scalar key listed just before `th_client_errors` in `SYNC_DATA_KEYS`
(same "tombstone key before its array" ordering convention as every
other pair), set to `now()` by `clearClientErrorLog()` alongside the
existing local clear + immediate `pushSync()`. `mergeClientErrorLog()`
now takes that cutoff as a third argument and drops any entry whose own
`time` is at or before it -- a genuinely new error always has
`time > clearedAt`, so it's never filtered. Gave the scalar its own
merge branch in `applySyncData` (max-of-both, not a plain
overwrite-from-remote like every other scalar setting) so a more recent
local clear that hasn't pushed yet can't be clobbered by an older
remote value mid-sync -- the same reasoning the tombstone branches
above it already use, just for a timestamp instead of an id set.

New/extended tests in `tests/sync/client-error-log.test.js`: the exact
stale-device scenario (old local entries + empty remote + a clearedAt
cutoff -> stays empty), a genuinely new post-clear error surviving the
cutoff, `clearClientErrorLog` actually setting a fresh real timestamp,
`SYNC_DATA_KEYS` ordering, the max-of-both merge behavior on
`applySyncData` directly, and a full end-to-end pull simulating a stale
device receiving a cleared server state. Verified: full suite
(2688 tests, only the known check-links.py sandbox-proxy issue not
passing locally -- confirmed a real sandbox limitation, not this
change), `check-consistency`/`check-undefined-vars` clean,
`npm run fix-versions` run for the `sync.js` content-hash bump across
all 14 tool pages plus the service worker precache fingerprint.

## 2026-09-22 -- Mark paid did half the job on each page (Workspace rework part 4)

Found while building the list-first Invoices page. Two paths mark an
invoice paid by hand, and each did a different half:

- **Dashboard `togglePaid()`** set `paidAmount` and the flag and
  mirrored the invoice to the relational table. It never called
  `set-invoice-paid`, so the client portal kept the invoice payable.
  A cash payment marked here could be paid a second time by card.
- **Invoices `toggleInvoicePaid()`** called `set-invoice-paid` but
  flipped only `paid`. Everything else reads `paidAmount` first: the
  Dashboard, `deriveInvoicePaid()` in the mirror, and the overdue push.
  Take an invoice the Dashboard marked paid and this page then marked
  unpaid: it stayed paid everywhere else. Take one marked paid here
  after a partial payment: it stayed owed everywhere else. It also
  never mirrored, and the Recent list reads the relational cache once
  it loads, so a refresh could put the old status back.

Fix:
- Both now call one helper, `pushInvoicePaidToPortal()` in `sync.js`.
  It's the old inline call moved as-is: same endpoint and body, still
  only when there's a client email, still fire-and-forget after the
  local save.
- `toggleInvoicePaid()` now writes `paidAmount` with the flag (full
  payment or nothing, the Dashboard's semantics), mirrors, and earns
  the pending referral.

Tests: `tests/tools/invoices-list-first.test.js` (behaviour, and parity
of `invoiceState` with `invoicePaymentStatus` / `deriveInvoicePaid`).
`tests/portal/portal-admin.test.js` was updated to pin the shared helper
and both callers.

## 2026-09-22 -- Job Detail's expense and invoice rows (Workspace rework part 5)

- **Expense rows always read "Expense."** `renderJobDetail()` titled
  them `e.description || e.category || 'Expense'`. Finance's `addEntry()`
  has only ever written `{ desc, vendor, type, miles }`, so the first
  two were always undefined. It now shows `desc`, else the vendor, else
  "Mileage" / "Expense". The meta line adds the vendor and miles.
- **Invoice rows trusted the old `paid` flag.** An invoice part paid, or
  marked unpaid again on the Dashboard (paidAmount 0 with a stale
  `paid: true`), showed the wrong word. `invoiceStatusWord()` reads
  paidAmount first (`thInvoiceBalance` / `thInvoicePaidAmount`) and
  says Paid / Part paid / Overdue / Unpaid.

Tests: `tests/tools/job-money-pipeline.test.js`.

## 2026-09-22 -- Invoice/quote line rows: unescaped values, whole-number quantities (Workspace rework part 6)

- **Unescaped values.** `addLineItem()` / `addQuoteLineItem()` built
  each row with `value="${desc}"` and `value="${part}"` unescaped. A
  saved job type (price reference) or quote line with a `"` in it cut
  the value short and could inject attributes. Part 6 feeds receipt
  descriptions typed in Finance through the same function, so this
  became reachable from ordinary data. The values now go through
  `lineItemAttr()` (escapeAttr, with a fallback for the page-level
  tests that run without tools-dialogs.js).
- **Whole-number quantities.** The Qty inputs had `step="1"`, so a
  Labor line of 2.5 h or 14.3 mi was an invalid value (red outline, and
  the spinner rounded it). They now use `step="any"`.

Tests: `tests/tools/invoice-from-job.test.js` (a quote mark survives a
round trip through a row; the `step` attribute).

## 2026-09-22 -- ?jobRef= stripped the whole query string; N after closing search (Workspace rework part 7)

- **`?jobRef=` wiped the rest of the URL.** invoice-generator.html's
  `applyJobRefFromUrl()` ended with
  `history.replaceState(null, '', pathname + hash)`, which drops *every*
  query parameter, not just the one it had used. `?client=` and
  quick add's `?item=` / `?price=` on the same link were gone before
  their readers ran. Found when "invoice sarah $150 dishwasher repair"
  arrived with the job but no line. It now deletes `jobRef` from a
  URLSearchParams copy and keeps the rest.
- **N did nothing right after closing search.** `closePalette()` hid the
  overlay but left focus in its (now invisible) input, so the next N
  keypress was treated as typing and ignored. It now blurs anything
  focused inside the overlay.

Tests: `tests/tools/quick-add.test.js`.


## 2026-09-23 -- quick add crashed on late-loading pages; stale "can't create"; long title showed its end (Workspace rework part 8)

- **Opening a `?quick=` link on Finance or the job list crashed quick
  add** ("Cannot convert undefined or null to object" in
  `thParseQuickEntry`).
  - Those pages load tools-nav-pwa.js after the DOM is ready, so the
    shell's `inject()` runs straight away, during the file's own
    execution.
  - The new URL check ran inside `inject()`, before the QUICK ADD
    section further down had assigned its `var` tables (declared, so
    no ReferenceError, but still undefined).
  - It now runs on the next tick. The jsdom tests only ever dispatched
    DOMContentLoaded by hand, which hid this. A new `late` mode loads
    the shell into an already-loaded page, and fails without the fix.
- **A share that arrived before the role said "can't create" for good.**
  The preview was built once, while `canManageInvoices()` was still
  false. `refreshCreateSheet()` (already run on `th-role-loaded`) now
  re-previews a non-empty quick add.
- **A long title filled in on the Jobs form showed its end.** Chromium
  leaves the caret at the end of a programmatically set value, and
  `#add-job` then focuses the field. `applyQuickAddFields()` now puts
  the caret at the start.

Tests: `tests/tools/quick-add-anywhere.test.js`.


## 2026-09-23 -- Job detail's photos went back to "Loading..." on every re-render (Workspace rework part 9)

- `renderJobDetail()` rebuilds the whole page body, including the
  Photos grid as a "Loading..." placeholder.
- Only the first load (`loadPhotosReadOnly`) fills the grid. So any
  re-render left it saying Loading... for good: a live-sync change from
  another device, and (the reason it came up) the clock's Start / Stop
  re-rendering the page.
- The grid is now marked `data-loaded` once filled, and
  `renderJobDetail()` carries a loaded grid's contents across the
  rebuild.
- `loadPhotosReadOnly()` looks the grid up again after its awaits,
  since a re-render may have replaced the element meanwhile.

Tests: `tests/tools/job-clock.test.js`.

## 2026-09-23 -- note from the visual lane: three shared public scripts have no cache-bust stamp

- `js/cookie-consent.js` (33 pages), `js/mobile-nav-collapsible.js` (33) and `js/hiring-banner.js` (16) are loaded with no `?v=` at all. Every other shared public script carries a content hash.
- `check-consistency.js` only polices references that already have a `?v=`, so it can't catch drift on these. An edit to any of them would be served stale from Fastly and browser caches.
- The visual lane will stamp `hiring-banner.js` if its round-3 banner work touches it. The other two are unowned.
- Update, same day: `hiring-banner.js` is stamped and in `GLOBAL_SHARED_FILES` now (visual round 3). `cookie-consent.js` and `mobile-nav-collapsible.js` are still unstamped and unowned.

## 2026-09-23 -- note from the features lane: deleted inventory items can come back after a sync

- `th_inventory` has tombstones (`thAddInventoryTombstone`, listed in
  `SYNC_DATA_KEYS` and `MERGE_KEY_FIELD`), but `applySyncData` in
  `tools/sync.js` has no filter branch for `th_inventory`. Every other
  tombstoned array has one.
- So a stale device that still has a deleted part in its local copy
  pushes it back, and the union merge keeps it: the resurrection bug the
  tombstones exist to stop.
- The fix is the same six-line `else if (k === 'th_inventory')` branch
  the other keys use, reading `th_inventory_tombstones`.
- Found while adding the shift clock's own branch (`th_shift_log`); left
  alone since it's outside that change.

## 2026-09-23 -- Deleted inventory parts came back after a sync, and couldn't be restored from the Graveyard

Fixes the features-lane note above ("deleted inventory items can come
back after a sync").

**Root cause 1:** `th_inventory` had tombstones from day one, but nothing
read them.
- `thAddInventoryTombstone` existed, and both keys were in
  `SYNC_DATA_KEYS` and `MERGE_KEY_FIELD`.
- `applySyncData` had no `th_inventory` filter branch; every other
  tombstoned array has one.
- So a stale device still holding a deleted part pushed it back, and the
  union merge kept it.
- `inventory-and-job-duration.test.js` only checked that a delete
  *records* a tombstone, never that a pull *honors* it, which is why this
  shipped.

**Root cause 2, the same delete path:** `deleteInventoryItem()` sends the
part to the Graveyard as `'inventory'`. `GRAVEYARD_TYPE_CONFIG` in
dev-tools.html had no such entry, so the row read "inventory: Deleted
item" and Restore said "Unknown record type".

**Fix:**
- The same filter branch the other keys use, in sync.js.
- An `inventory` entry in the Graveyard config and titles.

**The guard that would have caught both:**
`tests/sync/tombstone-coverage.test.js`. It reads the lists themselves:
- every `*_tombstones` key in `SYNC_DATA_KEYS`/`WIKI_SYNC_KEYS` must be
  read inside `applySyncData`;
- every `thAddToGraveyard('<type>'` in tools/ must have a config and a
  title.

Both checks failed on main before the fix and pass after. The audit that
led to them found inventory was the only gap for each.

**Found while auditing, NOT fixed here** (different root causes):
- **Graveyard Restore is undone by the next sync, for every record type.**
  Restore removes the tombstone locally, but the server's copy still
  holds it. `pushSync()` pulls first (`applySyncData`), the tombstone
  arrays union-merge, the tombstone comes back, and the filter deletes
  the just-restored record again. Reproduced directly: restore a job,
  then apply a pull whose remote still carries the tombstone, and the job
  is gone with the tombstone back.
  - `graveyard.test.js`'s "survives a subsequent stale-device sync pull"
    only simulates a remote with *no* tombstones, so it can't see this.
  - Fixing it needs a real design choice. One option: records get
    `restoredAt` and a tombstone only applies when `deletedAt` is later.
  - Left for its own change, since it touches the core merge.
- **Notes and "Flag this page" items have no tombstones at all.**
  `deleteNote()` (job-tracker.html) and `deleteFlaggedItem()` /
  `thDeleteFlaggedItem()` just filter the array, so a stale device can
  bring either back. The fix is the usual tombstone key, sync
  registration and filter branch; the new coverage test would then
  guard it.

Tests:
- `tests/sync/tombstone-coverage.test.js` (2, new);
- `tests/sync/tombstones-extended.test.js` (+2: a stale push doesn't
  resurrect a deleted part; a tombstone from another device removes it
  here);
- `tests/sync/graveyard.test.js` (+1: a deleted part is labelled by name
  and restores).

## 2026-09-23 -- Graveyard Restore was undone by the next sync (every record type)

Logged as found-not-fixed in the inventory entry above; fixed here.

**Root cause.** Restore did two things locally that union merges can't
carry:
- It deleted the record's tombstone. The tombstone list merges as a
  union, so the server's copy put it back on the next pull, and
  `applySyncData`'s filter deleted the just-restored record again.
  `pushSync()` pulls before it pushes, so this happened on the very next
  save.
- It dropped the Graveyard entry. `mergeGraveyard` is also a union, so
  restored and permanently-deleted entries reappeared in the Graveyard.

`graveyard.test.js`'s "survives a subsequent sync pull" only simulated a
remote with *no* tombstones, which never happens after a real delete has
synced.

**Second gotcha, found while fixing it.** Marking the tombstone instead of
deleting it wasn't enough by itself. The per-field three-way merge falls
back to "remote wins" when there's no base entry, and a device has no base
entry for a tombstone it created until it pulls its own push back:
`pushSync()` doesn't update the base after a successful push; only a pull
does. So the unmarked server copy still won.

**Fix:**
- **`thLiftTombstone(key, id, wiki)`** (data-layer.js): Restore now marks
  every tombstone for that id `restoredAt` instead of removing it, for
  every record type including the Wiki's.
- **`applySyncData`** (sync.js) has two new local helpers:
  - `tombstoneCounts`: a tombstone counts only while its `deletedAt` is
    later than its `restoredAt`, so deleting again after a restore still
    sticks. It's used by all 16 filter reads.
  - `mergeTombstones`, for every `*_tombstones` key: per id, the latest
    `deletedAt` and the latest `restoredAt` either side has seen. Both
    only move forward, so no base is needed.
  - Both are local to `applySyncData` on purpose: several test harnesses
    extract that one function on its own.
- **Graveyard:** restored or permanently deleted entries get
  `removedAt`. `mergeGraveyard` keeps the mark if either side has it;
  `thLoadGraveyard()` hides marked entries; writes go through
  `thLoadGraveyardRaw()` so the marks survive.

**Still true, not changed here:** `pushSync()` never updates the sync base
after a push. Any record edited twice between pulls, whose server copy
already has the first edit, is treated as a same-field conflict with
remote winning (it's logged in `th_sync_conflicts`). Live sync's echo pull
usually hides this. Tombstones and the Graveyard no longer depend on the
base, but every other record type still does. It's worth its own look.

Tests:
- `tests/sync/graveyard-restore-sync.test.js` (7, new; all fail on main):
  two devices and a server copy, run the way `pushSync` runs;
- `graveyard.test.js`: its three restore tests now expect the tombstone
  kept and marked, not deleted.


## 2026-09-23 -- Graveyard follow-up to #393: the Wiki push, and a restore with no local tombstone

#393 fixed the main bug (a restore undone by the next sync). An independent fix of the same bug, written in parallel, found three gaps #393 left open. Each has a test that fails on `main` without this change:

- **`pushWikiSync()` never merged before posting.** It replaced the server's Wiki row with whatever this device held. So a device that hadn't pulled a Graveyard restore could wipe it, and the same went for anyone's new Wiki entry. It now fetches and merges the server row first (`applySyncData(row.data, WIKI_SYNC_KEYS)`), exactly as `pushSync()` does.
- **`thLiftTombstone` only marked tombstones this device already had.** If the tombstone was pruned locally or the delete never synced here, nothing got marked, and the server's copy deleted the restored record again. It now adds one already lifted (`deletedAt = restoredAt = now`), which doesn't count here and wins the by-time merge with an older server deletion. For a Wiki issue it also carries `unitId`/`issueId` via a new `extra` argument.
- **`thBackfillClients` still treated a lifted client tombstone as a deletion.** It now applies the same "still counts" rule as `applySyncData`.

Tests: `tests/sync/graveyard-restore-every-type.test.js` (22):
- the bug's repro for every type in `GRAVEYARD_TYPE_CONFIG` plus the Wiki issue path (all 19 pass on `main`, confirming #393 covers every type);
- stale-device and re-delete cases;
- the 3 gaps above (fail on `main`).

## 2026-09-23 -- Cron Health false positives: net.http_post has more callers than pg_cron

Reported directly, with a screenshot of a run of "HTTP call failed -- status 401" alerts in Dev Tools' Cron Health panel. Worth logging for whoever touches `check_cron_health()` next.

Confirmed live against the Supabase project: every pg_cron job run in the alerted window succeeded (`cron.job_run_details`), and the alert timestamps didn't line up with any job's schedule (:00/:30 for the hourly/half-hourly jobs). `net._http_response` is populated by every `net.http_post` call in the project, cron or not -- and it's not just cron jobs that call it. This project's own DB triggers (`notify_new_lead`, `notify_booking_status_change`, every `notify_*` function in `sql/infra/`) call `net.http_post` too, same as the pg_cron jobs do, and Supabase's own `pg_net` install hook grants EXECUTE on `net.http_post`/`net.http_get` to postgres, anon, authenticated AND service_role -- so anything else that ever calls it in the future could trip the same false positive. `check_cron_health()` (`add_cron_watchdog.sql`) never distinguished a cron-originated call from any other -- it scanned all of `net._http_response` for a non-2xx row and reported every one as "cron."

Fixed in `sql/infra/fix_cron_health_false_positives.sql`: a `cron_tracked_http_requests` table + `cron_tracked_http_post()` wrapper records which pg_cron job made a given call before returning the same request id `net.http_post` would have; each of the 6 cron jobs that call an Edge Function now goes through the wrapper (swapped via `cron.alter_job`, keeping the same jobid/schedule/name); `check_cron_health()`'s HTTP-response check now inner-joins against that table instead of scanning `net._http_response` unfiltered, so only a response to a call a cron job actually made can ever alert, and the alert now names which job.

**Caught by the security advisor immediately, not by me first:** `cron_tracked_http_post` is `SECURITY DEFINER` and does `net.http_post` to a caller-controlled url/headers/body -- exactly the shape of an SSRF primitive if anyone but pg_cron's own execution role could call it. `revoke all ... from public` right after creating it looked sufficient but wasn't: Supabase's default privileges grant EXECUTE on every new public-schema function to `anon`/`authenticated` separately from the PUBLIC grant, and `get_advisors` flagged it as callable by both roles via `/rest/v1/rpc/cron_tracked_http_post` within the same session, before this ever shipped. Fixed with an explicit `revoke execute ... from anon, authenticated`. **Worth remembering for any future `SECURITY DEFINER` function in this project:** revoking from PUBLIC is not enough on its own -- always run `get_advisors` (security) right after creating one and check for `anon_security_definer_function_executable`/`authenticated_security_definer_function_executable` before considering it done, the same way this project already treats RLS-on-a-new-table as needing that same follow-up check.

Tests: `tests/dev-tools/cron-health-scoped-to-cron.test.js` (8, new).

## 2026-09-23 -- Clock-dependent tests failed every evening and night (and one hung CI)

**Symptom:** `tests/portal/booking-picker-round4.test.js` "tapping a time hands the page the exact computed slot..." failed with `Cannot read properties of undefined (reading 'click')`. It failed on main and on every open PR, starting in the late afternoon Denver time.

**Root cause:** the test runs on the real clock, and the picker opens on the first day with room. Late in the day that's today, with a single slot left. At 5:42 PM Denver on 2026-09-23 the first day was 2026-09-23 with one 8:00 PM slot. The test tapped `querySelectorAll('#grid .slot-btn')[1]`, a second slot that didn't exist. Earlier in the day there are several slots, so it passed.

**Fix:** tap the last slot shown instead. Nothing the test checks depends on which slot it is.

**Same shape, found the same night (2026-09-24, 00:25-00:40 UTC):**
- `booking-manage-link-round3` › "rescheduling updates the remembered visit's time" waited for more than 2 slots, then tapped `[2]`.
- `booking-flow-picker-and-confirm` › "tapping a time never moves the booking by itself" waited for more than 1, then tapped `[1]`.
- Both reschedule pickers showed one 9:00 PM slot for today (probed). Both now wait for any slot and tap the last. The saved visit is 48 h out, so any slot still moves it.

**`tests/tools/shift-clock-shell.test.js`**, "Start my day…" and "End my day…":
- **Why it failed:** fixtures come from the real clock (`Date.now() - 3 h`, a typed time 90 min ago). The shell decides "today" in local time (`thShiftClockLabel`'s `toDateString()`). CI runs in UTC, so from 00:00 to 03:00 UTC the start is yesterday. The title became "Since Sep 23, 9:25 PM" instead of "Since 9:25 PM", and the sheet took another path.
- **Fix:** before anything else, the file sets `process.env.TZ` to the `Etc/GMT` zone where it is about noon now (`12 - getUTCHours()`, always -11..+12, no DST). Each test file is its own process, and Node and jsdom share the zone, so no Date faking is needed.
- **Proof:** forced back to UTC at 00:43 UTC, exactly those two tests fail. With the fix, all 14 pass.

**The hang:** a failed assertion skipped the test's own `w.close()`. The page's timers kept the `node --test` child alive, so CI's `test` job sat "in progress" for 40+ minutes instead of failing. An `afterEach` now closes every window the file opened. Forced to UTC, the file fails in 3 s instead of hanging.

## 2026-09-23 -- Found in passing: saved phone/email don't reach every spot (not fixed)

Found by the features lane while wiring booking/manage-*/404 to `site_content`'s phone/email. The spots below keep the built-in (435) 414-1667 / steve@ address if the owner changes them in `tools/site-content.html`. Nothing is wrong today (the saved values ARE the built-in ones), but a real number change would leave these behind. The editor's "Phone and email" intro now names them, and `tests/site-content/contact-hooks-public.test.js` pins the list of affected pages.

- **Shows the new number but dials the old one.** The `tel:` link has no `.js-phone-link`: "Call <span class=js-phone-text>" buttons on index (two of them), about, our-work, careers and all 11 blog pages; also index's "Call Now" and the chat's "Call Instead". Fix: class only; the page's existing fetch already sets the href.
- **Neither text nor link follows.** "Call (435) 414-1667" buttons with `tel:4354141667` on about, our-work and 10 blog pages. The number shares a text node with "Call ", and those pages' fetch replaces the whole `textContent`, so a class alone would erase "Call ". They need the text-node swap booking.html now uses, not a wrapper span.
- **Text only:** FAQ answers on the dishwasher, refrigerator and washer/dryer St. George pages (their FAQPage JSON-LD repeats the text), and the careers "Call or text ... or email ..." line (phone and email).
- **`sms:` links:** no page has a hook for these. They include index's "Text us" buttons, booking's confirmation and "Nothing open online" lines, careers, and washer/dryer.

**Fixed 2026-09-24** by the features lane: every spot above now follows, plus index's desktop chat note, which was missed here. Details are in `features.md` ("Phone + email: every public-site spot follows site_content"). What still keeps the built-in values on purpose: the client portal, and each page's LocalBusiness/Service JSON-LD `telephone`/`email`.

## 2026-09-24 (from the visual lane; fixed later the same day with client delete) -- Dev Tools' Graveyard list never fills in

Found while regrouping `tools/dev-tools.html` (visual-only PR, so left as-is). `renderGraveyard()` is only ever called from inside `restoreFromGraveyard()` and `permanentlyDeleteFromGraveyard()` -- nothing calls it on page load, on tab switch, or on pull-to-refresh, so `#graveyardList` stays empty and there is no Restore button to press even when `th_graveyard` has entries. The init comment in `proceed()` ("renders lazily on demand ... whenever it's actually opened") describes an open/expand trigger that no longer exists; the panel isn't collapsible. Confirmed in headless Chromium with a seeded `th_graveyard`: blank until `renderGraveyard()` is called by hand, then it lists the entry with Restore. Likely fix: call `renderGraveyard()` in `proceed()` next to `renderKnownIssues()`, plus a test that loads the page with a seeded graveyard.

## 2026-09-24 -- Follow-up to #404: a Monday-only test, a test that expires Oct 1, and a CI time limit

#404 fixed four of the clock-dependent test files that a libfaketime sweep turned up. Its commit message covers those. Three gaps remained.

- **`tests/tools/shift-week-card.test.js` failed every Monday (UTC).**
  - **What it does:** the "on shift" test adds a finished Monday shift (9 h) plus an open shift started "2 hours ago". It then expects `Hours this week: Mon 9 h worked`.
  - **Why Monday breaks it:** the runner's day is Monday from about 8 PM Sunday to 8 PM Monday Mountain. The open shift is then also on Monday, so the card correctly says 11 h. The file already guarded one assertion with `if (sinceMonday > 0)`, but not that one.
  - **Why #404's approach doesn't cover it:** a fixed-offset TZ fixes the hour, not the weekday.
  - **Fix:** the new `tests/fixed-clock.js` pins that file's `Date` to a ticking Thursday 9 AM Mountain. `main` fails it at Sep 28 03:30Z, 07:00Z, 12:00Z, 18:00Z and 23:30Z, Sep 29 00:30Z, Oct 5 and Nov 2; with the pin it passes at all of those and the rest.
- **`tests/tools/job-tracker-calendar-view.test.js` would have failed from Oct 1 onward.**
  - **What it does:** two tests set `w.viewYear = 2026; w.viewMonth = 8` to show September 2026, where their sample jobs are.
  - **Why it only works in September:** the page keeps those in `let` bindings (`let viewYear = calToday.getFullYear(), ...`), so the assignment never reached it and the calendar opened on the current month. The tests passed only because they were written in September 2026. From Oct 1 00:00 UTC (Sep 30, 6 PM Mountain), every run on `main` and every PR would have failed.
  - **Fix:** they now step to September 2026 with the page's own `changeMonth()`, one month per call as a click does, and check the month label first. `main` fails them in August 2026 and in every month from October on (checked through September 2027); the fix passes in all of them.
  - **Gotcha:** assigning `w.someName` doesn't reach a page's top-level `let`/`const`. Only `var` and function declarations become window properties.
- **`test.yml` had no `timeout-minutes`.** A test file whose process never exits held the job for GitHub's 6-hour default; #404 fixed the one known cause. The `test` job now stops at 20 minutes (a normal run is about 7).

**Sweep coverage:** every test file ran under libfaketime at 12 moments on 2026-09-23/24:
- weekday evenings, late night, 5 AM and noon Mountain;
- a Saturday morning;
- Sunday afternoon and night;
- early Monday UTC.

After this change it also ran at Monday midday, a Tuesday, the Sep/Oct month boundary (which caught the calendar tests), the Nov 1 DST change, New Year 2027 and March 2027. Nothing else fails only at some hours, days or months.

- **Sweep gotcha:** a failure that shows at *every* moment, noon included, is the harness, not the clock. Running 4 worktrees at once pushed `check-undefined-vars.test.js` past a 120 s per-file limit, and tests that edit real files left worktrees dirty. Always compare against a noon baseline from the same run.

## 2026-09-24 -- Round-4 picker test: back to the second slot, on a pinned clock (follow-up to #404)

#404 fixed the evening failure in `booking-picker-round4.test.js` by tapping the last slot. A parallel fix (#405) had been asked to keep the test tapping the SECOND slot, so after #404 merged, #405 was reduced to exactly that. `pickerWindow()` evals a pinned `Date` into each window in `beforeParse`, before business-hours.js and booking-flow.js. It's a `class extends Date` with a fixed no-argument constructor and `Date.now()`, set to `WEEKDAY_MORNING` from #409's `tests/fixed-clock.js`. That helper pins only the test process's `Date`, which a jsdom window doesn't share, so the window needs its own pin at the same moment. So every picker test in the file computes slots from the same instant. The second-slot test also asserts it has 2 slots. #404's fixes for round3, picker-and-confirm and the shift-clock shell were kept as merged.

**Gotchas worth keeping (not in #404's entry):**
- A jsdom window with `runScripts: 'dangerously'` has its own V8 context and its own `Date`. `mock.timers.enable({ apis: ['Date'] })` moved Node's `Date` while the window still read the real time (checked). Pin inside the window, in `beforeParse`, before the page scripts run. (#404's shift-clock fix sidesteps this another way: `process.env.TZ` is shared by Node and jsdom.)
- To run any test file at a chosen wall-clock time without faketime: a scratch `--require` preload passed via `NODE_OPTIONS` that wraps `require('jsdom').JSDOM` so every window with scripts gets a ticking `Date` offset to `PIN_CLOCK`, plus the same shim on Node's `Date`. Offset, not frozen, so `Date.now()`-based timeouts still expire. It isn't committed; it's about 40 lines. Caveat: a bare `vm.createContext()` keeps the real clock, so a file mixing Node-side fixtures with a vm sandbox (e.g. `tools/clients-directory.test.js`) fails spuriously under it whenever the pinned date isn't today.
- **Scan the whole day, not the reported minute.** Checked only at 17:40, round3 and picker-and-confirm looked fine. Their 45-minute visits push their windows to 18:00-19:00 and 18:30-19:00 (a whole-day scan found exactly those). Each test's visit length sets its own window.

**Fixed (2026-09-24, features lane, with Delete on the client page):** `proceed()` now calls `renderGraveyard()` next to `renderFlaggedItems()`. Test: `tests/tools/client-delete.test.js` loads Dev Tools with a seeded `th_graveyard` and checks the entry and its Restore button render.

## 2026-09-24 -- "Update available" banner on nearly every open: correct guard, wrong signal

- **Reported:** the tools app's update banner (`tools/tools-nav-pwa.js`) showed on nearly every open of the installed app.
- **The guard wasn't the bug.** In real Chromium with a persistent profile (`launchPersistentContext`, closed and reopened between steps), a cold reopen with nothing deployed never fired `controllerchange`. `hadControllerAtScriptStart` holds. `skipWaiting()`/`clients.claim()` don't make a plain relaunch look like a handoff either.
- **The real cause was CACHE_NAME churn plus a wrong assumption.** `fix-versions` bumps CACHE_NAME whenever a precached file's content changes. That happened 5-22 times a day on `main` from Sep 11 to 24 (v178 to v318, from `git log --first-parent -- service-worker.js`). So nearly every open, that open's own update check installs a new worker, which claims the page and fires `controllerchange`. But that page was just fetched network-first, with fresh `?v=` URLs, so it was already current.
- **Fix:** `controllerchange` is only a cue to check. The page fetches its own URL `no-store` and compares script/stylesheet URLs plus hashes of inline `<script>`/`<style>` against what it loaded. The check is one-way, so scripts added at runtime don't count. CACHE_NAME stamping was left alone: it's correct for the offline cache, and the banner shouldn't depend on it.
- **Gotchas:**
  - Compare inline scripts by `textContent`. Running scripts doesn't change it, but they do change the DOM, so the live DOM can't be diffed against the raw HTML. Pure markup-only changes aren't detected; that's an accepted gap, since the next navigation is fresh anyway.
  - `DOMParser` docs don't resolve `src`/`href` the same way. Use `getAttribute` plus `new URL(ref, location.href)` on both sides.
  - A test for "no banner" must look for BOTH classes (`.th-update-card, .th-install-banner`). The old code used the install bar's class, so a new-class-only check passes against the old code.
  - A page first opened with no controller ignores every later `controllerchange` (the guard). Positive-case tests need a device that has opened the app once before.
- Test: `tests/tools/app-update-card.test.js`. It models one device (the active worker persists) across many jsdom opens of the real login.html; the open's update check installs a changed worker, as Chromium does. 9 of 11 fail on the previous code. The other 2 are the cases the old guard already handled.

## 2026-09-25 (from the visual lane, not fixed) -- public visitors install the whole Workspace precache

- Every public page (index, about, careers, our-work, privacy, terms, blog, services/, locations/) registers `/service-worker.js`. Its inline comment says it's "the same no-op service worker the internal tools use... It doesn't cache anything". That's stale: its install runs `cache.addAll(PRECACHE_URLS)`, 48 URLs, ~3.3MB on disk, 2.6MB of it under `/tools/` plus the 251KB PDF logo PNG and the PDF fonts. So a first-time public visitor downloads the tools app in the background. Needs a call on whether public pages should register it at all, or register something smaller.
- Both service workers precache `/images/logo-signature-orange.webp` without `?v=`, but every page requests it with `?v=...`. `caches.match()` compares the query string, so the precached copy is never served; it's an extra ~57KB download at install. Same for the PNG only if something requests it with a query (pdf-layout.js doesn't, so that one is fine).

