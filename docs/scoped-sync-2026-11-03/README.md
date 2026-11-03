# Scoped workspace sync — turn-on steps (Phase 2.4, handoff 2026-11-03)

## What changes

The Workspace syncs through one `workspace_sync` row. Its RLS already
refuses anyone not signed in to an `account_roles` account, but every staff
account can read and write the **whole** row, money included, whatever its
Money switch says. This splits the data into two rows, and the database
decides per person:

| Row | Holds | Who can read/write |
|---|---|---|
| `scope:ops` | jobs, clients, contacts, notes, contracts, shifts, inventory, price reference, review requests, diagnostics | any account in `account_roles` |
| `scope:money` | invoices, quotes, income, expenses, tax + set-aside rates, Runway (`rd_*`), graveyard, sync-conflict log | `can_view_finance` or `can_manage_invoices` |
| `tripleh-workspace-2026` (old) | everything, as today | money access only (was: any staff) |

Today only Connor and Steve have accounts, and both have Money, so nobody's
access changes on the day. It matters the day someone is added with Money off
(Phase 4, Team).

## Nothing is live until each step below is approved

| # | Step | Who | Reversible? |
|---|---|---|---|
| 1 | Merge the PR (ships `tools/sync.js`). Before the SQL exists, the client sees no `scope` column and behaves exactly as today. | Connor merges | Revert the PR |
| 2 | Deploy `stripe-webhook` and `create-pos-charge` from `edge-functions/`. They write money to the old row and to `scope:money`, skipping the latter until it exists. Do it with step 1: the drift check flags them until they're deployed. | Claude, after OK | Redeploy the previous version |
| 3 | Apply `sql/sync/01_scoped_workspace_sync.sql`. Additive: adds a `scope` column, seeds the two rows from the old one, replaces the one policy with two. Nothing deleted. | Claude, after OK | Drop the two policies, re-create "Require login", delete the two rows, drop the column |
| 4 | Watch one backup run that includes the two new rows (the backup takes the whole table by `code`), and a sync on each device (Dev Tools → health log clean). | Claude reports | — |
| 5 | Later: bump `minBuild` (version.json + js/app-freshness.js) so every device is on this build, then turn `SYNC_LEGACY_DUAL_WRITE` off and retire the old row (`02_retire_legacy_row.sql`, not written yet). That's the "rotate the old code" step. | Connor decides when | — |

## Transition safety (dual-write)

* Reads merge the old row first, then the scoped rows, so anything a device on
  an older build wrote to the old row is never lost.
* An account with money access keeps writing the old row too, so older builds
  stay in step.
* An account without money access never sees or writes the old row. It doesn't
  hold the money keys, so its whole-blob write would blank them.

## Tests

* `tests/sync/scoped-workspace-sync-db.test.js` runs the real SQL in PGlite.
  It covers who sees which rows, Money off unable to read or write money,
  re-run safety, and the SQL and JS key lists agreeing.
* `tests/sync/scoped-sync-client.test.js` runs the real `sync.js` against
  pre-migration, money and Money-off servers, plus an old device still on the
  old row.
* `tests/payments/stripe-webhook-replay.test.js` checks a POS sale lands once
  in each money row, as the same entry.

## Open question for Connor

The Runway keys (`rd_*`: personal mortgage, debts, family expenses) sit in the
money row, so anyone with Money on would see them. The code already flags this
("worth revisiting if this business ever brings on an employee or bookkeeper").
A third `runway` scope gated by `can_view_runway` is a small addition (one key
list and one policy). It isn't built, because the approved plan says two
scopes.
