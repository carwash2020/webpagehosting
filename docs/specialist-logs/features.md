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

<!-- Add new entries above this line -->
