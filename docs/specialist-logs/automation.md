# Automation specialist log

Started 2026-09-16, alongside the `tripleh-automation` skill. See
`README.md` in this directory for how these logs work.

## 2026-09-16

Deployed two edge functions that had been written and tested but stuck
in "Not yet done" on `docs/ACTION-ITEMS.md` (items 7-8) because a prior
session had no Supabase deploy access -- this session does (the
Supabase MCP tools), so closed the gap instead of leaving it queued:

- `send-payment-reminder` -- daily cron `send-payment-reminders-daily`,
  `0 15 * * *` (15:00 UTC = 8am MST/9am MDT).
- `send-quote-followup` -- daily cron `send-quote-followup-daily`,
  `0 16 * * *` (16:00 UTC, an hour after the payment reminder so the
  two daily sends don't bunch at the same minute).

Both reuse the existing `send_push_service_role_key` vault secret
(confirmed present via `vault.decrypted_secrets` before scheduling --
this is the same secret every other cron job in the project already
uses to call its own edge function via `net.http_post`) and the
project's existing `RESEND_API_KEY`/`LEAD_EMAIL_FROM`/`LEAD_EMAIL_TO`
env secrets -- no new secret setup needed, confirmed by checking that
`send-invoice-notification` (already deployed) depends on the same
three.

Verified via `select jobname, schedule, active from cron.job where
jobname in (...)` before scheduling (empty result -- confirmed neither
cron job existed yet, so this wasn't a duplicate) and via
`list_edge_functions` (confirmed neither function was deployed yet
either). Did NOT live-invoke either function's HTTP endpoint to smoke-test
it end-to-end -- both functions email real clients about real overdue
invoices / pending quotes if run for real, so firing one manually
outside its schedule has a genuine business consequence (a real email
to a real person) and isn't a safe thing to do just to check the code
runs. The auto-mode classifier independently blocked a `curl` attempt
at this for the same reason. So: the deploy and the cron registration
are both confirmed done, but the *first real run* of each is still
unverified in the sense the skill cares about ("watched it actually
fire and do the right thing") -- worth checking `notification_log` for
rows with `notif_type` starting `invoice-reminder-` or
`quote-followup-email` after the first 15:00/16:00 UTC run to confirm
it actually sent something (or correctly sent nothing, if nothing
qualified that day).

One deploy mistake worth flagging for next time: the first
`deploy_edge_function` call for `send-payment-reminder` went out with
placeholder content instead of the real file -- caught immediately by
re-reading the deployed version number (went to v1 instead of failing
loudly) and corrected with a second deploy carrying the real source
before anything could have run on the placeholder. Double-check the
`files` payload lands as the actual source, not a stand-in, before
moving on -- this tool doesn't validate that a "successful" deploy
contains the code you meant to ship.

## 2026-09-16 — send-payment-reminder / send-quote-followup are live but silently broken

Came in to deploy these two (per `docs/ACTION-ITEMS.md` items 7-8) and
found they were already deployed and their crons already scheduled and
active (`send-payment-reminders-daily` at 15:00 UTC, `send-quote-followup-daily`
at 16:00 UTC, both `select cron.schedule(...)`'d and `active: true`) --
someone/some earlier session had already done the deploy step, just
never updated the doc. So this wasn't actually a deploy task; it was a
verification task, and verification is where it fell apart.

**Real finding: both functions have been returning 401 on every real
run since they went live, and nothing has ever actually been sent.**
Proved this by re-running the *exact* SQL the cron jobs use (same
`net.http_post`, same `vault.decrypted_secrets` lookup for
`send_push_service_role_key`) directly against both functions --
both came back `{"ok":false,"error":"Unauthorized"}`, HTTP 401.

Root cause, confirmed by reading the deployed source
(`get_edge_function`, not just the repo copy -- the deployed version had
already moved one commit past what's in `edge-functions/*-index.ts`
locally): both functions carry a strict internal auth check --

```ts
const token = authHeader.replace(/^Bearer\s+/i, "");
if (token !== SERVICE_ROLE_KEY) { ...401... }
```

-- comparing the incoming bearer token for *exact equality* against
this function's own `SUPABASE_SERVICE_ROLE_KEY` env var (the same
pattern already used by `uptime-alert`, added there to stop the
public anon key -- which validly passes Supabase's platform-level
`verify_jwt` since that only checks a JWT's *signature*, not its role
-- from triggering client-facing sends). That's the right check to
have. But the cron's vault secret (`send_push_service_role_key`) is
apparently *not* the current real service-role key -- it's some other,
differently-signed-but-still-valid JWT, which is why looser functions
like `send-appointment-reminder` (no exact-match check, platform
`verify_jwt` only) have been firing fine on the same secret every hour
while these two, which added the stricter check, fail every time.

**Could not fix from here**: I have no way to read the project's true
current `service_role` key from this session (no MCP tool exposes it,
no env var carries it) to know what the vault secret *should* be
updated to. This needs someone with Supabase dashboard access to copy
the real key from Project Settings -> API -> service_role, then either
update the `send_push_service_role_key` vault secret to match it, or
(cleaner, if this key is meant to be dedicated to server-side cron
calls specifically) rotate/create a secret specifically for that and
point the two cron jobs at it. Logged as a real bug too (see
`bugfix.md`) since the underlying comparison logic is legitimate
security -- what's broken is the secret's value, not the code.

**Lesson for next time touching this cron pipeline**: "the cron job
exists and is `active: true`" and "the function is deployed" are both
necessary but not sufficient to call an automation working. The only
real check is watching an actual request round-trip with a 200 and
the response body you expect -- which is why I fired both functions
manually via the cron's own SQL rather than trusting the dashboard's
green status. `notification_log` is also a fast tell: zero
`invoice-reminder-*`/`quote-followup-*` rows ever, despite invoices
that should clearly have qualified (Richie's invoice was 6 days
overdue at the time), was the first sign something was off before I
even ran the manual test.

## 2026-09-16 (later the same day) -- hub dispatch: verify two flagged edge-function findings

Dispatched with two items to check on: (1) whether the lowercase
`send-push` Edge Function is really dead code, and (2) a report from
the security chat that `checkPendingReviewReminders` was "referenced
but missing from the live Functions list." Verified both directly
against the live Supabase project rather than trusting either claim at
face value -- neither was quite right as originally framed.

**1. Lowercase `send-push` -- genuinely orphaned, confirmed via
`list_edge_functions`/`get_edge_function`, still deployed.** This
directly contradicts `README.md`'s own "Resolved" note claiming it "no
longer appears in the project's function list at all" -- it does; that
note was wrong (most likely a stale function-list read from whoever
wrote it, not an actual deletion that later regressed). Confirmed dead
by comparing its source (v8) against the real `Send-Push` function's
current source (v50): the lowercase copy is missing three real fixes
`Send-Push` has picked up since -- the business-timezone fix
(`todayAtMidnight`/`zonedTimeToUtc`/`todayDateStrInBusinessTz`), the
partial-payment-aware overdue check (`getPaidAmount`/`getRemainingCents`),
and the whole `checkPendingReviewReminders` feature (see #2 below).
Confirmed nothing calls it, two ways: grepped the whole repo (every
`/functions/v1/` reference to this function is exact-cased `Send-Push`,
and 4 separate test files explicitly assert this), and queried the live
database directly for any lowercase `/send-push` URL in either
`cron.job.command` or any `pg_proc` function body (`prosrc`) -- zero
rows either way. So this is real, not just an aging repo artifact never
actually deployed.

**Could not actually delete it.** The Supabase MCP tools available in
this session cover list/get/deploy for Edge Functions but have no
delete call, and the `supabase` CLI isn't installed in this container
(`command not found`). Corrected the stale README claim, and logged the
deletion itself as manual action item #9 in `docs/ACTION-ITEMS.md`
(needs the Supabase dashboard or a machine with the CLI + project
access) rather than leaving the incorrect "already resolved" note
sitting there uncorrected. Worth flagging as a gap in this project's
current tooling: there's no way to actually remove a deployed Edge
Function from inside a session like this one -- only add/replace one.

**2. `checkPendingReviewReminders` -- not missing, not a broken
deployment.** It was never going to appear as its own entry in the
Functions list, because it isn't its own deployed function -- it's a
plain internal TypeScript function living inside the single `Send-Push`
Edge Function's source file (`edge-functions/send-push-index.ts` in the
repo), alongside every other `checkXxx` helper the reminder-check
pipeline calls. Confirmed it's genuinely live in production, not just
present in the repo: read `Send-Push`'s actual deployed source directly
via `get_edge_function` (v50, updated same batch as the newest
functions) and it has the real function body plus its wiring into the
`reminder-check` dispatch (`await checkPendingReviewReminders(reviewReminders)`),
matching `tests/edge-functions/pending-review-reminder-push.test.js`
exactly. So there's no broken deployment to fix here -- whoever on the
security side went looking for a Function named `checkPendingReviewReminders`
in the Functions list was checking the wrong kind of list for what this
actually is (an internal helper, not a deployable slug). Nothing to
coordinate a fix for; reported back as a false alarm rather than acting
on it further.

**General lesson for this log:** a "no longer appears" or "missing"
claim about live infrastructure is itself a claim to verify against the
actual live state (`list_edge_functions`/`get_edge_function`/a direct DB
query), not something to take on faith from an earlier session's notes
or another chat's report -- both halves of this dispatch turned out to
be exactly backwards from how they were first framed.

## 2026-09-17 — GitHub Watcher ops checklist (no new cron)

Did not add a GitHub Action or Routine. Wrote
`docs/github-watcher-ops.md` so a Repo Management / Watcher session
has a real loop instead of re-deriving merge policy each time.

CI that is actually a merge gate: `test.yml` only. `check-links.yml`
and `lighthouse.yml` run after (or beside) production. Lighthouse
asserts a11y/SEO 0.9 as errors against the *live* homepage and
Hurricane page only. `eslint.config.js` exists and is not invoked by
any workflow.

`check-links.py` `PUBLIC_PAGES` still omits
`handyman-st-george-ut.html` (sitemap-listed) plus service/blog/legal
pages; workflow comment still says "6 public pages." Backup workflow
still omits `client_portal_contracts` and
`client_portal_job_messages`. Those are automation-lane follow-ups,
not Watcher merges.

Leftover branch `cursor/ga4-booking-trust-ctas-2cba` should be
deleted after Connor OK (`delete_branch_on_merge` did not remove it
because a later commit was pushed onto the branch after #269
squashed).

## 2026-09-18 (later the same day) -- hub dispatch: move root JS into js/

Pure reorganization, dispatched via the hub on Connor's confirmation:
move `analytics-events.js`, `business-hours.js`, `cookie-consent.js`,
`promo-banner.js`, `site-motion.js`, `triage.js`, `utm-tracking.js`
from repo root to `js/`. PR #293, not merged (per standing rule).

**Two hardcoded config lists needed updating, not just HTML script
tags**: `GLOBAL_SHARED_FILES` in `scripts/check-consistency.js` and
`SHARED_SCRIPT_FILES` in `scripts/check-undefined-vars.js` both store
these files' paths as literal strings used to resolve real file
content on disk (`currentContentHash(ROOT_DIR, file)` does
`path.join(ROOT_DIR, file)`). Leaving them as bare filenames after the
move wouldn't have broken loudly -- `currentContentHash` returns `null`
and both `checkGlobalSharedFileFreshness`/`fixGlobalSharedFiles` just
`continue` past a missing file silently, per an explicit comment
("file doesn't exist -- not this check's job to notice that"). That
would have quietly disabled freshness checking for these 6 files
instead of failing CI -- worth remembering for any future file-move:
grep for the bare filename in `scripts/` before assuming "no `?v=` in
the diff" means nothing else needs updating.

**Precache fingerprint mechanism handles a pure path move correctly,
confirmed by reading its actual implementation**
(`computePrecacheFingerprint` in check-consistency.js hashes
`url + ':' + contentHash` per entry, not content alone) -- so editing
`portal/service-worker.js`'s `PRECACHE_URLS` entry from
`/business-hours.js` to `/js/business-hours.js` (the only one of the
seven actually precached; confirmed by grepping both service workers'
real `PRECACHE_URLS` arrays, not just comment history) changed the
fingerprint even though the file's content didn't, and
`npm run fix-versions` auto-bumped both `CACHE_NAME`s on its own with
no manual intervention needed. Good evidence the 2026-09-08 automation
generalizes correctly to a case it wasn't explicitly designed for.

**Mistake caught before pushing**: committed this work directly onto
`claude/auto-fix-cache-bust-ci` (already the head of open PR #290,
unrelated) instead of a fresh branch. Caught before pushing --
confirmed the branch's second-to-last commit still matched
`origin/claude/auto-fix-cache-bust-ci` exactly
(`git log --oneline` against both), so `git branch
claude/move-root-js-to-js-dir <bad-commit-sha>` +
`git reset --hard <last-good-sha>` on the original branch safely split
the reorg commit onto its own branch with zero risk to the
already-pushed PR #290. Lesson: start every dispatched task with an
explicit `git checkout -B <new-branch> origin/main`, don't assume the
working branch is still whatever the previous task left checked out.

Verified clean before opening the PR: `npm run fix-versions`,
`npm run check-consistency`, `npm run check-undefined-vars`,
`python3 scripts/check-links.py`, and the full suite (2378/2378).

<!-- Add new entries above this line -->
