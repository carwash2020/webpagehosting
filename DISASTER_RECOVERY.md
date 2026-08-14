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
"Connor"/"Steve" display names and dev-account status (`isDevAccount()`),
so recreating the accounts with the same emails restores full
functionality without any code changes. **The actual Supabase project
owner's own login is the one thing with no equivalent recovery path
described here** -- losing access to the Supabase organization/project
itself is a genuinely different, harder problem than losing one of the
two app-level accounts, and isn't something a code-level backup can fix.
