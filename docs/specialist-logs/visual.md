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

## 2026-09-24 -- client PDFs: one print letterhead in js/pdf-layout.js

- **Everything draws through `js/pdf-layout.js`** (moved from tools/ so the portal can load it; the portal must never load /tools/ scripts). Add a document by composing `drawPdfHeader` (letterhead + title/meta), `pdfDrawInfoColumns`, `drawPdfTable`, `pdfDrawSummary` / `drawPdfTotalsBlock`, `pdfDrawNoteBox`, then `pdfFinalize`. Don't hand-draw a masthead on a page again.
- **Primitives only**: text/line/rect/addImage and set* calls, with `addFileToVFS`/`addFont` feature-checked. The test suite's fake jsPDF docs only implement those, so roundedRect/circle/GState would break them.
- **Fonts**: `fonts/pdf/*.ttf` are fontTools static instances plus Latin subsets of the Google Fonts variable files (Oswald wght 500, Archivo wght 400/600 wdth 100). To add a glyph, rebuild the subset; don't swap in the variable TTF (jsPDF uses only the default instance).
- **Letter-spaced labels** go through `pdfSpacedText`: jsPDF's charSpace plus align:'right' mis-measures.
- **Stamps** sit in the space left of the summary column, and the summary block reserves that space, so a stamp can't collide with text.
- **No street address, and no owner-only notes, on client documents** (owner's decision 2026-09-24).
- **Verifying**: render with real jsPDF in jsdom from the actual page functions, then look at the pdftoppm output. The DOM screenshot tools can't see PDF layout.

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

**Update 2026-09-25: this root cause didn't hold up on re-test.** On
this exact pre-fix code (`fb869e65^`), headless Chromium 141 loaded
61/61 with native lazy after any real scroll (`window.scrollTo` steps,
mouse wheel, smooth scroll, a jump to the bottom). The 0%-for-the-last-
categories pattern only came back when the viewport never moved:
`document.body.scrollTop` (a no-op here, `<html>` is the scroller) or a
`fullPage` screenshot. The page is now lazy-loaded by its own
IntersectionObserver; see the 2026-09-25 "Our Work gallery" entry
near the end of this file.

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

## 2026-09-23 (night) -- round 2: width-matched fallback fonts

Reworked the four fallback `@font-face` rules at the top of
`styles.css`. Full numbers are in README. What to know before touching
them again:

- **Match width, not cap-height.** CLS comes from line breaks moving,
  and with explicit line-heights the vertical metrics barely matter.
  Anton is 0.718 of Arial's width on its real headlines (letter-spacing
  included) and Oswald about 0.80. The old cap-height values (120% and
  113%) made the fallback 1.4-1.7x too wide.
- **Measure widths in the browser, at the real weights, case and
  letter-spacing.** hmtx averages were off by about 2%, enough to flip
  H1 wraps. Compare against the *regular* system face: a single-face
  `local()` fallback synthesizes bold without widening advances.
- **Oswald has one value but two cases.** Uppercase nav/buttons
  measure 0.76-0.79, mixed-case chips 0.85-0.90. Above ~80% the desktop
  nav wraps just above the 960px hamburger breakpoint (CLS 0.23 at
  1024), which moves the whole page, so the nav decides. The our-work
  filter chips on phones keep a small shift (0.087).
- **`local()` matches full or PostScript names only.** `local('Roboto')`
  resolves to nothing; `'Roboto Regular'`/`'Roboto-Regular'` work.
  Probe with `new FontFace('x', "local('Name')").load()` before trusting
  a name.
- **Chromium multiplies `*-override` by `size-adjust`.** Verified: 100%
  ascent at 50% size-adjust gives a 50px box. So override = metric ÷
  size-adjust.
- **`ch` caps can't be fixed by size-adjust.** The text and the cap
  scale together. `.hero-lede` moved from `64ch` to its exact final
  width, `640px`.
- **Glyphs the webfont lacks are drawn by the fallback forever.** Google's
  latin subset has ↑ and ↓ but not →. Size those for looks, not width,
  since they can't cause CLS. Oswald's arrows keep the old 113% via a
  `unicode-range: U+2190-21FF` face declared after the main one.
- **A `<select>` sizes its line box from the font stack, not just the
  glyphs drawn.** Production on Linux/Android rendered the hero Service
  dropdown 39px tall (unresolved fallback); Windows/Mac 46px. It's 46px
  everywhere now.
- **Left alone: a ~16px band around 995px wide on the homepage.** The two
  hero buttons fit side by side in the fallback and stack in Oswald,
  because Oswald's digits (the phone number) run ~7% wider relative to
  Arial than its letters do. A digit-only `unicode-range` face could fix
  it, but that's more machinery than one band of widths warrants.

**Harness notes:**
- Hold `fonts.gstatic.com` behind a promise and navigate with
  `waitUntil:'domcontentloaded'`. `load` waits on the held fonts and
  deadlocks.
- Emulate Windows/Mac by serving styles.css with `local('Arial')`
  rewritten to `local('Liberation Sans')` (metric-identical).
- Emulate Android with Roboto installed in `~/.local/share/fonts` and
  the Arial-metric sources renamed so they fail.
- Pixel-diff the site against itself first. Reveal and decode timing
  gives 600-900px of noise, so a diff of that size isn't a finding.

## 2026-09-23 (late) -- round 3: banners without the page jump

The WELCOME15 and hiring banners now load synchronously, directly after
the two banner divs, and each fits on one row with a 44px close button.
Numbers are in README. Worth knowing before touching them again:

- **`defer` was the shift.** Deferred scripts run after parsing finishes,
  and the browser paints in between, so the first paint had empty
  banners. Filling them afterwards pushed the header and hero down 85px
  on desktop (CLS 0.059 on every first visit). A parser-blocking script
  right after the divs runs before `<header>` exists. Everything above
  it (`.bg-blueprint`, `.skip-link`, `.motto-rail`) is out of flow, so
  the first paint that includes the header already has the banners at
  full size.
- **Keep both files tiny and network-free, and never add defer or async
  back.** They now block rendering. Each has a header comment saying so.
- **The `?v=` stamp is part of the fix.** The root service worker serves
  stamped requests cache-first and sends unstamped ones to the network
  with `cache:'reload'`. `hiring-banner.js` had no stamp, so as a
  blocking script it would have cost a network trip on every page view.
  It's stamped and in `GLOBAL_SHARED_FILES` now. Verified: both banner
  files come from the service worker cache on a return visit.
- **The Site Content override still wins.** An admin-set banner1/banner2
  is written as plain text by the page's own `site_content` fetch, and it
  now always arrives after the script, so the order is deterministic.
  The one-row padding sits behind `.site-banner:has(> .site-banner-inner)`,
  so that plain text keeps its original `10px 20px` / `7px 14px`. When
  it arrives late it still shifts the page by the same amount as before;
  that's inherent to a fetched banner.
- **Mobile.** The inner row used to `flex-wrap`, which dropped the 21x20px
  close button onto its own centred line, making each banner 89px tall.
  Now the text stays left-aligned beside a 44x44px button, 47px per
  banner at both 375px and 320px. The focus ring is inset (`-2px`),
  because the global `+2px` offset would hide its bottom edge under the
  next banner. `.site-banner-keep` stops "$35–$100+" from breaking after
  the en dash.
- **Residual.** At 375px, about 0.002-0.004 of text reflows sideways
  when Oswald loads, with no change in banner height. That's the font
  swap; round 2 already made the fallback width-matched.
- **Not changed:** `locations/handyman-st-george-ut.html` has the
  banner divs but has never loaded either banner script (true since
  before the /locations/ move). Adding them is a product call.

**Harness notes:**
- Playwright runs the **last** matching `route()`. Register a
  catch-all abort before a specific stub, otherwise the stub never
  fires.
- An rAF loop that records each banner's computed `display` shows the
  parse order directly: `none/none → flex/none → flex/flex+H` means both
  banners were filled before the header existed.
- Don't read first-contentful-paint alone after a change like this. The
  banner text can now paint on its own first (FCP 2.1s → 1.5s on some
  runs), which is a different element, not a faster page. Compare LCP
  entries for the hero: 2.10s → 2.01s, no slower.

## 2026-09-23 (late) -- round 4: reduced motion reaches pseudo-elements, delays and JS scrolls

Found with `document.getAnimations()` under emulated reduced motion. It lists pseudo-element animations and reports each one's delay and fill.

- **`*` never matches `::before`/`::after`.** The global rule is now `*, *::before, *::after`. Before, these kept animating for reduced-motion visitors:
  - the homepage "open now" dot's infinite pulse (`openDotPulse` on `.dot::after`);
  - the process timeline's 0.9s draw (`.process::before`);
  - the blog/about h2 underline's 0.8s draw (`.blog-article h2::before`).
- **Zeroing durations isn't enough; delays count too.** The service-area diagram's spokes and nodes have staggered delays up to 1.15s with `fill: backwards`. So even at 0.001ms duration they sat hidden and then popped in. The rule now also sets `animation-delay:0s` and `transition-delay:0s`. Every delay in styles.css and blog.css is a reveal stagger, so nothing else relied on them.
- **The rule doesn't reach `::-webkit-slider-thumb`,** and it doesn't need to. The teardown and reveal "try me" pulses only start when the page script adds `.is-hinting`, which it never does for reduced motion. The styles.css comment that said otherwise is corrected.
- **JS `behavior:'smooth'` overrides CSS `scroll-behavior:auto`.** Back-to-top (`index.html`) and the triage result (`js/triage.js`) now pass `'auto'` under reduced motion. The service modal's scroll to `#schedule` is booking-lane code, so it's logged in `features.md`.
- **Result:** with reduced motion, the probe finds 0 perceptible animations on the homepage, about, a service page, a city page and a blog post (the homepage had 5). Settled screenshots under reduced motion are pixel-identical to before, apart from one strip of live text that differs between two loads of the *old* build too. Normal-motion behaviour is untouched, because the change sits inside the media query.

## 2026-09-23 (late) -- round 5: skip links everywhere, a landmark on 404

- **Skip link pattern:** `<a href="#main" class="skip-link">Skip to main content</a>`, placed straight after `.bg-blueprint` and before `<header>`, with `<main id="main">`. That's the `terms.html`/`privacy.html` pattern; index and the city/service pages use `#home` for the same thing. about, our-work and all 11 blog pages have it now. Before, a keyboard user needed 12-13 Tabs on desktop to get past the header, and 3 on a phone.
- **No `tabindex="-1"` on `<main>`.** Chromium moves the sequential-focus start to a fragment target without it, so the next Tab lands on the first link in main. Verified on each page, in both themes, at 1440 and 375.
- **`careers.html` still has no skip link.** It's waiting on the careers/privacy scope question to Connor, and `skip-link-and-main-landmark.test.js` excludes it with that reason. Adding it later is the same two-line edit. The booking pages are excluded too (booking lane).
- **404:** the content is wrapped in `<main>` (axe's `landmark-one-main` and `region` now pass). `main` repeats body's centred flex column, so nothing else moved. `h1` gets `font-weight:400`. Anton has only one weight, so the default h1 bold made Chrome synthesize a smeared bold. Any new standalone page using `--font-display` on a heading needs the same reset, because it doesn't get styles.css's `h1,h2,h3{font-weight:400}`.
- **Pixel diff against main:** identical except the 404 digits. Sub-1% gallery-caption noise on our-work also appears between two loads of main (lazy image decode).

## 2026-09-23 (late) -- round 6: the mobile menu stays dark in light mode

- **Pattern: pin tokens on an always-dark component.** The header and `.mobile-menu` are dark in both themes, but only their text colours were hardcoded, and everything else read theme tokens. `.mobile-menu` now redefines the four tokens its rules read that change in light mode: `--border`, `--text-dim`, `--bg-panel-3` and `--orange-text-vivid`. `mobile-menu-dark-panel.test.js` derives that list from the CSS, so a new menu rule that reads another themed token fails the test until it's pinned too.
- **Measure painted pixels, not computed backgrounds, on translucent panels.** `getComputedStyle` walks up to `rgb(10,10,10)` in both themes, but the glass header actually paints `#272727` over the light page. A solid `#2a2a2a` divider measured fine by computed colour and was invisible on screen (1.04:1). `rgba(255,255,255,.13)` paints 1.36:1 in dark mode and 1.49:1 in light.
- **Cascade bug: `.mobile-menu a` (<=960px, later in the file) out-ranked `.mobile-services-sublist a` by source order.** The sub-links' intended style from 2026-09-10 (13.5px, normal case, dim) never rendered. The links were also inline, so each got a text-width underline and their 14px padding overlapped their neighbours (51px boxes at a 31px pitch). The fix is a `.mobile-menu` prefix plus `display:block; padding:10px 4px`, giving 42px rows at a 44px pitch. Expanded lists get taller, but both start collapsed.
- **The row divider** under Services/Areas moved from the link to `.mobile-nav-row`, so it runs under the caret too.
- **Closed-menu pages are pixel-identical to main.** The dark-mode divider moves by one RGB step (42 to 41).

## 2026-09-23 (late) -- round 7: the 404 page's buttons join U01

- **Standalone pages miss site-wide style passes.** `404.html` (and `booking.html`, which is booking lane) carry their own copy of the button CSS, so U01's 2026-09-07 "retire the glossy buttons" pass never reached them. The 404 still had two equal-weight gradient pills, blue Home and orange Call.
- **Which button leads:** Call keeps the orange it already had here, now the flat `.btn.orange` fill with the `#c96400` 4px offset shadow. Home becomes the quieter `.btn.outline`. That's the hero's filled-plus-outline pairing, and it doesn't re-rank anything: the orange was already on Call. If Connor would rather Home lead on a 404, it's a two-class swap.
- **Copied from styles.css, not reinvented:** `.btn` sizing (15px 26px, 1.5px letter-spacing), hover lift, press scale, the site's blue focus ring, and a reduced-motion guard (this page doesn't get the global one). `404-button-language.test.js` compares the orange colours against styles.css's `:root`, so a palette change there fails the test until this copy follows.

## 2026-09-23 (late) -- round 8: no sticky hover on touch screens

