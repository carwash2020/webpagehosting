-- Async e-signature for contracts (client portal), added to close the
-- gap flagged in a full-repo audit: quotes already have a full async
-- client-portal approval flow (client_portal_quotes / respond-to-quote),
-- but the three contract templates in tools/contract-generator.html
-- could only ever be signed in person, on the same device, via the two
-- canvas signature pads already in that page. This table is the portal
-- side of the same pattern, mirroring client_portal_quotes' shape and
-- RLS boundaries as closely as the different content shape allows.
--
-- Deliberately a SEPARATE table from th_contracts (which lives in the
-- workspace_sync JSON blob), same reasoning as client_portal_quotes vs
-- th_quotes: writing into a live JSONB blob from a server-side edge
-- function, outside the established sync-merge logic in tools/sync.js,
-- risks exactly the clobbered-write bug DISASTER_RECOVERY.md already
-- documents once. Internal visibility into signing status instead comes
-- from a direct, real-time query, surfaced inline in the Contract Log
-- in tools/contract-generator.html -- same pattern invoice-generator.html
-- already uses for quotes.
create table client_portal_contracts (
  id bigint generated always as identity primary key,
  source_contract_id bigint not null,
  client_email text not null,
  client_name text not null,
  contract_type text not null,
  contract_title text not null,
  -- The resolved content blocks (CONTRACT_TEMPLATES[type].blocks(fields),
  -- with the 'signature' block type stripped out -- the portal renders
  -- its own signature UI rather than the two-pad in-person layout).
  -- Storing the already-resolved text, not the raw template + fields
  -- separately, means a later edit to CONTRACT_TEMPLATES in the
  -- generator never silently changes the text of a contract a client
  -- already reviewed or signed.
  blocks jsonb not null,
  business_signature_data_url text,
  client_signature_data_url text,
  status text not null default 'pending',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_portal_contracts_status_check check (status in ('pending', 'signed', 'declined')),
  constraint client_portal_contracts_contract_type_check check (contract_type in ('pwo', 'stpa', 'ltsa'))
);

-- Lets sync-contract-to-portal upsert -- syncing the same contract twice
-- (e.g. Steve edits and re-sends) updates rather than duplicates, same
-- as client_portal_quotes' own unique constraint.
alter table client_portal_contracts
  add constraint client_portal_contracts_source_contract_id_key
  unique (source_contract_id);

alter table client_portal_contracts enable row level security;

-- Clients see only their own contract -- (select ...) wraps auth.email()
-- for the same per-query-not-per-row performance reason already applied
-- to every other table in this project (Auth RLS Initialization Plan).
create policy "clients can only view their own contracts"
  on client_portal_contracts for select
  to authenticated
  using ((select auth.email()) = client_email);

-- Internal accounts can see every contract -- the write-back visibility
-- Steve/Connor need, via a real-time query rather than a blob sync. Two
-- permissive SELECT policies on the same table OR together, so this
-- adds internal visibility without narrowing what a client can see.
create policy "internal accounts can view all contracts"
  on client_portal_contracts for select
  to authenticated
  using (exists (select 1 from account_roles where email = (select auth.email())));

-- No insert/update/delete policy for the authenticated role at all --
-- every write goes through an edge function with the service role key,
-- never from the browser, matching client_portal_quotes.
