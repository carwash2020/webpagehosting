# Feature specialist log

Started 2026-09-16, alongside the `tripleh-features` skill. See `README.md`
in this directory for how these logs work.

## 2026-09-18 -- refrigerator and dishwasher repair in St. George

Washer/dryer St. George already existed (`washer-dryer-repair-st-george-ut.html`),
so a dryer-only clone would have been a thin duplicate. Built two unique
appliance niches instead: `refrigerator-repair-st-george-ut.html` and
`dishwasher-repair-st-george-ut.html`. Parent service page is still
`washer-dryer-repair.html` (the only dedicated appliance service page).
St. George slot in `.areas-links` stays the washer page; fridge and
dishwasher link in from the matching What We Fix cards and a line next
to that block so the 8-city grid count does not break.

Same template rules as the washer LP: no AggregateRating, visible 5.0 / 7,
no invented reviews, St. George trip-fee / same-day wording, unique
H1/FAQs/"what we fix"/blog links per appliance. Did not change
`styles.css`. Did not add these paths to the main Services nav dropdown
(that dropdown is the five parent service pages, same as the washer LP).
Sticky bar stays Call + Book; Text is homepage + washer LP only (#288).

## 2026-09-18 -- sticky Text + compact FAQ after the estimate form

Follow-up to #285/#286, not a new backend. Homepage and the washer
St. George LP sticky bar gained Text using the chat bubble's existing
`sms:` href (`analytics-events.js` already fires `text_click`). Book
still goes to `/booking.html`. Did not put Text on every marketing
page or on booking.html (that page is already the conversion, and
Call remains the escape hatch).

Homepage compact FAQ is visible copy only — five questions pulled
from the modal / washer LP, linking to `#faq`. Did not add a second
FAQPage, did not live-fetch this block (the modal still owns
`site_faq`), did not invent trip-fee or same-day numbers.
AggregateRating stays 5.0 / 7.

## 2026-09-18 -- homepage above-fold estimate form

Conversion research wanted a short "just send details" path on the
homepage so visitors do not have to open booking.html. Investigated
before building:

- `#scheduleForm` (email modal) already inserts into `th_leads` with
  honeypot, `client_request_id` idempotency, UTM merge, and
  `lead_form_submitted`. That is the public lead path.
- `booking.html` writes `th_bookings` (a held calendar slot). Wrong
  for "no time picked."
- Portal Request Work is signed-in clients only.

Did not invent a second backend. Extracted `submitLeadFromForm` so the
new `#heroLeadForm` and the modal share the one `th_leads` POST.
Hero fields: name, phone, service, brief details, optional email.
Hidden `source` = "Homepage estimate form" so the Workspace lead-source
breakdown can tell this surface from the modal. Date/time/referred-by
stay on the modal.

Placement: after Schedule/Call, still in the hero. Did not give the
form a CSS `order` — Connor's hex-above-CTA stack (`hero-badge` /
`order:-1` at 860px) stays. Text us reuses the existing `sms:` href
from the chat bubble. Sticky Call+Book unchanged. AggregateRating
untouched (5.0 / 7).

## 2026-09-18 -- service × city landing page template (washer / St. George)

City pages and service pages already existed separately. Explicitly
avoided 42 thin `{service} in {city}` duplicates in the 2026-09-15
lead-gen pass (doorway-page risk). This is one real converting page
for the long-tail query, at `washer-dryer-repair-st-george-ut.html`,
meant to be copied one at a time.

Did not add AggregateRating (city/service pages still must not claim
a rating without the homepage wall). Visible copy uses the GBP match
5.0 / 7. Did not invent reviews. Did not change `styles.css`. Clone
notes live in `docs/service-city-landing-pages.md`.

## 2026-09-17 -- /tools/ fewer-click Mark paid / Mark Done / daily strip

Owner asked for the same capabilities with fewer taps. Investigated
before building: Action Items already called `togglePaid()`, but the
button said Overdue/Unpaid and then `prompt()`ed for an amount. Job
Tracker already had `setJobStatus(id, 'done')` behind swipe, long-press,
and the status dropdown -- desktop table rows still went Edit →
dropdown → Update. `#add-job` already existed but left the add form
collapsed.

Did not add a payment-method field (nothing else on /tools/ required
one for a manual mark-paid). Did not prompt for hours/notes on Done
(the existing `setJobStatus` path does not). Did not touch auth, sync,
blob writes, RLS, the public site, or AggregateRating. Rebased onto
#280: Income list still reads through `invoicesForDisplay()`;
`togglePaid()` still write-backs `th_invoices`.

## 2026-09-17 -- invoices relational read, slice A only

Phase 2 of the jobs/invoices/quotes/contracts cutover, invoices list
only. Put the cache in `sync.js` (`cachedRelationalInvoices` starts
`null`) rather than copying calendar.html's page-local cache, because
two list surfaces needed the same helper and the null-vs-[] trap is
easy to get wrong twice.

Did not convert `finance.html` or `runway-dashboard.html`. Their
invoice reads are synchronous helpers called from many render sites,
and CONTINUE-HERE already said not to force a drop-in swap. Did not
move writes off the blob: `fetchInvoicesFromRelational()` omits
`line_items`, and a read-modify-write from that cache would strip
them. `togglePaid()` / `saveInvoiceLog()` still write `th_invoices`
and invalidate the cache.

Realtime publication for `invoices` follows the jobs pattern. No RLS
edits.

## 2026-09-17 -- booking conversion: sticky CTAs, held-slot copy, referral

Public booking.html only. No Edge Functions, no Supabase schema, no
AggregateRating edit (index stays 5.0 / 4).

#265 left the Call+Book bar off booking.html because the page "already
is the conversion." Rechecked: the missing bar is Call as an escape
hatch (emergencies, people who will not finish the form), not a second
Book destination. Added the same `.sticky-call` pair locally (this
page does not load styles.css). Book is `#stepService` during steps
1–3 so it cannot reload a half-filled form; after confirm it goes to
`/booking.html` for a fresh start.

Success copy now leads with "your slot is held" instead of "we'll call
if anything needs clarifying." Emergency call/text stays under the
timeline. $25 referral credit is on step 1, the referred-by field, and
the confirmation card — same complete-and-paid terms as the FAQ.

Service + ReserveAction JSON-LD (and breadcrumbs) on booking.html.
Deliberately no AggregateRating there: the page only has the compact
proof line, not the reviews wall, and `cta-trust-proof.test.js`
already forbids it.

<!-- Add new entries above this line -->
## 2026-09-17 -- /tools/ Action Items inbox + More overflow (UI only)

Paired with the visual lane the same day. Behavior added, not a new
backend: Action Items grouped into lanes with counts already on
`actionItemCounts`; unread class is `!handled` / unconverted booking /
`status === 'submitted'` / overdue invoice. Bottom-nav More sheet is
injected from `tools-nav-pwa.js` the same way the bar and sidebar
already are. Finance-gated dests in the sheet still hide via the
existing `th-role-loaded` href filter.

Did not change sync, auth, or default-collapsed Action Items
(W10 still wants the Today hero first). Did not put Clients/POS/Dev
in the More sheet -- those were never in the desktop sidebar either.

## 2026-09-17 -- portal usability is layout, not new APIs

Visual lane owned the `/portal/` Home inbox / next-appointment hero /
pay-first invoices pass. Logging here only because the IA change is
easy to redo badly: contracts stayed out of the 5-tab bar on
purpose (the bar is a documented ceiling, Settings already uses the
header-icon escape hatch). They belong on Home cards and in the
action inbox. Deep links (`#invoice-card-`, `#quote-card-`,
`#contract-card-`, `#wo-card-`, `#payFirst`) are hash-only -- no new
Edge Functions, no RLS edits, no Stripe changes.

## 2026-09-17 -- GA4 booking/lead events on the existing measurement ID

Lean conversion follow-up, not a new analytics install. The public
site already had `G-TMJJMGY2DQ` plus `analytics-events.js`
(`phone_click` / `text_click` / `chat_opened`) and two inline success
events (`lead_form_submitted`, `booking_completed`). Did not invent a
new measurement ID and did not rename those events -- GA4 reports
already depend on the names.

Extended the same shared file so every public marketing page that
already loads it also fires `email_click`, `book_cta_click` (any
`/booking.html` link except on the booking page itself),
`booking_page_view`, and `booking_form_start` (once, on first
engagement or if a deep-link already left step 1). Left
`booking_step_view` / `booking_completed` inline on the real
navigation and insert paths so the honeypot still cannot look like a
conversion.

Did not copy-paste gtag calls onto every page, did not touch
`/portal/` or `/tools/`, and did not add recommended-event aliases
(`generate_lead`) that would double-count against the existing custom
names.

<!-- Add new entries above this line -->
## 2026-09-17 -- booking path cleanup after the sticky bar

Follow-up to the Call+Book bar, not a redesign of it. #265 left
Schedule/Book hrefs pointing at the mid-page `#schedule` section on
the homepage (and `/#schedule` on nav/footer of city, service, about,
our-work, blog, and legal pages). The calendar itself is `/booking.html`,
and sending someone to a mid-page card that then asks them to click
Book Instantly is a wasted hop.

Flipped those Schedule/Book hrefs (nav, mobile, footer, hero, sticky
Book) to `/booking.html`. Left `#contact` and the `#schedule` section
id itself alone -- Hours/map still live there, and the service modal's
"or schedule online" still scrolls to the email form on purpose
(it pre-fills that form, not the calendar).

In `#schedule`, Book Instantly is now the orange primary. Homepage
Email is the quiet secondary (`cta-quiet-link`); city/service Call is
the outline secondary, matching the hero pairing. Did not invent
"next available" copy. The booking.html expectations line is the
existing FAQ facts only: no deposit, $25 beyond 15 miles, emergency
= call or text.

## 2026-09-17 -- persistent mobile Call + Book bar

Public-site conversion UX, not a tools/portal feature. The homepage
already had a Call-only `.sticky-call` strip at max-width 760px; the
audit wanted Call AND Book always reachable while scrolling, plus
Schedule as the hero's primary action.

Decided to upgrade the existing strip rather than add a second fixed
element -- chat, back-to-top, and the cookie banner were already
offset for one bottom bar, and a second one would stack into a mess.
Book's href matches each page's header Schedule button (`#schedule` on
the homepage, `/booking.html` on city/service pages, `/#schedule` on
our-work/about/blog index) instead of inventing a third destination.

Did not inject the bar from JS (cookie-consent style). The site's
pattern is duplicated HTML, and a JS-injected bar would flash in after
paint. Did not put it on blog posts, legal pages, or booking.html --
those either already are the conversion, or are not the marketing
surface the audit named. `/tools/` and `/portal/` left alone.

Hero swap is the same pairing on city/service pages because they
already shared the Call-primary markup; leaving them Call-primary
while the homepage flipped would have been the inconsistent case.
Triage + service modal kept Call-primary: different context, and U01
already locked that pairing.

Scoped `body` padding and the cookie/chat/back-to-top lift with
`:has(.sticky-call)` so pages without the bar no longer inherit the
old global 70px bottom padding that assumed a bar they didn't have.

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

## 2026-09-16 (later the same day) -- deep-dive audit, then a client-facing quote PDF

Asked to do a full deep-dive across the project and list what's next.
Read every open doc (`README.md`'s changelog tail, `docs/ACTION-ITEMS.md`,
`docs/CLIENT-PORTAL.md`, `docs/ARCHITECTURE-NOTES.md`, all five
specialist logs) rather than just this one, since "what's next" is a
whole-project question, not a features-lane-only one -- handed the
non-features items (visual polish, manual/SEO items) back to the user
as a categorized list rather than building them myself.

