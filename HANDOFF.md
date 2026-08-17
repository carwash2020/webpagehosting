# Handoff — Triple H Enterprises tool suite

**Written:** 2026-08-17, end of an extended structural-rework session (13 pushes).
**Last commit:** see `git log -1` — should match the tag below.
**Safety checkpoint:** `checkpoint-2026-08-17-post-devtools-split` (git tag) — a known-good rollback point if anything after this needs undoing.

If you're a Claude session picking this project back up, read this first, then `SKILL.md` (in the `tripleh-business` skill) for full history. This file is the short version: what's true right now, what to check before trusting anything, and what's next.

## Verify before doing anything else

Don't trust this document's claims blindly — verify against the live repo, same discipline used throughout this whole project:

```bash
npm test                        # should show 94/94 passing
node scripts/check-consistency.js   # should show 14 pages, clean
```

Check the actual GitHub Actions status for the latest commit before assuming CI is green — local-clean is not the same as CI-clean (this bit Push 9 for real: a test made genuine network calls that behaved differently in the sandbox vs. the real CI runner).

## Current architecture, in one paragraph

`tools/job-tracker.html` is jobs/contacts/notes only. `tools/finance.html` has Cost Lookup/Profitability/Income/Expenses (split out of Job Tracker in Push 4). `tools/dev-tools.html` has Diagnostics/Access/Data/Deploy. `tools/site-content.html` has Site Content/FAQ/Terms editing (split out of Dev Tools in Push 13). The old `tools-common.js` is gone — replaced by `tools-effects.js`/`tools-dialogs.js`/`tools-media-sharing.js`/`tools-nav-pwa.js` (Push 9). The old combined `styles.css` is now just the public site's CSS plus shared tokens; tool-suite CSS lives in `tools/styles-tools.css` (Push 10). `data-layer.js` is the shared read/write path with a real client registry (`clientId`s, backfill migration). Every shared file's cache-bust `?v=` param must match across every page that loads it — the consistency checker catches drift, but it's worth knowing why that check exists.

## The single most important lesson from this whole session

**When splitting a file into pieces, the pieces are almost never as separable as the visual/HTML structure suggests.** Every real split in this project (Job Tracker in Push 4, Dev Tools in Push 13) found functions that *looked* like they belonged to one section but were actually called from somewhere else entirely — and in Dev Tools' case, an automated call-graph analysis actively lied about this (flooded everything with "belongs everywhere" because one shared hub function contaminated the whole propagation). The fix both times was the same: extract with real boundary detection (brace-counting, not eyeballing), then do an *exhaustive* scan for dangling references afterward — including checking for module-level variables sitting near a function that a name-based extraction wouldn't catch, and checking for bare top-level statements that aren't inside any named function at all (that specific class of bug caused Push 4's dead code to sit silently broken until Push 12 found it, three pushes later).

## What's still open, roughly in priority order

1. **Namespacing the ~36 flat localStorage keys**, and giving synced data real schema versioning. Parts Reference alone has 31 sequential migration functions (`upgradePrSeedV2IfNeeded` through `V31`) as a live example of the cost of not having this from the start.
2. **Unifying quote and invoice into one data model** with a real status field, rather than two similar-but-separate shapes.
3. **A comprehensive soft-delete/trash system** beyond jobs (Push 12 only covered jobs, deliberately scoped down from the full version).
4. **Shared UI components** (list-row, form-section, table) — every page still implements its own version of these.
5. **Splitting Dev Tools further** (Diagnostics/Access/Data/Deploy into separate pages) was considered and declined — no clean, evidence-backed boundary the way Content had. Don't attempt this without first doing the same call-graph-by-hand analysis Push 13 did, and expect it might not be worth doing at all.
6. **Reconsidering the bottom nav**, splitting Business Health's 3 unrelated tabs, making the Wiki search-first by default — all flagged early in this project, never revisited.

## Don't re-litigate these (already decided, with reasons)

- Runway Dashboard stays self-contained (no shared script dependencies) — deliberate, not an oversight.
- The "Pull Month" feature on Runway Dashboard already solves cross-referencing itemized records into manual monthly totals — don't rebuild this.
- job-cost-lookup.html/expense-logger.html/contact-card.html stay as redirect stubs, not deleted — old bookmarks matter.
- Soft-delete is deliberately jobs-only for now, not comprehensive — the Supabase photo-cleanup irreversibility made a full trash system meaningfully more complex for the same core value.
