-- Audit Round 3 (2026-09-10) fixes, applied directly via Supabase migrations
-- and mirrored here for the repo's own record. Source: Supabase's own
-- security/performance advisor, not inferred from reading code.

-- ---------------------------------------------------------------------
-- 1) next_invoice_number()/next_quote_number() were callable by ANY
--    authenticated account -- including client portal logins, now that
--    clients have real logins. A client account could have advanced the
--    invoice/quote sequence or learned the business's invoice count.
--    Restricted to internal accounts only, using the same
--    current_user_has_any_role() check already used by RLS policies
--    elsewhere for this exact "internal vs client" distinction.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.next_invoice_number()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.current_user_has_any_role() then
    raise exception 'Only internal accounts can generate invoice numbers';
  end if;
  return 'INV-' || to_char(now(), 'YYYY') || '-' || nextval('invoice_number_seq')::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.next_quote_number()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.current_user_has_any_role() then
    raise exception 'Only internal accounts can generate quote numbers';
  end if;
  return 'EST-' || to_char(now(), 'YYYY') || '-' || nextval('quote_number_seq')::text;
end;
$function$;

-- ---------------------------------------------------------------------
-- 2) guard_last_role_manager_permission(), notify_new_work_order_email(),
--    notify_work_order_message_email(), notify_work_order_scheduled_email()
--    were flagged by the advisor as anon/authenticated-callable
--    SECURITY DEFINER functions. VERIFIED SAFE, no code change: all 4 are
--    `RETURNS trigger` functions, and Postgres itself refuses to invoke a
--    trigger-return-type function outside of an actual trigger fire
--    ("ERROR: trigger functions can only be called as triggers"),
--    confirmed by calling each directly with `select <fn>();` and getting
--    that exact error. Same resolution as notify_new_lead() back in
--    August: the advisor can't tell "public by mistake" from "can't
--    actually be called that way," a person has to check.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 3) card_authorizations manual review: columns are id, client_email,
--    stripe_customer_id, signer_name, authorization_text, context,
--    amount, description, internal_account, created_at -- a tokenized
--    Stripe customer reference and an authorization/signature record,
--    NOT raw card numbers or CVVs. Only SELECT policies exist (no
--    client-side INSERT/UPDATE/DELETE), so writes only happen via
--    service_role edge functions. No security issue; folded into the
--    same multiple-permissive-policies performance fix below.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 4) 7 tables carried two separate permissive RLS policies for the same
--    action ("clients view their own X" + "internal accounts view all
--    X"), evaluated twice per query. Same fix already applied once to
--    workspace_sync/th_leads in August; not carried forward into the
--    client-portal/relational-tables tables built since. Pure
--    performance change -- each merged policy is the OR of the two prior
--    conditions, access is unchanged.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "clients can view their own card authorizations" ON public.card_authorizations;
DROP POLICY IF EXISTS "internal accounts can view card authorizations" ON public.card_authorizations;
CREATE POLICY "clients or internal accounts can view card authorizations"
  ON public.card_authorizations FOR SELECT TO authenticated
  USING (client_email = (select auth.email()) OR public.current_user_has_any_role());

DROP POLICY IF EXISTS "clients can view their own notification preferences" ON public.client_notification_preferences;
DROP POLICY IF EXISTS "internal accounts can view all notification preferences" ON public.client_notification_preferences;
CREATE POLICY "clients or internal accounts can view notification preferences"
  ON public.client_notification_preferences FOR SELECT TO authenticated
  USING (client_email = (select auth.email()) OR public.current_user_has_any_role());

DROP POLICY IF EXISTS "clients can only view their own quotes" ON public.client_portal_quotes;
DROP POLICY IF EXISTS "internal accounts can view all quotes" ON public.client_portal_quotes;
CREATE POLICY "clients or internal accounts can view quotes"
  ON public.client_portal_quotes FOR SELECT TO authenticated
  USING ((select auth.email()) = client_email OR public.current_user_has_any_role());

DROP POLICY IF EXISTS "clients send messages on their own work orders" ON public.client_portal_work_order_messages;
DROP POLICY IF EXISTS "internal accounts send work order messages" ON public.client_portal_work_order_messages;
CREATE POLICY "clients or internal accounts send work order messages"
  ON public.client_portal_work_order_messages FOR INSERT TO authenticated
  WITH CHECK (
    (sender_type = 'client' AND sender_email = (select auth.email())
      AND EXISTS (SELECT 1 FROM public.client_portal_work_orders wo
                  WHERE wo.id = client_portal_work_order_messages.work_order_id
                    AND wo.client_email = (select auth.email())))
    OR
    (sender_type = 'internal' AND sender_email = (select auth.email())
      AND public.current_user_has_any_role())
  );

DROP POLICY IF EXISTS "clients view messages on their own work orders" ON public.client_portal_work_order_messages;
DROP POLICY IF EXISTS "internal accounts view all work order messages" ON public.client_portal_work_order_messages;
CREATE POLICY "clients or internal accounts view work order messages"
  ON public.client_portal_work_order_messages FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.client_portal_work_orders wo
            WHERE wo.id = client_portal_work_order_messages.work_order_id
              AND wo.client_email = (select auth.email()))
    OR public.current_user_has_any_role()
  );

DROP POLICY IF EXISTS "clients view their own work orders" ON public.client_portal_work_orders;
DROP POLICY IF EXISTS "internal accounts view all work orders" ON public.client_portal_work_orders;
CREATE POLICY "clients or internal accounts view work orders"
  ON public.client_portal_work_orders FOR SELECT TO authenticated
  USING ((select auth.email()) = client_email OR public.current_user_has_any_role());

DROP POLICY IF EXISTS "clients can view their own profile" ON public.client_profiles;
DROP POLICY IF EXISTS "internal accounts can view all client profiles" ON public.client_profiles;
CREATE POLICY "clients or internal accounts can view client profiles"
  ON public.client_profiles FOR SELECT TO authenticated
  USING (client_email = (select auth.email()) OR public.current_user_has_any_role());

-- push_subscriptions is the one exception in shape: "Require login" (role
-- public, but its own condition required auth.role()='authenticated' AND
-- an account_roles match -- i.e. internal accounts only) and "any
-- authenticated user can manage their own push subscription" (own
-- user_id only) both applied to every command (ALL), not just SELECT.
DROP POLICY IF EXISTS "Require login" ON public.push_subscriptions;
DROP POLICY IF EXISTS "any authenticated user can manage their own push subscription" ON public.push_subscriptions;
CREATE POLICY "internal accounts or the owning user can manage push subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (public.current_user_has_any_role() OR user_id = (select auth.uid()))
  WITH CHECK (public.current_user_has_any_role() OR user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 5) 5 foreign keys had no covering index.
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_client_portal_work_orders_linked_quote_id
  ON public.client_portal_work_orders (linked_quote_id);

CREATE INDEX IF NOT EXISTS idx_quote_questions_quote_id
  ON public.quote_questions (quote_id);

CREATE INDEX IF NOT EXISTS idx_referrals_referred_job_id
  ON public.referrals (referred_job_id);

CREATE INDEX IF NOT EXISTS idx_th_bookings_checkup_id
  ON public.th_bookings (checkup_id);

CREATE INDEX IF NOT EXISTS idx_th_bookings_quote_id
  ON public.th_bookings (quote_id);
