-- Granular permission expansion (2026-09-02). Applied directly via
-- the Supabase MCP migration tool; recorded here after the fact, same
-- convention as sql/security/flexible_per_account_permissions.sql,
-- which this builds directly on.
--
-- Requested directly: "Review tool? Checkbox. Dev tool stats? On
-- today, off tomorrow." The prior 4-permission model still bundled 5
-- genuinely distinct tools (Invoices, Contracts, Finance, Runway,
-- Review Requests) under one can_manage_business_finances checkbox,
-- and coupled "sees the 27 technical Dev Tools panels" to
-- can_manage_roles (an unrelated capability) rather than giving it
-- its own toggle.
--
-- New checkboxes, each gating exactly one real page/capability:
--   can_access_dev_tools_full  -- the 27 diagnostic/technical Dev
--                                  Tools panels, decoupled from
--                                  can_manage_roles (previously the
--                                  ONLY way to see them was to also be
--                                  able to manage everyone's
--                                  permissions, which was never
--                                  actually the intent)
--   can_manage_invoices        -- invoice-generator.html
--   can_manage_contracts       -- contract-generator.html
--   can_view_finance           -- finance.html
--   can_view_runway            -- runway-dashboard.html
--   can_manage_reviews         -- review-request.html
--
-- can_manage_business_finances is retired -- every real reader
-- (auth.js, dev-tools.html, and 8 edge functions -- send-invite,
-- send-invoice-notification, send-quote-notification,
-- sync-invoice-to-portal, sync-quote-to-portal, sync-job-to-portal,
-- sync-checkup-to-portal, set-invoice-paid) was updated in the same
-- change. Dropped rather than left as a stale, misleading column,
-- unlike role_definitions' OTHER columns, which are meant to stay as
-- non-authoritative presets by design.
--
-- REAL MISTAKE MADE DURING THIS MIGRATION, worth recording here
-- directly rather than only in a commit message: the column drop
-- below ran before all 8 dependent edge functions were redeployed
-- with their corrected queries, which meant every one of them was
-- briefly live-broken (querying a column that no longer existed,
-- rejecting every legitimate caller with 403) until each was
-- redeployed individually. The correct order for a change like this
-- is: deploy every dependent's NEW code first (harmless while the old
-- column still exists alongside the new ones), THEN drop the old
-- column in a separate, later migration -- never drop first and fix
-- callers after.

alter table account_roles
  add column can_access_dev_tools_full boolean,
  add column can_manage_invoices boolean,
  add column can_manage_contracts boolean,
  add column can_view_finance boolean,
  add column can_view_runway boolean,
  add column can_manage_reviews boolean;

alter table role_definitions
  add column can_access_dev_tools_full boolean,
  add column can_manage_invoices boolean,
  add column can_manage_contracts boolean,
  add column can_view_finance boolean,
  add column can_view_runway boolean,
  add column can_manage_reviews boolean;

-- Backfill account_roles so this migration changes nobody's real,
-- effective access. Matches EXACTLY what each account could already
-- do the moment before this ran:
-- - can_access_dev_tools_full mirrors can_manage_roles, since that's
--   what actually gated the 27 panels until now
--   (applyOwnerRestrictedView() in tools/dev-tools.html).
-- - The 5 new finance-domain permissions all mirror the old
--   can_manage_business_finances value -- everyone who could reach
--   any of those 5 pages could reach all of them before.
update account_roles set
  can_access_dev_tools_full = can_manage_roles,
  can_manage_invoices = can_manage_business_finances,
  can_manage_contracts = can_manage_business_finances,
  can_view_finance = can_manage_business_finances,
  can_view_runway = can_manage_business_finances,
  can_manage_reviews = can_manage_business_finances;

-- Same backfill logic for role_definitions' presets, so the "Add
-- account" form's preset dropdown still prefills sensibly:
-- Developer keeps everything; Owner keeps site content + the 5
-- finance-domain tools but NOT the technical panels (matching its
-- historical can_manage_roles=false); Employee stays all-false.
update role_definitions set
  can_access_dev_tools_full = can_manage_roles,
  can_manage_invoices = can_manage_business_finances,
  can_manage_contracts = can_manage_business_finances,
  can_view_finance = can_manage_business_finances,
  can_view_runway = can_manage_business_finances,
  can_manage_reviews = can_manage_business_finances;

alter table account_roles
  alter column can_access_dev_tools_full set default false,
  alter column can_manage_invoices set default false,
  alter column can_manage_contracts set default false,
  alter column can_view_finance set default false,
  alter column can_view_runway set default false,
  alter column can_manage_reviews set default false;

update account_roles set
  can_access_dev_tools_full = coalesce(can_access_dev_tools_full, false),
  can_manage_invoices = coalesce(can_manage_invoices, false),
  can_manage_contracts = coalesce(can_manage_contracts, false),
  can_view_finance = coalesce(can_view_finance, false),
  can_view_runway = coalesce(can_view_runway, false),
  can_manage_reviews = coalesce(can_manage_reviews, false);

alter table account_roles
  alter column can_access_dev_tools_full set not null,
  alter column can_manage_invoices set not null,
  alter column can_manage_contracts set not null,
  alter column can_view_finance set not null,
  alter column can_view_runway set not null,
  alter column can_manage_reviews set not null;

alter table role_definitions
  alter column can_access_dev_tools_full set default false,
  alter column can_manage_invoices set default false,
  alter column can_manage_contracts set default false,
  alter column can_view_finance set default false,
  alter column can_view_runway set default false,
  alter column can_manage_reviews set default false;

update role_definitions set
  can_access_dev_tools_full = coalesce(can_access_dev_tools_full, false),
  can_manage_invoices = coalesce(can_manage_invoices, false),
  can_manage_contracts = coalesce(can_manage_contracts, false),
  can_view_finance = coalesce(can_view_finance, false),
  can_view_runway = coalesce(can_view_runway, false),
  can_manage_reviews = coalesce(can_manage_reviews, false);

alter table role_definitions
  alter column can_access_dev_tools_full set not null,
  alter column can_manage_invoices set not null,
  alter column can_manage_contracts set not null,
  alter column can_view_finance set not null,
  alter column can_view_runway set not null,
  alter column can_manage_reviews set not null;

-- Now safe to retire the old coarse column -- every real reader was
-- either this migration's own backfill (already run) or application
-- code being updated in the same change. See the note at the top of
-- this file about the order this actually happened in live, though.
alter table account_roles drop column can_manage_business_finances;
alter table role_definitions drop column can_manage_business_finances;
