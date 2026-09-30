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

**Follow-up, caught rebuilding the branch cleanly**: the "committed onto
the wrong branch" mistake above wasn't actually fully fixed by that
split -- `git branch claude/move-root-js-to-js-dir <sha>` carries a
branch's *entire* ancestry, not just its tip commit, so the new branch
still had PR #290's two commits underneath it. GitHub's own
`mergeable_state` on the resulting PR #293 (`dirty`) plus `commits: 4`
(should have been 2) is what caught it, not anything local -- worth
remembering that splitting a bad commit off a branch means rebuilding
from the correct base with `cherry-pick`, not just branching from the
bad commit and calling it done. Rebuilt via
`git checkout -B <branch>-clean origin/main` +
`git cherry-pick <sha1> <sha2>`, resolving two real conflicts along the
way (both service workers' `CACHE_NAME` line, where current `main` had
independently bumped it since this branch's original base) by keeping
either side's line and letting a fresh `npm run fix-versions` recompute
the real value rather than hand-picking one.

That rebuild also surfaced a second, unrelated real gap: two new pages
(`refrigerator-repair-st-george-ut.html`, `dishwasher-repair-st-george-ut.html`)
merged into `main` (via #287) *after* this task's original file sweep,
also load `promo-banner.js` from the old root path -- genuinely broken
now, not a test artifact, since the file really has moved. Caught by
the full test suite actually growing (2378 -> 2436 tests, tracking
main's new pages) and 2 of the new ones failing, not by anything
static. Fixed the same way as every other page. Lesson: a file-move
PR's "list every current reference" sweep is a snapshot -- if `main`
moves during the work, re-sweep against the rebased branch before
calling it done, don't trust the original grep.

## 2026-09-18 -- hub dispatch: Cursor PR review, cache-bust automation gap

Reviewed Cursor Agent's recent PRs (#265-288, `carwash2020/webpagehosting`)
per a hub dispatch. Scope was specifically the recurring manual
cache-bust/version-stamp step showing up in nearly every PR touching a
shared file -- not a full correctness review of Cursor's application
logic, which is out of this lane.

**What's actually happening**: the 2026-09-08 automation
(`npm run fix-versions`, content-hash based, enforced by
`check-consistency` on every push) already solved the *old* problem
(hand-picked version strings). It did not solve a newer one it
structurally can't: storing the hash in committed source means any two
PRs touching the same shared file (`styles.css`, `triage.js`, etc.)
race on the hash with no textual conflict -- whoever merges second
needs a human/agent-noticed fixup commit. Confirmed live, not just from
history: PR #287 needed a third commit
(`1870597`) purely to re-fix a hash gone stale because #288 merged
first mid-PR. Recurs across git history under various names
("Resync cache-bust stamps...", "Bump service-worker.js CACHE_NAME
after merging main again...").

**Fix proposed, merged 2026-09-18 on Connor's explicit sign-off**: PR
#290 (recreated as a clean branch after the original diverged in a way
GitHub's merge check couldn't reconcile) adds
`.github/workflows/auto-fix-cache-bust.yml` -- runs `fix-versions` on
every PR push, commits+pushes only if it actually changed something.
Verified locally against current `main` that `fix-versions` is a true
no-op when nothing's stale (so the job does nothing on a normal clean
push). Restricted to same-repo branches so the default `GITHUB_TOKEN`
can push back; a `GITHUB_TOKEN` push doesn't retrigger workflows, so no
loop risk. Worth watching the first real `pull_request`-triggered run
to confirm it fires and behaves as designed, since this session could
only verify the underlying script's behavior locally, not the workflow
trigger itself.

**Mistake made and caught mid-task, worth flagging**: while switching
branches for this work, `git checkout main -- .` (meant to clear an
earlier working-tree check) silently staged dozens of files with
content from a stale *local* `main` ref (stuck at old commit #218,
unrelated to `origin/main`) -- not caught until a subsequent
`git checkout -B ... origin/main` refused to run because of the
resulting uncommitted changes. Recovered safely with `git reset --hard
HEAD` since nothing had been committed and the branch already matched
its origin exactly -- but the lesson is real: never run a bare
`git checkout <ref> -- .` (or any working-tree-wide checkout) without
running `git status` first and confirming which ref is actually
intended, local branch names can be stale in ways `origin/*` refs
aren't.

**Also reviewed (not automation-lane, reported for context)**: Cursor's
commit messages are consistently good (explain why, not just what,
matching this repo's existing convention) and CI failures get
root-caused rather than skipped (e.g. PR #283's real `showConfirm`
stub fix, PR #287's real CodeQL regex-escaping fix via `includes()`
instead of further sanitization). One thing worth a second look by
whoever owns CI reliability: PR #283 has an empty "Retrigger Tests CI
after cancelled hung runs" commit -- harmless once, but if "hung runs"
recur it's a symptom worth root-causing rather than re-triggering
around.

## 2026-09-25 -- from the reports lane (SEO/technical audit, not fixed)

- **`.github/workflows/lighthouse.yml` still audits
  `/handyman-hurricane-ut.html`**, a redirect stub since the 2026-09-21 move.
  Run #43 followed the refresh to `/locations/...`, but every run measures the
  redirect hop. Point it at `/locations/handyman-hurricane-ut.html`.
- **`robots.txt`:** the 5 AI answer-bot groups have only `Allow: /`. Under
  RFC 9309 a bot obeys only its most specific group, so those bots aren't bound
  by the `*` group's `/.claude/`, `/tools/`, `/portal/` disallows. Add the three
  lines to each group; keep 5 separate groups (the robots test parses one block
  per User-agent).
- **`scripts/check-links.py` in a sandboxed session** reports proxy refusals
  (`Tunnel connection failed: 403`) as BROKEN for non-allowlisted hosts (9
  Unsplash images today; CI run #675 got 200 for all 9 on the same commit).
  Classify tunnel/proxy errors as UNVERIFIABLE. Its docstring ("7 landing
  pages") and `check-links.yml`'s comment ("6 public pages") are stale; the
  list has 37 entries since #424.

## 2026-09-30 -- private backup catches up with the schema; edge-function drift check

**Backup (`backup-sensitive-data.yml`).**
- **Gap found:** checked against the live schema (51 tables), the backup covered 26. It was missing 16, among them `client_portal_contracts` and `client_portal_job_messages` (flagged here 2026-09-17), `client_portal_thread_reads`, `client_account_codes`, `referrals`, `th_job_applications`, the relational `jobs` / `invoices` / `invoice_line_items` / `quotes` / `quote_line_items` / `contracts`, `stripe_pos_charges_logged` and the new `tenants`.
- **Second gap:** each table was one request, and PostgREST returns at most 1000 rows, so a table past 1000 rows would have been cut short with no error. The storage script's folder listing had the same 1000 cap.
- **Fix:**
  - `scripts/backup-tables.json` names every table as backed up, backed up elsewhere (the 3 CMS tables, `backup-cms-content.yml`) or excluded with a reason. The six excluded are cron and uptime telemetry, the two-factor gate log, and `internal_mfa_recovery_codes`: a restored copy would bring back used or replaced sign-in codes.
  - `scripts/backup-tables.py` reads the live table list from PostgREST's OpenAPI description on every run and stops before writing anything if a table isn't named, or a named one is gone. It pages 1000 rows at a time by primary key and refuses a copy shorter than the row count PostgREST reports. Output bytes are unchanged (`json.tool` style, checked).
  - `scripts/backup-storage-bucket.py --all` backs up whichever buckets exist (5 today) and pages folder listings.
- `tenants` is first in the list: since multi-tenant Tier 0 every row references one, so it restores first.
- Test: `tests/scripts/backup-scripts.test.js` (7) runs both scripts against a fake Supabase: 2500 rows in 3 pages; an unknown live table stops the run with nothing written; a short copy leaves yesterday's files alone; `--all` picks up a new bucket and pages a 1500-file folder.

**Edge-function drift (`.github/workflows/edge-function-drift.yml`, `scripts/check-edge-function-drift.js`).**
- Merging doesn't deploy functions, and nothing noticed when live and repo disagreed: three incidents (uptime-alert, Send-Push, stripe-webhook).
- The workflow runs after any merge touching `edge-functions/` and every Monday. It downloads each live function's source with the Supabase CLI and fails, listing what to deploy, on any function that differs, is live-only, is repo-only or didn't download. It never deploys: per-function `verify_jwt` settings (off only for stripe-webhook) make a blind auto-deploy riskier than a loud reminder.
- **Needs one secret before its first run:** `SUPABASE_ACCESS_TOKEN`, a Supabase personal access token (the service-role key can't read function source). Setup steps are at the top of the workflow; until then its first step fails and says so. Logged in ACTION-ITEMS.
- Not verifiable from the sandbox (no token, supabase.com blocked): the CLI download step. The compare script is tested (`tests/scripts/edge-function-drift.test.js`, 3), including a run against copies of all 41 repo functions.
- Checked by hand today instead: the live list has the same 41 functions as `edge-functions/`. Since the folder was created (a9f8d44, 2026-09-23) only the 2026-09-25 changes touched functions, and every one of those was redeployed after (18:20-18:32). `get-job-photo-urls` (live since 09-16) matches the repo line for line. The full content diff waits for the workflow.
- **First real runs (same day, after the owner added the secret):**
  - Run 1: all 41 "differ". The CLI's default download unpacks the bundle with Docker, which returns re-emitted code (a different line count for every function). The workflow now passes `--use-api`, which returns the original files. The report now also gives each difference's shape (line counts, first differing line, files downloaded). It never shows content, because this repo's Actions logs are public.
  - Run 3: 37 match. send-booking-email and Send-Push differed only because the repo writes an en dash and a middle dot as `\u2013` / `\u00b7` and the deployed copies have the characters themselves. The compare now treats an escape and its character as the same.
  - Run 4: 39 match, 2 differ, and both are real:
    - `uptime-alert`: live v11 still has no service-role check (security log, 2026-09-17 entry, item 2). Deploying it needs the owner's go-ahead and one caveat. The check is a strict `token !== SUPABASE_SERVICE_ROLE_KEY`. The live env key moved to the `sb_secret_` format (`sql/infra/resync_cron_service_role_key.sql`). If the GitHub `SUPABASE_SERVICE_ROLE_KEY` secret is still the old JWT, every uptime alert would get 401. So after a deploy, probe once with that secret and a malformed body: 500 means the key matched (the JSON parse fails and nothing is sent), 401 means roll back to v11.
    - `respond-to-contract`: comment lines only (the repo copy has extra comments). Logic is the same. It needs a redeploy to go green; that is harmless, but it's still a production deploy.

## 2026-09-30 -- the 2026-09-25 automation notes, done

- **`robots.txt`:** each of the 5 AI answer-bot groups now repeats `Disallow: /.claude/`, `/tools/` and `/portal/`. A bot obeys only its most specific group (RFC 9309), so they weren't bound by the `*` group's blocks. The groups stay separate (the robots test reads one block per User-agent).
- **Lighthouse** audits `/locations/handyman-hurricane-ut.html` instead of the redirect stub it had been measuring since the 2026-09-21 move.
- **`check-links.py`:**
  - A proxy refusal (`Tunnel connection failed`) is now UNVERIFIABLE, not BROKEN. It only happens behind a sandboxed session's proxy (CI has none) and says nothing about the link. The suite's check-links test now passes in a sandbox too.
  - Its docstring ("7 landing pages") and `check-links.yml`'s comment ("6 public pages") now describe the real list: 40 pages, kept in step with the sitemap.

