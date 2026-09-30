# Triple H Enterprises — Scale & "Sell This Software" Roadmap

Living document. Last updated 2026-09-30. Two separate goals are tracked here, and they are NOT the same project — keep them distinct:

1. **Corporate-scale readiness (current priority).** Rebuild/refactor Triple H's own tools with the mindset "how would this hold up for a large corporation with thousands of invoices and clients," instead of "does this work for Steve's small volume today." This does NOT mean onboarding other businesses. No multi-tenant signup flow, no self-serve provisioning, no hosting infrastructure decisions (DigitalOcean, etc.) are in scope right now.
2. **Eventually selling this software (deferred, foundation only).** A separate, later goal: could this codebase become a product sold to other service businesses. Only the database-isolation foundation for this has been built so far (Tier 0, done). Everything else under "Deferred" below is explicitly NOT being worked on until the scale-readiness goal is further along.

Product decision already made: **if/when this is sold, it's one combined package** (Workspace tools + client portal together), not split into separate SKUs. This resolves what was an open question earlier in the roadmap.

---

## Part 1: Corporate-scale readiness (current priority)

Found via a full read-only codebase audit (2026-09-30), prioritized most-impactful first.

### 1. The whole Workspace suite runs on a localStorage JSON blob, not the database (the real blocker)

Every job/invoice/quote/contract lives in `localStorage` and is synced by re-uploading the *entire* dataset as one JSON blob (`tools/sync.js`, `workspace_sync` table: `code text primary key, data jsonb`). Confirmed: `tools/clients.html`, `invoice-generator.html`, `job-tracker.html`, `workspace.html` make **zero** direct Supabase calls against the `jobs`/`invoices`/`quotes`/`contracts` tables — only against `localStorage` keys.

Meanwhile `sql/infra/create_relational_jobs_invoices_quotes_contracts.sql` already created proper relational tables with indexes that the app **never queries**. `tools/sync.js:169` documents this pattern already broke once at small scale (payload hit a 64KB keepalive cap). At real corporate volume this becomes a multi-MB blob re-uploaded on every single edit — guaranteed failure — and the whole-blob 3-way merge (`sync.js:391-436`) means two staff editing concurrently race on the *entire* dataset, not per-row.

**This is the dependency everything below sits on.** Fixing it is what makes #2-5 possible/meaningful.

- Fix direction: migrate job-tracker/invoice-generator/clients/workspace off localStorage onto the existing relational tables via real Supabase REST calls. Keep `sync.js` only as a bridge during migration, not the permanent store.

### 2. Client-side aggregation for money math

`workspace.html:1975-2286, 4056-4235` (Outstanding/Overdue/Revenue/Top Clients/Top Vendors) and `finance.html:1011-1105, 1633-1691` (expense/income summaries) load the full dataset and `.reduce()`/`.filter()`/`.sort()` in JavaScript instead of Postgres `SUM`/`GROUP BY`. Directly downstream of #1 — can't move to SQL until the data actually lives in SQL.

- Fix direction: once on relational tables, replace with aggregate SQL views/RPCs computed server-side.

### 3. N+1 explosion in client search

`tools/clients.html:826-849` (`findMatchingClientEmails`) fires 4 unindexed ILIKE queries, then `:903-921` (`renderClientLookup`) fires **5 more REST/RPC calls per matched client**. A search matching 500 clients = 2,000+ REST calls. No trigram index exists anywhere for the name/phone/email ILIKE searches used throughout `clients.html`.

- Fix direction: one server-side RPC doing the ILIKE search + joins, returning a single paginated result set. Add `pg_trgm` GIN indexes on the searched text columns.

### 4. Unpaginated full-table renders

- `tools/job-tracker.html:2484-2523` (`renderJobs`) — loads ALL jobs, no limit/virtualization.
- `tools/invoice-generator.html:1161` (`renderInvoiceLog`), `:2792` (`renderQuoteLog`) — same pattern.
- `portal/jobs.html:1313-1316`, `portal/quotes.html:709`, `portal/contracts.html:360` — `select('*')` with no `.range()`/`.limit()`.

