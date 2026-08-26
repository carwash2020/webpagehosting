# Architecture notes: backlog, lessons, and settled decisions

Carried forward from an earlier hands-off summary (originally
`HANDOFF.md`, written 2026-08-17) -- the parts of it that are still
genuinely true and useful, after retiring the parts that had simply
gone stale (a test count, a since-superseded checkpoint tag). For
day-to-day orientation, start at `docs/GETTING-STARTED.md` instead;
this file is for the backlog and the reasoning behind decisions
already made, not a first read.

## The single most important lesson from splitting files in this project

**When splitting a file into pieces, the pieces are almost never as
separable as the visual/HTML structure suggests.** Every real split in
this project's history found functions that *looked* like they
belonged to one section but were actually called from somewhere else
entirely -- in one case, an automated call-graph analysis actively
lied about this (flooded everything with "belongs everywhere" because
one shared hub function contaminated the whole propagation). The fix
was the same each time: extract with real boundary detection
(brace-counting, not eyeballing), then do an *exhaustive* scan for
dangling references afterward -- including module-level variables
sitting near a function that a name-based extraction wouldn't catch,
and bare top-level statements that aren't inside any named function at
all (that specific class of bug caused one real split's dead code to
sit silently broken for several pushes before it was found).

## What's still open, roughly in priority order

1. **CI's Node version (`.github/workflows/test.yml`) will need a
   manual bump again someday.** Currently pinned to 24 (Active LTS
   through ~April 2028) after Node 20 was found to have quietly gone
   end-of-life while CI kept using it (2026-08-26). A bare major-
   version pin is deliberate, not a compromise: `lts/*` looked like
   it would solve this automatically, but real, documented bugs in
   `actions/setup-node` (confirmed via its own GitHub issues) show it
   can resolve to a stale LTS line even with `check-latest: true`. No
   good way to fully automate this away -- the realistic plan is
   revisiting this pin roughly every 2 years, the same way it was
   just fixed this time.

2. **Namespacing the many flat `localStorage` keys**, and giving
   synced data real schema versioning. The Appliance Wiki's own
   sequential migration functions (`upgradePrSeedV2IfNeeded` and
   successors) are a live example of the cost of not having this from
   the start.
3. **Unifying quote and invoice into one data model** with a real
   status field, rather than two similar-but-separate shapes. (Note:
   delete was added to both independently, 2026-08-26, each with its
   own tombstone from day one -- worth remembering if this
   unification ever actually happens, so the tombstone logic gets
   merged correctly rather than duplicated or dropped.)
4. **Shared UI components** (list-row, form-section, table) -- every
   page still implements its own version of these.
5. **Splitting Dev Tools further** (Diagnostics/Access/Data/Deploy
   into separate pages) was considered and declined -- no clean,
   evidence-backed boundary the way Site Content had when *it* was
   split out. Don't attempt this without first doing the same
   call-graph-by-hand analysis that split did, and expect it might not
   be worth doing at all.
6. **Reconsidering the bottom nav**, splitting Business Health's
   unrelated tabs, making the Appliance Wiki search-first by default
   -- all flagged early in this project, never revisited.

## Don't re-litigate these (already decided, with real reasons)

- Runway Dashboard stays self-contained (no shared script
  dependencies) -- deliberate, not an oversight.
- The "Pull Month" feature on Runway Dashboard already solves
  cross-referencing itemized records into manual monthly totals --
  don't rebuild this.
- `job-cost-lookup.html`/`expense-logger.html`/`contact-card.html`
  stay as redirect stubs, not deleted -- old bookmarks matter.
- The Graveyard (added 2026-08-26) intentionally does NOT cover a
  deleted expense's attached receipt photo -- that file is removed
  from cloud storage immediately, before the graveyard could ever
  help. This is a stated, accepted limit, not a gap to close later.
