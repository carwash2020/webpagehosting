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

<!-- Add new entries above this line -->
