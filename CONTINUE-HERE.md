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
failure on this project.

### 1. Bump the stylesheet cache stamp, or your CSS never ships
Every public page references `/styles.css?v=TIMESTAMP`. GitHub Pages
sits behind Fastly, which caches per-URL independently of the browser —
a hard refresh and incognito both still get the old file. If you change
`styles.css` and do not bump that stamp in **every** referencing file,
your change is live on the server and reaching nobody.

Current value: check `grep -n "styles.css?v=" index.html` directly — it
changes every time `styles.css` does, and this note will be stale the
moment you read it. `npm run fix-versions` handles this for you; see
below.

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
This has been violated more than once across this project's history,
which is why `npm run check-consistency` now checks both workers'
`PRECACHE_URLS` for drift automatically on every push, and why
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
