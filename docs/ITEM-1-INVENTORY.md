# Item 1 inventory (Phase 0a–0c)

The Phase 0 inventory for `docs/ITEM-1-MIGRATION-PLAN.md`. Taken 2026-09-30 from the code on `main` (after carwash2020/webpagehosting#487) and read-only queries against the live `workspace_sync` row (`tripleh-workspace-2026`) and schema. The live queries returned counts, field names, types and date formats only; no client data.

- **Regenerate the census** (section 2) with `node scripts/item1-census.js`. It is the checklist for the Phase 4 device checklist and the Phase 5 cutover, so re-run it before each of those.
- "unverified" means the code alone couldn't confirm it (runtime behavior, other devices' local data).

Contents:
1. [Key classification](#1-key-classification)
2. [Reader/writer census](#2-readerwriter-census), including [name-text client matching](#22-places-that-match-clients-by-name)
3. [Field mapping](#3-field-mapping-blob-to-relational), including dates, money and ids
4. [Tombstones and how deletes propagate](#4-tombstones-and-how-deletes-propagate)

---

## Summary for review

### Size of the live data (2026-09-30)

| Entity | Blob records | Relational rows |
|---|---|---|
| Jobs | 9 | 9 |
| Invoices | 4 | 4 (after the Phase 0 backfill) |
| Quotes | 0 | 0 |
| Contracts | 1 | 1 |
| Expenses | 2 | no table |
| Income | 6 | no table |
| Contacts | 1 | no table |
| Clients (`th_clients`) | 9, plus 18 client tombstones | no table |
| `client_profiles` (portal accounts) | n/a | keyed by `client_email`, no id column |

The census found **208 direct call sites** and **42 shared helpers** (in `data-layer.js` / `sync.js`) that read or write a migrated key, and about **40 places** that match a client by name text.

### Decisions needed before Phase 1

These came out of the inventory. Each has a recommendation.

1. **The `client_id` column name is already taken.** `jobs`, `invoices` and `quotes` already have a `client_id text` column holding the old local registry ids (`'c_…'`). The plan's new `client_id uuid` FK can't use that name as is.
   - **Recommendation:** rename the existing column to `legacy_client_id`, add `client_id uuid references clients(id)`, and give `clients` a `legacy_id text unique` so the backfill can join old ids to new rows. Contracts have no client column today; add both there too.
2. **Client address.** Every registry client stores an address, and jobs and invoices do too. The plan's `clients` table has no address column, so it would be lost.
   - **Recommendation:** add an `address` column (one, like email and phone).
3. **Contacts' `role` and `notes`.** Contacts carry a role (for example "supplier") and notes. `role` is the best signal for "not a client" in the review queue.
   - **Recommendation:** show `role` in the review queue and keep it and `notes` on the client row as `notes` text.
4. **Invoice-generated income rows.** Every invoice writes a matching income entry (`origin: 'invoice'`), and every reader already filters them out.
   - **Recommendation:** don't migrate them as rows; the invoice is the source of truth. Migrate manual and card-reader (`origin: 'pos'`) income only.
5. **Five more synced keys weren't covered by decisions 1 and 6:** parts inventory (`th_inventory`), price reference (`th_price_reference`), shift log (`th_shift_log`), review requests (`th_review_requests_*`), and Runway's personal budget (`rd_*`).
   - **Recommendation:** all stay in the blob, for the same reasons as decision 6 (small, few queries, no joins). Runway's data is personal, not business, and should not move into business tables.
6. **Ids for records created offline (needed by Phase 3, flagged now).** Every table's id is a `bigint` made from `Date.now()`, and many other tables reference them as `bigint` (portal copies, referrals, bookings, photos). The plan's Phase 3c says client-generated **UUIDs**.
   - **Recommendation:** keep `bigint` ids and mint them on the device with a collision-safe scheme (for example milliseconds plus a random suffix), rather than converting every table and reference to UUIDs. Contracts must stop using `max(id)+1`, which two offline devices would both mint. (No duplicate contract ids exist today.)

### Schema facts the later phases depend on

- **Money columns are unconstrained `numeric`**, not the plan's `numeric(12,2)`. Two legacy invoice totals aren't whole cents. The Phase 4 backfill should `round(x, 2)` into `numeric(12,2)`.
- **Business dates are `text` columns** (`job_date`, `invoice_date`, `quote_date`, `date_generated`). They should become `date` using the conversion rule in section 3.8.
- **No `updated_at` trigger exists** on jobs, invoices, quotes or contracts, so `updated_at` never changes after the first insert. Phase 3's conflict detection compares `updated_at`, so it needs a trigger first. `created_at` is the time of the first mirror, not when the record was made; for `Date.now()` ids the real creation time is `to_timestamp(id / 1000.0)`.
- **No `deleted_at` column exists yet.** Deletes are hard deletes today (section 4.6).
- **Server-only job columns** (`cancel_token`, `cancelled_at`, `reschedule_requested_*`, `confirmation_sent_at`) are written by the manage-job flow and edge functions and never flow back into the blob. The Phase 4 backfill must not overwrite them.

### Bugs found (not fixed in this PR)

These are real defects the inventory turned up. None is fixed here, to keep this PR to the inventory. I tried to queue the first two as separate tasks, but the request timed out, so they may not exist yet.

| Bug | Where | Effect |
|---|---|---|
| **Fixed 2026-10-01:** Full Backup covered only 17 of the 49 synced keys (now reads `SYNC_DATA_KEYS` + `WIKI_SYNC_KEYS`, 52 keys) | `tools/dev-tools.html` `ALL_SYNCED_KEYS` (~1636) vs `tools/sync.js` `SYNC_DATA_KEYS` | A restore would lose the client registry, every tombstone (deleted records would come back), review requests, the shift log and Runway's data. |
| **Fixed 2026-10-01:** Contracts never added contact details to the client record (now read through `thContractClientDetails()`) | `contract-generator.html:1081`, `data-layer.js:530` read `clientPhone`/`clientAddress`/`clientEmail`; the real keys are `phone`/`serviceAddress`/`email` | Client records made from a contract have no phone, address or email. |
| **Fixed 2026-10-01:** Returning clients could get the first-time discount (now `thClientHistory()`) | `finance.html:724` `checkClientHistory` (exact name match) | A returning client typed with a different spelling ticks "First-time client, apply discount". |
| **Fixed 2026-10-01:** Bulk job delete left the portal copy (both deletes now call `removeJobFromPortal()`) | `job-tracker.html` `bulkDeleteJobs` (single delete does remove it) | Clients can still see deleted jobs in the portal. |
| A stale device can bring a deleted job back into `public.jobs` | `mirrorJobsToRelational` upserts the whole local jobs list | The calendar can show a deleted job. Already a known Phase 3 gap. |
| **Fixed 2026-10-01:** Card payments could flip back to unpaid (webhook now sets `paidAmount` and updates `public.invoices`) | `stripe-webhook-index.ts:401-404` sets only `paid = true` | If the invoice was ever marked unpaid (`paidAmount: 0`), the next sync recomputes `paid` from `paidAmount` and shows it unpaid. |
| Tombstones never expire | `thPruneTombstones` runs locally; the union merge restores pruned entries from the server | The lists grow forever (small, but unbounded). |
| **Fixed 2026-10-01:** Online-booking jobs aren't mirrored (now mirrored on conversion, and the booking's referral is kept) | `workspace.html:3139-3157` writes localStorage directly | The job reaches `public.jobs` only when some other job is saved. |
| Follow-up reminders match by case-sensitive name | `workspace.html` `renderFollowups`, `send-push-index.ts` `checkFollowups` | A client who came back under a different spelling still shows as overdue for a follow-up. |

---

## 1. Key classification

Every key in `SYNC_DATA_KEYS` (`tools/sync.js:112`, 49 keys) and `WIKI_SYNC_KEYS` (`sync.js:105`, 3 keys). Decisions 1, 2 and 6 were made on 2026-09-30; rows marked **(proposed)** need confirming (decision 5 above).

A tombstone key goes wherever its data key goes. For migrated entities, Phase 3 replaces the tombstone with a `deleted_at` column (section 4).

| Key | What it is | Records now | Class |
|---|---|---|---|
| `th_tracker_jobs` + `th_job_tombstones` | Jobs | 9 | **Migrate** (`public.jobs`) |
| `th_invoices` + `th_invoice_tombstones` | Invoices, with `line_items` | 4 | **Migrate** (`public.invoices`, `invoice_line_items`) |
| `th_quotes` + `th_quote_tombstones` | Quotes, with `line_items` | 0 | **Migrate** (`public.quotes`, `quote_line_items`) |
| `th_contracts` + `th_contract_tombstones` | Generated contracts | 1 | **Migrate** (`public.contracts`) |
| `th_expense_log` + `th_expense_tombstones` | Business expenses and mileage | 2 | **Migrate**, last (decision 1). New table. |
| `th_income_log` + `th_income_tombstones` | Income entries (manual, invoice-generated, card reader) | 6 | **Migrate**, last (decision 1). New table; see decision 4 above. |
| `th_clients` + `th_client_tombstones` | Local client registry (`thEnsureClient`) | 9 | **Migrate** into `clients` (Phase 1 seed source) |
| `th_tracker_contacts` + `th_contact_tombstones` | Job Tracker contacts, mostly clients | 1 | **Merge into `clients`** (decision 1). A contact marked "not a client" stays in the blob. |
| `th_tracker_notes_v2` + `th_note_tombstones` | Free-text notes | 1 | Stays in blob (decision 6) |
| `th_job_templates` + `th_template_tombstones` | Recurring job templates | 0 | Stays in blob (decision 6); stores `client_id` from Phase 3.5 |
| `th_compliance` | Insurance and business-registration details (one object) | 1 | Stays in blob (decision 6) |
| `th_known_issues` + `th_known_issue_tombstones` | Dev Tools known-issues list | 2 | Stays in blob (decision 6) |
| `th_tax_rate`, `th_tax_labor`, `th_tax_parts` | Tax settings | — | Settings (stays) |
| `th_mileage_rate` | Mileage rate | — | Settings (stays) |
| `th_setaside_rate` | Tax set-aside percentage | — | Settings (stays) |
| `th_inventory` + `th_inventory_tombstones` | Parts on hand | 0 | Stays in blob **(proposed)** |
| `th_price_reference` + `th_price_ref_tombstones` | Price reference list | 0 | Stays in blob **(proposed)** |
| `th_shift_log` + `th_shift_tombstones` | Start/End-my-day shift punches | 1 | Stays in blob **(proposed)** |
| `th_review_requests_pending` + `_tombstones`, `th_review_requests_log` | Review-request queue and sent log | 0 / 4 | Stays in blob **(proposed)** |
| `rd_personal-expenses`, `rd_personal-income`, `rd_budget-settings`, `rd_business-months`, `rd_emergency-fund`, `rd_debts` | Runway's personal budget (not business data) | small | Stays in blob **(proposed)** |
| `th_client_errors`, `th_client_errors_cleared_at` | Portal client error log | 0 | Stays in blob (diagnostics) |
| `th_flagged_items` + `th_flagged_tombstones` | "Flag this page" items | 1 | Stays in blob (diagnostics) |
| `th_graveyard` | Snapshots of deleted records for Restore | 7 | Stays for blob entities. For migrated entities, soft-deleted rows replace it (Phase 3). |
| `th_sync_conflicts` | Log of merge conflicts | 0 | Stays for blob entities. Migrated entities get Phase 3 conflict records. |
| `th_parts_reference_units`, `th_pr_unit_tombstones`, `th_pr_issue_tombstones` | Appliance Wiki (separate `workspace_sync_wiki` row) | — | Stays in its own blob |

Local-only keys (never synced), for completeness: `th_sync_base` (merge base), `th_mirror_failures` (mirror failure log), `th_sync_code`, `th_sync_last`, `th_dash_collapsed`, `th_wiki_sync_known_at`. The plan's "retire" class: `th_sync_code`, `th_sync_last` and `th_dash_collapsed` stay as local UI state; `th_sync_base` and `th_mirror_failures` retire per entity when that entity leaves the blob.

**Full Backup mismatch (fixed 2026-10-01; Full Backup now reads sync.js's own lists):** Dev Tools' Full Backup/Restore used its own 17-key list (`ALL_SYNCED_KEYS`, `tools/dev-tools.html:1636`). It is missing `th_clients`, every tombstone key, and the rest of the "stays" rows above except the settings. See the bugs table.

---

## 2. Reader/writer census

### 2.1 Every read and write of a migrated key

Generated by `node scripts/item1-census.js` (tested by `tests/scripts/item1-census.test.js`). Kinds: `read` is `localStorage.getItem` / `thRead`; `write` is `setItem` / `thWrite`; `ref` is any other mention (a key list, an alias, a `JSON.parse` on a separately read value). The six public pages' `ref` rows (`about.html`, `index.html` and others) are a `TOOLS_KEYS` list that checks whether Workspace data is on the device; they don't read records.

Generated by `node scripts/item1-census.js`. 208 direct call sites.

| Entity | Reads | Writes | Removes | Other references |
|---|---|---|---|---|
| income | 14 | 4 | 0 | 7 |
| contacts (-> clients) | 7 | 2 | 0 | 9 |
| contracts | 6 | 2 | 0 | 7 |
| jobs | 35 | 6 | 0 | 16 |
| invoices | 20 | 4 | 0 | 15 |
| quotes | 8 | 2 | 0 | 7 |
| expenses | 8 | 3 | 0 | 8 |
| clients | 3 | 2 | 0 | 13 |

#### income

| Page | Function | Line | Key | Access |
|---|---|---|---|---|
| tools/client-detail.html | `plusIcon` | 584 | `th_income_log` | read |
| tools/data-layer.js | `(top level)` | 59 | `th_income_log` | ref |
| tools/data-layer.js | `thLoadIncomeTombstones` | 237 | `th_income_tombstones` | read |
| tools/data-layer.js | `thAddIncomeTombstone` | 242 | `th_income_tombstones` | write |
| tools/data-layer.js | `thWeekSummary` | 1198 | `th_income_log` | read |
| tools/data-layer.js | `thGetJobBundle` | 1668 | `th_income_log` | read |
| tools/dev-tools.html | `devPullNow` | 1638 | `th_income_log` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3372 | `th_income_log` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3372 | `th_income_tombstones` | ref |
| tools/finance.html | `loadIncomeEntries` | 881 | `th_income_log` | read |
| tools/finance.html | `saveIncomeEntries` | 888 | `th_income_log` | write |
| tools/invoice-generator.html | `loadIncomeEntriesRaw` | 2575 | `th_income_log` | read |
| tools/invoice-generator.html | `removeIncomeEntriesForInvoice` | 2583 | `th_income_log` | write |
| tools/invoice-generator.html | `logInvoiceToIncomeLog` | 2611 | `th_income_log` | read |
| tools/invoice-generator.html | `logInvoiceToIncomeLog` | 2626 | `th_income_log` | write |
| tools/job-tracker.html | `openJobDoneSheet` | 1822 | `th_income_log` | read |
| tools/job-tracker.html | `renderJobs` | 2521 | `th_income_log` | read |
| tools/job-tracker.html | `openJobActions` | 2692 | `th_income_log` | read |
| tools/job-tracker.html | `toggleClientHistory` | 3203 | `th_income_log` | read |
| tools/runway-dashboard.html | `loadJobTrackerIncome` | 3078 | `th_income_log` | read |
| tools/sync.js | `debugTrace` | 134 | `th_income_tombstones` | ref |
| tools/sync.js | `debugTrace` | 135 | `th_income_log` | ref |
| tools/sync.js | `mergeTombstones` | 634 | `th_income_tombstones` | ref |
| tools/tools-nav-pwa.js | `esc` | 1098 | `th_income_log` | read |
| tools/workspace.html | `loadManualIncomeForWorkspace` | 2448 | `th_income_log` | read |

#### contacts (-> clients)

| Page | Function | Line | Key | Access |
|---|---|---|---|---|
| tools/contract-generator.html | `loadMasterContacts` | 527 | `th_tracker_contacts` | read |
| tools/data-layer.js | `(top level)` | 60 | `th_tracker_contacts` | ref |
| tools/data-layer.js | `thLoadContactTombstones` | 246 | `th_contact_tombstones` | read |
| tools/data-layer.js | `thAddContactTombstone` | 251 | `th_contact_tombstones` | write |
| tools/data-layer.js | `linked` | 529 | `th_tracker_contacts` | read |
| tools/dev-tools.html | `devPullNow` | 1637 | `th_tracker_contacts` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3373 | `th_tracker_contacts` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3373 | `th_contact_tombstones` | ref |
| tools/invoice-generator.html | `loadContactsForAutofill` | 3116 | `th_tracker_contacts` | read |
| tools/job-tracker.html | `(top level)` | 1136 | `th_tracker_contacts` | ref |
| tools/job-tracker.html | `loadContacts` | 3033 | `th_tracker_contacts` | read |
| tools/job-tracker.html | `saveContacts` | 3034 | `th_tracker_contacts` | write |
| tools/sync.js | `debugTrace` | 136 | `th_contact_tombstones` | ref |
| tools/sync.js | `debugTrace` | 137 | `th_tracker_contacts` | ref |
| tools/sync.js | `mergeTombstones` | 635 | `th_contact_tombstones` | ref |
| tools/tools-command-palette.js | `loadContacts` | 21 | `th_tracker_contacts` | read |
| tools/tools-nav-pwa.js | `add` | 2683 | `th_tracker_contacts` | ref |
| tools/workspace.html | `loadContactsForSearch` | 1820 | `th_tracker_contacts` | read |

#### contracts

| Page | Function | Line | Key | Access |
|---|---|---|---|---|
| tools/contract-generator.html | `loadContractLog` | 555 | `th_contracts` | read |
| tools/contract-generator.html | `saveContractLog` | 559 | `th_contracts` | write |
| tools/data-layer.js | `(top level)` | 61 | `th_contracts` | ref |
| tools/data-layer.js | `thLoadContractTombstones` | 255 | `th_contract_tombstones` | read |
| tools/data-layer.js | `thAddContractTombstone` | 260 | `th_contract_tombstones` | write |
| tools/data-layer.js | `linked` | 530 | `th_contracts` | read |
| tools/data-layer.js | `match` | 701 | `th_contracts` | read |
| tools/dev-tools.html | `devPullNow` | 1639 | `th_contracts` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3374 | `th_contracts` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3374 | `th_contract_tombstones` | ref |
| tools/sync.js | `debugTrace` | 164 | `th_contract_tombstones` | ref |
| tools/sync.js | `debugTrace` | 165 | `th_contracts` | ref |
| tools/sync.js | `mergeTombstones` | 636 | `th_contract_tombstones` | ref |
| tools/tools-command-palette.js | `loadContracts` | 24 | `th_contracts` | read |
| tools/workspace.html | `loadContractsForSearch` | 1822 | `th_contracts` | read |

#### jobs

| Page | Function | Line | Key | Access |
|---|---|---|---|---|
| about.html | `applyTheme` | 578 | `th_tracker_jobs` | ref |
| careers.html | `applyTheme` | 491 | `th_tracker_jobs` | ref |
| index.html | `onScroll` | 3450 | `th_tracker_jobs` | ref |
| our-work.html | `applyTheme` | 848 | `th_tracker_jobs` | ref |
| privacy.html | `applyTheme` | 377 | `th_tracker_jobs` | ref |
| terms.html | `applyTheme` | 427 | `th_tracker_jobs` | ref |
| tools/data-layer.js | `(top level)` | 55 | `th_tracker_jobs` | ref |
| tools/data-layer.js | `thLoadJobTombstones` | 213 | `th_job_tombstones` | read |
| tools/data-layer.js | `thAddJobTombstone` | 218 | `th_job_tombstones` | write |
| tools/data-layer.js | `linked` | 526 | `th_tracker_jobs` | read |
| tools/data-layer.js | `match` | 698 | `th_tracker_jobs` | read |
| tools/data-layer.js | `touch` | 805 | `th_tracker_jobs` | read |
| tools/data-layer.js | `thSetJobNoInvoice` | 966 | `th_tracker_jobs` | read |
| tools/data-layer.js | `thSetJobNoInvoice` | 971 | `th_tracker_jobs` | write |
| tools/data-layer.js | `thSaveClockJobs` | 1011 | `th_tracker_jobs` | write |
| tools/data-layer.js | `thStartJobClock` | 1030 | `th_tracker_jobs` | read |
| tools/data-layer.js | `thStopJobClock` | 1053 | `th_tracker_jobs` | read |
| tools/data-layer.js | `thUndoStopJobClock` | 1065 | `th_tracker_jobs` | read |
| tools/data-layer.js | `thFinishJob` | 1079 | `th_tracker_jobs` | read |
| tools/data-layer.js | `thWeekSummary` | 1196 | `th_tracker_jobs` | read |
| tools/data-layer.js | `thShiftSuggestedStart` | 1513 | `th_tracker_jobs` | read |
| tools/data-layer.js | `thShiftSuggestedEnd` | 1532 | `th_tracker_jobs` | read |
| tools/data-layer.js | `thLogJobText` | 1642 | `th_tracker_jobs` | read |
| tools/data-layer.js | `thLogJobText` | 1647 | `th_tracker_jobs` | write |
| tools/data-layer.js | `thGetJobBundle` | 1661 | `th_tracker_jobs` | read |
| tools/dev-tools.html | `runDataQualityCheck` | 1478 | `th_tracker_jobs` | read |
| tools/dev-tools.html | `devPullNow` | 1637 | `th_tracker_jobs` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3370 | `th_tracker_jobs` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3370 | `th_job_tombstones` | ref |
| tools/finance.html | `renderJobProfitability` | 671 | `th_tracker_jobs` | read |
| tools/finance.html | `checkClientHistory` | 728 | `th_tracker_jobs` | read |
| tools/finance.html | `populateIncomeJobRefOptions` | 893 | `th_tracker_jobs` | read |
| tools/finance.html | `addIncomeEntry` | 907 | `th_tracker_jobs` | read |
| tools/finance.html | `populateJobRefOptions` | 1175 | `th_tracker_jobs` | read |
| tools/finance.html | `addExpense` | 1211 | `th_tracker_jobs` | read |
| tools/finance.html | `fillIfBlank` | 1930 | `th_tracker_jobs` | read |
| tools/invoice-generator.html | `loadJobs` | 1576 | `th_tracker_jobs` | read |
| tools/invoice-generator.html | `autofillFromJobRef` | 3239 | `th_tracker_jobs` | read |
| tools/job-tracker.html | `(top level)` | 1136 | `th_tracker_jobs` | ref |
| tools/job-tracker.html | `loadJobs` | 1268 | `th_tracker_jobs` | read |
| tools/job-tracker.html | `saveJobs` | 1270 | `th_tracker_jobs` | write |
| tools/job-tracker.html | `submitQuickExpense` | 1697 | `th_tracker_jobs` | read |
| tools/review-request.html | `loadRecentDoneJobs` | 688 | `th_tracker_jobs` | read |
| tools/route-planner.html | `pullTodaysJobs` | 424 | `th_tracker_jobs` | read |
| tools/sync.js | `debugTrace` | 116 | `th_job_tombstones` | ref |
| tools/sync.js | `debugTrace` | 117 | `th_tracker_jobs` | ref |
| tools/sync.js | `mergeTombstones` | 632 | `th_job_tombstones` | ref |
| tools/tools-command-palette.js | `loadJobs` | 20 | `th_tracker_jobs` | read |
| tools/tools-nav-pwa.js | `runningJob` | 1125 | `th_tracker_jobs` | read |
| tools/tools-nav-pwa.js | `render` | 1196 | `th_tracker_jobs` | ref |
| tools/tools-nav-pwa.js | `jobs` | 1285 | `th_tracker_jobs` | read |
| tools/tools-nav-pwa.js | `thReminderPhone` | 1517 | `th_tracker_jobs` | read |
| tools/tools-nav-pwa.js | `thOpenTextSheet` | 1635 | `th_tracker_jobs` | read |
| tools/tools-nav-pwa.js | `add` | 2681 | `th_tracker_jobs` | ref |
| tools/workspace.html | `loadJobs` | 1804 | `th_tracker_jobs` | read |
| tools/workspace.html | `convertBookingToJob` | 3156 | `th_tracker_jobs` | write |
| tools/workspace.html | `getTodaysJobs` | 3792 | `th_tracker_jobs` | read |

#### invoices

| Page | Function | Line | Key | Access |
|---|---|---|---|---|
| about.html | `applyTheme` | 578 | `th_invoices` | ref |
| careers.html | `applyTheme` | 491 | `th_invoices` | ref |
| index.html | `onScroll` | 3450 | `th_invoices` | ref |
| our-work.html | `applyTheme` | 848 | `th_invoices` | ref |
| privacy.html | `applyTheme` | 377 | `th_invoices` | ref |
| terms.html | `applyTheme` | 427 | `th_invoices` | ref |
| tools/data-layer.js | `(top level)` | 56 | `th_invoices` | ref |
| tools/data-layer.js | `thLoadInvoiceTombstones` | 268 | `th_invoice_tombstones` | read |
| tools/data-layer.js | `thAddInvoiceTombstone` | 273 | `th_invoice_tombstones` | write |
| tools/data-layer.js | `linked` | 527 | `th_invoices` | read |
| tools/data-layer.js | `match` | 699 | `th_invoices` | read |
| tools/data-layer.js | `touch` | 816 | `th_invoices` | read |
| tools/data-layer.js | `thLogInvoiceReminder` | 1158 | `th_invoices` | read |
| tools/data-layer.js | `thLogInvoiceReminder` | 1164 | `th_invoices` | write |
| tools/data-layer.js | `thWeekSummary` | 1197 | `th_invoices` | read |
| tools/data-layer.js | `thGetJobBundle` | 1665 | `th_invoices` | read |
| tools/dev-tools.html | `devPullNow` | 1638 | `th_invoices` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3375 | `th_invoices` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3375 | `th_invoice_tombstones` | ref |
| tools/finance.html | `renderJobProfitability` | 679 | `th_invoices` | read |
| tools/finance.html | `backfillLegacyInvoicesIntoIncomeLog` | 1011 | `th_invoices` | read |
| tools/invoice-generator.html | `loadInvoiceLog` | 2514 | `th_invoices` | read |
| tools/invoice-generator.html | `saveInvoiceLog` | 2516 | `th_invoices` | write |
| tools/job-tracker.html | `openJobDoneSheet` | 1822 | `th_invoices` | read |
| tools/job-tracker.html | `renderJobs` | 2519 | `th_invoices` | read |
| tools/job-tracker.html | `openJobActions` | 2692 | `th_invoices` | read |
| tools/job-tracker.html | `loadInvoicesForHistory` | 3110 | `th_invoices` | read |
| tools/runway-dashboard.html | `loadJobTrackerInvoices` | 3074 | `th_invoices` | read |
| tools/sync.js | `debugTrace` | 154 | `th_invoice_tombstones` | ref |
| tools/sync.js | `debugTrace` | 155 | `th_invoices` | ref |
| tools/sync.js | `mergeTombstones` | 637 | `th_invoice_tombstones` | ref |
| tools/sync.js | `mergeTombstones` | 741 | `th_invoices` | ref |
| tools/sync.js | `mergeTombstones` | 773 | `th_invoices` | ref |
| tools/sync.js | `getInvoicesForRead` | 1773 | `th_invoices` | read |
| tools/tools-command-palette.js | `loadInvoices` | 22 | `th_invoices` | read |
| tools/tools-nav-pwa.js | `esc` | 1099 | `th_invoices` | read |
| tools/tools-nav-pwa.js | `thOpenReminderSheet` | 1535 | `th_invoices` | read |
| tools/workspace.html | `loadInvoices` | 1806 | `th_invoices` | read |
| tools/workspace.html | `saveInvoices` | 1808 | `th_invoices` | write |

#### quotes

| Page | Function | Line | Key | Access |
|---|---|---|---|---|
| tools/data-layer.js | `(top level)` | 57 | `th_quotes` | ref |
| tools/data-layer.js | `thLoadQuoteTombstones` | 277 | `th_quote_tombstones` | read |
| tools/data-layer.js | `thAddQuoteTombstone` | 282 | `th_quote_tombstones` | write |
| tools/data-layer.js | `linked` | 528 | `th_quotes` | read |
| tools/data-layer.js | `match` | 700 | `th_quotes` | read |
| tools/data-layer.js | `touch` | 828 | `th_quotes` | read |
| tools/data-layer.js | `thGetJobBundle` | 1666 | `th_quotes` | read |
| tools/dev-tools.html | `devPullNow` | 1639 | `th_quotes` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3376 | `th_quotes` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3376 | `th_quote_tombstones` | ref |
| tools/invoice-generator.html | `loadQuoteLog` | 2714 | `th_quotes` | read |
| tools/invoice-generator.html | `saveQuoteLog` | 2716 | `th_quotes` | write |
| tools/sync.js | `debugTrace` | 156 | `th_quote_tombstones` | ref |
| tools/sync.js | `debugTrace` | 157 | `th_quotes` | ref |
| tools/sync.js | `mergeTombstones` | 638 | `th_quote_tombstones` | ref |
| tools/tools-command-palette.js | `loadQuotes` | 23 | `th_quotes` | read |
| tools/workspace.html | `loadQuotesForSearch` | 1821 | `th_quotes` | read |

#### expenses

| Page | Function | Line | Key | Access |
|---|---|---|---|---|
| tools/data-layer.js | `(top level)` | 58 | `th_expense_log` | ref |
| tools/data-layer.js | `thLoadExpenseTombstones` | 228 | `th_expense_tombstones` | read |
| tools/data-layer.js | `thAddExpenseTombstone` | 233 | `th_expense_tombstones` | write |
| tools/data-layer.js | `thGetJobBundle` | 1667 | `th_expense_log` | read |
| tools/dev-tools.html | `devPullNow` | 1638 | `th_expense_log` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3371 | `th_expense_log` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3371 | `th_expense_tombstones` | ref |
| tools/finance.html | `loadExpenses` | 1145 | `th_expense_log` | read |
| tools/finance.html | `saveExpenses` | 1156 | `th_expense_log` | write |
| tools/invoice-generator.html | `currentJobFillBillables` | 1797 | `th_expense_log` | read |
| tools/job-tracker.html | `submitQuickExpense` | 1706 | `th_expense_log` | read |
| tools/job-tracker.html | `submitQuickExpense` | 1708 | `th_expense_log` | write |
| tools/job-tracker.html | `renderJobs` | 2520 | `th_expense_log` | read |
| tools/runway-dashboard.html | `loadJobTrackerExpenses` | 3062 | `th_expense_log` | read |
| tools/sync.js | `debugTrace` | 132 | `th_expense_tombstones` | ref |
| tools/sync.js | `debugTrace` | 133 | `th_expense_log` | ref |
| tools/sync.js | `mergeTombstones` | 633 | `th_expense_tombstones` | ref |
| tools/tools-nav-pwa.js | `add` | 2686 | `th_expense_log` | ref |
| tools/workspace.html | `loadExpenses` | 1805 | `th_expense_log` | read |

#### clients

| Page | Function | Line | Key | Access |
|---|---|---|---|---|
| about.html | `applyTheme` | 578 | `th_clients` | ref |
| careers.html | `applyTheme` | 491 | `th_clients` | ref |
| index.html | `onScroll` | 3450 | `th_clients` | ref |
| our-work.html | `applyTheme` | 848 | `th_clients` | ref |
| privacy.html | `applyTheme` | 377 | `th_clients` | ref |
| terms.html | `applyTheme` | 427 | `th_clients` | ref |
| tools/data-layer.js | `(top level)` | 63 | `th_clients` | ref |
| tools/data-layer.js | `thLoadClients` | 157 | `th_clients` | read |
| tools/data-layer.js | `thSaveClients` | 158 | `th_clients` | write |
| tools/data-layer.js | `thLoadClientTombstones` | 196 | `th_client_tombstones` | read |
| tools/data-layer.js | `thAddClientTombstone` | 201 | `th_client_tombstones` | write |
| tools/dev-tools.html | `addKnownIssue` | 3369 | `th_clients` | ref |
| tools/dev-tools.html | `addKnownIssue` | 3369 | `th_client_tombstones` | ref |
| tools/sync.js | `debugTrace` | 123 | `th_client_tombstones` | ref |
| tools/sync.js | `debugTrace` | 124 | `th_clients` | ref |
| tools/sync.js | `mergeTombstones` | 631 | `th_client_tombstones` | ref |
| tools/tools-command-palette.js | `loadClients` | 25 | `th_clients` | read |
| tools/tools-nav-pwa.js | `add` | 2680 | `th_clients` | ref |

#### Shared helpers (indirect access)

Functions in `data-layer.js` / `sync.js` that read or write a migrated key directly. Every caller below reaches the key through them.

| Helper | Defined in | Keys | Access | Callers |
|---|---|---|---|---|
| `getInvoicesForRead` | tools/sync.js | `th_invoices` | read | tools/finance.html:679 (`renderJobProfitability`)<br>tools/invoice-generator.html:1012 (`invoicesForDisplay`)<br>tools/runway-dashboard.html:3073 (`loadJobTrackerInvoices`)<br>tools/workspace.html:1817 (`invoicesForDisplay`) |
| `thAddClientTombstone` | tools/data-layer.js | `th_client_tombstones` | write | tools/data-layer.js:491 (`thDeleteClient`) |
| `thAddContactTombstone` | tools/data-layer.js | `th_contact_tombstones` | write | tools/job-tracker.html:3103 (`deleteContact`) |
| `thAddContractTombstone` | tools/data-layer.js | `th_contract_tombstones` | write | tools/contract-generator.html:786 (`deleteContractLogEntry`) |
| `thAddExpenseTombstone` | tools/data-layer.js | `th_expense_tombstones` | write | tools/finance.html:1353 (`deleteExpense`)<br>tools/finance.html:1371 (`clearAllExpenses`) |
| `thAddIncomeTombstone` | tools/data-layer.js | `th_income_tombstones` | write | tools/finance.html:981 (`deleteIncomeEntry`)<br>tools/finance.html:1000 (`clearAllIncome`)<br>tools/invoice-generator.html:2584 (`removeIncomeEntriesForInvoice`) |
| `thAddInvoiceTombstone` | tools/data-layer.js | `th_invoice_tombstones` | write | tools/invoice-generator.html:2538 (`deleteInvoiceLogEntry`) |
| `thAddJobTombstone` | tools/data-layer.js | `th_job_tombstones` | write | tools/job-tracker.html:1768 (`deleteJob`)<br>tools/job-tracker.html:2203 (`bulkDeleteJobs`) |
| `thAddQuoteTombstone` | tools/data-layer.js | `th_quote_tombstones` | write | tools/invoice-generator.html:2731 (`deleteQuoteLogEntry`) |
| `thAutofillClientFields` | tools/data-layer.js | `th_clients` | indirect (via `thFindClientByName`) | tools/invoice-generator.html:3261 (`autofillFromContact`)<br>tools/invoice-generator.html:3287 (`autofillQuoteClient`)<br>tools/job-tracker.html:1286 (`autofillJobClient`) |
| `thBackfillClients` | tools/data-layer.js | `th_clients`, `th_client_tombstones`, `th_tracker_jobs`, `th_invoices`, `th_quotes`, `th_tracker_contacts`, `th_contracts` | indirect (via `thLoadClients`) | tools/clients.html:2255 (`clientsTabFromLocation`)<br>tools/clients.html:2269 (`clientsTabFromLocation`)<br>tools/data-layer.js:848 (`thRunClientBackfillOnce`) |
| `thCollectClientNamesFromExistingData` | tools/data-layer.js | `th_tracker_jobs`, `th_invoices`, `th_quotes`, `th_tracker_contacts`, `th_contracts`, `th_clients` | read | tools/data-layer.js:557 (`thBackfillClients`) |
| `thDeleteClient` | tools/data-layer.js | `th_clients`, `th_client_tombstones` | indirect (via `thLoadClients`) | tools/client-detail.html:664 (`deleteThisClient`)<br>tools/dev-tools.html:1434 (`deleteClientFromRegistry`) |
| `thEnsureClient` | tools/data-layer.js | `th_clients` | indirect (via `thLoadClients`) | tools/clients.html:2219 (`openAddClient`)<br>tools/contract-generator.html:1081 (`generateAndLog`)<br>tools/invoice-generator.html:2637 (`logInvoice`)<br>tools/invoice-generator.html:2751 (`logQuote`)<br>tools/job-tracker.html:1398 (`addJob`)<br>tools/workspace.html:3134 (`convertBookingToJob`) |
| `thFindClientById` | tools/data-layer.js | `th_clients` | indirect (via `thLoadClients`) | tools/data-layer.js:693 (`thGetClientBundle`)<br>tools/data-layer.js:1676 (`thGetJobBundle`)<br>tools/invoice-generator.html:1079 (`invoiceClientHref`)<br>tools/tools-nav-pwa.js:1513 (`thReminderPhone`)<br>tools/tools-nav-pwa.js:1641 (`icon`) |
| `thFindClientByName` | tools/data-layer.js | `th_clients` | indirect (via `thLoadClients`) | tools/clients.html:2218 (`openAddClient`)<br>tools/data-layer.js:620 (`thEnsureClient`)<br>tools/data-layer.js:674 (`thAutofillClientFields`)<br>tools/data-layer.js:1677 (`thGetJobBundle`)<br>tools/invoice-generator.html:1080 (`invoiceClientHref`)<br>tools/job-tracker.html:1366 (`updateFirstTimeNudge`)<br>tools/job-tracker.html:1867 (`saveTemplates`)<br>tools/tools-nav-pwa.js:1514 (`thReminderPhone`)<br>tools/tools-nav-pwa.js:1642 (`icon`)<br>tools/workspace.html:2297 (`renderTopClients`) |
| `thFinishJob` | tools/data-layer.js | `th_tracker_jobs` | read | tools/tools-nav-pwa.js:1103 (`esc`)<br>tools/tools-nav-pwa.js:1107 (`esc`) |
| `thGetAllClientsWithTotals` | tools/data-layer.js | `th_clients`, `th_tracker_jobs`, `th_invoices`, `th_quotes`, `th_contracts` | indirect (via `thLoadClients`) | tools/dev-tools.html:1403 (`renderClientRegistry`) |
| `thGetClientBundle` | tools/data-layer.js | `th_tracker_jobs`, `th_invoices`, `th_quotes`, `th_contracts` | read | tools/client-detail.html:351 (`(top level)`)<br>tools/client-detail.html:402 (`onClientRealtimeChange`)<br>tools/client-detail.html:646 (`deleteThisClient`)<br>tools/client-detail.html:695 (`undoDeleteClient`)<br>tools/data-layer.js:714 (`thGetAllClientsWithTotals`) |
| `thGetClientDirectory` | tools/data-layer.js | `th_tracker_jobs`, `th_invoices`, `th_quotes`, `th_clients` | read | tools/clients.html:2097 (`renderClientDirectory`) |
| `thGetJobBundle` | tools/data-layer.js | `th_tracker_jobs`, `th_invoices`, `th_quotes`, `th_expense_log`, `th_income_log` | read | tools/job-detail.html:402 (`(top level)`)<br>tools/job-detail.html:459 (`onJobRealtimeChange`)<br>tools/job-detail.html:873 (`generateJobSheet`) |
| `thLoadClients` | tools/data-layer.js | `th_clients` | read | tools/client-detail.html:684 (`undoDeleteClient`)<br>tools/data-layer.js:486 (`thDeleteClient`)<br>tools/data-layer.js:524 (`note`)<br>tools/data-layer.js:546 (`thBackfillClients`)<br>tools/data-layer.js:589 (`thFindClientByName`)<br>tools/data-layer.js:594 (`thFindClientById`)<br>tools/data-layer.js:632 (`thEnsureClient`)<br>tools/data-layer.js:645 (`thEnsureClient`)<br>tools/data-layer.js:712 (`thGetAllClientsWithTotals`)<br>tools/data-layer.js:782 (`thGetClientDirectory`) |
| `thLoadClientTombstones` | tools/data-layer.js | `th_client_tombstones` | read | tools/data-layer.js:198 (`thAddClientTombstone`)<br>tools/data-layer.js:553 (`thBackfillClients`) |
| `thLoadContactTombstones` | tools/data-layer.js | `th_contact_tombstones` | read | tools/data-layer.js:248 (`thAddContactTombstone`) |
| `thLoadContractTombstones` | tools/data-layer.js | `th_contract_tombstones` | read | tools/data-layer.js:257 (`thAddContractTombstone`) |
| `thLoadExpenseTombstones` | tools/data-layer.js | `th_expense_tombstones` | read | tools/data-layer.js:230 (`thAddExpenseTombstone`) |
| `thLoadIncomeTombstones` | tools/data-layer.js | `th_income_tombstones` | read | tools/data-layer.js:239 (`thAddIncomeTombstone`) |
| `thLoadInvoiceTombstones` | tools/data-layer.js | `th_invoice_tombstones` | read | tools/data-layer.js:270 (`thAddInvoiceTombstone`) |
| `thLoadJobTombstones` | tools/data-layer.js | `th_job_tombstones` | read | tools/data-layer.js:215 (`thAddJobTombstone`) |
| `thLoadQuoteTombstones` | tools/data-layer.js | `th_quote_tombstones` | read | tools/data-layer.js:279 (`thAddQuoteTombstone`) |
| `thLogInvoiceReminder` | tools/data-layer.js | `th_invoices` | read, write | tools/tools-nav-pwa.js:1579 (`logged`) |
| `thLogJobText` | tools/data-layer.js | `th_tracker_jobs` | read, write | tools/tools-nav-pwa.js:1711 (`onKey`) |
| `thRunClientBackfillOnce` | tools/data-layer.js | `th_clients`, `th_client_tombstones`, `th_tracker_jobs`, `th_invoices`, `th_quotes`, `th_tracker_contacts`, `th_contracts` | indirect (via `thBackfillClients`) | tools/workspace.html:4779 (`handleIncomingSearch`) |
| `thSaveClients` | tools/data-layer.js | `th_clients` | write | tools/client-detail.html:687 (`undoDeleteClient`)<br>tools/data-layer.js:489 (`thDeleteClient`)<br>tools/data-layer.js:579 (`thBackfillClients`)<br>tools/data-layer.js:636 (`thEnsureClient`)<br>tools/data-layer.js:656 (`thEnsureClient`) |
| `thSaveClockJobs` | tools/data-layer.js | `th_tracker_jobs` | write | tools/data-layer.js:1045 (`thStartJobClock`)<br>tools/data-layer.js:1059 (`thStopJobClock`)<br>tools/data-layer.js:1071 (`thUndoStopJobClock`)<br>tools/data-layer.js:1088 (`thFinishJob`) |
| `thSetJobNoInvoice` | tools/data-layer.js | `th_tracker_jobs` | read, write | tools/job-tracker.html:1842 (`setJobNoCharge`)<br>tools/workspace.html:2511 (`markJobNoCharge`)<br>tools/workspace.html:2514 (`undo`) |
| `thShiftSuggestedEnd` | tools/data-layer.js | `th_tracker_jobs` | read | tools/tools-nav-pwa.js:1296 (`render`) |
| `thShiftSuggestedStart` | tools/data-layer.js | `th_tracker_jobs` | read | tools/tools-nav-pwa.js:1325 (`render`) |
| `thStartJobClock` | tools/data-layer.js | `th_tracker_jobs` | read | tools/tools-nav-pwa.js:1057 (`thStartClock`) |
| `thStopJobClock` | tools/data-layer.js | `th_tracker_jobs` | read | tools/job-tracker.html:1790 (`setJobStatus`)<br>tools/tools-nav-pwa.js:1074 (`thStopClock`) |
| `thUndoStopJobClock` | tools/data-layer.js | `th_tracker_jobs` | read | tools/tools-nav-pwa.js:1088 (`esc`) |
| `thWeekSummary` | tools/data-layer.js | `th_tracker_jobs`, `th_invoices`, `th_income_log` | read | tools/workspace.html:1447 (`finish`)<br>tools/workspace.html:3950 (`renderWeekCard`)<br>tools/workspace.html:4229 (`renderTodayRings`) |

### 2.2 Places that match clients by name

Phase 3.5 moves every one of these to `client_id`.

Normalization codes used below:
- **REG** = `thNormalizeClientName()` (data-layer.js:153): trim, lowercase, collapse whitespace. Case and spacing variants match; typos, "Bob"/"Robert", a middle initial, or "Sarah & Tom Miller" do not.
- **CI-TRIM** = `.trim().toLowerCase()` exact. Case-insensitive, but no whitespace collapse, so "Sarah  Miller" (two spaces) is a different client.
- **TRIM** = `.trim()` exact. Case-sensitive, so "sarah miller" and "Sarah Miller" are two clients.
- **SUBSTR** = `.toLowerCase().includes(term)`, used by search boxes.
- **ID→NAME** = has an id on hand but passes only the name forward (a URL param or a form field), so the next page resolves it by name again.

Where the table says "Two spellings", it means what goes wrong if the same client appears as, say, "Sarah Miller" and "sarah  miller" (or "Sara Miller").

#### 1. Core resolvers: tools/data-layer.js (every caller depends on these)

| file:line | function | Matches | Norm. | What it does for the user | Two spellings |
|---|---|---|---|---|---|
| data-layer.js:153 | `thNormalizeClientName` | n/a | REG | The normalizer every registry lookup uses | n/a |
| data-layer.js:498-534 | `thCollectClientNamesFromExistingData` | `jobs[].client`, `invoices[].clientName`, `quotes[].clientName`, `contacts[].name`, `contracts[].fields.clientName`, all grouped by REG key | REG | Finds every distinct client for the backfill. Since 2026-09-22 it skips a job/invoice/quote/contract whose `clientId` points to a live registry client. **Contacts are always collected by name**, because contacts have no clientId. | A typo'd variant becomes a second registry client. |
| data-layer.js:530 | same | Reads `f.clientPhone / f.clientAddress / f.clientEmail` on contracts | n/a | Pulls contact details from contracts | **Field-name bug (outside this list's scope):** contract `fields` use `phone`, `email`, `serviceAddress` (contract-generator.html:1048-1050), so these values are always blank. |
| data-layer.js:547-583 | `thBackfillClients` | registry `c.name` vs discovered names; tombstones by `normalizedName` | REG | Creates missing registry clients. It runs on every Clients page load (clients.html:2255, 2269) and once per device from the Dashboard (workspace.html:4778). | Each variant becomes its own client. Deleting one variant tombstones only that REG name. |
| data-layer.js:197-200, 552-555 | `thAddClientTombstone` / backfill tombstone check | `normalizedName` | REG | Stops a deleted client from being re-created by the backfill | Deleting "Sarah Miller" does not block re-creation of "Sara Miller". |
| data-layer.js:586-590 | **`thFindClientByName`** | REG(name) vs REG(`th_clients[].name`); first match wins | REG | The shared lookup (callers listed in section 2) | Returns null for the variant, or whichever registry record matches first. Two registry records can share one REG name (for example, created on two devices, since sync merges clients by `id` only: sync.js:355). |
| data-layer.js:592 | `thFindClientById` | `c.id === id` | id | **Safe** | n/a |
| data-layer.js:619-657 | **`thEnsureClient`** | via `thFindClientByName` | REG | Get-or-create a client on every save path, and fill blank phone/address/email | A variant spelling creates a new client. The email/phone typed on the form goes onto the new record, so the real client's record never gets it. Email is never used to match, so a matching email does not merge the two. |
| data-layer.js:672-683 | `thAutofillClientFields` | via `thFindClientByName` | REG | Fills email/phone/address on a form from the registry | A variant spelling fills nothing, so details get retyped and can diverge. |
| data-layer.js:692-706 | `thGetClientBundle` | `x.clientId === id` **OR** REG(`j.client` / `i.clientName` / `q.clientName` / `c.fields.clientName`) === REG(client.name) | id + REG fallback | Client Detail page, and the totals in `thGetAllClientsWithTotals` | The OR means any legacy **or new** record whose name REG-matches is pulled in even if it has a different clientId, and a record under a variant name with no clientId is missed. Revenue, job count and last job come out split or wrong. |
| data-layer.js:710-734 | `thGetAllClientsWithTotals` | via bundle; `knownEmail` = the most recent invoice in the bundle that has a `clientEmail` | as bundle | Dev Tools Client Registry panel | Split totals; can show the wrong knownEmail. |
| data-layer.js:782-841 | `thGetClientDirectory` → `rowFor` | `byId[clientId]` first, else `byName[REG(name)]` (first registry client per REG key) | id, then REG | Clients directory: owed, overdue, jobs, last and next job, last activity | Jobs and invoices without a clientId under a variant name attach to nothing, so money owed and job counts go missing for that client. |
| data-layer.js:1674-1677 | `thGetJobBundle` | `job.clientId` → `thFindClientById`; else `thFindClientByName(job.client)` | id, then REG | Job Detail's client link | Falls back to name matching for jobs with no clientId. |
| data-layer.js:1133, 1623 | `thInvoiceReminderText`, `thJobTextTemplates` | n/a (takes the first word of the name) | n/a | Greeting text only | Display only; no matching. |

---

#### 2. Callers by page

##### tools/client-detail.html
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 351, 402, 646, 695 | render / delete / undo | `thGetClientBundle(currentClientId)` (the page is keyed by `?id=`) | id + REG (see bundle) | Client page | Inherits the bundle problem. |
| 444, 487, 489, 495, 529 | hero actions, "What's next" | ID→NAME: `?client=<c.name>` to job-tracker / invoice-generator | name | New job / Invoice / Quote buttons | The target page re-resolves by REG. The clientId is lost, and if the registry name differs from how the new record is typed, a new client gets created. |
| 524, 553, 558, 562, 606, 614, 621 | timeline / records | ID→NAME: `?search=<c.name>` to invoice-generator `#recent` / contract-generator | SUBSTR on target | "See invoices", "See contracts" links | The target list filters by substring, so a variant spelling is not shown, and a different client whose name contains this one is (for example "Ann Lee" also matches "Joann Leeds"). |
| 724-815 | referral link | `client.email` → `client_account_codes?email=eq.` | email (lowercased) | Referral link / code | **Safe (email).** Needs `client.email` on the registry record. |

##### tools/clients.html
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 2096-2130 | `renderClientDirectory` | `thGetClientDirectory()` | id, then REG | Directory list | See `rowFor`. |
| 2081-2085 | `clientMatches` | SUBSTR on name/email/address, plus phone digits | SUBSTR | Directory search box | Cosmetic. |
| 2170, 2172 | `clientQuickActions` | ID→NAME: `?client=<r.name>` | name | "New job for X" / "Invoice X" | Same as client-detail's `?client=` links. |
| 2206-2224 | `openAddClient` | `thFindClientByName(values.name)` + `thEnsureClient` | REG | Add a client; "was already a client" toast | A variant spelling creates a duplicate. |
| 2255, 2269 | DOMContentLoaded | `thBackfillClients()` | REG | Runs the backfill on every load | See the backfill row. |
| 1016-1038 | `loadPortalAccounts` | groups portal rows by `client_email` (lowercased) | email | Portal accounts list | **Safe (email).** Name is display only. |
| 1056, 1200, 1260, 1440, 1820 | portal panel searches | SUBSTR on `client_name` / email | SUBSTR | Search boxes | Cosmetic. |
| 654-692 | `renderReferralCredits` | shows `referrer_name` / `referred_name` text from the `referrals` table | none (display) | Referral credit ledger | The credit is attached to a **free-text referrer name**, not a client. Two spellings show as two referrers, and nothing ties the credit to the registry. |

##### tools/contract-generator.html
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 531-551 | `populateContactPickers` / `applyContactPicker` | picks from `th_tracker_contacts` by **contact id**, then copies `contact.name/phone/email` as text | id to text | Contact picker on the contract forms | Contact id is not stored; the contract gets only the name. |
| 1080-1087 | `generateAndLog` | `thEnsureClient(fields.clientName, …)` → `clientId` stored on the contract | REG | Links a new contract to a client | Variant spelling creates a new client. **Bug:** it passes `fields.clientPhone / clientAddress / clientEmail`, which don't exist (the real keys are `phone`, `serviceAddress`, `email`), so enrichment never fills anything from contracts. |
| 1117-1123 | portal sync | `client_email: fields.email`, `client_name` | email | E-sign via portal | **Safe (email)** at the portal. |
| 587-595 | `renderContractLog` | SUBSTR `entry.fields.clientName` | SUBSTR | Contract search | Cosmetic. |
| 1253-1254 | init | `?search=` → contract search box | SUBSTR | Deep link from client-detail / palette / dashboard | Name-based deep link. |
| sync.js:1372-1377 | `mirrorContractToRelational` | n/a | n/a | Relational mirror | **Drops `clientId`**: only `fields` (which carries the name) is mirrored. |

##### tools/dev-tools.html
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 1397-1427 | `renderClientRegistry` | `thGetAllClientsWithTotals()`; links "View in Clients" by `?search=<knownEmail>` | bundle (id + REG); email link | Registry inspector | Split totals. The email link is safe. |
| 1476-1495 | `runDataQualityCheck` | groups `jobs[].client` by trim+lower+collapse and flags a key with more than one distinct spelling | REG-equivalent (its own copy of the normalizer) | "Possible duplicate client" check | Catches case and spacing variants only; typos are not detected. Jobs only (not invoices, quotes or contacts). |

##### tools/finance.html
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 724-735 | **`checkClientHistory`** (returning-client detection) | `jobs[].client.trim().toLowerCase() === typed.trim().toLowerCase()` | CI-TRIM | Job-cost calculator: "Returning client, N prior jobs" vs first-time. **Ticks the "First-time client, apply discount" box** (the box is at line 383 and is read at 782). | **Money impact:** a returning client typed with a variant spelling is flagged first-time and gets the discount. Ignores the registry and clientId entirely. |
| 912 (income form), 1024 (backfill of invoices into the income log) | income entry save | `income[].source` = free-text client name, **no clientId** | none | Manual income entries | Income is linked to a client only by name (see job-tracker 3203 and workspace global search). |
| 1934 | preset from `?job=` | copies `presetJob.client` → `incomeSource` | ID→NAME | "Log payment" from a job | The job's clientId is not carried onto the income entry. |

##### tools/invoice-generator.html
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 1077-1082 | `invoiceClientHref` | `rec.clientId` → by id; else `thFindClientByName(rec.clientName)` | id, then REG | "Open client" link on an invoice/quote | Name fallback for legacy rows. |
| 2631-2645 | **`logInvoice`** | `thEnsureClient(clientNameVal, {address, email})` → `clientId` | REG | Links a new invoice to a client | A variant spelling creates a new client. The invoice's email then enriches the wrong record. |
| 2610-2617 | `logInvoiceToIncome` (unverified name; the income mirror near 2608) | `source: invoiceEntry.clientName` | none | Mirrors the invoice into the income log | Income mirror carries a name only, no clientId. |
| 2745-2756 | **`logQuote`** | `thEnsureClient(quoteClientNameVal, …)` | REG | Links a new quote | Same as logInvoice. |
| 2117-2127 | `convertQuoteToInvoice` | copies `quoteClientName` → `clientName` as text; the quote's `clientId` is not carried | ID→NAME | Quote → invoice | The invoice re-resolves by name in logInvoice. Harmless unless the name was edited in between or the registry has two matching records. |
| 3236-3251 | `autofillFromJobRef` (also called from `applyJobRefFromUrl`, 3151-3157) | copies `job.client` into the client name field; `job.clientId` is dropped | ID→NAME | Invoice from a job (`?jobRef=`, job dropdown) | **An invoice made from a job does not inherit the job's clientId**; it re-resolves by name. |
| 3180-3193 | `applyClientFromUrl` | `?client=<name>` → field, then autofill | REG (autofill) | Entry from Clients / client-detail / quick add | Name-based handoff. |
| 3252-3274 | `autofillFromContact` | `thAutofillClientFields` (REG), then **`contacts.find(c => c.name.toLowerCase() === typed.toLowerCase())`** (3263) | REG; contacts **case-insensitive exact, no trim or collapse on the stored name** | Fills email/address plus the contact row on the invoice | Contacts under a variant spelling don't autofill. |
| 3280-3288 | `autofillQuoteClient` | `thAutofillClientFields` | REG | Quote email/address | |
| 3221-3233 | `applyLogSearchFromUrl` | `?search=` → both log search boxes | SUBSTR | Deep link target | |
| 1179-1183, 2807-2811 | `renderInvoiceLog` / `renderQuoteLog` | SUBSTR `clientName` / number | SUBSTR | Log search | Cosmetic, but this is the target of every "see invoices" link. |
| 2366, 3059, 1339 | portal sync | `client_email` from the form field | email | Portal | **Safe (email).** |

##### tools/job-detail.html
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 493-496 | render | `bundle.client` from `thGetJobBundle` (id, then REG) | id, then REG | Client link on the job | Unlinked or wrong client for a legacy job under a variant name. |
| 584, 589, 719 | record sections | ID→NAME: `?search=<j.client>` to invoice-generator | SUBSTR | Invoice/quote links | The job has `jobRefId` links but opens a name-filtered list. |
| 525-528 | review quick action | first word of `j.client` → review-request `?name=` | none | Review request | Display only. |

##### tools/job-tracker.html
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 1282-1289 | `autofillJobClient` | `thAutofillClientFields(typedName, …)` | REG | Add Job: fills phone/address/email | |
| 1336-1351 | `applyPresetClientFromUrl` | `?client=<name>` → field | REG (autofill) | Entry from Clients / quick add | Name-based handoff. |
| 1363-1368 | **`updateFirstTimeNudge`** (referral nudge) | `!thFindClientByName(typedName)` | REG | Shows the "first-time customer, ask who referred them" nudge | A returning client typed with a variant spelling gets nudged as new, and a brand-new person who shares a REG name with an existing client is not. |
| 1393-1399 | **`addJob`** (add and edit) | `thEnsureClient(clientName, {phone, address, email})` → `clientId` | REG | Links the job | A variant spelling creates a new client. **On edit, `clientId` is recomputed from the name every save**, so fixing a typo in the name re-points the job (arguably good), but a job linked by id gets re-linked by name on every edit. |
| 1400, 1438-1439 → sync.js:1263-1273 | `addJob` → `mirrorReferralCreated` | `referredBy` free text → `referrals.referrer_name`; `referred_name: job.client` | none | Records a referral credit | **The referrer is identified by typed name only.** No registry lookup, no id or email. Credits can't be tied to a client, and variant spellings look like different referrers. |
| 1850-1887 | **`saveTemplates`** (portal check-up sync) | `thFindClientByName(t.client)` → `clientRecord.email` → `client_email` for `sync-checkup-to-portal` | REG | Recurring-template check-up reminders in the portal | Resolves **name to email** on every save. A variant spelling, or a registry record with no email, silently doesn't sync. If two registry records share a REG name, the first one's email is used. |
| 1966-2001 | `addTemplatePrompt` / `editTemplatePrompt` | template stores `client: <typed text>`, **no clientId** | none | Recurring templates | Template-to-client link is name-only. |
| 2005-2027 | **`createJobFromTemplate`** | copies `template.client` into a new job; **no `clientId`, blank phone/address, bypasses thEnsureClient** | none | Creates the recurring job | Produces unlinked jobs that later resolve by REG only. |
| 2494-2508, 3390-3398 | `renderJobs`, `loadJobsForCalendar` | SUBSTR title/client | SUBSTR | Job search box (also the `?search=` target, 3752-3763) | Cosmetic. |
| 3112-3121 | `renderContacts` | SUBSTR name/phone/email | SUBSTR | Contacts search (`?search=…#contacts` target) | Cosmetic. |
| 3187-3219 | **`toggleClientHistory`** (Client History) | `contact.name.trim().toLowerCase()` vs `jobs[].client.trim().toLowerCase()` (3197), `invoices[].clientName…` (3198), **`income[].source…`** (3203) | CI-TRIM | Contacts tab "History": lifetime spend plus job list | Variant spellings drop jobs, invoices and income from the history and the lifetime-spend figure. Ignores the registry and clientId entirely (contacts have no clientId). The page even says "only matches … exactly". |
| 3038-3060 | `addContact` | contact saved with **no clientId**, not linked to the registry | none | Contacts CRUD | Contacts only join clients through name matching (backfill, Client History, invoice autofill, quick add). |
| 1805-1811 | `reviewRequestHref` | first word of `job.client` | none | Review link | Display only. |
| 1508-1518 | job portal sync | `client_email` from the job's own field | email | Portal | **Safe (email).** |

##### tools/review-request.html
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 948-957, 733-734 | `checkDuplicateWarning`, ready rows | **phone digits** | phone | "Already sent to this number" | Not name-based. Listed as already safe-ish (keyed by phone, not a client id). |
| 837, 1049 | fill from job / reminder | first word of the name | none | Display | Display only. |

##### tools/route-planner.html
| 441 | stop labels | `j.client` display | none | Display | Display only. |

##### tools/workspace.html (Dashboard)
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 1834-1889 | `renderGlobalSearch` ("Find a client") | SUBSTR on `jobs.client`, `contacts.name`, `invoices.clientName`, `income.source`, `quotes.clientName`, `contracts.fields.clientName`. Links are ID→NAME `?search=<name>`. | SUBSTR | Cross-tool client search | A partial term finds both spellings, but the landing page filters by the clicked record's exact spelling. |
| 1902-1916 | `jumpToInvoiceSearch` / `jumpToIncomeEntrySearch` | looks up by id, then drops `clientName` / `source` into the income search | ID→NAME | Jump to income list | Same. |
| 4740-4746 | `handleIncomingSearch` | `?search=` → global search | SUBSTR | Target of palette invoice results | |
| 2258-2306 | **`renderTopClients`** (revenue by client) | groups invoices by `inv.clientName.trim()`; last seen from `jobs[].client.trim()`; then `thFindClientByName(client)` for the link | **TRIM (case-sensitive)**; link REG | Top Clients leaderboard (lifetime revenue, invoice count, last seen) | **Revenue is split across spellings** (the case explicitly flagged in data-layer.js:136-140). Both rows link to the same registry client. Last-seen needs an exact-case match with the job name. |
| 2311-2349 | **`renderFollowups`** (follow-up reminders) | groups `jobs[].client.trim()`; latest date per key; flags anything over 182 days | **TRIM (case-sensitive)** | "Follow-ups" lane plus action-item badge count; "Follow Up" button → review-request `?name=<first word>&phone=` | **A client who came back under a different spelling still shows as overdue**, and the badge count goes up. Ignores clientId. |
| 3133-3147 | `convertBookingToJob` | `thEnsureClient(booking.name, {phone, address, email})` | REG | Online booking → job, linked to a client | A variant name creates a new client even when `booking.email` matches an existing client's email (email is never used as a match key). |
| 4778-4779 | init | `thRunClientBackfillOnce()` | REG | One-time backfill | |

##### tools/tools-command-palette.js
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 181-188 | `SEARCH_SOURCES` Clients | SUBSTR name/email, phone digits → `client-detail.html?id=` | SUBSTR, then **id link** | Palette: Clients | **Safe link (id).** |
| 189-192 | Jobs | SUBSTR → `job-detail.html?id=` | id link | | Safe link. |
| 193-195 | Contacts | SUBSTR → `job-tracker.html?search=<name>#contacts` | ID→NAME | | Name-based link. |
| 196-198 | Invoices | SUBSTR → `workspace.html?search=<clientName>` | ID→NAME | | Name-based link. |
| 199-201 | Contracts | SUBSTR → `contract-generator.html?search=<clientName>` | ID→NAME | | Name-based link. |
| 202-204 | Quotes | SUBSTR, no link | n/a | | |

##### tools/tools-nav-pwa.js (shared shell)
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 1510-1521 | `thReminderPhone` | `inv.clientPhone`, then `thFindClientById(inv.clientId)`, then **`thFindClientByName(inv.clientName)`**, then the job's phone via `jobRefId` | id, then REG | Payment-reminder SMS target | Name fallback for legacy invoices. |
| 1638-1643 | `thOpenTextSheet` | `job.phone`, then `thFindClientById(job.clientId)`, then **`thFindClientByName(job.client)`** | id, then REG | "Text the client" sheet | Name fallback. |
| 2505-2541 | `thParseQuickEntry` step 8 | known client full name via regex (case-insensitive, whitespace-flexible); else a **unique first name** (lowercased) | CI regex / first name | Quick add: guesses the client from a typed sentence | A duplicate registry entry under a variant spelling counts as two clients with the same first name, which **disables the first-name match**. |
| 2574-2590 | step 11 (job for the invoice/expense) | `(out.client.id && j.clientId === out.client.id) \|\| j.client.trim().toLowerCase() === name` | id OR CI-TRIM | Picks the job for "invoice sarah 150" | Misses jobs under a variant name that have no matching id. |
| 2641-2668 | `thQuickEntryHref` | ID→NAME: `?client=<name>`; the parsed `client.id` is **dropped** | name | Hands off to job-tracker / invoice-generator | The target re-resolves by REG. |
| 2672-2689 | `thQuickAddContext` | dedupes the candidate list by `name.trim().toLowerCase()` across registry, `jobs[].client`, contacts | CI-TRIM | Builds the quick-add name list | Variant spellings become separate candidates. |

##### tools/sync.js
| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| 353-355 | `MERGE_KEY_FIELD.th_clients = 'id'` | id | id | Cross-device client merge | **Safe by id**, but nothing dedupes two ids that share a name. The same person added on two devices stays as two clients (the risk data-layer.js:36-41 warns about). |
| 1242-1250 | `mirrorJobsToRelational` | carries `client_id` | id | Relational mirror | **Already carries the id.** |
| 1348-1350, 1362-1364 | invoice / quote mirror | carries `client_id` and `client_email` | id | | **Already carries the id.** |
| 1372-1377 | contract mirror | **no client_id** | n/a | | Gap. |
| 1263-1273 | `mirrorReferralCreated` | `referrer_name` text | none | Referral credit row | See job-tracker 1438. |

---

#### 3. Edge functions (edge-functions/*.ts)

| file:line | function | Matches | Norm. | What it does | Two spellings |
|---|---|---|---|---|---|
| send-push-index.ts:382-405 | **`checkFollowups`** (server-side follow-up push) | groups the synced `jobs[].client.trim()`; the dedupe key for `wasRecentlyNotified` / `markNotified("followup", client)` is the **client name string** (323, 334) | **TRIM (case-sensitive)** | "Client Follow-Up" push notification | Same bug as workspace `renderFollowups`: a false "6 months since" push for the old spelling. A rename or respelling resets the notify dedupe. |
| send-push-index.ts:422, 541, 617 | overdue invoice / stale quote / warranty | name in the message only; dedupe by record id | id | Push text | Display only. |
| sync-{invoice,quote,job,contract,checkup}-to-portal | handlers | keyed by `client_email` (normalized) plus the `source_*_id`; `client_name` is stored for display | email | Portal upserts, "new client" invite | **Safe (email).** The upstream name→email resolution in job-tracker `saveTemplates` is the name-based link. |
| ensure-my-referral-code-index.ts:66-71 | display name | `client_portal_invoices?client_email=eq.` → `client_name` | email | Referral code display name | **Safe (email).** |
| resolve-referral-code-index.ts:67 (plus index.html:2708, booking.html:2058 on the public site) | resolve code | code → `display_name` text, which the public forms put into the free-text "referred by" field | ID→NAME | Referral via link | **An email-keyed referral code is turned back into a name** before it reaches `referrals.referrer_name`. Public site, not Workspace, but it feeds the same referral-credit table. |
| notify-*, send-*-notification, send-invite, schedule-*, send-quote-followup, send-payment-reminder, send-job-* | greetings | `client_name` / first word | none | Email greetings | Display only. |

#### 4. Portal (portal/*)
Identity is the signed-in email throughout. `client_name` is display only (home.html:981, jobs.html:979-980 pick the first non-empty name). **No name matching found.**

---

#### 5. Already id-, email- or phone-safe (no change needed, or only the fallback needs removing)
- `thFindClientById`; `thGetClientBundle`, `thGetClientDirectory` and `thGetJobBundle` all check the id first (but each still has a name fallback).
- Records that already store `clientId`: jobs (job-tracker addJob 1397, workspace booking conversion 3133), invoices (2636), quotes (2750), contracts (1080).
- Relational mirror carries `client_id` for jobs, invoices and quotes (not contracts).
- Command palette Clients and Jobs results link by id; client-detail.html and job-detail.html are keyed by `?id=`.
- Every portal sync and portal page is keyed by `client_email`; the referral code is keyed by email (client-detail 724-815, portal/settings.html 1012-1040).
- Review-request duplicate detection is keyed by phone digits.
- Invoice↔job, quote↔job and expense↔job links use `jobRefId` (thComputeJobMargin, thJobMoneyStage).
- `th_clients` sync merge and tombstones use `id`.

#### 6. Records that have NO clientId field today (they will need one or a backfill)
- `th_tracker_contacts` (contacts)
- `th_job_templates` (`template.client` text)
- `th_income_log` (`source` text), both manual entries and invoice mirrors
- Jobs created by `createJobFromTemplate`
- `referrals` table (`referrer_name` / `referred_name` text)
- Contract relational mirror
- Legacy jobs, invoices, quotes and contracts saved before the Push 2 clientId write

#### 7. Uncertain / unverified
- The name of the function around invoice-generator.html:2608-2628 (the income-log mirror) was not confirmed; the `source: invoiceEntry.clientName` at 2617 is confirmed.
- Did not check sql/ views or RPCs (only the table definition for referrals) for name joins. If any SQL report groups by `client`/`client_name`, it is outside this list (unverified).
- runway-dashboard.html, calendar.html, pos.html, settings.html, site-content.html, parts-reference.html: grep found no client-name matching (only display or unrelated `name` fields).

---

## 3. Field mapping (blob to relational)



### Live data checks (2026-09-30)

Field presence and types in the live blob, per entity (counts only):

- **Jobs (9):** every job has `id` (number), `title`, `client`, `phone`, `address`, `notes`, `priority`, `status`, `date`. 3 of 9 have an empty `date`. 5 have `clientId`; the other 4 predate it. `hoursWorked` is present on 2 but null. `referredBy` is on 3.
- **Invoices (4):** `jobRefId` is a **string** on all 4, while job ids are numbers. 2 invoices have no `line_items` in the blob and none in `invoice_line_items`; both are legacy invoices whose `total` is not whole cents and whose paid status is the `paid` flag only (one also has `paidAmount`). The other 2 have 2 and 3 line items, matching the relational rows.
- **Contracts (1):** `dateGenerated` is long-format (`Mon D, YYYY`), in the blob and in `contracts.date_generated`.
- **Expenses (2), income (6):** ISO dates; `amount` is a number; `jobRefId` is a string. 4 of the 6 income rows are invoice-generated (`invoiceId` present).
- **Contacts (1), clients (9):** clients all have `id` ('c_…'), `name`, `email`, `phone`, `address`, `createdAt` (ISO) and `source`.


### 0. Cross-cutting facts

#### Relational schema sources
- Base DDL: `sql/infra/create_relational_jobs_invoices_quotes_contracts.sql` (jobs L19-37, invoices L39-59, invoice_line_items L62-73, quotes L76-93, quotes.converted_to_invoice_id ALTER L103-104, quote_line_items L108-119, contracts L122-130).
- Later ALTERs on `public.jobs`:
  - `sql/infra/add_job_cancel_reschedule.sql:20-24` adds `cancel_token uuid not null default gen_random_uuid()`, `cancelled_at timestamptz`, `reschedule_requested_date text`, `reschedule_requested_at timestamptz`.
  - `sql/infra/create_referral_program.sql:17` adds `referred_by text`.
  - `sql/infra/add_job_confirmation_email.sql:26` adds `confirmation_sent_at timestamptz`.
- `tenant_id uuid references tenants(id)`:
  - jobs and invoices get it in `sql/multi-tenant/01_core_tenants_and_ids.sql:50-51`.
  - invoice_line_items, quotes, quote_line_items, contracts, referrals and th_job_photos get it in `sql/multi-tenant/03_remaining_tables_rls.sql:13-27` (loop).
  - It is filled on insert by triggers. Line items use `set_tenant_id_from_invoice` / `set_tenant_id_from_quote` (03:216-235). jobs, invoices, quotes and contracts use `set_tenant_id_from_session` (06:69-75), which falls back to Triple H (07). The mirror never sends tenant_id.
- **All money columns are unconstrained `numeric`** (no precision or scale). The plan's target is `numeric(12,2)`, so this is a change.
- **No `updated_at` trigger exists in the repo** for these tables. `updated_at`/`created_at` get `default now()` at first INSERT only. The mirror never sends them. So `created_at` records when the row was first mirrored, not when the record was created, and `updated_at` never changes after insert. **Checked live:** the only other trigger on these tables is `jobs.on_job_status_change` (`notify_job_status_change`); there is no `updated_at` trigger.
- **The mirror's upsert semantics** (`tools/sync.js:1150-1174`): `POST` with `Prefer: resolution=merge-duplicates` and no `on_conflict`, so it resolves on the PK `id`. Only the columns sent are written, so server-only columns (cancel_token, confirmation_sent_at, and so on) aren't clobbered.

#### The relational read-back mapping (the reverse direction exists too)
- `fetchJobsFromRelational()` `tools/sync.js:1691-1717` maps columns back to camelCase. It's the exact inverse of the mirror's column set, so fields with no column (hoursWorked, timeLog, clockSince, texts, noInvoice, confirmationSentAt) are **absent** on relational reads. calendar.html and route-planner.html read through it.
- `fetchInvoicesFromRelational()` `tools/sync.js:1725-1747`: no line_items, no reminders, no sourceQuoteId-to-quote join. `jobRefId` comes back as a **number** (`r.job_id`), where the blob holds a **string**. `getInvoicesForRead()` (`sync.js:1770`) serves this to list pages in finance.html, invoice-generator.html, runway-dashboard.html and workspace.html.

---

### 1. Jobs: `th_tracker_jobs` to `public.jobs`

#### 1a. Blob write sites
| Site | What |
|---|---|
| `tools/job-tracker.html:1384-1432` `addJob()` | create (`jobs.push({ id: Date.now(), ...fields, showOnCalendar: true, createdBy, lastEditedBy })` L1431) and edit (`{...jobs[idx], ...fields, lastEditedBy}` L1422) |
| `tools/job-tracker.html:1783-1796` `setJobStatus()` | `status`, `statusChangedAt` |
| `tools/job-tracker.html:2122-2132` `bulkMarkJobsDone()` | `status='done'`, `statusChangedAt` |
| `tools/job-tracker.html:2006-2022` `createJobFromTemplate()` | create with a minimal shape (no clientId, createdBy, lastEditedBy or showOnCalendar) |
| `tools/job-tracker.html:2817` `sendJobConfirmationEmail()` | `confirmationSentAt` |
| `tools/workspace.html:3139-3157` booking to job | create. **Writes localStorage directly and does NOT call mirrorJobsToRelational** (only `scheduleSync`). The row reaches `public.jobs` only on the next saveJobs() anywhere, since that mirrors the whole array. |
| `tools/data-layer.js:965-974` `thSetJobNoInvoice()` | `noInvoice`, `lastEditedBy`. Uses thWrite and **no mirror**. The comment says so on purpose. |
| `tools/data-layer.js:1017-1098` job clock (`thCommitJobClock/thStartJobClock/thStopJobClock/thUndoStopJobClock/thFinishJob`) | `clockSince`, `hoursWorked`, `timeLog`, `status`, `statusChangedAt`, `lastEditedBy`. Mirrors through `thSaveClockJobs` L1010-1014. |
| `tools/data-layer.js:1641-1648` `thLogJobText()` | `texts` (last 20). thWrite, no mirror. |
| `tools/dev-tools.html:3370,3395` graveyard restore | re-inserts the stored record and mirrors `[r]` |
| server: `edge-functions/send-job-confirmation-email-index.ts:245-270` | writes `public.jobs.confirmation_sent_at` directly |
| server: manage-job flow (`sql/infra/add_job_cancel_reschedule.sql`) | writes `cancelled_at` and `reschedule_requested_*` on `public.jobs` directly |

#### 1b. Mapping
Mirror: `tools/sync.js:1242-1251`. Backfill: `sql/infra/backfill_relational_jobs_invoices_contracts.sql:9-26`.

| blob field | type as written | column | column type | mirror transform | notes |
|---|---|---|---|---|---|
| id | number (`Date.now()`) | id | bigint PK | as-is | |
| title | string | title | text not null | `j.title \|\| ''` | |
| client | string (may be '') | client | text | `\|\| null` ('' becomes null) | |
| clientId | string `'c_…'` or undefined | client_id | text | `\|\| null` | no FK. The template path never sets it. |
| phone | string | phone | text | `\|\| null` | |
| address | string | address | text | `\|\| null` | |
| clientEmail | string or null | client_email | text | `\|\| null` | |
| priority | 'high'/'medium'/'low' (`job-tracker.html:824`) | priority | text | `\|\| null` | |
| date | 'YYYY-MM-DD' or '' | job_date | text | `\|\| null` | The DDL comment says it stays text because of ''. Sources: `<input type=date>` (`job-tracker.html:826`), quick-add regex-gated ISO (L1319), `todayDateStrBusinessTz()`, and the booking Intl parts (`workspace.html:3120-3123`). All ISO. |
| status | 'not-started'/'in-progress'/'done' (`job-tracker.html:828`) | status | text | `\|\| null` | |
| notes | string | notes | text | `\|\| null` | |
| showOnCalendar | bool (true on new records; absent on template jobs) | show_on_calendar | boolean not null default false | `!!` | |
| statusChangedAt | ISO timestamp string | status_changed_at | timestamptz | `\|\| null` | |
| createdBy | email string or null | created_by | text | `\|\| null` | |
| lastEditedBy | email string or null | last_edited_by | text | `\|\| null` | |
| referredBy | string ('' default) | referred_by | text | `\|\| null` | The backfill SQL predates this column and doesn't insert it. |
| hoursWorked | number or null (`parseFloat \|\| null` L1417; clock rounds to 0.01) | — | — | not mirrored | |
| clockSince | ISO string or null | — | — | not mirrored | |
| timeLog | array `[{start ISO, end ISO, hours number}]` | — | — | not mirrored | |
| texts | array `[{at ISO, key string}]` (last 20) | — | — | not mirrored | |
| noInvoice | bool | — | — | not mirrored | |
| confirmationSentAt | ISO string | (confirmation_sent_at) | timestamptz | not mirrored (server writes the column itself) | The blob copy is a local echo of the server's value. |
| (none) | | tenant_id | uuid | trigger | |
| (none) | | cancel_token, cancelled_at, reschedule_requested_date, reschedule_requested_at | uuid / timestamptz / text / timestamptz | server-only | |
| (none) | | created_at, updated_at | timestamptz | default now() | not the record's real times |

- **Blob-only, lost today:** hoursWorked, clockSince, timeLog, texts, noInvoice. confirmationSentAt exists server-side under its own column.
- **Table-only, not fed by the mirror:** tenant_id (trigger), cancel_token, cancelled_at, reschedule_requested_date, reschedule_requested_at, confirmation_sent_at (all server-written), created_at, updated_at.
- The reverse gap matters too: the server-side cancel and reschedule state never flows back into the blob (I found no reader that copies it into th_tracker_jobs). At cutover it has to be kept, not overwritten from the blob.
- `isUnconvertedBooking` shows up in reads but is a render-time flag, not stored.

---

### 2. Invoices: `th_invoices` to `public.invoices` + `public.invoice_line_items`

#### 2a. Blob write sites
| Site | What |
|---|---|
| `tools/invoice-generator.html:2632-2678` `logInvoice()` | the only create path (L2643-2670) |
| `tools/invoice-generator.html:1364-1379` `toggleInvoicePaid()` | `paidAmount = paid ? total : 0`, `paid` |
| `tools/workspace.html:2397-2425` `togglePaid()` | `paidAmount = 0` or `total`, `paid = invoicePaymentStatus(inv)==='paid'` |
| `tools/data-layer.js:1157-1166` `thLogInvoiceReminder()` | `reminders` array. thWrite, **no mirror**. |
| `tools/sync.js:741-750` applySyncData post-merge | recomputes `paid` through `deriveInvoicePaid` |
| `tools/invoice-generator.html:2537` delete, plus `dev-tools.html:3375,3392` restore | |
| server: `edge-functions/stripe-webhook-index.ts:396-410` | **mutates the blob directly**: sets `inv.paid = true` only, never `paidAmount` |

#### 2b. Mapping
Mirror: `tools/sync.js:1346-1358`. deriveInvoicePaid: `sync.js:1337-1344`.

| blob field | type as written | column | column type | mirror transform | notes |
|---|---|---|---|---|---|
| id | number `Date.now()` | id | bigint PK | as-is | |
| invoiceNumber | string (from input) | invoice_number | text | `\|\| null` | |
| clientName | string, '(no name)' if blank | client_name | text | `\|\| null` | |
| clientId | 'c_…' or undefined | client_id | text | `\|\| null` | |
| clientEmail | string or null | client_email | text | `\|\| null` | |
| date | 'YYYY-MM-DD' (`<input type=date>` L659, fallback `todayDateStrBusinessTz()`) | invoice_date | text | `\|\| null` | legacy long-format values, see §8 |
| terms | 'Due Upon Receipt'/'Net 15'/'Net 30' (L663-667) | terms | text | `\|\| null` | |
| invoiceType | 'standard'/'deposit'/'balance'/'progress' (L687-691) | invoice_type | text | `\|\| null` | older invoices may lack it (unverified) |
| subtotal | number, **unrounded float** sum of qty*price | subtotal | numeric | `?? null` | |
| tax | number, rounded to cents | tax | numeric | `?? null` | |
| discount | number, raw `parseFloat` (not rounded) | discount | numeric | `?? null` | |
| total | number, rounded to cents | total | numeric | `?? null` | |
| paid | bool | paid | boolean not null default false | **derived**: `deriveInvoicePaid(entry)`, not the blob value | |
| paidAmount | number, **absent on legacy and new-unpaid invoices** (logInvoice never sets it) | paid_amount | numeric | `?? null` | null means legacy, fall back to `paid` |
| jobRefId | **string** ('' or select value) | job_id | bigint FK jobs on delete set null | `entry.jobRefId ? Number(entry.jobRefId) : null` | an FK violation if the job isn't mirrored yet (recorded failure) |
| jobRefTitle | string | job_ref_title | text | `\|\| null` | denormalized copy |
| sourceQuoteId | number or undefined | source_quote_id | bigint FK quotes | `\|\| null` | |
| generatedBy | email or null | generated_by | text | `\|\| null` | |
| line_items | array (from 2026-09-06; **undefined before that**) | invoice_line_items rows | — | delete-then-insert, `mirrorReplaceLineItems` (sync.js:1205-1240) | not atomic, and races the parent upsert |
| reminders | array `[{at ISO, channel 'text'/…, step 1-3}]` | — | — | not mirrored | |
| (none) | | tenant_id, created_at, updated_at | | trigger / default | |

**invoice_line_items** (`sync.js:1224-1228`; backfill `backfill_relational_jobs_invoices_contracts.sql:47-61`):

| item field | type | column | type | transform |
|---|---|---|---|---|
| (array index) | | sort_order | int | `idx` |
| desc | string | description | text | `\|\| null` |
| part | string | part | text | `\|\| null` |
| qty | number (`parseFloat \|\| 0`, **not clamped** in `getLineItems` L2156, although `recalc` clamps it for totals) | qty | numeric | `?? null` |
| price | number (same) | price | numeric | `?? null` |
| amount | number `qty*price`, unrounded | amount | numeric | `?? null` |
| taxable | bool | taxable | boolean | `!!` |
| type | ''/'labor'/'mileage'/'part'/'other' (L1673) | item_type | text | `\|\| null` ('' becomes null) |
| (none) | | id bigserial, invoice_id, tenant_id | | generated / parent / trigger |

- **Blob-only, lost today:** `reminders`. Also any legacy field I didn't find (unverified).
- **Read but never written:** `clientAddress` (`data-layer.js:527`) and `clientPhone` (`tools-nav-pwa.js:1511`) are read from invoices, but `logInvoice()` never stores them. The address and description typed on the form (`clientAddress`, `jobDescription`, discount label, tax rate, contacts) are **never persisted** on the blob record.
- **Table-only, not fed:** tenant_id, created_at, updated_at.
- The mirror doesn't run for `thLogInvoiceReminder` or the stripe-webhook blob mutation. Stripe payments reach `public.invoices.paid` only when some device re-mirrors that invoice.

---

### 3. Quotes: `th_quotes` to `public.quotes` + `public.quote_line_items`

#### 3a. Blob write sites
- Create: `tools/invoice-generator.html:2745-2781` `logQuote()` (object L2757-2775).
- Convert: `invoice-generator.html:2680-2689` sets `status='converted'` and `convertedToInvoiceId = newEntry.id`, then mirrors.
- Delete: L2730. Restore: `dev-tools.html:3393`.
- Portal statuses (accepted/declined, respondedAt, declineReason) are fetched into memory only (`portalQuoteInfoBySourceId`, L2908-2943) and **never written to the blob**.

#### 3b. Mapping (mirror `sync.js:1360-1371`)
| blob field | type | column | column type | transform | notes |
|---|---|---|---|---|---|
| id | number `Date.now()` | id | bigint PK | as-is | |
| quoteNumber | string | quote_number | text | `\|\| null` | |
| clientName | string, '(no name)' | client_name | text | `\|\| null` | |
| clientId | 'c_…' or undefined | client_id | text | `\|\| null` | |
| **(never set)** clientEmail | — | client_email | text | `entry.clientEmail \|\| null` so **always null** | the email is used only for the portal send (L3042-3059) and never saved on the record |
| date | 'YYYY-MM-DD' (`<input type=date>` L827 / `todayDateStrBusinessTz`) | quote_date | text | `\|\| null` | |
| subtotal/tax/discount/total | numbers (same rules as invoices, `recalcQuote` L2074-2101) | subtotal/tax/discount/total | numeric | `?? null` | |
| status | 'pending' / 'converted' | status | text | `\|\| null` | |
| jobRefId | string | job_id | bigint FK | `? Number() : null` | |
| jobRefTitle | string | job_ref_title | text | `\|\| null` | |
| generatedBy | email or null | generated_by | text | `\|\| null` | |
| convertedToInvoiceId | number | converted_to_invoice_id | bigint FK invoices | `\|\| null` | |
| line_items | array (same shape as invoices, `getQuoteLineItems` L2103-2115) | quote_line_items | same columns as invoice_line_items | `mirrorReplaceLineItems` | |
| (none) | | tenant_id, created_at, updated_at | | | |

- **Blob-only:** none.
- **Table-only, not fed:** client_email (the mirror maps it, but the blob never has it), tenant_id, created_at, updated_at.
- The backfill SQL didn't insert quotes because th_quotes was empty on 2026-09-08 (`backfill…sql:4-7`).

---

### 4. Contracts: `th_contracts` to `public.contracts`

#### 4a. Blob write sites
- Create only: `tools/contract-generator.html:1076-1096` `generateAndLog()` (`log.push` L1084-1092). There's no edit path; delete is at L787 and restore at `dev-tools.html:3394`.

#### 4b. Mapping (mirror `sync.js:1373-1379`)
| blob field | type | column | column type | transform | notes |
|---|---|---|---|---|---|
| id | **number = `max(existing ids)+1`** (L1077): 1, 2, 3… | id | bigint PK | as-is | Not Date.now(). Two devices offline would mint the same id. This also feeds `client_portal_contracts.source_contract_id`. |
| type | 'pwo'/'stpa'/'ltsa' | contract_type | text | `\|\| null` | |
| fields | object of **strings** (`collectFields` L1061-1068). Keys per type are at L1055-1058: clientName, serviceAddress, phone, email, workOrderDate/agreementDate/startDate/completionDate (ISO from `<input type=date>`), laborPrice/partsPrice/totalPrice/deposit/balance/rate (free-text money like "$0.00"), description, term, frequency, preferredWindow, billingFrequency | fields | jsonb | `\|\| null` | |
| clientId | 'c_…' or undefined | — (**no client_id column on contracts**) | — | not mirrored | |
| dateGenerated | string **'Sep 30, 2026'** (`toLocaleDateString('en-US',{month:'short'…})` L1088) | date_generated | text | `\|\| null` | non-ISO, stored as-is |
| dateGeneratedISO | 'YYYY-MM-DD' from `toISOString().slice(0,10)`, which is **the UTC date** and can land a day ahead in the Denver evening | — | — | not mirrored | the reliable date. client-detail.html:617 and contract-generator.html:606 read it |
| signedByClient | bool | — | — | not mirrored | |
| signedByBusiness | bool | — | — | not mirrored | |
| **(never set)** generatedBy | — | generated_by | text | `\|\| null` so **always null** | |
| (none) | | job_id bigint FK | | **never sent** | the contract blob has no jobRefId |
| (none) | | tenant_id, created_at | | trigger / default | contracts has no updated_at column |

- **Blob-only, lost today:** clientId, dateGeneratedISO, signedByClient, signedByBusiness.
- **Table-only, not fed:** job_id (always null), generated_by (always null), tenant_id, created_at.
- A related bug: `contract-generator.html:1081` and `data-layer.js:533` read `fields.clientPhone / clientAddress / clientEmail`, but the real keys are `phone / serviceAddress / email`. So contracts never enrich the client registry with contact details.

---

### 5. Expenses: `th_expense_log` (no table yet)

#### Write sites
- `tools/finance.html:1181-1270` `addExpense()`: create or edit. An edit **replaces the whole entry** (L1261), not a merge; createdBy is carried over from the existing entry.
- `tools/job-tracker.html:1640-1709` `submitQuickExpense()`: create (object L1699-1704).
- Delete with tombstone in finance.html (not shown). Restore through the graveyard.

#### Shape (union)
| field | type | set at | notes |
|---|---|---|---|
| id | number `Date.now()` | finance.html:1216; job-tracker.html:1678 | also the storage path `expense-${id}/…` (`sync.js:~2690`) |
| date | 'YYYY-MM-DD' (input; quick uses `todayDateStrBusinessTz()` fallback) | 1215 / 1644 | |
| type | 'expense' / 'mileage' (finance.html:495) | | |
| desc | string | | |
| vendor | string | | |
| payment | 'cash'/'card'/'check'/'venmo'/'cashapp'/'other' | finance.html:505-510 | |
| jobRefId | **string** ('' or job id) | | |
| jobRefTitle | string | | denormalized |
| receiptPath | string ('' for mileage) | | a Supabase storage key |
| partNumber | string ('' for mileage) | | |
| amount | number. Mileage is `Math.round(miles*rate*100)/100`; an expense is raw `parseFloat` | finance.html:1231/1233; job-tracker.html:1663/1665 | |
| miles | number (0 for an expense) | | |
| createdBy / lastEditedBy | email or null | | |

Proposed table columns: `id bigint pk` (keep the id), tenant_id, entry_date date, type text check in (expense, mileage), description, vendor, payment, job_id bigint FK jobs (from jobRefId, '' becomes null), job_ref_title (or drop it in favor of a join), receipt_path, part_number, amount numeric(12,2), miles numeric, created_by, last_edited_by, created_at/updated_at (created_at can be derived as `to_timestamp(id/1000.0)`), deleted_at.

---

### 6. Income: `th_income_log` (no table yet)

#### Write sites
| Site | origin | Shape notes |
|---|---|---|
| `tools/finance.html:898-929` `addIncomeEntry()` | 'manual' | id `Date.now()`; edit is a spread merge (L922) |
| `tools/invoice-generator.html:2609-2630` `logInvoiceToIncomeLog()` | 'invoice' | id `Date.now()+1`; `date: invoiceEntry.date`; `amount: invoiceEntry.total`; `source: clientName`; `payment: ''`; `invoiceId`; createdBy and lastEditedBy = generatedBy |
| `tools/finance.html:1009-1032` `backfillLegacyInvoicesIntoIncomeLog()` (runs on **every** renderIncomeEntries) | 'invoice' | id `Date.now()+idx`; **no createdBy/lastEditedBy**; `amount: i.total \|\| 0` |
| `edge-functions/create-pos-charge-index.ts:238-254` | 'pos' | id `Date.now()` (server); `payment: 'Stripe (POS)'`; `stripePaymentIntentId` |
| `edge-functions/stripe-webhook-index.ts:239-255` | 'pos' | same; `amount: Number(pi.metadata.pos_amount)` or `pi.amount/100` |
| `invoice-generator.html:2577-2586` delete-with-invoice | — | removes origin='invoice' entries with a matching invoiceId |

#### Shape (union)
| field | type | notes |
|---|---|---|
| id | number (Date.now(), +1, +idx) | |
| date | string. ISO for manual and POS. **Copied from invoice.date** for origin='invoice', so it inherits any legacy long-format invoice date. | |
| desc | string ('Invoice #…' for invoice-origin) | |
| amount | number | manual is raw parseFloat; invoice-origin equals the invoice total |
| source | string (client name, or client email for webhook POS) | |
| payment | 'cash'…'other' / '' (invoice) / 'Stripe (POS)' | outside the select's option list |
| jobRefId | string ('' or id) | |
| jobRefTitle | string | |
| origin | 'manual' / 'invoice' / 'pos' | |
| invoiceId | number (invoice id) | only for origin='invoice' |
| stripePaymentIntentId | string | only for origin='pos' |
| createdBy / lastEditedBy | email / '' / absent (backfill) | |

Recommendation: invoice-origin income rows duplicate invoice data. Every reader already filters them out (`e.origin !== 'invoice'`, e.g. data-layer.js:1199, 1668; finance.html:681). Consider not migrating them as rows at all, since the invoice is the source of truth, or migrating them with an `invoice_id` FK (on delete cascade). Proposed columns for manual and POS: id bigint pk, tenant_id, entry_date date, description, amount numeric(12,2), source, payment, job_id FK, origin, invoice_id FK, stripe_payment_intent_id text unique, created_by, last_edited_by, timestamps.

---

### 7. Contacts (`th_tracker_contacts`) and clients (`th_clients`) to the new `clients` table

#### Contacts
- Write site: `tools/job-tracker.html:3036-3064` `addContact()` (create L3055, edit spread L3052). Delete at L3090-3102.
- Shape: `{ id: number Date.now(), name: string, role: string, phone: string, email: string, notes: string }`. No address, no clientId link. Readers: contract-generator.html:526-550 (picker), invoice-generator.html:3116, workspace.html:1820, data-layer.js:529 (backfill source).

#### Clients registry
- Write sites: `data-layer.js:619-669` `thEnsureClient()` (create L657-665, fill-only enrichment L622-638); `data-layer.js:545-583` `thBackfillClients()` (create L562-571); `data-layer.js:485-495` `thDeleteClient()`; `client-detail.html:680-688` undo-delete (re-push); `clients.html:2219` (through thEnsureClient).
- Callers of thEnsureClient: job-tracker.html:1397, invoice-generator.html:2636/2750, contract-generator.html:1080, workspace.html:3133, clients.html:2219. Backfill runs in workspace.html:4778 (once per device) and clients.html:2255/2269 (on load).
- Shape: `{ id: 'c_'+Date.now().toString(36)+'_'+rand6 (string), name, phone, address, email (strings, '' default), createdAt: ISO, source: 'created'|'backfill' }`. Nothing in the repo edits name or phone on an existing record other than the fill-only enrichment.

#### Proposed mapping to `clients`
| source field | clients column | transform |
|---|---|---|
| th_clients.id ('c_…') | **legacy_id text unique** (new); id uuid is newly generated | jobs, invoices, quotes and contracts' `client_id text` hold these 'c_…' strings today, so the FK backfill must join on legacy_id |
| th_contacts.id (number) | legacy_contact_id bigint (suggested) | these share no id space with clients |
| name / contact.name | display_name | trim |
| email | email | trim. Normalized: `lower(trim(email))` |
| phone | phone | trim. Normalized: digits only |
| (name) | normalized_name | same rule as `thNormalizeClientName` (data-layer.js:153-155): `lower(trim(x))` with runs of whitespace collapsed to one space |
| address | **no column in the spec**. Would be lost. | add an `address` column, or decide to drop it |
| createdAt | created_at | ISO to timestamptz |
| source | (optional) seed_source | 'created'/'backfill'/'contact'/… |
| contact.role, contact.notes | **no column in the spec** | role is the likely "not a client" signal (supplier or trade). Keep it on the review queue, or add notes. |
| — | needs_match, merged_into_id, tenant_id, updated_at | new |

- Tombstones: `th_client_tombstones` `{id, normalizedName, deletedAt, restoredAt?}` (data-layer.js:197-202). A deleted client whose name is still on jobs must **not** be re-seeded (same rule as `thBackfillClients` L551-554).
- The `client_profiles` DDL isn't in the repo (only ALTERs). **Checked live:** `client_email text not null`, `display_name`, `phone`, `updated_at`, `tenant_id`. There is no id column; rows are keyed by `client_email`.

---

### 8. Dates

#### How they're stored
| Kind | Format | Where |
|---|---|---|
| Business dates (job.date, invoice.date, quote.date, expense/income.date, contract fields.*Date) | 'YYYY-MM-DD' from `<input type=date>` or `dateStrBusinessTz()` (`tools-dialogs.js:148-158`, America/Denver) | all current create paths |
| Event timestamps (statusChangedAt, clockSince, timeLog.start/end, texts.at, reminders.at, createdAt, tombstone deletedAt, confirmationSentAt) | `new Date().toISOString()` (UTC ISO) | data-layer.js, job-tracker.html |
| Record ids | `Date.now()` ms numbers (not dates, but they encode creation time) | everywhere except contracts and clients |
| contract.dateGenerated | **'Sep 30, 2026'** (short month, en-US) | contract-generator.html:1088 |
| contract.dateGeneratedISO | UTC 'YYYY-MM-DD' | contract-generator.html:1089 |

#### The long-format invoice date ("July 29, 2026")
- **Producer: not found in the current code.** Every invoice create path writes `<input type=date>` or `todayDateStrBusinessTz()` (invoice-generator.html:2648). No stored invoice date is formatted with `toLocaleDateString`. Long formatting is display-only: PDF `longDate` at invoice-generator.html:2224-2236, 2981; job-detail.html:488, 884. The only claim of the legacy data is `docs/ITEM-1-MIGRATION-PLAN.md:70` ("before the date-input fix"). The README and specialist logs say nothing about it. **Checked live on 2026-09-30:** all 4 blob invoice dates and all 4 relational `invoice_date` values are ISO `YYYY-MM-DD`; the only long-format date in the live data is the one contract's `dateGenerated`. A device that hasn't synced since could still hold one, so the conversion rule below still applies.
- **It spreads:** `logInvoiceToIncomeLog` (invoice-generator.html:2613) and `backfillLegacyInvoicesIntoIncomeLog` (finance.html:1020) copy `invoice.date` into th_income_log. The mirror copies it verbatim into `invoices.invoice_date` (text). sync-invoice-to-portal would send it to `client_portal_invoices.invoice_date date not null` (`sql/portal/create_client_portal_tables.sql:21`).
- **Where it breaks** (the pattern is `new Date(x + 'T00:00:00')`, which gives Invalid Date for "July 29, 2026T00:00:00"):
  - `data-layer.js:763-768` `thInvoiceDueDate` returns null. So `thInvoiceIsOverdue` is false (L769-775), `thInvoiceNeedsReminder` is false (L1169-1173), and the reminder text has no due date. **These invoices are never overdue and never get reminders.**
  - `data-layer.js:1234-1240` `thWeekSummary.addMoney` skips them, so they're not counted as billed.
  - `workspace.html:1930-1935` `getDueDate` returns null, so the Dashboard never marks them overdue.
  - `runway-dashboard.html:3809` has no isNaN guard. The due date is Invalid, `<` compares false, so it's silently not overdue.
  - `edge-functions/send-push-index.ts:411-412` skips the overdue push; L762-764 leaves it out of weekly "invoiced this week".
  - `edge-functions/send-payment-reminder-index.ts:124-131` `daysOverdue` returns null, so the client payment-reminder email is never sent for these invoices.
  - String comparisons and sorts: `data-layer.js:788-790` `touch()` compares `date > row.lastActivity` as strings. 'J' (0x4A) sorts after '2' (0x32), so **"July 29, 2026" wins as the client's lastActivity**. `client-detail.html:600`, `invoice-generator.html:1772` and `tools-nav-pwa.js:2592` `localeCompare` sort these out of order.
  - CSV: `finance.html:1109` writes `${e.date}` unquoted, so the comma in "July 29, 2026" shifts every income CSV column for inherited rows.
- **Code that tolerates it:** `finance.html:1037,1103` sort with `new Date(e.date)` (no 'T00:00:00' suffix). V8 parses "July 29, 2026" as local midnight, but a mixed sort is skewed by timezone because ISO 'YYYY-MM-DD' parses as UTC. On the server side, Postgres date input should accept 'July 29, 2026' ("January 8, 1999" is in the PG docs' unambiguous-input table). Not tested here.

#### Proposed conversion rule (backfill)
1. `^\d{4}-\d{2}-\d{2}$`: keep it, cast to `date`.
2. `^[A-Za-z]{3,9}\.? \d{1,2}, \d{4}$` (long or short month names, which covers invoice legacy and contract `dateGenerated`): parse with `to_date(regexp_replace(x,'\.',''),'FMMonth FMDD, YYYY')`, falling back to `'Mon DD, YYYY'`. Accept only if re-formatting gives back the same components, then store ISO.
3. '' or null: null (jobs allow a null date; invoices fall back to `to_timestamp(id/1000) at time zone 'America/Denver'`::date **only if flagged for review**, never silently).
4. Anything else: goes to the manual-review list, and the row isn't dropped.
5. For contracts, prefer `dateGeneratedISO`. If it's missing, parse `dateGenerated` with rule 2. Note that dateGeneratedISO is a UTC date: `to_timestamp(id…)` isn't usable because contract ids are small ints.
6. Event timestamps: `::timestamptz`. `created_at` for Date.now()-id entities is `to_timestamp(id/1000.0)`.
7. Target column types: `date` for business dates, `timestamptz` for events. Keep jobs' '' as NULL.

---

### 9. Money

- **JS representation:** plain JS numbers (floats) in every blob record. No cents integers, no strings. The exception is contract `fields.*Price/deposit/balance/rate`, which are **free-text strings** like "$150.00".
- **Rounding points:**
  - invoice/quote `tax = Math.round(taxable*rate/100*100)/100` and `total = Math.round(max(0, subtotal+tax-discount)*100)/100` (invoice-generator.html:2033, 2040; 2094, 2096).
  - `subtotal` is **unrounded** (a sum of `qty*price` floats). `discount` is an unrounded parseFloat. Line `amount = qty*price` is unrounded (L2112, 2160).
  - Mileage `amount = Math.round(miles*rate*100)/100` (finance.html:1231; job-tracker.html:1663).
  - `hoursWorked` rounds to 0.01 (data-layer.js:1022).
  - Display and aggregate paths round in cents: `thInvoiceBalance` (data-layer.js:759-762), `thGetClientDirectory` (L834-837), `thWeekSummary` (L1255-1256), workspace.html `toCents` (L1953), runway-dashboard.html `invoiceRemainingBalance` (L3086-3092), send-push-index.ts `getRemainingCents` (L123-126).
- **paid vs paidAmount:**
  - `paid` (bool) is legacy and derived. `paidAmount` (number) arrived with partial payments.
  - Legacy rule, used everywhere: if paidAmount is absent or null, then paid means `total`, otherwise 0 (workspace.html:1942-1945, data-layer.js:755-758, sync.js:1339-1341, runway 3086-3090, send-push-index.ts:124-125).
  - `deriveInvoicePaid` (sync.js:1337-1344): `totalCents = round(total*100)`, `paidCents = round(paidAmount*100)`, paid when `totalCents > 0 && paidCents >= totalCents`. **So a $0 invoice is never "paid"** in the relational `paid` column.
  - The mirror sends the derived `paid` but raw `paid_amount` (`?? null`), so a legacy invoice keeps `paid_amount = null`.
  - Potential inconsistency (not verified at runtime): `stripe-webhook-index.ts:401-404` sets `inv.paid = true` without setting `paidAmount`. If the invoice has `paidAmount: 0` (it was ever toggled unpaid on the Dashboard or Invoice Generator), the next `applySyncData` post-merge pass (sync.js:747-750) recomputes `paid` from paidAmount=0 and **flips it back to false**. A card payment would then show as unpaid locally.
- **Postgres:** every money column is unconstrained `numeric` (subtotal, tax, discount, total, paid_amount, line qty/price/amount). Floats like 125.00000000000001 are stored verbatim. reconcile_blob_vs_relational.sql already rounds to 2 when comparing (L28-29, 75).
- **Backfill rule proposal:** `round(x::numeric, 2)` into `numeric(12,2)` for subtotal, tax, discount, total, paid_amount and expense/income amount. For line items, qty should stay `numeric` (it can be fractional hours). Round price and amount to 2. Flag rows where `round(subtotal+tax-discount,2) <> total` for review. For legacy invoices, derive `paid_amount = case when paid then total else 0 end` only if the new schema drops the nullable-legacy semantics; otherwise keep null and document it.

---

### 10. IDs and references

| Entity | id generation | type | site |
|---|---|---|---|
| job | `Date.now()` | number | job-tracker.html:1425, 2012; workspace.html:3140 |
| invoice | `Date.now()` | number | invoice-generator.html:2644 |
| quote | `Date.now()` | number | invoice-generator.html:2758 |
| contract | `max(ids)+1` | number (small int) | contract-generator.html:1077 |
| expense | `Date.now()` | number | finance.html:1216; job-tracker.html:1678 |
| income | `Date.now()`, `+1`, `+idx`; server `Date.now()` | number | finance.html:924, 1019; invoice-generator.html:2613; edge functions |
| contact | `Date.now()` | number | job-tracker.html:3054 |
| client | `'c_' + Date.now().toString(36) + '_' + rand(6)` | string | data-layer.js:566, 658 |
| graveyard | `'gy_' + …` | string | data-layer.js:386 |

References:

| Referencing field | Type held | Points to | Relational column | Compare style |
|---|---|---|---|---|
| invoice.jobRefId / quote.jobRefId / expense.jobRefId / income.jobRefId | **string** ('' = none; `<select>` value) | job.id | invoices.job_id / quotes.job_id bigint FK (`Number()` in the mirror); none yet for expense/income | `String(x) === String(job.id)` (data-layer.js:863, 868, 894, 1671-1673) |
| invoice.sourceQuoteId | number or undefined | quote.id | invoices.source_quote_id bigint FK | |
| quote.convertedToInvoiceId | number | invoice.id | quotes.converted_to_invoice_id bigint FK | |
| income.invoiceId | number | invoice.id | none yet | `===` (invoice-generator.html:2527, 2580) |
| job/invoice/quote/contract.clientId | string 'c_…' | th_clients.id | jobs/invoices/quotes.client_id **text, no FK**; contracts has none | |
| th_job_photos.job_id | job.id as passed (sync.js:1920; storage path `job-${jobId}/…` L1876) | job.id | `bigint`, nullable (checked live; DDL not in repo) | `job_id=eq.${jobId}` (sync.js:1937) |
| referrals.referred_job_id | job.id number (sync.js:1270) | jobs.id | bigint FK on delete set null (`create_referral_program.sql:25`) | referrer is referenced by **name text** (`referrer_name`) |
| th_bookings.job_id | job.id (sync.js:1673) | | bigint (`create_booking_system.sql:17`) | |
| client_portal_jobs/invoices/quotes/contracts.source_*_id | blob ids | | bigint not null (sql/portal/*) | |
| manage-job.html token | `jobs.cancel_token` uuid, keyed to jobs.id | | | |
| expense receipt storage path | `expense-${expense.id}/…` | | | |
| tombstones / graveyard | record id (`String(t.id) === String(id)`) | | | |

Implications:
- Every blob id except clients fits `bigint`, so keep them as PKs (plan principle 3).
- New clients need `legacy_id` for the 'c_…' strings.
- **Contract ids aren't globally unique across devices.** There are no duplicates today (checked live 2026-09-30); recheck before cutover, and consider switching to `Date.now()` or a uuid.
- Phase 3c's client-generated UUIDs conflict with the `bigint` PKs and every bigint FK above (portal source_*_id, referrals, th_bookings, and th_job_photos, unverified). Either keep bigint ids minted client-side (Date.now() collides across devices in the same ms, so it would need a random suffix) or add a uuid column alongside.
- `jobRefId` string vs number: relational reads return a number (sync.js:1742). Callers already `String()`-compare, but strict `===` sites should be audited (e.g. `j.id !== id` job-tracker.html:1767 works on blob numbers).

---

## 4. Tombstones and how deletes propagate



### 1. Tombstone keys, what each protects, record shape, writers

#### Keys (tools/sync.js SYNC_DATA_KEYS, lines 112-247; wiki keys in WIKI_SYNC_KEYS, 105-109)

| Tombstone key (sync.js line) | Protects data key | Writer (tools/data-layer.js unless noted) |
|---|---|---|
| th_job_tombstones (116) | th_tracker_jobs (117) | thAddJobTombstone :214 |
| th_client_tombstones (123) | th_clients (124) | thAddClientTombstone :197 |
| th_expense_tombstones (132) | th_expense_log (133) | thAddExpenseTombstone :229 |
| th_income_tombstones (134) | th_income_log (135) | thAddIncomeTombstone :238 |
| th_contact_tombstones (136) | th_tracker_contacts (137) | thAddContactTombstone :247 |
| th_note_tombstones (141) | th_tracker_notes_v2 (142) | thAddNoteTombstone :472 |
| th_price_ref_tombstones (144) | th_price_reference (145) | thAddPriceRefTombstone :292 |
| th_inventory_tombstones (149) | th_inventory (150) | thAddInventoryTombstone :303 |
| th_invoice_tombstones (154) | th_invoices (155) | thAddInvoiceTombstone :269 |
| th_quote_tombstones (156) | th_quotes (157) | thAddQuoteTombstone :278 |
| th_template_tombstones (162) | th_job_templates (163) | thAddTemplateTombstone :312 |
| th_contract_tombstones (164) | th_contracts (165) | thAddContractTombstone :256 |
| th_known_issue_tombstones (195) | th_known_issues (196) | thAddKnownIssueTombstone :321 |
| th_flagged_tombstones (202) | th_flagged_items (203) | thAddFlaggedTombstone :465 |
| th_review_requests_pending_tombstones (239) | th_review_requests_pending (240) | addPendingTombstone, tools/review-request.html:988 (a local copy; this page does not load data-layer.js) |
| th_shift_tombstones (245) | th_shift_log (246) | thAddShiftTombstone :1280 |
| th_pr_unit_tombstones (wiki, 106) | th_parts_reference_units (108) | thAddPrUnitTombstone :330 (writes through thWriteWiki) |
| th_pr_issue_tombstones (wiki, 107) | issues nested in th_parts_reference_units | thAddPrIssueTombstone :351 (thWriteWiki) |

Each tombstone key is listed in MERGE_KEY_FIELD with keyField `'id'` (sync.js 353-398). The same pairs are mapped in `ID_TOMBSTONE_KEY_FOR` inside applySyncData (sync.js 630-647). The two wiki keys are not in that map and have their own branch (sync.js 752-763).

Other deletion markers that are not per-record tombstones:
- `th_client_errors_cleared_at` (178): one cutoff timestamp for the error log.
- `th_graveyard` entries carry a `removedAt` mark (see section 5).

#### Record shape
- The common shape is `{ id, deletedAt: ISO string }`. Every thAdd*Tombstone writes exactly this.
- Clients add a name: `{ id, normalizedName, deletedAt }` (data-layer.js:200). thBackfillClients uses normalizedName (data-layer.js:553-555) so it does not recreate a deleted client by name.
- Wiki issues: `{ id: unitId + '::' + issueId, unitId, issueId, deletedAt }` (data-layer.js:354).
- Restore adds `restoredAt: ISO` (thLiftTombstone, data-layer.js:415-425). If the device has no tombstone for that id, Restore pushes a new one already lifted: `{ id, ...extra, deletedAt: now, restoredAt: now }`.
- So the id and the timestamp are both always present. The timestamp is the deleting device's clock, so clock skew between devices matters (unverified how much).

#### Write path
Every writer does the same four steps: `thRead` the list, run `thPruneTombstones`, push the new entry, then `thWrite` (or `thWriteWiki`). `thWrite` (data-layer.js:84) sets localStorage and calls `scheduleSync()`, so writing a tombstone queues a debounced push by itself.

---

### 2. Delete call sites for the migrated entities

| Entity | Call site | Tombstone? | Graveyard? | Relational delete? | Undo |
|---|---|---|---|---|---|
| Job (single) | deleteJob, tools/job-tracker.html:1714 (commit at 1767-1770) | yes, :1768 | yes, :1770 | mirrorDelete('jobs'), :1769 | 6 s deferred timer |
| Job (bulk) | bulkDeleteJobs, job-tracker.html:2165 (commit at 2200-2207) | yes, :2203 | yes, :2205 | mirrorDelete('jobs'), :2204 | one shared 6 s timer |
| Invoice | deleteInvoiceLogEntry, tools/invoice-generator.html:2524 (commit at 2534-2562) | yes, :2538 | yes, :2540 | mirrorDelete('invoices'), :2539 | 6 s timer |
| Income linked to an invoice (cascade) | removeIncomeEntriesForInvoice, invoice-generator.html:2578 | yes, :2584 | **no** | n/a (no table) | none of its own |
| Quote | deleteQuoteLogEntry, invoice-generator.html:2721 | yes, :2731 | yes, :2733 | mirrorDelete('quotes'), :2732 | 6 s timer |
| Contract | deleteContractLogEntry, tools/contract-generator.html:776 | yes, :786 | yes, :788 | mirrorDelete('contracts'), :787 | 6 s timer |
| Expense | deleteExpense, tools/finance.html:1333 | yes, :1353 | yes, :1345 (taken before the receipt file is deleted) | n/a | 6 s timer |
| Expense (clear all) | clearAllExpenses, finance.html:1366 | yes, per entry :1371 | yes, per entry | n/a | none |
| Income | deleteIncomeEntry, finance.html:967 | yes, :981 | yes, :982 | n/a | 6 s timer |
| Income (clear all) | clearAllIncome, finance.html:994 | yes, per entry :1000 | yes, per entry | n/a | none |
| Contact | deleteContact, job-tracker.html:3095 | yes, :3103 | yes, :3104 | n/a | none (deletes right away) |
| Client | thDeleteClient, data-layer.js:485, called from client-detail.html:664 (deleteThisClient) and dev-tools.html:1434 (deleteClientFromRegistry) | yes, :491 | yes, :492 | n/a (no table) | client-detail has an Undo button (undoDeleteClient, :680), which calls thLiftTombstone |

Every user-facing delete of the 8 entities writes a tombstone. I found no normal UI delete path that skips it.

Gaps to flag:
- **dev-tools.html:1793 deleteLocalDataKey** calls `localStorage.removeItem(key)` for any key and writes no tombstones. The page warns this is "from this device". Because merges are unions, the next pull brings the key back from the server, so it does not act as a delete. It is also a way to wipe a tombstone list locally. It is not a resurrection bug, because the server copy returns.
- **removeIncomeEntriesForInvoice** (invoice-generator.html:2583) writes the income list with raw `localStorage.setItem`, not through saveIncomeEntries. It tombstones the entries but puts no snapshot in the graveyard. Restoring the invoice from the Graveyard does not bring its income entry back; dev-tools.html:3389-3390 says so explicitly.
- **bulkDeleteJobs does not delete the portal copy.** Single deleteJob posts `{delete:true}` to the `sync-job-to-portal` edge function for jobs that are done and have a client email (job-tracker.html:1754-1765). The bulk path has no such call, so client_portal_jobs rows are orphaned. This is a bug.
- **Quotes and contracts are not removed from the portal** (client_portal_quotes / client_portal_contracts) when deleted. Invoices are, through delete-portal-invoice (invoice-generator.html:2592). Unverified whether this is intended.
- **Delete-window loss (unverified):** the 6 s delete runs from a `setTimeout`, and I found no pagehide handler that flushes pending deletes. Navigating away or closing the tab inside that window most likely cancels the delete silently, so the record survives.
- **thEnsureClient** (data-layer.js:619) ignores client tombstones. Saving a job, invoice or quote under a deleted client's name creates a new client with a new id. Only thBackfillClients checks normalizedName. Unverified whether this is intended; it may be the desired "explicit re-use" behavior.
- **Id type:** the pull filter uses `Set.has(r.id)` (sync.js:738), which is strict. thLiftTombstone compares with `String()`. A tombstone id stored with a different type than the record id (number vs string) would not filter. Writers pass the record's own id through, so this is probably fine (unverified).

---

### 3. The merge on pull and push

Where it runs:
- `applySyncData(obj, keys)` (sync.js:570) runs on pull (pullSync, :962).
- It also runs at the start of every push: pushSync fetches the server row and merges it into local (:885-891) before POSTing `collectSyncData()` (:899-926). Every push is therefore merge-then-overwrite.

Per key, inside the loop at sync.js:649:
1. **Tombstone keys** (`/_tombstones$/`, :707) use `mergeTombstones` (:614-628), not the per-field merge. For each id:
   - union of both sides;
   - `deletedAt` = the later of the two;
   - `restoredAt` = the later of the two (dropped if neither side has one);
   - the other fields come from the side with the newer deletedAt.

   This merge needs no base, because both timestamps only move forward.
2. **Data keys** use `mergeRecordArrays(local, remote, 'id', syncBase[k], newConflicts)` (:439-494).
   - The result is the union of both sides by id.
   - When the same id differs on the two sides and a base entry exists, fields are merged three ways: whichever side changed a field relative to the base wins it; if both changed it differently, remote wins and a conflict is logged to th_sync_conflicts.
   - With no base entry, remote wins for the whole record.
   - The base is `th_sync_base` in localStorage, local only (:249-256). It is saved per key after each merge (`saveSyncBaseForKey`, :784, which skips the 4 keys in SYNC_BASE_SKIPPED_KEYS). It is also saved after a successful push (`saveSyncBaseFromPushed`, :276, called at :926). Tombstone keys get a base too, but mergeTombstones never reads it.
3. **Tombstone filter** (:729-740). After merging, the loop reads the paired tombstone list fresh from localStorage via `ID_TOMBSTONE_KEY_FOR[k]`. It keeps only the tombstones that still count:
   - `tombstoneCounts` (:595-601) counts a tombstone when it has no valid `restoredAt`, or when `deletedAt > restoredAt`.
   - Any record whose id is in the counted set is dropped.
   - Wiki units are filtered by unit tombstones, and nested issues by the composite key `unitId::issueId` (:752-763).
4. The filtered array is written to localStorage and becomes the new base.

**Ordering requirement.** Each tombstone key must come before its data key in SYNC_DATA_KEYS / WIKI_SYNC_KEYS. The filter reads the tombstone list from localStorage, so that list has to be merged and written earlier in the same pass. See the comments at sync.js:99-104, 113-123, 125-131 and 140. tests/sync/tombstone-coverage.test.js:23 asserts that applySyncData reads every tombstone list after that list has merged.

**Union semantics.** A plain union cannot tell "never existed" from "deleted". That is the whole reason tombstones exist. Without one, a stale device's push brings a deleted record back everywhere.

**Delete on device A, edit on device B.** The delete wins unconditionally:
- The filter looks only at the tombstone (and restoredAt). It never compares the record's edit time with deletedAt.
- B's edit is dropped silently. No th_sync_conflicts entry is written, because the filter runs after mergeRecordArrays and never produces a conflict. No graveyard snapshot is taken on B.
- The graveyard entry on A holds A's pre-edit snapshot, so a Restore brings back the old version and B's edit is lost for good.
- An edit made after the delete loses too, however much later it is. The only way a record comes back is a restoredAt later than deletedAt (Restore or Undo).
- If B edits and pushes before it ever sees the tombstone, the edited record lands on the server blob. It is filtered out on the next merge on any device that holds the tombstone, and eventually on all of them, because tombstones travel with every push.

If B's pre-push fetch fails (sync.js:892-897), B POSTs its whole local blob and overwrites the server row, including tombstone lists that lack A's entry. A still holds its tombstone locally, and its next merge-then-push puts it back. So the blob converges, but only once A syncs again (unverified timing).

---

### 4. Tombstone lifetime and pruning

- `TOMBSTONE_RETENTION_DAYS = 90`; `thPruneTombstones` (data-layer.js:186-193) drops entries whose deletedAt is older than 90 days and keeps any entry whose deletedAt is malformed.
- Pruning only happens inside the thAdd*Tombstone writers, on the local list, just before a new entry is pushed. review-request.html:988 does its own copy of the same pruning. Nothing prunes on merge, and nothing prunes on a timer.
- **Pruning is effectively a no-op across the sync (unverified, but it follows directly from the code).** mergeTombstones unions local with server. pushSync always merges the server copy in before it pushes. An entry pruned on one device therefore comes back from the server on the next push or pull, and the server keeps the union. Old entries leave the blob only if every copy (the server and every device) drops them, which the merge never does. **In practice, tombstone lists grow without bound**: one small `{id, deletedAt[, restoredAt]}` object per delete, forever. Restore never removes tombstones either; it only adds restoredAt.
- The tests (tests/tools/tombstone-retention.test.js) only check that the writers call prune. None of them models a sync round-trip.
- Size: roughly 50-70 bytes per entry. It is small next to the old 205 KB wiki payload, but it grows on every blob push (unverified: I did not measure the current size).

---

### 5. Graveyard (restore)

**Storage.** Deleted snapshots live in `th_graveyard` (sync key at sync.js:223, merge keyField `graveyardId`):
- Entry shape: `{ graveyardId: 'gy_…', recordType, record, deletedAt }` (thAddToGraveyard, data-layer.js:~399).
- Capped at 200 locally, oldest dropped first (TH_GRAVEYARD_MAX).
- Also capped at 200 after a merge, newest deletedAt kept (mergeGraveyard, sync.js:542-560).
- A bulk "clear all" of expenses or income can therefore push older snapshots out of the graveyard.

**Removal marks.** Restore and "Delete permanently" both set `removedAt` (thRemoveFromGraveyard). Neither removes the entry.
- mergeGraveyard keeps the latest removedAt from either side (the mark only ever goes on, never off).
- `thLoadGraveyard()` hides marked entries.
- Graveyard entries are never pruned apart from the 200 cap. "Delete permanently" only hides the snapshot; the record's tombstone is unchanged and keeps counting.

**Restore flow** (restoreFromGraveyard, tools/dev-tools.html:3424-3469; type table GRAVEYARD_TYPE_CONFIG :3368-3382):
1. If no record with that id is in the list, push the snapshot back into the data key through thWrite (or thWriteWiki).
2. `thLiftTombstone(tombstoneKey, id)` sets `restoredAt = now` on every tombstone for the id, or adds a pre-lifted tombstone if there is none locally (data-layer.js:415-425). The tombstone is **marked, never deleted**. Deleting it used to let the server's union copy bring it back and re-delete the record (the 2026-09-23 fix). A later delete gets a newer deletedAt and counts again.
3. For invoices, quotes, contracts and jobs, the record is re-mirrored to the relational tables (GRAVEYARD_RELATIONAL_MIRROR, :3391-3396). This upserts the row, and for invoices and quotes it also re-replaces the line items from the snapshot.
4. `thRemoveFromGraveyard(graveyardId)`.

**What restore does not bring back:**
- the portal copy;
- the invoice's derived income entry (dev-tools.html:3389-3390);
- deleted photos and receipt files, which are gone for good.

prIssue restores require the parent unit to exist (:3429-3434). Notes and flagged items have tombstones but no graveyard snapshot.

client-detail.html's undoDeleteClient (:680-692) does the same steps as Restore: re-add the client, lift the tombstone, mark the graveyard entry.

---

### 6. How deletes reach the relational tables

**`mirrorDelete(table, id)`** (sync.js:1176-1198):
- Sends one PostgREST `DELETE /rest/v1/{table}?id=eq.{id}`. It is fire-and-forget and never throws.
- A failure (no session, 4xx/5xx, network) is recorded in the device-local `th_mirror_failures` (:1093-1112) and announced with the `th-mirror-failure` event.
- **It is never retried.** Nothing replays th_mirror_failures (job-tracker.html:1176 only reads it for display).

Call sites (the only four):
- `'jobs'`: job-tracker.html:1769 (single) and :2204 (bulk)
- `'invoices'`: invoice-generator.html:2539
- `'quotes'`: invoice-generator.html:2732
- `'contracts'`: contract-generator.html:787

Relational tables and FKs (sql/infra/create_relational_jobs_invoices_quotes_contracts.sql, sql/infra/create_referral_program.sql). The RLS policies are `for all` to authenticated (:143-163), so DELETE is allowed.

| Entity | Relational table | Delete reaches it? | Children / FKs |
|---|---|---|---|
| jobs | public.jobs | yes (mirrorDelete) | invoices.job_id, quotes.job_id, contracts.job_id and referrals.referred_job_id are all `ON DELETE SET NULL` (:54, :89, :125; referral :25) |
| invoices | public.invoices | yes | invoice_line_items `ON DELETE CASCADE` (:65), so line items go with the row; quotes.converted_to_invoice_id is SET NULL (:104) |
| quotes | public.quotes | yes | quote_line_items CASCADE (:110); invoices.source_quote_id SET NULL (:102) |
| contracts | public.contracts | yes | none |
| expenses, income, contacts, clients | **no relational table** | n/a (blob only) | n/a |

Cases where the blob and the relational tables disagree after a delete:
1. **mirrorDelete fails** (offline, expired session, RLS). The blob record is gone but the relational row stays until someone notices. sql/infra/reconcile_blob_vs_relational.sql reports this as `only_in_relational`, but nothing repairs it automatically.
2. **Only the deleting device calls mirrorDelete.** Other devices that later pull the tombstone never touch the relational tables. If the one call is lost, no other device will retry it.
3. **A stale device brings jobs back in public.jobs (unverified, but high confidence).**
   - `saveJobs` (job-tracker.html:1269-1274) and `thSaveClockJobs` (data-layer.js:1010-1014) call `mirrorJobsToRelational(jobs)`, which upserts the device's **whole local jobs list** on every save.
   - A device that has not yet pulled the tombstone upserts the deleted job back into public.jobs on its next job save, even while editing a different job.
   - The blob later filters the job out, but nothing deletes the row again. It stays as a phantom row that calendar.html reads via fetchJobsFromRelational (sync.js:1690).
4. **Invoices, quotes and contracts** mirror only the single entry being saved (mirrorInvoiceToRelational :1346, etc.). They come back relationally only if the stale device saves that same deleted record, for example workspace.html togglePaid :2397 → :2425.
   - A phantom invoice row matters: `getInvoicesForRead` (sync.js:1770) prefers the relational cache. Finance, Runway, the Income list and the overdue check read `invoices` (dev-tools.html:3386-3387).
5. **SET NULL drift.** Deleting a job nulls job_id on its relational invoices, quotes and contracts (and on referrals). The blob copies keep `jobRefId`. The same happens with source_quote_id and converted_to_invoice_id when a quote or invoice is deleted. After that, a later mirror of the invoice upserts `job_id = Number(jobRefId)`, which points at a missing job and would fail the FK (unverified; such failures are recorded in th_mirror_failures).
6. **Line-item replace is not atomic** (mirrorReplaceLineItems, sync.js:1205, which the code itself flags as a known gap). A delete racing a re-save could leave line items behind or remove them (unverified).

---

### 7. Other related behavior

**Cascades.** The code base deliberately avoids cascading across record types.
- Deleting a job does:
  - hard-delete its photos: fetchJobPhotos then deleteJobPhoto (sync.js:1948) on the th_job_photos row and the storage object, in both the single and bulk paths;
  - delete the portal job copy (single path only; see section 2);
  - upsert nothing else.
- Deleting a job does not touch the job's blob invoices, quotes, contracts, notes or referrals. The referrals row keeps existing with referred_job_id nulled by the FK.
- Deleting an invoice removes only the income entries **derived** from it (`origin:'invoice' && invoiceId === id`) and the portal invoice. Manually entered income is untouched.
- Deleting a client removes only the registry record. Jobs, invoices and the rest keep their `clientId`/name, so the clientId dangles (client-detail.html:647-660 confirm text).
- Deleting an expense deletes the receipt file (deleteReceipt) after taking the graveyard snapshot.

**Undo.**
- Jobs, invoices, quotes, contracts, expenses and income use a 6 s `showUndoToast` (tools/tools-media-sharing.js:201). During the window nothing is written: no storage change, no tombstone, no mirror. The row is only hidden (for jobs, via `pendingDeleteJobIds` at job-tracker.html:2502). Undo just clears the timer.
- Contacts and notes delete immediately with no undo (Graveyard only; notes have no Graveyard entry).
- Clients delete immediately; Undo on client-detail lifts the tombstone.

**Bulk.**
- bulkDeleteJobs: one timer for the whole batch, one tombstone, mirrorDelete and graveyard entry per job, then one saveJobs.
- clearAllExpenses / clearAllIncome: tombstone and graveyard entry per entry, no undo, no relational table.

**Notes and flagged items.** Tombstoned since 2026-09-30 (deleteNote job-tracker.html:3299, thDeleteFlaggedItem data-layer.js:454). No graveyard snapshot.

**Runway rd_* lists.** Deletes at runway-dashboard.html:2401, 2637 and 2788 have **no tombstones**, so they are open to union resurrection. This is outside the 8 entities but is the same class of bug.

**Wiki issue restore** needs the unit present. Unit and issue tombstones ride the separate workspace_sync_wiki row.

---

### What soft deletes must preserve (checklist)

- [ ] **Delete beats a concurrent or stale edit.** A stale device's copy or edit must never un-delete a record. Today the delete wins regardless of edit time, and only an explicit restore reverses it. Decide on purpose whether `updated_at > deleted_at` should win. Today it does not.
- [ ] **Restore is a forward-moving event**, the equivalent of `restoredAt`: the later of deletedAt and restoredAt wins, and a re-delete after a restore sticks. Never "un-delete by clearing deleted_at" in a way a stale writer could reverse. Either compare timestamps, or have the server reject writes that clear deleted_at without a restore.
- [ ] **Graveyard behavior.** Keep the full pre-delete snapshot so it can be restored. Restore brings back the same id. Restore re-mirrors the relational row and line items. The Graveyard list is capped at 200 and hides restored or purged entries. The Graveyard UI reads deleted rows; it could become `where deleted_at is not null`.
- [ ] **The row must still exist.** Soft delete keeps it, so graveyard restore and conflict detection can work off the row itself. Invoice and quote line items must not be CASCADE-deleted on a soft delete, since today the relational hard delete removes them and restore re-inserts them from the snapshot.
- [ ] **Every read path filters out deleted rows**: calendar (fetchJobsFromRelational), getInvoicesForRead / fetchInvoicesFromRelational, Finance, Runway, the overdue and cron edge functions, the reconcile SQL, client-detail bundles and the portal syncs.
- [ ] **Keep the derived-data cascades:**
  - an invoice delete also soft-deletes (or removes) its `origin:'invoice'` income entries;
  - an invoice delete removes the portal invoice;
  - a job delete removes the portal job, in **both** single and bulk paths (fix the bulk gap);
  - job photos and expense receipts are hard-deleted in storage (they are not restorable today).
- [ ] **Keep what does not cascade:** a job delete leaves its invoices, quotes and contracts; a client delete leaves its jobs and invoices. Replace the SET NULL FK behavior with nothing (a soft delete fires no FK action) so `job_id` links survive and restore is lossless. This also removes today's SET NULL drift.
- [ ] **Client name tombstone.** thBackfillClients must not recreate a soft-deleted client by name (today it uses normalizedName). Decide whether thEnsureClient should revive a soft-deleted client or create a new one; today it creates a new one.
- [ ] **Undo window.** The 6 s deferred delete writes nothing until it commits. Also decide what happens on page unload inside the window; today it probably cancels (unverified).
- [ ] **Relational delete reliability.** Today it is best-effort, never retried, done only by the deleting device, and whole-list job upserts from stale devices can revive rows. The replacement (the outbox in docs/ITEM-1-MIGRATION-PLAN.md :138-150) must make the soft delete durable and idempotent, and it must stop an upsert from a stale client clearing `deleted_at`.
- [ ] **Blob-only entities** (expenses, income, contacts, clients, notes, flagged, templates, price ref, inventory, known issues, shifts, pending review requests, wiki) keep their tombstones until each is migrated. Keep the tombstone-before-data ordering in SYNC_DATA_KEYS for any key still in the blob.
- [ ] **Retention.** Tombstones effectively never expire today; the 90-day prune is undone by the union merge. Decide on a real purge policy for deleted_at rows (the open question at ITEM-1-MIGRATION-PLAN.md:256/269). A purge must not reopen resurrection for a device that has been offline longer than the purge window.
- [ ] **Conflict visibility.** Today a delete-vs-edit loss is silent: no th_sync_conflicts entry. The migration plan (:150) says soft deletes should make "an offline edit to a row someone else deleted" detectable, which would be new behavior, not something that must be kept.
