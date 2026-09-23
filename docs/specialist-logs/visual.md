# Visual specialist log

Started 2026-09-16, alongside the `tripleh-visual` skill. See `README.md` in
this directory for how these logs work.

## 2026-09-18 -- fixed both hero-lead-form defects from the #291 review

Connor confirmed via Tha Boss/the hub to apply the two real defects
this lane found in the Cursor-PR review below. PR #292: swapped
`background:` for `background-color:` on `.hero-lead-form input,
select, textarea` (fixes the Service dropdown arrow -- missing in dark
mode, doubled/tiled in light), and added a one-column
`.hero-lead-form .form-row` override inside the existing 860px mobile
block (fixes the Name/Phone and Service/Email overflow/clipping on
real mobile widths). Both re-verified visually and via
`getBoundingClientRect`/computed-style in both themes, desktop and
390px mobile. Full test suite: 2436/2436 passing.

**Reporting note:** tried to report this to Tha Boss
(`session_0135jX1WdhvdoJfptugFLtg4`) and the hub
(`session_01AXsNpT7otNQigKYfspTezR`) directly via `SendMessage` as
asked -- both failed with "not reachable" (the underlying `ccd_session`
remote-session channel is still down, same as the #291 review).
Logging here again and posted the test-suite result as a PR comment on
#292 itself so the status is visible without the messaging channel.

## 2026-09-18 -- review pass on Cursor's conversion/UX PRs (#265-288): two real defects, no conflict with the motto-rail fix

Requested by Connor via the hub, as a review not a fix — findings below,
not yet acted on. Scope: deep visual/interaction check on the homepage
hero, where nearly all of Cursor's conversion work concentrates, plus a
mobile spot-check. Did not review every PR's page individually.

**No conflict with the 2026-09-17 `.motto-rail` fix.** Re-verified
directly: the hero is now ~1480px tall (Cursor added a lead-capture form
and a compact FAQ card inside it), and the rail still reads as a faint
hairline in both themes with no stray line reappearing.

**Real defect 1: the new hero "Service" dropdown (`#heroService`, from
the #285 estimate form) is broken in both themes.** Dark mode: no
dropdown arrow at all. Light mode: the arrow renders doubled/tiled in
the top-left corner instead of once on the right. Root cause:
`styles.css` `.hero-lead-form select{background:rgba(0,0,0,.45); ...}`
uses the `background` *shorthand*, which resets background-image/
position/repeat to their initial values for that element. A later
`[data-theme="light"] select{background-image:...}` rule wins the image
back in light mode only (by a source-order tie-break), but not its
position/repeat, so it tiles from 0%/0%; nothing restores it in dark
mode at all. Confirmed this isn't an environment quirk by forcing the
page's own pre-existing `#service` select visible (identical markup,
same page) -- it renders one clean arrow. This is the same
shorthand-resets-background-image footgun this repo has hit and fixed
before (see the portal pages' "background-color, not background
shorthand" comment) -- just reintroduced here in a new file.

**Real defect 2: the same hero-lead-form overflows and gets silently
clipped on real mobile widths.** Tested 390px. `.hero-lead-form
.form-row{grid-template-columns:1fr 1fr}` (styles.css ~937) has no
mobile breakpoint of its own, and its specificity (two classes) beats
the sitewide `@media(max-width:600px){.form-row{grid-template-columns:
1fr}}` rule (one class) meant to stack fields on phones. Name/Phone and
Service/Email each try to fit two inputs side-by-side in ~175px tracks;
grid items don't shrink below an `<input>`'s default min-content width,
so the row overflows the card and gets clipped by `.hero`'s
`overflow:hidden`. Visually: Phone shows "(435) 414-166", Email shows
"you@email.co" -- both cut off and the boxes are too narrow to use.
Confirmed via `getBoundingClientRect`: the email input's right edge
sits at x=507 on a 390px viewport.

**Not mine to call, flagging anyway:** #281 changed the homepage stat +
JSON-LD `aggregateRating` from "5.0 from 4" back to "5.0 from 7",
reversing the schema-honesty policy the bugfix lane had set up (count
only written/visible reviews, not Google's raw total). Cursor's own
comment says 7 is the real GBP total (3 of them star-only) and the wall
still shows only 4 written cards, so this may be an intentional,
informed call, not a mistake -- but it is a real reversal of a
previously-documented policy. Whether 7 is the right number to show is
a content/business call, not a visual defect -- not acting on it here.

**What's good:** the mobile hero reorder (hex logo -> H1 -> CTAs -> lead
form -> FAQ, #284) matches what Connor asked for explicitly and is a
real improvement. The sticky Call+Text+Book bar (#265, #288) uses real
44px targets. Cursor's own log entries above are unusually thorough --
each one names what it touched vs. left alone, including direct
callouts to this lane's own prior decisions.

**Reporting note:** tried to report this to the multi-chat hub session
directly (SendMessage / the `ccd_session` remote-session channel) --
both failed, the latter with a connection error, not a "not found."
Logging here instead since that's this project's existing pattern for
cross-lane visibility. Have not pushed a fix for either defect --
this was scoped as a review.

## 2026-09-18 -- sticky Call+Text+Book + compact hero FAQ card

Conversion polish after #285/#286. Homepage and the washer St. George
LP add Text (sms:) between Call and Book on the existing `.sticky-call`
strip via `.sticky-call-sms` — tighter padding so three 44px targets
still fit a 320px row. Book stays filled orange; Call and Text stay
outline. Other marketing pages and booking.html stay two-action.
Did not add a second bottom bar.

Compact FAQ is a dark-glass card matching `.hero-lead-form`, after
the form in source order, hardcoded light colors on the canyon photo.
No CSS `order` on it — hex-above-Schedule/Call at 860px is untouched.
Did not restyle `.btn.orange`. AggregateRating and the 4-card wall
untouched.

## 2026-09-18 -- hero estimate form submit is outline, not orange

UX pass on #285. `#heroLeadSubmitBtn` was `.btn.orange`, same fill as
Schedule, so two filled primaries stacked on a phone. Switched it to
`.btn.outline` — the same quieter treatment as hero Call. Schedule
stays the only filled orange in that stack. No change to hex order,
sticky Call+Book, AggregateRating, or the `th_leads` path.

## 2026-09-17 -- dashboard daily strip + More tools collapse

Paired with the features lane the same day. Four daily actions (New
job, Create invoice, Find client, Today's schedule) sit in a strip
after the jump-nav chips, using the same orange-border panel language
as the greeting banner. The existing Tools tile grid is unchanged
(every href still there) but starts collapsed under a native
`<details>More tools</details>` so the grid is no longer the first
thing you hunt through. Deep links to each tool page are untouched.

## 2026-09-17 -- homepage hero hex mark above Schedule/Call

Connor asked for the large hex logo at the top of the homepage hero,
above Schedule/Call, not under hours/CTAs. Owner override of the
2026-09-17 conversion-visuals choice (crest after H1/CTAs).

Did not restyle the mark. Mobile keeps the 96px signature (not the old
250px billboard). Placement is CSS `order:-1` inside the 860px stack
only. Desktop stays two-column, copy left / 440px mark right -- a
global order would swap those columns. Header `.brand img` (44px)
untouched. Sticky Call+Book and AggregateRating (5.0 / 7) untouched.

## 2026-09-17 -- rebase conversion pop onto main (#279)

Kept the tighter `.trust` spacing (`padding:32px 0 40px; border-top:none`)
instead of restoring F29's old `44px 0 88px`. F29 now locks that
conversion padding and the no-double-border. Public rating stays
#281's 5.0 / 7; wall still 4 written cards. booking.html $25 stays
on #278's `.referral-nudge` / `.conf-referral` -- no second class.
Rebased again onto #282 (footer hours / dead links) without touching
that work.

## 2026-09-17 -- booking.html sticky Call+Book + cookie lift

booking.html does not load styles.css, so the homepage `.sticky-call`
rules cannot apply there. Copied the 760px bar (Call outline / Book
orange, 44px targets, safe-area, cookie lift) into the page's own
`<style>`. Did not restyle `.btn.orange` on this page to the U01
offset-shadow — Confirm Booking stays the page's existing glow fill.
Cookie banner CSS was missing on this page entirely; added a compact
copy so the injected banner sits above the new bar instead of as an
unstyled block.

No redesign: sidebar, steps, and mobile summary are unchanged.

## 2026-09-17 -- homepage conversion pop (review ask, $25 referral, ATF)

Public site only. AggregateRating stays the live GBP match from #281
(5.0 / 7). Did not add review cards (wall still 4 written quotes), did
not invent quotes. The leave-a-review CTA uses the existing GBP write
URL already in `tools/review-request.html` and the reviews footer:
`https://g.page/r/CVJ0Qr-SsDkgEAI/review`.

$25 referral was FAQ-only on the homepage. It now sits on the trust
rail (shows on phone, unlike the hero line which hides at the 760px
sticky-bar breakpoint for the same reason `.cta-proof` does) and the
schedule rail. booking.html already has step 1 / confirmation credit
copy from #278 (`.referral-nudge` / `.conf-referral`); this pass kept
those surfaces instead of duplicating them. Terms unchanged: credit
after the referred job is complete and paid.

ATF: kept the locked H1, shortened the lede, left Schedule orange /
Call outline. Moved the teardown shop-drawing to after the real
before/after photos so Services is the next converting block after
trust. Reviews moved above the blog teaser. Did not delete process,
photos, or teardown.

Leave-review on city/service/about/our-work is a one-line
`.reviews-ask-inline` under the existing "Read all reviews" link --
those pages still must not carry aggregateRating.

## 2026-09-17 -- /tools/ ops inbox, More sheet, tablet density, one-row hub

PR4, tools-only. Action Items became four priority lanes around the
lists that already existed -- did not invent unread storage. Phone
bottom nav kept the five daily dests and added a More sheet built from
SIDEBAR_DESTS minus DESTS so the two lists cannot drift. Jump-nav
collapses the four "health" chips behind More under 721px (same phone
cutoff as the bar). Hub header dropped the 140px desktop second-row
stack (the two position:fixed sync/refresh pins) and put status in the
toolbar cluster. Job Tracker 768–1023 tightens cards rather than
lowering the table breakpoint -- the table's column set still wants
≥1024.

Ship blocker: live login isn't in this environment, so Action Items
lanes were verified from markup + tests, not against a real
authenticated workspace session.

## 2026-09-17 -- portal Home inbox, next-appointment hero, pay-first invoices

Logged-in `/portal/` UX only. Did not touch auth, RLS, or payment Edge
Functions -- Pay/Approve/Sign/Reply all deep-link into pages that
already did those jobs. Did not raise public AggregateRating.

Home "Needs Your Attention" is now an action inbox: one card per
real task, sorted unpaid → sign → approve → reply, with a 44px
primary button. Scheduled visits left that list on purpose -- they
are informational, not a tap-to-act item, and they already have a
dedicated surface. Next appointment is a large `#nextAppointmentArea`
hero (when/where/what plus the same Call/Text hrefs as the help
card) and stays omitted when nothing is booked.

Invoices: amount due + invoice_date context + the existing Pay now /
Pay All handlers sit in `#payFirstArea` above the paid/outstanding
ring and history chart. `client_portal_invoices` has no due-on
column, so the copy says "Invoiced {date}" rather than inventing
terms. Empty invoice lists now use the same is-neutral / is-error
icon pattern as quotes and jobs, with a Request Work CTA on the
genuine empty state.

Contracts moved from a footer-only Home link into the Your Account
card grid. The 5-tab bar is unchanged (Home / Request / Quotes /
Invoices / Jobs). Settings stays a header icon. Desktop card grid
went from 4 columns to 3 so five cards finish as 3+2, not a lone
stretched fifth cell.
## 2026-09-17 -- public conversion visuals (mobile chrome, hero, booking summary)

Focused visual PR after the quick wins. Rebased onto main after #270
(stats first-paint, 16px forms, directory landings) squash-merged.
Kept those finals and the 16px floor; this PR's conversion chrome
stays. Did not touch AggregateRating, review counts, or
analytics-events.js.

**Mobile chrome.** Promo + header + Call/Book + chat + cookie were all
fighting for ≤760px. Documented the stack in styles.css (z-index +
safe-area). Cookie is compact on small screens, deferred until scroll
or 6s so it does not cover the hero CTAs, and hides chat/back-to-top
while it is up. Call+Book stays (#265). Chat is homepage-only and
already display:none on fine pointers.

**Hero.** Removed `.hero-badge{order:-1}` (250px crest above the H1).
Crest is 96px and stays after the headline/CTAs. Lightened the photo
overlays (CSS only, same canyon files).

**CTA color.** #schedule was already Book Instantly = orange / Send
Email = quiet after #268. Left triage/service-modal Call-primary
alone (those fire after a named problem). Portal/tools untouched.

**Booking.** `.booking-sidebar` still `display:none` ≤960px. New
`.booking-mobile-summary` sticks through steps 2–3 with service +
date/time. Step labels stay visible ≤600px as Service / When / Info.

**Homepage spine.** Additive, not a length cut: desktop `.page-jump`
(sticky under the header, hidden ≤760px) and an in-flow `.schedule-rail`
after Services. Both Book to `/booking.html`.

## 2026-09-17 -- stats first-paint, 16px forms, directory landings

Shipped the three morning-handoff quick wins as one PR. Rebased onto
main after #269 (GA4 + trust CTAs) squash-merged. Real content did
not overlap; the conflicts were `styles.css` `?v=` hashes and
service-worker fingerprints. Regenerated those with `npm run
fix-versions`.

Stats: put 5.0 / 4 / 9 in the HTML text, not only in `data-count-to`.
Count-up still exists but interpolates from the already-rendered
final (and will not start a frame at 0 if the painted value is 0 or
missing). Reduced motion / no-JS already had the finals; first paint
did not. Did not raise any count and did not touch AggregateRating.

Forms: one-line floor on the public `input, select, textarea` rule in
`styles.css` (14.5px -> 16px). Email modal shares that rule. Same
approach portal/booking already use.

Directory URLs: GitHub Pages 404s `/portal/` and `/tools/` without
`index.html`. Stubs redirect to the login pages. Dark FOUC treatment
matches login (`background-color:#0a0a0a` + `color-scheme: dark`), no
shared stylesheet load so they stay out of the stamp set. Tools
index is noindex. Portal index matches current login robots
(`noindex, nofollow`) -- the login.html comment still says the page
is indexable, but the live tag and `portal-login-noindex.test.js`
require noindex, and `robots.txt` already Disallows `/portal/`. Left
login.html alone.

`tools/index.html` is exempt from requireAuth/CSP/manifest checks (it
is a redirect stub, like the retired contact-card page) and is in
PRECACHE_URLS because the completeness checker requires every real
tools HTML file. Portal stub is not in the portal precache list --
that list is not a completeness scan, and a 0-second redirect is not
app shell.

## 2026-09-17 -- compact trust line next to Book/Schedule CTAs

Paired with the GA4 booking-events work the same day. Homepage hero
and the #schedule Book Instantly card each got a one-line `.cta-proof`
(stars + "5.0 from 4 Google reviews" + a truncated washer-repair quote
already on the reviews wall + a See reviews link). booking.html got
the same line under the subhead, linking to `/#reviews`. Not a new
review card, not a second sticky bar, and not a count bump -- the
wall and AggregateRating stay at 4.

Hero colors are hardcoded light, same reason as `.hero h1` / the
outline Call button: that photo never flips with theme. Inside
`.booking-cta` it uses theme tokens. Mobile centers the hero line
under the stacked CTAs above 760px. At the sticky-bar breakpoint
(760px) the hero line is hidden -- it sat behind the Call+Book bar
on first paint, with the logo + stacked CTAs already filling the
viewport. The same copy stays on the #schedule Book Instantly card,
which clears the bar. booking.html has no sticky bar.

<!-- Add new entries above this line -->
## 2026-09-17 -- Schedule-primary hero + two-action sticky bar

Paired with the features-lane conversion work the same day. New
`.btn.outline` uses the same orange-tint tokens as `.nav-schedule-btn`
but the real `.btn` size, so Call stays a tap target with the phone
number visible. Hero and sticky-bar outline colors are hardcoded light
(same reason as `.hero h1` / `.hero .cta-quiet-link`): both sit on a
surface that never flips with theme.

Kept the 760px hide-on-desktop breakpoint the old Call-only strip
already used, not the 960px hamburger -- that's where back-to-top and
the chat bubble already assumed a bottom bar. Mobile hero CTAs stack
and are allowed to wrap so "SCHEDULE AN APPOINTMENT" doesn't overflow
a 320px viewport under `.btn`'s nowrap + letter-spacing.

Sticky bar is always-dark (`rgba(10,10,10,.95)`), matching the
theme-independent header. Do not "fix" that to follow light mode.

<!-- Add new entries above this line -->## 2026-09-16 -- deep-dive audit: gallery lazy-load bug found, two suspected issues ruled out

Did a real visual pass (screenshots across desktop/mobile, light/dark)
rather than just re-reading `docs/ACTION-ITEMS.md`. One genuine,
verified bug found; two things that looked like bugs at first turned
out to be artifacts of the audit method itself, worth recording so a
future session doesn't re-chase them.

**Real bug, verified: `our-work.html`'s gallery silently drops ~40% of
its photos.** The gallery is a CSS `column-count:3` masonry
(`.gallery-grid.gallery-masonry`, styles.css ~1823) and every `<img>`
carries native `loading="lazy"`. Measured per-category load success
after a full real scroll-through + networkidle wait: flooring
categories (first ~20 images) loaded 100%; `kitchen-tile-installation`,
`kitchen-tile-finished`, and `other-work` (27 images, the last three
categories) loaded **0%** -- confirmed zero network requests ever
fired for them, not a slow-load timing issue. Removing `loading="lazy"`
via `img.removeAttribute('loading')` fixed all 61/61 instantly, isolating
the attribute (interacting with the multi-column layout) as the root
cause -- a known class of Chromium bug where native lazy-load's
viewport-distance heuristic breaks down across CSS column
fragmentation, especially after a `column-span:all` element (the
`.gallery-category` headers) forces a column restart.

**Fixed 2026-09-16 (later the same day).** Stripped ` loading="lazy"`
from all 61 `<img>` tags inside `#galleryGrid` in `our-work.html`
(left the unrelated footer logo's own `loading="lazy"` alone -- it's
outside the masonry and was never affected). Considered a manual
`IntersectionObserver`-based lazy-load instead, but the repo has no
existing pattern for that and it would've been new machinery for a
one-page problem; eager-loading ~61 real photos (~5MB total) on a
gallery page a visitor came to specifically to browse photos is a
reasonable trade for "the photos actually show up." Re-verified with
the same per-category load-success measurement used to find the bug:
61/61 now load after a real scroll-through, including the three
categories that were previously stuck at 0%.

**Ruled out: "light mode looks broken, huge dark bands appear."**
Full-page (`fullPage: true`) Playwright screenshots on this site are
unreliable for anything below the first viewport -- `.bg-blueprint`
(the theme background) is `position:fixed`, and Chromium's
capture-beyond-viewport screenshot mode does not repaint fixed elements
throughout a tall stitched capture; below one viewport height they
just show the raw `<html>` element's own hardcoded dark inline style
(`style="background:#0a0a0a"`, there specifically to avoid an FOUC
flash). A real scrolled-viewport screenshot at the same scroll position
shows correct light-mode colors every time. **Lesson: never trust a
`fullPage` screenshot on this site for background/theme issues --
always confirm with a real `scrollTo()` + viewport-sized screenshot
before reporting a background/color bug.** This cost real time twice
in this session (once on the homepage, once on about.html) before the
pattern was recognized.

**Ruled out: "the sticky header renders black in light mode."** This
is `header::before{background:rgba(10,10,10,.88)}` -- confirmed
intentional, from the 2026-08-01 session documented in the
`tripleh-business` skill ("Header made theme-independent... per
explicit user request"). Not a bug, don't re-flag it.

**Checked and fine:** `logo-signature.webp` vs
`logo-signature-orange.webp` -- the skill's own notes call this an
unresolved naming discrepancy, but visually comparing both files today
shows them identical (both the orange-center version). Whatever the
history, there's nothing to fix here now -- don't keep carrying this
forward as open.

**Smaller, real finding, fixed 2026-09-16 (later the same day):**
`.cookie-btn` (styles.css ~3563, the cookie consent banner's Decline/
Accept buttons) was `padding:9px 18px` at 13.5px font -- roughly 34px
tall, under the 44px touch-target minimum this project has explicitly
fixed elsewhere before (internal tools' `.small-btn`, 2026-08-01).
Added `min-height:44px; display:inline-flex; align-items:center;
justify-content:center` -- same 44px value as the existing convention,
flex-centered so the text stays vertically centered instead of just
padding out awkwardly. Verified at 44px via a real rendered button
(`getBoundingClientRect()`), and screenshotted in both themes -- looks
right, no layout shift in the banner.

**Method note for next time:** for any "is X rendering correctly"
question on this site, verify with (1) a real scroll + viewport
screenshot, not fullPage, and (2) for anything image-loading-related,
check `img.naturalWidth`/`complete` and actual network requests
directly rather than trusting a screenshot at all -- native
lazy-loading failures don't show up as broken-image icons, they show
up as an indefinitely-empty box that looks identical to "hasn't
scrolled into view yet."

## 2026-09-17 -- fresh audit: `.motto-rail`'s unlit color read as a
rendering bug in light mode, fixed

Did another real pass rather than assuming last session's context
still covered everything. The queued "Proposed visual improvements"
items are all blocked (need real non-flooring job photos that don't
exist yet -- confirmed again by listing `images/gallery/`, still 100%
flooring/tile/trim) except one auth-gated loading-indicator item I
couldn't safely verify without live portal credentials, so left it
alone rather than guess-fixing an auth flow blind.

**Real bug, verified and fixed: the homepage hero had what looked like
a rendering glitch -- a distinct vertical line down the far-left edge
of the viewport, confined to the hero's height, visible in light mode
against the cream page but basically invisible in dark mode.** Spent a
while chasing the wrong causes first (a `background-size:cover`
sub-pixel gap on `.hero` revealing `.bg-blueprint` underneath; a
`backdrop-filter` GPU-layer edge bleed from the sticky header) --
disproving both by forcing `.hero`'s background to solid yellow via
`page.addStyleTag` and re-sampling actual pixel values with a
canvas-based pixel reader (`ctx.getImageData`), since `fullPage`
screenshots and eyeballing a small crop both proved unreliable per the
2026-09-16 entry above. The real cause: `.motto-rail`
(styles.css ~2230), a decorative `position:fixed; left:0; width:3px`
"spine" tied to the hero tagline, at rest uses `background:var(--border)`
at 50% opacity -- a light color in light mode -- crossing the
hero, which (like its own h1/lede text) deliberately stays on a dark
photo regardless of site theme. Same class of gap as that already-fixed
text-color case, just never caught for this element. Confirmed with
`document.querySelectorAll('*')` filtered to fixed/absolute elements
taller than 300px -- `.motto-rail` was the only real match once the two
wrong theories were ruled out.

**Fixed**: changed `.rail-seg`'s unlit `background` from `var(--border)`
to a fixed `rgba(255,255,255,.2)` (element opacity stays `.5`, so the
effective blend is ~10% white) -- solved by working out the blended
result against both the hero's dark tone and the light-mode page's own
`--bg`, then verifying with the same pixel-sampling method: the hero-edge
jump went from a ~90-value spike down to ~20, and the already-subtle
appearance against the rest of the light-mode page got even more subtle
(a ~17-value gap down to ~1-2). Re-verified visually in both themes,
desktop and a 390px mobile viewport (light mode via `localStorage.setItem
('th-theme','light')`, since the desktop `#themeToggle` button is hidden
on mobile -- there's a separate `.mobile-theme-row` switch, not tested
here since a pixel-level check isn't needed for a toggle that's known to
already work). Also scrolled to the About section pills to confirm the
scroll-triggered "is-lit" segments (which override `background` and
`opacity` entirely) still work exactly as before -- this fix only
touches the unlit/at-rest state.

**Method note for next time**: when a screenshot shows something that
looks like a rendering artifact but survives changing the CSS you'd
expect to control it, don't conclude "browser quirk, not my problem" --
walk the DOM for every fixed/absolute/sticky element whose rect
intersects the suspect region (`getBoundingClientRect` + filter), rather
than only inspecting the element `elementFromPoint` returns (that only
gives the topmost *hit-testable* element -- a `pointer-events:none`
decorative layer sitting visually on top, like this rail, never shows up
there).

## 2026-09-17 — UX-study glitch pass (hours, dead links, portal overlap)

Visual bits of a bug-lane PR, not a redesign. Footer Hours reuses the
existing `.hours-grid` / `.hours-row` rules; added `.footer-col ul + h4`
so the second heading in Contact doesn't collide with the list above.
Portal clearance is padding + a 16px spacer, not a new nav. Booking
date-row scrollbar is thin/themed to match quotes.html's existing
horizontal scroller, without copying the JS fade wrap.

## 2026-09-18 -- homepage "richness" audit came up nearly empty (already built); real fix on Workspace's Money Owed card

Asked to make the public homepage feel richer/fuller ("add more
layers"). Rendered the real page top to bottom first (forcing
`[data-reveal]`/`.is-visible` visible via `page.addStyleTag` rather than
trusting scroll-triggered reveals in headless) before proposing
anything, per this log's own standing method note. Turned out almost
everything on the plausible wishlist is already built: a stats bar
(5.0 rating / 7 reviews / 9 communities / owner-operated), a 4-card
trust grid, a referral banner, a real drag-to-compare before/after
photo slider, an interactive appliance-teardown diagram, a 4-step
process timeline, a grouped/collapsible FAQ, a review wall with a
leave-a-review CTA, a service-area diagram with hours, and a documented
hero depth/parallax system (`.hero-badge`/`.hero-plane`, scroll-driven,
already `prefers-reduced-motion`-gated). Cross-checked against
`docs/ACTION-ITEMS.md`'s own "Proposed visual improvements" list: the
only remaining candidates (photo thumbnails on service cards, un-hiding
the homepage Recent Work strip, a founder photo on "Meet Steven
Robinson") are all explicitly blocked on real photos that don't exist
yet -- confirmed again by checking `images/` directly, still no
non-flooring job photos or any photo of Steven. Concluded there's
nothing honest to add here without either fabricating content (against
this project's real-photos-only rule) or duplicating a system that
already exists -- said so rather than inventing a section for its own
sake. No code change on the homepage from this pass.

**Real, separate finding: Workspace dashboard's "Money Owed" card
(`tools/workspace.html`, `#todayMoney`) had a genuine layout bug**,
caught from a screenshot. Root cause, found by extracting the real
inline `<style>` block verbatim into a local repro (same technique as
the 2026-09-17 workspace jump-nav investigation) rather than guessing
from CSS text: `styles-tools.css`'s sitewide `body .dash-list-item`
rule pairs `padding: 10px 12px` with `margin: 0 -12px` on purpose, so a
row's hover state can bleed flush to whatever container it's in.
`.today-money .dash-list-item` (this card's own rule) overrides the
padding to `8px 0` for its plain flat "Current"/"Overdue" rows, but
never cancelled the paired `-12px` margin -- which does nothing when
padding is already 0, until the highlighted overdue-invoice row
(`.is-unread`, orange left border + tinted background) sits in the same
list: its card bled 12px past the panel's own 16px/18px padding,
landing ~7px from the panel's edge instead of the 18px every other line
in the card respects, and close enough to the panel's own 14px
border-radius corner to look pinched into it. Verified with real
`getBoundingClientRect()` measurements before and after, not just a
screenshot: `gapRight` went from 7px to 19px, now matching the panel's
own padding and the "Overdue $268.23" row directly above it. Fix is one
line, scoped to this one list (`.today-overdue-list .dash-list-item {
margin: 0; }`), so the sitewide bleed convention is untouched everywhere
else it's used correctly (plain hover rows, the portal invoice list,
etc.).

**Method note for next time**: the same `body .dash-list-item`
bleed-convention mismatch (padding overridden locally without
cancelling the paired negative margin) likely also affects
`.ops-lane .dash-list-item` (Action Items lists), which has the same
shape -- a local `padding: 8px 4px` override that still leaves the
`-12px` mostly uncancelled. Not fixed here (out of scope for what was
reported), but worth checking with the same
`getBoundingClientRect()` method before assuming it's fine.

## 2026-09-19 -- confirmed and fixed the ops-lane bleed predicted above; portal font-loading FOUC root cause

**Ops-lane confirmed real.** Checked the prediction from the entry
above with the same local-repro + `getBoundingClientRect()` method
(first run gave a false negative -- the local static server had quietly
died between test runs, so the external `styles-tools.css` never
loaded and only the inline `<style>` block was in effect; restarting it
with `setsid`/`disown` so it survives between tool calls and re-testing
showed the real numbers). Confirmed: `.ops-lane .dash-list-item`'s
`padding: 8px 4px` override leaves the sitewide `-12px` margin mostly
uncancelled, so a highlighted overdue-invoice row inside an Action
Items lane bled to ~3px from the lane's own edge instead of the 14px
every other line respects. Checked whether the bleed convention is
even needed here first: every row in every ops-lane list
(workRequestsList/leadsList/bookingsList/followupsList/invoicesList/
upcomingJobs) is a plain `<div class="dash-list-item">`, never an
`<a>` -- and the hover-bleed this convention exists for
(`body a.dash-list-item:hover`) only targets links. So nothing in this
scope needs it at all; cancelled outright (`margin: 0` added next to
the existing padding override) rather than trying to match the lane's
padding like the money-card fix did. `gapRight` measured 3px -> 15px,
now matching the lane's own 14px padding. `.lead-card` (used by
leads/bookings) is unaffected -- it never inherited the bleed rule in
the first place, uses its own unrelated card-chrome background.

**Portal font-loading FOUC, real and root-caused.** The reported
"blank-white flash before the skeleton" isn't from missing loading
state -- both `portal/dashboard.html` and `portal/quotes.html` already
render their skeleton cards as static HTML, no JS gate hiding them.
The actual cause: both pages load Google Fonts via a plain blocking
`<link rel="stylesheet" href="https://fonts.googleapis.com/...">`,
while the public marketing pages (`index.html`, etc.) already use the
async `rel="preload" as="style" onload="this.onload=null;
this.rel='stylesheet'"` pattern with a `<noscript>` fallback,
specifically to avoid blocking first paint on a third-party font
fetch. A render-blocking stylesheet holds back ALL painting -- even
the `<html style="background-color:#0a0a0a">` inline dark-paint fix
already in place on both pages -- until every blocking resource
resolves, which is the real mechanism behind a flash despite the dark
background already being declared. Applied the exact same async
pattern already established elsewhere in this codebase to both files.
**Scope note**: every other portal page (`home.html`, `login.html`,
etc.) has the identical blocking pattern -- only fixed the two files
actually asked for here; the same fix would apply cleanly to the rest
if someone wants it later.

**Method note for next time**: a local Python `http.server` started
with `(cmd &)` inside this session's Bash tool does not reliably
survive between separate tool calls -- it died silently partway
through this session with no error, and a `curl` against it returned
a `000`/empty response that could easily be misread as "the feature
doesn't reproduce" rather than "the test harness broke." Start it with
`setsid ... < /dev/null & disown` instead, and always sanity-check with
`curl -s <url> | grep <a string known to be in the real file>` before
trusting a negative measurement.

## 2026-09-22 -- PWA/ergonomics audit: manifest and safe-area already solid, a real `.small-btn` regression found

Scoped narrowly per the brief (quick wins only, no gesture/animation
rework). Checked the manifest, safe-area coverage, and tap ergonomics
before writing anything -- most of it was already correct from prior
sessions (manifest.json, apple meta tags, `viewport-fit=cover`, and
extensive `env(safe-area-inset-*)` use across `styles-tools.css` all
checked out on inspection, no changes needed there). Full writeup in
README's dated entry; keeping here what's worth remembering.

**Real finding: two rules governing `.small-btn`'s mobile min-height
conflict, and the wrong one wins.** `body .small-btn { min-height: 40px;
}` (inside `@media (max-width:720px)`, part of the big "MOBILE: feels
like a different product" block) and `.small-btn { min-height: 44px; }`
(inside a separate, later `@media (max-width:760px)` block, written for
the 2026-08-01 touch-target fix) both apply at phone widths. CSS
specificity, not source order, decides the winner when both match --
`body .small-btn` (0,1,1) beats the bare `.small-btn` (0,1,0) regardless
of which block comes later in the file. So the 44px fix from 2026-08-01
was never actually taking effect on a real phone; `.small-btn` (Advance
Status/Photos/Delete on every job card) has been rendering at 40px this
whole time. **Method note:** this class of bug -- two rules for the same
selector at the same breakpoint, one added long after the other, neither
aware the other exists -- won't show up by reading either rule in
isolation; it only shows up by grepping the whole file for the exact
selector and comparing specificities, which is exactly what the
`.form-row`/public-site collision and the `.tabs`/`.storage-note`
CSS-consolidation mistakes documented earlier in this project's history
were also about. Worth a standing habit: after any touch-target or
shared-class CSS fix, grep the file for every other rule touching that
same selector, not just confirm the new rule looks right on its own.

**Also fixed:** the photo lightbox's close (38px) and prev/next (42px)
buttons, both real sub-44px controls on a full-screen overlay with
plenty of room to grow with zero layout risk.

**Added `-webkit-tap-highlight-color: transparent` and `touch-action:
manipulation`** across the tool suite's interactive elements (shared
`styles-tools.css`, mirrored into `runway-dashboard.html`'s
self-contained copy since it doesn't load that file) -- the two quietest
"this is a mobile website, not an app" tells once safe-area/manifest/
touch-targets are otherwise handled. Deliberately used
`touch-action: manipulation` rather than `user-scalable=no` on the
viewport meta -- the latter kills real pinch-zoom too, which this task
explicitly didn't ask for and which fights WCAG 1.4.4.

**Self-caught mistake, worth repeating for future -- the first attempt
broke `tests/design/desktop-layout.test.js`.** Added the tap-highlight
fix as its own standalone `html { ... }` rule near the top of the file.
That test's own regex greps the file for the FIRST `html { ... }` block
and asserts it's the ambient-background-gradient rule (a deliberate,
documented design from 2026-08-20). My new rule came first in the file
and silently became the regex's match instead, failing the test with a
confusing-looking diff (`-webkit-tap-highlight-color` where
`radial-gradient` was expected) that read like the wrong file was
touched, not like a second `html {}` block existed. Fixed by folding
`html` into the comma-separated selector list of the *other* new rule
instead of giving it a standalone block -- same effect, doesn't match a
bare `html {` pattern. **General lesson: before adding any new bare
top-level-element selector (`html {}`, `body {}`, `*{}`) to a CSS file
this size, grep for that exact selector first** -- the file already has
enough of them that a naive test regex (or a real cascade fight, as
`.small-btn` above shows) is a live risk, not a theoretical one.

Verified: full suite 2642/2642, `check-consistency`,
`check-undefined-vars`, `lint`, `check-links.py` all clean; real headless
Chromium at 390x844 on `workspace.html`, `job-tracker.html`, and
`invoice-generator.html` (auth bypassed via a fake-but-shaped
`th_auth_session` in `localStorage`, matching `auth.js`'s own
client-side-only expiry check) confirmed `.small-btn` measuring 44px in
the real DOM and `-webkit-tap-highlight-color`/`touch-action` reading
back correctly via `getComputedStyle` on real buttons.

## 2026-09-22 -- "make it feel like a native app" push, round 1: haptic + long-press coverage

Direct request: "heavily focus tool improvements... as much like a
physical phone app as possible... keep refining, shrinking, and making
it easier to use." Audited what native-app-feel systems already exist
before proposing anything new -- pull-to-refresh, swipe-back, job-card
swipe-to-reveal-Done, long-press bottom sheets, `haptic()`, app badge,
offline banner, overscroll containment, and swipe-to-dismiss modals
were ALL already built. The real gap was coverage, not missing
systems: two shared, already-designed utilities (`haptic()`,
`attachLongPress`/`showQuickActionSheet`, both in `tools-dialogs.js`)
were live on only 1-2 of ~19 tool pages.

**Haptic coverage.** Added `haptic('success')` at the real
success/creation moment on the pages with the highest-frequency
confirm actions: `invoice-generator.html` (mark paid, invoice logged,
estimate logged), `finance.html` (income logged, expense/mileage
logged), `job-tracker.html` (job saved), `workspace.html`
(booking converted to job). Also moved the call into `tools-effects.js`'s
shared `celebrateCompletion()` itself (job marked Done, and any future
caller) rather than at each call site -- one change, every current and
future completion moment covered. Deliberately unconditional ahead of
the `prefers-reduced-motion` check inside that function: vibration
isn't the kind of motion that preference is about, only the confetti
is. `showConfirm()`'s own dialog already fired a haptic on every
confirm click sitewide before this pass -- these are the *other*
success moments that don't go through a confirm dialog at all.

**Long-press coverage.** Extended the exact same
`attachLongPress`/`showQuickActionSheet` pattern Job Tracker's job
cards already used to 4 more row types that were tap-only: income and
expense/mileage rows (`finance.html`), the Contacts tab's client cards
(`job-tracker.html` -- the "clients.html" framing in the original
audit was slightly off; the real Edit/Delete client rows live on Job
Tracker's Contacts tab, `clients.html` itself is the portal-lookup/
admin tool with no such list), and the contract log
(`contract-generator.html`). Same guard convention as the existing
`initJobCardLongPress()` (`container.dataset.longPressWired`) so a
second call never double-wires the same container.

**Real regression caught by the existing suite, not overlooked**: the
new init functions called `attachLongPress` unguarded, which threw in
2 pre-existing `finance-split.test.js` tests that load `finance.html`
in a minimal JSDOM sandbox without `tools-dialogs.js` (external
`<script src>` isn't fetched by JSDOM) -- the thrown error aborted the
async init IIFE before the tab-activation code further down ever ran,
so the default tab silently stopped activating. Fixed by guarding each
new init function with `if (typeof attachLongPress !== 'function')
return;`, the same defensive convention this codebase already uses for
every other cross-file optional dependency (`setupPullToRefresh`,
`mirrorInvoiceToRelational`, etc.).

New test file: `tests/tools/app-feel-haptics-longpress.test.js` (14
tests) -- source-level assertions for every haptic/long-press call
site plus one real behavioral test (mocked `attachLongPress`/
`showQuickActionSheet`, a real long-press invoked end-to-end, asserts
the sheet's title and that its Edit/Delete callbacks actually call the
right function with the right id).

Verified: full suite 2701/2702 (only the known check-links.py
sandbox-proxy issue), `check-consistency`/`check-undefined-vars`
clean, `npm run fix-versions` run twice (once for `tools-effects.js`'s
shared-file hash bump, once for the attachLongPress-guard follow-up).

Round 2 candidates already identified for next: centralizing the app
badge refresh beyond `workspace.html` (it goes stale if you work
directly in a deep-linked tool page), and extending the swipe-reveal
pattern to invoice/quote log rows.

## 2026-09-22 (later still) -- "make it feel like a native app" push, round 2: badge freshness + a course-correction on the swipe idea

**Badge freshness.** `workspace.html`'s `updateActionItemsBadge()` is
the only place that ever computes the real cross-page Action Items
total (leads, work requests, applicants, bookings, due-soon jobs,
follow-ups, unpaid invoices) -- duplicating that fetch/count logic on
every other page just to keep the OS home-screen badge honest would be
exactly the same-logic-in-two-places trap this codebase has already
been bitten by (`SIDEBAR_DESTS`/`MORE_DESTS`, `NAV_PERMISSION_CHECKS`
both went stale independently before). Instead: `updateActionItemsBadge()`
now caches its computed total to `th_app_badge_total` every time it
runs, and a new shared `setAppBadgeDelta(delta)` (`tools-effects.js`)
lets any OTHER page nudge that cached total by a known relative amount
and re-set the real OS badge from it -- no recompute, no duplicated
fetch logic. The Badging API is write-only (no way to read back what's
currently displayed), which is exactly why a relative nudge from a
cached value, not an attempted live recompute, is the right shape
here. Wired into the one clean, well-defined case: `invoice-generator.html`'s
`toggleInvoicePaid()` nudges -1 when marking paid, +1 when marking
unpaid again. Deliberately did NOT try to guess at other cases (a job
going from "due soon" to done, say) where the count's own definition
lives entirely in `workspace.html`'s local-data logic and isn't safely
inferable from another page.

**Swipe-reveal on invoice/quote rows -- reconsidered, not built.**
The round-1 audit's premise was that Mark Paid "requires opening the
row," matching Job Tracker's Done button (hidden until a swipe or long-
press reveals it). Checked before building anything: that's not
actually true here -- `invoice-generator.html`'s invoice log already
shows Resend/Mark Paid/Delete as directly visible buttons on every
row, no swipe or tap-to-open needed. Building a swipe gesture to reveal
an action that's already one tap away would add real complexity
(a second gesture system to maintain, generalized off `.job-card`'s
tightly-coupled implementation) for no actual UX gain -- the opposite
of "shrinking, refining." Substituted the genuinely higher-value,
lower-risk move instead: extended the same long-press quick-action
sheet from round 1 to the invoice log itself (`initInvoiceLogLongPress()`),
which DOES save something real -- a single gesture instead of finding
and tapping the right one of 3 buttons on a narrow phone width, same
value proposition as the finance/contacts/contract-log additions from
round 1.

Extended `tests/tools/app-feel-haptics-longpress.test.js` (6 more
tests, 20 total): badge caching in `updateActionItemsBadge()`,
`setAppBadgeDelta()`'s clamp-at-zero/cache/OS-badge behavior (both
source-level and a real invoked-end-to-end test), the invoice-paid
delta wiring, and the invoice log long-press init + a full behavioral
test (mocked `attachLongPress`/`showQuickActionSheet`, asserts the
sheet's title and that Resend/Mark Paid/Delete each call the right
function with the right id).

Verified: full suite 2707/2708 (only the known check-links.py
sandbox-proxy issue), `check-consistency`/`check-undefined-vars` clean.

## 2026-09-22 (later the same day): 2FA UX polish + "Your Data" moved out of Settings into Dev Tools

Two related pieces done together, both scoped as presentation/flow polish
on top of the same-day MFA bug fix (`docs/specialist-logs/security.md`) --
the underlying TOTP/recovery-code architecture (raw-fetch REST, the
custom recovery-codes table) was not touched.

**2FA UX polish, on both `tools/settings.html` and `tools/login.html`
(the enrollment/challenge flow):**
- **Manual-entry secret now has a real Copy button**, not just visible
  text someone had to hand-select -- real friction on a phone
  specifically, exactly where enrollment is most likely to happen first.
  A small shared `copyTextToClipboard()` helper (duplicated once per file,
  matching this project's existing precedent for small per-page helpers
  like `personDot()` before it was consolidated) tries
  `navigator.clipboard.writeText()` first, falls back to a hidden-textarea
  `execCommand('copy')` for anything that doesn't support the Clipboard
  API. QR code on Settings also sized up slightly (180px to 200px) for
  easier scanning.
- **Recovery codes gained a "Copy all" button** next to the existing
  Download, on both pages -- for pasting straight into a password
  manager's notes field instead of only ever a separate `.txt` file.
- **The one-time warning is now unmissable, not just present.** It
  already existed as plain text ("they will not be shown again"); made it
  visually distinct (orange, bold) on both pages, and added a second,
  more specific line ("after you leave this page") since the original
  wording didn't say what "again" meant relative to.
- **6-digit code inputs get `pattern="[0-9]*"`** alongside the existing
  `inputmode="numeric"` (both were already present on most, missing the
  `pattern` attribute on all of them -- some older mobile keyboards key
  off `pattern`, not `inputmode`, to decide whether to show a numeric pad).
  Also strips any non-digit character as-you-type and **auto-submits once
  a full valid 6-digit code is present** -- these are single text inputs,
  not 6 separate boxes, so there's no per-digit auto-advance to build;
  auto-submit-on-complete is the equivalent convenience for that shape,
  removing the separate tap on Verify after typing or pasting a code.
  Left the recovery-code input alone (different, variable-length format).
- **A real, explicit focus state added to `.mfa-code-input`** on
  login.html (an orange border + soft glow) -- this is the single most
  important field on the whole enroll/challenge flow, so it gets its own
  treatment on top of whatever global `:focus-visible` rule already
  applies, rather than relying on the browser's default outline alone
  against a dark, low-contrast background.
- **Low-friction discovery for an optional-tier (Employee) account**:
  Settings' 2FA card already said "Optional, but recommended" but never
  said *why* -- added one honest, plain-tone line ("A stolen or guessed
  password alone won't be enough to get in...") shown only when the
  account is optional-tier and not yet enrolled; hidden entirely once
  enrolled or for a mandatory account (which already says "Required"
  right above it).
- Left alone, deliberately: spacing/copy pattern already matched the
  rest of Settings' sections (`.settings-row`/`.settings-row-label`
  etc.) before this pass -- no changes needed there.

**"Your Data" (full backup/restore) moved from Settings to Dev Tools.**
Reasoning: a regular Employee account has no use for a full JSON
export/restore of the *entire* account's data -- this is an admin/dev
capability, not a personal-settings one, and Restore is destructive
(replaces everything on the device). Landed in Dev Tools' **Session**
tab (alongside Local data snapshot, Device info, Service worker & cache
-- panels about this device's underlying data/state) as a new
`dev-panel dev-owner-hidden` panel.

**Role-gating decision: Developer-only, not Owner+Developer.** Checked
`README.md`'s 2026-08-21 note first: an Owner-role account already sees
*only* the Access tab (Client Registry, Account Roles) in Dev Tools --
every other tab, and every panel in it, is hidden for Owner by design,
regardless of individual sensitivity. There is no existing precedent for
an Owner-visible-but-not-Access-tab panel to break from that pattern for.
Making Backup & Restore Developer-only, `dev-owner-hidden` like every
other panel on its tab, is the consistent choice -- not a new, one-off
restriction invented for this feature. Verified live (below) that an
Owner account sees neither the Session tab nor the panel at all.

**A straight relocation, not a rewrite** -- confirmed byte-identical
behavior: the same `ALL_SYNCED_KEYS` list, the same `downloadBackup()`/
`restoreBackup()` functions, the same backup file naming/shape, the same
destructive-restore confirm text. `tools/dev-tools-shared.js` gained a
`backup` entry in `DEV_INFO` (the "?" info-modal system) explaining the
move and the role-gating reasoning; the page's own help modal text for
the Session tab was updated to mention it.

**#backup deep-links, checked and fixed at both hops** -- this row had
already moved once before (Dashboard to Settings, 2026-09-21), so there
were two existing redirects to update, not one: `tools/workspace.html`'s
`#backup` handler now replaces straight to `/tools/dev-tools.html#backup`
(previously hopped through Settings), and `tools/settings.html`'s own
`#backup` handler now does the same instead of scrolling to a section
that no longer exists there. `tools/dev-tools.html` handles the incoming
hash by switching to the Session tab and scrolling the panel into view.
Grepped the whole repo for any other reference to `settings.html#backup`
or "Your Data" expecting it to still be in Settings -- none found outside
this session's own updated tests and README's historical (2026-09-21,
left as-is) changelog entry.

**Tests updated** (a real relocation needs its tests to move with it,
not just pass by accident): `tests/tools/dashboard-today-first.test.js`'s
backup-relocation test now points at `dev-tools.html` and asserts the
panel is `dev-owner-hidden`; `tests/workspace/finance-split.test.js`'s
`#backup` deep-link test updated for the new direct hop and confirms
Settings no longer has any of the removed markup/functions;
`tests/tools/inventory-and-job-duration.test.js`'s `th_inventory`-in-
backup-list test now reads `dev-tools.html`; and
`tests/dev-tools/dev-tools-owner-view.test.js`'s exact-panel-count test
bumped from 29 to 30 `dev-owner-hidden` panels. One self-caught mistake
while updating these: an early draft of my own code comments in
`settings.html` literally contained the string `ALL_SYNCED_KEYS` (while
explaining where it moved to), which made the "Settings no longer
contains this" `doesNotMatch` assertions fail against my own comment
text, not real leftover code -- reworded the comments to describe the
same thing without using the exact tokens the tests were checking for.

**Verified live in headless Chromium** (served over `python3 -m
http.server`, never `file://`, mocking `account_roles` per scenario):
Settings' enroll view shows a visible, working Copy button next to the
manual secret; the optional-tier why-note renders for an Employee-shaped
account and is absent for Developer; the "Your Data" section is
confirmed entirely gone from Settings; Dev Tools' `#backup` link lands
directly on a visible panel with a working Download button for a
Developer account; and, separately, an Owner-shaped account sees neither
the Session tab button nor the panel at all, confirming the Developer-only
gating actually holds at runtime, not just in the source. Full suite,
`check-consistency`, `check-undefined-vars`, and `lint` all clean;
`check-links.py` clean except the known sandbox-proxy limitation
(images.unsplash.com and this site's own domain, both pre-existing and
unrelated to this change).

## 2026-09-22 (later still) -- "make it feel like a native app" push, round 3: the last real haptic gaps + voice dictation

Ran a fresh audit rather than assuming rounds 1-2 covered everything --
checked every shared "already built, under-used" system, not just
`haptic()`/`attachLongPress` again, and spot-checked pages neither
round had touched (route-planner.html, review-request.html,
clients.html, dev-tools.html, runway-dashboard.html, settings.html).

**Three real, silent haptic gaps found and fixed:**
- `invoice-generator.html`'s `showSuccess()` (Quick Charge) -- the
  highest-frequency "money in hand" moment in the whole suite, a real
  card charge actually completing, and it was silent even though this
  exact file's mark-paid/invoice-logged/estimate-logged moments
  already fire one. One call in the shared function covers both real
  callers (`chargeSavedCard()`'s success path and the Stripe
  `confirmPayment` success branch).
- `review-request.html`'s `logSentRequest()` -- the one function both
  the SMS and Copy Message send paths already funnel through, same
  "fix once at the centralized call site" shape round 2's badge work
  established.
- `review-request.html`'s `setRequestStatus()` -- but only for the
  `received` ("Left a review") outcome, not `no_response`, which is a
  neutral status update rather than something worth acknowledging.

**Voice dictation, previously wired to exactly 1 field across all ~23
tool pages** (`job-tracker.html`'s Notes textarea), despite
`attachVoiceDictation()` (`tools-media-sharing.js`) being a fully
built, self-contained mic-button utility. Extended to
`contract-generator.html`'s 3 long-form scope-description textareas
(`pwo_description`/`stpa_description`/`ltsa_description`) -- typing a
full contract scope one-handed at a job site is exactly the friction
this feature exists to remove, and it was sitting completely unused
right next to the one page that already proved it works. Mirrored
job-tracker.html's exact markup pattern (a `position:relative` wrapper,
a `display:none`-until-supported mic button using the same shared
`#icon-mic` sprite `tools-nav-pwa.js` already injects on every page)
and wired all 3 calls inside `afterInitialSync()`, right after the
existing contract-log setup from round 1.

**Checked and deliberately not built**, since the round-1/round-2
"check the premise before building" lesson held again: long-press on
`review-request.html`'s sent-log rows (Left-a-Review/No-Response are
already directly visible buttons, same as invoice rows in round 2);
`animateRowExit` gaps that turned out to be a non-issue (the pages in
question have no row-delete-from-list pattern to animate at all);
`route-planner.html`, `clients.html` (an admin/lookup tool, not a
"feels native" priority page), `dev-tools.html`, and
`settings.html` didn't turn up comparable real gaps on inspection.

Extended `tests/tools/app-feel-haptics-longpress.test.js` (6 more
tests, 26 total): source-level assertions for all 3 haptic call sites
plus one real behavioral test for `setRequestStatus` (mocked `haptic`,
asserts it fires for `received` and not for `no_response`/`sent`), and
source-level assertions for the voice-dictation markup + wiring on all
3 contract-generator.html fields.

Verified: full suite 2713/2714 (only the known check-links.py
sandbox-proxy issue), `check-consistency`/`check-undefined-vars` clean.

## 2026-09-22 (later still) -- app shell v2 visuals: a hex ( + ), an app-grid drawer, one-row headers

Cross-logged from features.md (Workspace rework, part 1). Visual calls:
- The ( + ) is the brand's hexagon, solid orange, lifted 10px above the
  bar (not 14: at 14 its label sat 4px higher than its neighbours'). It
  rotates 45deg into an x while its sheet is open; reduced-motion drops
  the transition, not the state.
- Sheets slide up 40px with a fade (.26s, the same ease-out curve the
  swipe-to-dismiss spring uses); on desktop the Create sheet pops in as
  a centred dialog instead. Both reuse `attachSwipeToDismiss` where
  tools-media-sharing.js is loaded (not on runway -- guarded).
- The More drawer became a 3-column tile grid (icon over label, 92px
  tiles) with two quiet utility rows under a rule; the old one-per-row
  list with group labels read like a settings screen, not a launcher.
- Header status on phones: the live-sync badge keeps its dot and
  hides its words (still in the title tooltip, still tappable to retry);
  "Unsynced changes" becomes a bare orange dot via `font-size:0` +
  `::before`. The width-clipping approach tried first showed half a "U".
- Titles never wrap now (`nowrap` + ellipsis, `.hub-header-left {
  min-width:0 }`), which is what let Reviews/Contracts sit on one row.
- Checked light mode for every new surface: tiles, drawer, switch, and
  the ( + ) all read from tokens, nothing hard-coded to dark except the
  #1a0d02 glyph colour on orange, same as the active nav icon.

## 2026-09-22 (later still) -- the shared list row, first used by the Clients directory

- One row component (`.th-row`, styles-tools.css): a 42px hex avatar
  with initials (a solid orange hex when the client owes money, so "who
  owes me" reads before any text does), a title over a one-line subtitle,
  then a pill and at most one icon button. The icon button sits outside
  the row's link on purpose; a tap on Call must never also open the
  record.
- Money pills: orange tint for "owed, not due yet", red tint and the
  word "due" once overdue. Same two states the Dashboard's Money Owed
  card uses, so the colour means the same thing everywhere.
- "Job today" / "Job tomorrow" in the subtitle are orange and bold; later
  dates stay dim. The one piece of the line that changes what you do
  today gets the colour.
- A-Z gets sticky letter headers; the offset is keyed to the sticky tab
  bar's bottom (phone and desktop values differ).
- Gotcha: a `<section>` on a tool page inherits the public site's
  section padding from styles.css (about 90px of blank space). Use a div.
- Desktop: the shared `body.th-tool-page` padding had been beating every
  page's own 75px desktop rule, so a shared rule now restores it. Sticky
  tabs on desktop use 73px (just under the 61px fixed header) instead of
  the phone's notch offset.

## 2026-09-22 (later still) -- job cards: badges by exception, relative dates, one compact row

- Card action row below 1024px (and on board cards at every width):
  Done (filled tint, 92px) + 40px round Call / Directions + ⋯ pushed
  right. Round buttons match the header's Search / More circles.
- Badges by exception: the left border already carries priority, so
  MEDIUM / LOW / NOT STARTED pills are hidden on phones. HIGH and IN
  PROGRESS remain, which mark what's unusual.
- The date in the meta line is bold white ("Today") ahead of the dim
  client name; the address drops to its own ellipsised line.
- Date-group headers use the same 12px uppercase Oswald as the More
  drawer's section titles. Today is orange and Overdue is red, the same
  two accents the Clients list uses for "soon" and "overdue".
- Job Detail's badges had no base `.badge` rule on that page and showed
  as plain lowercase words ("high Not Started"). The rule was copied
  from Job Tracker.

## 2026-09-22 (later still) -- the invoice list: three tiles, pills, one amount per row

- Three tiles above the list (`.inv-summary`, 3-column grid at every
  width). Owed is orange, Overdue is red when non-zero, and the month
  tile is plain white. Amounts of $1,000 or more drop the cents so a
  tile never wraps at 360px. The two tappable tiles get an orange
  inset ring while their filter is on.
- Rows reuse `.th-row` / `.th-row-link` / `.th-row-avatar` from the
  Clients list. The avatar is filled orange while money is owed, so
  the list reads like the Clients directory.
- The right edge is the amount still owed (the total, once paid) over
  one pill. New shared variants: `.th-pill.is-paid` (the old blue
  Paid badge colour) and `.th-pill.is-muted` (Pending).
- The subtitle shows either the due state or the date, never both. At
  390px "#INV-1041 · Aug 13 · 25 days overdue" ellipsised the part
  that mattered, which a screenshot caught.
- Desktop (1024px and up) keeps Resend / Mark Paid / Delete at the end
  of each row. Below that they are in the sheet.
- The tab strip reads Invoices | New invoice | New quote | Quick
  charge. At 390px the last tab scrolls, the same as Finance's strip.
  Quick charge is also on the + sheet.

## 2026-09-22 (later still) -- money pills and the job track

- **Money pills** reuse each page's badge shape. To invoice is the only
  loud one: a solid orange gradient link, since it's the only one that
  asks for action. Invoiced is blue, Overdue red, Paid green, No charge
  muted. Client Detail uses the shared `.th-pill` equivalents.
- **Finished-but-unbilled cards** drop the 55% "history" dimming
  (`.is-done.needs-invoice`), so the call to action isn't greyed out.
- **Phone card badges** wrap under the title instead of squeezing it to
  three lines. The Done badge hides on phones; the strikethrough
  already says it.
- **Job Detail track:** five hex dots on a line (`--hex` clip-path).
  Reached dots are the orange gradient with an orange connector; the
  next step is an orange ring that pulses (off under reduced motion);
  the whole track goes green once paid. The next-step panel is tinted
  orange for to-invoice (and for a booked job that's past its date) and
  red for overdue.
- **Dashboard rows:** Ready to invoice reuses the inbox's
  `.dash-list-item` with the `is-unread` highlight for a week or older.
  Invoice is a link styled as the Mark paid pill, beside a small round
  ⋯. The Money Owed card's To invoice line is orange, a to-do rather
  than a debt.

## 2026-09-22 (later still) -- portal: visit date tiles, chat threads, unread badges, activity timeline

Visual half of the portal visits/messages pass (behaviour and schema are
in `features.md`'s entry of the same date). Checked in real headless
Chromium against a local static server with Supabase mocked, at 390px
and 1280px (the portal is dark-only; no light theme to check).

- **One accent per meaning, reused everywhere.** Blue = a scheduled
  visit (Home hero, the quote card's visit block, a booked check-up),
  orange = something owed or awaiting the client, green = done/paid.
  Cancelled visits borrow the existing amber (`#ffa726`), past ones go
  neutral. Same calendar-style month/day tile in all three places.
- **Uppercase `.btn` doesn't fit two-across on a phone.** First shot
  clipped "ADD TO CALENDA". The portal convention is that `.btn` is
  uppercase and letter-spaced, so rather than special-casing the text,
  hero and quote-visit actions are both real `.btn`s (primary +
  `secondary-btn`) that stack full-width under 520px/640px.
- **Don't reuse `.checkup-due-label` for a sentence.** portal-polish.css
  styles it as an uppercase status pill; "Booked for Thursday, October
  1 at 10:00 AM" became a shouting badge. Booked state has its own
  kicker + plain-weight time instead.
- **Chat threads:** bubbles with a tail corner, sender named only on
  change, time under each bubble, day dividers, one combined
  "Yesterday · New" divider when the unread run starts a new day (two
  stacked dividers looked like a rendering glitch), 380px max height
  with a 14px top mask so a scrolled thread fades rather than slicing a
  bubble at the border. Composer is a rounded field with a round send
  button that pulses while sending (off under reduced motion).
- **Badges:** nav badge is a real element (not `::after`, which the
  active-tab dot already owns), with a 2px background ring and a small
  pop-in; the Messages toggle became a pill with an icon and an orange
  "N new" count instead of an underlined text link.
- **Recent Activity:** a thin rail with 28px icon dots, text left,
  relative time right, single-line ellipsis so long titles never wrap
  the row.

## 2026-09-22 (later still) -- From this job panel

- **The panel:** an orange-tinted card over the line items, with a
  receipt icon and "From this job", then the job's title dimmed. Each
  line is a panel-colour row: a large orange checkbox (`accent-color`),
  the description over a dim note ("Receipt, Home Depot · Sep 20 · at
  cost"), and the amount right-aligned. Unticked rows fade to 72%.
- **The rows are `<label>`s**, so the whole row toggles. That means
  undoing the form's uppercase label style (`text-transform`,
  `letter-spacing`), which a screenshot caught.
- **The ask-for-hours row** is a div, not a label, since it holds its
  own inputs. The checkbox, text and amount sit on line one; the
  hours/rate inputs wrap to their own line under the text (flex
  `order` + `flex-basis: 100%`). At 390px they had squeezed the text
  into a one-word column.
- **Bill the quote** is the primary button when a quote is on offer.
  The logged-lines Add button turns secondary and sits under an "or
  build it from what was logged" rule.
- **After Add**, the card turns into a single green-tinted confirmation
  line ("Added 4 lines from the job · $251.49.") with Undo.

## 2026-09-22 (later still) -- quick add in the Create sheet

- **The field:** one 52px field at the top of the Create sheet, with an
  orange bolt icon, the input, and a round mic button. It gets an orange
  focus ring. The placeholder was shortened to fit 390px ("Try: sink
  leak for Sarah tomorrow").
- **While there's text,** the nine tiles hide (`.is-typing`) and the
  preview card takes their place, so on a phone the sheet stays short
  above the keyboard.
- **The preview card:** orange-tinted, with a small caps kind label
  (NEW JOB / INVOICE / QUOTE / EXPENSE, with its tile's icon), then the
  title at 18px, then one chip per fact (client, date, time, amount,
  vendor, address, phone, urgency), then a full-width primary button
  naming the action ("Fill in the job ›"). A known client's chip icon is
  green; an address that came from the client record is dimmed; urgent
  is red.
- **Listening:** the mic turns solid orange and pulses (off under
  reduced motion).
- **Runway Dashboard** keeps its own copy of the shell CSS, so the block
  is mirrored there.

## 2026-09-22 (later still) -- portal desktop shell + Settings menu

- **Sidebar:** 252px fixed rail, content centred in the remaining space
  up to a 1180px measure (`--portal-gutter = max(40px, (100vw - rail -
  measure) / 2)`). Active tab = orange tint + the phone bar's dot
  re-used as a 3px left bar. Header drops the logo and Settings icon on
  desktop (the rail has both) and the title goes to 26px.
- **Never use `<section>` inside portal layouts.** `styles.css` gives
  every section `padding: 88px 0` and `section + section` a top border
  -- it pushed Home's side column 120px down with a stray line. Plain
  divs.
- **Button rows wrap on their own width** (`flex: 1 1 280px`), not a
  viewport query: a quote card in the two-across grid is narrow at
  1440px, and "RESCHEDULE OR CANCEL" (uppercase, letter-spaced) clipped
  there under the old breakpoint.
- **Settings:** profile card (48px orange-gradient initials avatar) +
  one grouped menu card; rows are 36px orange-tint icon tiles, title,
  status line (two-line clamp, not an ellipsis -- "expiring soon" was
  getting cut on the 300px desktop column), chevron. Status colours:
  red for a card problem, green for "Two-factor on"/"Used N times".
  Desktop form buttons go auto-width (min 220px): a 700px-wide button
  read as a banner. Signed Authorizations uses the portal-wide
  `<summary>` chevron from `portal-polish.css`, not its own -- the
  global `body.portal-page details > summary` rule out-specifies a
  page-level one anyway.

## 2026-09-22 (later still) -- "Triple H replied" bar

Orange-tint card with a 3px orange left edge (same language as Home's
Needs Your Attention), a 34px chat icon tile, a bold heading ("Triple H
replied", or "... · N new messages"), then one full-width button row per
conversation: title, orange "N new" pill, "Open ›". The first version
right-aligned "Open" -- fine on a phone, but on a 1500px desktop bar it
sat a screen-width away from the title it opens, so title/pill/Open are
grouped left now. Rows use a -10px left margin so the text lines up
with the heading while keeping a padded hover/tap area (44px min
height).

## 2026-09-23 -- Paste chip under quick add

- **Paste a client's text:** a 34px pill under the quick add field,
  with an orange tint, orange text and a clipboard icon. It only renders
  where the clipboard API exists, and hides while there's text (the
  same `.is-typing` that hides the tiles).
- It started as a grey button inside the field. At 390px that squeezed
  the input to about 20 characters and cut the placeholder mid-word, so
  it moved under the field and got a label that says what it's for.
- **Runway Dashboard** mirrors the rule, as with the rest of the shell
  CSS.

## 2026-09-23 (later) -- the On the clock bar, the job's clock, the Stop sheet

- **The bar:** a 56px frosted pill with an orange border, 94px up from
  the bottom on a phone (the bottom bar is about 85px tall; at 84px the
  two touched), full width with 12px gutters.
  - Contents: a pulsing orange dot, a small-caps orange ON THE CLOCK
    over the job · client (ellipsis), the time at 20px in tabular
    figures so it doesn't jitter, and a solid orange Stop.
  - On a computer: 360px, bottom-right.
  - While it shows, the page's bottom padding and the toasts move up to
    clear it.
- **Job detail:** a card under the tracker. Idle, it's a line ("Time it
  as you work, and the invoice's labor line fills itself in.") and a
  secondary **Start the clock** with a play icon. Running, it turns
  orange-tinted with a 34px ticking time, "On the clock since 9:02 AM",
  and a primary Stop. A **Time** section lists each visit.
- **Stop sheet:** the sheet title is normally a small-caps label, which
  set "1 H 24 MIN" in capitals. For the clock it's a 24px headline
  duration over "on <job>", then a dim "Added 1.4 h · 2.9 h on this job
  so far".
- **Jobs row:** an orange-outlined **On the clock** badge with its own
  small pulsing dot.
- New sprite icons: `clock`, `play`, `stop` (the last two filled).
- Reduced motion turns off every pulse. The Runway Dashboard mirrors
  the bar's CSS.

## 2026-09-23 (later still) -- Remind, and the reminder sheet

- **Money Owed rows:** a solid orange **REMIND** pill beside the outlined
  MARK PAID on invoices that are due or late. It's solid because on a
  late invoice it's the next step. After a reminder, a dim "Reminded
  today" line sits under the amount line.
- **The sheet:**
  - an orange small-caps kicker with the tone (FOLLOWING UP, then FIRM
    REMINDER · REMINDER 2);
  - "Remind Bill Adams" at 20px, then a dim "#INV-1041 · $285.00 owed ·
    25 days overdue";
  - the message in a 136px editable box at 15px / 1.5, with an orange
    focus ring;
  - Text <name> (primary, message icon), Email (mail icon, new in the
    sprite) and Copy (clipboard icon), three equal 48px buttons side by
    side. With no phone, Email becomes the primary.
  - With neither a phone nor an email, only Copy shows, with a line
    saying why.
- **Invoice rows and the job line** add "· reminded 3 days ago" in
  their existing dim text. The overdue job's line leads with a primary
  **Send a reminder**, and See invoice drops to secondary.

## 2026-09-23 (evening) -- the Your week card

- One card under the daily-actions strip: a dim small-caps YOUR WEEK
  with the date range on the right, then the chart and the figures.
- **Bars:** rounded 84px tracks (72px on a phone) in the panel's second
  tone, filled from the bottom with the orange gradient the Create
  button uses. Hours sit above each bar in 10.5px tabular figures and
  the day letter below. Today's letter and figure are orange; days to
  come are dashed outlines.
- **Figures:** the display face at 24px (21px on a phone), a 12.5px
  label, and a dim "Last week …" line. While a clock runs, a small
  pulsing dot sits before "On the clock" (off under reduced motion).
- **Layout:**
  - On a phone the card stacks, with the bars full width in seven equal
    columns and the three figures in a row.
  - On a computer the bars stretch (up to 620px) with the figures
    grouped beside them.
  - The first desktop version kept the bars at 26px and spread the
    figures across the full card, which left a wide dead gap; the chart
    now takes the room instead.

## 2026-09-23 (evening) -- the client text sheet, and On my way

- **The sheet** shares the reminder sheet's head, message box and button
  row:
  - "Text Sarah Miller" at 20px, then the job and the last text sent,
    dim;
  - a row of pill chips for the texts (36px tall, 14px, semibold);
  - a row of smaller time chips (32px, tabular figures);
  - the message box, shorter here (104px), since these texts are one or
    two lines;
  - Send to <name> (primary) beside Copy.
- **Pressed chips** get the same orange as a running clock: an orange-dark
  border on the orange tint, with orange-light text.
- **Next Job:** **On my way** (secondary, message icon) sits right after
  Open Job, before Start the clock. It's hidden while that job's clock is
  already running.

## 2026-09-23 (evening) -- service history PDF, Home card grid

- **PDF look:** reuses the Invoices receipt band (navy, logo, TRIPLE H /
  ENTERPRISES, orange doc title right) so a client's paperwork from us
  reads as one set. Continuation pages get a slim 54pt band with the
  client's name and a repeated table head; orange rule + "Page N of M"
  footer on every page. Active warranty in green under the job, UNPAID
  in small orange caps under the amount.
- **Home account cards:** five cards never leave a hole now -- 3 + 2
  across on a 6-track grid (860-1199px), and a lone fifth card spans the
  row on a phone. `:where()` so the 1200px compact-row layout still wins.
- **"Need to cancel?"** is a quiet underlined text button, right-aligned
  under Messages -- not a second full-width button competing with
  Messages on a card that's otherwise progressing normally.

## 2026-09-22 (later still) -- booking flow round 1: availability strip + the "you're booked" moment

- **Date strip.** A second line under each day: `N open` in
  `--success-text` green, `Full`/`Closed` dimmed. Unavailable days go to
  0.45 opacity with `cursor:not-allowed`. The selected day turns the
  count orange. While loading, each count is a pulsing 34x8 bar and the
  slot grid shows four pulsing skeleton tiles, plus an sr-only "Loading
  available times...".
- **Confirmation choreography**, scoped to `.is-celebrating`:
  - 0s: the existing check pops
  - .35s: it draws
  - .55s: a ring pulses out
  - .45/.55s: headline and lead rise
  - .7s: the card lands with `stampIn` (1.06 scale, -0.6deg, overshoot)
  - .9s: the calendar buttons
  - 1.1-1.4s: the next-steps items stagger in, and the first dot fills orange
  - 1.5s: everything else
  - at ~.38s: `bookingCelebrate()` bursts 28 brand-colored flecks (dots
    and slivers) from the check (Web Animations API), plus a
    `navigator.vibrate` tap where supported

  Reduced motion skips the burst and the vibrate, and zeroes the
  delays. The page-wide rule already zeroed the durations.
- **"Back to site" is now outline**, so Add to calendar is the one
  primary button on the screen.
- **Two pre-existing booking.html nits fixed:**
  - the programmatic focus on step panels drew a white ring around the
    whole panel on deep links (`.step-panel:focus{outline:none}`; they
    are screen-reader targets, not controls)
  - the sticky bar's Book link was underlined, because this page's
    local copy lacked `text-decoration:none`
- **manage-booking.html.**
  - The success badge is the same green circle with a drawn check
    (`.checkmark.is-success`) instead of the orange hex with a glyph.
  - "Tomorrow" / "In N days" appears as an orange pill on the booking card.
  - The reschedule confirm panel is orange-tinted.
  - The calendar buttons stay on one line and stack under 420px
    ("GOOGLE CALENDAR" wrapped at 390px).
- Checked in headless Chromium at 390px and 1440px: no horizontal
  overflow and no page errors.

## 2026-09-22 (later still) -- booking flow round 3: the manage link and the "already booked" banner

- **Confirmation.** A `.conf-manage` line sits under the appointment
  card: 14px body text with an orange-light underlined link. It rises
  in at .95s with the rest of the choreography, between the card
  (.7s) and the calendar buttons.
- **"You're already booked" banner** at the top of `booking.html`:
  - a green-tinted panel with a 32px `--success-text` circle holding a
    drawn check
  - the title in the UI font, then "Service · **day at time**" with
    the time in green
  - "Reschedule or cancel" as an orange-light underlined link, then a
    small dim "Not you? Forget this device" text button
  - `role="status"` and `[hidden]` until the server confirms the visit,
    so it never flashes on a stale record
- Checked in headless Chromium at 390px and 1440px: no horizontal
  overflow and no page errors.

## 2026-09-22 (later still) -- booking flow round 4: the portal pickers

- **Date strip** on `quotes.html`, `jobs.html` and `work-orders.html`:
  - The same second line as `booking.html`, scaled to the portal's
    60px day buttons: 10px `N open` in `--success-text` green, turning
    orange-light on the selected day.
  - `Full`/`Closed`/`No times` dimmed; those days sit at 0.45 opacity
    with `cursor:not-allowed`.
  - A 30x7 pulsing bar while loading, and four 40px pulsing skeleton
    tiles in the slot grid.
  - Page-local CSS (`bookingSkelPulse`); reduced motion stops both
    pulses.
- **Messages** in the slot grid (`.booking-picker-msg`): 13px dim,
  centered, spanning the grid. The error is `#e05252`, the same red as
  `.schedule-error`. Try again is a full-width `.slot-btn`. "Nothing
  open online" has orange-light underlined Call/Text links.
- **After scheduling:**
  - Quotes: the "Job scheduled" card scrolls to center, the quote card
    runs the existing `.is-highlighted` tint pulse, and the burst fires
    from the card's date tile at ~120ms.
  - Jobs: the same burst from the "Visit booked" banner's date tile.
- Checked in headless Chromium at 390px and 1440px (desktop: the
  check-up panel in the new side column): no horizontal overflow, no
  page errors.

## 2026-09-23 (night) -- public-site audit, then round 1: the service-page blog cards

A fresh audit of every public page in a real browser (1440px and
375px, dark, light and reduced motion). Findings and the round plan
went to Connor in chat. Round 1 shipped the worst one.

**Round 1.** Plumbing, drywall, handyman-repairs and assembly use the
`.blog-index-item` card ("Recent Notes From the Shop") without loading
`blog/blog.css`. Every rule for that card lives there, so the icon SVG
and arrow grew to fill the card: 820px on desktop. Each page now loads
`blog.css`, like the other four service pages. The new test in
`tests/design/blog-index-cards.test.js` covers any page that uses the
markup.

**Method notes for the next audit:**
- **Fonts.** Playwright's Chromium doesn't use the sandbox proxy, so
  webfonts silently fail and every shot shows fallback faces. The
  computed `font-family` still says "Anton", so it's easy to miss. Pass
  the Google Fonts requests through a route handler that fetches them
  from Node (`NODE_USE_ENV_PROXY=1`). Don't set Playwright's `proxy`
  option: it sends 127.0.0.1 through the proxy too, and the page comes
  back as a 405.
- **Contrast.** axe reports light-mode failures on every page against
  `#0a0a0a`, the inline anti-flash colour on `<html>`. The real
  background is the fixed `.bg-blueprint` layer. Override `<html>` to
  the light `--bg` before running axe. With that done, only one real
  light-mode failure was left (careers "(optional)", 2.73:1).
- **Fallback-font timing.** `page.screenshot()` waits for webfonts. To
  capture the pre-swap frame, use a raw CDP
  `Page.captureScreenshot`.
- **Stylesheet isolation.** To prove a stylesheet changes nothing
  else, snapshot every computed property of every element with the
  sheet enabled and disabled (`sheet.disabled = true`), then diff.
  That's more reliable than comparing screenshots.

<!-- Add new entries above this line -->
