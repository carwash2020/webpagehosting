# Continue here

Pick-up notes for a fresh Claude Code session on this repo, from any
device. Read this first, then re-verify anything below against the actual
files before relying on it — this document goes stale, the code does not.

**Live site:** https://www.triplehenterprisesllc.biz
**Repo:** `carwash2020/webpagehosting`
**Deploy model:** GitHub Pages serves `main` directly, no build step.
**Merging to `main` is deploying to production.** Work on a branch, open
a PR, and get CI green before merging.

There used to be a reference here to a fuller original briefing file
(`CLAUDE-CODE-HANDOFF.md`) — it was never actually committed to this repo
(delivered once, outside version control, same as `DISASTER_RECOVERY.md`
originally was before 2026-08-14). If that exact filename doesn't exist
when you read this, that's not a regression; `README.md`, `DISASTER_RECOVERY.md`,
and this file are the actual current sources of truth.

---

## The three rules that will bite you

These are not style preferences. Each one has already caused a real
failure on this project. **As of 2026-09-08, all three are now handled
by one command: `npm run fix-versions`.** They used to require a human
to remember and compute the right value by hand, one rule at a time —
that's exactly what kept violating them. Read on for why each rule
exists; you no longer need to do any of it manually, just run the
command and let `check-consistency` (which now checks all three, and
runs on every push) confirm it.

### 1. Bump the stylesheet cache stamp, or your CSS never ships
Every public page references `/styles.css?v=HASH` (root, `tools/`,
`portal/`, and `blog/` alike). GitHub Pages sits behind Fastly, which
caches per-URL independently of the browser — a hard refresh and
incognito both still get the old file. If you change `styles.css` and
the stamp referencing it doesn't change in **every** referencing file,
your change is live on the server and reaching nobody.

`styles.css` (and `triage.js`/`business-hours.js`/`site-motion.js`, the
other root-level files shared across directories) used to carry a
hand-picked timestamp instead of a content hash, checked only for
internal agreement (do all tool pages match each other), never against
the file's real content. That's why this bit repeatedly. It's now a
real sha256-derived hash of the file's actual current bytes, the same
mechanism every other shared tools/portal file already used, just no
longer confined to a single directory — `npm run fix-versions`
recomputes and rewrites every reference across root/tools/portal/blog in
one pass, and `check-consistency` fails the build if any reference is
stale relative to the real file.

This exact mistake cost a full round-trip earlier: a merged PR appeared
to do nothing, and the code was fine — nothing was fetching it.

### 2. Bump `CACHE_NAME` when a precached file changes
Both service workers serve any `?v=` URL **cache-first with no
revalidation**, and both precache `/styles.css`.

- `portal/service-worker.js` — check `grep "CACHE_NAME = " portal/service-worker.js`
- `service-worker.js` (Workspace/tools) — check `grep "CACHE_NAME = " service-worker.js`

If you change a file listed in that worker's `PRECACHE_URLS` and do not
bump its `CACHE_NAME`, **installed app users are pinned to the old copy
indefinitely.** Bumping the name purges every stale entry on activate.
This has been violated more than once across this project's history.

Each `CACHE_NAME` now carries a trailing `// precache-fingerprint:HASH`
comment — a hash of every precached file's real current content, in
list order. `npm run fix-versions` recomputes that fingerprint and, if
it doesn't match what's stored, bumps the version number and updates
the comment automatically; `check-consistency` fails the build if a
precached file changed and the stored fingerprint was never refreshed.
`npm run check-consistency` also still checks both workers'
`PRECACHE_URLS` for missing/stale file entries the same as before, and
`portal/portal-update.js` exists (see below) as a way for an installed
app to actually pick up a bumped `CACHE_NAME` without waiting for the
user to happen to close and reopen it.