- **Convention: any `:hover` that changes a surface goes inside `@media (hover:hover)`.** That means transform, box-shadow, border, background or filter. There are 31 such blocks in styles.css now. A phone applies `:hover` to whatever was last tapped and keeps it, so a tapped card stayed lifted with a blue border. `touch-no-sticky-hover.test.js` scans for unguarded surface hovers, so a new one fails.
- **Left unconditional on purpose:**
  - text-colour link hovers (harmless, and the tap usually navigates away);
  - `.nav-dropdown:hover` (on an iPad in landscape, tapping is how the desktop dropdown opens);
  - the scrollbar thumb.
  When a rule combined `:hover` with `:focus-visible`, it was split so keyboard focus still applies everywhere.
- **Press feedback on touch:** `:active` scale (.97/.98) on chips, pills, area links and gallery tiles, and .94 on the chat bubble. `.btn:active` already existed.
- **Found, not fixed, needs a call:** the hover *lift* on the homepage service cards, blog teasers and review cards has been dead code for a while. Their `[data-reveal]` rule `html.reveal-ready [data-reveal].is-visible{transform:translateY(0)}` (0,3,1) outranks `.service-card:hover` (0,2,0), so only the border and shadow change on hover; `.service-card:active` is also dead there. Making the lift work would change how the desktop homepage feels, so it's a design decision rather than polish. The city pages' service cards have no `data-reveal`, so theirs do lift.
- **blog.css not touched:** `.blog-index-item:hover, .blog-index-item:focus-visible` still lifts on tap. `blog-index-cards.test.js` pins that combined selector, so the split needs that test updated too. That's a small follow-up.
- **Harness notes:**
  - Playwright contexts with `hasTouch` report `(hover:hover)` false, so the media query can be tested directly.
  - Headless Chromium never sets `:active` for CDP touch events, even on the existing `.btn:active`. Test `:active` rules with a mouse press instead.
  - A tap that lifts an element 2px can move it off the tap point and clear `:hover`, which hides stickiness. Removing the lift exposed a colour-only hover (`.hero .btn.outline:hover`) that had been sticking all along.

## 2026-09-23 (late) -- round 9: blog cards join the no-sticky-hover rule

- `.blog-index-item` is used on the blog index and by the "Recent Notes" cards on 8 service pages. Its `:hover` and `:focus-visible` shared one rule, so a tapped card kept its blue border, deeper shadow and orange title. The hover half now sits in `@media (hover: hover)`. Focus keeps its own rule with identical values.
- `touch-no-sticky-hover.test.js` now also scans `blog/blog.css`. `blog-index-cards.test.js` checks the guarded hover and the focus rule separately, both still with `.service-card`'s values.
- **blog.css has a hand-picked `?v=` timestamp, not a content hash,** and `check-consistency.js` doesn't track it. So an edit means bumping all 22 references by hand (now `202609231020`). `blog-index-cards.test.js` fails if they disagree. Adding `blog/blog.css` to `GLOBAL_SHARED_FILES` would let `fix-versions` manage it; that's a small checker change for another round.
- The hover transform reads `none` on these cards too: `[data-reveal]` outranks it, the same as the homepage cards in round 8's note.

## 2026-09-23 (late) -- findings parked for a decision (not changed)

Measured and deliberately left alone. Each needs a call from Connor before anyone builds it.

- **The service-area diagram is unreadable on phones.** The SVG has a 760-unit viewBox, so at 375px every label renders at 8.2px (6.8px at 320px). "West side, near Snow Canyon" collides with "Home base", and the Mesquite note collides with "Leeds". There's a cascade bug too: in the <=760px block, `.radius-figure text{font-size:19px}` (0,1,1) outranks the intended `.radius-note{16px}` and `.radius-hub-name{21px}` (0,1,0). Fixing that alone makes the notes *smaller*, though. Hiding the notes on phones isn't safe either: the 8 city pages and 3 service pages show the diagram without the `.areas-links` list that repeats them. A real fix is a separate phone layout for the diagram. That's a design change tied to the open Leeds/La Verkin geography question.
- **Gallery weight: `our-work.html` loads ~4.1MB of photos up front on a phone.** *(Done 2026-09-25 with the IntersectionObserver option; see that entry.)* 48 of its 61 photos are 1152-1400px wide but shown at ~333px. Eager loading is deliberate (see 2026-09-16: native `loading="lazy"` drops ~40% of photos in the CSS-column masonry). The options are:
  - a ~720w `srcset` variant per photo (48 new files; helps 1x/2x screens, while 3x phones still pick the original);
  - an IntersectionObserver lazy-loader (the 09-16 entry rejected that as new machinery).
- **Header/footer logo: 50-57KB webp at 531-550px, shown at ~96px.** A ~300px variant would save ~40KB per first visit. But the same files are precached by both service workers and used across tools/portal, so it's a public-pages-only `srcset` job that touches ~65 img tags. **Done 2026-09-25**, see that entry.
- **Also logged in rounds 8-9:**
  - the homepage card hover lift is dead code (`[data-reveal]` outranks it);
  - `blog/blog.css` uses a hand-picked stamp outside `check-consistency.js`.

## 2026-09-23 (booking lane): the portal picker's CSS now lives once, in portal-polish.css

- **What moved.** `createBookingPicker()`'s styles, previously an identical page-local block on `quotes.html`, `jobs.html` and `work-orders.html`, are now section 25 of `portal-polish.css`. That covers the day labels (`.avail`), unavailable days, loading skeletons, the message/retry row, the pulse keyframes and the reduced-motion override. Nothing else in the portal uses those classes.
- **Look unchanged.** Every computed property of all 729 picker elements matches main in Chromium, on each page, loading / loaded / error / reduced motion. The only exception is the skeleton's `opacity` mid-animation, in the 4th decimal.
- **Where to change it.** The picker's look has one copy now, so edit it here and all three pages follow.

## 2026-09-23 (booking lane): the reduced-motion test's booking exception is gone

- `reduced-motion-coverage.test.js` exempted one line, the homepage's "or schedule online" smooth scroll (`BOOKING_LANE`), until the booking lane fixed it. #383 fixed it, so the exception matched nothing and has been removed, along with the check that used it.
- **The test is stricter now.** Every explicit smooth scroll on the public site must fall back to `auto` under reduced motion. There are no exceptions left. Putting the old line back into `index.html` makes the test fail and name the line.

## 2026-09-23 (night) -- tool page changes: the hold, tap feedback, Home without the splash

Asked for a branded loading state between tool pages, and a smooth return to Workspace. Findings and decisions:

- **Checked for app-shell work first.** An SPA-style content swap was rejected on 2026-09-21 (features.md: every page relies on full unload for cleanup). No branch or PR since has touched it. The view-transition "persistent shell" from that day was the thing that was meant to hide the reload.
- **Why that transition didn't hide it.** The transition snapshots the new page at `pagereveal`, and `tools-nav-pwa.js` runs after that point. It's the 8th deferred script, behind supabase-js. At 4x CPU in Chromium, the shell was missing at reveal on 15 of 15 navigations and arrived 150-220ms later, so the named bar/sidebar groups were exit-only.
  - Harness: `pagereveal` / MutationObserver timings plus a per-frame `document.getAnimations()` sampler on the `::view-transition-*` pseudos, and CDP screencast frames.
- **Tried `blocking="render"` on the nav-pwa tag.** It works in Chromium (shell present at reveal on 15 of 15), and removing the attribute on a timer releases the block, which I checked with a 3s stalled script.
  - Not shipped, for two reasons. It makes first paint wait on the whole deferred chain, CDN script included. And WebKit ignores `blocking`, and that's where the phones are.
  - Moving nav-pwa earlier in the defer order was also rejected. Its load-time renders (clock bar, shift button) quietly switch to storage-only paths when data-layer.js isn't loaded yet.
- **Shipped: a CSS hold keyed on `html:not(:has(body.th-tool-page))`.**
  - `inject()` adds that class in the same synchronous pass as the shell, and login.html gets it too.
  - While the selector matches, old(root) and old-only shell groups hold at opacity 1, and new(root) stays at 0. When the class lands, the UA fade-in/out start fresh (confirmed `@0/280` in the sampler).
  - The old-only bar keeps `th-vt-hold .28s`, gated by `html:has(.th-bottom-nav)` so login still fades it out. `:only-child` keeps this off paired groups, where plus-lighter would over-brighten them.
  - **Gotcha: the hold needs its own keyframe name (`th-vt-hold-wait`).** Changing only `animation-duration` on a running animation keeps its elapsed time, so the bar would vanish at release.
  - Capped at 1.2s, the valve. Reduced motion keeps the hold with `!important` at higher specificity and leaves the crossfade at 0.001ms.
- **Tap feedback.** The tapped tab lights before `pageswap` captures the old state, so the held bar already shows the right tab and nothing flips at the end. Without it, the active tab visibly jumped on the last frame.
  - The loading line appears after 150ms. It uses a transform sweep, like `.upload-progress-bar`, and holds still under reduced motion.
  - `env(safe-area-inset-top)` needs `max(..., 44px)`: `finance-split.test.js` enforces this on every use in styles-tools.css. It resets to `top: 0` at >=1024px, where the header has no notch.
- **Home.** `showWelcomeOverlay()` ran on every dashboard load, after sync, at z-index 9999 for 1.7s, and it blocked taps too: Playwright's click had to wait it out.
  - Now it shows once per `getCurrentUserEmail()` per sessionStorage.
  - Skeletons are baked into Next Job / Money Owed / Rest of Today and the greeting. The week card was left alone: it relies on `:empty { display:none }`, and `your-week.test.js` pins it empty.
- **Not verified:** Safari (only Chromium here). Everything used is standard in Safari 18.2+.
- **Parked, not changed:**
  - Light mode renders the Needs attention lane headers (`<header class="ops-lane-header">`) as black bars with dark text. The public site's bare `header{position:sticky...}` and its `::before` background in styles.css match them. Pre-existing; a one-selector fix for another round.
  - For a restricted role, the Money tab shows at first paint and hides when the role loads. That's fail-open by design (`applyMoneyPermissions`), but it's a small shell flicker.

<!-- Add new entries above this line -->