Fine for "one client's history" today; not fine for a repeat commercial client with years of jobs, or staff viewing across all clients.

- Fix direction: `.range()`/keyset pagination with a default page size (e.g. 50), both internal tools and portal.

### 5. Missing indexes for actual query patterns

Only `tenant_id`, a few FK columns, and `client_portal_work_orders`' `status`/`created_at`/`client_email` are indexed today. **No index** on `jobs.status`, `jobs.created_at`, `invoices.paid`/`status`, or the name/phone/email columns filtered/searched throughout the app.

- Fix direction: btree indexes on the filter/sort columns actually used; `pg_trgm` GIN indexes for ILIKE search columns.

### 6. Hardcoded small-scale assumptions

Several places (`workspace.html:1849-1879, 2478, 2564, 4103`) load a full array into memory just to `.slice(0, N)` client-side, rather than asking the database for the top N directly. Symptom of #1/#2, not a separate root cause.

- Fix direction: push "top N" into the SQL query (`order by ... limit N`) once data lives in Postgres.

### Suggested order of attack

1. Migrate the core data model off localStorage onto the relational tables (item 1) — this is the real project, and it's substantial. Everything else is a smaller, mostly mechanical follow-on once it's done.
2. Add the missing indexes (item 5) — cheap, can happen in parallel, immediately helps once queries move server-side.
3. Fix the N+1 client search (item 3) — high user-visible pain, self-contained.
4. Move dashboards to SQL aggregates (item 2) and add pagination everywhere (item 4) — natural next step once #1 is live.
5. Clean up the small-scale slice() patterns (item 6) as each page gets touched.

---

## Part 2: Deferred — "sell this software" foundation

Not being worked on right now. Kept here so the earlier work (and the reasoning behind it) isn't lost.

### Done
- **Tier 0 — real tenant isolation** (merged, live): `tenants` table, `tenant_id` + RLS on every business table, `current_tenant_id()`. Triple H is tenant #1, an ordinary row. Fully additive, zero behavior change. See `sql/multi-tenant/01-05` and `docs/specialist-logs/features.md`'s 2026-09-30 entry for the full detail, including two real bugs it caught before going live.

### Product decision made
- **One combined package** (Workspace + Portal together) if/when this is sold — not split into separate SKUs. This means no separate "portal-only tenant" work is needed.

### Deferred until actually pursuing a sale
- **Branding/identity extraction** — tenant-config-driven colors/logo/business name/tagline for `tools/` and `portal/` only (not the public marketing site, which stays Steve's own). Specifically flagged: `contract-generator.html` and `invoice-generator.html` currently burn Triple H's identity directly into real PDF output — that's business-identity data, not just CSS.
- **Portal security hardening** — worth doing somewhat independently of the sale question since it's good practice regardless: client-side MFA/2FA (currently staff-only), rate limiting on auth endpoints, a real pen-test/dependency audit pass focused on the Stripe/payment surface.
- **Go-to-market mechanics** — self-serve/sales-assisted tenant signup (today it's manual), a super-admin console, subdomain/workspace-switcher routing. Requires actual hosting infrastructure decisions (a second environment, e.g. DigitalOcean or similar) — explicitly not being decided now.
- **Scale/trust infra** — observability beyond Supabase logs, per-tenant backups, a status page, tenant-scoping the edge functions (they run on `service_role` and bypass RLS entirely today — harmless with one tenant, a real gap with two).

### Open decision, not gating anything yet
- SaaS (recurring revenue, self-serve, ongoing product work) vs. asset sale (sell the codebase + business to one acquirer who runs it themselves) — these want opposite next moves. Worth deciding before spending on the deferred items above, not before the current scale-readiness work.

---

*Update this file as work progresses or priorities shift — don't let it go stale the way other planning docs in this repo have.*