### 3. Tool page hashes drift on some checkouts
`tools/*.html` reference `styles-tools.css` and shared `.js` files by
**content hash**, not a hand-chosen version. On some checkout
environments, line-ending conversion can change a file's bytes after
commit, moving its real hash out from under an already-committed `?v=`
reference and failing `check-consistency`. (On a normal Linux checkout
this usually isn't an issue at all — but if `check-consistency` ever
fails on a file you didn't think you touched, this is the first thing
to check before assuming the code itself is wrong.)

Fix: `npm run fix-versions`. Run it after touching any shared tools file
(anything referenced by 2+ pages — the script figures out which files
those are itself, nothing to maintain by hand), then re-run
`npm run check-consistency`.

---

## Checks to run before asking for a merge

```bash
npm install
npm run check-undefined-vars     # expect: clean, ~42 pages
npm run check-consistency        # expect: clean
npm run check-visual-snapshot    # expect: all match baseline
python3 scripts/check-links.py   # expect: everything resolved
npm test                         # expect: ALL PASSING, see below
```

**`npm test` should be fully green.** As of 2026-09-08 it's 1538/1538. An
earlier version of this document said the suite had "many pre-existing
failures... unrelated to the public site" and told a future session to
disregard a red run — **that was wrong, and it was actively harmful**: it
told a session to ignore the one signal that would have caught a real
regression. See `DISASTER_RECOVERY.md`'s "⚠️ CORRECTED" section for the
full story of how that got disproven. **The current rule: treat any red
test as real until you've personally confirmed otherwise** — check
whether the exact same failure exists on a clean `main` checkout before
assuming it's unrelated to your change, don't just assume it from a
comment in a doc (including this one).

---

## Where the real change history lives

This file is deliberately short-lived pick-up notes, not a changelog.
For what's actually shipped and when:

- **`README.md`** — has a running "What changed, `<date range>`" section
  near the bottom for each recent block of work; the most recent one is
  the fastest way to see what's new.
- **`DISASTER_RECOVERY.md`** — the deepest source for exact mechanisms,
  real incidents, and lessons learned the hard way (including a whole
  scenario, as of 2026-09-08, on why a CodeQL alert can survive
  extensive sanitization and what actually clears it).
- **`git log`** — commit messages on this repo are written to be read
  later, not just at merge time; they carry the actual reasoning, not
  just a one-line summary.

## The scroll-craft skill travels with this repo

The public site's visual language (starting 2026-09-06) came from a
skill called **scroll-craft**. It's committed at
`.claude/skills/scroll-craft/`, so any session working on this repo has
it — including a session started from a phone at claude.ai/code, which
has no access to a personal skills directory on one particular machine.
MIT licensed, by Nate Herk. A rollback checkpoint tag exists for that
specific body of work: `pre-scroll-craft-redesign-2026-09-06` (see
`DISASTER_RECOVERY.md` for the rollback commands).

Two notes:
- `scripts/check-links.py` skips `.claude/` deliberately. The skill ships a
  template that references placeholder assets on purpose, and scanning it
  reports false "broken links" otherwise.
- The design language from that skill is already chosen and built;
  README.md's "What changed" sections describe what's been layered on top
  of it since. The skill's own full process (brief, grammar, fingerprint
  gate) is for starting an entirely new visual direction, not for routine
  follow-up work.

## Not verified — worth doing on a real device

Nothing below is known broken. It is genuinely untested, because the
development environment used for most of this work can't test it.

- **Anything on a real phone**, generally — the preview/CI environment
  can't scroll reliably or register a service worker at all.
- **The installed-app update cycle.** Open the portal or tools suite on
  a phone, Settings → App version → **Update app**, confirm it reloads
  cleanly after a real `CACHE_NAME` bump.
- **Print output** through an actual print dialog.
- **Reduced-motion** on a real device, for any of the CSS animations
  added across the various design passes.

## Open follow-up: relational tables Phase 2 (in progress, one page at a time)

