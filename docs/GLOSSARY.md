# Glossary

Terms used throughout this codebase, `README.md`, and
`DISASTER_RECOVERY.md` that don't mean the obvious thing on first
read, or that come up often enough to be worth a single, quick
definition instead of re-explaining every time.

**Tombstone** -- a small, permanent record (`{ id, deletedAt }`, plus a
few type-specific variants) saying "this record was deliberately
deleted." Exists because the sync system below uses a union merge,
which on its own can't tell "never existed" apart from "existed and
was deleted" -- without a tombstone, a stale device pushing its old
copy back would resurrect the deletion. See "Deletion resurrection /
tombstones" in `DISASTER_RECOVERY.md` for the full mechanism.

**Graveyard** -- a separate, deliberately different mechanism from a
tombstone. Where a tombstone only ever records that something was
deleted, the graveyard keeps a full snapshot of the deleted record
itself, so a genuine mistake can actually be restored. Browsable in
Dev Tools -> Session & Sync -> Graveyard. See "Graveyard" in
`DISASTER_RECOVERY.md`.

**`workspace_sync`** -- the single Supabase table (one row) holding
almost all of Triple H's business data -- jobs, invoices, contracts,
clients, expenses, income, and more -- as one JSON blob, keyed by
top-level field name. Kept in sync across devices by a union merge,
not a plain overwrite. See "Cross-device sync" in the main
`README.md`.

**Union merge** -- the specific way two devices' copies of the same
synced data get reconciled: take everything present on *either* side,
by id, rather than one side's snapshot silently overwriting the
other's. Chosen so two people adding different things at the same
time don't clobber each other -- the tradeoff it introduces is exactly
what tombstones exist to close.

**Checkpoint tag** -- an annotated git tag (`checkpoint-YYYY-MM-DD-...`)
marking a specific point in this repo's history with a detailed
message summarizing what changed and why, meant to be read later as a
snapshot of "what was true at this point," not a release version in
the usual sense (there's no versioning scheme here -- see "Deploying
changes" in the main `README.md`).

**Backfill** (`thBackfillClients` and similar) -- a function that
scans existing data (jobs, invoices) for a client name that isn't yet
in the client registry, and creates a registry entry for it
automatically. Real, known failure mode: running repeatedly without
recognizing an entry it already created leads to duplicates -- this
happened for real (2026-08-26) and was cleaned up directly in the live
database, 20 registry entries down to the correct 4.

**`padded_range`** -- a computed column on `th_bookings` (a
`tstzrange`, 15 minutes padded on each side of the actual appointment)
used by a Postgres exclusion constraint to prevent two bookings from
overlapping, including the buffer time between them. Set by a
`BEFORE INSERT/UPDATE` trigger rather than a plain generated column,
specifically because the arithmetic involved is `STABLE`, not
`IMMUTABLE`, which Postgres requires for a real generated column.

**`th_` / `rd_` key prefixes** -- `th_` marks Triple H business data
synced across devices (`th_tracker_jobs`, `th_clients`, etc.). `rd_`
marks Connor's *personal* finance data, using the exact same sync
mechanism -- worth remembering this means personal financial data
(mortgage, personal income) technically flows through the same pipe
as business data. Fine for a single owner-operator; worth revisiting
if this business ever brings on an employee or bookkeeper with sync
access.

**`SECURITY DEFINER` / `SECURITY INVOKER`** -- a Postgres function
attribute controlling whose privileges the function runs with:
`DEFINER` means the function's *owner's* privileges (used deliberately
here so, e.g., an anonymous guest can call a narrow booking function
without needing broad table access directly); `INVOKER` (the default)
means the *calling* role's own privileges. Every `SECURITY DEFINER`
function in this project sets `search_path = public` explicitly --
see `SECURITY.md` for why that matters.

**RLS** -- Row-Level Security. Postgres's mechanism for restricting
which rows a query can see or modify, per-role, enforced by the
database itself rather than trusted to application code. Every table
in both Supabase projects has RLS enabled; see `SECURITY.md` for the
actual policies and why they're shaped the way they are.

**Cache-busting / `?v=`** -- the query-string suffix on shared
`<script>`/`<link>` tags (e.g. `sync.js?v=228db11afb`), used to force
browsers to fetch a new copy when the file's content actually changes
rather than serving a stale cached version. As of 2026-08-26, this
value is a real content hash, checked automatically
(`npm run check-consistency`) and correctable in one command
(`npm run fix-versions`) -- see "Cache-busting" in the main
`README.md` for the full history of why this needed rebuilding twice.

**Advisor** -- Supabase's own built-in database linter, covering both
security and performance issues. Run directly (not just trusted from
memory) after any RLS or function-privilege change -- see
`SECURITY.md` for the most recent real findings and fixes.

**Vault** -- Supabase's built-in secrets store, used here to hold
service-role keys and similar credentials that Postgres functions
need to call Edge Functions, without ever putting those secrets in
this repo or in a table a client could query.

**Edge Function** -- a small, deployed serverless function
(Supabase's own hosting for these) handling things this repo's static
site can't do itself: sending emails (`send-booking-email`,
`send-lead-email`), push notifications (`Send-Push`), and uptime
checks (`uptime-alert`). Source snapshots for each live in
`edge-functions/` at the repo root, for reference and disaster
recovery -- not meant to be redeployed by editing that copy directly.
