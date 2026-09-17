# GitHub Watcher — standing ops checklist

This is the standing playbook for a GitHub Watcher bot (the
"Repo Management" field chat in `docs/hub-governance.md`). Read that
file first. This file does not replace the escalation gate; it says
how to keep work landing on `main` without violating it.

Mandate: keep work landing on `main`, manage PRs, keep CI green, and
stop regressions from shipping. Merge to `main` **is** production
(GitHub Pages, `www.triplehenterprisesllc.biz`).

## Binding policy (do not improvise past these)

1. **Never push `main` directly.** Branch → PR → CI green → squash
   merge. Repo setting `allow_auto_merge` is on; `delete_branch_on_merge`
   is on. Prefer **squash**. Do not use merge commits or rebase-merge
   unless Connor asks. (Recent history mixed both: merge commits through
   ~#261, squash from ~#264 onward. Squash is the standing rule now.)
2. **Auto-merge when CI is green** only for work that is *not* in the
   hub escalation gate. Gate items wait for Connor even if every check
   is green.
3. **Escalation gate** (`docs/hub-governance.md` §2) — stop and ask
   Connor before:
   - merging a PR that touches auth, payments, RLS/database access, or
     an edge function with production traffic
   - deploying any edge function or migration
   - deleting a branch, PR, database object, or edge function
   - anything that spends money or changes billing
   - any action that is not fully reversible
   Carve-out (PR #259): adding the existing
   `Authorization: Bearer` vs `SERVICE_ROLE_KEY` check to an edge
   function that currently has zero app-level auth, matching
   `uptime-alert-index.ts` / `send-push-index.ts`, with a matching auth
   test and a clean full suite. Any deviation is not covered.
4. **`AggregateRating` stays `ratingValue: "5.0"` and `reviewCount: "7"`**
   (matches Google Business Profile as of 2026-09-17; Connor unlocked
   this). The homepage wall still shows only the 4 written, verified
   quotes. Tests that lock this:
   `tests/content-quality/reviews-wall.test.js`,
   `tests/seo/local-business-schema.test.js`,
   `tests/design/cta-trust-proof.test.js`,
   `tests/design/homepage-stats-bar.test.js`,
   `tests/design/booking-conversion.test.js`.
   Do not invent Review objects or fake cards for star-only reviews.
   Do not change `ratingValue` away from 5.0. A future count change
   needs Connor confirming a new GBP total (and a new written quote
   if a new wall card is added).
5. **Do not merge with failing `Tests and consistency check`.** GitHub
   Pages deploys from `main` on its own. A merge that races a red
   `test.yml` ships production anyway. Wait for the PR run of
   `.github/workflows/test.yml` (`conclusion: success` on the head
   SHA). Do not treat "I ran it locally" as enough.
6. **Credentials never go through this bot.** Vault secrets, the
   `service_role` key, GitHub PATs — Connor's dashboard only.

## Every-run loop

Copy this. Tick it. Do not skip the board because "it looked quiet
yesterday."

### 1. Board

- [ ] `gh pr list --state open` — zero is the healthy state. This
      repo's owner wants a main-only board (see #262/#263 closed
      2026-09-17 "per Connor (main-only hygiene)").
- [ ] For each open PR, fill the decision row below. Do not leave a
      green, in-policy PR sitting.
- [ ] `git ls-remote --heads origin` — every non-`main` branch either
      has an open PR or is leftover. Leftovers after a squash merge
      are normal; they need Connor's OK to delete (escalation gate).

### 2. PR decision (one row per PR)

| Check | Merge to main | Hold / escalate | Close (after Connor if it is a delete) |
|---|---|---|---|
| CI `test.yml` | success on head SHA | pending, or failed | n/a — fix or close with reason |
| Conflicts | mergeable | conflicted (see conflict rule) | conflicted **and** superseded |
| Risk | visual, content, docs, non-destructive bugfix | auth / payments / RLS / edge fn / migration | abandoned, duplicate, or owner said close |
| Stale | updated in the last ~48h, still wanted | open > ~48h with no CI or no reply | merged-elsewhere leftover |
| Reviews | `AggregateRating` 5.0/7, wall still 4 written quotes | any bump of stars, invented quotes, or a count that is not the current GBP total | fabricated quotes |

**Conflict rule already in use:** auto-resolve only fresh
`docs/specialist-logs/*.md` add/add stub conflicts. A `README.md`
changelog collision is *not* auto-resolvable — rebase, keep both
dated entries, re-run CI. That is how #262 (docs-only, CI green)
sat conflicted and then got closed in a hygiene sweep. Do not
repeat that for wanted work: rebase the changelog and land it.

**Auto-merge:** enable squash auto-merge once `test.yml` is green and
the row says "Merge to main." Do not squash-merge a gate PR.

### 3. After every merge to `main`

- [ ] Confirm `Tests and consistency check` on the merge commit is
      success (push to `main` re-runs it).
- [ ] Confirm `pages build and deployment` succeeded. That is what
      visitors get. Repo listing and a green test run are not the
      live artifact (see README "Read this before touching
      deployment").
- [ ] Confirm `Check links` on `main` if that workflow ran (push to
      `main` plus Wednesday schedule). A PR can merge without it.
- [ ] Confirm the head branch disappeared (`delete_branch_on_merge`).
      If it is still on the remote, queue a Connor-approved delete;
      do not leave squash leftovers to accumulate.

### 4. Scheduled workflows (not merge gates — still watch them)

These can go red after production already shipped:

| Workflow | When | Watcher action on failure |
|---|---|---|
| `test.yml` | every push + PR | block merge; if it failed *on main*, treat as a production incident and open a fix PR |
| `check-links.yml` | push to `main`, Wednesday 10:15 UTC, manual | open a fix PR; do not ignore external 403s on *this* domain |
| `lighthouse.yml` | daily 11:30 UTC, live site only | a11y/SEO `minScore` 0.9 are **errors**; performance 0.75 and best-practices 0.9 are warns. Failures are already in production. Fix forward. |
| `uptime-check.yml` | every 10 min | site down is an incident, not a PR-board item |
| `backup-cms-content.yml` | daily ~09:17 UTC | failed backup is an incident |
| `backup-sensitive-data.yml` | daily ~09:15 UTC | failed backup is an incident (PII) |
| `cleanup-artifacts.yml` | daily 12:00 UTC | low urgency |

Lighthouse hits only `/` and `handyman-hurricane-ut.html`. It does
not cover `/portal/`, `/tools/`, booking, blog, or the other city
pages.

### 5. Hard "do not ship" greps before merge

On the PR diff, fail the merge (or escalate) if any of these changed
the wrong way:

- `aggregateRating` / `"reviewCount"` / `"ratingValue"` — must stay
  `'5.0'` / `'7'` unless Connor confirms a new Google Business Profile
  total. Do not invent Review objects or wall cards.
- `robots.txt` Disallow `/tools/` and `/portal/` must stay.
- `.nojekyll` must remain exactly that filename at repo root.
- `CNAME`, Google Search Console verification HTML, `favicon.ico`
  at repo root — do not delete.
- Stripe / `create-payment-intent` / `stripe-webhook` /
  `verify_jwt: false` — gate.
- RLS policies / `sql/**` migrations — gate. Do not apply live
  migrations from this bot.
- Edge function source under `edge-functions/` — merging the snapshot
  is not the same as deploying. Deploy is a gate. The orphan
  lowercase `send-push` function stays until Connor deletes it in
  the Supabase dashboard (`docs/ACTION-ITEMS.md` item 10).

## What CI actually catches (and what it does not)

Merge-relevant job, `.github/workflows/test.yml`:

1. `npm test` — Node's test runner, 2289 tests as of 2026-09-17
   (`0b0751a`). Static HTML/JS assertions, jsdom, source greps.
2. `npm run check-undefined-vars` — per-page `no-undef` using the
   scripts each HTML file actually loads (57 pages as of that
   commit).
3. `npm run check-consistency` — tools auth/CSP/PWA/precache plus
   tools+portal cache-bust hashes (16 tool pages + 10 portal).
4. `npm run check-visual-snapshot` — **6** jsdom computed-style
   targets in `scripts/visual-snapshot-baseline.json`. Not a
   screenshot, not layout, not mobile.

Gaps that let glitches through (Watcher cannot "test harder" in CI
today; flag them, do not pretend they are covered):

- **No real browser.** jsdom will not catch overflow, sticky-bar
  overlap, iOS zoom, or light-mode hairlines that need pixels.
- **Lighthouse and link-check are not PR gates.** A broken external
  link or an a11y drop can merge at noon and fail the next morning
  on the live site.
- **`check-links.py` `PUBLIC_PAGES` omits** `handyman-st-george-ut.html`
  (in the sitemap), all 5 service pages, `about.html`, `our-work.html`,
  `booking.html`, blog, `terms.html`, `privacy.html`. Internal links
  are still checked on every HTML file. The workflow comment still
  says "6 public pages"; the Python list is 8 city/home files.
- **`eslint.config.js` is not run in CI.** `eslint` is only pulled in
  as a library by `check-undefined-vars.js`.
- **No CI check that `edge-functions/*-index.ts` matches the live
  function**, or that `sql/` matches `supabase_migrations`. Snapshots
  can lag a dashboard deploy (already happened on `Send-Push`).
- **README file-structure tables are stale** (still "5 city landing
  pages", "3 blog posts", "12" sitemap URLs; live sitemap has 30
  locs and no longer lists `portal/login.html`, which `robots.txt`
  Disallows). Agents that trust those counts will miss pages. Prefer
  `sitemap.xml` and `ls` over the README tables. Fixing the tables is
  a docs follow-up, not a Watcher merge.

Known test gotcha (not a product bug):
`tests/workspace/finance-split.test.js` can dirty `service-worker.js`
during a local full-suite run. Isolate before treating a red local
suite as a regression. Real CI installs deps first (`npm install`);
a sandbox without `node_modules` under-counts tests.

## Snapshot vs live backend (Watcher awareness)

- **38 live Edge Functions**, including orphan `send-push` v8.
  Repo has matching `edge-functions/*-index.ts` snapshots for the
  real slugs; README's "six snapshots + five portal functions
  documented only" paragraph is stale.
- **`sql/` is a curated record, not a 1:1 dump of
  `supabase_migrations`.** Live has 75+ named migrations. There is
  no `supabase/migrations/` directory. Do not re-run `sql/` files
  blindly.
- **Private backup** (`.github/workflows/backup-sensitive-data.yml`)
  does not fetch `client_portal_contracts`,
  `client_portal_job_messages`, `referrals`,
  `stripe_pos_charges_logged`, or the relational
  `jobs`/`invoices`/`quotes`/`contracts` tables. `workspace_sync`
  (the JSON blob) *is* backed up; the SQL mirrors can diverge.
  CMS live tables go to `backup-cms-content.yml`. Hand off backup
  coverage to the automation lane; do not "fix" it by merging
  schema.

Silent production failures the Watcher does not own but must not
"close as done" when they appear on the board:
`send-payment-reminder` / `send-quote-followup` crons 401 until
Connor updates the vault secret (`docs/ACTION-ITEMS.md` items 7–9).

## Agent-policy drift to stop

`.claude/skills/tripleh-features/SKILL.md` still told agents to use
regular merge commits. That line must stay aligned with **squash**.
If a field chat opens a PR and asks for a merge commit, correct it.

## Handoffs (not Watcher work)

| Priority | Item | Lane |
|---|---|---|
| P0 | Leftover branch `cursor/ga4-booking-trust-ctas-2cba` (PR #269 squash leftover + a later commit already shipped as #272). Delete after Connor OK. | Watcher + Connor |
| P0 | Re-apply #262's docs close-out (`CLIENT-PORTAL.md` still lists "Remember me" / job-messaging verify) — closed for changelog conflict, not because it was wrong. | Features / Content |
| P1 | Partial payments (#263) — closed on purpose; reopen only as a dedicated schema+deploy change with Connor. | Features + Security |
| P1 | Add `handyman-st-george-ut.html` (and other indexable public pages) to `check-links.py` `PUBLIC_PAGES`; fix the workflow comment. | Bugfix / Automation |
| P1 | Backup `client_portal_contracts` + `client_portal_job_messages`. | Automation |
| P2 | Refresh README file-structure / sitemap / edge-function counts. | Content |
| P2 | Run `eslint.config.js` in `test.yml` (or drop the unused config). | Automation |
| P2 | Orphan `send-push` Edge Function delete. | Connor (dashboard) |

<!-- Add new standing rules above this line. Dated board snapshots go in docs/specialist-logs/reports.md or automation.md, not here. -->
