# Visual specialist log

Started 2026-09-16, alongside the `tripleh-visual` skill. See `README.md` in
this directory for how these logs work.

## 2026-09-16 -- deep-dive audit: gallery lazy-load bug found, two suspected issues ruled out

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

<!-- Add new entries above this line -->