`jobs`/`invoices`/`invoice_line_items`/`quotes`/`quote_line_items`/
`contracts` are real Postgres tables now (2026-09-08), with real foreign
keys, dual-written alongside the existing blob-sync save path on every
real create/update/delete. See README.md's "Jobs/invoices/quotes/
contracts get real relational tables" section for the full reasoning.

**Phase 2 (moving reads to the relational tables, retiring the blob for
these 4 record types) started 2026-09-09, deliberately one page at a
time** — confirmed directly: verify each page against production
before moving to the next, and keep the existing offline-first
behavior (instant load from a local cache, refreshed once the network
call resolves) rather than trading it away for a live-network
dependency. Before starting, the relational tables were confirmed in
exact sync with the blob (6/6 jobs, 2/2 invoices, 0/0 quotes, 1/1
contracts) — not catching up on drift.

**Done:** `calendar.html`'s job read (`loadJobsForCalendar()`), chosen
as the first and safest page specifically because it's **read-only** —
it never writes `th_tracker_jobs`, so a mistake here can only show
wrong/stale data, never corrupt anything. `fetchJobsFromRelational()` +
`startJobsRealtime()` in `tools/sync.js`; `jobs` added to the
`supabase_realtime` publication
(`sql/infra/add_jobs_to_realtime_phase2.sql`, alongside `th_bookings`/
`th_leads`/`workspace_sync`, which were already in it).
`cachedRelationalJobs` starts `null` (not `[]`, so a genuinely empty
result isn't mistaken for "hasn't loaded yet") and
`loadJobsForCalendar()` falls back to the localStorage copy until the
first fetch resolves — the exact same pattern this page already used
for `cachedUnconvertedBookings`. Tests:
`tests/sync/relational-jobs-read-phase2.test.js`.

**Still unstarted:** every other page that touches these 4 record
types still reads/writes localStorage/the blob only --
`job-tracker.html`, `workspace.html`, `invoice-generator.html`,
`contract-generator.html`, `finance.html`, `route-planner.html`,
`review-request.html`, `runway-dashboard.html`, `dev-tools.html`. Any
page with a real WRITE path (job-tracker.html, invoice-generator.html,
contract-generator.html) is meaningfully higher-risk than
calendar.html was — don't assume the same pattern transfers 1:1
without checking each page's actual save flow first. The blob itself
(`workspace_sync.data.th_tracker_jobs` etc.) is not yet retired for any
of the 4 types — it's still the thing every write path updates, and
still what every other page's read still depends on.

## Things that look odd but are deliberate

- Cedar City and Mesquite are **by-request only**, shown dashed/orange
  everywhere including when focused on their own landing page. They are
  deliberately excluded from the main `areaServed` schema. Do not
  "fix" this.
- The Terms modal opens via the `/#terms` hash. Landing pages link there,
  not to `terms.html`.
- The lead form's `_gotcha` honeypot is real spam protection.
- Phone, email, hours, FAQ and Terms come from Supabase at runtime via
  the `.js-phone-text` / `.js-email-text` spans. Editing that text in the
  HTML alone will be overwritten at page load.
- Triage copy is deliberately qualitative — no prices, no percentages, no
  invented statistics — and every path ends in "we'd have to look at it."
  Keep it that way.
- The homepage runs noticeably longer than a typical single-page site on
  purpose (Master Audit, W01–W24) — it's been through multiple explicit
  length-reduction passes already; don't assume length itself is a bug
  before checking `DISASTER_RECOVERY.md`/README's recent "What changed"
  entries for what's already been deliberately trimmed and what's been
  kept on purpose.

## Never
Re-introduce Square (the account was banned). Touch the lead form's
insert, the booking pages' logic, the JSON-LD, the GA4 snippet, or the
favicon links without a specific reason. Add a CodeQL suppression
comment or widen a redaction function without first checking
`DISASTER_RECOVERY.md` Scenario 15 — there's a real, non-obvious lesson
there about which approach actually works for that specific alert type.
