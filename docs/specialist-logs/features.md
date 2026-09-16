# Feature specialist log

Started 2026-09-16, alongside the `tripleh-features` skill. See `README.md`
in this directory for how these logs work.

## 2026-09-16 -- one-click "Create Invoice" from a job

First real session under this skill. Read `README.md`'s tail and
`docs/ACTION-ITEMS.md` for open items before building anything, per the
skill's own instructions -- found the gap explicitly named in both:
"converting a recurring job template straight to an invoice (still
fully manual each time) remain[s] unbuilt."

Investigated before building: `invoice-generator.html` already had a
Job Ref dropdown (`autofillFromJobRef()`) that fills client
name/address/description once a job is picked manually. So the real
gap wasn't "no linking exists" -- it was "you have to navigate there
and find the job yourself." Fixed by adding a `?jobRef=<id>` deep link
from `job-tracker.html`'s per-job actions, and an `applyJobRefFromUrl()`
on `invoice-generator.html`'s existing `DOMContentLoaded` init that
reuses `autofillFromJobRef()` rather than duplicating its logic.

Decision: did NOT build a separate "convert template directly to
invoice" button that skips the job step. Templates intentionally create
a job first (`createJobFromTemplate()`) so the job still gets tracked,
scheduled, and shows up in job history/margin numbers -- a
template-to-invoice shortcut would let a recurring job dodge all of
that. The one-click "Create Invoice" on the resulting job closes the
same manual-effort gap without removing the job-tracking step.

Ran the full verification suite before finishing: found `jsdom` listed
in `package.json` but not actually installed in this container (111
pre-existing test failures, unrelated to this change) -- ran `npm
install` to fix the environment rather than skip those tests; full
suite (2189 tests) passed clean afterward, plus consistency/
undefined-vars/link checks.

<!-- Add new entries above this line -->