When asked to start on the list, checked Supabase directly before
assuming anything needed deploying: `send-payment-reminder` and
`send-quote-followup` (flagged in ACTION-ITEMS.md as blocked on
dashboard/CLI access I don't have) were both already `ACTIVE` with
source matching this repo exactly, and both crons were already
running. Someone deployed them between that doc being written and now
-- fixed the stale docs rather than re-deploying anything.

Considered building MFA enrollment for the internal `/tools/` staff
accounts next (confirmed via direct SQL against `auth.mfa_factors`
that nobody has it enabled) -- decided against doing this without
explicit confirmation first. `tools/auth.js` deliberately uses raw
`fetch()` against Supabase's Auth REST endpoints rather than the
Supabase JS SDK (a documented, intentional choice, not an oversight),
so adding MFA there means hand-rolling the enroll/challenge/verify
REST calls and reworking the core session/login gate that every
single internal tool page depends on -- unlike the client portal
(where a lockout is annoying), a bug here could lock Steve and Connor
out of the whole business's internal tools. That's exactly the kind
of hard-to-reverse, high-blast-radius change this project's own
guidance says to confirm before touching, not something to start
under a general "go ahead." Left it flagged for the user rather than
building it silently.

Built the standalone client-facing quote PDF instead -- self-contained,
additive-only, no schema/edge-function/auth changes, and a real gap
`docs/CLIENT-PORTAL.md` had already named. Deliberately copied
`portal/dashboard.html`'s `downloadInvoicePDF()` layout closely rather
than designing a new one, including its `loadImageAsDataURL()` helper
duplicated locally (matching that file's own stated reason: isolation
between portal pages, not an oversight to fix). Real differences from
the invoice PDF, not cosmetic ones: always labeled QUOTE (no paid/
unpaid state to distinguish RECEIPT vs INVOICE), status line reads
PENDING/APPROVED/DECLINED, total is "ESTIMATED TOTAL" not "TOTAL DUE",
and the footer states outright it's an estimate -- a client should
never mistake this for a bill.

Found along the way: `portal/` has its OWN service worker
(`portal/service-worker.js`, separate `CACHE_NAME` fingerprint scheme
from `tools/`'s) -- `npm run fix-versions` catches both, but worth
remembering when editing anything under `/portal/` that the tools-only
mental model of "bump the one CACHE_NAME" isn't complete.

## 2026-09-16 (still later) -- two more doc-drift finds, then job messaging

Continuing the same session. Before picking the next build, re-checked
two more "still pending" items in `docs/CLIENT-PORTAL.md` against
reality rather than trusting the doc: leaked-password protection
(item 4) and a standalone Terms page (item 5) were BOTH already done
-- `docs/ACTION-ITEMS.md` already recorded the first, and `/terms.html`
already existed in git history predating this session entirely. Third
stale-doc find this session. Pattern worth naming for whoever reads
this next: this project's specialist-log/changelog discipline is
strong, but a "still pending" list is exactly the kind of doc that
silently rots once the item it describes gets fixed somewhere else
(a different session, a different lane) without anyone circling back
to cross it off. Worth a deliberate sweep of ACTION-ITEMS.md/
CLIENT-PORTAL.md's open-items lists periodically, not just when
stumbled into while looking for the next thing to build.

Considered "change a client's portal email from inside the tools"
next -- decided against it, same reasoning as the MFA decision earlier
this session but for a different hazard. Email is the identity key
`docs/CLIENT-PORTAL.md`'s own "Client identity: one client, one email"
postpartum calls "the single highest-value fix... worth understanding
before touching any of these paths" -- every `client_portal_*` table,
`client_notification_preferences`, `stripe_customers`, AND the
internal `workspace_sync` blob's own separate copy of that email would
all need to move atomically, or the exact split-identity bug that
postmortem already fixed once would come back. Flagged for the user
rather than guessing at a migration strategy blind.

Built two-way messaging on a completed job instead -- additive, no
identity/money risk, and a real (if debatable-value) gap
`docs/CLIENT-PORTAL.md` named explicitly. Deliberately copied the
existing work-order-messaging pattern almost line for line (own table,
same RLS shape, same trigger-function-calls-edge-function wiring, same
internal reply UI shape in `tools/clients.html`) rather than
generalizing the two into one shared messages table with a
nullable/polymorphic parent -- two different parent tables sharing one
child table would need an "exactly one of these foreign keys is set"
constraint carried on every row forever, for a savings that's mostly
cosmetic (a few fewer files) against a real ongoing tax (every future
change to messaging touches a more complex, harder-to-reason-about
shape). Decided NOT to add a separate `notify_types` entry or
recipient list for this -- reused the existing `work_order`-tagged
`notification_recipients` list, since there's no UI today to configure
a second category and a client message needing a reply reads as the
same kind of alert regardless of which record it's attached to.

Applied the migration and deployed the edge function directly via the
Supabase MCP tools in this same session (both came back `ACTIVE`,
confirmed against the live project) -- worth remembering for a future
session that hits this file: unlike earlier this same day, Supabase
tool access was live and unblocked here, so this feature is actually
live end-to-end, not just committed code waiting on a manual deploy
step.

## 2026-09-17 -- features/content: #262 docs close-out never landed

Watcher research found PR #262 (job-messaging verify + close out
"Remember me / longer sessions") was CI-green then closed in a
main-only hygiene sweep after a README changelog conflict. The
verification itself is still true: portal `createClient()` already
uses SDK `persistSession` + `autoRefreshToken`. `docs/CLIENT-PORTAL.md`
still lists Remember me under "Smaller polish" as if open. Re-apply
that close-out (and the job-messaging wiring note) on a fresh
docs PR; do not rebuild the feature.

#263 (portal partial payments) stays closed until Connor is ready
for a schema migration + `stripe-webhook` deploy.

## 2026-09-19 -- features: Applicants panel on workspace.html + booking checkmark refresh

Two asks from the same request. **Applicants panel**: since `careers.html`'s
apply form (PR #304) landed, the only way to see a new application was
the notification email arriving correctly -- no fallback inside the
tools app. Added a "New Applicants" section to the Action Items /
"Needs response" lane, mirroring the existing Leads Inbox exactly:
`fetchJobApplications()`/`markJobApplicationHandled()`/
`deleteJobApplication()` in `tools/sync.js` (same fetch/PATCH/DELETE
shape as the `th_leads` trio), `startApplicantsRealtime()` (same
retry/backoff shape as `startLeadsRealtime()`), rendered as
`.lead-card`s with a handled toggle and an undoable delete, counted
into the existing `actionItemCounts`/badge/app-icon-badge machinery
rather than a parallel one. `th_job_applications` had to be explicitly
added to the `supabase_realtime` publication
(`sql/infra/add_job_applications_to_realtime.sql`, applied live) --
same gap `th_leads` itself once had (see
`add_workspace_sync_and_leads_to_realtime.sql`, 2026-08-15) --
otherwise the new realtime channel would silently never fire. Verified
end-to-end: inserted a real test row, confirmed the RLS SELECT policy
(`exists (select 1 from account_roles where email = auth.email())`)
matches what the fetch functions rely on, deleted the test row.

**Booking checkmark**: requested directly ("a little animation with a
green check mark that pops up and says 'You're Booked!'"). Replaced
`booking.html`'s on-page confirmation badge (previously a solid orange
hexagon with a flat unicode `&#10003;` glyph) with a green circular
badge (`--success-text`, the token already used for form-status
success messages elsewhere -- not a new color) containing an SVG
checkmark that draws itself in via `stroke-dashoffset` after the circle
pops in. Reduced-motion is already covered by the page's existing
blanket `*{animation-duration:0.001ms}` override. Added the same green
badge to the `send-booking-email` guest confirmation email -- plain
HTML/CSS (a `border-radius:50%` table cell), not SVG or a GIF, since
neither has reliable support across email clients (this degrades to a
green square in classic Outlook desktop, an acceptable, common
fallback).

Also this session: drafted (not posted -- no social/Indeed connector
available) ready-to-paste hiring copy for Facebook/Instagram/Nextdoor/
Indeed, and ran a static SEO/content audit of the 16 city/service/
appliance landing pages (no live GA4/Search Console access from this
sandbox) -- main finding: 9 of 16 pages share an identical closing
sentence in their meta descriptions, a real duplicate-content risk
worth fixing in a future content pass; logged for `tripleh-content` to
pick up rather than fixed here.

Verified: full suite **2533/2533** passing (2 pre-existing tests in
`realtime-error-noise.test.js`/`workspace-ops-inbox.test.js` hardcoded
"5 channels" and the old `lane-respond` sum -- updated both to include
the new 6th channel/count rather than leaving them silently wrong).
`check-consistency`/`check-undefined-vars`/`check-links.py` all clean.

## 2026-09-20: App-tour coverage gaps (pos.html, clients.html)

Prompted by a direct strategic question: "make the tools like an actual
app... what about when we hire someone how will they learn?" Before
building anything new, checked what already exists for both halves of
that question, since this suite has a habit of already having built
things a fresh look assumes are missing:

- **Page-to-page transition flash**: already solved. `styles-tools.css`
  declares `@view-transition { navigation: auto; }` (added 2026-08-26,
  "make it feel like an app"), which gives every tool-page navigation a
  real cross-fade instead of a hard reload flash, no JS required.
  Re-verified live with a real Playwright cross-document navigation
  (two throwaway pages, `window.__vtEngaged` set from the `pagereveal`
  event's `event.viewTransition`) rather than trusting the CSS alone --
  confirmed the browser genuinely engages a transition on navigation.
- **"How will they learn"**: already solved too. `tools-tour.js` is a
  16-step (was 14) walkthrough spanning every real tool page, keyed
  per-account so it doesn't nag a returning user, replayable anytime
  from Settings.

The concrete, real gap: two tool pages built *after* the tour existed
were never wired into it.
- `pos.html` never loaded `tools-tour.js` at all -- not a deliberate
  exclusion like `dev-tools.html`/`site-content.html` (password-gated
  dev tools), just a page that shipped later and got missed. Added the
  script tag (`defer`, matching its neighbors) and an `initAppTour()`
  call gated on `DOMContentLoaded`, since a `defer`-loaded script always
  runs after this page's own non-deferred inline script -- calling it
  directly at the top level would throw "initAppTour is not defined."
  Every other tour page can just call `initAppTour();` bare because they
  already wrap their init logic in a `DOMContentLoaded` listener of
  their own; `pos.html` normally doesn't, so it got its own listener
  just for this.
- `clients.html` loaded `tools-tour.js` already but had no step of its
  own -- present in the tour's script tags but absent from
  `APP_TOUR_STEPS`, so it silently did nothing. Added `initAppTour();`
  to its existing `DOMContentLoaded` handler.

Added two new steps to `APP_TOUR_STEPS` (`tools-tour.js`), placed right
after Invoices since POS and Clients are the same money/admin
neighborhood on the dashboard: a POS step (`#posClientEmail`, "charging
someone on the spot belongs here, not in Invoices") and a Clients step
(`#portalAccountSearch`, the portal-admin console -- invite/search
client portal accounts, invoices, work requests, referral credits).

Updated the tour's own test coverage (`finance-split.test.js`) for the
new 16-step/13-page total: the expected-pages list, the "14 selectors"
count, the settings.html last-step index (13 -> 15), and the
self-correction test's expected calendar.html index (7 -> 9) now that
two steps sit ahead of it.

Verified: full suite **2556/2556** passing. `check-undefined-vars`
clean. `check-consistency` initially flagged 14 stale cache-bust
references (every page loading the now-changed `tools-tour.js`) plus
the service worker's `CACHE_NAME` fingerprint -- fixed via
`npm run fix-versions`, then re-ran clean. `check-links.py` clean.

## 2026-09-20: Unique account codes for the referral promo

Direct request: "Can we build unique IDs connected to accounts? This
will help with things like the promo we are running." Clarified
scope over a few rounds before building anything, since the answer
changes the schema:
- Population: every client, not just portal accounts (most customers
  don't have portal logins).
- Redemption: a real shareable `?ref=CODE` link, not a code to read
  off and retype.
- Connection to a future portal login: the user asked directly
  whether a code generated before someone has a portal account would
  still connect once they get one. Answer, and the design decision it
  drove: key the whole thing by **email**, since a portal account is
  *also* identified by email (Supabase Auth) -- so `auth.email()` on
  first login is literally the same string a pre-existing code is
  already keyed to. No client_id, no re-linking step.
- Generation timing: the user asked for the code to be created "when
  they have an account created" and explicitly asked for it to double
  as a general account ID for tracking, not just a referral code --
  same value, two uses.

Built: `client_account_codes` table (`sql/infra/create_client_account_codes.sql`),
`send-invite` generates a code automatically on a genuine first
invite only (`!isResend` -- a resend doesn't create a new account),
a new public `resolve-referral-code` edge function (returns only a
display name, service-role lookup, no anon policy on the table at
all), booking.html + index.html resolve `?ref=` as a code first with
a fallback to the old literal-name behavior for any link already
distributed, a manual "Get referral link" action in
`tools/client-detail.html` for staff to generate one for a
non-portal client, and a read-only "Refer a Friend" panel in
`portal/settings.html` once an account exists (RLS: a client can
SELECT only their own row).

One real limitation surfaced directly to the user rather than
discovered later: a code generated for a phone-only customer with no
email on file can't auto-connect to a future portal account, since
email is the only identity string both sides share -- flagged in
client-detail.html's own UI (disabled with an explanation) rather
than failing silently.

Caught by `check-consistency.js` before shipping: the first draft of
client-detail.html's "Get referral link" button interpolated
`JSON.stringify(client.email)`/`JSON.stringify(client.name)` directly
into an inline `onclick="..."` attribute -- JSON.stringify escapes
for a JS string literal, not for the surrounding HTML attribute
context, so a client name/email containing a `"` would have broken
out of the attribute. Fixed with `escapeForInlineHandler()`
(tools-dialogs.js), this suite's own established helper for exactly
this shape.

Verified live in Supabase: applied the migration, deployed both edge
functions, inserted/queried/deleted a real test row confirming the
exact query `resolve-referral-code` runs resolves correctly. Could
NOT curl the deployed function itself end-to-end -- outbound access
to `supabase.co` is blocked by this session's agent proxy -- so the
live HTTP path is unverified from this session; said so plainly
rather than claiming a verification that didn't happen.

Verified: full suite **2572/2572** passing (16 new tests in
`tests/referrals/account-codes.test.js`). `check-undefined-vars`/
`check-consistency` (after `fix-versions` for the two service worker
`CACHE_NAME`s)/`check-links.py` all clean.

## 2026-09-21 -- Refined the referral/account-code system: auto-generate on login, redemption/usage data, easier sharing

Direct request ("how can we refine our code system?" -> "lets build
all 3"), following up on the client_account_codes system shipped
2026-09-20. Three real gaps closed:

1. **Auto-generate a code for accounts created BEFORE the feature
   shipped.** Previously a portal account invited before 2026-09-20
   only ever saw a "call us" message in Settings with no self-serve
   way to get a code -- `loadReferralLink()` was a bare read-only
   select against `client_account_codes`, so a missing row was a dead
   end. New edge function `ensure-my-referral-code` (service role,
   email read only from the caller's own verified JWT so it can never
   touch anyone else's account) creates the row on the spot if
   missing, reusing the exact same alphabet/retry-on-collision logic
   as `send-invite`'s `ensureAccountCode()` and the same
   client_profiles/invoices display-name fallback `portal/settings.html`
   already used elsewhere.
2. **Redemption/usage data.** Codes were captured on `th_leads`/
   `th_bookings` since 2026-09-20 but nothing ever surfaced how many
   times a code had actually been used -- a client (or staff) had no
   way to tell if their link was doing anything. `ensure-my-referral-code`
   now also returns a live `usage_count` (leads + bookings matching
   `referred_by_code`), shown in the portal's own settings panel.
   Staff-side, `tools/client-detail.html`'s `loadReferralLink()`/
   `renderReferralLinkBlock()` compute the same count directly (staff
   already has read access to both tables via RLS, no edge function
   needed there).
3. **Easier sharing.** Both surfaces previously showed only the raw
   link to copy. Added an `sms:?body=...` "Text to a Friend" link in
   the portal (generic, no known recipient), and an
   `sms:<phone>?body=...` "Text to [client name]" link in
   client-detail.html, using the client's own phone number already in
   the bundle -- rendered only when a phone is on file.

Fixed in review before shipping: `createReferralLink()` (fires the
first time a staff member generates a code for a client with none
yet) and its own collision-retry path both originally rebuilt a
stripped `{ email, name }` object to re-render/reload from, dropping
`.phone` -- the new SMS button would never appear right after a fresh
code was created, only on the next page load. Threaded `phone`
through both call sites so it renders immediately either way.

Verified via live SQL simulation (network to `supabase.co` is still
blocked from this session's agent proxy, so the deployed function's
actual HTTP path can't be curled end-to-end): inserted a real
`client_account_codes` row plus one `th_leads` and one `th_bookings`
row sharing a code, confirmed the count query the function runs
correctly sums to the expected total, then deleted all test rows.
Said so plainly rather than claiming a live-HTTP verification that
didn't happen.

Verified: full suite **2586/2586** passing (7 new tests in
`tests/referrals/account-codes.test.js`, replacing 2 stale assertions
tied to the old read-only `portal/settings.html` implementation).
`check-undefined-vars`/`check-consistency` (after `fix-versions` for
both service workers' `CACHE_NAME`)/`check-links.py` all clean.

## 2026-09-21 -- Moved the 8 service landing pages into /services/, with redirect stubs

Direct request, after weighing the tradeoff explicitly first: the 5
service pages (`washer-dryer-repair.html`, `plumbing-repairs.html`,
`drywall-painting.html`, `handyman-repairs.html`,
`assembly-installation.html`) and 3 service×city pages
(`washer-dryer-repair-st-george-ut.html`,
`refrigerator-repair-st-george-ut.html`,
`dishwasher-repair-st-george-ut.html`) moved from the repo root into
`/services/`. Recommended against this at first (GitHub Pages has no
server-side redirect capability, and these are live, indexed, linked
pages), but this specific family was judged worth it: it's actively
growing (3 new pages in one week alone), unlike the rest of the
public site which stays flat.

To soften the cost: left a thin redirect stub behind at each of the 8
old root paths -- `<link rel="canonical">` + 0-delay
`<meta http-equiv="refresh">` + a JS `location.replace()` fallback,
same pattern this repo already used for retired `/tools/` pages
(`tools/contact-card.html` etc.), except deliberately NOT `noindex`
here -- these need to read as "moved," not "gone," to a crawler, so
Google consolidates ranking signal onto the new URL instead of
dropping it.

Updated every internal reference site-wide (56 files: every public
page's nav dropdown, sitemap.xml, the 8 pages' own canonical/og:url/
JSON-LD self-references and cross-links to each other, `README.md`,
`docs/service-city-landing-pages.md`, `scripts/check-links.py`'s
PUBLIC_PAGES list, and ~25 test files -- both URL-path assertions
`href="/foo.html"` and Node fs-path lookups `repo('foo.html')`,
handled as two separate sed passes since they need different
replacement forms (`/services/foo.html` vs `services/foo.html`, no
leading slash). One stale hardcoded regex literal in
`tests/seo/service-city-landing-page.test.js` (checking for the OLD
`/washer-dryer-repair.html` cross-link inside the service×city pages)
slipped past both sed passes since regex literals aren't quote-
delimited the same way -- caught by the full suite, fixed.

Historical changelog entries (`docs/specialist-logs/*.md`,
`docs/ACTION-ITEMS.md`, comments) deliberately left referencing the
old root paths -- they're accurate descriptions of where these files
lived *at the time* those entries were written, not live references.

Verified: full suite **2586/2586** passing. `check-undefined-vars`/
`check-consistency`/`lint`/`check-links.py` (80 HTML files, internal
references all resolve; the new `/services/` public URLs correctly
picked up by the external-link pass via the updated PUBLIC_PAGES
list) all clean.

Left for the user: nothing required, but Google Search Console ->
Sitemaps -> resubmit `sitemap.xml` will speed up Google noticing the
new canonical URLs rather than waiting for its own re-crawl schedule.

## 2026-09-21 -- Moved the 8 city landing pages into /locations/ too, same treatment

Direct follow-up, same session: after the services move above, moved
the 8 city landing pages (`handyman-st-george-ut.html`,
`handyman-hurricane-ut.html`, `handyman-washington-city-ut.html`,
`handyman-santa-clara-ivins-ut.html`, `handyman-la-verkin-ut.html`,
`handyman-leeds-ut.html`, `handyman-cedar-city-ut.html`,
`handyman-mesquite-nv.html`) from the root into `/locations/`, for the
same reason: this family also keeps growing (5 -> 7 pages over the
same stretch the service pages grew). Same redirect-stub treatment
(canonical + meta refresh + JS fallback, not noindex), same
site-wide reference update (72 files this time: nav dropdowns,
sitemap.xml, cross-links between city pages and into service pages,
README, check-links.py's PUBLIC_PAGES, ~25 test files).

Same one stale hardcoded regex literal pattern recurred in
`tests/seo/service-city-landing-page.test.js` (this time checking for
the OLD `/handyman-{city}-ut.html` cross-links from the service×city
pages) -- same fix, update the regex to the new `/locations/` path.
Worth remembering for next time: the mechanical sed passes only ever
catch quote-delimited string literals, never regex literals, so any
future page move needs an explicit search for
`\/{filename}\.html` (backslash-escaped) after the sed passes, not
just a clean `npm test` run to confirm nothing was missed.

**Mid-move incident, unrelated to this change but handled in the same
session:** a separate Cursor-driven branch (`cursor/tools-refresh-39fb`)
got stuck -- its own remote-tree-consistency check correctly detected
that a `push_files` call had silently written the literal string
`TOO_LARGE_SKIP` into `tools/parts-reference.html` (2950 real lines,
~244KB) instead of the actual content, apparently hitting some size
limit in Cursor's own push mechanism without erroring. Confirmed this
never touched `main` -- fully contained to Cursor's own unmerged
branch. Fixed by restoring the file from `main` and merging a small
PR directly into `cursor/tools-refresh-39fb` (not `main`) to unblock
Cursor's own next batch, since a direct push to a `cursor/`-prefixed
branch name is blocked by what's presumably a branch-protection rule
reserving that namespace.

Verified: full suite **2586/2586** passing. `check-undefined-vars`/
`check-consistency`/`lint`/`check-links.py` (88 HTML files) all clean.

Left for the user: same as above -- resubmit `sitemap.xml` once, now
covers both moves in one Search Console action.

## 2026-09-21 -- Workspace tools "more app-like" pass: lazy-loading fix, sidebar icon fix, global command palette, persistent app shell

Direct request ("what else can we do to the tools to make it
easier to use/more app-like?" -> "do them all"). Proposed 5 items
first; investigation found 3 were already fully built (PWA
manifest/service-worker, the `showToast()` toast system in
`tools-media-sharing.js`, skeleton loading states on multiple tool
pages) -- worth remembering for next time a session proposes tools
UX work here: check what's actually built before scoping, this
session nearly duplicated existing infrastructure.

**Lazy-loading dashboard drawers** (real gap, PR #321 open at the
time): Cursor's own PR described the feature and shipped a full test
file for it, but the actual `workspace.html` implementation was never
written -- only a cache-bust bump landed, silently failing 4 tests.
Found a second, unmerged Cursor branch (`cursor/tools-refresh-finish-39fb`)
that DID have the real implementation, but that branch predated this
session's earlier `/services/`/`/locations/` folder move and its
other 100+ file diff was almost entirely a revert of that work --
cherry-picked only the real `tools/workspace.html` + `styles-tools.css`
diff via `git diff main finish-branch -- <2 files> | git apply`,
not a wholesale merge. Landed via PR #324 into the cursor branch,
then PR #321 merged clean.

**Runway Dashboard's sidebar icons were invisible** (reported with a
screenshot, "only happens when I am on Runway Dashboard"). Root
cause: that page deliberately keeps its own copy of the shared
sidebar/icon CSS (documented in its own comments -- "doesn't load
styles-tools.css") instead of linking the shared file, and that copy
was missing the base `.th-icon { fill: none; stroke: currentColor;
... }` rule every other tool page gets for free. Icons built from
stroke-drawn `<path>`/`<line>` elements (no explicit inline fill)
defaulted to SVG's `fill: black`, rendering as solid near-black
shapes invisible against the hex background; icons with an explicit
inline fill (the `$` glyphs, the filled star) were unaffected --
explains why it read as "scattered random breakage" rather than
"every icon blank." Confirmed with a real Playwright render (a local
HTTP server, not `file://`, since absolute `/tools/...` script paths
don't resolve under `file://` and silently no-op the whole nav
injection -- cost real time rediscovering this) before AND after the
fix, not just inferred from the screenshot. PR #325.

**Global command palette** (`tools/tools-command-palette.js`,
Cmd/Ctrl+K). Reused `workspace.html`'s existing "Find a client"
search logic and data (jobs/contacts/invoices/quotes/contracts,
same localStorage keys) rather than inventing a new search. Real bug
caught before shipping, not after: the floating trigger button
(mirroring `.th-flag-btn`'s position, bottom-left) sits directly
under the fixed desktop sidebar and is completely unclickable there
-- found via a real click-and-measure Playwright test, not just a
visual screenshot, which wouldn't have caught it. Fixed by hiding the
floating button at the sidebar's own `min-width:1024px` breakpoint
and adding a real "Search ⌘K" row inside the sidebar itself. A
repowise-bot finding (large method + a mini-DRY violation from 5
near-identical filter/map/push blocks in `renderResults()`) was
verified as real and fixed -- refactored into a `SEARCH_SOURCES`
config table + small helpers, same output confirmed via the same
Playwright screenshot before/after. PR #326.

**Persistent app shell via cross-document view transitions.**
Considered a true SPA content-swap first (intercept nav clicks, fetch
+ swap `<main>`, re-execute scripts) and rejected it after weighing
the risk explicitly: all 19 real tool pages assume full-page unload
for cleanup (Supabase realtime channels in `sync.js`, timers, global
state in heavy per-page inline scripts) with zero existing teardown
logic or test coverage for a swap-in-place interaction pattern --
building and verifying that for live invoicing/job-tracking tooling
was judged too high-risk for what's ultimately a visual-polish goal.
Found real precedent already in this exact repo: `portal/*.html` had
already solved the identical "flash between pages" complaint with
`@view-transition { navigation: auto; }` (portal's own
`tests/portal/view-transitions.test.js`) -- mirrored that pattern for
`tools/`, and went one step further by giving the sidebar/bottom-nav
a shared `view-transition-name` (safe because `tools-nav-pwa.js`
injects byte-identical markup for both on every page) so the shell
itself visually persists instead of crossfading, which portal's
plainer per-page opt-in doesn't do. Pure progressive enhancement --
unsupported browsers see zero change from today's behavior, and since
each page still does a real navigation, back/forward, deep-linking,
and every page's own `DOMContentLoaded` init are unaffected by
construction, not by any code written to preserve them.

One real regression caught by the existing suite, not overlooked:
initially wrote the `view-transition-name` rules by extending the
existing `@media (min-width: 1024px) { .th-desktop-sidebar { display:
flex... } }` block in place -- broke 3 pre-existing tests
(`tests/design/desktop-sidebar.test.js`,
`tests/design/desktop-layout.test.js`) that assert on that exact
single-line rule text. Fixed by keeping the original rule's text
byte-for-byte untouched and adding the view-transition-name as a
wholly separate `@media` block instead of editing existing,
asserted-on CSS in place -- worth remembering generally: this repo's
tests frequently assert on exact CSS rule formatting, not just
presence, so touching an existing rule's text (even just adding a
line inside its braces) is riskier than it looks.

New tests: `tests/tools/app-shell-view-transitions.test.js` (mirrors
`tests/portal/view-transitions.test.js`'s pattern, including its
"opt-in stays page-specific, not the shared stylesheet" assertion).

Verified across all four changes: full suite **2597/2597** passing,
`check-consistency`/`check-undefined-vars`/`lint`/`check-links.py`
all clean. Each change also confirmed with a real headless-Chromium
render (Playwright, served over local HTTP not `file://`) rather than
relying on static test assertions alone -- this is what actually
caught the sidebar-collision bug and the `file://` script-path
gotcha above, neither of which a text-only test would have surfaced.

Left for the user: nothing required. Cross-document view transitions
are Chromium/Safari 18.2+ only as of this writing (Firefox not yet) --
worth knowing if anyone asks why the effect isn't visible in every
browser, though it degrades to exactly today's behavior, never worse.

## 2026-09-21: FAQ category grouping (external Cursor audit item #8)

Picked up item #8 from a security/quality punch list a user pasted from
a Cursor session, since the rest of that list was either already handled
(the two security findings, done separately this session) or needed the
user directly (MFA, content/growth items). This one was a real, live bug
with a bounded, safely-verifiable fix.

**The gap**: index.html's FAQ accordion has 4 categorized groups baked
into its static fallback markup (`<h3 class="faq-category">` headers --
Pricing & Payment / Scheduling & Availability / Service Area & Coverage
/ Policies), but the moment the live `site_faq` Supabase fetch resolves
(which is almost always, in production) that whole block got replaced
with one flat list -- the categories only ever existed in the brief
pre-fetch flash. `site_faq` itself had no category column at all.

**Fix**: added `category text not null default 'General'` to
`site_faq` and backfilled all 15 live rows by matching each question
against the category it already sits under in the static markup
(confirmed row-for-row via `execute_sql`, not guessed or assumed from
the repo's original seed file -- which only had 12 of the live table's
15 rows, since 3 more had been added directly through the CMS since
that seed script was written and never round-tripped back into the
repo). Rewrote index.html's fetch handler to group by category, ordered
by each category's first appearance in `sort_order` -- deliberately no
new ordering column, since the existing sort_order already encodes the
right order for free. Added a Category field to `tools/site-content.html`'s
FAQ editor (same pattern as the existing Question/Answer fields) so
future edits stay categorized through the CMS, not just this one-time
backfill.

Live migration + backfill applied directly via the Supabase MCP tool,
mirrored to `sql/site-content/site_faq_add_category.sql` per this
repo's convention.

Extended `tests/seo/faq-schema-sync.test.js` (previously only checked
that the JSON-LD schema stays in sync with the flat rows) with 2 new
tests: rows group correctly by category with one heading per group in
first-appearance order, and a row with no category falls back to a
single "General" group instead of throwing. Updated one existing test's
regex, which had asserted on the literal old flat-render code shape
(`faqList.innerHTML = rows.map`) -- that's a real behavior change, not
a false positive, so the assertion needed updating along with the code,
not loosening.

Caught my own mistake before shipping: my first version of the new
grouping test asserted the wrong DOM order (interleaved by original row
order) -- actually ran it against a real JSDOM render rather than
reasoning it through, saw the correct grouped order (`H3, DIV, DIV, H3,
DIV` -- all of a category's items together under its one heading, not
interleaved), and fixed the test's expectation to match the correct
behavior rather than the code.

Verified: full suite **2599/2599**, `check-consistency` (after
`fix-versions` bumped the service-worker cache, since index.html is a
precached file), `check-undefined-vars`, `lint`, `check-links.py` --
all clean.

## 2026-09-21: Portal "flashes blank on first sign-in check" (external audit item #13)

Same punch list as the FAQ item above. Real, verifiable, bounded --
`dashboard.html`/`quotes.html`/`home.html` already bake a static
`skeleton-card` shape directly into their list container's initial
HTML (so there's something to see before any JS even runs), but
`jobs.html` (`#jobList`), `work-orders.html` (`#myRequests`), and
`contracts.html` (`#contractList`) did not -- their JS-side
`portalSkeletonCards()` call only ever ran AFTER
`await client.auth.getSession()` resolved, so on first paint (and for
however long that async auth check takes) those 3 pages' list areas
were genuinely empty markup. Confirmed by grepping every portal page
for `skeleton-card` in its static body versus its script block, not
assumed from the bug description alone.

Fixed by baking the exact same static skeleton markup the JS would
render into each page's initial HTML -- `work-orders.html` matches its
JS's shown text exactly (`<div class="wo-section-title">Your
requests</div>` + 3 cards), so there's no visible layout shift or
duplicate heading once the JS replaces it with the same content.
Checked `settings.html` too (also flagged as a candidate) and found it
already has skeletons on every one of its dynamic sub-panels
(`referralLinkBody`, `savedCardsBody`, `authorizationsBody`) -- no real
gap there, left untouched.

Extended `tests/portal/skeleton-loading.test.js` with a test asserting
the static HTML (not just the JS source anywhere in the file, which
the existing test already checked) contains the skeleton markup for
all 6 list pages, so a future page added without this can't silently
regress.

Verified: full suite **2600/2600**, `check-consistency` (service-worker
cache bumped again), `check-undefined-vars`, `lint`, `check-links.py`
-- all clean.

## 2026-09-21 -- Workspace IA pass: Today-first dashboard, Calendar folded into Job Tracker

One-shot request with explicit permission to restructure, and an
explicit instruction to pick 1-2 high-leverage changes and finish
them rather than sweep six. Diagnosis first, by reading
`tools-nav-pwa.js` and the pages rather than guessing: 19 real pages,
14 sidebar destinations, and a dashboard carrying FIVE navigation
layers at once (bottom bar/sidebar, a 7-chip jump row that just
anchored to the headings directly below it, the daily strip, a
13-tile Tools grid hidden under "More tools", and a "Today's schedule"
chip that scrolled to the hero right above it), plus seven collapsed
drawers. On a 390px phone the 170px greeting card pushed Next Job's
Money Owed card -- and its Mark paid button -- below the first screen,
and the ops inbox was collapsed behind a count badge, so "what needs a
response" was a chip tap + a heading tap + a scroll. Calendar was one
of five bottom-bar slots and a whole page over the same
`th_tracker_jobs` data as Job Tracker.

**Chose (1) rebuild the dashboard Today-first and (2) fold Calendar
into Job Tracker as a view.** Considered and declined for this pass:
merging POS into Invoices (same permission, plausible tab, but it
means adding `js.stripe.com` to the invoice page's CSP and loading
Stripe on every invoice open -- a separate decision), merging Route
Planner anywhere (the real click win was a one-tap "Route today" on
the dashboard, which needs no merge), moving Snapshot/Analytics code
onto finance.html (`computeMoneyOwed()` is shared with the hero and
tests assert on that; ARCHITECTURE-NOTES' "pieces are never as
separable as they look" applies), and a true SPA (rejected last
session for good reasons that still hold).

**Dashboard.** Greeting compacted to one band (same ids and the CSS
rules `workspace-greeting-banner.test.js` asserts; only the padding /
font sizes changed, so that whole test file still passes untouched).
Hero: `buildTodayRouteUrl()` builds the same `maps/dir/?api=1`
destination+waypoints URL as route-planner.html's `buildRouteUrl()`,
from `getTodaysJobs()` in hero priority order, de-duplicated
case-insensitively, capped at 10; the card shows "Route today · N
stops" (or "Directions" for one) and keeps "View in Job Tracker" only
when no address exists. `renderTodayMoney()` lists every unpaid
invoice sorted overdue-first-then-by-due-date, with a due label
computed from `getDueDate()`; kept the `todayOverdueList` id and the
`isOverdue(i)`/`invoiceMarkPaidButtonHtml(i)` tokens the quick-actions
test asserts. `DEFAULT_COLLAPSE.actionitems` flipped to `false` --
stored per-device state still wins, so anyone who deliberately
collapsed it keeps it collapsed. Respond-lane groups got `.ops-group`
wrappers; `refreshOpsGroupVisibility()` (called from
`updateActionItemsBadge()`, so it runs after every count update) hides
a group whose list holds only a plain `.empty-state-small` and never a
`.is-warning` one -- a "couldn't load leads" row is information, not
emptiness. Income lane: `renderInvoicesList()` splits open vs settled
and folds settled under a `<details>` unless a search term is present;
the `actionItemCounts.unpaid`-before-`dashSectionClosed` ordering the
lazy-sections test asserts is preserved. Chip row, tile grid,
`CARD_INFO['tool-*']`, `renderDevToolsTileVisibility`, and the chip
count mirrors removed; `updateGalleryChip()` kept its name but writes
to a new `galleryHeadingBadge` so the two call sites needed no change.
Backup & Restore moved to settings.html verbatim (`ALL_SYNCED_KEYS`
list unchanged, so backup files stay byte-identical);
`workspace.html#backup` now `location.replace`s to
`settings.html#backup`. The heading badge renders both a breakdown
span and a total span; CSS shows the total under 720px because the
breakdown sentence was wrapping the heading onto two lines on a phone
(it did before this change too, as "Action Items").

**Calendar merge.** Job Tracker's `th_tracker_view` now accepts
list | board | calendar via `setJobViewMode()`; the old two-state
`toggleJobViewMode()`/`#jobViewToggleBtn` became a three-button
`#jobViewSwitch`. Calendar markup/CSS/JS moved in with class names
verbatim; `renderCalendarView(allJobs)` is called from `renderJobs()`
with the same search-filtered, pending-delete-filtered set the board
gets, so list and calendar can never disagree on one page. Decision:
the merged view reads `loadJobs()` (local), NOT the relational `jobs`
table calendar.html piloted -- two sources on one page would show a
job in the list but not the calendar for the seconds between a local
write and its mirror. `fetchJobsFromRelational()` is untouched in
sync.js and Route Planner still uses it; `CONTINUE-HERE.md`'s Phase 2
notes and `tests/sync/relational-jobs-read-phase2.test.js` updated to
say so. The per-job "Show on Calendar" checkbox / card toggle /
`toggleShowOnCalendar()` are retired: the calendar shows every dated
job. The flag stays in the data (sync.js mirrors `show_on_calendar`,
the SQL column has a default), new jobs write `showOnCalendar: true`,
edits leave the existing value alone -- restoring the filter is a
one-line change if it is ever missed. Bookings still merge in as
purple pseudo-jobs via `refreshBookingsCache()` + `startBookingsRealtime`.
Month swipe rides inside the existing tab-swipe handler, scoped by
whether the touch started on `#calGrid`. `#calendar` hash selects the
view and today's date. Stub, EXEMPT entry in check-consistency,
manifest shortcut, tour step (folded into the Jobs step) all updated.

**Nav.** Bottom bar Home / Jobs / Clients / Invoices / Finance -- two
of five slots were both "jobs"; Clients (client history, portal
accounts, referral credits) is a daily lookup that was in More. Sidebar
loses Calendar (13). `MORE_DESTS` is derived, so Clients left the
sheet automatically. runway-dashboard.html needed no CSS mirror: the
nav classes are unchanged and it never had the tile-grid rules that
were deleted from styles-tools.css.

**Gotchas worth keeping:**
- Many tests here assert exact CSS text and exact markup order;
  reordering sections meant re-anchoring a dozen tests. Slicing blocks
  by id markers in a script and asserting each id occurs exactly once
  afterward caught a duplicated-section bug in my own reorder before it
  ever hit the file.
- `tests/workspace/finance-split.test.js` RUNS `--fix-versions` and
  deliberately breaks/restores hashes as part of the suite. Running any
  "checker passes cleanly" test (or `check-consistency.js` itself)
  concurrently with the full suite gives false failures. Run the suite
  alone, run `npm run fix-versions` before it, and do not edit
  precached files while it runs.
- Headless Playwright with all network aborted made the dashboard look
  broken (blank hero, half the bottom bar hidden): the role fetch
  retries 3x and pullSync 2x before `renderDashboard()` runs, and a
  missing role hides the gated nav links. The harness needs a fake
  Supabase (role row, empty tables, 500 on the relational `jobs` /
  `invoices` reads so pages fall back to local data) to be realistic;
  kept in this session's scratchpad, worth recreating for any tools UI
  work.
- The hidden `[role="dialog"]` More sheet exists on every page -- a
  Playwright `[role=dialog]` selector matches it, not the confirm
  dialog (`#customDialogOverlay .dialog-btn-primary`).
- This file has three copies of its append marker (lines 137, 186 and
  the real one at the end); append above the LAST one.

Verified: suite 2615/2615, check-consistency, check-undefined-vars,
lint, check-links.py, check-visual-snapshot all clean; real-browser
pass at 390x844 and 1440x900 covering the first screen, two-tap Mark
paid, Route today URL, New job landing focused, Calendar deep link and
stub redirect, More sheet contents, Settings backup, and six other
pages loading with the same nav and zero console errors.

Left for later (not blockers): POS-into-Invoices as above; the
721-1023px band with neither bottom bar nor sidebar (pre-existing,
breakpoint asserted by tests); `login.html`'s `ALLOWED_RETURN_PATHS`
still lists `calendar.html`, harmless since the stub redirects.

## 2026-09-21 -- Workspace IA round 2: POS into Invoices, tablet nav band, header arrow

Owner's follow-up to the IA pass above: "do the pos merge and whatever
else you think is good, we want maximum efficiency." The two items that
pass left "for later" -- POS-into-Invoices and the 721-1023px band with
neither nav -- were exactly the highest-leverage remaining fixes, plus
one piece of chrome that the nav shell had made redundant.

**POS -> Quick charge tab.** Harvested `pos.html`'s CSS, `.pos-card`
markup, and script *programmatically* from the file (not retyped) and
inserted them into `invoice-generator.html` as `#tab-pos`, so every
existing POS test regex (`\n  \}\n` function boundaries, the email
listener, `.pos-success-amount` 30px, the `succeeded -> showSuccess`
branch) still matches the same text once the tests read the new file.
Tab order Invoice | Quote / Estimate | Quick charge | Recent Invoices
(`GEN_TAB_ORDER` drives the swipe). `activateGenTab` toggles the new
panel; `#pos` in the URL activates it on load and focuses the email
field. The one genuine cost flagged last time -- Stripe.js on every
invoice open -- is avoided with `ensureStripeJs()`: the `js.stripe.com/
v3/` tag is injected only inside `startNewCardCharge()`, started in
parallel with the `create-pos-charge` call and awaited right before
`mountCardEntry()`, with a no-op `.catch` on the promise so a rejection
during the server round-trip is not an unhandled-rejection console
error; a failed load removes the tag and clears the cached promise so
the next tap retries, and the error surfaces through the existing
`showError` path ("the card form (Stripe.js) did not load"). CSP gained
`https://js.stripe.com` (script-src, frame-src -- it was `frame-src
'none'`) and `https://api.stripe.com` (connect-src). No identifier
collisions between the POS script and the invoice page or any shared
script (checked by grep and by `check-undefined-vars`). The page-level
`roleBlockedOverlay` (`canManageInvoices`) now gates the charge form
too, which is stricter than pos.html was (its gate was only the nav
link). `pos.html` is a stub to `invoice-generator.html#pos` (EXEMPT in
check-consistency, kept in the service-worker precache so the old
bookmark resolves offline); POS removed from `SIDEBAR_DESTS` /
`NAV_PERMISSION_CHECKS` (so `MORE_DESTS` dropped it automatically) and
from the tour, whose Invoices step now mentions Quick charge; tour goes
15 -> 14 steps and the route-planner self-correction index 9 -> 8.

**Tablet band.** Shared CSS: `.th-bottom-nav { display:flex }` and its
`view-transition-name` scope moved from `max-width:720px` to `1023px`;
`.th-more-sheet` hides from `min-width:1024px` (was 721); the
`body.th-has-bottomnav` padding-bottom left the phone-only 720px block
for its own `@media (max-width:1023px)` rule (equal specificity to the
base `body.th-tool-page` padding, so it must stay later in the file --
it does). New `(min-width:721px) and (max-width:1023px)` block centres
the five items (`justify-content:center; gap:24px; max-width:96px`) and
caps the More sheet panel at 560px centred (`left:0; right:0` +
`max-width` + `margin:0 auto` centres an absolutely positioned box).
The `.th-flag-btn` / `.th-cmdk-btn` offsets were already keyed to
1024px, i.e. they assumed a bar that was not there in this band -- now
it is. Every rule mirrored into `runway-dashboard.html`. The four
tests pinning 720/721 re-anchored; `tests/design/tablet-nav-band.test.js`
parses the four breakpoints out of both files and asserts they are
complementary rather than pinning literals again.

**Header arrow.** `body.th-has-bottomnav .hub-header-right >
a.help-btn[href="/tools/workspace.html"] { display:none }` -- keyed on
href + class because three pages label it "Back to Dashboard" and eight
"Back to Workspace". `inject()` sets `th-has-bottomnav` and
`th-has-sidebar` together, unconditionally, so the class means "the nav
shell is here", and after the tablet fix the shell always carries Home.
Runway's text `.back-link` gets the same treatment in its own CSS.
`job-detail.html` (-> Job Tracker) and `site-content.html` (-> Dev
Tools) are real up-one-level links and are deliberately not matched.
Markup kept everywhere: `one-shell-header-and-layout-tokens.test.js`
and `text-audit.test.js` read it, and a shell-less load keeps its way
home. `login.html`'s `ALLOWED_RETURN_PATHS` never listed pos.html or
clients.html (pre-existing; harmless -- an unlisted return path just
lands on the dashboard).

**Gotchas worth keeping:**
- The POS tests' `assert.doesNotMatch(page, /client_portal_invoices|.../)`
  was only true because POS had its own page; on the shared page it
  has to be scoped to the Quick charge `<script>` block (marker comment
  `// ---------- Quick charge (POS) ----------`).
- An anchor of "end of the mobile @media block" (`transform: none; }\n}`)
  occurs twice in styles-tools.css; anchor on the pad rule being
  removed instead.
- Playwright: `page.route` beats the harness's `ctx.route` catch-all,
  so per-test mocks for `create-pos-charge` and a fake
  `https://js.stripe.com/v3/` (`window.Stripe` stub whose
  `confirmPayment` resolves `succeeded`) layer cleanly on top of it.

Verified: suite 2631/2631, check-consistency, check-undefined-vars,
lint, check-links.py, check-visual-snapshot all clean; real-browser
pass at 390x844 / 820x1180 / 1440x900 covering both Quick charge paths,
the blocked-Stripe.js error path, the `#pos` deep link and stub
redirect, tablet bar + centred More sheet on three pages (Runway
included), desktop sidebar-only, the hidden arrow at every width, and
Job Detail's real back arrow still visible.

Left for later (not blockers): the Runway Dashboard's "Business Health"
tabs and a search-first Appliance Wiki (both from the original candidate
list, both judged lower leverage than the three above); Stripe Elements'
iframe is Stripe-hosted, so `frame-src https://js.stripe.com` is the
minimum -- if the invoice page ever needs a stricter CSP, the Quick
charge tab is the reason it cannot be `frame-src 'none'`.

## 2026-09-22 -- Workspace IA round 3: the leftovers, in one pass

"Let's finish it in one big pass." The open list from rounds 1-2 was:
search-first Appliance Wiki, the Runway Dashboard's tabs, and login's
return-path allowlist.

**Wiki.** `.pr-search-filter-row` moved to the top of `#prListView`
(above the quick-access strip and the display-name row); the
`.pr-confidence-note` boilerplate went into the help modal. Focus on
load is gated: not when `?search=` pre-filled the box (the results are
what matters then) and not while `th_app_tour_step` is set (the tour
card owns focus and this page is a tour stop). `focus({preventScroll})`
so the sticky header does not scroll away on a phone.

**Runway.** Chose tab memory over splitting into pages: a split adds
destinations the day after two were removed, and ARCHITECTURE-NOTES
already records the page as deliberately self-contained. `switchToTab`
writes `th_runway_tab`; an IIFE at init picks hash > memory > personal
and calls `switchToTab`, which skips the fade when no panel is active
yet. The markup's default `is-active` button is untouched (a test
asserts it).

**Login.** `ALLOWED_RETURN_PATHS` gained `clients.html` and `pos.html`
(the stub still redirects, but the allowlist is about not silently
dropping a return path). Kept static and sorted, as before.

Verified: suite, check-consistency, check-undefined-vars, lint clean;
real browser at 390 and 1440: wiki search focused on open and not when
`?search=` is present, Runway reopening on the last tab and on
`#runway`.

## 2026-09-22 -- Workspace IA round 4: the tutorial, the launcher, tab deep links

Brief: "any last-minute improvements, as big as you want, make it super
easy to use, then update the tutorial to teach where everything is and
how to use it." Discovery first, with fresh eyes on the post-merge suite:
the tour was 14 one-per-page stops with copy from before the merges; the
command palette searched records but could not take you anywhere; only
three hashes worked as deep links (`#pos`, `#calendar`, `#add-job`) and
none survived a same-document hash change; Finance always opened on
Cost Lookup.

**Tour engine (`tools-tour.js`).** Two additive fields, format
otherwise unchanged so the `{ page: ..., highlightSelector: ... }`
regex in check-consistency and the tests still parses every step:
`onShow: { fn, args }` calls a page function by name before
highlighting (`activateTab('expenses')`, `activateGenTab('pos')`) -- no
eval, so no CSP change -- and a comma-separated `highlightSelector`
means "the first candidate actually rendered at this width"
(`pickVisibleTourTarget`: own computed display AND `getClientRects()`
non-empty, because a child of a display:none ancestor keeps its own
display; a bare test DOM lays nothing out, hence the second pass). A
"3 / 24" counter joins the dots. After highlighting, the engine
re-checks at 400/900/1800 ms and scrolls again if the target drifted
off screen -- settings.html's late-rendering sections pushed the Replay
button 700px down after the first scroll (found only by walking the
tour in Chromium; `html { scroll-behavior: smooth }` there makes every
scroll animated, so the check waits for it).

**Content.** 24 steps in bottom-bar order (Home, Jobs, Clients,
Invoices, Finance, then More). Dashboard 6: hero, inbox, six actions,
Business, Getting around (`.th-desktop-sidebar, .th-bottom-nav`), Search
anywhere (`.th-sidebar-search-trigger, .th-cmdk-btn`). Jobs 3 (add,
views, Contacts+Notes with onShow), Invoices 4 (one per tab), Finance 4
(Expenses, Income, Profitability, Cost Lookup+Inventory), one each for
Route, Contracts, Reviews, Wiki, Runway, Settings. Health checks
(check-consistency + finance-split test) now split comma lists and
accept a class injected by tools-nav-pwa.js / tools-command-palette.js.

**Real bug found by the walk:** runway-dashboard.html's copied tour CSS
lacked `body.th-has-bottomnav .onboarding-card { bottom: ... }`, so on a
phone the bottom bar (z-index 900) sat over the card's Next button --
the tour was un-finishable on a phone from that step, since 2026-08-20.

**Launcher.** `ACTIONS` in tools-command-palette.js: 22 deep links,
listed under "Go to" before typing, filtered (title + meta + keywords)
into an "Actions" group above record matches while typing; `perm`
names an auth.js check (`canViewFinance` etc.) so gated actions hide
exactly where the nav hides the page.

**Deep links.** `applyGenTabFromHash()` on invoices (load + hashchange;
`#pos` still focuses the email field); Finance `hashchange` listener +
`th_finance_tab` memory (hash > memory > cost); Job Tracker
`hashchange` handling for tabs, `#calendar`, `#add-job`. Runway already
had both since round 3.

**Dashboard.** Strip 4 -> 6 (Quick charge `#pos`, Log expense
`#expenses`, both `data-tile-perm` gated like their pages); 3 columns
on a phone with 12.5px labels so it stays two rows (measured 100px vs
the old 106). Help modal and Settings blurb updated.

Verified: suite green (see PR), check-consistency, check-undefined-vars,
lint; Chromium 390x844 + 1440x900, 23/23: full 24-step walk at both
widths with every target on screen, Got it sets the seen flag, Ctrl+K ->
"expen" -> Enter -> Finance/Expenses, tab memory + same-document hash
changes on Finance/Invoices/Jobs, phone strip two rows.

## 2026-09-22: A real bug in "Resend invoice" (silently sent nothing), and a missing "Resend quote"

Started from "start working on the portal" with no specific task --
read docs/CLIENT-PORTAL.md's "Still pending" and "Smaller ideas" lists
first rather than guessing, and one line stood out: "No way to resend
a missed quote notification" was implied by the total absence of a
Portal quotes panel, while a Portal invoices panel already existed with
a Resend button. Before building the missing quote panel, checked
whether the existing invoice Resend button actually worked -- it
didn't.

**The bug**: `resendPortalInvoice()` in `tools/clients.html` called
`sync-invoice-to-portal`, whose `send-invoice-notification` trigger is
gated on `isNewInvoice` (the invoice's `source_invoice_id` not already
present in `client_portal_invoices`) -- a deliberate gate, so re-saving
an existing invoice's line items doesn't spam a duplicate email. But
resending an ALREADY-synced invoice -- the exact case the "Resend"
button exists for -- is precisely the case where `isNewInvoice` is
always false. The button re-upserted the row (a harmless no-op, since
the data was already identical) and sent nothing, while its own UI only
ever checked the upsert's `ok`, never `is_new_invoice` or `email` --
both already present in the response, just never read. It showed
"Sent!" every single time. The panel's own info-bubble text ("Use it
when a client says they never got it, or lost the email") describes a
feature that, as written, could never actually help that client.
Confirmed by reading the edge function's own logic and response shape,
not by guessing, then confirmed live in a real headless-Chromium run
(stubbed auth.js + a route spy on both functions): clicking Resend
never called `sync-invoice-to-portal` at all post-fix, called
`send-invoice-notification` directly instead, and the response's
`skipped` field (client opted out of these emails in Settings) now
surfaces as "Opted out" in the UI instead of a false "Sent!".

**Fix**: `resendPortalInvoice()` now calls `send-invoice-notification`
directly -- the invoice is already synced, so a resend needs nothing
from the sync function's upsert-then-maybe-notify logic, just the
notification itself. Added the missing symmetric piece: a new "Portal
quotes" panel (search + list + Resend, `resendPortalQuote()` calling
`send-quote-notification` directly, same shape as invoices) and its
`DEV_INFO` entry in `dev-tools-shared.js`. `sync-invoice-to-portal`/
`sync-quote-to-portal` themselves are untouched -- their real, correct
job is still first-time sync + notify-on-genuinely-new, called from
`invoice-generator.html` when an invoice/quote is actually created or
edited; only the resend path was ever wrong.

New tests: `tests/tools/portal-invoice-quote-resend.test.js` (9 tests --
both resend functions call the right endpoint and never the sync
endpoint, the skipped/opted-out path is surfaced not swallowed, the new
panel exists and renders on init, the notification functions' own
opt-out gating is unchanged). Updated one pre-existing test
(`tests/dev-tools/portal-work-orders-panel.test.js`) whose regex
assumed `renderPortalInvoices()` and `renderPortalWorkOrders()` sit
immediately adjacent in the init sequence -- `renderPortalQuotes()` now
sits between them, which is fine; loosened the regex to check ordering
without adjacency.

Verified: full suite **2651/2651**, `check-consistency` (after
`fix-versions` bumped `dev-tools-shared.js`'s cache-bust stamp across
its 3 referencing pages plus the service-worker cache, since it's a
shared precached file), `check-undefined-vars`, `lint`, `check-links.py`
-- all clean. Also verified live in a real browser (Chromium via
Playwright, served over local HTTP): both the invoice and quote resend
flows render correctly, the confirm dialog shows the right client/
number, and the network call + UI state after both a successful send
and a simulated opt-out match what the code claims.

## 2026-09-22 -- bug report + usability pass: floating nav buttons over content, three "seams" from the IA rework

Two-part task: a specific report (icons over the Invoice Type field)
plus a fresh click-through of the Workspace suite now that four IA
rounds have landed back to back. Full detail in README.md's dated
entry; the reasoning worth keeping here is why the reported bug wasn't
a padding/icon-in-input problem the way it first looked.

**Root cause, not what it looked like.** The screenshot suggested a
classic "icon positioned inside an input without enough padding"
CSS bug. Reproducing it in a real headless Chromium (390x844) showed
the two icons were actually `.th-cmdk-btn`/`.th-flag-btn`, two
`position: fixed` buttons that float at a constant distance above the
mobile bottom nav on *every* tool page -- their position is fixed
relative to the viewport, not to any particular field, so they land on
top of whatever content happens to occupy that exact band when the
page is short enough (measured: any 761-853px-tall viewport puts
invoice-generator.html's Invoice Type field there). Confirmed with
exact `getBoundingClientRect()` measurements: the real gap between the
field and the bottom nav on that viewport is under the buttons' own
44px height, meaning no fixed offset value could have avoided the
overlap -- and shrinking the buttons was ruled out since 44px is this
app's own documented minimum touch target (set deliberately back on
2026-08-01, see the skill's mobile-touch-target notes). The fix that
actually works is behavioral, not positional: fade both buttons out
while a scrollable page is at its very top, back in after a small
scroll (24px is enough to carry the covered content out of the band).
A page too short to scroll that far just keeps both buttons visible,
so search/flag stay reachable everywhere.

**Lesson for next time a floating/fixed-position element is reported
as "covering text":** don't assume the report's own theory of the bug
(icon-in-input styling) without reproducing it visually first -- the
real mechanism here (two independent fixed-position buttons, unrelated
to the field's own markup) would never have been found by reading
invoice-generator.html's CSS alone, since neither button is defined
anywhere near that file's own styles.

**Usability pass, three real seams found and fixed** (see README for
each): a CSP on client-detail.html missing the one CDN domain its own
script tag requires (broken since realtime sync shipped a month prior
-- worth remembering that a CSP gap fails *silently*, no visible error
banner, just "the feature never worked" until someone checks the
console); a run-on subtitle sentence on job-tracker.html from a missing
period before a dynamically-inserted status span; and parts-reference.html
counting/labeling "appliance types" by model count instead of distinct
type count, visibly wrong the moment a brand has more than one model of
the same type (Admiral, Amana -- both real, current data, not synthetic
test data).

**A fourth, structural finding, fixed for two pages and explicitly
scoped down for the rest:** job-detail.html and client-detail.html hide
their entire view (including the header) until an async record lookup
resolves, with no loading indicator -- on the slow/unreachable
connections this app is explicitly built to tolerate, that's a fully
blank screen for several real seconds. Fixed both with a small
loading-state element visible from first paint, careful not to touch
the found/not-found toggle itself since
`tests/sync/detail-pages-realtime.test.js` pins its exact behavior for
the live-deletion case. The same gap exists on every `roleBlockedOverlay`
page (dev-tools.html, site-content.html, finance.html, and others) --
confirmed by reproducing it, not just suspected -- but fixing all seven
consistently is a bigger job than two isolated loading states and was
left as a named follow-up rather than rushed into this pass.

Verified: suite 2642/2642, check-consistency, check-undefined-vars,
lint, check-links.py all clean; real Chromium 390x844 + 1440x900
covering the fade-in/out behavior, both loading states, and the
corrected CSP actually allowing the script to load.

## 2026-09-22 (later the same day) -- quick PWA/ergonomics pass (visual lane, cross-logged here)

A narrow, low-risk pass -- manifest/apple-meta/safe-area were already
correct from prior sessions; the one real bug found was a CSS
specificity conflict silently undoing the 2026-08-01 `.small-btn`
44px touch-target fix on every phone (was actually rendering at 40px).
Also fixed two sub-44px photo-lightbox buttons and added
`-webkit-tap-highlight-color: transparent` / `touch-action:
manipulation` across the tool suite. No product behavior changed --
CSS only, `tools/styles-tools.css` + `tools/runway-dashboard.html`'s
mirrored copy. Full detail and the debugging story in
`docs/specialist-logs/visual.md`'s entry of the same date and in
README's dated changelog entry. Suite 2642/2642, all checks clean.

## 2026-09-22 (later the same day) -- internal /tools/ MFA (security lane, cross-logged here)

Standalone security work, not part of the IA/UX rounds earlier the
same day. Internal accounts (Owner/Developer/Employee) had zero MFA
option even though the client portal shipped real TOTP MFA on
2026-09-16; this closes that gap with the same underlying Supabase
Auth TOTP mechanism, via raw `fetch()` (`tools/auth.js`) rather than
loading the `@supabase/supabase-js` client the portal uses, plus a
custom recovery-code table/functions
(`sql/security/add_internal_mfa_recovery_codes.sql`) since Supabase's
own native recovery-codes API is behind an unconfirmed experimental
flag on this project. Mandatory for any account whose real permissions
require it (both real accounts today), optional-but-encouraged
otherwise; the gate lives entirely in `tools/login.html` (a session is
never persisted until MFA/a recovery code clears), so none of the
other 22 tool pages needed touching. Full design reasoning, what was
verified live vs. only against a faithful mock (this environment has
no live Supabase access), and the migration that still needs applying:
`docs/specialist-logs/security.md`'s 2026-09-22 entry.

## 2026-09-22 (later the same day) -- finance.html / runway-dashboard.html invoice reads, off the blob (relational tables Phase 2, invoices slice B)

Asked to migrate `tools/finance.html`, `tools/runway-dashboard.html`,
and `tools/dev-tools.html` off `workspace_sync` onto the relational
tables the 2026-09-08 migration created, without breaking anything.
Read `README.md`'s tail, both specialist logs' recent entries,
`docs/ACTION-ITEMS.md`, and `CONTINUE-HERE.md`'s Phase 2 section first,
per the task's own instruction -- the last of those already had the
full reasoning for why this exact pair was deferred on 2026-09-17
("their invoice reads are synchronous helpers called from many render
sites"), and named the already-shipped reference pattern to copy
(`getInvoicesForRead()`/`refreshRelationalInvoicesCache()` in
`sync.js`, already used by `workspace.html`'s Income list and
`invoice-generator.html`'s Recent tab since 2026-09-17).

**Investigated before writing anything**, since the task explicitly
asked to study the synchronous helper and every call site first. Found
the "many render sites" framing was accurate for `runway-dashboard.html`
(`renderRunway()`, which calls `renderAR()`, is itself called from
~11 different state-change handlers across the page) but the actual
invoice-reading code was narrower than the framing suggested: each
page has exactly ONE function that reads invoices --
`renderJobProfitability()`'s local `invoices` variable in finance.html,
`loadJobTrackerInvoices()` in runway-dashboard.html -- called from 1
and 2 places respectively. Also confirmed via grep, before assuming
otherwise, that neither page has ANY invoice write path
(`localStorage.setItem('th_invoices'` appears in neither file), so
there was no read-modify-write-loses-line_items risk to design around,
unlike a page with a real save flow.

**Chose the sync-over-async architecture the task asked me to
consider, and picked (b): cache once at init, keep every reader
synchronous** -- exactly `auth.js`'s `_cachedRoleInfo` shape, which
`sync.js`'s `getInvoicesForRead()` already independently implements
(load into `cachedRelationalInvoices` once, read it synchronously
everywhere, `null` vs `[]` distinguishing "hasn't loaded" from "loaded,
genuinely empty"). Restructuring every call site to `await` would have
meant making `activateTab()` (finance.html's tab switcher) and
`renderRunway()` (called from ~11 unrelated save handlers on
runway-dashboard.html: personal expenses, personal income, business
months, debts, the reset-all button, etc.) all async, and awaiting
network calls in performance-sensitive re-render paths that used to be
synchronous local reads -- clearly the higher-call-site-count, higher-
risk option, and unnecessary since the already-built cache exists for
precisely this shape.

**What actually changed, in each file:**
- `finance.html`'s `renderJobProfitability()`: the one line reading
  `thRead(TH_KEYS.invoices, [])` became
  `(typeof getInvoicesForRead === 'function') ? getInvoicesForRead() : thRead(TH_KEYS.invoices, [])`.
  Init (after `initSyncOnLoad()`) now calls `refreshRelationalInvoicesCache()`
  once, fire-and-forget, re-rendering Job Profitability only if that
  tab is the one currently showing; wired the same refresh into the
  existing `startRealtimeSync()` callback and into a new
  `startInvoicesRealtime()` channel (mirroring `workspace.html`'s
  "one status callback, two channels" pattern) and into
  `setupPullToRefresh()`.
- `runway-dashboard.html`'s `loadJobTrackerInvoices()`: its body
  became the same `getInvoicesForRead()`-with-blob-fallback shape.
  Zero of its 3 call sites (`renderAR()`, `pullMonthFromJobTracker()`,
  and the already-dead, zero-caller `totalAccountsReceivable()`) needed
  to change. Init (after `pullSync()`) refreshes the cache once and
  calls `renderRunway()` again if it resolves; also wired
  `startInvoicesRealtime()` alongside the page's existing
  `startRealtimeSync()` blob channel, sharing the same status callback.

**Deliberately did not touch:**
- `data-layer.js`'s `thRead`/`TH_KEYS` themselves -- a generic
  key-value accessor also used by `job-tracker.html` directly and by
  `thGetClientBundle()`/`thGetJobBundle()` (which back
  `client-detail.html`/`job-detail.html`). Changing the shared function
  instead of finance.html's/runway-dashboard.html's own call sites
  would have silently widened this pass onto three pages the task
  didn't name and that were never audited for this change. This was
  the one point where the task's own framing ("a synchronous helper
  called from many render sites") could have been read as license to
  touch the *shared* `thRead()` — worth flagging explicitly since a
  future session might be tempted to "clean this up properly" by
  making `thRead` itself relational-aware; don't, without auditing
  those other pages first.
- `finance.html`'s `backfillLegacyInvoicesIntoIncomeLog()`, which also
  reads `th_invoices` directly (bypassing `thRead`/`TH_KEYS` entirely).
  Its job is specifically to catch invoices sitting in the blob that
  haven't been mirrored into `th_income_log` yet -- pointing it at the
  relational cache instead would risk delaying exactly the
  reconciliation it exists to do, since the relational mirror is
  itself an eventually-consistent, best-effort copy of the blob, not
  the other way around. Left reading the raw blob, unchanged.
- `dev-tools.html`, entirely. Verified by reading the actual code
  (not assumed) that its reads of `th_tracker_jobs`/`th_invoices`/
  `th_quotes`/`th_contracts` are structurally different from
  finance.html's/runway-dashboard.html's: the Data Quality check and
  Local Data Snapshot are diagnostics ABOUT this device's own blob
  state, and Graveyard's `restoreFromGraveyard()` writes a deleted
  record straight back into the raw blob key via `thWrite()`/
  `thWriteWiki()` -- correct, since undoing a delete means putting the
  record back exactly where every other write already looks for it.
  Reading the relational table in any of these three places would be
  actively wrong, not just unnecessary. One honest, pre-existing gap
  worth naming: a graveyard-restored invoice isn't re-mirrored into
  `invoices` (no call to `mirrorInvoiceToRelational()` in that path),
  so it won't show in finance.html/runway-dashboard.html until some
  other real invoice save re-triggers the mirror -- the same latent
  gap the 2026-09-17 workspace.html/invoice-generator.html conversion
  already carries, not introduced here, not fixed here (dev-tools.html
  is out of scope for this task).

**No new migration was needed.** `invoices` was already added to the
`supabase_realtime` publication in slice A
(`sql/infra/add_invoices_to_realtime_phase2.sql`, already applied),
and neither page needed any column or table that slice A didn't
already provide -- confirmed by re-reading
`create_relational_jobs_invoices_quotes_contracts.sql` and the fetch/
mapping code in `fetchInvoicesFromRelational()` before assuming so.

**Verified in a real headless Chromium** (Playwright, served over
`python3 -m http.server`, never `file://`; every Supabase call routed
through `page.route()` since this environment cannot reach
`*.supabase.co`): seeded a fake but valid `th_auth_session`, mocked
`account_roles` (finance+runway permission), `workspace_sync` (an
older/"stale" blob invoice, $100, job-linked), and `/rest/v1/invoices`
(a different/"fresher" relational invoice, $777, same linked job) --
confirmed Job Profitability shows the $777 relational margin and the
Accounts Receivable panel shows $777 outstanding once the cache
resolves, and confirmed BOTH pages correctly show the $100 blob value
instead when the `/rest/v1/invoices` mock is made to fail (500),
proving the offline-first fallback still works exactly as designed
rather than only in the happy path. No page errors or unexpected
console errors on either page in either scenario.

Extended (not replaced) `tests/sync/relational-invoices-read-phase2.test.js`:
its old "finance.html and runway-dashboard.html are not converted"
test became two new tests mirroring the file's own existing
invoice-generator.html/workspace.html assertions -- confirms the
`getInvoicesForRead()` read, the blob fallback string still present,
the absence of any `th_invoices` write in either file, and both the
cache-refresh-on-init and `startInvoicesRealtime` wiring. Full suite
(2682 tests) run alone (not concurrently with any checker script, per
this file's own earlier note about `finance-split.test.js`'s
`--fix-versions` side effects) -- all passing;
`npm run fix-versions` picked up the real content change to both
precached pages and bumped `service-worker.js`'s `CACHE_NAME` /
precache fingerprint accordingly, same as any other edit to a
precached file.

## 2026-09-22 -- Physical/drawn signature capture, replacing typed-name-only in the 3 remaining spots

Requested directly: "how can we improve the signiture section of our
portal, Pos and other places where it is located, Currently they just
type a name, i want a physical signature."

An audit found `portal/contracts.html` (client e-signature) and
`tools/contract-generator.html` (in-person two-pad PWO/STPA/LTSA
signing, PDF-embedded) already used real canvas signature capture.
The 3 remaining typed-name-only spots -- `tools/invoice-generator.html`
Quick Charge (POS new card), `portal/dashboard.html` (single + bulk
invoice payment new-card), `portal/settings.html` (add-card) -- all
funnel through 4 edge functions' shared `recordCardAuthorization()`
pattern writing to one table, `card_authorizations`.

**Design:** additive, not a replacement. `signer_name` (typed) stays
for search/display/dispute correlation; a new nullable
`card_authorizations.signature_image` column (base64 PNG data URL,
same shape `client_portal_contracts.client_signature_data_url`
already uses) holds the drawn signature, now REQUIRED alongside the
typed name at all 4 card-saving call sites. Existing rows simply have
`signature_image = null` -- no backfill needed, no migration required.

**Shared component, not 3 new implementations:** rather than writing a
new canvas signature pad 3 times, extracted and generalized
`portal/contracts.html`'s already-working pattern into a new
root-level shared file, `signature-pad.js` (`sigPadInit`/
`sigPadClear`/`sigPadHasDrawing`/`sigPadDataUrl`, keyed by canvasId so
a page can host more than one pad). Refactored `portal/contracts.html`
itself onto it too (~50 lines of duplicate code removed), keeping its
own `initSignaturePad(contractId)`/etc. wrapper names unchanged so its
existing onclick handlers needed zero changes. Named with a `sigPad*`
prefix specifically to avoid colliding with `portal/contracts.html`'s
own like-named globals once both scripts share a page. Added to
`GLOBAL_SHARED_FILES` (check-consistency.js) and `SHARED_SCRIPT_FILES`
(check-undefined-vars.js) so its cache-bust version and function
exports are tracked the same as every other shared file.

`check-consistency.js`'s button-handler check only ever resolved
`<script src="/tools/...">` against `tools/`'s own shared-function
cache -- signature-pad.js is the first shared file loaded from the
site root rather than `/tools/` or `/portal/`, so that check needed a
second resolution path for a bare `/<file>.js` src pointed at
`ROOT_DIR`. Fixed rather than special-cased, so any future root-level
shared file needing this same coverage just works.

**Near-miss during deploy, caught and fixed immediately:** the first
`deploy_edge_function` call for `create-pos-charge` accidentally sent
placeholder content (`"PLACEHOLDER"`) instead of the real file body,
briefly replacing this live, production payment function for well
under a minute before being caught and redeployed with the verified
real content. This is the exact class of mistake this log's own
2026-09-16 bugfix entry already flagged as a risk; re-confirms the
lesson: always re-fetch and diff a deploy's live content against the
real source file immediately after any `deploy_edge_function` call on
anything payment-critical, never trust the call succeeded just because
the tool returned 200.

All 4 edge functions (`create-pos-charge`, `create-payment-intent`,
`create-bulk-payment-intent`, `manage-saved-card`) now validate
`signature_image` is a real `data:image/...` string before proceeding,
alongside the existing `signer_name` check. `portal/settings.html`'s
Authorization history panel now shows a thumbnail of the drawn
signature when present (old rows with no signature simply show none).

23 new tests in `tests/edge-functions/physical-signature-capture.test.js`
cover signature-pad.js's own behavior, the contracts.html wrapper
refactor, all 3 new UI signature requirements, and all 4 edge
functions' validation + recordCardAuthorization wiring. 9 existing
tests across `add-card-from-settings.test.js`,
`bulk-payment-signature-parity.test.js`,
`invoice-payment-signature.test.js`, `pos-signature-capture.test.js`,
and `focus-trap.test.js` needed their string/regex assertions updated
for the new `signatureImage` parameter added to
`startPayment`/`startBulkPayment` and the new `signature_image` arg
threaded through every `recordCardAuthorization()` call -- pure
signature-shape drift, not behavior changes to fix.

## 2026-09-22 (later still) -- Workspace rework, part 1: the app shell (Create button, Money tab, header menu)

Brief: "full discretion... make this the most app-like, easy-to-use,
efficient handyman hub it can be... think about the whole suite as a
single coherent product." Planned as a sequence of small merged PRs, not
one long-lived branch (every merge today hit a concurrent conflict).
This first one is the shared shell; pages come next.

**What the audit found (real browser, fake Supabase, seeded data).**
Four rounds of IA work had already removed the worst of it, so the
remaining problems were about *shape*, not clutter: (1) there was no one
place to start anything -- each "new X" lived on the page that owns X,
so creating a quote meant knowing it was a tab on the invoice page;
(2) the bar spent two of five slots on Invoices and Finance, two pages
that together are "money"; (3) two floating buttons (search, flag) hovered
over content on every phone page and needed a fade-at-top hack; (4) the
Clients tab opens a portal-admin console, not a client list -- noted
here, fixed in part 2.

**Decisions and why.**
- **( + ) in the bar's centre, not a floating action button.** A FAB is
  exactly the thing that caused the 2026-09-22 overlap bug; inside the
  bar it can never cover content. Five slots keep the ( + ) centred (six
  would not), which is why something had to give.
- **Money = one tab over two unchanged pages.** Merging invoice-generator
  (2860 lines) and finance (1655) into one page was rejected: separate
  permission gates, separate init, and this repo's own lesson that pieces
  are never as separable as they look. Instead the tab opens the
  last-used of the two, and a header switch joins them. Zero changes to
  either page's logic. Permission edge cases handled in
  `applyMoneyPermissions()`: invoices-only or finance-only accounts get a
  tab pointing at the one they can open and no switch; neither -> no tab.
  `hideRestrictedNavLinks()` skips `.th-bn-money`, because hiding it for
  lacking ONE of the two pages would be wrong.
- **More moved to the header**, beside Search. Everything in it (Route,
  Runway, Contracts, Reviews, Wiki, Dev Tools, Settings) is occasional;
  the header is where phone apps keep that menu. Considered keeping More
  in the bar and dropping Clients or Money instead -- both are daily.
- **The Create sheet adds no forms.** Every tile is an existing deep link
  that already opened its form (verified each in Chromium, including a
  same-document hash change on the invoice page). A new form would have
  been a second copy to keep in sync.
- **Help (?) folds into the drawer on phones** ("How this page works"
  presses the page's own ? button, which stays in the DOM, so no page
  needed editing). That is what made one header row possible on a 360px
  phone; the three longest titles were shortened to their nav labels for
  the same reason (`one-shell-header` test map updated).

**Gotchas worth keeping.**
- runway-dashboard.html's copied CSS uses `--bg-card`, not `--bg-panel`;
  its copy of the command palette CSS already referenced `--bg-panel`
  and rendered transparent. Added an alias rather than rewriting copies.
- The Create sheet must work on desktop but the More sheet must not, so
  they share `.th-sheet*` classes while only `.th-more-sheet` keeps the
  `min-width:1024px { display:none }` rule the tablet-band test parses.
- The bar sits above the Create backdrop on phones (`z-index: 960` while
  `th-create-open`) so the ( + ) can turn into an x in place; the panel
  reserves the bar's height at its bottom for that.
- `pageHelpButton().click()` works on a `display:none` button -- that is
  what lets the drawer row reuse each page's own help wiring.
- N opens Create only when focus is not in a field and no dialog / tour
  card is open (`.onboarding-card` only exists while the tour runs).

Verified: full suite, check-consistency, check-undefined-vars, lint;
Chromium at 360/390/820/1440, dark and light: every Create tile's
landing, Money memory + switch, one-row headers on all 14 pages, the
full 25-step tour at 390 and 1440 (every target on screen, Next
clickable), tablet drawer, desktop dialog, no console errors.

Next (part 2): the Clients tab becomes a real client directory -- the
`thGetAllClientsWithTotals()` comment in data-layer.js already says it
was meant to back "the Clients hub page", which was never built.

## 2026-09-22 (later still) -- Workspace rework, part 2: the Clients tab becomes a client directory

The most concrete finding of the whole audit: the bar's Clients tab
(promoted there 2026-09-21 as "a top daily task") opened
`clients.html`, which was the portal-admin console: accounts, portal
invoices, email lists, bug reports, client JS errors. No client list
existed anywhere except Job Tracker's Contacts tab (an address book
that also holds suppliers). `data-layer.js` has had the registry
(`th_clients`), the bundle query, and a comment saying
`thGetAllClientsWithTotals()` would back "the Clients hub page" since
2026-08-20. That page was never built.

**Decisions.**
- **Same page, two tabs, not a new page.** The bar already points at
  `clients.html` and old links (`?search=` from Dev Tools' Client
  Registry) land there. So the list became the default tab and the
  console moved under **Portal** unchanged, byte for byte. A bare
  `?search=` still means the Portal tab, so the "View in Clients" link
  still works.
- **Lazy portal render.** The nine panel renders run on first Portal
  activation (`renderPortalPanels()`), not on load. The daily view
  should not fire nine admin requests. The init still sets
  `portalAccountSearch` before any render, which
  `labor-mileage-and-registry-link.test.js` requires.
- **Gate moved from nav to tab.** The list is local data every account
  already sees on Job Tracker, so `clients.html` left
  `NAV_PERMISSION_CHECKS`. The Portal tab hides only on a definite
  `canManageInvoices: false` from `th-role-loaded`. A failed role load
  leaves it visible, because RLS is the real gate and hiding it on a
  network blip would lock Connor out of it.
- **One pass, indexed** (`thGetClientDirectory()`), instead of
  `thGetClientBundle()` per client. The money helpers (`thInvoiceBalance`,
  `thInvoiceDueDate`, `thInvoiceIsOverdue`, `TH_TERM_DAYS`) copy
  workspace.html's Money Owed rules exactly: legacy `paid` without
  `paidAmount`, whole-cent math, and a 15-day default term. They are not
  shared with workspace.html yet. Moving the dashboard onto them would
  touch `computeMoneyOwed()`, which several tests pin; that's a
  follow-up, not this PR.
- **Backfill on every load**, not once per device, so a name typed
  anywhere just appears. That exposed a real edge: `thBackfillClients()`
  matched by name only, so a job linked by `clientId` whose name text
  was retyped would have created a second client. The collector now
  skips records whose `clientId` resolves to a live client. Tombstones
  are still respected.
- **Rows are links; hold is the sheet.** `attachLongPress` refuses to
  start on any `<a>` (on purpose, so cards with inner links keep their
  taps). Rows whose whole body is the link opt in with
  `data-long-press-target`. After a fired hold, the next click is
  swallowed (capture listener, once, 800ms cap). `contextmenu` is
  suppressed on those links, and CSS drops iOS's link callout and text
  selection. Found only by holding a row in Chromium: the first
  version silently did nothing.
- **`?client=` handoff**, not new forms. New job, Invoice, and Quote
  from a client open the existing forms with the name filled in. The
  same registry autofill a typed name triggers does the rest (phone,
  email, address). Fill-only, and the param is stripped once applied,
  the same shape as `?jobRef=`.

**Pre-existing bugs found and fixed on the way:**
- `?search=…#tab-recent` from client-detail and job-detail: wrong hash,
  and nothing read `?search=`.
- The desktop `padding-top: 75px` rule on twelve pages had been dead
  since 2026-09-06. It was a specificity loss to `body.th-tool-page`;
  one shared rule fixes all twelve. Desktop sticky tabs also used the
  phone notch offset.
- A `<section>` inherits the public site's section padding. Hence the
  `div role="tabpanel"` panels; worth knowing for anyone adding
  sections to a tool page.
- "Last Job" on a client could be a future date.
- Clients' init-error banner was missing its label argument.

**Test-harness gotcha worth keeping:** inlining a shared script into a
jsdom page with `html.replace(re, '<script>' + src + '</script>')`
breaks `tools-dialogs.js`, because `money()` contains `'$&,'`, which
`String.replace` expands. Use a function replacer.
`detail-pages-realtime.test.js` only gets away with a string because
data-layer.js has no `$&` in it.

## 2026-09-22 (later still) -- Workspace rework, part 3: job cards, date groups, Job Detail's action row

**Card decisions.**
- **Keep the markup, change what shows.** The six-control row stays in
  `jobCardHtml()`. Tests pin much of it, and the desktop board uses it.
  Below 1024px, CSS hides the status select, the small buttons (except
  Done), and the Create Invoice link. That link needs `!important`
  because it carries an inline `display:inline-flex`; found by
  screenshot, not by reading the code. Board columns get the same
  compact row at every width.
- **One sheet, two doors.** `openJobActions(id)` replaced the anonymous
  long-press callback, so the ⋯ button and a long-press can't drift
  apart. It keeps `label: 'Log Expense'` and
  `showQuickExpenseModal(jobId, job.title)` verbatim, which a
  finance-split test pins. It adds the status moves the hidden select
  used to offer, plus Open, Photos, Invoice, and the confirmation email.
- **Badges by exception.** Priority is already the card's left border
  colour, so a MEDIUM/LOW badge on every card was noise that wrapped
  titles onto two lines. On phones only HIGH and IN PROGRESS stay
  (Not Started is the default), alongside margin and warranty.
- **Relative dates, date groups.** `relativeJobDate()` and
  `jobDateGroup()` are small, pure functions (tested via extraction).
  Headers are inserted only while sorting by date. When done jobs are in
  view, every past date reads "Earlier". Otherwise a date-sorted "All"
  list would bounce between Overdue and Earlier headers.

**Job Detail stays read-only.** A Done button there would have meant a
second job write path, bypassing `setJobStatus()`'s relational mirror,
completion celebration, and review prompt. CONTINUE-HERE warns about
exactly that for write paths. The action row is links into existing
flows: `?jobRef=` on the invoice page, `?job=` on finance's expenses.

**Gotchas:**
- The realtime detail-page test's harness has no `escapeAttr`, so the
  new row falls back to `escapeHtml`, the same defensive style as the
  rest of these pages.
- In a `vm` context, `assert.deepStrictEqual` fails on arrays from the
  other realm even when they print identically; convert with
  `Array.from`.

## 2026-09-22 (later still) -- Workspace rework, part 4: Invoices opens on the list; one Mark paid

**Why list-first.** Money is a bottom-bar destination, and the question
it answers is "who owes me?" Landing on a blank invoice form answered
"make a new one", which the + button already does from every page. The
list was the fourth tab, off-screen on a 390px phone. Every way in that
means the form still gets the form:
- `#invoice`, `#quote`, `#pos` hashes;
- `?jobRef=` (a job's Create invoice) and `?client=` (a client's
  Invoice button), read by `genTabFromQuery()` *before*
  `applyJobRefFromUrl()` / `applyClientFromUrl()` strip them from the
  URL;
- the Dashboard strip's Create invoice, now `#invoice` (it was the only
  hashless link to the page).

**Numbers match the Dashboard.** `invoiceState()` uses the same rules as
workspace.html's `invoicePaymentStatus()` / `isOverdue()` and sync.js's
`deriveInvoicePaid()`: paidAmount first, the legacy `paid` flag only
when there's no paidAmount, and whole-cents comparison. A test runs the
three side by side over edge cases, so "Owed to you" here and "Money
Owed" on the Dashboard can't disagree. The tiles count every invoice
(ignoring search and filter), like the quote conversion rate.

**One sheet, two doors, again.** `openInvoiceActions(id)` is opened by
a tap on the row (the row's body is a `<button class="th-row-link">`)
and by a hold. `attachLongPress`'s opt-in (`data-long-press-target`)
now accepts a button as well as a link. Mark Paid leads the sheet
because it's the everyday action. Quotes get `openQuoteActions()`:
Open client, Open job, Delete. Converting a quote still happens on the
New quote form, since there is no load-a-logged-quote path to reuse.

**The Mark paid fix (payments-adjacent, called out on the PR).**
- `toggleInvoicePaid()` now sets `paidAmount = paid ? total : 0` with
  the flag. Those are the Dashboard's full-payment semantics.
- It now calls `mirrorInvoiceToRelational()`, which it never did, so
  the relational read cache stayed stale.
- It now calls `mirrorReferralEarnedForJob()` on becoming paid.
- Workspace `togglePaid()` gains the portal call it never had.
- The portal call itself moved into `pushInvoicePaidToPortal()` in
  sync.js, unchanged: same endpoint, same body, still fire-and-forget
  after the local save.
- No edge function, schema, or RLS change.

## 2026-09-22 (later still) -- Workspace rework, part 5: the job-to-money pipeline

**The gap.** Nothing in the suite noticed a finished job that was never
billed. The Dashboard knew about unpaid *invoices*. A job marked Done
with no invoice at all was invisible: it wasn't owed on paper, so it
appeared nowhere. For a one-truck business that is the most common way
money is lost. And the Done moment only offered a review request.

**One derived stage, no new records.** `thJobMoneyStage(job, invoices,
manualIncome)`:
- Invoices linked by `jobRefId`: all paid means **paid**; any past due
  means **overdue**; otherwise **invoiced**. This is the paidAmount-first
  balance from part 4.
- Else a hand-logged payment against the job (Finance income with that
  `jobRefId`) means **paid**. That mirrors `thComputeJobMargin`'s
  `hasInvoice`, so "billed" means the same thing in both places.
- Else status: done means **to-invoice**, or **no-charge** when
  `job.noInvoice` is set; in progress means **working**; otherwise
  **booked**.

The stage follows the money, so a deposit invoice on an unfinished job
reads Invoiced. `thJobSteps()` keeps work and money apart for the
tracker: Done isn't reached, Invoiced is.

**The 60-day window.** `thJobsToInvoice()` only counts jobs finished in
the last 60 days (TH_TO_INVOICE_DAYS). The done date is
`statusChangedAt`, else the job's date. Without the window, history from
before invoicing moved into this app would bury this week's forgotten
job. Jobs' pills and filter use the same list (`marginData.toInvoiceIds`),
so the Dashboard count and the Jobs filter always agree. Job Detail still
offers Create invoice on an older unbilled job, since there it's asked
for.

**Every way out of "to invoice" is honest.**
- Invoice it (`?jobRef=`, the existing prefill).
- Log that it was paid another way: `finance.html?job=<id>#income` now
  opens the income form with the job, client, and description filled.
  That keeps the books right instead of just hiding the row.
- Mark it **No charge**. `thSetJobNoInvoice()` is the one write. It's
  blob only, since the relational jobs mirror has no column for it and
  nothing reads it there. It writes an explicit `false` to clear, never
  a delete, because sync.js merges per field and a deleted field can
  come back from a stale device. The Dashboard's No charge is undoable.

**Job done sheet.** `setJobStatus()` → `openJobDoneSheet(job)`. It
offers Create invoice (only while unbilled, behind `canManageInvoices`),
then the review request, then No charge. The review link moved into
`reviewRequestHref()`, which the bulk flow's test now pins alongside
bulk's own copy. If `showQuickActionSheet` isn't there, it falls back to
the old confirm.

**Job Detail stays read-only.** The tracker's buttons are links into the
pages that own the writes: invoice form, Finance income, the Recent list.

**Gotchas:**
- The Dashboard jsdom harness needs `requestAnimationFrame` stubbed,
  since `renderMetrics` animates.
- An `async function` pulled out by source extraction needs its `async`
  put back before it goes into a vm.

## 2026-09-22 (later still) -- Client portal: your visits, unread messages, and a Home that knows who you are

Three rounds on `portal/*` only (a sibling session owned `tools/`),
driven by a direct audit of the pages and the live schema rather than
the docs. Branch `claude/portal-visits-and-messages`.

**Round 1 -- a client could not see a visit they booked themselves.**
Every portal self-scheduling path (approved quote, check-up reminder)
and `booking.html` writes a real `th_bookings` row, but `th_bookings` is
internal-only under RLS. Worse, `client_portal_quotes.scheduled_at` is
`new Date()` at scheduling time, not the appointment -- so "Job
scheduled. We'll see you then!" was literally all the portal knew.
- `get_my_portal_visits()`: SECURITY DEFINER, caller's email only
  (case-insensitive -- `th_bookings.email` is hand-typed on
  booking.html), fixed client-safe column list, `cancel_token` returned
  as `manage_token` only while confirmed. **Why definer, not a client
  SELECT policy:** RLS is row-level; a policy would expose notes/utm/
  referral columns. The token grants nothing new -- the same token is
  already emailed to that address. Advisor lint 0029 lists it; expected.
- Home hero now merges work-request visits and booked visits, with a
  date tile, Add to calendar (`.ics`, RFC 5545 escaping + folding, a
  2-hour alarm) and Reschedule/cancel via the existing
  `manage-booking.html`. Quote cards show the real visit; check-up
  banners show a booked visit instead of re-offering one.
- `schedule-quote-job` v11: rebooking allowed ONLY when every booking
  for the quote is cancelled (fails closed if that lookup fails);
  optimistic `scheduled_at=eq.<prior>` write; race-loss undo by the new
  row's id. **Deploy drift found:** live v10 predated the repo's race
  guard (it landed inside unrelated #295 and was never deployed) --
  v11 ships both. Verified live source == repo byte-for-byte.

**Round 2 -- no way to know Triple H replied.** Design came from a Plan
agent pass, then verified live with simulated JWTs in rolled-back
transactions (2 unread -> 1 after marking through reply 1 -> 0 capped at
now(); another client's thread rejected by RLS; staff login counts 0).
- One `client_portal_thread_reads` table (watermark per thread) rather
  than `read_at` on message rows (would need a client UPDATE policy on
  tables that deliberately have none, and RLS can't limit it to one
  column) or localStorage (per-device). One table, not one per message
  table: read rows are UI state, orphans are harmless.
- Both RPCs are SECURITY INVOKER. The explicit `client_email =
  auth.email()` joins in `get_portal_unread_counts()` are required: the
  message tables let staff read every thread.
- **Watermark gotcha:** pass the RAW `created_at` string of the newest
  rendered message. `new Date(x).toISOString()` truncates microseconds
  and leaves that message unread forever.
- **Found in passing, fixed (SQL only, no tools/ edit):**
  `client_portal_jobs`/`_invoices` had client-only SELECT policies, so
  every `tools/clients.html` panel reading them with the staff login
  (Portal job messages, Portal invoices, Portal accounts counts, client
  search/summary) came back empty -- Steve could not see a job to reply
  on. Merged "clients or internal accounts" policy on both.
- One shared thread renderer in `portal-app.js` replaced two copies;
  it also fixed `jobs.html` printing "Invalid Date" under every message
  (`formatDate()` appended `T00:00:00` to a full timestamp).

**Round 3 -- Home.** The greeting comment claimed to use the client's
name; nothing ever set it. Now "Good evening, Jane" (profile name, then
invoice/quote name, never guessed from an email). Recent Activity: last
five real events across sections (90-day window) from rows Home already
loads -- deliberately no new query or table. Request Work prefills
phone (Settings) and address (last request, else latest estimate),
fill-only, with a visible "where this came from" note.

**Deliberately not done:** letting clients read their own
`quote_questions` answers (still internal-only by design -- answered by
phone/text), and a realtime thread subscription (badges refresh on
load/pull-to-refresh; the email notification is unchanged).

**Noticed, outside this lane (security):** the advisor lists four
internal MFA recovery-code functions (`generate_/verify_and_consume_/
count_unused_/delete_internal_recovery_codes`) as executable by `anon`.
They are internal-tools functions; not touched here. Checked read-only:
all four scope every read/write by `auth.uid()`, which is null for anon,
so they act on nobody -- a revoke-from-anon hygiene item for the
security lane, not an exposure.

## 2026-09-22 (later still) -- Workspace rework, part 6: From this job

**Why.** Part 5 routes every finished job to "Create invoice". That's
only a win if the invoice isn't retyped from memory. Everything needed
is already recorded:
- hours on the job (`hoursWorked`, when set);
- receipts logged in Finance with its `jobRefId` (`th_expense_log`,
  type `expense`);
- mileage entries (type `mileage`, `miles`);
- often a quote the client already agreed to (`th_quotes`, `jobRefId`,
  with `line_items` saved since 2026-09-06).

**`jobBillables(job, expenses, quotes, rates)`** is a pure function
(tested by extraction):
- **Labor** = hours × the remembered labor rate (`th_invoice_labor_rate`).
  If hours weren't logged it's still offered, as a line that asks for
  them (`needsHours`).
- **One part line per receipt**, at cost, oldest first, rounded to the
  cent, with its part number.
- **One Mileage line** summing all the job's miles, at the remembered
  billing rate (`th_invoice_mileage_rate`, not Finance's cost-per-mile),
  untaxed.
- **The newest quote** for the job that isn't converted and has line
  items.

**Offer, don't insert.** The panel adds nothing until Add. Reasons:
parts at cost may need markup, a receipt may not be billable, and the
quote may already cover the parts. So with a quote on offer, the logged
lines start unticked. Without one they start ticked, making it one tap.
`jobFillState` remembers per job what was done (dismissed, or added
rows + the replaced starter row + discount/quote link), so Undo is
exact. `takeStarterRow()` only replaces the untouched starter row (one
row, no price). Rows typed by hand are never removed.

**Bill the quote** sets `pendingSourceQuoteId`, the same link Convert to
Invoice sets, so `logInvoice()` marks the quote converted on save, and
Undo clears it. The quote's discount goes into the discount field only
when that field is empty or zero.

**Wiring.** Called on `?jobRef=` (after the existing prefill), on the Job
dropdown's change, and reset by `resetInvoiceForm()` /
`convertQuoteToInvoice()`.

**Gotcha:** `eval`'d scripts keep top-level `const`s block-scoped, so the
jsdom harness rewrites data-layer.js's top-level `const` to `var` before
evaluating it. The real page loads it as a classic script where they
are globals.

## 2026-09-22 (later still) -- Workspace rework, part 7: quick add

**Why.** The + sheet made every "start something" one tap away. But each
form still begins empty, and on a job site the details arrive as a
sentence: "Sarah called, her sink's leaking, can we come tomorrow at 2?"
Quick add takes that sentence.

**Guess, don't save.** `thParseQuickEntry(text, { now, clients, vendors,
jobs })` in tools-nav-pwa.js is pure and returns a structured guess.
`thQuickEntryHref()` turns the guess into a deep link that pre-fills the
owning page's existing form:
- `job-tracker.html?title=&client=&date=&phone=&address=&priority=&notes=&qa=1#add-job`
- `invoice-generator.html?client=&item=&price=&jobRef=#invoice|#quote`
- `finance.html?amount=&vendor=&desc=&date=&job=#expenses`

So saving still runs each page's own logic: the client registry
(`thEnsureClient`), the relational mirrors, portal sync, the receipt
requirement. Nothing new writes data. Each receiving page fills only
blank fields, then strips the params it used.

**Parsing order matters.** Each step cuts its match out of the text:
1. intent word;
2. phone;
3. **address** (before times and money, so "88 Sunset Blvd" isn't read
   as $88);
4. money;
5. time;
6. date;
7. urgency;
8. client;
9. vendor;
10. bare number as the amount, for money entries only;
11. the related job;

and what's left, tidied, is the title.

**Client matching:**
- A known full name (longest first) wins anywhere in the text.
- A known *first* name counts only when it's unambiguous (one known
  client has it) **and** plainly a name: after for/at/with, possessive,
  capitalised mid-sentence, or first after a money word ("invoice
  sarah"). So a client called Will doesn't swallow "will need parts".
- Otherwise a capitalised name after "for", or a capitalised First Last
  right after a money word, is a new client.

**Dates.** Weekday abbreviations are taken only after on/next/this/by,
so "sun room" stays a room. A past month/day for a job or quote rolls to
next year; invoices and expenses keep this year.

**Which job.** For an invoice or expense, among the client's jobs that
are open or were finished in the last 30 days:
- one whose title shares a word with the sentence wins;
- then, for an invoice, a finished one;
- then, for an expense, one under way;
- then the most recent.

**Search** (tools-command-palette.js) shows the guess as the top result
only when there's an explicit kind word, or a title plus at least one
other signal. A plain name search stays a name search.

**Voice.** Own `SpeechRecognition` (webkit prefix) with
`interimResults: true` and `continuous: false`, so the field and preview
fill in while you talk. The shared `attachVoiceDictation` is
continuous-append for notes, which doesn't fit here. The mic button only
appears where the API exists.

**Fixed along the way:**
- `applyJobRefFromUrl()` used to replace the whole query string, so a
  link carrying `?jobRef=` plus anything else lost the rest. It now
  deletes only `jobRef`.
- `closePalette()` now blurs the palette's input; before, N right after
  closing search was swallowed as typing.

## 2026-09-22 (later still) -- Client portal: a real desktop layout, and Settings as a menu

Both asked for directly after the visits/unread PR merged: "The computer
version looks like your looking at a phone on a monitor screen" and "i
want the settings reworked and less packed full of things."

**Desktop shell.** Decided against a separate desktop nav: the existing
`<nav class="portal-nav">` is wrapped in a `.portal-rail` div on every
signed-in page. Below 1024px that wrapper is `display: contents`, so the
nav is still the same fixed bottom bar (the wrapper can't regress
phones); from 1024px the wrapper is a fixed sidebar and the nav inside
is reset to a vertical list. Contracts/Settings and the Call/Text box
sit in the wrapper but outside the nav, because the nav has to stay
exactly five links for the phone grid (and
`tests/portal/portal-usability-pr3.test.js` forbids `is-active` in
Settings' nav, so the Account links use `is-current`). Two-column pages
use `.page-split` with the side column FIRST in the DOM where that
content came first before, so a phone keeps its old reading order. Home
needed the opposite (feed in the main column, account cards in the
side, cards still above the feed on a phone) -- done with
`display: contents` on the column wrappers plus flex `order`.

**Settings.** Eleven collapsed cards became six menu rows with a live
status line each ("Visa ending 4242 - expiring soon", "2 of 3 emails
on", "Two-factor on"), so most visits need no tap at all. Section state
lives in the URL hash only: pushState on a phone (Back closes the
section), replaceState on desktop (a tab switch shouldn't stack history
entries). Every id and handler kept; the tests that pinned the
accordion (`settings-collapsible-sections`, the density rules, the 2FA
vs "Security" ordering, the A2HS `'block'` literal) were rewritten for
what they were really protecting.

**Bug fixed on the way.** The Add to Home Screen card was meant to hide
on desktop, but `renderAddToHomeScreen()` set an inline
`display: block`, which beats the stylesheet -- the hide never worked
once the page loaded. It now clears the inline value, and only the
generic "look in your browser's menu" fallback hides on desktop
(`.is-generic`); desktop Chrome/Edge get a real one-tap "Install app"
from the same `beforeinstallprompt` Android uses.

Tests: `tests/portal/desktop-app-shell.test.js`,
`tests/portal/settings-menu-and-sections.test.js` (jsdom, drives the real
routing at phone and desktop widths).

## 2026-09-22 (later still) -- Client portal: never miss a reply

The Request/Jobs tab badge said a reply was waiting, but the page opened
on a blank request form (or the check-up list) with the conversation
somewhere below. And unread counts were read once per page load, so a
portal left open in a tab -- or returned to from the "Triple H replied"
email -- showed stale badges, and a reply landing in an open
conversation never appeared.

**Decided: polling, not Supabase realtime.** `portalWatchUnread()`
re-runs the existing `get_portal_unread_counts()` RPC on return to the
tab (visibilitychange/focus) and on a timer only while the page is
visible: 20s while a thread is open (chat-like), 90s otherwise. Realtime
would need the two message tables added to the publication, a socket
per open tab, and RLS-on-realtime to be right; polling one RPC that
already exists and is already RLS-safe needs none of that, and the
latency difference doesn't matter for a handyman's reply. A failed
check returns null (`nullOnError`) and changes nothing -- otherwise a
network blip would wipe every badge.

- **"Triple H replied" bar** at the top of Request and Jobs
  (`portalReplyNoticeHtml`), one row per unread conversation, newest
  first, max three. Tapping opens and scrolls to the thread; marking it
  read removes it. A conversation already open on screen is left out.
- **Open thread refreshes in place** (`{ quiet: true }`): no skeleton
  flash, and `portalReplaceThreadKeepingDraft()` keeps a half-typed
  message and the cursor. It skips while a send is in flight -- the send
  re-renders the thread itself, and restoring the draft then would put
  the just-sent text back in the box.
- **Home** re-renders its attention item and card counts on change;
  Quotes/Invoices/Contracts/Settings keep their nav badges current via
  `portalStartUnreadBadges()`.
- `setBaseline()` after the page itself marks a thread read, so the next
  check isn't mistaken for news.

Tests: `tests/portal/reply-notice-and-live-unread.test.js` (jsdom; drives
the watcher and the Request page's unread handling for real).

## 2026-09-23 -- Workspace rework, part 8: quick add from anywhere

**Why.** Part 7's quick add takes a sentence, but most jobs don't
start as a sentence someone types. They start as a text from the
client, sitting in Messages. Retyping it is the step that gets skipped
on a busy day, so part 8 lets the message itself come in.

**Three ways in, one landing** (`openQuickAddFromUrl()` in
tools-nav-pwa.js). Each opens the Create sheet with the text in quick
add and the preview built, then strips its params with `replaceState`
so a reload doesn't reopen it. Any other params are kept.
- `manifest.json` `share_target` (GET → `workspace.html` with
  `share_title` / `share_text` / `share_url`). Android puts the
  installed app in the share sheet. A share's title is often the start
  of its text, so of two pieces where one contains the other, only the
  longer is kept.
- `?quick=<text>` on any tools page. iOS has no web share target, so
  this is what an iPhone Shortcut ("Receive text from Share Sheet →
  Open URL") calls.
- `#quick-add`, the new second entry in the manifest's `shortcuts`
  (long-press the home-screen icon).

The URL check runs a tick after `inject()` (`setTimeout(…, 0)`). On a
page that loads the shell after the DOM is ready, `inject()` runs during
the file's own execution, before the QUICK ADD section's top-level
`var` tables further down have been assigned.

**Paste** (`#thQuickAddPaste`) exists only where
`navigator.clipboard.readText` does. It sits under the field and hides
while there's text (`.is-typing`). The browser asks for clipboard
permission the first time.

**Long messages** (`out.long`, more than one sentence or more than 70
characters). The field-by-field parse still runs over the whole text,
so client, date, time and phone come out as before. Only the title is
chosen differently:
1. Greetings and self-introductions ("Hi,", "Hey it's Tom!", "this is
   Sarah.") are stripped from the front.
2. The text is split into sentences. Sentences that are asks (can /
   could / would / any chance / please / thanks…) are set aside.
3. The first remaining statement is the title.
4. If every sentence is an ask, the ask's lead-in is removed ("can you
   come look at our …") and what's left is the title.
5. The title is cut at a word near 60 characters, with "…".

`thQuickEntryHref()` puts the whole message in the job's notes
(`Their message: “…”`), after `Time:`, so the job keeps what the client
actually said.

**Parser widening:**
- Word lookaheads accept trailing punctuation.
- A bare hour after at / around / about / by is a time; 1 to 6 is
  read as PM.
- this / the weekend → the coming Saturday; next weekend → the
  Saturday after that; next week → its Monday.

**Permissions.** `refreshCreateSheet()` already runs on
`th-role-loaded`. It now also re-previews a non-empty quick add, so text
that arrived before the role (a share, a fast typist) gets its button
instead of a stale "can't create".

## 2026-09-23 (later) -- Workspace rework, part 9: On the clock

**Why.** Part 6 fills an invoice from its job, but its Labor line
depends on `hoursWorked`, which almost nobody typed in. The comment in
`jobBillables()` says as much: "Most jobs never get their hours logged."
A clock you start when you arrive gets the hours without anyone typing
them.

**State lives on the job.** Running means `job.clockSince` holds an ISO
time, so there's no separate store to keep in step:
- it survives closing the app;
- it syncs, because `th_tracker_jobs` merges per field three ways
  (`mergeRecordArrays`), so a clock started on the phone and a note
  edited on the computer both survive (tested);
- `clockSince` is set to `null` on stop, never deleted, for the same
  merge reason as `noInvoice`.

**Data layer** (data-layer.js, Job clock section):
- `thStartJobClock(id, now)` stops any other running clock (committing
  its time), sets `clockSince`, and moves not-started to in-progress
  with `statusChangedAt`.
- `thStopJobClock(id, now)` adds the time to `hoursWorked`, appends
  `{ start, end, hours }` to `timeLog`, and returns an `undo` snapshot.
- `thUndoStopJobClock(id, undo)` puts those three fields back.
- `thFinishJob(id, now)` commits a running clock, then marks the job
  done.

All four save through `thWrite`, which schedules sync, and then
`mirrorJobsToRelational`, since status is a relational column. Each
dispatches `th-clock-change`.

**Rounding.** 0.1 h (6 minutes), at least 0.1 h once a session counts.
Under a minute adds nothing: that's a mis-tap, not work.

**Shell** (tools-nav-pwa.js, ON THE CLOCK):
- The display helpers are here, since the shell is the one script every
  page loads: `thFormatClock` (stopwatch), `thClockDuration` ("1 h 25
  min"), `thClockHoursLabel`.
- So are the page-facing actions: `thStartClock`, `thStopClock` and the
  Stop sheet (`thOpenClockStoppedSheet`).
- The bar re-renders on `th-clock-change`, on `storage` (other tabs),
  on `th-sync-status` (a pull), and on returning to the tab. It ticks
  only while the tab is visible, and hides on the running job's own
  page.
- Pages without data-layer.js (Route Planner, Parts, Settings) still
  show the bar, read straight from storage. Their Stop opens the job.

**Stop sheet.** "Done — create the invoice" appears only when the job
would land in To invoice (`thJobMoneyStage` of the job as done) and the
account can manage invoices. `showQuickActionSheet` gained an optional
`{ cancelLabel }`, so its last button reads "Not done yet" instead of
Cancel.

**Where you start it:**
- Job detail: its one self-made write, through the helpers above.
- The Jobs sheet: Start / Stop the clock first.
- The Dashboard's Next Job card, through a delegated listener, not an
  inline handler.

`setJobStatus(…, 'done')` stops a running clock before anything else.
An open edit form picks up new hours and status on `th-clock-change`,
so saving it can't write stale ones back.

## 2026-09-23 (later still) -- Workspace rework, part 10: Get paid

**Why.** Parts 4 to 6 made sure every job becomes an invoice. The last
gap between work and money is the invoice that nobody pays. Chasing it
meant writing the same awkward text by hand, working out how late it
was, and remembering whether you'd already asked.

**The message is data-layer logic** (data-layer.js, Payment reminders),
so every page words it the same way:
- `thInvoiceReminderText(inv, now)` returns `{ step, body, subject }`.
  It uses the client's first name, the invoice number, and
  `thInvoiceBalance` (so a part payment is already taken off). The due
  date comes from `thInvoiceDueDate`, the same terms rule every money
  view uses.
- When `clientEmail` is set, the message adds the portal's sign-in URL.
  That is the rule `pushInvoicePaidToPortal` already uses for "this
  invoice is on the portal", where the client can pay by card.
- **Step** (`thInvoiceReminderStep`) is one past the last reminder sent,
  and at least 2 once 14 days late or 3 once 30 days late. So a first
  reminder on a very late invoice isn't cheerful, and each one after is
  firmer.
- `thInvoiceNeedsReminder` decides where the button shows: something is
  owed and it's due today or past due. Earlier than that is nagging.

**Logged, not sent.** `thLogInvoiceReminder(id, channel)` appends
`{ at, channel, step }` to `inv.reminders` through `thWrite`, so it syncs.
`thInvoiceRemindedLabel` gives "Reminded 3 days ago" to the Dashboard
row, the invoice row and the job line. The app sends nothing itself: it
builds `sms:` and `mailto:` links.
- The `sms:` separator follows review-request.html: `&body=` on iOS,
  `?body=` elsewhere.
- Copy is the fallback that always works, so it's logged too.

**One sheet, any page** (tools-nav-pwa.js, PAYMENT REMINDER). It rides
on the quick-actions sheet:
- a kicker with the tone, plus a count from the second reminder on;
- who, and what's owed;
- the message in an editable textarea;
- Text / Email / Copy.

A delegated document listener opens it from any `[data-remind-invoice]`
element, so the Dashboard, the job page and the invoice list need no
inline handlers. The phone number comes from the invoice, else the
client registry, else the linked job.

Focus goes to the first send button, not the textarea, so a phone's
keyboard doesn't cover the sheet. Escape closes it and focus returns to
the opener. Sending fires `th-invoice-reminded`, and each page
re-renders its money list on it.

## 2026-09-23 (evening) -- Workspace rework, part 11: Your week

**Why.** Part 9 gave every job a real time record (`timeLog`), but none
of it was visible after the invoice went out. A weekly scoreboard turns
that record into a feel for the business: how many hours, how much work
finished, how much billed.

**`thWeekSummary(now, data)`** (data-layer.js) is pure, given `data`, and
reads storage otherwise:
- **The week** runs Monday to Sunday (`thWeekStart`). Days are built with
  local calendar arithmetic, not by adding 24-hour blocks, so a DST
  change can't shift one.
- **Hours:** each `timeLog` visit counts on the day it started. A running
  clock adds its elapsed time to the day it started too, so today's bar
  grows while you work.
- **Jobs done:** `status === 'done'` with `thJobDoneDate` in the week,
  the same done-date rule as Ready to invoice.
- **Billed:** invoice totals dated in the week, plus income entries whose
  `origin !== 'invoice'`. The income log keeps its own copy of every
  invoice, so counting both would double every bill.
- **Last week:** each figure has a last-week version, computed in the
  same pass.

**Why not "collected".** Invoices carry `paidAmount` but no payment date,
and portal card payments are settled server-side. Any "collected this
week" figure would be a guess. Adding a local `paidAt` on Mark paid would
cover cash and checks from now on, but still not card payments, so it's
left out rather than shown half-right.

**Rendering** (`renderWeekCard` in workspace.html):
- It runs with the rest of `renderDashboard`, and on `th-clock-change`.
- While a clock runs it re-renders once a minute. It's a guarded
  interval that runs only then, the same care job-detail's clock needed
  so a jsdom test that loads the page isn't kept alive.
- Bars scale to the busiest day, with a floor of 4 h, so one short visit
  doesn't read as a full day.
- The chart has a `role="img"` label that reads the whole week ("Mon
  2.5 h, Tue 6 h, … Sun none").

## 2026-09-23 (evening) -- Workspace rework, part 12: texts that write themselves

**Why.** Part 10 wrote the awkward text, the payment reminder. Most texts
a handyman sends aren't awkward, just constant: on my way, running late,
see you tomorrow, all done. Typing each one in the truck is the friction.

**Templates are data-layer logic** (`thJobTextTemplates(job, { eta, now })`
in data-layer.js), so every entry point words them the same way.
- **Stage order:**
  - done: All done;
  - in progress: Running late, Parts run, All done;
  - booked for a later day: Confirm the visit first;
  - booked for today, or with no date: On my way, Running late, then
    Confirm if there's a date.
- **Visit date:** `thJobVisitWhen` says "today", "tomorrow" or "on Friday,
  Sep 25", and nothing for a past date, which drops Confirm.
- **Wording:** only the street part of the address (up to the first
  comma) goes in, and no name gives "Hi, it's Triple H Enterprises."
- **ETA:** one of 10/20/30/45. Anything else falls back to 20.

**Logged on the job:** `thLogJobText` appends `{ at, key }` to `job.texts`,
keeping the last 20, through `thWrite`, so it syncs. `thJobLastText`
feeds the sheet's "On my way sent 12 min ago".

**One sheet** (tools-nav-pwa.js, CLIENT TEXTS) on the reminder sheet's
layout:
- Two chip rows: which text, and the time. The time row hides for texts
  without one. Chips use `aria-pressed`.
- The editable message sits under the chips; switching chips rewrites
  it.
- Send and Copy share part 10's `thSmsHref`.
- A delegated listener opens it from any `[data-text-job]` element, with
  an optional `data-text-kind`, and prevents the click only when the
  sheet actually opened. So job detail's Text and the Dashboard's On my
  way keep working as plain `sms:` links on a page without the data
  layer.
- The Jobs sheet item escapes the client's name, since
  `showQuickActionSheet` renders labels as HTML.

## 2026-09-23 (evening) -- Client portal: service history PDF, cancels that tell Steve, card grid

Connor: "Do them all" (the three follow-ups offered after #355).

**Request withdrawal already existed -- the gap was that it was silent.**
Worth knowing before anyone "adds cancel" again: `cancel-work-order`
(2026-09-19) already let a client cancel a still-`submitted` request.
What it didn't do was tell anyone -- the request just left Steve's
queue. v3 posts "I've cancelled this request in the portal." (+ an
optional reason from a `portalPromptTextarea`) as a client message on
the request's thread. Decided against a new email path: the existing
`on_work_order_message_send_email` trigger already emails
`notification_recipients` for any client message, so the cancel rides
it, and the thread keeps the why. The PATCH is now conditional on
`status=eq.submitted` (+ `return=representation`, 409 on zero rows) so a
cancel racing Steve's own status change can't overwrite it. Past
`submitted`, deliberately NOT a client-side status change (parts may be
ordered, a time held): "Need to cancel?" posts "Please cancel this
request." through the normal client message insert, and Steve confirms.
No tools/ change needed -- the email and thread are the notification.

**Service history PDF** (`portal/jobs.html`). Every job with date, what
was done (linked invoice description + line items), invoice #, amount,
UNPAID flag, active 30-day warranty, and the check-up plan. Same pinned
jsPDF 2.5.1 + SRI as Invoices/Quotes (hash verified against the npm
build). `buildServiceHistory()` is pure and drops any row whose
client_email isn't the signed-in one -- an internal account previewing
the portal can read every client's jobs, and they must never land on
one client's record. Address is "most recent service address" (latest
request, else latest quote); jobs don't carry an address themselves.

**Home cards.** 6-track grid so the last row's two cards share the
width; `:where()` keeps it under the 1200px side-column rules.

Tests: `tests/portal/service-history-pdf.test.js` (pagination checked
against a recording stand-in for jsPDF), additions to
`tests/portal/work-order-cancel.test.js`.

## 2026-09-22 (later still) -- Booking flow, round 1: the whole two weeks at a glance, and a real "you're booked"

Public booking pages only (`booking.html`, `manage-booking.html`, one
link on `index.html`); no Supabase or edge-function change this round.
Branch `claude/booking-flow-picker-and-confirm`.

**One availability fetch, not one per tapped day.** Every picker called
`fetchBookingsForDate()` only after a day was tapped, so visitors tapped
day after day to find anything open. `booking.html` opened on today,
which the 2-hour lead time and afternoon weekday hours usually leave
empty ("No open times this day" was the first thing most people saw).
`get_booking_availability` already takes any range, so the new
`fetchBookingsForRange()` / `computeSlotsByDate()` load all 14 days in
one call. Each day is labeled "N open" / "Full" / "Closed", full days
can't be picked, the picker opens on the first open day, and switching
days is instant. **Why a new file (`js/booking-flow.js`) rather than
more code in `business-hours.js`:** that file is also loaded by
`tools/workspace.html` and precached by the portal service worker, so
any edit would ripple a version bump into `tools/` and both service
workers. `business-hours.js` is byte-identical to before;
`fetchBookingsForDate()` stays for its existing callers and as the
fallback if the new file ever fails to load (both pages degrade to the
old picker rather than erroring).

**Deep links honor the day asked for.** `firstBookableDate()` picks the
requested day if it has room; if not, the nearest open day after it,
then earlier days as a last resort. A visible note says the day was
full. A day tapped while the load is in flight wins once it lands.

**Triage -> booking handoff.** The homepage triage result's Book link
now carries `?service=appliance&note=Dryer: Runs but won't heat`.
`booking.html` skips step 1 and fills the notes (fill-only, control
characters stripped, 300 chars max, a visible "we filled this in"
hint). It's opt-in via `data-triage-book-link` on `index.html` only, as
a small inline delegated listener, so `js/triage.js` is untouched and
the city/service pages that share it are unaffected. Follow-up: those
pages can opt in with the same attribute.

**Step 3 shows what's needed.** Name, phone, address, email (now with a
hint saying why it's worth giving), and "What's going on?" stay visible.
Referral and how-you-heard sit in a "Referred by someone?" disclosure,
with the same ids/names (the Dashboard source breakdown and the $25
ledger read them). It opens by itself when a `?ref=` link filled one in.
The `bSource` select had no styling at all (browser default, ~13px, so
it tripped iOS zoom); now on-theme at 16px.

**The confirmation.** The appointment card, Add to calendar (an `.ics`
with day-before and 2-hour alarms), and a Google Calendar link are
built from the booked slot. The honeypot path renders the identical
screen. Step 4 now jumps into view first: on a phone the check used to
play above the screen, because only steps 1-3 ever scrolled.

**A slot taken at the last second** now says so on step 2, where the
visitor is bounced back to. The message used to stay behind in step 3's
form.

**manage-booking.html.** Same strip (this booking's own slot excluded).
Tapping a time now opens "Move your visit to ...? [Confirm new time]":
a single mis-tap used to move the real appointment and push a
"rescheduled" alert to Steve. The success states use the green drawn
check. Add to calendar is shown for the current time and again for the
new time, with the manage link in the event. The native `alert()` is
now an inline error.

**Tests updated with reasons, not deleted:** the 2026-09-21 race test
now covers the race that can still happen (two overlapping loads, pick
a service then another). The malformed-date test expects the first open
day instead of "today"; it only passed at certain hours before. Two
manage tests click the new confirm button. The four booking test
loaders also eval `booking-flow.js`, the way a browser runs the two tags.

## 2026-09-22 (later still) -- Booking flow, round 3: a manage link for every booker, and the page remembers the visit

`booking.html`, `manage-booking.html`, and one new SQL function
(`sql/booking/add_create_booking_rpc.sql`). Branch
`claude/booking-flow-manage-link`.

**The gap.** A guest's only way to reschedule or cancel online was the
link in the confirmation email. Email is optional, so anyone who booked
with just a phone number could only call. Nobody could reach their
booking from the confirmation screen either. The page inserted straight
into `th_bookings`, and anon has no SELECT on that table (real PII), so
the insert couldn't hand the server-generated `cancel_token` back.

**`create_booking(p_booking jsonb)`.** It does the same insert: the same
row, the same `padded_range` and new-booking push/email triggers, and
the same `no_overlapping_confirmed_bookings` constraint (whose 23P01
the page already turns into "that time was just taken"). It returns
`booking_id` and `manage_token`. The token is still generated by the
column default and can't be set by a client. Handing it to the person
who just created the booking grants nothing their confirmation email
doesn't already carry.

It is stricter than the direct insert on purpose:
- status is always the default `confirmed`
- only the allowlisted columns are read, so `quote_id`/`checkup_id`/
  `job_id`/`reminder_sent_at`/`cancel_token` can't be set
- the times must parse, the visit must end after it starts and run no
  more than 8 hours, and it can't start in the past (5-minute grace for
  clock skew); all of these raise 22023
- a blank name is rejected
- every text field is trimmed and capped at the page's own `maxlength`

It is SECURITY DEFINER because the RETURNING has to read the new row,
the same class as the other booking token functions. The advisor will
list it under 0028/0029, which is expected.

**The page falls back on a 404.** If the function isn't there (not yet
applied, or rolled back), `submitBooking()` retries the original direct
insert with the identical payload. A 404 can never mean a booking was
created, so the fallback can't double-book. The direct-insert policy is
unchanged: the Dev Tools booking test and the service-role portal
schedulers still use it. Deploy order is therefore forgiving, but the
function should be applied before this merges so every booker gets the
link from day one.

**On the confirmation screen.** "Plans change? Reschedule or cancel this
visit anytime." appears under the appointment card. The calendar file
and Google Calendar link now carry the manage link too. The no-email
note points at that link instead of only "call or text us anytime to
reschedule or cancel".

**The page remembers the visit.** `th_upcoming_booking` in localStorage
holds `{token, title, start, end, savedAt}` and nothing else: no name,
phone or address. Coming back to `booking.html` shows "You're already
booked: Appliance Repair, Wednesday at 2:00 PM, Reschedule or cancel",
instead of a blank form that invites booking twice. The banner is
checked against the server (`get_booking_by_cancel_token`) before
anything shows:
- a visit cancelled some other way (a call, the email link on another
  device) is forgotten
- a past visit is forgotten
- a failed lookup shows nothing and keeps the record
- "Not you? Forget this device" clears it on shared devices

`manage-booking.html` updates the record on a reschedule and clears it
on a cancel.

**Tests updated with reasons, not deleted:** the booking test mocks now
answer `/rpc/create_booking` as well as the direct insert. The
lead-source and UTM tests that sliced the old inline `fetch(...
th_bookings` now slice the `bookingPayload` build, plus a new assertion
that `submitBooking()` sends that same payload down both paths. New:
`tests/booking/booking-manage-link-round3.test.js` (12). The function
was exercised live inside rolled-back transactions as anon:
- it forces `confirmed`
- it ignores a smuggled `quote_id`/`reminder_sent_at`
- it trims the name and stores an empty email as null
- error codes: 23P01 on an overlap or the buffer, 22023 on validation,
  23502 on a missing service

Nothing persisted.

## 2026-09-22 (later still) -- Booking flow, round 4: the portal's three self-scheduling spots get the same picker

Booking-specific portal code only: the job scheduler on `quotes.html`
(schedule on approval), the check-up booker on `jobs.html`, and the
preferred-time picker on `work-orders.html`. Plus `js/booking-flow.js`
and one label change that also shows on `booking.html` and
`manage-booking.html`. Branch `claude/booking-flow-portal-pickers`.

**The gap.** Round 1 fixed the public picker. The portal's three
schedulers each still carried their own copy of the original one: a
bare date strip, one fetch per tapped day with "Loading times..." every
time, and no way to see which day had room. `work-orders.html` opened
on today, which the 2-hour lead time and afternoon hours usually leave
empty.

**`createBookingPicker()`** (`js/booking-flow.js`) writes that behavior
once:
- one `fetchBookingsForRange()` call for the strip
- every day labeled, and full or closed days can't be picked
- it opens on the first day with room, and switching days is instant
- a skeleton while loading
- an error with Try again; after a failed window load, a tapped day
  falls back to the old one-day fetch
- a stale-response guard
- a second picker on the same strip (a panel closed and reopened before
  its load landed) retires the first, so two instances can never write
  into one strip

The page still owns everything after a pick (`onSelect`/`onClear`): the
summary line, the Confirm button, the stored preference. So the
schedule-quote-job and schedule-checkup-visit calls and the work order's
`preferred_slot_at` are unchanged. The browser run below checked the
two scheduling calls' payloads, and the existing work-order tests
cover `preferred_slot_at`.
Each page checks `typeof createBookingPicker === 'function'` and
otherwise runs its original picker, left exactly as it was.

**A cross-booking bug, fixed in passing.** `quotes.html` and `jobs.html`
keep one page-wide `selectedScheduleSlot`/`selectedCheckupSlot`. With
two approved quotes' (or two due check-ups') panels open, a time tapped
in the second panel became the time the FIRST panel's still-visible
Confirm button would book. Now:
- picking in one panel withdraws the other panel's choice
- a day change in one panel never wipes the other's choice
- Confirm refuses a slot picked for a different panel

**The "you're booked" moment in the portal.** After scheduling from a
quote, the list re-renders, so the panel the client tapped in is gone.
On a phone the new "Job scheduled" card could land off screen. Now:
- the card is scrolled into view and tinted with the existing
  `.is-highlighted` pulse
- it gets `bookingCelebrate()`'s burst and haptic tap
- a toast says "Scheduled. A confirmation email is on its way."
  (schedule-quote-job sends the client's email, so the confirmation
  goes out)

The re-render is deliberately not awaited inside the `try`: the job is
already scheduled, so a render hiccup must never read as "Couldn't
reach the server" with Confirm live again. After a check-up booking,
the "Visit booked" banner (now `data-checkup-id` for lookup) gets the
same, after the existing toast.

**"No times" instead of "Full".** `computeSlotsByDate()` now also flags
`noTimes`: an open day with nothing bookable even with nothing booked,
i.e. today once its hours (less the lead time) are used up. An evening
visitor used to see today marked "Full", as if booked solid. This shows
on `booking.html` and `manage-booking.html` too. A booked-solid day is
still "Full", and an entry without the flag keeps its old label.

**Deliberately not touched:**
- `home.html`'s upcoming-visit card already shows the countdown, Add to
  calendar and the manage link.
- `portal/service-worker.js` only got the checker's automatic
  CACHE_NAME bump, since three precached pages changed.
  `/js/booking-flow.js` isn't added to PRECACHE_URLS: that file is
  outside this pass's scope, and as a `?v=` asset it's cached
  cache-first on first use anyway. Follow-up for the portal owner:
  precache it alongside `/js/business-hours.js`.
- The picker CSS is page-local on all three pages, matching where this
  picker's CSS already lived. Follow-up: consolidate into
  `portal-polish.css`.

**Tests:** `tests/portal/booking-picker-round4.test.js` (27):
- the picker's behavior in jsdom: one fetch, labels, first open day, no
  refetch, full days, the fallback, Try again, nothing open, the stale
  guard, and a tap during loading
- the three pages' wiring and fallbacks
- the two-panel guard, run against the pages' own functions
- both celebrations

Mutation-checked: removing the stale guard or the Confirm guard fails
them. Existing portal scheduling tests pass unchanged. Driven in
headless Chromium at 390px and 1440px against a fake Supabase client,
through pick, confirm and the celebration on all three pages, plus each
page with `booking-flow.js` blocked (the original picker still books):
no page errors, no horizontal overflow.

## 2026-09-23 -- Booking flow, round 2: the guest hears about every change, reminders follow a moved visit, and push stays private

Edge functions and SQL only: `send-booking-email`, `send-appointment-reminder`, `Send-Push`, and the six notification functions, plus `sql/booking/add_booking_change_emails_and_reminder_rearm.sql` and `sql/security/scope_push_broadcasts_to_internal_accounts.sql`. No page changes. Branch `claude/booking-flow-notifications`.

**A moved visit re-arms its reminder.** `send-appointment-reminder` only emails bookings whose `reminder_sent_at` is null, and nothing ever cleared it. A guest reminded Monday about Tuesday who then moved to Friday never heard about Friday. `track_booking_changes()`, the existing BEFORE UPDATE trigger that already stamps `reschedule_count` on exactly this transition, now also clears `reminder_sent_at`.

**Reschedule and cancel emails.** The only guest email used to be the INSERT-time confirmation, so a guest's inbox kept showing the OLD time.
- A new AFTER UPDATE trigger, `on_booking_change_send_email`, posts the same UPDATE payload shape Send-Push's booking trigger uses to `send-booking-email`.
- Its WHEN clause gates it to the two real transitions: confirmed → cancelled, or a confirmed booking's `start_at` moving.
- Any other update (the reminder stamp, a job conversion) never fires it.
- The function re-checks the transition and sends:
  - a move: the guest gets "Your visit has moved" (old time struck through, fresh `.ics`), staff get "Booking moved"
  - a cancel: the guest gets "Your visit is cancelled", staff get "Booking cancelled"
  - anything else: `{ok:true, skipped:true}`

It's a separate trigger rather than more code in `notify_booking_status_change`, so a Resend problem and a push problem stay independent failure modes. There's deliberately no REVOKE on the trigger function (the 2026-08-13 `notify_new_lead` incident).

**Calendar files and a push in the reminder.**
- The confirmation, move and reminder emails attach an `.ics`: two alarms on the confirmation, one 2-hour alarm on the reminder. If Resend rejects the attachment, the email is retried without it.
- They also carry an Add-to-Google-Calendar link.
- The reminder also sends a portal push ("Tomorrow: <service>") when the booker has a portal account.
- The order is email → `reminder_sent_at` → push, so a push failure can never cause a duplicate email.

**Caller checks.** `send-booking-email` and `send-appointment-reminder` now require the service-role bearer (the Vault key their only callers send) before reading the payload, with the same empty-key guard as #363. This closes the audit's booking-lane item #8.

**Push privacy** (requested directly: "the internal alerts go to every push subscriber"):
- **Internal broadcasts.** Send-Push's "broadcast to the team" read every `push_subscriptions` row. The moment a client turned on portal push, they would have started receiving new-lead and new-booking names, overdue invoices by client name, and the weekly revenue digest.
  - It now calls `get_internal_push_subscriptions()`, which returns only subscriptions whose account email is in `account_roles`.
  - It fails CLOSED: a lookup error sends to nobody.
  - A side-effect-free `audience-check` type reports `{internal, total}` for verification.
- **Client pushes went to the wrong person.** Six functions (invoice, quote, contract, work-order scheduled, job message, work-order message) looked up a client's user id with `GET /auth/v1/admin/users?email=`.
  - GoTrue's admin list endpoint has no `email` filter. It returned the newest users, and `users[0]` was whoever signed up last.
  - They now call `get_auth_user_id_by_email()`: an exact, case-insensitive match that returns null when there's no account.
  - Both functions are SECURITY DEFINER and service-role-only, explicitly revoked from public, anon and authenticated.

Neither bug had fired: all 6 current subscriptions belong to the 2 internal accounts. Either would have fired on a client's first push.

**Also ships (already merged to `main`, never deployed):**
- Send-Push's 2026-09-17 caller check (audit item #3), now with the empty-key guard
- `send-booking-email`'s 2026-09-19 green checkmark (#307)
- #363's caller checks on the two work-order functions (`notify-job-message-email`'s is already live)

Every Send-Push caller was re-checked before deploy. The 4 trigger functions and 2 cron jobs in the live database all read the Vault `send_push_service_role_key` (no literal JWTs). Every edge-function caller sends its env `SUPABASE_SERVICE_ROLE_KEY`. No browser page or workflow calls it; Dev Tools goes through the trigger on purpose.

**Deploy order, run after this merges** (each step is verified by fetching the live source and diffing it against `main`; the results are recorded in a follow-up entry):
1. The security SQL.
2. Send-Push, confirmed with an anon → 401 probe and a Vault-key `audience-check` call.
3. The six functions.
4. `send-booking-email` (anon → 401, and an UPDATE non-transition → `skipped`).
5. Then the trigger migration. The function must exist first, because the old version answered an UPDATE payload with a harmless 400 and sent nothing.
6. `send-appointment-reminder` last.

**Tests:** `tests/edge-functions/booking-notifications-round2.test.js` (23, plus an empty-key-guard assertion). They run the real handlers with a mocked `Deno` and `fetch`, covering the transitions, the ordering, the attachment retry and the fail-closed broadcast. Updated with reasons: `push-remaining-triggers` and `push-notifications` now expect the RPC lookup instead of `admin/users`. All nine functions were syntax-checked as ES modules after TypeScript stripping. The trigger migration was exercised live in rolled-back transactions:
- an insert queues 2 requests
- a reminder stamp or job link queues 0
- a reschedule queues +2 and clears `reminder_sent_at`
- a cancel queues +2

## 2026-09-23 -- note from the visual lane: one smooth scroll in the booking hand-off ignores reduced motion

- `index.html`'s service modal ("Request this service") runs `document.getElementById('schedule').scrollIntoView({behavior:'smooth'})`. An explicit `'smooth'` in script overrides the CSS `scroll-behavior:auto` reset, so reduced-motion visitors still get the animated scroll.
- The fix is one line: `const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;` and then `behavior: reduced ? 'auto' : 'smooth'`. That's the same fix the visual lane applied to back-to-top and the triage result.
- It's left for the booking lane because it's in the booking entry point. `tests/design/reduced-motion-coverage.test.js` allowlists this one call, so fixing it won't break that test.

## 2026-09-23 -- Shift clock, part 1: the data layer (Start my day / End my day)

Connor asked for a whole-shift punch clock, like Paylocity: clock in for
the day, clock out at the end, not tied to any job. It sits **beside**
part 9's job clock. It doesn't replace it.

**Why a second clock, not a replacement.** The job clock answers "how
long did this job take" (job costing, the invoice's Labor line). A shift
answers "how long did I work today", including driving, estimates and
the time between jobs, none of which the job clock sees. The business is
still paid per job (`careers.html`: "Pay is per completed job, not
hourly"), so this is an attendance number, never pay. Replacing the job
clock would have been a business-model call; nothing points that way.

**Storage** (data-layer.js, Shift clock section; synced key
`th_shift_log`, tombstones `th_shift_tombstones`):
- One record per shift: `{ id, email, start, end, hours }`. `startSource`
  / `endSource` ('entered', or 'job-clock' for a back-dated start) and
  `editedBy` (someone else changed it) are stored only when they apply.
  The whole blob is pushed on every edit, so plain punches stay small.
- **A list of records, not an object keyed by email.** `applySyncData`
  overwrites a plain object whole, so two people punching in on two
  phones before either synced would erase each other. A record array
  merges per record and per field (tested: two people, two devices).
- On shift means `end === null`: null, never deleted, for the same merge
  reason as `clockSince`.
- Hours use the job clock's own `thClockHours` (0.1 h; under a minute is
  a mis-tap and counts 0) and land on the day the shift started, like
  Your week's job visits. An overnight call counts on the day it began.
- **Whose shift** comes from the stored session's email, read the way
  `tools-tour.js` does, because `getCurrentUserEmail()` returns null
  whenever the hourly access token has expired.

**Forgotten End my day.** `TH_SHIFT_MAX_HOURS = 14`. A shift still open
past that "needs an end time":
- It counts **0 h**. Not 24, and not capped at 14, which would still be
  wrong by hours.
- `thEndShift` without an entered time returns `{ needsEnd }` rather than
  recording now, and `thStartShift` returns `{ needsEnd }` while one is
  waiting, so the UI must ask "when did you finish?" first.
- `thShiftSuggestedEnd` offers when the last job clock inside that shift
  stopped: real evidence, not a guess.
- Typed-in times are checked by `thShiftTimesProblem`: the end must be
  after the start, nothing in the future, at most 24 h, and no overlap
  with that person's other shifts. Messages are in plain words.
- Two devices that each started a shift offline: the latest open one is
  current, and the older one needs an end time (or delete it).

**Independent of the job clock.** Neither needs, starts or stops the
other (tested):
- Gating the job clock on a shift would cost a job its billable hours
  the day someone forgets to punch in.
- End my day doesn't stop a running job clock. The job clock isn't
  anyone's in particular: one runs at a time for the whole business and
  nothing records who started it, so stopping "yours" could stop a
  helper's.
- Forgot to punch in: `thShiftSuggestedStart` offers the first job-clock
  start of the day (after your last shift ended) as a back-dated start.
  It's only offered, never applied.

**Totals** for the Dashboard (part 3):
- `thShiftWeekSummary(email, now)`: Mon–Sun via `thWeekStart`, with last
  week, today, on shift and since, plus the shifts that need an end time.
- `thShiftTeamSummary(now)`: everyone with hours this week or last, on
  shift, or waiting on an end time.

**Also:**
- `thEditShift`, `thDeleteShift` (tombstone + Graveyard copy, and Dev
  Tools' Graveyard can label and restore a `shift`), `thUndoEndShift`
  (refused once a newer shift has started).
- Every write dispatches `th-shift-change`.

**Not done here, on purpose:**
- **Who sees the team's hours:** the plan is `canViewFinance()` (Owner
  and Developer by default, toggleable per account). A separate
  permission would need an `account_roles` column.
- **Privacy:** the blob reaches every signed-in internal account's
  device, like finance data does, so hiding the team view is UI-only.
- **Retention:** the log is small (roughly 50 KB per person per year) but
  never pruned; the job clock's `timeLog` is the same.
- **The job clock isn't per-person** (one at a time, business-wide). That
  predates this and is unchanged. It's worth a look if a helper starts
  using the app day to day.

Tests: `tests/tools/shift-clock.test.js` (18). `tombstone-retention.test.js`
now counts 15 tombstone functions (it pins the count so each new one is
checked for pruning). `job-clock.test.js` and `your-week.test.js` are
untouched and pass.

## 2026-09-23 -- Shift clock, part 2: Start my day / End my day in the app shell

Part 1 (#385) was the data layer. This is the button and the sheet.

**Where it lives** (tools-nav-pwa.js, SHIFT CLOCK, right after ON THE
CLOCK):
- **Phone and tablet:** a clock button leads `.th-hdr-actions`, before
  Search and More, since the header is the one place every page shares.
  - Off: a plain circle.
  - On shift: a green pill with the start time, with no seconds ticking.
    "At a glance" was the ask, and a ticking clock would compete with the
    job clock's bar.
  - Needs an end time: an amber dot.
- **Desktop:** a row under New in the sidebar ("On shift · since 7:42 AM"),
  a `<button>` styled like the Search row beside it.
- **Why not a second floating bar:** the bottom of a phone already holds
  the nav plus the job clock's bar, and stacking a third band would eat
  the screen. The job clock is orange, moving and at the bottom; the
  shift is green, still and at the top. They read as two different
  things.

**One sheet, three modes**, chosen fresh each time it opens, and it
re-renders in place:
- **Needs an end time** comes first ("When did you finish?"). It offers
  the job-clock suggestion (`thShiftSuggestedEnd`) as the main button, a
  `datetime-local` field bounded by the shift's start and start + 24 h,
  and "It was a mistake: delete this shift" (confirm, tombstone,
  Graveyard). There is deliberately no "End now", which would record 26
  hours. Saving one moves straight on to the next, or to Start my day, so
  the morning after a forgotten punch-out is one flow.
- **On shift:** End my day, or "Finished earlier?" with a time field.
  Ending shows an Undo toast (`thUndoEndShift`). A running job clock gets
  a note ("keeps running: ending your day doesn't stop it"); it isn't
  stopped, per part 1's reasoning (the job clock isn't anyone's in
  particular).
- **Off:** Start now, "Start from 8:12 AM, when you started the clock on
  Fence" when there's one (`thShiftSuggestedStart`), or "Started earlier?"
  with a time field.

**Typed times of day** (`thShiftTimeInputMs`) mean the latest time it
was, at or before now: 11:30 PM typed at 1 AM is last night. Every
validation message comes from the data layer's `thShiftTimesProblem`
and shows in a `role="alert"` line. Enter in a field presses its button.
Focus goes to the main button, not a field, so a phone keyboard doesn't
cover the sheet (same as the reminder sheet).

**Pages without data-layer.js** (Route Planner, Parts, Settings, Runway):
- `thShiftStatus` reads `th_shift_log` and the stored session directly,
  with the same 14-hour and duplicate-shift rules.
- The button opens `/tools/workspace.html#shift`, and the shell opens the
  sheet there on arrival, then clears the hash. That's the job clock's
  pattern (its Stop opens the job there).

**Runway Dashboard** mirrors the header and sidebar CSS only. Its button
goes to the Dashboard, so it needs no sheet styles.

**Dashboard header at 390px:** the green pill makes its header wrap to a
second row while on shift (it already wraps at 360px). Part 3's Dashboard
card is the place to decide whether the Dashboard shows the header button
at all, the way the job clock's bar hides on its own job's page.

Tests: `tests/tools/shift-clock-shell.test.js` (14, jsdom, the same page
harness as `job-clock.test.js`).

## 2026-09-23 -- Shift clock, part 3: Hours worked on the Dashboard, and the team view

Parts 1 and 2 were the data layer and the shell's button and sheet. This
part surfaces the totals.

**Where:** `#shiftCard`, directly under Your week (`workspace.html`,
`renderShiftCard()`). It reuses Your week's layout classes (`week-card`,
`week-bar*`, `week-stat*`) so the two read as a pair, but in the shift
clock's green. Orange stays the job clock's colour, so "On the clock" (job
time, Your week) and "Hours worked" (whole shifts) can't be mistaken for
each other. Your week and its tests are untouched.

**What it shows:**
- **The day, with its one button**, which opens the shell's shift sheet:
  - Not clocked in: Start my day.
  - On shift since 7:42 AM, "2 h 18 min so far": End my day. While on
    shift the card re-renders once a minute, in a guarded interval like
    Your week's.
  - A shift that needs an end time: Fix it.
- Seven bars Mon–Sun (`thShiftWeekSummary`), then Today and This week,
  with last week under it.
- A hint on an empty week that says what counts (driving, estimates, the
  time between jobs).

**Team view** (`thShiftTeamSummary`): a table of Who / Today / This week /
Last week, on shift first:
- It shows only when `canViewFinance()` is true. It **fails closed**,
  unlike Your week's Billed, which shows before the role loads, because
  it's other people's hours, not the business's own numbers. The card
  re-renders on `th-role-loaded`.
- It shows only once someone other than you has a shift; otherwise it
  would repeat your own numbers.
- Names use your first name for you, and otherwise the email's first
  word, capitalized ("mike.helper@..." shows as "Mike").
- A shift that needs an end time says so and counts 0 h, so a helper's
  forgotten punch-out shows as a flag, not a 24-hour day.
- **Read-only on purpose.** Fixing a shift is its owner's job, from
  their own sheet. An owner editing someone else's times would need the
  sheet to take an email and a permission check; `thEditShift` already
  records `editedBy` for that day.

**The Dashboard's header button stays.** Part 2 left open whether the
Dashboard should hide it, the way the job clock's bar hides on its own
job's page. It stays: on a phone the card sits below the fold, so the
header is the only at-a-glance status on the Dashboard too. The cost is
the header wrapping to a second row at 390px while on shift, as it
already does at 360px.

**Owner decision logged** in `docs/ACTION-ITEMS.md` (#14): who sees the
team's hours. Today that's the finance permission, and a separate
permission would be a small follow-up.

Tests: `tests/tools/shift-hours-card.test.js` (8).

## 2026-09-23 -- booking-flow round 2 is live: deploy results

Round 2 (#369) was deployed from `main` in the order its entry above lays out. Every function was re-fetched after deploy and diffed against `main`.

**Byte-for-byte identical to `main`,** with one known exception: a Unicode escape written with a backslash-u in the source arrives as the literal character. That's the middle dot in Send-Push and the en dash in `send-booking-email`, both inside string/template literals, so the runtime strings are the same.

| Function | Live | Probes |
|---|---|---|
| `Send-Push` | v53 | anon → 401; Vault-key `audience-check` (earlier) |
| `send-invoice-notification`, `send-quote-notification`, `send-contract-notification` | v23, v22, v5 | diff only (their user-session check is unchanged) |
| `notify-work-order-scheduled-email`, `notify-job-message-email`, `notify-work-order-message-email` | v13, v7, v15 | anon → 401 `Unauthorized`; Vault key + unknown payload → 400 `Unknown type`, so the triggers' key passes |
| `send-booking-email` | v17 | anon → 401; Vault-key UPDATE that isn't a transition → `{ok:true, skipped:true}` (only the new code answers that way) |
| `send-appointment-reminder` | v5 | anon → 401; Vault key → `{ok:true, checked:0, sent:0, pushed:0}` (`pushed` is new) |

Several of these later picked up version bumps with no source change, during the security lane's own deploy pass. Every one was re-fetched and re-diffed afterwards: still identical to `main`.

**Trigger migration** (`add_booking_change_emails_and_reminder_rearm`), applied after `send-booking-email`. One change first:
- **The revoke.** The file said "deliberately NO revoke on this trigger function, matching the existing" booking trigger functions. That stopped being true on 2026-09-21: every trigger function in `public` is now EXECUTE-able by postgres and service_role only. Left as written, the new function would have been the one exception, EXECUTE-able by anon.
- **Why it's safe.** Postgres checks EXECUTE on a trigger function only at CREATE TRIGGER, never when it fires. Proven on the live project first, in a rolled-back block: a trigger whose function had EXECUTE revoked still fired for an insert running as `authenticated`.
- **The file now matches what was applied.** It revokes from public, anon and authenticated and grants service_role. The test that asserted "no revoke" now asserts the lockdown instead, with the reason.

**Live check after applying:**
- `on_booking_change_send_email` is enabled with the WHEN clause as written.
- Both functions are postgres/service_role only.
- `track_booking_changes()` clears `reminder_sent_at` in the reschedule branch.

**End to end, in a rolled-back block** (pg_net only sends after commit, so nothing went out; the table and queue were empty afterwards):
- an insert queues `send-booking-email:INSERT` and `Send-Push:INSERT`;
- a reminder stamp queues nothing;
- a reschedule queues `send-booking-email:UPDATE` and `Send-Push:UPDATE`, clears `reminder_sent_at` and sets `reschedule_count` to 1. The payload carries both the old and new start time, with the Vault key;
- a cancel queues both and sets `cancelled_at`.

**Security advisors afterwards:** nothing new. Neither new function nor either lookup function is flagged. The anon-executable findings are pre-existing:
- the booking RPCs, which are public on purpose (the booking page is anonymous and token-gated);
- the MFA recovery-code functions, which are the security lane's.

**Also in this PR:** the visual lane's hand-off above is fixed. `index.html`'s "or schedule online" now scrolls with `behavior: reduced ? 'auto' : 'smooth'`. New test: `tests/booking/booking-entry-reduced-motion.test.js` (2, both fail against the old line). It clicks a service card and then the hand-off in jsdom, and checks the scroll behavior, that focus lands on `#name` and that the service is carried over. `reduced-motion-coverage.test.js`'s `BOOKING_LANE` allowlist entry no longer matches anything, so it can be dropped.

**Also:** `booking-notifications-round2.test.js`'s lookup-SQL test now uses plain substring checks. That closes the CodeQL "incomplete string escaping" alert from #369.

## 2026-09-23 -- booking-flow follow-ups: direct-insert lockdown, triage hand-off on every page, one copy of the picker CSS

The follow-ups the earlier rounds left, done on request ("do the remaining items").

**1. The public can no longer insert bookings directly** (`sql/booking/restrict_direct_booking_inserts.sql`, applied live).
- **The problem.** `th_bookings` kept its original "Anyone can submit a booking" policy (anon + authenticated, `with check (true)`). With the public anon key, a direct insert could set ANY column: a row that's already `cancelled`, a `job_id`/`quote_id`/`checkup_id` pointing at someone else's record, a stamped `reminder_sent_at` so no reminder goes out. It also skipped every check `create_booking()` makes. Any signed-in client account could do the same.
- **The fix.** That policy is gone. A new "Staff can add bookings directly" policy (authenticated + an `account_roles` email, the same test as the table's other three policies) keeps the Dev Tools booking test working. Everyone else books through `create_booking()`.
- **Who still works:**
  - `booking.html`, which has used the RPC since round 3; Pages had deployed that version long before;
  - the portal's two scheduling functions (service role);
  - the Dev Tools test (a staff session).
  A new repo scan test pins that these are the only direct inserts.
- **Checked live, before and after:**
  - Before, in a rolled-back block: anon inserted a pre-cancelled row, and a non-staff account inserted too.
  - The same block with the new policy applied inside it, and again after it was committed: anon direct → 42501, anon RPC → OK with the manage token, client direct → 42501, client RPC → OK, staff direct → allowed, service role → allowed.
  - A real HTTP insert with the anon key → 401 `new row violates row-level security policy`. It was sent with a null name, so it could never have created a row.
  - `th_bookings` is still empty; advisors show nothing new.
- **Rolling back.** `booking.html`'s direct insert still only runs when `create_booking()` answers 404 (missing). The SQL file says that dropping the function must restore the old policy in the same change, and carries it commented out.

**2. The triage hand-off now works on the city and service pages too.** In round 1, the homepage triage tool's "or book a visit online" learned to carry the tapped appliance + symptom into `booking.html`. That lived in an inline homepage script.
- It moved into `js/triage.js`, still opt-in via `data-triage-book-link`.
- The triage result's Book link on all 12 other pages that load `triage.js` (8 city, 4 service) is now marked.
- New tests run the real `triage.js` on all 13 real pages in jsdom: tap Dryer → "Runs but won't heat" → the link carries both; tap another appliance → back to the plain link. A page without the marker keeps its links untouched. All 13 fail against the old `triage.js`.

**3. The portal picker CSS has one copy.**
- **What moved.** The styles for `createBookingPicker()`'s labels, unavailable days, skeletons and messages sat as an identical 15-line page-local block on `quotes.html`, `jobs.html` and `work-orders.html`. They're now section 25 of `portal-polish.css`, and no other portal page uses those classes.
- **Proven unchanged.** Every computed property of all 729 picker elements was captured in Chromium on each page in four states: loading, loaded, error, and loading with reduced motion. Main and this branch match exactly, except `opacity` on the pulsing skeletons, which differs in the 4th decimal: the animation sampled a few milliseconds apart. The reduced-motion captures, where nothing animates, are identical.

**Dropped, with reason: precaching `booking-flow.js` in the portal service worker.**
- **It wouldn't be used.** The pages load `booking-flow.js?v=…`, and the worker matches `?v=` requests by exact URL, so a bare-path precache entry is never served. The file is already cached on first use.
- **It would cost something.** Listing it would fold it into the precache fingerprint, forcing an "update available" prompt in every installed portal app whenever the file changes.

**Also in this PR:** the Dev Tools booking-test copy (next entry). It was held until the shift-clock work (#385) landed, so as not to hand that session merge conflicts while it was editing `tools/dev-tools.html` and the tools service worker.

## 2026-09-23 -- Dev Tools booking test: the copy says what it really sends

The last booking-flow follow-up. It waited until the shift-clock work (#385) had landed, because that PR was editing `tools/dev-tools.html` and the tools service worker.

- **The problem.** Since round 2, the test's reschedule and cancel steps also send staff a "Booking moved" / "Booking cancelled" email. Its description and step labels still said "rescheduled push" / "cancelled push", so the two extra emails from a test run looked unexplained.
- **The fix.** `tools/dev-tools-shared.js` (the "?" description) now names each step's push and staff email. It says the test booking has no email address, so no guest email goes out, and that the test writes the booking as the staff account (since the direct-insert lockdown, only staff may). `tools/dev-tools.html`'s three step labels match.
- **Mechanical.** fix-versions re-stamped `dev-tools-shared.js` where it loads and bumped the tools service worker's cache name.
- **New test:** `tests/dev-tools/booking-test-copy.test.js` (3).

## 2026-09-23 -- Shift clock, part 4: Your week and Hours worked are one card

The owner's feedback on part 3: the two Dashboard cards were "basically the
same" and took two screens on a phone. They're now one card, Your week
(`renderWeekCard()` in `workspace.html`). `#shiftCard`, `renderShiftCard()`
and its interval are gone.

**What the card shows:**
- **The day's status and its one button** at the top, when you're signed
  in: Start my day, "On shift since 7:42 AM" with End my day, or Fix it for
  a shift that needs an end time. The button opens the shell's shift sheet,
  as before.
- **One bar pair per day** once the week has shift hours: green for hours
  worked (the whole shift), and a narrower orange bar in front of it for
  time on the clock (job time). A small legend says which is which. With
  no shift hours the bars are the old job-only orange, so someone who
  never punches in sees exactly the card they had.
- **Stats:** Worked, On the clock, Jobs done, and Billed (finance only).
  Four stats sit in one row on a laptop and a 2x2 grid on a phone.
- **The team view** is now a fold-away "Everyone this week" under the
  stats, closed by default and still finance-only (fails closed). It stays
  open across the card's once-a-minute refresh.

**Unchanged:** the job clock and every number Your week showed before.
`your-week.test.js` passes with only its fake element updated (the card
now toggles a class and wires its buttons once).

Tests: `tests/tools/shift-week-card.test.js` (9) replaces
`shift-hours-card.test.js`.

## 2026-09-23 -- Site content editor: checked, reviewed, undoable; Google rating + review count move into it

The owner can now change the Google rating and review count (plus banners, homepage hours, phone, email) from `tools/site-content.html` with no branch, PR, or deploy. Everything after this PR merges bypasses review by design, so the safety lives in the tool and the database, not in CI.

**Audit first (why this shape):**
- Already CMS-backed: phone/email (most pages), hours (index only), banner1/banner2, FAQ (index), Terms (index + terms.html).
- Hardcoded: rating/count in 11 spots across 5 files; the WELCOME15 promo and hiring banners (`js/promo-banner.js`, `js/hiring-banner.js`), which write into the SAME `#siteBanner1/2` slots a CMS banner overwrites; ~60 policy-amount mentions ($25 referral/trip fee, $50 cancellation); booking hours in `js/business-hours.js`.
- The old editor: "Save all" wrote all 11 fields every time (a stale tab silently reverted newer edits), no validation (an email went live as Banner 2 for 6 seconds on 2026-08-16 -- it's in `site_content_history`), history only logged UPDATEs, restore was a blind upsert. FAQ/Terms "Save all" deletes and re-inserts every row, so their restore-by-id is broken (PR C).
- No revisions table existed anywhere. The Graveyard pattern (snapshot + tombstone in the synced blob) was the reference, but it has its own restore bug (restores are undone by the next push -- see bugfix.md), so the idea (keep history, never blindly overwrite) was reused, the storage was not: history lives server-side in `site_content_history`.

**Decisions:**
- **Database is the last line of defense, not the page.** `sql/site-content/cms_safe_publish_and_undo.sql`: a CHECK constraint (`site_content_value_is_valid`) refuses bad values from any writer; `cms_publish_content(changes)` is all-or-nothing with a compare-and-swap per field (PT409 -> HTTP 409 on a stale "expected"); `cms_undo_content(ids)` reverts a save's batch only if nothing changed since. Both are SECURITY INVOKER, so the existing `can_manage_site_content` RLS still decides who writes. Only existing keys are writable -- a new field ships with a migration.
- **One save = one batch.** The trigger now logs insert/update/delete with `batch_id` (from a transaction-local setting, minted by the first row if a write didn't come through the RPCs) and `undo_of`.
- **Tests run the real SQL.** PGlite (Postgres compiled to WASM) is a new devDependency; `tests/site-content/cms-db-harness.js` rebuilds the live schema + RLS around the real migration file. The editor tests run the page's real inline script in jsdom against it, so save -> undo -> original is proven through browser code AND database code together. One shared instance per file, reset from a snapshot per test (a fresh boot or `clone()` per test took 95s; this takes 4s).
- **Rating/count hooks never add elements.** An extra `<span>` around "7" shifted the following text by a sub-pixel on booking.html (real screenshot diff, 348 pixels). So `.js-review-text` goes on the element that already held the phrase, and `js/review-stats.js` rewrites only the "X from Y Google reviews" phrase inside its existing text node, only when the value differs. Result: 20/20 before/after element screenshots byte-identical at today's 5.0/7.
- **Search data follows the visible value** (FAQPage precedent): `aggregateRating` is rewritten from the same validated values. The static HTML keeps real values as a fallback.
- **Below 5.0 the stats label changes** to "Real Google Reviews" (the "5-Star" wording would be false) and the stars round. No change at 5.0.
- **Left in code on purpose:** policy amounts (a policy change touches Terms + referral logic, not a CMS field), booking hours (drive real slot availability; the editor says so).
- **Kept the four access layers** (page gate, RLS, MFA, dev password) -- none loosened.

**Next (PR B/C):** promo + hiring banner copy into the CMS without re-introducing the CLS the synchronous banner scripts fixed; the banner-slot collision; banners on pages that skip them; FAQ/Terms in-place save with the same review + undo; a gated "Website" nav entry so the owner doesn't go through Dev Tools; phone hooks on booking/manage-*/404.

## 2026-09-23 -- Website nav entry for site-content managers

Follow-up to the site content editor rebuild (#395), which listed "a gated 'Website' nav entry so the owner doesn't go through Dev Tools" as next.

- **Where:** one `SIDEBAR_DESTS` row in `tools/tools-nav-pwa.js` (`/tools/site-content.html`, globe icon, label "Website", Office group between Appliance Wiki and Dev Tools). `MORE_DESTS` derives from it, so the phone/tablet More drawer gets it too. The bottom bar's five slots are unchanged.
- **Gate:** `NAV_PERMISSION_CHECKS['/tools/site-content.html']` calls `canManageSiteContent()`, the same check `site-content.html` uses (reads `account_roles.can_manage_site_content`). No separate or looser check.
- **Why it fails closed when the other rows don't:** every other gated row is drawn visible and hidden on `th-role-loaded`. That flashes for a moment before the role arrives, and stays visible on a page whose role never loads. The ask was "accounts without the permission must not see it at all", so the row is marked `hideUntilAllowed: true`. It is injected with `style="display: none"` (the same hiding mechanism, which the drawer's focus selector already skips) and `hideRestrictedNavLinks()` shows or hides it on every role load. The existing rows were left fail-open on purpose. Switching them is a separate call: it would add a delay before every gated row appears for accounts that can use it.
- **Scoped to shell links:** hideUntilAllowed rows only touch `.th-sidebar-link` / `.th-more-sheet-link`, so a page's own link to the same place (Dev Tools' Content jump link) is never revealed or hidden by the shell.
- **Role already loaded before inject:** `inject()` now re-applies the gates when `getCurrentUserRole()` is already set. Otherwise a role that resolved first would leave a hideUntilAllowed row hidden for good on that page load.
- **Not done:** no command-palette entry (the palette has no Dev Tools or Content entry either). Easy to add with `perm: 'canManageSiteContent'` if wanted.

Tests: `tests/tools/website-nav-entry.test.js` (8). Includes an end-to-end pass through the real `auth.js` with a mocked `account_roles` response. All 8 fail on the old nav, and 5 fail on a fail-open version of the row.

## 2026-09-23 (from the visual lane) -- Home could render from local data before the sync

`workspace.html` renders the dashboard only after `initSyncOnLoad()` (role load + sync pull, two network round trips). So every return to Home shows a skeleton first; before 2026-09-23 it showed empty cards and a made-up "0 jobs today". Rendering once from localStorage at DOMContentLoaded, then again after the pull, would make Home instant in the common case. Not done from the visual lane because it's an init-order change with a permission angle. `getCurrentUserRole()` is null until the role loads, and a few checks treat null as "allowed", so an Employee could briefly see Money Owed.

## 2026-09-23 -- Site banners: the WELCOME15 offer and hiring notice are editable, without bringing back the layout shift

**Problem:** the two bars above the header were two systems fighting over two slots. `promo-banner.js`/`hiring-banner.js` wrote fixed wording into `#siteBanner1/2`; a `banner1`/`banner2` value from Tools > Site Content replaced it with bare text (no close button, different padding) on 19 pages and did nothing on the other 14. Changing the offer or ending the hiring push meant a code deploy.

**What shipped:**
- **One script, `js/site-banners.js`,** on all 33 pages with the slots (adds about, our-work, careers, terms, privacy, the 11 blog pages, and the St. George city page, which had the slots but never loaded the promo). Each slot is `builtin` (the old wording, byte-identical markup and dismissal keys), `custom` (plain text + an optional link from a fixed list of 3 pages, rendered with `textContent`), or `off`. Old files deleted.
- **Keys:** `banner1Mode`/`banner2Mode` and `banner1Link`/`banner2Link` join the existing `banner1`/`banner2` text (`sql/site-content/cms_site_banners.sql`, applied live). The CHECK validator refuses any other mode or link. With no mode saved, text alone still means "custom" (the old semantics).
- **No network in a render-blocking script, so no CLS.** The first frame renders from a localStorage copy of the last-seen rows. The page's own fetch calls `applySiteBanners(rows)`, which saves the new rows and swaps now only if nothing has painted (`performance.getEntriesByType('paint')` empty) or the slot's `offsetHeight` is unchanged. Otherwise it puts the same nodes back in the same task (no frame drawn) and the change lands on the next page. A failed or empty fetch changes nothing.
- **Dismissal:** built-in banners keep `th-promo-welcome15-dismissed`/`th-hiring-banner-dismissed`. A custom message stores an FNV-1a hash of text+link under `th-bannerN-dismissed`, so a new message reappears. A banner linking to the current page is skipped (no hiring banner on careers.html).
- **Editor:** per-slot mode picker, with message + link shown only for "My own message", cross-field check (custom needs a message) on whichever field was touched, plain-word history ("built-in wording → no banner"), a next-page note in the review, a Put back guard, and banners grouped one column per slot.

**Proof:** 64/64 element screenshots of both banners on the 16 pages that had them, desktop + phone, byte-identical before/after in Chromium. Header position, layout-shift totals, and page errors unchanged. Live migration verified in a rolled-back block: custom + link + off saved as one batch, undo back to exactly builtin/null, bad link and bad mode 23514.

**Tests:** `cms-site-banners-db.test.js` (10, real SQL), `site-banners-public.test.js` (50, including the no-jump deferral with faked paint and heights, mutation-checked), 9 new flows in `site-content-editor.test.js`, plus a guard that no function is declared twice in the page (the FAQ/Terms PR had its own `cmsShort()` with other arguments; the banner helper is `cmsPlainValue()`). `promo-banner.test.js`, `hiring-banner.test.js`, and `site-banner-no-layout-shift.test.js` now point at the new file with their original assertions, plus the exact old markup.

## 2026-09-23 -- Phone + email: booking, manage-booking, manage-job and 404 follow site_content

The "phone hooks on booking/manage-*/404" item from the site-content entry above. These four pages showed only the built-in (435) 414-1667, and `tools/site-content.html` told the owner so.

**What changed:**
- **Hooks are classes on elements that already existed.** `js-phone-link js-phone-text` on the header `.phone-link` (booking, manage-booking, manage-job), the confirmation screen's number link (booking), and the 404 Call button. No wrapper elements: an extra `<span>` is what shifted booking.html's text by a sub-pixel in the review-stats work.
- **A text-node swap, not the other pages' whole-text swap.** On index/about the fetch sets `.js-phone-text`'s `textContent`. Here that would erase the header link's icon and the 404 button's "Call ". So `applySiteContact(map)` rewrites only the number inside each hook's own text nodes, like `js/review-stats.js`. It writes nothing when the saved value is the built-in one. The four copies are identical, and a test keeps them that way.
- **Fetch.** booking.html's review fetch was widened to `key=in.(googleRating,googleReviewCount,phone,email)`. The other three got their own fail-silent `key=in.(phone,email)` fetch (CSP already allowed `*.supabase.co`; 404 has no CSP).
- **Messages built in script** read `window.__siteOverridePhone || '(435) 414-1667'` (index.html's precedent): the booking submit error, manage-booking's move/cancel errors, manage-job's request/cancel errors, and the "Nothing open online" Call link on booking and manage-booking. That link keeps `.js-phone-link`, so it's also fixed if it renders before the fetch lands.

**Proof it looks the same:** real Chromium, desktop and phone, 27 element screenshots of every spot plus 18 whole-viewport shots (a spot that moved inside the page wouldn't show in an element shot).
- **States**, driven with mocked RPCs: the confirmation screen, "Nothing open online", the submit error, the manage pages' move/cancel errors, and 404 hover.
- **Repeatable:** Google fonts come from a local cache, `Math.random` is seeded (the confirmation confetti), the page clock is pinned (the slot picker), and smooth scrolls and the cookie notice settle before the viewport shot. Two runs of main then matched 45/45.
- **Result:** main vs branch was byte-identical in all three runs (fetch failing, today's values, reduced motion): 135/135. Each spot's box, text and hrefs were identical too. A run with a different number showed it in all 27 spots and the old one in none.

**Decided against:**
- **A shared `js/site-contact.js`.** Every other public page carries its contact fetch inline, and 404.html is deliberately standalone. Four identical inline copies plus a test was the smaller change.
- **Hooking `sms:` links, or fixing the other pages' gaps, in this change.** Out of scope; see below.

**Found, not fixed (logged in bugfix.md):** the editor's old claim, "changes every place visitors tap to call, text, or email you", wasn't true elsewhere either:
- no page hooks `sms:` links;
- some Call buttons on the homepage, About, Our Work, Careers, and blog pages show the saved number but dial the built-in one;
- About/Our Work/blog "Call (435) 414-1667" buttons, three appliance-repair FAQ answers, and the Careers "how to apply" line (phone and email) don't follow at all.

So the new intro drops the four-pages warning but names those remaining spots. `contact-hooks-public.test.js` fails if that list of pages changes in either direction, so the intro can't silently go stale.

Tests:
- `tests/site-content/contact-hooks-public.test.js` (36, new): 32 fail on main. The 4 that pass there check things that were already true: the built-in fallbacks and 404's lack of scripts. `publicHtmlFiles()` moved into `tests/site-content/public-pages.js`, shared with `review-stats-public.test.js`.
- `site-content-editor.test.js`: +1 for the rendered intro, and its built-in-fallback test now also checks the four pages;
- updated with reasons:
  - `review-stats-public.test.js`: booking's wider key filter;
  - `404-button-language.test.js`: the Call button's new classes;
  - `skip-link-and-main-landmark.test.js`: only `<script>` may follow 404's `<main>`;
  - the "no token" tests in `manage-booking.test.js` / `manage-job.test.js`. They asserted *no* network call; the intent, per their title, is no RPC. The public phone/email read is allowed; anything else still fails.
- **CodeQL (2 high, "Bad HTML filtering regexp") on the PR's first push:** two test regexes matched `<script>...</script>` literally. `inlineScripts()` now uses `scripts/check-undefined-vars.js`'s settled pattern: case-insensitive, and `</script` + anything up to `>`. The 404 landmark test checks what follows `<main>` through the DOM instead of a regex. Any new test that picks scripts out of HTML should reuse that pattern.

<!-- Add new entries above this line -->
