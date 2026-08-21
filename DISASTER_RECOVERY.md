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

## Scenario 7: A sync stops working / data won't save across devices

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

## Account roles system (added 2026-08-15)

Replaces what used to be a single hardcoded check
(`getCurrentUserEmail() === 'connor@triplehenterprisesllc.biz'`) gating
the entire Dev Tools page. Two new tables, `role_definitions` and
`account_roles`, plus a `current_user_can_manage_roles()` SQL function
that RLS policies on both tables call to decide who can create new
roles or change an account's role. Two safety triggers
(`prevent_removing_last_role_manager`, guards `account_roles`;
`prevent_disabling_last_role_manager_capability`, guards
`role_definitions`) block the one real failure mode: accidentally
leaving no assigned role able to manage roles at all. Both were tested
directly against the live database before being trusted -- deliberately
tried to remove the last manager and confirmed it was rejected, then
confirmed a second-manager scenario correctly allows it.

**If Dev Tools access seems broken for an account:** check
`select * from account_roles;` first. If the account's row is missing
or its `role_name` doesn't join to a `role_definitions` row with the
expected `can_manage_roles` value, that's almost certainly the actual
cause, rather than anything in the frontend code.

**Owner-restricted view (added 2026-08-21):** a role having
`can_manage_roles` set (Developer) now also controls how much of Dev
Tools that account actually *sees*, not just whether it can change
roles. An Owner-role account (`can_manage_roles` false) only sees
Client Registry and Account Roles -- the other 19 panels (everything
code/technical/error-diagnostic in nature) are hidden via
`applyOwnerRestrictedView()` in `dev-tools.html`, keyed off the real
`canManageRoles()`. If an Owner reports "most of Dev Tools is
missing," that's this feature working as intended, not a bug --
confirm by checking their `account_roles` row's `role_name` first.
This is separate from the page's own role-preview toggle
(`effectiveCanManageRoles()`), which only changes what the Account
Roles panel itself displays and never affects this restriction.

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
- **`backup-business-data.yml` needs a `SUPABASE_SERVICE_ROLE_KEY` repo
  secret to actually run** -- unlike `backup-cms-content.yml`, which
  uses the public anon key safely because "Anyone can read site
  content" is a real policy, `workspace_sync` requires a genuine
  authenticated session. If this workflow's runs show "repo secret is
  not set" in the Actions log, that secret needs adding (Settings →
  Secrets and variables → Actions), value from Supabase's own dashboard
  (Project Settings → API → service_role secret) -- never from this
  repo or any file in it.