## 2026-09-28 -- Workspace W1: one app system (flat surfaces, rules, underline tabs, status dot, form sheets)
- Foundation layer of the v2 Workspace redesign (design handoff `design_handoff_workspace_app_v2`, package 1 of 5). Ships the shared layer W2-W5 build on: shared work, everything else deferred to its own package/PR.
- Append-only block at the end of `styles-tools.css`, every rule under `body.th-tool-page`. Nothing above it edited, so every first-match `@media` block and pinned rule text existing tests read is unchanged.
- Surfaces flattened to `--bg-panel` + 1px border + 10px radius. The gradient faces were what made every card read the same; rules and type carry the hierarchy now. Section labels are uppercase Oswald with a 2px rule to the edge.
- `html` background uses `linear-gradient(var(--bg),var(--bg))`, not `background-color`: every page's `<html>` has an inline dark FOUC colour that a `color` value would lose to in light mode.
- Status dot: `tools-nav-pwa.js` moves the page's own sync badge into `.th-status` via `mountStatusDot()`. Ids unchanged, so each page's `updateRealtimeBadge()`/`retryLiveSync()` keep working; badge text is visually hidden, not removed.
- Form sheets (`tools-effects.js`) key off the existing `.form-section.is-collapsed` + `toggleFormSection()` contract -- presentation only, visibility+transform transitions so closing animates too. Templates stay opted out via `data-th-inline` (they auto-open when due).
- Header/bottom-bar/sidebar edges are inset box-shadows, not borders, so no bar changes height (61px/65px/85px offsets stay true).
- Tour retarget (`tools-tour.js`): the Jobs step now targets `.th-sheet-trigger[aria-controls="jobFormSection"], #addJobBtn` (the new sheet trigger, with the literal id kept as a fallback). `scripts/check-consistency.js`'s `tourSelectorResolves()` couldn't statically verify that compound selector against job-tracker.html (job-tracker.html is W2's territory, untouched here; the trigger itself is injected by `tools-effects.js` at runtime with a computed id, not a literal string a static scanner can find) -- extended it with a small W1-specific branch that instead confirms a static `id="<id>"` on the wrapped `.form-section`, which is what actually guarantees the trigger gets created. Mirrors the existing precedent there for `tools-nav-pwa.js`/`tools-command-palette.js`-injected markup.
- Two of the five provided patch files (`tools/styles-tools.css.diff`, `tools/tools-effects.js.diff`) didn't apply cleanly via `git apply` -- stale EOF context, from `main` moving since the package was generated. Applied by hand instead, then diffed the result against the package's own full-file copies to confirm byte-identical (modulo trailing newline noise).
- Portal pages (9, sharing `styles-tools.css`) confirmed unaffected, structurally not just visually: they set `body.portal-page`, never `body.th-tool-page`, and never load `tools-nav-pwa.js` (the only script that adds that class) -- no rule in this whole block can match their DOM. Screenshotted `portal/home.html` and `portal/dashboard.html` anyway (light + dark, 390px) to confirm.
- One stray leftover found and fixed, unrelated to this change: `tools/dev-tools.html` had a fixture line (`console.log(thisIsDefinitelyNotARealVariableForTesting.property);`) permanently sitting in the working tree from an earlier interrupted run of `check-undefined-vars.test.js`'s mutate-then-restore fixture (the test writes it in, runs the checker, restores in a `finally` -- something interrupted a prior run before the restore). Removed; confirmed clean via a fresh isolated run of that test file (13/13) afterward.
- Verified: full suite 4254/4254 modulo the one known pre-existing `check-links.py` sandbox-proxy limitation (external hosts 403 through this environment's proxy, identical on main); `check-consistency`, `check-undefined-vars` both clean. Rule-1 audit (ids/names/data-*/hrefs/scripts, base vs. new) came back empty on all five touched files.

## 2026-09-24 -- Dev Tools regroup: 7 tabs by question, named sections, cards vs. rows

Layout/cleanup only; every panel's markup moved as-is (a script lifted each block and re-emitted it, then a check confirmed 14 panels byte-identical, 13 differing only by the added hint line, 5 with the deliberate changes below).

- **Grouping is by the question a panel answers**, not who can see it. Health (broken right now?), Data (clean, and can it come back?), Sync (this device), Notifications, Ops (deploys, to-do lists, shortcuts), Reports, Access. Client registry moved Access -> Data: it had only been on Access because it and Account permissions were the two Owner-visible panels. Owner now sees Data (Client registry only) + Access, lands on Data.
- **Two visual tiers inside a tab.** Always-open panels stay full cards (17px title, divider). `is-collapsible` panels are the tools: a full grid row each (so expanding never reflows neighbours), 15px title, no divider while closed, a one-line `.dev-panel-hint`. Made 4 more panels collapsible (Wiki health, Local data snapshot, SW & cache, Device info) using the exact existing wiring. Don't make Cron health, Flagged pages, or Backup & restore collapsible without updating tests that pin their exact markup (`onclick="openDevInfo('cronhealth')"`, the Flagged pages class string, `id="backup"` class string).
- **Section labels are `div role="group"`, never `<section>`**: styles.css gives every `section` 88px padding and a `section + section` border (the public site's layout). Hit this on the first render -- huge gaps and a stray rule between sections.
- **Hint letter-spacing**: `.dev-panel-heading` carries `.8px` letter-spacing for its all-caps title; the hint needs `letter-spacing: normal` or it looks tracked-out.
- **Source order trap**: the page's phone `@media` block sits above the collapsible-panel rules, so phone overrides for rows had to go in a second `@media` block at the end of the `<style>`.
- **Phone gutter is 12px** (`body.th-tool-page` in styles-tools.css beats this page's own `body { padding: 44px 14px }`). The tab bar's `-14px` margin overflowed 2px each side; now `-12px`. At 320px the 8-item bar still scrolls inside itself, same as before.
- Moved "Run full health check" from above every tab into the Health tab's lead row (it's a Health action; Owner no longer sees a button for checks they can't see).
- `initDevToolsTabs()` now looks for visible `.dev-panel`s inside a tab (tabs hold sections now) and hides a section whose panels are all hidden. `#backup` switches to `data`.

## 2026-09-24 (from the features lane, not fixed) -- the phone bottom nav covers the last ~9px of every tool page

Measured in Chromium at 430px while adding Delete to `client-detail.html`: `.th-bottom-nav` is 85px tall, but `body.th-has-bottomnav` (styles-tools.css, `@media (max-width: 1023px)`) reserves `calc(76px + env(safe-area-inset-bottom))`. Scrolled to the very bottom, the last card on client-detail, job-detail and the rest ends ~9px under the bar, and the raised (+) hex covers more in the middle. Fixed only locally for the new Delete block (its own `margin-bottom`). The shared fix is to raise the reserved padding to the bar's real height (or measure it), then re-check the `th-has-clock` variant (158px) too.

## 2026-09-24 -- "Update ready" card (its own look, not the install bar)

- **Distinct from the install bar on purpose:** an update is a heavier moment. It uses the same family as the tour card and Create sheet: panel gradient, orange-tint border and glow, a `.th-hex-icon` mark, and a 2px orange accent line on the top edge. Primary pill **Update** plus a ghost **Later** (both 40px tall), and a 32px X.
- **Motion:** it rises 20px from `scale(.97)` with a slight overshoot (`cubic-bezier(.2,.9,.25,1.12)`), and the refresh glyph turns -200deg to 0 once on entry, then spins while updating. Under reduced motion: opacity fade only, no turn.
- **Placement:**
  - Phone: `calc(85px + safe-area + 12px)`. At the shared `76px + 10px` it sat 1px off the bar, measured at 390px. This is the same 85-vs-76 gap logged above; the toast and tour card still use 76.
  - Desktop (>=1024): lower-right, `bottom: 76px`, so it sits above `.th-flag-btn` (44px at 16px) rather than over it. `th-has-bottomnav` stays on the body at desktop, so the override must also target `body.th-has-bottomnav .th-update-card`.
- **Light mode:** `--orange-light` is a dark orange there, so the Update pill gets its own lighter gradient (`#f07a1e` to `--orange`) so its dark text keeps contrast.
- **Install bar:** while the card is up it steps down out of view (`body:has(.th-update-card.is-shown)`) instead of stacking under it.

## 2026-09-25 -- Our Work gallery: an IntersectionObserver loader, not srcset

Picked up the "gallery weight" item parked on 2026-09-23. Measured on
main first: 61 photos, 4,122,565 bytes on first load at phone 3x, phone
2x and desktop alike (4,453,230 for the whole page).

- **Why not the 720w `srcset`:** a 333px column on a 3x phone needs
  ~1000px, so every current iPhone would still pick the original. That
  means 4.1MB for most phone visitors. It would also add 48 files, and
  every photo added later would need a variant made by hand.
- **What shipped:** the first category (4 photos) keeps a plain `src`.
  The other 57 have `data-src` and a viewBox-only SVG placeholder in
  `src`. An inline IntersectionObserver (`rootMargin: '800px 0px'`)
  swaps the real file in. With no IntersectionObserver, all load at
  once. IntersectionObserver was already used on index.html and in
  tools-nav-pwa.js, so the 09-16 "no existing pattern" point no longer
  applies.
- **The masonry trap that was real:** an `<img>` with alt text and no
  `src` renders as an alt-text box that ignores `width`/`height`. It
  measured 828px tall in a 333px column instead of 250px. With a bare
  `data-src` the columns would be wrong until each photo loaded, every
  arrival would reflow the page, and the short boxes would put most
  tiles "in view" at once. The placeholder SVG with the photo's own
  viewBox keeps each tile at its final height: 0 tiles changed height
  on load, and document height was identical before and after.
- **Re-testing 09-16:** native lazy wasn't the problem in real
  scrolling (see the update on that entry). It stays out anyway: its
  distance threshold belongs to the browser, and the new loader is what
  the tests guard.
- **Measured after** (headless Chromium, SW blocked, cache off): phone
  first load 4 photos / 269,925 bytes (-93%), page 608,721. Desktop
  first load 14 / 1,035,511 (-75%). After a real scroll-through: 61/61
  rendered. Every filter chip renders its whole category, other-work
  included. Jumping with End/Home skips tiles passed mid-animation,
  and each loads once scrolled to (normal for lazy loading). The
  lightbox is unchanged.
- **How to measure "did it render" on this page:** check
  `img.currentSrc` includes `/images/gallery/` plus `complete &&
  naturalWidth > 0`. The placeholder SVG also reports `complete`. Scroll
  with `window.scrollTo`, never `document.body.scrollTop`. When looping
  over tiles with `scrollIntoView`, wait a frame or more on each; a
  loop without waits skips tiles and looks exactly like the old bug.
- **Not covered:** no WebKit/Firefox in this sandbox, so tested on
  Chromium only. The markup relies only on widely supported behavior
  (IntersectionObserver, SVG intrinsic ratio). With JS off, the 57
  deferred tiles show the striped background only. Adding a
  `<noscript>` copy of each image wasn't worth 57 more tags.
- Test: `tests/design/our-work-gallery-lazy-load.test.js`. It fails if
  `loading=` returns to a gallery image, or if a placeholder's viewBox
  or `width`/`height` stops matching the real WebP's size (both checked
  by mutation).

## 2026-09-25 -- from the reports lane (SEO/technical audit, not fixed)

Alt text is 210/210 on the 34 sitemap pages, but 13 different photos
(`images/gallery/tile-finished-1.webp` .. `-13.webp`) all use the alt
"Finished tile flooring" on both `index.html` and `our-work.html`. Needs
someone looking at each photo to write a distinct alt (room, material,
finish).

## 2026-09-25 -- the service-area diagram's phone layout (the 09-23 parked finding, fixed)

- **Re-measured first; the log's numbers held.** Rendered sizes were 6.8px at 320, 8.18px at 375 and 8.55px at 390. One correction: the Mesquite note collides with Leeds's *note* ("About 20 minutes north"), not the name. New finding: the collisions come from label geometry in SVG units, so the old 19px block overlapped 10 labels at *every* width up to 760, not just on phones. City pages were worse: `.radius-figure[data-focus] .radius-name{15px}` (0,3,0) made names smaller than the 19px notes.
- **What shipped.** At <=760px, `text{display:none}` except the hub name, and every `g[data-city]` gets `translateY(30px) scale(1.5)` around the hub (`transform-box:view-box; transform-origin:380px 210px`). The labels become HTML:
  - `.radius-key` after the legend on the 11 pages without `.areas-links`;
  - the cards on the other 6, bumped to 17/16px (that rule has to come *after* the base `.areas-link` rules, as their specificity is equal).
  The key sits after the legend, not inside the figure, so the focus rules use `.radius-figure[data-focus=x] ~ .radius-key li[data-city=x]`.
- **Why not the alternatives.** Numbered node badges would need number markup in 17 SVGs and on the cards. A negative-margin crop fights flex shrink. A route-style spine list reads as a sequential route, not a hub. The group zoom stays inside the SVG's own viewport, so nothing outside the SVG changes.
- **The zoom window is the constraint.** It fits because every node sits within ~160 units of the hub. `service-area-phone-layout.test.js` recomputes every node's zoomed position, so a re-plot that leaves the window fails there instead of clipping silently.
- **The "open Leeds/La Verkin geography question".** It isn't written down anywhere under that name (searched docs/specialist-logs/, ACTION-ITEMS.md, README.md, PR history). My best reading, inferred rather than confirmed:
  - PR #205 put Leeds and La Verkin "in the two angular gaps the diagram's own code comments had already reserved", but the SVG comment says cities are placed by angle clockwise from north.
  - So Leeds sits at ~150 degrees (south-east of the hub) while its note says "About 20 minutes north", and La Verkin at ~300 degrees (north-west) while its note says "About 25 minutes east".
  - In real bearings, Cedar City, Leeds, Washington City, La Verkin and Hurricane all fall inside a ~40-degree wedge to the north-east, which is presumably why they were spread out.
  - That's a decision about node *positions*, for Connor. It didn't block this: the phone layout carries direction as text and reuses the same geometry, so a re-plot only has to move nodes and pass the zoom-fit test.
- **Also noticed, not changed:**
  - the 5 generic service pages' SVG still has only 5 cities (no Leeds/La Verkin), while their cards list all 7 (logged for content);
  - desktop SVG notes render at 11.8px (12.5px CSS x 0.947) -- pre-existing, above 760 and out of this scope.
- **Method notes:**
  - Use `t.getScreenCTM()` x font-size for true SVG text size; viewBox scale alone misses group transforms.
  - A collision check has to skip a label's own name/note pair, whose line boxes overlap even when the ink doesn't.
  - `fullPage` screenshots drop the fixed `.bg-blueprint` layer, so light mode comes out on `#0a0a0a`. Resize the viewport to the region and clip instead.

## 2026-09-25 -- public-page logo variants (176 / 288), tools and portal untouched

- **Real render sizes, measured (not the "~96px" guess):** header `.brand img` 44px, footer 38px, booking/manage-booking/manage-job header 38px, 404 mark 100px, homepage hero badge 96px at <=860px and ~421px on desktop (`min(440px, 100%)` of its column). Nothing else on a public page draws the logo.
- **The two files are different crops.** `logo-signature.webp` (550x506) has ~29px padding round the hex; `logo-signature-orange.webp` (531x488) is tight. Swapping one for the other would resize the mark, so each variant is made from its own original. That's why there are two 176s.
- **Shipped:** `logo-signature-176.webp` and `logo-signature-orange-176.webp` as plain `src` in every public header/footer (176 = 44 x 4). The hero and 404 use `srcset` 176w/288w/550w. The homepage header/footer carry `srcset` 176w/550w with `sizes="(max-width: 860px) 44px, 440px"`. That `sizes` over-states the desktop size on purpose so they pick the hero's 550 file (same URL, one download). Pointing them at the 176 would have added 8KB to the desktop homepage.
- **Dead end: a 300px file.** On a 3x phone the 96px hero drew it at 288 device px, a 0.96 resample. It lost ~20% of edge detail and visibly smeared the rivets and texture. An exact 288 (96 x 3) draws 1:1 and matches the original. **Rule for later variants: size them to an exact multiple of the CSS size, not a round number just above it.**
- **Also tried, not worth it:** unsharp mask on the 176 (sharper at 1x, over-sharp at 3x), an 88px 1x file, a 132px file. At 1x the 38px footer from the 176 is a hair softer than from the 550 at 5x zoom; at 1:1 they look the same.
- **Harness notes:**
  - With `srcset`, `img.naturalWidth` is density-corrected (a 288w file at `sizes=96px` reports 96). To get the real pixels, load `currentSrc` into a bare `new Image()`.
  - Pillow's RGBA `resize` already premultiplies, so no dark edge fringe. Checking that needs a per-channel float (`'F'` mode) reference; an RGBA reference built from premultiplied values gets premultiplied twice and reports a false -19 fringe.
  - Chromium picked 288w over 176w at DPR 2 for a 96px slot, so no geometric-mean down-pick to worry about there. At DPR 3.5 the hero takes the 550 and the 404 takes the 550 at 3x (it needs 300); neither is worse than before.
- **Not changed:** both service workers' precache lists and every tools/portal `<img>`. The new files aren't precached. Their `?v=` URLs are runtime-cached cache-first, and a precache entry without `?v=` wouldn't match the page's request anyway (see bugfix.md, same date).
- **Still open:** the desktop hero on a 2x screen needs ~843px and the master is 550px. That needs a bigger master file, not markup.
- Test: `tests/design/public-logo-variants.test.js`. It reads the `sizes` numbers from styles.css / 404.html, so a CSS size change fails it until the markup follows.

## 2026-09-25 -- Leeds and La Verkin moved to their real bearings (the "geography question", settled)

- **The question.** It was the one inferred in the phone-layout entry above: Leeds was drawn at 150 degrees and La Verkin at 300, against their "north"/"east" notes. Connor asked for them to be moved to their real places.
- **Real bearings** (town centres; Wikipedia is blocked from the sandbox, so via web search):
  - Leeds 52;
  - Washington City 63;
  - La Verkin 61-68 (sources differ);
  - Hurricane 72;
  - Cedar City 35;
  - Santa Clara/Ivins ~304;
  - Mesquite 233.
- **The constraint.** The first four sit in a ~20-degree wedge, and Washington City lies on the road to La Verkin, so they can't all be exact spokes.
  - With Washington City fixed at its old 44 degrees, the best collision-free spot for Leeds was 80 degrees: east, and *south* of La Verkin. Wrong.
  - Moving Washington City onto its own bearing (63) freed Leeds's true 52.
  - La Verkin then lands at 83: between Washington City and Hurricane, farther out than Hurricane, as it really is.
- **Method.** Brute force in Chromium, with the webfonts loaded:
  - every angle (1-degree steps), radius (5-unit steps) and label side (below / right / left / above);
  - real `getBBox()` label boxes with 6 units of padding;
  - reject any label overlap, any spoke through a label, anything within 8 degrees of another spoke, and any dot outside the phone zoom window;
  - score by distance from the true bearing, plus a small cost for off-centre labels.
  - The script is in this session's scratchpad (`place5.js`). It's worth re-creating it before placing any future city by hand.
- **Labels.** Leeds's label goes above its dot; Washington City's and La Verkin's go to the right. The old "every label centred" test became "aligned name+note pair on its own dot; only these three off-centre".
- **Left schematic** (not asked): Cedar City (329 vs ~35), Hurricane (93 vs ~72), Santa Clara & Ivins (264 vs ~304). Moving Cedar City into the north-east would crowd that wedge further.

## 2026-09-25 -- cross-surface audit (public site, portal, Workspace) and Phase 1

Asked for a consistency audit of all three surfaces, a ranked plan, and
only the top items built. The plan is in `docs/ACTION-ITEMS.md` under
"Cross-surface visual consistency plan (2026-09-25)". Phases 2 and 3 are
left there on purpose.

**Method, and what it couldn't do.** This session ran in a design sandbox
with read access to the repo, not the usual Playwright setup. Static
copies of 13 pages (scripts stripped, so no nav shell, auth or data) were
rendered at one ~910px viewport, dark and light, via a DOM-to-image
capture. It can't emulate a phone width, and it drops `<img>` and
`background-image` content. Every finding below was confirmed from the
CSS/markup itself; the screenshots only back up the ones they can show.
Phone widths, real fonts and pixel before/afters are listed in the PR
body for the Claude Code session that applies the patch.

Tags: impact (H/M/L) / effort (S/M/L).

### Cross-surface (the drift between the three)

All three load `styles.css`. Portal pages also load
`tools/styles-tools.css`, between `portal-app.css` and
`portal-polish.css`. Most drift comes from that stacking.

- **X1 [M/S-M] Three focus rings.** Public: 2px `--blue-light` + blue
  glow. Tools: global `:focus-visible` is 2px `--orange` + orange glow
  (styles-tools.css ~L1222), but `.tool-card/.small-btn/.tab-btn/.help-btn`
  override to the public blue (~L2601, comment "one focus treatment
  everywhere"), and a dozen components use `--orange-light`. Portal:
  blue inside `.portal-page`, tools' orange for anything outside it, and
  `.portal-reply-notice-item` orange-light. A keyboard user sees
  orange and blue rings on the same screen.
- **X2 [M/M] The no-sticky-hover convention stops at the public site.**
  styles.css has 31 `(hover:hover)` guards plus a test.
  styles-tools.css has 0 guards and 41 unguarded surface hovers.
  portal-app/-polish have 0 guards and 19 (6+13), including
  `.invoice-card/.quote-card:hover` lifts and `.btn:hover`
  translateY. Both surfaces are mostly used on phones.
- **X3 [M/L] Button language.** The public site retired the glossy
  gradient pills (U01, 2026-09-07) for flat orange + offset shadow.
  Tools (`.primary-btn`, `.th-install-action`, `.th-update-now`) and
  portal (`.btn.orange:hover` glow) still use gradient/glow. This is
  the most visible "dated vs. current" gap, but it is a look change on
  every tool page, so it needs Connor's call.
- **X4 [M/M-L] Bare element selectors in styles.css leak into the apps.**
  `header{position:sticky;z-index:60;border-bottom}` +
  `header::before{rgba(10,10,10,.88)}`, and `section` padding/borders,
  apply to every page that loads styles.css. Dev Tools already had to use
  `div role="group"` instead of `<section>` (2026-09-24). Workspace's lane
  headers were hit (fixed below); `runway-dashboard.html`'s
  `<header id="mainContent">` still gets the dark ::before bar and
  border (it overrides `position` only). The real fix is scoping the
  public element rules, which touches every public page, so it's Phase 3.
- **X5 [L/M] Empty/loading/error states have no shared vocabulary.**
  Empty: tools has 5 variants (`.empty-state`, `-small`, `.empty-note`,
  `.pr-empty`, `.ops-lane-clear`), the portal a dashed box, the public
  site none. Loading: tools shimmer (gradient), portal pulse +
  shimmer. Error: tools `#e05252` text with a warning glyph, toasts
  `#e0807a`. There is no `--danger`/`--success` token in the apps
  (public has `--success-text`). Not identical, but each is readable;
  worth unifying only alongside X3.
- **Checked, not worth changing:** border-radius spread (tools ~25
  distinct values, public ~10). Nobody notices it.

### Public site

Audited deeply 2026-09-23 to 09-25 (rounds 1-9, logo, gallery, diagram);
no new issues found in this pass. Still open from those entries:

- **P1 [M/S]** `blog/blog.css` hand-picked stamp (`202609231020`, 22
  refs) outside `check-consistency.js`. Same class of gap as PO1.
- **P2 [L/S, needs a call]** homepage card hover lift is dead code
  (`[data-reveal]` specificity).
- **P3 [L/S, needs a call]** `careers.html` has no skip link;
  `locations/handyman-st-george-ut.html` never loads the banner scripts.
- Desktop SVG notes at 11.8px (logged 09-25). Cosmetic, skipped.

### Client portal

- **PO1 [H/S] All 9 portal pages request `/tools/styles-tools.css?v=a494344e8c`;
  the file's hash is `ea55ae9760`.** `check-consistency.js` checks
  styles-tools.css only inside `tools/`, so the cross-directory
  references never got restamped. Returning clients get whichever copy
  their service worker cached under the old stamp. **Fixed (Phase 1).**
- **PO2 [H/S] `.small-btn` is 38px tall on phones.** styles-tools.css
  sets 44px at <=760px, but portal-polish.css loads after it with an
  unconditional `.small-btn{min-height:38px}` at equal specificity.
  That affects the buttons on jobs, work orders and settings, plus the
  ones portal-app.js renders. **Fixed (Phase 1).**
- **PO3 [L/S]** Skeletons animate twice: portal-app.css pulses the
  background (`skeleton-pulse`) and portal-polish.css runs a shimmer
  `::after` on top. Visible as a flicker on the first paint of every
  list. Phase 2.
- **PO4 [L/S]** `.th-toast` is defined in both portal-app.css and
  styles-tools.css. styles-tools loads later, so the portal's copy
  (`--bg-panel` background) is dead. Cleanup only.
- **PO5 [L/L]** The portal is dark-only (never sets `data-theme`). That's
  consistent with itself. Only worth doing if clients ask. Skipped.
- 15-17KB of inline `<style>` per portal page. This is where drift
  comes from, but moving it is a refactor with no visible change. Skipped.

### Workspace tools

- **T1 [H/S] Content hides under the phone bottom nav.** The bar
  measures 85px (2026-09-24 entry). Body padding, tour card, toast stack
  and install banner all reserved 76px, in styles-tools.css and in
  runway-dashboard.html's own copy. The last ~9px of every page, and
  the bottom edge of every toast, sat under the bar. **Fixed (Phase 1).**
  `.th-clock` (94px) and the `th-has-clock` 158px variant already
  cleared it and are unchanged.
- **T2 [H/S] Workspace "Needs attention" lane headers were black sticky
  bars in light mode** (labels unreadable, see screenshots). Cause is X4:
  `<header class="ops-lane-header">`. In dark mode the same bar was a
  near-invisible sticky strip at z-index 60 with a border. **Fixed
  (Phase 1)** by making them `<div>`s. Nothing in JS, CSS or the tests
  selects them by tag.
- **T3 [M/S] Loading skeletons vanish on gradient cards.**
  `.skeleton-line` is a `--bg-panel-2` to `--bg-panel` gradient,
  the same two stops as the card face. On Home's Next Job card (the
  first thing on screen) the three placeholder lines are invisible in
  both themes, so the card reads as empty while loading. Money Owed's
  skeleton, on a flatter face, shows. Phase 2: key the line colour to
  `--bg-panel-3`/`--border`.
- **T4 [M/S-M]** Workspace's Compliance edit forms are ~20 inline-styled
  inputs, not `.form-field`. They miss the 46px phone min-height and the
  shared focus treatment. Rarely used. Phase 2.
- **T5 [L/S]** 8 `:focus { outline:none }` rules on inputs rely on a
  border-colour change only (`.dialog-textarea`, `.dialog-field-input`,
  `.th-remind-text`, `.th-shift-input`; portal `.portal-prompt-textarea`).
  Visible, but weaker than the ring. Fold into X1.
- **T6 [L/S]** `.error-state`/toast colours are raw hex, not tokens. Fold
  into X5.

### Phase 1 decisions (this branch)

- **Picked PO1, PO2, T1, T2:** each is high impact (stale CSS for
  clients, sub-44px taps, hidden content, unreadable headers), each is
  small, and none changes how a working screen looks. X1-X3 are bigger
  and each needs a colour/look call first.
- **PO1 fix is `tools/styles-tools.css` in `GLOBAL_SHARED_FILES`**, the
  same move as `hiring-banner.js` on 09-23. The tools/ directory check
  still covers it too; both compute the same hash. That's a one-line
  change to a checker (automation lane), made here because it's what
  keeps the fix from regressing.
- **T1 uses the literal 85px**, the same as `.th-update-card` already
  does, not a custom property. `tablet-nav-band.test.js` pins the
  one-line rule form, and a variable would have meant rewriting that
  test's regex for no visible gain. The new test fails if any bottom-nav
  offset drops under 85.
- **T2: changed the markup, not the public `header` rule.** Scoping
  styles.css's element rules is the right long-term fix (X4). But it
  ripples across every public page and the visual snapshot baseline pins
  the header rule, so it's Phase 3.
- **PO2: a phone-only 44px rule right after the 38px default** in
  portal-polish.css. Desktop keeps 38.
- **Screenshots:** `docs/visual-audit-2026-09-25/` (before/after of the
  lane headers, portal and Workspace first paint). Phone-width
  before/afters for T1 and PO2 need the real Playwright harness; the
  PR body lists them.

## 2026-09-25 (later) -- client portal redesign, shell only: nav reorder, "Estimates"/"Visits" rename, raised Request hex

Design handoff (`docs/ACTION-ITEMS.md`'s new "Client portal redesign
(2026-09-25 design handoff)" entry has the full 11-screen breakdown and
what's deferred) asked for an 11-screen portal rebuild. Scoped down hard,
on purpose, per the brief's own instruction not to try all 11 in one pass:
this branch (`portal-redesign`) ships the shell only -- the one piece every
other screen depends on -- and defers the rest with specifics, rather than
half-migrating several screens. Two concurrent sessions were rebuilding
the public homepage and the Workspace tools shell in their own worktrees
at the same time; touched nothing under `index.html`, root `styles.css`,
or `tools/` except reading `tools/styles-tools.css` (unchanged, already
loaded by the portal).

**What shipped.** Bottom nav / desktop rail order changed from Home /
Request / Quotes / Invoices / Jobs to **Home / Invoices / Request /
Estimates / Visits**, matching the handoff. "Quotes" -> "Estimates" and
"Jobs" -> "Visits" (hrefs, file names and every element id are untouched --
only the visible label and tab order moved). Request is now a raised
filled-orange hexagon (CSS `clip-path`, not an SVG asset, so it inherits
the shared shadow/gradient language) floating above the bar, with a slow
"breathing" glow (`@media (hover: hover)` gated, and fully off under
`prefers-reduced-motion`) per the handoff's motion spec. Kept the original
circle+plus Request icon rather than inventing a new one -- it's reused in
3 empty states and a Home card already (confirmed by running the suite);
a stylized "+"-only mark would have meant restyling every one of those to
stay consistent, for no real visual gain inside a hex that already frames it.

Added an **Invoices tab dot** (`.portal-nav-dot`, `portalApplyNavInvoiceDot()`
in portal-app.js) shown when the client has any unpaid invoice. Wired only
on `home.html` and `dashboard.html`, which already fetch
`client_portal_invoices` for their own rendering -- deliberately did not
add a new query to the other 5 nav-bearing pages just to light this dot;
logged as a known gap rather than quietly fetching invoice rows on pages
that never needed them before.

**Real mistake caught by the desktop-shell tests, worth repeating for next
time:** the new Request-hex desktop-rail override was written as its own
standalone `@media (min-width: 1024px) { ... }` block, inserted much
earlier in the file (right after the tap-feedback section) than the
existing single `@media (min-width: 1024px)` block for the whole desktop
rail (much further down). `desktop-app-shell.test.js`'s `mediaBlock()`
helper greps for the *first* `@media (min-width: 1024px) {` and asserts
its contents -- exactly the same class of bug this log has hit before with
bare top-level selectors (`html {}` collisions, 2026-09-22 entry above):
a second copy of a query/selector the test assumes is unique silently
becomes the match instead. Fixed by folding the new rules into the
existing block rather than adding a second one. **Standing habit,
restated:** before adding a new `@media (...)` block (not just a bare
element selector) to a CSS file this size, grep for that exact query
string first.

**Also fixed while renaming:** `PORTAL_NAV_UNREAD_TABS`' own `label: 'Jobs'`
(portal-app.js) drives the unread-badge `aria-label` text
("Jobs, 2 new messages") -- missed on the first pass since it's JS data,
not markup; caught by `unread-messages.test.js` failing, not by inspection.
Renamed to `'Visits'` to match.

**Deferred, with reasons, not just "ran out of time":** Home's referral
card + Share button and the amount count-up (Home already had almost
everything else the handoff describes, built in earlier sessions before
this handoff existed); the Invoices stat-tiles/segmented-control visual
work (deliberately not touched together with a slow, contended test run --
this is the real-money screen, and the brief is explicit that it should
ship right or not at all); Estimates, Request work, the booking picker,
Visit detail, Messages, Sign, Settings and Sign-in were not touched beyond
the shared shell CSS. Full list with file-level specifics is in
`docs/ACTION-ITEMS.md`.

**Verification:** full suite (`cd tests && node --test --test-concurrency=1`)
run to a clean baseline before starting, then again after every fix in this
entry -- portal suite alone (`portal/*.test.js`) went 673/679 -> 679/679 across
the label-rename, nav-order and media-query fixes above. The full-repo run
finished at 4185/4190 (heavily CPU-starved by two other sessions' own
concurrent full suites in sibling worktrees, taking ~10.5 minutes instead of
the usual ~20s); the 4 non-`check-links.py` failures touched none of this
PR's files and did not reproduce in an isolated re-run, confirming a
transient race rather than a regression. Screenshots at 390/430/1024/1440,
dark + reduced-motion, are in `docs/client-portal-redesign-2026-09-25/`.

## 2026-09-25 -- Homepage redesign v2 (partial): services cards, reviews
tint, teardown scrub chrome

Handed a full design mockup (`Homepage Redesign v2.dc.html`, a design-tool
export with everything inline-styled) and a 15-section spec
(`HANDOFF.md`) asking to rebuild the homepage from it. Read the mockup
end to end and read the current `index.html`/`styles.css` in full first
-- the two turned out to be much closer together than the handoff
implied. Every hex the handoff says to map (`--bg`, `--orange`,
`--blue-light`, etc.) is *already* the live token, the `.bg-blueprint`
grid layer is byte-for-byte the mockup's fixed background, the
`[data-reveal]` fade-up/stagger/gradient-draw-in mechanics
(`.section-head::before`) already exist, and the teardown/before-after
sliders already use the same `--p`-driven real-`<input type="range">`
approach the mockup describes. This is not a from-scratch design; it's
the same design language a string of earlier visual passes already
built toward, mid-way through.

**What actually shipped, safely, in one session:**
- **Services cards** (`#services .service-card`): re-laid out from
  vertical icon-top tiles to the mockup's compact horizontal rows
  (icon left, title/description/arrow stacked beside it) via CSS Grid
  on the existing button markup (`grid-template-columns:46px 1fr`, icon
  at `grid-row:1/-1`) -- no HTML changed, so `data-service`, the modal
  trigger, and every pinned selector (`.service-card:hover`/`:active`/
  `:focus-visible::before/::after`, `box-shadow:var(--shadow-resting)`,
  the 860/600px breakpoints) stayed exactly where
  `touch-no-sticky-hover.test.js`, `liquid-glass-polish.test.js`,
  `public-site-light-mode-contrast.test.js` and
  `coverage-map-divider-perf-hero-faq.test.js` expect them. Icon tiles
  now split blue (plumbing, assembly) vs. orange (the rest) per the
  mockup, and Emergency Calls gets a solid-orange tile with a fixed
  `#140900` glyph color (not `var(--bg)` -- that flips to a light cream
  in light mode and would fail contrast against the solid fill).
- **Reviews tint band** (`#reviews`): added the mockup's warm orange
  gradient band + top border as one small additive rule on the ID
  selector, which already out-specifies the generic
  `section + section{border-top}` rule. Nothing inside the wall/cards/
  toggle changed.
- **Teardown scrub control** (`.td-scrub input[type=range]`): track
  6px->10px with a `--p`-scaled orange glow, thumb 30px->38px with a
  clearer ring, matching the mockup's spec. Removed the mobile-only
  34px thumb override, which predated this change and would otherwise
  have made the phone thumb *smaller* than the new 38px desktop
  default -- backwards for a touch target.

**Deliberately NOT done this session, and why (logged to
`docs/ACTION-ITEMS.md` for a human decision, not silently skipped):**
- **Moving `#heroLeadForm` into `#schedule`.** Handoff item 2 asks for
  this, but `homepage-hero-lead-form.test.js` pins its exact position
  inside `.hero` (after the CTAs, before the badge) across 7 assertions,
  plus GA4 event wiring in `analytics-events.js` may read hero-scoped
  selectors. Moving it needs a dedicated pass that rewrites those tests
  deliberately, not as a side effect.
- **Redrawing the teardown SVG** with the mockup's new parts (a lit
  timer readout, a perforated-pattern drum, a drain pump, a glass-door
  gradient). The current SVG (control board, door seal, drum, motor,
  heating element) is a real illustration effort in its own right; a
  faithful redraw is its own multi-hour task, not a CSS tweak.
- **A pointer-drag overlay on the whole before/after frame.** The
  mockup drives the compare frame from `onPointerDown/Move/Up` on a
  full-frame overlay, with the range input as a hidden AT-only control.
  The live page already has the opposite arrangement (a real, visible
  range input as the *primary* control, keyboard/touch-operable for
  free) -- adding a second pointer-driven interaction layer is new JS,
  not restyling, and risks fighting the existing `revealScrub` state
  machine and its 8+ pinned tests in `homepage-hero-reveal.test.js`.
- **Removing `#honest`, `.stats-bar`, `.trust`, `#closing`, or `#areas`
  as their own sections.** Each is real, recently-built, heavily-tested
  work: `#honest` also carries `#careCard`, an undocumented (in
  HANDOFF.md) seasonal-tip feature driven by JS, so deleting the
  section risks silently killing that feature too. `#areas`'s service-
  radius SVG had its city bearings corrected *the same day* per the two
  entries directly above this one -- removing it as a homepage section
  would throw away work finished hours earlier without asking. `#closing`
  is the page's own "peak moment" (mission statement + Call button,
  reusing the hero's live open-status classes) that a 2026-09-08 audit
  built for exactly the flat-ending problem the mockup's schedule panel
  also tries to solve. None of these were touched; all stay exactly as
  tested. Logged as an owner decision in `docs/ACTION-ITEMS.md`, not
  silently dropped.
- **Rebuilding the FAQ as inline topic-tabs + `<details>`.** The live
  FAQ is a modal (`#faqModal`/`#faqList`), fed from the CMS via
  `escapeFaqHtml`. Moving it inline is a real UX change (modal ->
  page-flow accordion), not a style pass.
- **A "big 5.0" review showcase** the mockup adds to `#reviews`.
  `js/review-stats.js`'s own comment says exactly why not: "an extra
  inline span around '7' measurably moved the text after it by a
  sub-pixel" -- every rating/count on the page is one of a small fixed
  set of hook classes (`.js-review-rating-stat`, `.js-review-count-stat`,
  `.js-review-text`, ...) that `applyReviewStats()` knows how to update
  live from the CMS. A new static "5.0" element not wired into that list
  would silently go stale the next time Connor updates the real rating
  in `tools/site-content.html`. Wiring a new element into that system
  safely is a small, doable follow-up, just not one to rush.

Verified: full suite 4182/4190 (the 8 failures were all stale cache-bust
stamps from editing `styles.css`, fixed by `npm run fix-versions`;
re-verified clean after). `check-consistency.js`, `check-undefined-vars.js`
clean. `check-links.py`: only the known sandbox-proxy Unsplash failure,
identical to `main`. Screenshots at 1440/1024/390/320, dark/light, and
390 reduced-motion in `docs/homepage-redesign-2026-09-25/{before,after}/`.

Tests: no new test file this pass (every change stayed inside markup/
selectors the existing suite already pins); the deferred items above
each need their own new tests when picked up.

## 2026-09-26 -- Workspace tools redesign Phase 1: shared components + app shell

Asked to build Phase 1 of a 4-phase Workspace tools redesign from a
design-handoff folder (`HANDOFF.md`, the approved `.dc.html` prototype
exports, `support.js`). Phase 1 is the shared component library + app
shell only; phases 2-4 (Home/Jobs/Job detail, Money pages, Clients +
rest) are explicit follow-up sessions, tracked in `docs/ACTION-ITEMS.md`
with the handoff's own page-by-page table.

- **Read the shell code first, found it mostly already matches the
  spec structurally.** `tools/tools-nav-pwa.js`'s `inject()` already
  builds the described header search/grid buttons, the Home/Jobs/+/
  Clients/Money bottom nav with a raised orange hex center button, the
  Create sheet's quick-add + paste + say-it + 3x3 `CREATE_ACTIONS` grid,
  and the desktop sidebar's Work/Money/Office groups with an orange New
  button and orange active-item tint (all from the 2026-08-20 through
  2026-09-23 app-shell-v2 work). This phase's real gap was visual only
  -- tokens and component styling, not shell markup -- so no changes
  landed in `tools-nav-pwa.js` at all; everything is in
  `tools/styles-tools.css`.
- **Token remap was a real finding, not a formality.** The handoff's
  hex values (`#141518`/`#17181c`/`#1b1c20` for
  `--bg-panel`/`-2`/`-3`, `#2c2e34` for `--border`, `#9fd0ff` for
  `--blue-light`) didn't match the current tool-scope override values
  (`#18191d`/`#212327`/`#2c2e34`/`#34363c`) -- a step lighter and more
  spread out than the approved design. Updated the
  `html:not([data-theme="light"]) body.th-tool-page` override block to
  the exact approved values.
- **Tone pairs needed a base declaration in `styles.css`, not just
  `tools/styles-tools.css`'s own override.** `tests/design/
  tools-light-mode.test.js` asserts every `var(--x)` `styles-tools.css`
  references is defined *somewhere* in `styles.css` (any `--x:`
  anywhere in the file, not scoped to `:root`) -- the same mechanism
  that already backs `--bg-panel`/`-2`/`-3`/`--border` (base in
  `styles.css`, tool-scope override in `styles-tools.css`). Missed this
  on the first pass (5 tone pairs x 2 = 10 vars, only added to
  `styles-tools.css`) and the full suite caught it immediately. Added
  base declarations to `styles.css`'s `:root` and `[data-theme="light"]`
  blocks -- nothing on the public site references them, so this is a
  pure token addition, not a visual change to any public page. Worth
  remembering for any future new token: it needs a home in `styles.css`
  even if only tools ever uses it.
- **Retiring the glossy gradient buttons (ACTION-ITEMS Phase 3 #12) is
  the actual content of this phase**, not a side effect. `.primary-btn`,
  `.secondary-btn`, `.small-btn`, `.dialog-btn-primary`/`-cancel`, the
  bottom nav's `.th-bn-create-disc` hex, `.th-chip.is-active` and
  `.th-row-avatar.is-owed` were each their own gradient+glow/sheen rule
  (some going back to 2026-08-16/09-06). All now flat fills with an
  offset hard shadow, matching the public site's own U01 language
  (2026-09-07) instead of a second, dated button style living only in
  tools. The handoff itself is the "Connor's OK" ACTION-ITEMS asked for
  -- an explicit design he'd already approved, not a unilateral call.
  One subtlety: a `body`-prefixed override block (higher specificity,
  added 2026-08-16 for a "glass sheen" pass) was actually what rendered
  on every button, not the base `.primary-btn` rule -- both had to be
  flattened, or the base rule's flat fill would have been invisible
  under the still-glossy override.
- **One focus ring (ACTION-ITEMS Phase 3 #11 for tools).** The default
  `:focus-visible` rule (~L1222, orange) already existed, but a later
  override (~L2601, "one focus treatment everywhere") deliberately set
  `.tool-card`/`.small-btn`/`.tab-btn`/`.help-btn` back to blue --
  itself trying to unify things, just landing on the wrong color for
  4 of dozens of components. Changed to orange, matching the majority
  and the base rule's own intent.
- **Hover-guarded only what this PR touches, not the full audit.**
  ACTION-ITEMS' X2 (41 unguarded tools hovers + 19 portal) is explicit
  Phase 2 scope from the 2026-09-25 cross-surface audit. Guarded the
  ~10 hover rules this phase actually rewrote or added (button hovers,
  `.tool-card`/`.job-card`/`.metric-card`/`.help-btn` glow,
  `.th-icon-btn`/`.th-row`/`.th-toast-undo-btn`), left the rest for
  that already-planned pass.
- **Didn't touch the header's live sync text -> dot, or per-page
  `hub-header` markup.** The handoff's shell bullet describes this, but
  that markup lives in each of ~15 tool pages' own HTML (the
  `realtime-badge`/`realtime-dot`/`realtime-text` pattern), not in
  `tools-nav-pwa.js`'s `inject()` -- changing it is "unique content of
  an individual tool page" work, explicitly out of this phase's scope
  per the delegation. Logged for phases 2-4 alongside per-page content.
- **New shared components are additive and unused so far**: `.th-card`/
  `.th-card-hero`, `.th-section-label`, `.th-segmented`(-btn),
  `.th-stats-tile`, `.th-hero-number`, `.th-toggle`, `.th-note`,
  `.th-placeholder-slot`, `.th-sticky-bar`, `.th-tone-*`. None of them
  render anywhere yet -- phases 2-4 wire them into real pages. This is
  deliberate (a visual pass builds the library first, page content
  adopts it next), but worth flagging so a future session doesn't
  wonder why a class has no callers.
- **Origin/main moved twice underneath this branch** (PR #440 homepage
  redesign v2, then PR #441 client portal redesign, both merged while
  this session worked). Rebasing via cherry-pick + merge: the only real
  conflicts were cache-bust `?v=`/`CACHE_NAME` stamps on ~65-68 pages
  (both sessions restamped the same global-shared-file references) --
  resolved by keeping origin/main's side and re-running
  `npm run fix-versions`, never by hand-editing a hash. One stray find
  while re-verifying after the rebase: `portal/jobs.html` carried a
  duplicate local `const MIN_LEAD_HOURS = 2;` (already defined in
  `js/business-hours.js`) that isn't part of this PR's actual work --
  removed it since it broke the undefined-vars redeclaration check and
  wasn't referenced anywhere in the file.
- **A background `node --test` run got contaminated by concurrent `git
  worktree add`/`remove` operations** (used to get a clean "before"
  checkout for screenshots) -- a run mid-flight showed 9 failures
  including several unrelated-looking ones (cache-bust, tour health
  check, `var` redeclaration checks) that vanished on a clean rerun
  with nothing else happening concurrently. Lesson for next time: don't
  run `git worktree add`/`remove` while a background test suite is
  executing, same as the existing "don't edit files" rule -- it isn't
  just file edits that can race a running suite.

Verified: full suite 4189/4190 (the one failure is the known
`check-links.py` sandbox-proxy test). `check-consistency.js`,
`check-undefined-vars.js` clean. `npm run fix-versions` restamped
`styles.css` and `tools/styles-tools.css` (both global shared files)
across every page that loads either. `check-visual-snapshot` clean (6
targets, all match baseline -- confirms nothing here touched a pinned
public-site element). Screenshots via a real headless Chromium
(`/opt/pw-browsers/chromium-1194`, not the default `chromium` channel
whose expected revision wasn't installed in this sandbox) at 390/768/
1024/1440px, dark/light and 390 reduced-motion, before (a `git worktree
add` of the pre-change commit) and after, in
`docs/workspace-tools-phase1-2026-09-25/{before,after}/`. Auth-gated
tool pages were screenshotted by seeding a fake `th_auth_session` in
localStorage before navigation (passes the client-side `hasValidSession()`
gate; real data fetches 401 and show empty states, which is fine for a
shell/component screenshot).

Tests: none new this phase -- every change is inside existing shared
classes/tokens the suite already exercises indirectly (button/focus/
hover assertions across many test files), and the new unused component
classes have no test surface yet (phases 2-4 will add their own tests
when they adopt them).

## 2026-09-26 (from the bug lane, not fixed) -- two visual side effects of #442, found in the redesign regression pass (the second resolved by #443)

Both came from computed-style diffs of every page, before and after, in headless Chromium. Neither breaks anything, so they're left for this lane.

- **Portal secondary buttons changed shade.** #442 changed the unscoped base `.secondary-btn` background in `tools/styles-tools.css` from `var(--bg-panel-2)` to `var(--bg-panel-3)`. Every portal page loads that file, and `portal-polish.css` only overrides `background-image`, so the base colour under its gradient moved from `rgb(33,35,39)` to `rgb(44,46,52)`. "Sign out", Clear and the other secondary buttons are a shade lighter on all 7 portal pages. #442 describes the portal as untouched. If that's the intent, scope the rule to tool pages (`body.th-tool-page .secondary-btn`, or give `body.portal-page .secondary-btn` its old colour in portal-polish.css). Four `.btn` instances on portal pages moved the same way.
- **Resolved the same evening by #443 (X1):** `.primary-btn`, `.secondary-btn` and `.dev-tab-btn` now show the orange ring too (checked in Chromium on e4e70d6). The original note follows.
- **"One focus ring" is orange on some controls, blue on others.** With keyboard focus (`:focus-visible`), `.tab-btn`, `.small-btn` and `.help-btn` now show the 2px orange ring. `.primary-btn`, `.secondary-btn` and `.dev-tab-btn` still show 2px `--blue-light` (`#9fd0ff`). All are clearly visible, so there's no accessibility regression. It only falls short of the single-ring goal. An orange ring on the new solid-orange `.primary-btn` would disappear, so that one probably needs its own treatment.

## 2026-09-28 -- P1 homepage hero redesign (body.page-home), applied from a Claude Design package

First package from the public-site redesign sweep (7 Claude Design briefs; this session is the apply side). The design session's first return was a `.dc.html` prototype with every real repo file byte-identical to base (479 inline `style=` attributes, template bindings, its own submit handlers), so it went back with the brief's "What to return" contract. The second return was a real package: whole `index.html`, a `styles.css` patch plus block, an `APPLY.md`. That's the shape that lands; say so up front in any future design brief.

**What shipped.** The hero is four planes: the canyon photo on `.hero::before`, the `.hero-plane` grid, a new decorative `.hero-tools` SVG sketch plane (gear, wrench, drop), and the copy plus lead card. Motion is CSS only. Entry keyframes sit behind `prefers-reduced-motion:no-preference`. Scroll separation uses `animation-timeline: scroll()` inside `@supports`, so browsers without it, and reduced-motion visitors, get the finished layout rather than a half-animated one. `#openStatus` moved directly above `.hero-ctas` and renders as one plate with them; `triage.js` still owns its text and `is-open`/`is-closed`. The lead card sits in a right column on desktop, still after the CTAs and before the badge (`homepage-hero-lead-form.test.js`), with the badge on its corner. On phones the badge stays above Schedule/Call (Connor 09-17). The stats strip, Why Choose, What we fix and triage lose their section rules, so the first scroll reads as the hero's continuation. The triage result sits beside the picker on desktop via `:has()`. The service-card hover lift finally works: it uses `translate`, a separate property from `[data-reveal]`'s `transform`, which fixes the 09-25 audit's P2 dead-code note. The whole block is scoped to `body.page-home`; only `index.html` carries it. `index.html` and all 16 landing pages share `<main id="home">`/`.hero`, so there was no homepage-only hook before this.

**Changed at apply time, and why:**
- **The orange "DONE RIGHT." accent is gone.** The design re-split the headline into two colours, which the frontend-design-tells pass had removed on purpose (`frontend-design-tells-removed.test.js`). That's a decision already made and reverted, not a new direction. The per-line spans stay for the line reveal, and the test now reads the headline's text instead of its exact markup, plus asserts no accent span and no per-line colour.
- **`#openStatus` got a dedicated `hero-open-status` class, and the block styles that.** The design's `body.page-home .hero .open-status{` contained the literal `.open-status{`, which three tests use to find the one real shared pill rule (`closing-section`, the coverage-badge idiom test, `liquid-glass-polish`). That's the same fix the closing section used (`closing-open-status`), at the same specificity.
- **The lead card's `rgba(0,0,0,.9)` shadow now goes through `var(--shadow-hover)`** (F27: hardcoded black shadows read badly in light mode).
- **Two blueprint-background tests now allow extra body classes.** `<body class="has-blueprint-bg page-home">` still has the background; the tests matched the exact class string. Every other batch in the sweep adds a body hook too, so this saves each of them the same edit.

**Verification.** Full suite, `check-consistency`, `check-undefined-vars`, lint and `check-visual-snapshot` are all clean; `check-links.py` has the same 10 Unsplash sandbox-proxy failures as main. `rule1-audit` found nothing missing from `index.html`. Pixel diffs of Hurricane, handyman-repairs, About and a blog post at 390/1440 in dark and light show no visible change; four captures differed only in total page height, and the differences swapped between themes, so that's load timing. The triage verdict, the service modal, lead-form validation and both CTA links behave the same before and after at 1440 and 390, and all six service cards finish their reveal with motion on and off.

**Screenshot lesson.** Headless Chromium in this sandbox can't reach Google Fonts: the stylesheet request stalls in the proxy tunnel even though `curl` gets it. Pre-fetch the CSS and woff2 files with `curl` and `route.fulfill()` them from disk, or every shot is in the fallback faces. Also, `document.fonts` lists the local "Anton Fallback" face, so a `/Anton/` check passes even when Anton never loaded; match the family name exactly. Screenshots are in `docs/homepage-hero-2026-09-28/{before,after}/`, as JPEG, since PNG was 19 MB.

**Hand-off.** The design session also prototyped `#revealJob`, `#teardownStage` and `#areas`. Those are P2's, run after this merges; the prototype stays with that session.

**For the user to judge, not changed.** At 1440x900 with both site banners showing, Schedule now sits near the bottom of the first screen (about y=840, versus y=525 before), because the four-line Anton headline is taller. It's still above the fold at 1440x900 and on phones. On a 1366x768 laptop it would be below the fold.

## 2026-09-28 -- P3 landing template (html.page-landing, 16 pages), applied from a Claude Design package

Second package from the public-site redesign sweep. It arrived in the right shape the first time: 16 whole page files, a `styles.css` patch plus block, and a thorough `APPLY.md` with its own rule-1 audit.

**What shipped.**
- **Hook.** The hook sits on `<html>` (`page-landing` plus `page-landing--city`/`--service`), not on `<body>`. The design session chose that to avoid the two tests that pinned `<body class="has-blueprint-bg">` exactly; P1 has since loosened those tests, but `<html>` is fine too.
- **Hero.** It has its own composition, with no canyon photo, so the fixed blueprint shows through. The existing distance chip is wrapped in place in a `.landing-plate` card with a small locator diagram. The diagram reuses the service-radius SVG's own coordinates, so no geography is new.
- **City section.** It's a split feature band.
- **Common Questions.** These were 44 identical inline-styled boxes and are now a divided list with classes.
- **Trust strip.** It's one joined band.
- **Radius diagram.** It draws an orange trail from St. George to the page's city.
- **Closing sequence.** Reviews, FAQ and schedule read as one sequence.
- **Desktop call pill.** The shared `nav.sticky-call` also shows on desktop (>=761px) as a floating pill. It fades in after the hero where scroll timelines exist, and otherwise stays visible.
- **Unchanged.** No copy, links, JSON-LD or scripts changed. `rule1-audit` found nothing missing on any of the 16 pages.

**Changed at apply time, and why:**
- **The coverage pill stretched into a bar.** "Serving Hurricane" became a full-column strip because the new hero `.wrap` is a CSS grid, and grid items stretch, so the `inline-flex` pill got blockified. The fix is `justify-self:start`. It's written against `.coverage-badge.is-standard` / `.is-by-request`, so the literal `.coverage-badge{` stays the one shared base rule that the pill-idiom tests read. That's the same trap P1 hit with `.open-status{`.
- **Light-mode contrast on that pill fell to about 4.3:1.** Its dark glass was made to sit on the canyon photo, and the photo is gone here. A scoped `html.page-landing[data-theme="light"]` rule gives it `--bg-glass` / `--text` / `--border`, which measures 16.3:1 rendered, the same as dark mode.
- **The desktop pill covered the footer's Cookie Preferences link** at the bottom of the page, with nothing left to scroll, so an existing control was unreachable. `html.page-landing body{padding-bottom:96px}` goes inside the pill's own `@media (min-width:761px)` block. Phones already reserve space for the bar.

**Checked, not changed:**
- **The canyon photo leaving the landing heroes.** It's the generic hero background shared by every hero, not city imagery. The 09-18 "local imagery" item settled that no per-city photos exist, and used the distance chip and the radius map instead; both are kept and promoted. So this is a design choice, not a removed capability. Called out in the PR for a human look.
- **Full-page screenshots showed the trust strip, map, triage pills and reviews blank.** That's a capture artifact, not a regression. A fast scroll-walk outruns `site-motion.js`'s IntersectionObserver reveals, and the same 12 `[data-reveal]` elements stay hidden before and after P3. In a real viewport every child is visible, with motion on and off. Use reduced motion for full-page documentation shots.

**Verification.**
- **Tests and checks.** The full suite is clean except the known `check-links.py` Unsplash sandbox failures, same as main. `check-consistency`, `check-undefined-vars`, lint and the visual snapshot are clean.
- **No leakage.** Pixel diffs of the homepage, About, Our Work, Careers and a blog post, at 390/1440 in dark and light, show no visible change. The one homepage strip difference also appears between two captures of the same code.
- **Interactions.** The triage verdict, the FAQ `<details>`, and both call/book links behave the same before and after at 1440 and 390.
- **Screenshots** are in `docs/landing-template-2026-09-28/`.

**Still open for P2's apply.** The combined Claude Design export includes a later P1 revision that moves its hook to `html.page-home` and drops the h1 line spans. P2 was built on top of that revision, so P2's `index.html` must be 3-way merged against it (base = that P1 revision, ours = main). Whole-file copying it would undo P1's merged hero.

## 2026-09-28 -- P4 About + Our Work (html.page-about / html.page-our-work), applied from a Claude Design package

Third package from the public-site sweep. I applied the later revision from the combined Claude Design export (17:40), not the first P4 zip; only its `styles.css` block and patch differed. Hooks sit on `<html>`. `rule1-audit` found nothing missing on either page. About's paragraphs are re-ordered into the new layout, not dropped: the design's own audit found the sorted word list identical to base.

**What shipped.**
- **About:** a split typographic hero with the Triple H badge (no photo of Steven exists, so no portrait, and no stock), an aria-hidden pull-quote from the accountability paragraph, the experience as a timeline of the existing paragraphs, and "What that means for your repair" as a proof grid.
- **Our Work:** a featured kitchen-tile project built from four of its own photos, a sticky filter bar with per-category counts, a fixed-ratio grid for thin categories (four photos or fewer) via one `.is-few` toggle, and a lightbox with a position counter and tap-to-zoom. The IO lazy loader, the 61-photo count and the lightbox list order are untouched.

**Changed at apply time, and why (four of these were test failures the package's `APPLY.md` said wouldn't happen):**
- **A comment that quoted the literals it was avoiding.** The block's opening comment named `.quote-block{`, `.lightbox-overlay{` and `.gallery-category{` with their braces. That left `styles.css` with three unbalanced braces (the brace-balance test counts comments too). It also put a third literal `.quote-block{` between the two real ones, which F34 reads by position. Reworded without braces. **Standing rule for any CSS comment: never write a `{` or `}` in it.** P3 hit the same thing at apply time.
- **The About badge used the full 531px orange logo, unstamped**, in a slot the logo-variant test didn't know. It now uses `srcset` 176w/531w with `sizes="(max-width: 860px) 120px, 360px"` and `?v=` stamps on both files. The test gained an `about-hero` slot, as its own failure message asks ("decide its size and add it here"). It's separate from `hero`, so the homepage-badge rules stay the homepage's. A mutation check (dropping the slot class) still fails it.
- **The sticky filter bar combined `position:sticky` and `backdrop-filter` on one element.** That's the WebKit ghosting pattern the header fix moved onto `::before` (`theme-toggle.test.js`). The bar is now a new `.gallery-filters-bar` wrapper that sticks and carries the glass on `::before`, with `isolation:isolate`. The chip row inside keeps its own sideways scroll; a `::before` on the scroller itself would have slid away with the chips.
- **The one-row chip strip clipped "Kitchen Tile: Finished" and "Other Work" off the right edge on desktop**, with the scrollbar hidden, so two filters had no visible cue. Desktop keeps the base wrapping (the bar is two rows, 114px tall at 1440). Phones keep the one-row scroller, inside P4's existing 860px block.
- **Chip counts were typed into the markup** (All 61, Flooring 4, and so on), and would go wrong the first time a photo is added. The filter script now computes them from the tiles on load; the typed numbers stay as the no-JS fallback. They matched the tiles exactly.

**Verification.**
- **Suite:** full suite 4253/4254 (the known `check-links.py` sandbox-proxy failure). `check-consistency`, `check-undefined-vars`, lint and the visual snapshot are clean.
- **Leaks:** pixel diffs of the homepage, Hurricane, handyman-repairs, Careers and a blog post (390/1440, dark/light) show no visible change. Two homepage strips were re-shot and are capture noise.
- **Interactions:**
  - All 61 photos filter correctly, with a thin category flipping to `.is-few`.
  - The lightbox opens with its counter reading "1 / 61", then "2 / 61", and tap-to-zoom works.
  - Escape closes it.
  - Lazy loading fills all 61 photos on scroll, and About's FAQ behaves as before.
- **Screenshots:** `docs/about-our-work-2026-09-28/`.

**Still open.** `content.md` (from the design session): there's no real photo of Steven for the About hero; if one is ever added it goes in `.about-hero-badge`. Also, the brief said 62 gallery photos, but base has 61.

## 2026-09-28 -- P5 blog index and post template (html.page-blog / html.page-blog-post, 17 pages), applied from a Claude Design package

Fourth package from the public-site sweep. I used the later revision in the combined export. `rule1-audit` found nothing missing on any of the 17 files.

**What shipped.**
- **Index:** the 16 cards (markup unchanged) are regrouped into a "Start here" featured post, a sticky appliance jump bar with counts, and six shelves (Washer, Dryer, Dishwasher, Fridge, Oven, Around the house).
- **Posts:**
  - The header and lead image form a split `.post-hero`.
  - Each H2 gets an id, and an "In this post" contents rail is built from them.
  - The "something else" and "worth fixing" sections become tinted `section.post-pivot` / `section.post-worth` callouts, each with a call line (`btn orange js-phone-link` plus "or book a visit online").
- **Unchanged:** no JS, and `site-motion.js`'s read-meta/progress are restyled only. All 61 new in-page anchors resolve to real ids, and every new call link dials the real number.

**Changed at apply time, and why:**
- **The shelf bar was `position:sticky` plus `backdrop-filter` on one horizontal scroller.** That's the WebKit ghosting pattern P4's filter bar had. It gets the same fix: a `.blog-shelf-bar` wrapper sticks and carries the glass on `::before`, and the link row keeps its sideways scroll. `theme-toggle.test.js` only scans `styles.css`, so this one wasn't caught by a test; the bug is the same either way.
- **Two new hovers weren't behind `(hover:hover)`**: the shelf links and the post contents links. Both are now guarded, with `:focus-visible` kept as its own rule. The no-sticky-hover test only checks the blog-index cards in `blog.css`, so again no test caught it.
- **`blog-index-cards.test.js` sliced cards out of the index by file position.** With the featured post moved to the top, one slice came back empty, and two others passed only because they now spanned most of the page. All three now find each card by its link (`cardFor(href)`). A mutation check (breaking the to-do card's icon) still fails the test.

**Checked, not changed:**
- **The new `<section>`s.** The post callouts are `<section>` elements, and `styles.css`'s bare `section{padding:88px 0}` / `section + section{border-top}` rules (X4) would reach them. P5's scoped `.post-pivot` / `.post-worth` rules out-specify both, confirmed in render.
- **Lead photos are hotlinked Unsplash images, unchanged from main.** The sandbox proxy blocks them (the same URLs behind the known `check-links.py` failures), so screenshots show alt text; production loads them.
- **For the bug/perf lane (logged, not changed):** the lead photo now sits above the fold but keeps `loading="lazy"`, which can push back first paint on posts. The shelf counts in `blog/index.html` are typed in by hand; unlike Our Work, the index has no script to derive them, so whoever adds a post updates both.

**Verification.**
- **Tests and checks:** full suite 4253/4254 (the known `check-links.py` sandbox-proxy failure). `check-consistency`, `check-undefined-vars`, lint and the visual snapshot are clean.
- **No leakage:** pixel diffs of About, Our Work, Careers and two service pages (these load `blog.css`), at 390/1440 in dark and light, show no visible change. The one Our Work strip was re-shot and is capture noise.
- **Screenshots:** `docs/blog-2026-09-28/`.

## 2026-09-28 -- P6 Careers, Privacy, Terms and 404 (html.page-careers / html.page-legal), applied from a Claude Design package

Fifth package from the public-site sweep; the P6 zip and the combined export were identical. `rule1-audit` found nothing missing on any of the four pages, and the legal text is verbatim. No existing `<script>` changed on any page. Privacy and Terms each gain one small script, which builds the contents list.

**What shipped.**
- **Careers:** a display hero with the pay and schedule facts pulled up as aria-hidden chips. Schedule and pay become cards, duties and requirements sit side by side, and the application is a panel (same fields and the same submission path).
- **Privacy and Terms:** an "On this page" list built from each document's own `<h4>`s. It's a sticky sidebar on desktop and collapsible on phones, with numbered sections. On Terms it re-runs through a MutationObserver when the `site_terms` CMS fetch replaces `#termsBody`, so a later edit in Site Content re-flows it.
- **404:** a brand moment plus the site's main destinations (the home page, services, Our Work, the blog, areas, About, booking), still self-contained with its own inline styles.

**Changed at apply time, and why:**
- **A block comment quoted `section{padding:88px 0}`, braces and all.** The count balanced, but it's the same trap P3 and P4 hit, so it's reworded without braces. That's the standing rule now: never put a brace in a CSS comment.
- **The legal contents links' `:hover` wasn't behind `(hover:hover)`.** It is now guarded, with `:focus-visible` kept as its own rule.

**Verification.**
- **Suite and checks.** Full suite 4253/4254; the one failure is the known `check-links.py` sandbox-proxy failure. `check-consistency`, `check-undefined-vars`, lint and the visual snapshot are clean.
- **Leaks.** Pixel diffs of the homepage, About, Our Work, a blog post and Hurricane (390/1440, dark and light) show no visible change beyond the homepage capture-noise strips seen in every round.
- **Interactions.**
  - Careers' application form keeps its fields (`_gotcha`, name, phone, email, experience) and still blocks an empty submit.
  - Privacy builds 12 contents entries and Terms 16. Every target exists, and clicking one lands on its section.
  - With a stubbed `site_terms` response, the Terms body and its contents list both show the CMS headings.
  - The 404's original two links are kept, and six more real destinations are added.
- **Screenshots** are in `docs/careers-legal-404-2026-09-28/`.

## 2026-09-28 -- Workspace W2: Home as a headline + cockpit, Jobs sheets, a thumb bar on Job detail
- Package 2 of 5 of the v2 Workspace redesign (`design_handoff_workspace_app_v2`, `redesign-W2-daily`), applied on top of W1 (#451). Touches only `tools/workspace.html`, `tools/job-tracker.html`, `tools/job-detail.html`.
- **Where the CSS lives:** the package shipped its W2 block appended to `tools/styles-tools.css`. Moved it, rule for rule, into each page's own `<style>` instead (end of the block). Every W2 rule is keyed to one page's `body.th-tool-page[data-th-page="..."]`, so it has no business in a sheet the nine portal pages also load, and keeping the shared sheet untouched keeps this PR clear of the concurrent portal redesign and public-site sweep. Page `<style>` loads after `styles-tools.css`, so equal-specificity rules still win. The `max-width: 720px` block is appended after the page's own, so every first-match `@media` block a test reads is unchanged.
- **Ink on orange:** the filled New job tile needs the repo's existing `#1a0d02` glyph colour, which has no token (styles-tools.css writes it literally). Declared once as a page-local token, `--th-ink-on-orange`, on `body.th-tool-page[data-th-page="workspace"]`, so no rule carries a bare hex and `styles.css` stays untouched.
- **Home desktop is CSS grid on `body` (≥1200px)**: dense flow, per-id `grid-column`. Source order is untouched because `dashboard-today-first.test.js` pins it. Apply-time fix: in the ~430px right-hand column, Your week's side-by-side chart and stats (built for a full-width card) overflowed the viewport by ~40px, and the bars ran under the numbers. It now uses the stacked layout that card already uses on a phone, scoped to `> #weekCard` inside the cockpit query.
- Lane tone moved from a 3px left edge to a dot beside the lane name (red now, orange soon, blue later, light orange money). A clear lane goes dashed instead of 72% opacity.
- `#templatesFormSection` gains `data-th-inline`. W1's log said templates stayed opted out, but the attribute was never in the markup, so W1's sheet layer was wrapping it. `renderTemplates` auto-opens it when templates are due, which would pop a sheet on page load. It's back to an inline card, beside Add a Job on desktop.
- Job detail quick actions are `position: fixed` at `bottom: 85px` on ≤1023px, and body padding is raised by 72px to make room. Review joins them once a job is Done. Its link is built exactly like job-tracker's `reviewRequestHref()` (only the params that have a value), not the package's version, which always sent `name=&job=&phone=`. Same prefill `review-request.html` already reads. At ≥1100px, the hero is on the left and the records are on the right.
- **Not in this package:** the v2 README's bigger §8.1–8.4 screens (the Insights view at `#insights`, the three rings, the route timeline, row `⋯` menus, the job-detail clock ring). The W2 package predates them and ships none of that. They'd need their own pass.
- Rendered 390 and 1440, dark and light, base vs. after, with a stubbed Supabase and seeded jobs: Home, Job Tracker (list and board), and Job detail (a Done job and a not-started one). No horizontal scroll anywhere after the week-card fix. Light-mode full-page captures show a dark band below the first viewport on both base and after. That's a capture artifact of W1's viewport-sized `html` gradient layer: a real scrolled viewport is light all the way down.

## 2026-09-28 -- Client portal redesign v2, part 1: shell + Home + Invoices

From the v2 portal handoff (`portal/README.md` in the handoff; tokens from the workspace brief's §6 table). This is part 1 of the brief's own two-PR split. Part 2 is Estimates, Visits, Request, Contracts, Settings and sign-in, and none of those HTML files were touched here except for `fix-versions` stamps. No patches were provided; this was built directly from the brief, with the prototype rendered in headless Chromium (React/Babel served locally from `npm pack`, since unpkg is blocked here).

- **Where the CSS lives.** The shell stays in `portal-app.css` (tab bar, rail). The v2 look for the app bar, sheets, toasts, Home and Invoices is a new section 26 at the end of `portal-polish.css`, all under `body.portal-page`. Two reasons:
  - The page `<style>` blocks carry dozens of rules that tests pin as literal text (legacy `#4caf78`/`#ffa726` among them). Those stay put, and the later sheet re-maps them onto tokens.
  - The chart's bar colours are presentation attributes set in JS (pinned too). CSS `fill` overrides presentation attributes, so `.invoice-chart-bar[fill="#4caf78"] { fill: var(--tone-green-fg) }` maps them without touching the JS.
- **Portal-only tokens.** `--portal-hairline`, `--portal-radius-xl/-tile/-control` and `--portal-ink` are declared on `body.portal-page`, not in `styles.css`. `styles.css` is the public site's file (out of scope), and nothing outside the portal uses these.
- **The rail is identical on every page** (`desktop-app-shell.test.js` pins that). So the two new rail items, **Request work** and **Sign out**, are injected once by `portalEnhanceShell()` in `portal-app.js` rather than hand-copied into nine files. Sign out clicks the page's own `#signOutBtn`/`#signOutBtnSettings`, so there is still exactly one sign-out path per page. The brand hex is a `::before` on `.portal-rail-brand` (the logo `<img>` stays, hidden).
- **Header avatar.** `portal-design-fixes.test.js` pins `href="/portal/settings.html" class="portal-icon-btn"` exactly, so the avatar is the same element with its class untouched. `portalSetHeaderInitials()` appends an initials span and toggles `.has-initials` at runtime, and the gear shows whenever no initials are set. The new header (`.portal-appbar`) is opt-in per page, so part-2 pages keep their current header until they get the markup.
- **Real bugs fixed on the way:**
  - `portal-app.css` had a comment whose opening `/*` had been lost. The reduced-motion `@media` block after it was parsed as part of an invalid rule and never applied.
  - The rail's Invoices dot was positioned absolutely by the phone rule (`.portal-nav a svg + .portal-nav-dot` out-specified `.portal-rail .portal-nav-dot`), so on desktop it floated under the icon.
  - The phone bar's new `align-items: start` would have shrunk the rail's column-flex rows, so the rail nav resets it to `stretch`.
- **Judgment calls:**
  - **Header buttons are 44px, not 42px.** Rule 5's 44px target minimum wins over the brief's 42px size.
  - **The chart stays one bar per invoice.** It isn't regrouped by month, because each bar is a click target for its invoice card (`highlightInvoiceCard`) and tests pin that. Restyled only.
  - **The paid screen doesn't say "Receipt sent to …".** Stripe receipt emails aren't switched on (CLIENT-PORTAL.md, still pending #2), so it points at the Download Receipt button instead. The amount shown is `paymentIntent.amount / 100`, which Stripe returns with the confirmation.
  - **Step 2 heading has no amount.** `mountPaymentUI()` only gets the client secret, so it reads "Pay by card". Passing the amount would have meant touching `startPayment`/`startBulkPayment`.
  - **The greeting keeps `homeGreetingText()`'s wording.** It still says "Good evening, Kim" rather than "Hi, Kim" (tests pin the text); Anton uppercases it.
  - **Continue is disabled until signed.** A `MutationObserver` watches the pad's own status line (`portalGateOnSignature`). The submit handlers still validate.
  - **The 720-1023px floating pill tab bar is gone.** It's one full-width bar below 1024px now.
  - **Invoices on desktop.** From 1100px the "amount due" column leads on the left, scoped with `.page-split:has(#payFirstArea)` so Visits and Request keep the shared 1200px split.
- **The lightbox sheet** (jobs.html) and the **Undo toast** aren't done. The lightbox is part 2's markup, and no Home or Invoices action supports undo today.
- **`?v=` gap, not fixed (automation lane):** `portal-app.css?v=202609230030` and `portal-app.js?v=202609231400` are hand-picked timestamps that `check-consistency.js` doesn't manage, so `fix-versions` never restamps them. The portal service worker's `CACHE_NAME` bump covers installed clients. As a guard, the pages call the new helpers behind `typeof … === 'function'`, so a stale cached `portal-app.js` can't break a page.
- **th-tool-page check:** in headless Chromium, `body` is `portal-page` only, `tools-nav-pwa.js` never loads, and 0 of the 134 `th-tool-page` selectors in the loaded sheets match any element on `home.html` or `dashboard.html` at 390 or 1440. Before and after screenshots are in `docs/client-portal-redesign-v2-part1/`.
- **Environment note:** killing a full-suite run mid-way (`pkill -f`) left two fixtures unrestored in this worktree: the tour test's `#thisElementDoesNotExist` in `tools/tools-tour.js`, and a `fix-versions` restamp across 60+ files. Both were reverted with `git checkout` before committing. If you need to stop the suite, don't kill it half-way; let it finish.

## 2026-09-28 -- Workspace W3: money pages as builders, Runway joins the shell
- Package 3 of 5 of the v2 Workspace redesign (`design_handoff_workspace_app_v2`, `redesign-W3-money`), applied on top of W1 (#451). Touches only `tools/invoice-generator.html`, `tools/finance.html`, `tools/contract-generator.html` and `tools/runway-dashboard.html`. The package's patches and full files agreed with each other and applied cleanly against main.
- **Where the CSS lives:** same call as W2. The package appended a W3 block to `tools/styles-tools.css` (its whole-file copy also carried W2's block). None of it went into the shared sheet. Every W3 rule is keyed to one page's `body.th-tool-page[data-th-page="..."]`, so each page's slice moved, rule for rule, to the end of that page's own `<style>`, which loads after `styles-tools.css`. `data-th-page` is set in the markup, and it matches what W1's `markPage()` would derive from the filename anyway. No bare hexes were added to the three shared-sheet pages.
- **Runway** loads neither shared sheet. It gets its own hand-copied W1+W3 shell language at the end of its first `<style>`: status dot, underline `.rw-tab-btn` tabs, flat cards, bottom bar and sidebar indicators, and sheet motion. Its `--th-*` / `--status-*` tokens sit in a second `:root`, with the same values as `styles.css`. The light override is written `[data-theme="light"] body.th-tool-page {` so the light-mode test's first-match `[data-theme="light"]{` regex still reads the original block.
- **Apply-time fix, Runway phone header:** the package's 30px title ran under the phone header's three round buttons, which sit about 146px from the edge, more than the 104px the page reserved. Below 1024px it now uses the other pages' `.hub-title` sizes (24px, then 21px at 720px and below) with 146px reserved.
- **Apply-time fix, invoice/quote builder:** the package started the two-column builder at 1200px with `.9fr/1.1fr`. The line-items table keeps the shared `.table-scroll` 640px minimum, so at every width below about 1900px the right column scrolled sideways and hid each row's remove ×. Measured at 1200, 1280, 1360 and 1440, it overflowed by 63 to 195px. The builder now starts at 1400px with `minmax(0,1fr) minmax(704px,1.2fr)`, which fits the whole table. Between 1200 and 1399px the builder stays one column, as on main.
  - Payment Text stays in the left column under Job. The package sent it to column 2's next free row, below the four spanned rows, which left a tall gap under the totals.
  - Recent's two columns and full-width summary strip still start at 1200px.
- The builder layout is placed with `nth-child` and assumes the current child order: 5 `.form-section`s in `#tab-invoice`, and the banner plus 4 in `#tab-quote`. The job-fill panel lives inside Line Items, so it doesn't shift the count. None of these sections is sheetable, so W1 injects no `.th-sheet-trigger` siblings. If a child is ever added, update the `nth-child`s.
- `#signatureFormSection` gains `data-th-inline`. W1's comment named it as opted out, but the attribute was missing, so W1 was turning the signature pads into a sheet. The canvases size themselves to the reading column, so it's an inline card again.
- **Contracts:** the sticky document tabs reuse the existing `.tabs.tabs-sticky` offsets (`65px + max(safe-area, 44px)`, 73px at 1024px and up). On phones and tablets they sit flush under the sticky hub header. On desktop the fixed header ends at 60px, so there's a 13px sliver above the tabs. That's the same as the existing `.tabs-sticky` bars on other pages, so I left it for a shared fix.
- **Finance:** at 1100px and up, the Income, Expenses and Inventory sheet triggers take the left half of the row and the log runs full width underneath, so nothing actually sits beside them. The package's note said the trigger "sits beside the log". Kept as shipped. It reads fine, but it's a half-width button, not a side-by-side layout.
- **Not in this package:** the v2 README §8.5–8.7 screens are bigger than what W3 ships. Missing: the Invoices / Finance / Quick charge top segmented control, row `⋯` action sheets, hex-avatar rows restyled with Anton amounts, Finance's "Spent this month" hero with a stacked category bar, the Quick charge keypad, Runway's Safe-to-spend ring, runway gauge, paired history bars and dashed "+ Add …" rows, and Contracts' type cards, numbered done/waiting section cards and dashed signature pads. W3 is layout plus shell CSS only. Those need their own pass.
- Rendered 390 and 1440, dark and light, base vs. after, with a stubbed Supabase and seeded invoices, quotes, expenses, income and contracts: every invoice tab, Finance's cost/expenses/income, Contracts and Runway. No horizontal scroll anywhere. The summary tile numbers are the same on base and after.

## 2026-09-28 -- Workspace W4: people + field pages (Clients, Client detail, Route planner, Reviews, Appliance Wiki)
- Package 4 of 5 of the v2 Workspace redesign (`design_handoff_workspace_app_v2`, `redesign-W4-people-field`), applied on top of W1 (#451). Touches only `tools/clients.html`, `tools/client-detail.html`, `tools/review-request.html`, `tools/route-planner.html`, `tools/parts-reference.html`. The package is CSS plus one `data-th-page` attribute on each `<body>`. No markup, handler or data path changed.
- **Where the CSS lives:** the package appended its W4 block to `tools/styles-tools.css`. Same call as W2: I moved it, rule for rule, into each page's own `<style>` (at the end of the block). Every rule is keyed to that page's `body.th-tool-page[data-th-page="..."]`, and the nine portal pages also load the shared sheet. I split it by the package's own per-page section headers and asserted that each section only names its own page key before placing it. No new `@media` query text lands ahead of a page's existing ones, and no bare hex is needed (only existing tokens: `--th-radius-card`, `--th-radius-control`, `--th-rule`, `--bg-panel(-2)`, `--border`, the font tokens).
- **`data-th-page` in the markup** duplicates what W1's `markPage()` derives from the filename; `markPage()` returns early when it's present. It's kept because it makes the per-page layout apply at first paint instead of after `tools-nav-pwa.js` runs (no layout jump on desktop).
- **Route planner (>=1100px):** `body` becomes a 2-column grid, with the map in a sticky right column (`top: 77px`, `#routeMap` min-height `calc(100vh - 110px)`). This was the package's one unverified item. I checked it with a real Leaflet 1.9.4 (the same dist bytes, so SRI passes) and stubbed geocoder/tiles. At 1440x900 the map is 517x790 and tiles fill it. Leaflet's own `getSize()` tracked the container through 1440 -> 1000 (stacked, 638x320) -> 1440 -> 1920 (517x970), so a resize reflows it with no `invalidateSize()` needed. Before any stop is added, the map column is just the existing empty-state card.
- **Reviews (>=1200px):** the send panel is 2 columns, with Message Preview (`#panel-send > .form-section:nth-child(3)`) sticky on the right and Recently sent under it. W1's sheet layer doesn't wrap these sections (they aren't `is-collapsed`), so the nth-child index still points at the preview.
- **Clients (>=1280px):** the directory list is two columns of rows. With `#tab-directory` capped at 860px, each column is about 424px, which still fits the owed pill plus Call.
- **Appliance Wiki:** the search/filter row is sticky. On a phone it sits flush under the 108px app bar (row top 109). On a computer it sits under the 60px bar (row top 61). The faint content showing through the bottom of the phone header is that header's existing translucent glass, the same as base.
- **Not in this package:** the v2 README's bigger §8.8-8.12 screens. That means Clients' "New leads" chip, the client-detail 4-up Call/Text/New job/Invoice hero, the Lifetime/Jobs/Avg ticket/Client since stats grid, the What's next + History timeline and red delete zone, the reviews iMessage bubble and stat tiles, route stop drag handles/numbered circles, the wiki's six type tiles and `⋯` row menus. W4 predates them and ships none of that; they'd need their own pass.
- Rendered base vs after at 390 and 1440, dark and light, with stubbed Supabase and seeded clients/jobs/invoices, plus a route-planner variant with 4 geocoded stops. No horizontal scroll and no page errors anywhere. Light-mode full-page captures show the same below-the-first-viewport dark band W2 logged (a capture artifact of W1's viewport-sized `html` gradient, on base too).

## 2026-09-28 -- Client portal redesign v2, part 2: Estimates, Visits, Request, Contracts, Settings, sign-in

The second half of the v2 portal handoff (`portal/README.md` section 6), built on part 1's shell as it actually landed on `main` (#453): the `.portal-appbar` header, `portalEnhanceShell()`'s rail, 26c's flat orange primary, 26d's sheet motion and the portal-scoped tokens. The new CSS is section 27 at the end of `portal-polish.css`, all under `body.portal-page`, or `body:has(.login-box)` for the two signed-out pages (the hook sections 1 and 7 already used; tests pin that those pages keep a bare `<body>`). `home.html`, `dashboard.html`, `tools/` and the public site are untouched.

- **Same header everywhere.** Estimates, Visits, Request, Contracts and Settings get part 1's app bar (kicker + Anton title, round Report-a-problem, initials). The page-foot `#reportBugLink` moved into the header, one element, same id. Contracts never had Report a problem; it now has the same overlay and script as every other signed-in page (copied verbatim), because the header spec puts the button on every screen. Contracts also gets a phone-only back chevron to Home. Settings has no account button (it is that page).
- **Mostly CSS, small markup changes.** Tests pin a lot of render-function markup as literal text, so class names were added rather than renamed where a test reads them (the request Cancel button keeps `class="btn secondary-btn"` exactly and is styled via `.wo-card-actions`). Settings' blue buttons are mapped to the orange primary by CSS (`.settings-panes .btn.blue`) rather than touching the MFA/card/push markup. Only one test changed: `portal-visits` now expects `btn orange schedule-cta`.
- **Estimates:** kicker (number · date), the description as an Anton title, the Total under an orange rule, Approve (orange) / Decline (red tint), then pill links for the question and the PDF. The Estimates tab dot is now lit from quotes.html too (`portalApplyNavEstimatesDot`, from the rows the page already reads).
- **Visits:** the check-up is a hero card with an orange Schedule this visit; warranty rows use the existing 20px ring SVG drawn at 54px with the days left inside. Orange means the last 7 days: the warranty is 30 days, so the brief's literal "orange under 30 days" would be orange always. Visit cards get a date tile, a Done pill (a job only syncs once done) and a 3-up photo grid. No amount on the card: `client_portal_jobs` has no total and adding a query was out of scope. The photo lightbox now rides the sheet motion on a phone.
- **Request:** labels are Oswald, urgency is a segmented three-way with Urgent in red, photos are a 4-up grid, and the progress track names its four stages under the bar (visual only; the existing aria-label still says where it stands). The count stays "N / 2000", the real `maxlength`, not the brief's 1000. Section 23's thin bottom-edge track is hidden on these cards, since the labelled track says the same thing.
- **Contracts:** a 2x2 facts grid (price, when, where, payment) read from the contract's own `field` / `totalHighlight` blocks by label match. A missing fact is left out. No per-contract PDF: none exists today, and building one is feature work.
- **Settings:** hex initials, Anton name, the email wraps with `overflow-wrap:anywhere`, and the email preferences are the same checkboxes drawn as switches (`appearance:none`, still real checkboxes with a focus ring).
- **Sign-in / set password / lock:** markup and CSS only. The login card gains a brand hex, a kicker, "Sign in" as the title, and the "no sign-up here" note. The lock gate reads "Portal locked" with a Face ID glyph, **Unlock with Face ID**, and **Sign out** (the fallback button always signed out; its label now says so). The Face ID step keeps "Continue with Face ID" (a test pins it). The flows were walked in headless Chromium against a stubbed Supabase client, on base and on this branch, with identical results: wrong password, password to home, password + MFA code (short, wrong, right), MFA Cancel signing out, forgot then reset email with the `set-password.html` redirect, an already signed-in session that still owes the code, set password (short, mismatched, good, invalid link).
- **Not done, on purpose:** "Taken" slots in the picker (the availability code only returns open slots); "Confirm <time>" on the confirm button (its label is reset in three code paths); a sign-in button after set-password success (the page redirects to Home, as before).
- **Hovers:** every page-local `:hover` on these seven pages is now inside `@media (hover:hover)`, the same wrap part 1 used.

Checks: rule-1 audit (ids, names, `data-*`, hrefs, scripts, handlers, functions; base a27a8d6 vs this branch) found nothing removed. In headless Chromium none of the 134 `th-tool-page` selectors match anything on these seven pages at 390 or 1440, and none sets `data-theme`. Screenshots (before/after at 390 and 1440, plus the picker, lightbox, lock, report sheet and Settings sections) are in `docs/client-portal-redesign-v2-part2/`.
