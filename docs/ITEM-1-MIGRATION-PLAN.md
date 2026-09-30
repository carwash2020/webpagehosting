# Item 1 Migration Plan — Workspace off the localStorage blob, onto relational tables

Status: DRAFT for review. Drafted 2026-09-30.
Parent: `docs/SCALE-AND-SAAS-ROADMAP.md`, Part 1, item 1.

This is the plan for the real project in the roadmap. Items 2–6 (SQL aggregates, N+1 client search, pagination, indexes, `slice()` cleanup) all depend on it. Index DDL is intentionally **not** in this document. Indexes get designed in Phase 2 from the query shapes defined there, not guessed ahead of time.

---

## Scope

**In scope**
- Jobs, invoices, quotes, contracts, expenses, and income: relational tables become the source of truth (expenses and income added by decision 1, 2026-09-30).
- A single unified `clients` entity with a real primary key, referenced by FK from jobs, invoices, quotes, and contracts. Job Tracker's Contacts list (`th_tracker_contacts`) is mostly clients and merges into it (decision 1).
- An offline outbox so field writes survive no-signal job sites.
- Backfill, reconciliation, per-entity read cutover, and a freeze of the old blob path.

**Explicitly out of scope**
- Anything from roadmap Part 2 (multi-tenant signup, hosting, branding extraction).
- The public marketing site.
- Settings-style keys (tax rate, mileage rate, UI state). These stay in `sync.js` blob sync unless Phase 0 finds a reason to move them.

---

## Current state (confirmed)

- **Blob sync.** Every Workspace entity lives in localStorage and syncs as one JSON blob via `tools/sync.js` → `workspace_sync (code text pk, data jsonb)`. It uses a whole-blob 3-way merge on push.
- **Dual-write already exists.** `job-tracker.html`'s `saveJobs()` calls `mirrorJobsToRelational()` in `tools/sync.js` on every save and on both delete paths. That function does `POST /rest/v1/jobs` with `Prefer: resolution=merge-duplicates,return=minimal`. The same pattern exists for invoices, quotes, and contracts.
  - Fire-and-forget: it never throws, never retries, and never logs a failed fetch.
  - So the write side exists, but its completeness is **unknown**. Anything from before the mirror existed, or anything it silently missed, is not in the relational tables.
- **Relational readers already exist for jobs.** `calendar.html` and `route-planner.html` read via `fetchJobsFromRelational()` / `startJobsRealtime()`. The confirmation-email and `manage-job.html` flows run on `public.jobs`. This means **mirror gaps are already user-visible today.** A job the mirror dropped is missing from the calendar and route planner.
- **Three unreconciled client-identity systems:**
  1. `client_profiles`: Supabase table, portal-facing, keyed by email.
  2. `thEnsureClient()` / `thFindClientByName()` in `tools/data-layer.js`: name-text matching, generates a throwaway id, stored only in localStorage.
  3. Free-text `client` / `clientName` fields on job, invoice, and quote records. Client History, follow-up reminders, and returning-client detection all key on these.
  - Two people typing a name slightly differently already creates two "clients" silently.
- **Tier 0 RLS is live** on every business table (`tenant_id`, `current_tenant_id()`).

---

## Principles

1. **One entity at a time.** Every phase that touches reads or writes goes jobs → invoices/quotes → contracts → expenses/income. Never all at once.
2. **Nothing fails silently.** Every write path added or touched in this migration must surface failure somewhere a human will see it. This is the single biggest lesson from the current mirror and from the two prior upsert bugs.
3. **Preserve existing IDs.** Blob record IDs become relational primary keys, or they are carried in a unique `legacy_id` column. `th_job_photos.job_id`, invoice→job links, referral records, and `manage-job.html` tokens all reference them.
4. **Explicit conflict targets.** Every upsert names its constraint (`?on_conflict=...`). No relying on PostgREST's default.
5. **Flag decisions for humans; never auto-merge.** This matches the app's existing pattern (Gallery Queue, recurring templates). It applies to client dedup and to write conflicts.

---

## Phase 0 — Inventory and mirror audit

The goal is to know exactly what exists and how far the relational tables have already drifted, before changing anything.

