-- Multi-tenant Tier 0 (batch 5/5): advisor cleanup. get_advisors(type:
-- security) flagged the 6 tenant-derivation trigger functions as
-- directly RPC-callable via PostgREST -- they're "returns trigger"
-- functions meant only to fire on INSERT. Trigger firing doesn't
-- require the DML-issuing role to hold EXECUTE on the trigger function
-- (that ACL check only applies to a direct function call, e.g. a
-- PostgREST RPC hit), so revoking EXECUTE here closes the exposure
-- without affecting the triggers themselves -- confirmed live: an
-- insert that relies on one of these triggers still resolves tenant_id
-- correctly after this revoke.
revoke execute on function
  public.set_tenant_id_from_invoice(),
  public.set_tenant_id_from_quote(),
  public.set_tenant_id_from_portal_job(),
  public.set_tenant_id_from_portal_work_order(),
  public.set_tenant_id_from_portal_quote(),
  public.set_tenant_id_from_thread()
  from public, anon, authenticated;
