# Disaster Recovery -- Triple H Enterprises

A practical runbook for actual failure scenarios, not a generic checklist.
Written after the 2026-08-13/14 session that built out the public-site
CMS and expanded Dev Tools significantly. Keep this alongside a current
full backup (see README.txt in this same folder).

**Added to the repo 2026-08-14** (previously existed only as a delivered
backup file, never actually committed here despite being referenced from
the main README) -- also updated the same day to reflect the
`service_role` key's move into Supabase Vault (Scenario 6) and to note
that the tool-page consistency check Scenario 2 refers to now also runs
automatically in CI on every push (`.github/workflows/test.yml` ->
`scripts/check-consistency.js`), not just on demand from inside Dev Tools.

**Substantially updated 2026-08-25** after the session that replaced
Cal.com with an in-house booking system, added in-house uptime
monitoring (replacing HetrixTools), and extended the weekly backup
workflow to cover `th_leads` and `th_bookings` (see Scenarios 7 and 8,
new this update, plus the "Automated jobs" section at the bottom).

**Updated again 2026-08-25 (later the same day)** to cover guest
self-service cancel/reschedule, added after the initial booking-system
build -- Scenario 7 now covers the cancel/reschedule RPC functions, a
real notification bug found while building them (documented as its
own numbered step, since the obvious-looking cause turned out to be
wrong), and a real auth-testing gotcha (`set role authenticated` alone
doesn't satisfy `auth.role()`) that made a missing DELETE policy look
like it was working when it silently wasn't. Also fixed the panel
count (23, not 22, after a new Dev Tools test panel).

**Updated 2026-09-08** with Scenario 15 (a CodeQL "Clear text storage of
sensitive information" alert that kept reappearing no matter how much
the flagged code was sanitized -- what actually worked instead was
severing the dataflow, plus a real, confirmed inconsistency between a
PR's own CodeQL check and the repo's Security tab worth knowing about
before trusting either one blindly) and refreshed cache-bust/CACHE_NAME
version numbers.

**Updated 2026-09-09** with Scenarios 16-18, closing a real documentation
gap: the client portal's Work Orders, Quotes, and Check-ups features
(all added 2026-09-02 through 2026-09-04) had never been covered here
at all -- found during a direct doc-audit request. Scenario 16
specifically documents a real, confirmed bug found the same day by
testing every notification pathway live: a malformed JSON filter had
silently broken every internal email alert for a new work-order
request or client message since the feature shipped on 2026-09-03,
fixed the same day. `docs/CLIENT-PORTAL.md` was current throughout;
only this file and `README.md` had fallen behind.

**The two accounts that matter:** `connor@triplehenterprisesllc.biz` and
`steve@triplehenterprisesllc.biz`, both real Supabase Auth accounts.
Losing access to *both* is the actual worst case -- see the very last
section for what that specifically means.

---

## Scenario 1: The public site is down or showing broken content

**Symptoms:** triplehenterprisesllc.biz doesn't load, shows a GitHub
404 page, or shows visibly broken/wrong content.

1. Check **GitHub → your repo → Actions tab** first. A red X on the
   most recent workflow run means the last push failed a check --
   click into it to see which one (Dev Tools' own "Latest Deploy"
   panel shows this too, without leaving the app).
2. If Actions is green but the site still looks wrong, it's almost
   certainly a bad push, not an outage. **Revert via GitHub:** find the
   last known-good commit (Repo → Commits), click it, "Browse files,"
   copy the working version of whatever's broken back in, or use
   `git revert` if comfortable with that.
3. If you have a recent full backup (see README.txt), the fastest fix
   is often just re-uploading the known-good files directly rather than
   hunting for the exact bad commit.
4. GitHub Pages itself being down (not your fault at all) is rare but
   possible -- check https://www.githubstatus.com if steps 1-3 all
   look fine and it's still broken.

## Scenario 2: A specific tool page (Dev Tools, Job Tracker, etc.) is broken

1. Open Dev Tools' **"Live consistency check"** first -- run it. If the
   broken page shows FAIL with a specific reason (missing auth gate,
   missing CSP, wrong styles.css version), that tells you exactly what
   regressed.
2. If Dev Tools itself is the broken one, you can't use it to diagnose
   itself -- fall back to the browser's own Console/Network tabs
   directly, or restore the last known-good copy from a backup.
3. **The single most common root cause this whole project has hit
   repeatedly:** building a new fix on top of an old, stale local copy
   of a file, silently reverting an earlier unrelated fix. Before
   trusting a "fix," diff it against the most recently *shipped*
   version of that file, not an older backup.

## Scenario 3: Site content (phone/email/hours/banners/FAQ/Terms) shows wrong or broken

1. Open Dev Tools → **Site Content / FAQ editor / Terms editor** and
   check what's actually saved right now -- these are the source of
   truth, not the static HTML fallback.
2. If a specific value looks wrong, check **Content Edit History** --
   every past value is there, and there's a **"Restore this value"**
   button on it directly. No need to retype anything by hand.
3. If the *whole* CMS looks empty or broken (not just one field), the
   Supabase tables themselves may be the problem -- see Scenario 5.
4. If FAQ/Terms shows literal `<a class="...">` tag text instead of a
   real working link, that's the exact bug from earlier this session:
   raw HTML got saved as plain text instead of being stripped first.
   Fix directly through that item's own editor -- retype it as plain
   text, no HTML tags.

## Scenario 4: A duplicate-seeding bug happens again (FAQ or Terms doubles up)

This happened once already (`site_terms` doubled from 16 to 32 rows,
because `ON CONFLICT DO NOTHING` was relying on a unique constraint that
didn't exist at the time). It's now guarded against with real `UNIQUE`
constraints on `site_faq.question` and `site_terms.heading`, so a
straight re-run of the seed SQL should now correctly no-op instead of
duplicating. If it ever happens on some *other* table without a unique
constraint yet, the fix pattern is:

```sql
-- See what's duplicated
SELECT <label column>, count(*) FROM public.<table>
GROUP BY <label column> HAVING count(*) > 1;

-- Keep only the lowest id per duplicate group
DELETE FROM public.<table>
WHERE id NOT IN (SELECT MIN(id) FROM public.<table> GROUP BY <label column>);

-- Prevent recurrence
ALTER TABLE public.<table> ADD CONSTRAINT <name>_unique UNIQUE (<label column>);
```

## Scenario 5: Supabase itself has a problem (data missing, RLS blocking everything, project inaccessible)

1. **Check Supabase's own status page** first: https://status.supabase.com
2. **RLS blocking something that should work:** Dev Tools → Session &
   Sync now has a live "Supabase right now" check (separate from the
   last sync attempt) -- confirms actual reachability. If reachable
   but a specific action fails, get the exact error from the browser's
   Network tab (Response body, not just the status code) -- a 401 with
   `"new row violates row-level security policy"` and code `42501`
   means an RLS policy is the actual blocker, not a bad key or broken
   code. Check the specific table's policies directly:
   ```sql
   SELECT policyname, permissive, roles, cmd, qual, with_check
   FROM pg_policies WHERE tablename = '<table>' ORDER BY cmd;
   ```
3. **A real, non-obvious trap already hit once:** if a request includes
   `Prefer: return=representation` (asking for the row back after
   insert/update), it will ALSO need to satisfy that table's SELECT
   policy, not just the INSERT/UPDATE one -- an anonymous insert into
   a table with an authenticated-only SELECT policy will fail with the
   exact same RLS error, even though the insert itself would have been
   fine without that header. If something fails with 42501 and the
   INSERT/UPDATE policy looks completely correct, check whether the
   request is asking for the row back, and whether the SELECT policy
   actually allows that same role to read it.
4. **Full data loss on a table:** Supabase's own dashboard (Database →
   Backups) has automatic backups on paid tiers -- check there first.
   For the 3 CMS tables specifically, Dev Tools' "Download backup
   (JSON)" button (Content Edit History panel) gives a point-in-time
   export if one was taken recently.

## Scenario 6: Push notifications stop working

The full pipeline, in order, for tracing where it actually broke:

1. A lead is inserted into `th_leads` (either the real contact form,
   using the anon key, or Dev Tools' own "Send test lead" button).
2. A database trigger (`notify_new_lead`) fires automatically, calling
   the `send-push` Edge Function via `net.http_post`. **Updated
   2026-08-14:** the `service_role` key it needs used to be hardcoded
   directly in the trigger's own SQL definition -- that's now been
   moved into Supabase Vault (`vault.decrypted_secrets`, secret name
   `send_push_service_role_key`), and the trigger reads it at call time
   instead. If this pipeline ever breaks with the key nowhere to be
   found, check that the Vault secret still exists before assuming the
   trigger itself is broken -- `select name from vault.secrets;` will
   confirm it's there.
3. `send-push` looks up every row in `push_subscriptions` and sends to
   each one via the `web-push` library.
4. Each browser's own service worker (`push` event listener in
   `service-worker.js`) receives it and calls `showNotification()`.

**To isolate where it's actually broken:**
- Dev Tools → "Push notification test" runs steps 1-3 for real (it
  inserts a real test lead via the anon key, exactly like the real
  form, then cleans up automatically) -- if this errors, the problem is
  in steps 1-2.
- Supabase → Edge Functions → send-push → Logs shows exactly what step
  3 did -- look for `"found N subscription(s)"` and `"Sent successfully
  to subscription <id>"` per row. If this shows real subscriptions and
  "Sent successfully" for all of them, steps 1-3 are all fine and the
  problem is step 4 -- specific device/browser notification permission,
  OS Do Not Disturb, or a stale subscription tied to a device no longer
  in use.
- `push_subscriptions` accumulates one row per browser/device that's
  ever subscribed -- check `SELECT count(*) FROM public.push_subscriptions;`
  to see how many exist; a stale one from an old device won't error,
  it'll just never show anything on a device nobody's watching anymore.

## Scenario 7: A double-booking happens, or the booking system seems broken

**The actual protection against double-booking is a database exclusion
constraint on `th_bookings`** (`no_overlapping_confirmed_bookings`),
not anything in `booking.html`'s own JS -- client-side slot computation
matches the same rules for display purposes, but a genuine race
condition (two people submitting near-simultaneously) is only ever
actually resolved by the database rejecting the second insert. If a
double-booking somehow got through:

1. Check the constraint still exists:
   `select conname from pg_constraint where conrelid = 'public.th_bookings'::regclass;`
   should show `no_overlapping_confirmed_bookings`. If it's missing,
   that's the whole problem -- see `sql/booking/create_booking_system.sql` and
   `sql/booking/add_booking_schedule_buffer.sql` for the exact definition to
   restore.
2. Check the `padded_range` trigger is actually firing: a genuinely
   new booking's `padded_range` column should never be null --
   `select id, start_at, end_at, padded_range from public.th_bookings order by id desc limit 5;`.
   A null `padded_range` on a recent row means the
   `set_padded_range` trigger (`public.set_th_bookings_padded_range()`)
   isn't running -- `select tgname from pg_trigger where tgrelid = 'public.th_bookings'::regclass;`
   should list it.
3. **A real, non-obvious trap already hit once while building this:**
   Postgres requires generated-column expressions to be IMMUTABLE, and
   `timestamptz +/- interval` is only STABLE in its catalog -- even for
   a fixed-duration interval like minutes. A generated column using it
   will be rejected outright at creation time. This is why
   `padded_range` is a plain column set by a `BEFORE INSERT/UPDATE`
   trigger instead -- if this ever needs rebuilding, don't reach for a
   generated column again.
4. **The buffer amount itself:** 15 minutes on each side of every
   confirmed booking (30 real minutes between any two adjacent
   appointments) -- both the database trigger and `booking.html`'s own
   client-side `SCHEDULE_BUFFER_MINUTES` constant need to agree, or a
   slot can show as available on the page and then get rejected on
   submit. If this value is ever changed, change it in both places.
5. If the guest-facing availability check itself seems wrong (showing
   slots that shouldn't be open, or hiding ones that should be), check
   `th_bookings_availability` -- a view, not the base table, exposing
   only `start_at`/`end_at` to `anon` (deliberately no `security_invoker`,
   since that would make the view enforce the base table's own lack of
   an `anon` SELECT policy and return zero rows for everyone -- the
   opposite of the intent). `select * from th_bookings_availability;`
   as the `anon` role (`set role anon;` in the SQL editor) should show
   real upcoming bookings' times and nothing else -- no name, phone,
   email, or address.
6. **A submission can succeed without ever getting the row back.** The
   public booking form explicitly does NOT use
   `Prefer: return=representation` on its insert, because `anon` has no
   SELECT policy on `th_bookings` at all (real customer PII) -- asking
   for the row back would fail even though the insert itself succeeds,
   the same general trap described in Scenario 5 above. If a "booking
   failed" report turns out to actually be in the database, this is
   almost certainly why -- check success by HTTP status alone, not by
   whether a row came back.
7. **If a guest's cancel or reschedule link doesn't seem to be working:**
   check `select cancel_token from public.th_bookings where id = <id>;`
   and confirm the guest's link actually matches. The two RPC functions
   (`get_booking_by_cancel_token`, `cancel_booking_by_token`,
   `reschedule_booking_by_token` -- `sql/booking/add_booking_cancellation.sql`
   and `sql/booking/add_booking_reschedule.sql`) are all `security definer`, so
   they work for `anon` despite `anon` having no SELECT/UPDATE policy
   on the base table at all. If a reschedule keeps failing with
   `slot-taken` for a time that looks genuinely open, check whether the
   guest's OWN current booking is being counted as a conflict against
   itself -- `manage-booking.html`'s own availability fetch filters out
   the booking's own `start_at` before computing slots; if that filter
   is ever removed, a guest trying to shift their own time by 30
   minutes on the same day will incorrectly see it as unavailable.
8. **If staff push notifications for a cancellation or reschedule stop
   arriving (new-booking notifications still work fine):** the
   consolidated `notify_booking_status_change` trigger on `th_bookings`
   fires on every UPDATE, but `Send-Push`'s own `UPDATE`/`th_bookings`
   handler has to correctly distinguish "cancelled" from "rescheduled"
   from "neither" -- this exact bug happened once already (the handler
   only ever recognized the cancellation transition and silently
   discarded a genuine reschedule, even though the trigger fired
   correctly and the HTTP call itself succeeded every time). Don't
   assume the trigger is the problem first -- insert a real test row
   (or use the Booking notification test panel in Dev Tools, which
   automates exactly this), then check `net._http_response` for the
   actual response body the Edge Function returned, not just whether a
   row landed in `net._http_response` at all. `{"ok":true,"skipped":true}`
   means the trigger fired but the Edge Function's own logic decided
   nothing needed to happen -- that's the bug, not the trigger.
9. **Testing any of this directly in the SQL editor:** `set role
   authenticated;` on its own is NOT enough to make `auth.role()`
   return `'authenticated'` -- that function specifically reads from
   the `request.jwt.claim.role` session setting, which a bare role
   switch never populates, so every `authenticated`-gated RLS policy
   will silently behave as if the caller were unauthenticated (a
   SELECT returns zero rows, an UPDATE/DELETE silently affects zero
   rows -- no error either way). Add
   `set request.jwt.claim.role = 'authenticated';` right after the
   role switch to actually simulate a real logged-in session. This is
   exactly how the missing DELETE policy on `th_bookings` was found --
   a plain `set role authenticated;` made a DELETE look like it
   succeeded (no error) when it had actually silently done nothing.

## Scenario 8: Uptime monitoring shows wrong status, or stops alerting

The in-house HetrixTools replacement. Deliberately entirely external
to Supabase -- a `pg_cron` job running inside a paused database can't
wake that same database back up to run itself, so this runs from
GitHub Actions instead (`uptime-check.yml`, every 10 minutes), checking
the live site the way a real visitor would.

1. **Check the workflow is actually running:** GitHub → Actions tab →
   "Uptime monitoring" -- a long gap between runs, or a run failing
   outright, means checks have simply stopped happening, which will
   look identical to "the site has been up this whole time" in
   `th_uptime_checks` (no new rows either way).
2. **Alerts only fire on a genuine state transition** (up→down or
   down→up), never on every check during an ongoing outage -- this is
   intentional, not a bug, so don't expect a push every 10 minutes
   while something's actually down.
3. `select * from th_uptime_checks order by checked_at desc limit 20;`
   shows the real, raw history if the Dev Tools panel's own summary
   ever seems to disagree with reality.
4. The alert itself goes through the same two-channel pattern as every
   other notification in this app: the `uptime-alert` Edge Function
   calls `Send-Push` directly for the push half, and Resend directly
   (reusing the lead-email pipeline's existing secrets) for the email
   half -- independent failure modes, same reasoning as Scenario 6.

## Scenario 9: A sync stops working / data won't save across devices

1. Dev Tools → Session & Sync → check "Last sync attempt" and its
   History dropdown -- shows the actual error, not just pass/fail.
2. **A real historical bug, already fixed, worth knowing about:**
   `pushSync()` used to include `keepalive: true`, which caps the total
   request body at 64 KiB -- once the combined synced data grew past
   that (specifically once Appliance Wiki's data got added to the sync
   bundle), every push failed with a generic "Failed to fetch" and zero
   detail. Already removed; if a similarly generic, unhelpful sync
   failure ever recurs, check whether some *other* growing piece of
   data got added to the sync bundle without being capped.
3. Each device's own local data can be inspected directly: Dev Tools →
   Local Data Snapshot.
4. If the specific symptom is "a deleted record keeps coming back"
   rather than data failing to save at all, that's not this scenario --
   see "Deletion resurrection / tombstones" below instead.

## Worst case: both `connor@` and `steve@` Supabase accounts are lost

This would mean losing the ability to log into any internal tool page
(all gated by `requireAuth()`), and losing the ability to make any
authenticated write to Supabase (site content edits, job/invoice data,
etc.) -- though the underlying *data* itself would still exist in
Supabase, just inaccessible through the app's normal login flow.

**Recovery path:** Supabase project access (the actual Supabase account
that owns this project, separate from these two app-level accounts) can
create new Auth users directly from the Supabase dashboard (Authentication
→ Users → Add user), using the same two email addresses, and set new
passwords. The app's `auth.js` already maps these two specific emails to
"Connor"/"Steve" display names (`KNOWN_USER_NAMES`), and each account's
actual Dev Tools access now comes from the `account_roles` table in
Supabase (Connor: Developer, Steve: Owner -- see the "Account roles
system" section below), not from a hardcoded email check anymore. So
recreating the Auth accounts with the same emails restores login, but
if `account_roles` itself were ever lost too, the two rows would need
re-inserting (`connor@... -> Developer`, `steve@... -> Owner`) via a
direct migration, since the app's own UI requires an already-assigned
manage-roles account to create new role assignments -- exactly the
bootstrapping problem the safety triggers described below exist to
prevent from happening by mistake, but a full Auth-account loss is a
more fundamental case those triggers can't cover. **The actual Supabase
project owner's own login is the one thing with no equivalent recovery
path described here** -- losing access to the Supabase organization/project
itself is a genuinely different, harder problem than losing one of the
two app-level accounts, and isn't something a code-level backup can fix.

## Account permissions system (added 2026-08-15, redesigned 2026-09-02, expanded 2026-09-02)

Replaces what used to be a single hardcoded check
(`getCurrentUserEmail() === 'connor@triplehenterprisesllc.biz'`) gating
the entire Dev Tools page.

**Redesigned 2026-09-02** from role-locked to per-account: booleans
now live directly on each account's own `account_roles` row,
individually toggleable in Dev Tools -> Access -> Account
permissions, live immediately (no deploy, no role reassignment).
`role_definitions` still exists but is no longer read at authorization
time anywhere -- it's a PRESETS table only, for prefilling a
brand-new account's checkboxes in the management UI. `role_name` on
`account_roles` is now an optional display label ("started from the
Owner preset"), not authoritative.

**Expanded to 9 checkboxes the same day**, requested directly:
"Review tool? Checkbox. Dev tool stats? On today, off tomorrow." The
original redesign still had 2 real coarse spots: `can_manage_business_finances`
bundled 5 genuinely distinct tools (Invoices, Contracts, Finance,
Runway, Review Requests) under one checkbox, and the 27 technical Dev
Tools panels were gated on `can_manage_roles` (an unrelated
capability -- "can this account manage everyone's permissions" has
nothing to do with "can this account see diagnostic panels"). Current
9: `can_manage_roles`, `can_access_dev_tools`, `can_access_dev_tools_full`
(the 27 technical panels, now its own checkbox), `can_manage_site_content`,
`can_manage_invoices`, `can_manage_contracts`, `can_view_finance`,
`can_view_runway`, `can_manage_reviews`. `can_manage_business_finances`
was dropped as a column entirely -- every real reader (`auth.js`,
`dev-tools.html`, and 8 edge functions) was updated in the same
change; see `sql/security/granular_permissions_expansion.sql` for the
full migration and `docs/CLIENT-PORTAL.md`'s "Permission model, in
brief" for which specific check each edge function uses.

**A real mistake happened during that expansion, worth recording
here plainly:** the migration dropped `can_manage_business_finances`
before all 8 dependent edge functions were redeployed with their
corrected queries, which meant every one of them was briefly
live-broken (querying a column that no longer existed, rejecting
every legitimate caller with 403) until each was individually
redeployed. The correct order for a change like this: deploy every
dependent's new code first (harmless while the old column still
exists alongside the new ones), THEN drop the old column in a
separate, later step -- never drop first and fix callers after.

A single `current_user_can_manage_roles()` SQL function is what RLS
policies on `account_roles` call to decide who can change permissions
at all -- reads `can_manage_roles` directly off the caller's own row,
no join. One safety trigger (`guard_last_role_manager_permission`,
replacing the old pair `prevent_removing_last_role_manager` +
`prevent_disabling_last_role_manager_capability`, which existed only
because permissions used to live in two places) blocks the one real
failure mode: an UPDATE or DELETE on `account_roles` leaving zero
accounts with `can_manage_roles = true`, which would permanently lock
everyone out of ever granting anyone anything again. Tested directly
against the live database before being trusted -- deliberately tried
to remove the last manager's permission and confirmed it was rejected.

**If Dev Tools access (or any specific tool) seems broken for an
account:** check
`select email, can_manage_roles, can_access_dev_tools, can_access_dev_tools_full, can_manage_site_content, can_manage_invoices, can_manage_contracts, can_view_finance, can_view_runway, can_manage_reviews from account_roles;`
first. If the account's row is missing, or the relevant boolean is
`false`, that's almost certainly the actual cause, rather than
anything in the frontend code.

**Two genuinely separate real bugs were found investigating one
report, 2026-09-02** -- a fully-permissioned account got blocked from
`review-request.html`, and BOTH turned out to matter, not just one:

1. `loadCurrentUserRole()` (`tools/auth.js`) makes a single network
   request to confirm the caller's permissions and fails CLOSED by
   design; a dropped connection on that one request alone was enough
   to show a false "not available here," even though the account's
   actual row was completely intact. Fixed with a retry (up to 3
   attempts with backoff), same day.
2. **The more serious one, found while double-checking the first fix
   actually explained everything:** `requireAuth()` fires
   `refreshSession()` UN-awaited at the top of every protected page,
   and `loadCurrentUserRole()`'s own `ensureFreshToken()` can trigger
   a SECOND, independent `refreshSession()` call moments later on the
   same page load. Supabase rotates refresh tokens on use, so two
   concurrent calls sharing one stored `refresh_token` is a genuine
   race -- whichever request loses gets rejected, and the old code
   responded to that rejection by calling `clearStoredSession()`,
   **wiping out a session the FIRST call had just successfully
   refreshed a moment earlier.** This is a substantially better
   explanation for an intermittent, unpredictable-looking lockout than
   a permissions problem ever was. Fixed by de-duplicating concurrent
   `refreshSession()` calls into one shared in-flight promise -- see
   `tests/sync/role-check-retry.test.js` for a test that reproduces
   the exact race directly (two overlapping calls, confirms only ONE
   real network request ever fires) rather than just asserting the
   fix exists.

Worth checking the database and both of these directly before
assuming a real permission change happened.

**Owner-restricted view (added 2026-08-21, decoupled 2026-09-02):**
`can_access_dev_tools_full` (not `can_manage_roles` anymore -- see the
granular expansion above) controls how much of Dev Tools an account
actually *sees*, not just whether it can change permissions. An
account without that permission only sees Client Registry and Account
permissions -- the other 23 panels (everything code/technical/error-diagnostic
in nature, organized into 5 tabs as of 2026-08-25's navigation
redesign -- Health, Access, Session, Notifications, Deploy) are
hidden via `applyOwnerRestrictedView()` in `dev-tools.html`, keyed off
the real `canAccessDevToolsFull()`. If an account reports "most of Dev
Tools is missing," that's this feature working as intended, not a bug --
confirm by checking their `account_roles` row's `can_access_dev_tools_full`
value first.

**Account permissions panel UI, redesigned 2026-09-02, requested
directly.** Was a full row of 9 checkboxes per account; the
"Preview Account permissions as" simulation toggle was also removed
entirely in the same change (it added a layer of "is this real or a
preview" ambiguity that wasn't worth keeping). Now: pick ONE account
from a dropdown (`#permAccountSelect`), then click a category button
(Dev Tools, Money, Grow, Site, Admin -- grouped in
`PERMISSION_CATEGORIES` in `dev-tools.html`, matching workspace.html's
own tool-group-label names for "Money" and "Grow") to expand just that
category's checkboxes, one category open at a time
(`_openPermCategory`). `_cachedAccountsData` holds the last fetch so a
single checkbox toggle updates the local cache and re-renders only the
category panel -- no refetch, no losing the open category or selected
account.

**A real bug already happened here once, worth knowing about:** the
dev-tools dashboard tile went invisible for *every* account (Connor
included) for a period after this system first shipped, because the
tile-visibility check ran synchronously on page load, before the
account's role had actually finished loading over the network. Fixed
by moving that specific check to run after `initSyncOnLoad()` resolves
instead of before it. If a *similar* symptom ever recurs (something
that depends on `hasDevToolsAccess()` or `canManageRoles()` appearing
to silently fail), check the calling code's timing relative to
`initSyncOnLoad()` before assuming the database side is wrong -- it
usually isn't.

## Realtime cross-device sync (fixed 2026-08-15)

`sync.js` has always subscribed to `postgres_changes` events on
`workspace_sync` and `th_leads` -- the "Live sync: connected" badge
across Job Tracker, Invoice Generator, etc. depends on this. But neither
table was ever actually added to the `supabase_realtime` publication
until 2026-08-15, so the badge had likely been showing "connected" this
whole time while silently delivering zero real cross-device events.
**If live sync ever seems to stop working again:**
`select tablename from pg_publication_tables where pubname = 'supabase_realtime';`
should list both `workspace_sync` and `th_leads`. If either is missing,
that's the whole problem -- `alter publication supabase_realtime add table public.<name>;`
fixes it immediately, no code deploy needed.

## Deletion resurrection / tombstones (2026-08-25 through 2026-08-26)

**The symptom, if this mechanism is ever missing for something:** a
job, client, expense, invoice, or similar record gets deleted on one
device, then reappears later, unprompted, usually after another device
syncs. This is not a UI bug and not a "sync is broken" issue in the
sense Scenario 9 above covers -- it's a specific, structural gap in how
`applySyncData()` merges data, and it now has a real, working fix.

**Why it happens at all.** `workspace_sync` holds everything (jobs,
invoices, contracts, clients, expenses, income, contacts, quotes) as
one JSON blob, and `mergeRecordArrays()` reconciles a device's local
copy against whatever it just pulled by taking the *union* of both
sides, by id. A union can't tell "this record never existed here"
apart from "this record existed here and was deliberately deleted" --
so a device that still has a since-deleted record cached locally (it
hasn't pulled the deletion yet) will keep pushing it right back,
resurrecting it on every other device that pulls after that.

**The fix: a tombstone per record type that supports deletion.**
Deleting something doesn't just remove it from its own array -- it
also appends `{ id, deletedAt }` to a matching `th_X_tombstones` array,
which is itself a synced key (unioned across devices exactly like
everything else, so a tombstone recorded on one device reaches every
other one too). `applySyncData()` reads the relevant tombstone list
right after merging it, and filters any tombstoned id back out of the
record type it protects, every single pull. As of 2026-08-26, every
record type with a real delete action has this:

| Record type | Delete function | Tombstone key |
|---|---|---|
| Clients | `thDeleteClient` (dev-tools.html) | `th_client_tombstones` |
| Jobs | `deleteJob` (job-tracker.html) | `th_job_tombstones` |
| Expenses | `deleteExpense`, `clearAllExpenses` (finance.html) | `th_expense_tombstones` |
| Income | `deleteIncomeEntry`, `clearAllIncome` (finance.html) | `th_income_tombstones` |
| Contacts | `deleteContact` (job-tracker.html) | `th_contact_tombstones` |
| Contracts | `deleteContractLogEntry` (contract-generator.html) | `th_contract_tombstones` |
| Invoices | `deleteInvoiceLogEntry` (invoice-generator.html) | `th_invoice_tombstones` |
| Quotes | `deleteQuoteLogEntry` (invoice-generator.html) | `th_quote_tombstones` |
| Price reference | `deletePriceReference` (finance.html) | `th_price_ref_tombstones` |
| Job templates | `deleteTemplate` (job-tracker.html) | `th_template_tombstones` |
| Known issues | `deleteKnownIssue` (dev-tools.html) | `th_known_issue_tombstones` |
| Appliance Wiki units | `deletePrUnitType` (parts-reference.html) | `th_pr_unit_tombstones` |
| Appliance Wiki issues | `deletePrIssue` (parts-reference.html) | `th_pr_issue_tombstones` |

The last row above has a real wrinkle worth knowing if this pattern is
ever extended again: issue ids are `Date.now()`-based and only unique
*within* their own unit's `issues` array (the merge for issues runs
separately per unit), not globally -- so this tombstone is keyed by a
composite `unitId::issueId`, not the issue id alone. A global-only
tombstone here could have accidentally filtered out an unrelated issue
in a *different* unit that happened to share the same millisecond-based
id. Confirmed directly with a test covering exactly that collision.

The bottom 5 rows above were found by directly re-checking, after the
first pass, whether "every delete function in the codebase" actually
meant every one -- it hadn't. Worth remembering next time this list
needs extending: grep for every `function delete` in `tools/*.html`
and check each one against `MERGE_KEY_FIELD`, rather than trusting an
earlier pass's claim of completeness.

Invoices and quotes didn't have a delete action of any kind until
2026-08-26 -- added then, with the tombstone built in from the start
rather than as a later fix, unlike every row above it in this table.

**If a new record type ever gets a delete button added later,** it
needs this same treatment from day one, not as an afterthought: a
`thAddXTombstone(id)` / `thLoadXTombstones()` pair in `data-layer.js`
(id-only is enough -- none of these track a normalized name the way
clients do, since nothing else backfills any of them from other data
by name), the new tombstone key added to both `SYNC_DATA_KEYS` in
`sync.js` (positioned *before* the record type it protects -- the
filter step in `applySyncData` reads it fresh from localStorage right
after its own merge runs, which only works if that's already happened)
and `MERGE_KEY_FIELD` (`'id'`), a new `else if` branch in
`applySyncData()` filtering the merged array against that tombstone
set, and the actual delete function calling `thAddXTombstone(id)` at
the point the record is actually, permanently removed -- not at the
point the undo window starts, if there is one.

`tests/tombstones-extended.test.js` and the job/client-specific tests
in `tests/client-registry-delete.test.js` show the exact, repeatable
test shape for verifying a new one of these: the tombstone function
directly, confirming the real delete function actually calls it (via
source inspection for anything async/modal-driven, since those aren't
practical to simulate end-to-end), and the real stale-device
resurrection scenario via a direct `applySyncData()` call.

## Graveyard (added 2026-08-26, requested directly: "so items aren't gone forever in the event of a mistake")

A deliberately separate mechanism from the tombstones above. Worth
being clear about the distinction, since it's easy to conflate them:
tombstones only ever record `{ id, deletedAt }` -- just enough to stop
a stale device's union merge from resurrecting something. They were
never meant to enable recovery and don't carry the record's actual
data. The graveyard does: a full snapshot of the deleted record
itself, in a separate synced key (`th_graveyard`), so a genuine
mistake can actually be undone rather than merely prevented from
silently reappearing.

**Where it lives:** Dev Tools → Session & Sync tab → "Graveyard"
panel. Lists every deleted job, client, expense, contact, and so on
(newest first), each with a Restore button and a permanent-delete
button. Capped at the most recent 200 entries -- `mergeGraveyard()` in
`sync.js` re-applies this cap after merging two devices' copies
together, for the identical reason `mergeClientErrorLog()` already
needed to (a plain union of two independently-capped 200-entry lists
could otherwise reach 400).

**How restore actually works, and why the tombstone removal matters:**
`restoreFromGraveyard()` puts the record back into its live array
*and* removes the matching tombstone. Skipping that second step would
make the restored record disappear again on the very next sync pull --
the tombstone would still say "this was deliberately deleted," and
`applySyncData()` would filter it right back out. A small,
config-driven map (`GRAVEYARD_TYPE_CONFIG` in `dev-tools.html`) covers
the storage key, tombstone key, and a display label for every flat,
id-keyed record type. Appliance Wiki issues are the one exception --
they're nested inside a unit rather than living in their own array, so
restoring one means finding its parent unit and pushing the issue back
into that unit's `issues` array. If the parent unit was *also*
deleted, restore refuses with a clear message rather than silently
failing or losing the graveyard entry -- restore the unit first, then
the issue.

**A real, honest limit, not glossed over:** a deleted expense's
attached receipt photo is not recoverable through this. The actual
file removal from Supabase storage happens immediately as part of
`deleteExpense()`, before the graveyard would even have a chance to
help -- restoring the expense brings back its own fields (amount,
description, date, etc.) but not the receipt image itself, since that
file is genuinely, separately gone by the time restore could run.

`tests/graveyard.test.js` covers the data-layer basics, the merge/cap
behavior, that every delete function actually calls
`thAddToGraveyard()`, the full delete-then-restore-then-survives-a-
sync-pull flow, the nested Appliance Wiki issue case (including the
parent-unit-also-deleted refusal), and permanent deletion.

## Daily reminder check / pg_cron (Vault-migrated 2026-08-15)

The `Send-Push` Edge Function's `reminder-check` payload type is called
once daily by a `pg_cron` job named `daily-reminder-check` (jobid 3,
`0 1 * * *`). This job used to have the `service_role` key hardcoded
directly in `cron.job.command` -- same class of issue
`notify_new_lead()` had before its own Vault migration -- and has since
been re-scheduled under the same job name to look the key up from
`vault.decrypted_secrets` (secret name `send_push_service_role_key`,
the same one `notify_new_lead()` already uses) instead. If this job
ever needs re-creating from scratch, do NOT hardcode the key again --
copy the vault-lookup pattern from either this job's current definition
(`select command from cron.job where jobname = 'daily-reminder-check';`)
or from `notify_new_lead()`'s own source.

As of the same date, the Edge Function also gained an 11th check:
leads sitting 24+ hours with `handled = false` get a daily push nudge
(resends every day on purpose, unlike the other 10 checks which mostly
notify once) until marked handled. Uses the existing `th_leads.handled`
column -- no schema change was needed.

## Storage security (fixed 2026-08-14)

`storage.objects` had leftover `anon`-role SELECT policies on the
`job-photos` and `receipts` buckets, predating the private-bucket +
signed-URL migration described earlier in this document. These let
anyone holding the public anon key read customer job photos and
financial receipts directly, bypassing the signed-URL system entirely.
Removed after confirming (via `grep`, not by trusting a code comment)
that the app's only public-URL function had zero call sites anywhere.
**If storage access ever seems broken for an authenticated account**,
confirm first that the `authenticated`-role policies (view/upload/delete,
all 3 buckets) are still present -- those were never touched by this
fix and should be the only policies `storage.objects` has going forward.

A second dead public-URL function (`getReceiptUrl()`, the receipts
equivalent of `getJobPhotoUrl()`) was found and removed the following
day during unrelated work building the Storage browser -- same pattern,
zero call sites, would only have worked if the bucket were public.

## Automated jobs added 2026-08-15

Three new `pg_cron` jobs and 4 new GitHub Actions workflows -- see the
"Automated jobs" section of `README.md` for the full list of what each
one does. Two things worth knowing if any of them ever misbehave:

- **`archive-old-notification-log` retention is 3700 days, not
  something shorter.** An earlier draft of this migration used 120
  days, which would have silently broken the two "nudge once, ever"
  reminder-check categories (job-no-photos, warranty-checkin, both
  using a 3650-day resend interval) by deleting their de-dup row and
  letting them fire again as if they'd never sent. Caught before it
  ever ran for real. If notification_log retention is ever changed
  again, it must stay longer than the longest `RESEND_DAYS` value in
  `edge-functions/send-push-index.ts`, not shorter.
- **`backup-business-data.yml` was retired (2026-08-27), replaced by
  `backup-sensitive-data.yml`, which pushes to a separate, private repo
  (`tripleh-private-backups`) instead of this one.** Found directly,
  while building the Storage-file backup below: `workspace_sync`
  (which this workflow already backed up, since it first existed) had
  already committed real, exposed client PII -- real names, phone
  numbers, addresses, emails -- into this repo's history, because this
  repo is public and the original workflow was never built with that
  constraint in mind. `th_leads`/`th_bookings` hadn't leaked real data
  yet (both were still empty when this was found) but had the exact
  same latent risk. The new workflow needs a `SUPABASE_SERVICE_ROLE_KEY`
  repo secret (already set, same key as before) AND a new
  `PRIVATE_BACKUP_REPO_TOKEN` repo secret -- see
  `backup-sensitive-data.yml`'s own header comment for the one manual
  setup step this requires (fine-grained PATs can't be minted via the
  API, only created by hand in GitHub's own UI). If this workflow's
  runs show "repo secret is not set" in the Actions log, that's the
  secret that needs adding.
- **Storage files (job-site photos, receipts, secure documents) had
  zero backup coverage anywhere at all until `backup-sensitive-data.yml`
  -- confirmed directly, not assumed.** Neither the old
  `backup-business-data.yml` nor Supabase's own Pro-tier daily backups
  cover Storage, only database tables. `scripts/backup-storage-bucket.py`
  handles this now, recursing into each bucket's real subfolder
  structure -- a real bug caught during testing before this ever ran
  for real: a flat, non-recursive list of these buckets returns only
  top-level folder placeholders (`id: null`), not the actual files one
  level deeper, which would have made this "succeed" every day while
  silently backing up nothing.
- **The exposed data already committed to this repo's history (from
  before 2026-08-27) has not been purged from git history as of this
  writing** -- removing the current files stops new exposure but does
  not remove what's already in past commits. That's a separate,
  deliberate decision requiring a force-push (this repo has branch
  protection against exactly that, which would need temporarily
  disabling) -- check with Connor directly on current status before
  assuming either way.

---

# Folded in from `DISASTER_RECOVERY_ADDENDUM.md` (2026-09-04 → 2026-09-07)

## ⚠️ CORRECTED: the "local test failures are a checkout artifact" note

The addendum this section came from contained a claim that has since
been **disproven directly, and it was actively harmful** — it told
future sessions to ignore the one signal that would have caught a real
problem. It is preserved here in corrected form rather than deleted,
because the reasoning failure is worth keeping.

**What the addendum claimed:** that local `npm test` failures with names
like *"the cache-bust check passes cleanly"* / *"CACHE_NAME was bumped"*
were a checkout-environment artifact caused by git line-ending
conversion, and that **"GitHub Actions' own CI has passed cleanly on
every single PR through this entire period"** — so a local failure could
be safely disregarded if CI was green.

**What was actually true (verified 2026-09-07):**

1. **CI was not green. It had been failing on every single push since
   PR #118** — through #118, #119, #120, #121 and beyond. The claim that
   it passed cleanly was never checked against the Actions tab.
2. **The failures were real, deterministic, and reproducible in every
   environment** — nothing to do with line endings. Six test files
   pinned an exact literal `CACHE_NAME` (`th-portal-v10`,
   `th-workspace-v59`; seven assertions total). That is in permanent
   conflict with this project's own mandatory rule that `CACHE_NAME` is
   bumped whenever a precached file changes. The suite went red the
   first time somebody followed the rule correctly (#118, "v10 → v11")
   and stayed red for every correct bump after.
3. **The line-ending theory was tested and did not hold.**
   `git show HEAD:tools/tools-nav-pwa.js | md5sum` and `md5sum` of the
   working copy produced an identical hash; `core.autocrlf` was unset
   and no `.gitattributes` existed. The working tree matched the
   committed blob byte-for-byte. (This may genuinely have been a real
   effect on one particular Windows checkout — but it was not the cause
   of these failures, and it was used to dismiss failures that were
   real.)
4. **The consequence was not cosmetic.** `.github/workflows/test.yml`
   runs `npm test` *before* `check-undefined-vars`, `check-consistency`
   and `check-visual-snapshot`. A failing `npm test` aborts the job, so
   **those three steps stopped executing entirely.** `check-consistency`
   is the guard against stale `?v=` cache-bust stamps — the exact class
   of bug that has caused real "the site shows no changes even in
   incognito" incidents here. With it silently not running, real drift
   reached `main` undetected: `tools-nav-pwa.js` and `tools-tour.js`
   were both sitting on stale stamps across 22 pages.

**Fixed 2026-09-07:** every frozen assertion now checks a *floor*
(constant exists, is well-formed as `<prefix>-v<N>`, and is at or above
the version its feature landed at). Verified by deliberately breaking it
three ways: a lowered version and a malformed version both still fail
the suite; the correct current value passes. `npm test` is 1055/1055.

**The durable lesson:** if a test asserts an exact value that a
documented rule requires you to change, the test will break every time
someone is correct. Assert the invariant, not the snapshot. And never
assert what CI is doing without opening the Actions tab.

## Current cache-bust / precache version numbers (as of 2026-09-08)

These exist so a future session can sanity-check "is this stale" without
re-deriving it. They will be wrong again soon — that's expected. Confirm
the real value in each file directly.

- `styles.css` cache-bust stamp: `?v=202609081652`
- `service-worker.js` (Workspace/tools) `CACHE_NAME`: `th-workspace-v114`
- `portal/service-worker.js` `CACHE_NAME`: `th-portal-v47`

**The rule that governs all three, restated because it keeps causing
real incidents:** any file in a service worker's `PRECACHE_URLS` that
changes requires that worker's `CACHE_NAME` bumped, or every device with
the PWA installed keeps serving the old copy indefinitely — a hard
refresh does not help, because the worker intercepts the fetch before it
reaches the network. Separately, any file referenced with a `?v=` query
string that changes requires that stamp bumped in **every** referencing
page, or GitHub Pages' CDN (Fastly) keeps serving the old file under the
unchanged URL to everyone — incognito does not help either, since
Fastly's cache lives outside the visitor's machine. Two caching layers,
two different fixes. A real incident during this period traced to
exactly the second one.

`npm run fix-versions` recomputes and corrects every `?v=` stamp
automatically. As of 2026-09-07 it covers `portal/` too, not just
`tools/`. There is still no one-command fix for a `CACHE_NAME` — that is
bumped by hand, every time.

## Scenario 10: A client reports a portal problem that never shows up anywhere

The portal now captures every real client-side JavaScript error into
`portal_client_errors`, not just the client-initiated "Report a problem"
button.

1. **Dev Tools → Clients → Portal client errors** shows every error
   caught automatically, including the client's email (if signed in),
   the page, and the actual message/stack. First place to check.
2. Capture is capped at 10 reports per page load (an error inside a loop
   shouldn't flood the table) and auto-pruned after 30 days by a
   `pg_cron` job, `cleanup-old-portal-client-errors` — diagnostic data,
   not a permanent audit log.
3. If the panel shows nothing for a reported problem, the error may have
   happened before the portal's JS loaded far enough to register the
   capture, or the client may be on a very old cached `portal-app.js`
   from before this existed — check their installed app version.

## Scenario 11: A payment shows succeeded in Stripe but the invoice still shows unpaid

A daily reconciliation check, `reconcile-stripe-payments` (Edge
Function, `pg_cron` as `daily-stripe-reconciliation-check`, 6am daily),
catches a missed webhook delivery.

1. It checks the last 8 days of succeeded Stripe payments against
   `client_portal_invoices` and sends a push alert on a mismatch.
2. **Deliberately alert-only. It never marks anything paid
   automatically.** A human decides whether it was genuinely missed, a
   refund, a dispute, or a real bug, then uses `set-invoice-paid`.
3. **Required secret:** `STRIPE_RECONCILE_SECRET_KEY` — its own narrowly
   scoped Stripe restricted key (PaymentIntents: Read only). If the
   check silently stops, confirm this secret still exists first; the
   function logs a clear "secret is not set yet" message and returns 500
   rather than failing silently.
4. Alerts resend daily until resolved, on purpose.

## Scenario 12: The portal's biometric lock is stuck, re-prompting, or a client is locked out

An optional, client-enabled **local** device lock (Settings → Security).
Not a server-verified factor — the client still signs in with their real
password; this only adds a local check in front of an already-valid
session on one device.

1. **Re-prompts on every page:** was a real, fixed bug — the "already
   unlocked" state used a plain JS variable, which resets on every
   navigation in a multi-page app. It now uses `sessionStorage`. If this
   regresses, check `portalGuardWithBiometricLock` in
   `portal/portal-app.js` for a `sessionStorage` check.
2. **A broken sensor must never lock someone out:** Settings is
   **deliberately never gated by this lock**, so the toggle is always
   reachable. If Settings ever becomes gated, that is a regression to
   fix immediately — the lock's "use password instead" fallback only
   returns them to the same locked state.
3. Stored per-email in `localStorage`, never in Supabase, so it never
   carries between devices.

## Scenario 13: A client-facing complaint about the invoice/receipt PDF

1. **The PAID stamp covers the total.** The stamp is at a fixed
   position; the total's position is dynamic. With little content above
   it, the total landed inside the stamp (jsPDF has no z-order — second
   drawn paints over first). Fixed with a floor on the total's position,
   applied only when the stamp exists: `Math.max(y, 255)` in
   `downloadInvoicePDF` in `portal/dashboard.html`.
2. **A receipt shows no line items.** Before this period the internal
   `invoice_log`/`quote_log` never stored line items — only totals. An
   invoice only ever downloaded as a PDF and never sent to a portal
   account lost that detail permanently. Both logs now save
   `line_items`. **If this recurs, the most likely explanation is an
   invoice created before that fix** — there is no way to recover it
   retroactively; the data was never captured.

## Scenario 14: A form field zooms the whole page in when tapped on a phone

iOS Safari (and some Android browsers) auto-zoom when a tapped
`input`/`select`/`textarea` has a computed font-size under 16px. The fix
pattern, already applied everywhere: a generic
`input, select, textarea { font-size: 16px; }` rule, **plus** bumping
any more-specific selector's own font-size to 16px individually (a more
specific selector wins regardless of file order).
`tests/site-wide/mobile-zoom-fix.test.js` scans every HTML file and
fails if it finds a sub-16px font-size on any of the three. If that test
fails, this is exactly what reappeared.

## Scale-related fixes made this period (informational, not incident-driven)

- **Missing indexes** on `client_portal_jobs.client_email` and
  `card_authorizations.client_email`, despite both being filtered on
  that exact column in their own RLS policies. Both added.
- **A real duplicate-push-notification bug:** nothing prevented a client
  toggling push off and on repeatedly from inserting a fresh
  subscription row for the same device endpoint each time — genuinely
  duplicate notifications on every future send. Fixed with a unique
  constraint on (`user_id`, `endpoint`) as a real column (PostgREST's
  upsert only works against real columns, not a JSONB expression) and a
  genuine upsert in both `tools/push-notifications.js` and
  `portal/push-notifications.js`.
- **Unbounded tombstone growth:** all 13 `th_*_tombstones` arrays grew
  forever, one entry per deletion. Each only needs to survive until
  every device has synced the deletion once. A shared 90-day prune now
  runs on every add. Preventive — nothing is old enough to be pruned yet.

## The public site's visual redesign ("scroll-craft") — rollback

Starting 2026-09-06, the public marketing site went through a
substantial visual redesign using the **scroll-craft** skill, committed
at `.claude/skills/scroll-craft/` so it travels with the repo.

This was **presentation-layer work only, by explicit instruction** — the
lead form's insert logic, the booking system's logic, the JSON-LD, the
GA4 snippet, the favicon links, and the by-request-only treatment for
Cedar City/Mesquite were all off-limits and verified untouched by
reading the actual diffs.

A safety checkpoint tag exists:
**`pre-scroll-craft-redesign-2026-09-06`**, pointing at the exact commit
live immediately before the redesign began.

```bash
git checkout main
git reset --hard pre-scroll-craft-redesign-2026-09-06
git push --force-with-lease origin main
```

Force-pushing `main` is disruptive if anyone else has pulled. Reverting
the specific merge commit(s) is the gentler option where sufficient.

## Scenario 15: A CodeQL "Clear text storage of sensitive information" alert won't clear no matter how much the code is sanitized

Hit for real, 2026-09-08, on `tools/tools-media-sharing.js`'s
`logClientError()` (alert #53) and `tools/dev-tools.html`'s
`describeHeaderValue()` (alert #57) — worth knowing before spending a
whole session on the same dead end again.

**What doesn't work:** widening a custom redaction/sanitizer function
(more `.replace()` patterns, stripping more characters, returning only
`.length`/`.charCodeAt()` instead of the raw string). CodeQL's taint
tracking for this rule does not credit a custom string transform as
clearing taint — a value is either untouched by the flow at all, or it
stays "tainted" through arbitrary string operations, slicing, and even
reduction to a derived number. Two separate, real attempts at this
(widening `redactSensitiveText()`, then stripping the literal
characters `describeHeaderValue()` echoed back) both still showed the
identical alert on CI's next scan, on the same sink line, despite the
underlying runtime behavior genuinely being safe by then (verified with
tests executing the real functions against hostile/credential-shaped
inputs).

**What actually worked:** severing the dataflow entirely — never
letting the sensitive-sourced value (or anything derived from it) reach
the persisted-storage call at all. For `describeHeaderValue()`
specifically: the diagnostic string built from real credentials
(`SUPABASE_ANON_KEY`, a live Authorization token) now only ever reaches
`console.warn()` (ephemeral, local, never persisted or synced) instead
of `logClientError()`'s message argument (which does get persisted to
`localStorage` and synced across devices). Once nothing tainted flowed
into the sink at all, CodeQL's own rescan reported zero new alerts.

**Alert #53's own flow (window.onerror's message/stack) is different**
in one real way: the redacted text genuinely needs to be persisted for
the client-error-log feature to have any value at all — there's no
free "log it locally instead" substitute the way there was for a
one-off diagnostic helper. That alert was closed with a documented
inline suppression comment
(`// codeql[js/clear-text-storage-of-sensitive-data]`) instead, on the
reasoning that the actual redaction is real and tested (see
`tests/tools/tools-media-sharing-error-log-redaction.test.js`), even
though CodeQL's static model can't verify that. **This is a weaker
guarantee than severing the dataflow** — inline suppression comments
have shown real inconsistency on this repo (see below) — so if this
alert ever resurfaces as open on the Security tab, don't assume the
suppression comment is doing anything; verify directly (a repo admin
manually dismissing it in the GitHub Security UI, with a reason like
"used in tests," is the more reliable fallback).

**A real, confirmed inconsistency with inline suppression comments on
this repo:** this repo's CodeQL is configured via GitHub's **Default
Setup** (a dynamically-managed scan — `dynamic/github-code-scanning/codeql`
in the Actions tab, not a checked-in `.github/workflows/*.yml` file),
not a custom Advanced-Setup workflow. A PR-level CI check answers "did
this diff introduce a new alert," which is a **different question**
from "is this alert marked closed on the repo's Security tab" — the
latter only updates from a fresh scan of `main` itself (confirmed:
GitHub Pages' automated `Push on main` CodeQL run, visible in the
Actions tab under the dynamic `CodeQL` workflow, is what actually
matters for the Security tab, not the PR branch's own scan). Don't
conflate "PR's CodeQL check went green" with "the alert is now closed
on `main`" — check the Security tab directly, after the post-merge scan
has had a few minutes to run and re-index.

## Scenario 16: A client submits a work request or message and the internal team never gets alerted

**A real, confirmed bug hit exactly this way, 2026-09-09** — found by
directly testing every notification pathway end to end, not by a
client complaint. Root cause: `notify-new-work-order-email` and
`notify-work-order-message-email`'s client→internal branch both
queried `notification_recipients` with `notify_types=cs.%7B%22work_order%22%7D`
(`cs.{"work_order"}` decoded) — a Postgres array-literal, not valid
JSON, for a `jsonb` column. PostgREST rejected every single call with
a 400 ("invalid input syntax for type json"), which the function then
reported up as a generic 502 — logged, never surfaced anywhere a
person would actually see it. **Every internal email alert for a new
work-order request, and every internal alert for a client's message on
one, had silently failed since the feature shipped (2026-09-03) until
this was fixed** — 6 days where a submitted request was still saved and
fully visible in the portal/Workspace, but nobody got pinged about it.
Fixed by using the correct JSON-array containment syntax
(`cs.%5B%22work_order%22%5D`, i.e. `cs.["work_order"]`); both functions
redeployed.

If this ever regresses (a future edit reintroduces a `cs.` filter
against a `jsonb` array column, here or anywhere else):

1. Check **Dev Tools → Clients → Email list** — confirm
   `notification_recipients` actually has rows with `notify_types`
   containing `"work_order"`. If it's empty, that's a real (not a bug)
   "muted" state, and both functions return `ok: true, sent_to: 0`.
2. Reproduce directly: a manual REST call to
   `.../rest/v1/notification_recipients?select=email&notify_types=cs.%5B%22work_order%22%5D`
   with the service-role key should return the recipient rows. A 400
   with `"invalid input syntax for type json"` means the filter syntax
   itself is broken again — check for a `cs.` filter using
   `%7B...%7D` (`{...}`, a Postgres array literal) instead of
   `%5B...%5D` (`[...]`, a JSON array) anywhere a `jsonb` array column
   is queried.
3. The client-facing side (a client seeing their own submitted request
   or the internal team's reply) is entirely unaffected by this class
   of bug — it only ever breaks the internal team's own email alert,
   never the underlying data.

## Scenario 17: A client can't approve/decline a quote, or scheduling from an approved quote fails

1. **Approve/decline** writes `status` on `client_portal_quotes`
   directly from `portal/quotes.html` — check RLS first (a client can
   only update their own row, and only while `status = 'pending'`;
   re-approving or re-declining an already-decided quote is blocked on
   purpose, not a bug).
2. **Self-scheduling an approved quote** goes through
   `schedule-quote-job` (Edge Function), which creates the real
   `th_bookings` row with `quote_id` set — same slot-availability logic
   `booking.html` itself uses, so a quote can't be scheduled into a
   slot the public booking page wouldn't also offer. A "that time was
   just booked" error here means a genuine conflict, not a bug.
3. **Questions** (`quote_questions`) are a separate, simpler table — a
   client asking a question never blocks approve/decline; both can
   happen independently.
4. If a client says they approved a quote but nothing happened: check
   `client_portal_quotes.responded_at` — null means the update never
   actually landed (likely an RLS or network issue on their end, not a
   server-side failure), not null means it worked and the visible
   symptom is elsewhere (e.g. the confirmation screen, not the write).

## Scenario 18: A check-up reminder never fires, or a client's self-scheduled check-up doesn't show up internally

1. `client_portal_checkups` mirrors an internal Recurring Job
   Template via `sync-checkup-to-portal` — but **only** for a client
   who already has some portal presence (an existing invoice/account).
   A checkup for a client with no portal account yet simply has
   nothing to mirror to; that's expected, not a bug.
2. Self-scheduling goes through `schedule-checkup-visit`, which inserts
   into `th_bookings` with `checkup_id` set. Unlike quotes
   (`schedule-quote-job`), this has **no approval/already-scheduled
   guard** — a client can schedule a check-up visit any time it's due,
   without an internal account approving it first. If two check-up
   bookings appear for the same due date, that's this design choice
   working as intended (the client scheduled twice), not a double-fire.
3. `client_portal_checkups.last_created_date` tracks when the internal
   Recurring Job Template last actually created a real job from this
   template — if reminders seem stale, confirm that date against the
   template's own interval in Job Tracker before assuming the portal
   side is broken.
has had a few minutes to run and re-index.

## Scenario 19: A client account seems able to call an internal-only database function, or two RLS policies look redundant on the same table

1. **`next_invoice_number()`/`next_quote_number()`** are `SECURITY DEFINER`
   and restrict themselves internally: each starts with
   `if not public.current_user_has_any_role() then raise exception ...`.
   A client-portal account (any `authenticated` login without a row in
   `account_roles`) gets that exception, not a number. If an internal
   account gets the same exception unexpectedly, check `account_roles`
   for that account's email first — this is almost always a missing/
   mistyped role row, not a bug in the function.
2. **`guard_last_role_manager_permission()`, `notify_new_work_order_email()`,
   `notify_work_order_message_email()`, `notify_work_order_scheduled_email()`**
   all show up in Supabase's security advisor as anon/authenticated-callable
   `SECURITY DEFINER` functions — they are **not** actually callable that
   way. All 4 are `RETURNS trigger` functions, and Postgres itself refuses
   to run a trigger-return-type function outside of a real trigger fire:
   `select guard_last_role_manager_permission();` (or any of the other 3)
   returns `ERROR: 0A000: trigger functions can only be called as
   triggers`, confirmed directly. This is the same shape as
   `notify_new_lead()` back in August (see Scenario "worked as intended"
   pattern throughout this doc) — the advisor flags "callable by
   anon/authenticated," it can't tell that Postgres itself blocks the
   call regardless of role. Don't revoke `EXECUTE` on these or convert
   them away from being trigger-only "to be safe" — they're already safe,
   and doing so would break the trigger itself.
3. **7 tables intentionally carry one merged SELECT/INSERT/ALL policy**
   instead of two ("clients view their own X" OR-ed with "internal
   accounts view all X" in a single `USING`/`WITH CHECK` clause):
   `card_authorizations`, `client_notification_preferences`,
   `client_portal_quotes`, `client_portal_work_order_messages` (both its
   INSERT and SELECT policies), `client_portal_work_orders`,
   `client_profiles`, and `push_subscriptions`. This is a straight port of
   the same fix already applied once to `workspace_sync`/`th_leads` back
   in August (duplicate permissive policies get evaluated twice per
   query) — it just hadn't been carried forward into the tables built
   during the relational-tables and client-portal work. If you need to
   change who can see a row on one of these tables, edit the merged
   policy's `OR` condition directly rather than splitting it back into two
   policies; splitting it reintroduces the exact performance issue this
   fixed. `sql/infra/audit_round3_security_and_performance_fixes.sql` has
   the full before/after for all of them.
4. **`card_authorizations`** holds `stripe_customer_id` (a Stripe
   reference) and an `authorization_text`/`signer_name` record — never a
   raw card number or CVV. Confirmed directly by reading its column list,
   not just the advisor's summary. Only `SELECT` policies exist on it;
   all writes go through a `service_role` edge function. If a future
   audit flags this table again, re-verify the columns rather than
   assuming the shape changed.