**0a. Key classification.** Classify every `SYNC_DATA_KEYS` / `ALL_SYNCED_KEYS` entry as one of:

| Class | Meaning | Likely members (verify) |
|---|---|---|
| Migrate | Growing row data, becomes relational | `th_tracker_jobs`, `th_invoices`, `th_quotes`, contracts key, `th_expense_log`, `th_income_log`; `th_tracker_contacts` merges into `clients` |
| Stays as settings | Small config, blob is fine | `th_tax_rate`, `th_tax_labor`, `th_tax_parts`, `th_mileage_rate` |
| Stays in the blob | Row-ish but small, no queries or joins (decision 6) | `th_tracker_notes_v2`, `th_job_templates`, `th_compliance`, `th_known_issues` |
| Retire | Dead or UI-only | `th_dash_collapsed`, `th_sync_code`, `th_sync_last` |

Decided 2026-09-30: expenses and income migrate (they are money records linked to jobs, and Job Profitability shouldn't mix relational revenue with blob costs). Contacts are mostly clients, so they merge into `clients` in Phase 1 instead of getting their own table. Notes, job templates, compliance, and known issues stay in the blob; a template that names a client stores its `client_id` from Phase 3.5 on.

**0b. Reader/writer census.** Grep every `localStorage.getItem('th_…')` / `setItem` for migrated keys and list each call site with page and function. This list is the checklist for Phase 4. Any call site missing from it is a page that silently keeps reading stale local data after cutover.

**0c. Field mapping.** For each migrated entity, map blob record shape → table columns. Note:
- Fields in the blob with no column, and columns never populated by the mirror.
- Known-bad legacy data. Invoices logged before the date-input fix have long-format date strings (e.g. "July 29, 2026") that parse as `Invalid Date`. These need a conversion rule, or a manual-review list.
- Money fields. Target `numeric(12,2)`. Record current JS representation (float) and rounding behavior.

**0d. Mirror audit (fix before relying on it).**
- Verify what `resolution=merge-duplicates` resolves against. Without `on_conflict` it uses the primary key. That is correct only if the PK *is* the preserved blob id. If the PK is a generated uuid, the mirror is inserting duplicates or failing on a unique constraint, which is the same class as the 2026-09-13 `notification_log` bug.
- Verify `tenant_id` is populated on mirrored rows, whether by column default or explicitly. If it isn't, RLS would hide those rows.
- Change the mirror to **record failures**: at minimum a persisted `th_mirror_failures` log plus a visible indicator next to the existing sync-status line. Retries come later with the outbox (Phase 3); visibility comes now.

**0e. Drift report.** Build a read-only reconciliation script comparing blob and relational per entity:
- Row counts.
- IDs present on one side only.
- Field-level diffs on shared IDs.
- Money totals to the cent: invoice totals, paid vs unpaid sums.

Run it now to get a baseline, then after each later phase. It is the same tool Phase 4 uses for backfill sign-off.

**Exit criteria:** classification table agreed; census complete; mirror failures visible; baseline drift report produced and understood.

---

## Phase 1 — Unified `clients` table

This is real new schema, not a column added to an existing table.

**1a. Schema.**
- New `clients` table: `id uuid pk` (this is the `client_id` every other table references), `tenant_id`, `display_name`, one email and one phone (decision 2), normalized match columns (lowercased/trimmed name, digits-only phone, lowercased email), `created_at`, `updated_at`, `merged_into_id` (nullable, for tracing merges).
- `client_profiles` stays the portal *account* table and gains `client_id` FK → `clients`. A portal login is not the same thing as a client record; one client may have zero or several portal accounts.
- Jobs, invoices, quotes, contracts gain a nullable `client_id` FK. It becomes `NOT NULL` only after backfill and dedup are complete.
- One email and one phone per client (decision 2, 2026-09-30). No contact-points child table.

**1b. Seeding and dedup.**
- Seed candidates from four sources: `client_profiles` rows, local `thEnsureClient` records (collected via the Phase 4 device checklist or the blob), Job Tracker contacts (`th_tracker_contacts`), and distinct free-text client names on existing rows.
- A contact that turns out not to be a client (a supplier or another trade) is marked "not a client" in the review queue and stays in the blob contact list.
- Generate **candidate** duplicate groups by normalized email, phone, and name. Do not auto-merge.
- Build a small review queue in `tools/clients.html`: merge / keep separate / edit. A merge repoints every FK and sets `merged_into_id`.
- Backfill `client_id` on existing rows from the reviewed mapping. Rows that can't be confidently matched stay null and go on a review list.

**1c. (Moved.)** Switching `thEnsureClient()` / `thFindClientByName()` to the unified server lookup now happens in **Phase 3.5**, after the outbox exists. Until then, entry keeps using the current local identity path. Phase 1 is server-side only, so it can ship early without affecting offline behavior.

**Exit criteria:** `clients` live; review queue worked through; `client_id` populated on all rows except a known, listed remainder. (Entry-time lookup is Phase 3.5's exit criterion, not this one.)

---

## Phase 2 — Data-access seam and query shapes

`tools/data-layer.js` already exists and is the natural home.

**2a. One module per entity** with a fixed interface:
- `list(filters, cursor)`, `get(id)`, `create(row)`, `update(id, patch, baseUpdatedAt)`, `remove(id)`.
- Pages call only this. No page touches localStorage keys or REST endpoints for migrated entities directly after this phase.
- Initially the seam is backed by the current localStorage path, so page behavior does not change. Swapping the backing store per entity is what Phase 5 flips.

**2b. Enumerate every query shape** the pages need, per entity. Example for jobs (verify against the census): by status, due within N days and not done, date range, by `client_id`, by job id list, recent N. Example for invoices: unpaid, overdue (derived from date + terms), date range, by `client_id`, by `job_id`, recent N.

**2c. Pagination contract.** All `list()` calls are keyset-paginated on `(created_at, id)`, or on `(date, id)` where the page sorts by business date. The default page size is 50. There is no offset pagination anywhere.

**2d. Index design comes from this list.** Every `list()` filter plus sort becomes an index candidate. Each leads with `tenant_id`, since RLS adds it to every query, for example `(tenant_id, status, created_at)`. This is the input to roadmap item 5, and it's the first point at which writing index DDL makes sense.

**Exit criteria:** every census call site routed through the seam with no behavior change; query-shape list reviewed; index DDL drafted from it (tracked under item 5).

---

## Phase 3 — Offline outbox

The goal is to keep offline writes without keeping localStorage as the source of truth.

**3a. Storage.** Use IndexedDB, not localStorage, for the outbox and the local read cache. localStorage's size cap and synchronous API are part of what's being moved away from.

**3b. Outbox record.** Each record holds: `op_id` (uuid, client-generated), `entity`, `row_id`, `op` (create/update/delete), `payload`, `base_updated_at`, `queued_at`, `attempts`, `last_error`.

**3c. Client-generated UUIDs for new rows.** An offline-created job needs a real id immediately. Otherwise an invoice linked to it offline has nothing to reference. Server tables must accept client-supplied ids for create.

**3d. Drain.**
- FIFO, one op at a time, triggered on reconnect, page load, and a periodic timer.
- Idempotent by `op_id`, either via an `applied_ops` table or an upsert keyed on row id with an explicit `on_conflict`, so a retried op never double-applies.
- Failures are persisted and visible: a count badge and a list. Nothing is dropped silently.

**3e. Conflicts.**
- Updates carry `base_updated_at`. The server applies only if it still matches, e.g. `PATCH ...?id=eq.X&updated_at=eq.Y`, where zero rows affected means conflict.
- A conflict produces a **conflict record** shown to a human with both versions, never a silent last-write-wins. At current volume this should be rare; the point is that it's never invisible.
- Deletes become soft deletes (`deleted_at`) during the migration, so an offline edit to a row someone else deleted is detectable instead of resurrecting it or vanishing.

**3f. Offline invoice/quote numbering (decision required).** `next_invoice_number()` / `next_quote_number()` are server-side and reject non-internal callers. An invoice created offline can't get its real number. That matters because the PDF prints the number. Options:
- (a) Block invoice/quote *generation* offline and allow draft only.
- (b) Pre-allocate a small block of numbers per device while online.
- (c) Use a provisional number on offline PDFs, reissued on drain.

Option (a) is simplest and probably sufficient, but this needs Steve's input on how often he invoices on-site with no signal.

**3g. Offline reads.** The seam serves the last-fetched pages from the IndexedDB cache when offline, marked as possibly stale in the UI. The cache must also hold the tenant's **client list** (id, display name, normalized match columns). Phase 3.5 relies on it to pick existing clients offline.

**Exit criteria:** outbox proven with forced-offline tests (create job offline → create linked invoice offline → reconnect → both land, FK intact); conflict path demonstrated; numbering decision made and implemented.

---

## Phase 3.5 — Client lookup cutover

This was Phase 1c. It depends on 3a–3d (IndexedDB outbox, client-generated UUIDs, idempotent drain) and on the 3g client cache, so it cannot ship before them. This resolves open decision #7.

`thEnsureClient()` / `thFindClientByName()` switch from local name-text matching to the unified `clients` table, with four paths:

- **Online:** server lookup-or-create against `clients`. A typed name offers matching existing clients before creating a new one.
- **Offline, existing client:** match against the 3g cached client list, so selecting a known client still works with no signal.
- **Offline, new name:** create the client with a client-generated UUID and `needs_match = true`, queued through the outbox. Jobs and invoices created in the same offline session reference it by FK immediately.
- **On drain:** after the client-create op applies, run the Phase 1b candidate matching against the new row. Any hits go to the existing Phase 1b review queue. A merge repoints FKs and sets `merged_into_id`, the same as any other merge. `needs_match` clears when the row is reviewed or has no candidates.

An offline create cannot dedup against the server, so the outbox alone would faithfully create duplicates. This design never blocks offline entry, and it catches duplicates for a human decision on reconnect instead of letting them pile up silently.

Also in this phase: Client History, follow-up reminders, returning-client detection, and the referral nudge move from name-text matching to `client_id`.

**Schema addition** (to the Phase 1a `clients` table): `needs_match boolean not null default false`.

**Exit criteria:**
- Online create of a name close to an existing client offers the existing match before creating.
- Offline selection of an existing client from cache produces a correct `client_id` FK after drain.
- Forced-offline test: create a new client with a near-duplicate name → create a job and a linked invoice for it → reconnect → all three land with FKs intact, **and the new client appears in the review queue as a candidate duplicate.**
- Merging it from the queue repoints the job and invoice to the surviving client.
- No remaining call sites use the local name-text identity path.

---

## Phase 4 — Device checklist, backfill, freeze

This is the operationally dangerous phase. Unsynced edits on any device are orphaned the moment the blob goes read-only, so it runs as a checklist, not a reminder.

**4a. Device checklist.** Do this first, and fill in the table.

| Device / browser | Owner | Opened Job Tracker + Invoice Generator | "Last push" timestamp after a test edit | Outbox empty | Other open tabs closed | Signed off (time) |
|---|---|---|---|---|---|---|
| | | | | | | |

On each device:
1. Open every Workspace page that writes a migrated key.
2. Make a trivial test edit and confirm the passive "Last push/pull to cloud" line updates.
3. Confirm the mirror-failure log (Phase 0d) is empty.
4. Close all other Workspace tabs on that device.

Every device that has ever been used must appear in the table, including old laptops and the phone's second browser. The old manual-sync-code bug showed that one forgotten device can be silently writing to its own silo.

**4b. Snapshot.** Take a Full Backup JSON download *and* a SQL copy of the `workspace_sync` row, timestamped. This is the recovery point.

**4c. Freeze at the server, not just the client.** Stale tabs with old cached `sync.js` can keep pushing after new code ships.
- Add a trigger on `workspace_sync` that rejects changes to migrated keys after the freeze timestamp and logs each attempt: time, and whatever identifying info the push includes.
- Any logged attempt means a device was missed. Recover its data from the rejected payload in the log, which requires logging the payload.
- Bump cache-bust stamps so fresh loads get the new code.

**4d. Backfill.**
- Idempotent upsert from the frozen blob into relational tables, preserving ids, with explicit `on_conflict`.
- Apply the Phase 0c conversion rules (legacy dates, money to `numeric`), and the Phase 1 `client_id` mapping.
- Rows that fail conversion go to a review list, not the floor.

**4e. Sign-off.** Run the Phase 0e reconciliation script. Required result: zero IDs on one side only, zero unexplained field diffs, money totals match to the cent. Any remaining diffs are individually explained in writing.

**Exit criteria:** checklist fully signed; snapshot stored; freeze trigger live with zero rejected-write log entries for at least one full working day; reconciliation clean.

---

## Phase 5 — Read cutover, per entity

- Per-entity flag in the seam: `jobs`, then `invoices`+`quotes` together (Convert-to-Invoice links them), then `contracts`, then `expenses`+`income` together (both are ledger entries with the same job link).
- Jobs goes first. Calendar and route planner already read it, so the relational path is already exercised in production.
- Once flipped, that entity's writes go through the outbox to the relational tables. Its mirror call and blob key are removed for that entity.
- Monitor after each flip: outbox drain failures, conflict records, freeze-trigger rejections, and a daily run of the reconciliation script (now relational vs the frozen snapshot plus expected new rows).

### Rollback: a one-way door

Rollback is only real **before the first post-cutover write** to an entity. With the outbox, that write can happen within minutes, possibly queued offline before anyone notices a problem.

After that point, flipping the read flag back means either:
- building a reverse-sync (relational → blob) path that does not exist, or
- accepting loss of everything written since cutover.

So:
- Treat each entity's cutover as a **short, actively monitored window** (length to agree in review, e.g. the first working day), not a standing safety net.
- The go/no-go decision happens *before* the flip, based on Phase 3 and Phase 4 exit criteria, not after.
- Past the window, problems are fixed forward on the relational side.

**Exit criteria:** all migrated entities flipped; one full week with zero unexplained reconciliation diffs, zero undrained outbox failures older than a day, zero unresolved conflict records.

---

## Phase 6 — Cleanup

- Remove the dead localStorage paths and `mirror*ToRelational()` functions for migrated entities.
- `sync.js` keeps settings-class keys only.
- Tighten `client_id` to `NOT NULL` once the Phase 1 remainder list is empty.
- Decide whether soft deletes stay permanently or get purged.
- Remove the `workspace_sync` freeze trigger only after a deliberate decision, since it's cheap insurance.
- Update `DISASTER-RECOVERY-REBUILD-GUIDE.md`: Full Backup/Restore currently exports localStorage keys and will no longer capture the real data. It needs a relational export equivalent.
- Update the roadmap and the project skill.

---

## Open decisions (resolve in review)

1. ~~Expenses and contacts: in item 1 scope, or a follow-on?~~ **Resolved (2026-09-30):** expenses and income are in scope and migrate last; contacts are mostly clients and merge into `clients`.
2. ~~Clients: single email/phone per client now, or a contact-points child table from the start?~~ **Resolved (2026-09-30):** one email and one phone per client, plus the new `client_id`.
3. Offline invoice/quote numbering: option (a), (b), or (c) in 3f. Needs Steve's input on on-site invoicing frequency.
4. Cutover monitoring window length per entity.
5. Soft deletes: permanent, or purge after N days?
6. ~~Notes, job templates, compliance, known issues: stay in the blob, or migrate in a later pass?~~ **Resolved (2026-09-30):** they stay in the blob.
7. ~~Client lookup cutover sequenced before the outbox leaves no offline path for new clients.~~ **Resolved:** moved from Phase 1c to Phase 3.5, after the outbox; offline new-client creates are flagged `needs_match` and routed to the review queue on drain.

## How this unblocks the rest of the roadmap

| Roadmap item | Unblocked by |
|---|---|
| 5. Indexes | Phase 2 query-shape list |
| 3. N+1 client search | Phase 1 `clients` table + Phase 2 seam (one RPC behind `clients.list()`); entry-time lookup lands in Phase 3.5 |
| 4. Pagination | Phase 2 keyset contract, live per entity at Phase 5 |
| 2. SQL aggregates | Phase 5; dashboards read server-computed views instead of reducing arrays |
| 6. `slice()` cleanup | Phase 5, page by page |
