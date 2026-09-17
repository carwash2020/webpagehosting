# Visual specialist log

Started 2026-09-16, alongside the `tripleh-visual` skill. See `README.md` in
this directory for how these logs work.

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

<!-- Add new entries above this line -->
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
under the stacked CTAs; extra bottom padding is only a few pixels so
it does not fight the sticky Call+Book bar.

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

<!-- Add new entries above this line -->
