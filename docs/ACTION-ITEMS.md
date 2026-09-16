# Action Items

A running list of things that can't be finished from code alone, plus a
running list of user-visible additions worth knowing about. Add to these
as new items come up.

## Manual action items (need a human, outside of code)

These cannot be done via a migration, edge function, or any MCP tool
available to this repo -- they require someone with dashboard access to
click a setting by hand.

1. ~~Enable "Prevent use of leaked passwords" (Supabase dashboard:
   Authentication -> Providers -> Email -> "Prevent use of leaked
   passwords").~~ **Done (2026-09-15).**
2. **Enable MFA availability** (Supabase dashboard: Authentication ->
   MFA). This only makes TOTP/phone factors available to enroll in --
   actual enrollment UI and a step-up-during-login challenge flow is a
   separate, larger feature decision, not a quick fix. Worth revisiting
   once the client-portal population is large enough that a single
   compromised password matters more. **Not yet done.**

<!-- Add new manual action items above this line -->

## SEO action items (need a human, outside of code)

Real, ranked things that grow organic traffic/leads but genuinely can't
be done from a repo -- they need a login, a phone call, or a person on
the other end. Code-side SEO work (schema, page speed, content structure)
lives in "Proposed visual improvements" below and gets built directly
when greenlit; these do not.

1. **Google Business Profile: claim/verify it if not already, and keep
   it active.** This is usually the single biggest local-ranking lever
   for a service business -- more than anything on the site itself.
   Weekly: add a photo from a real job, post an update, answer any new
   Q&A. Respond to every review (good or bad) within a few days.
2. **Ask every real happy customer for a Google review, not just a
   Triple H internal one.** The site's review-request tool
   (`tools/review-request.html`) sends a text/email asking for feedback,
   but getting it to actually land as a public Google review (not just a
   private reply) is a manual nudge -- "if you have 30 seconds, a Google
   review helps other people in town find us" -- worth saying out loud on
   the last visit of a job, not just texting a link.
3. **Real backlinks from other real local sites**: BBB, the St. George
   Area Chamber of Commerce, Nextdoor Business, Angi/HomeAdvisor/Thumbtack
   profiles, local supplier sites that list contractors they work with.
   None of this can be automated -- each is its own signup/profile/claim
   process, and a link from a real local business directory carries much
   more SEO weight than anything on-site.
4. **NAP consistency check** (Name/Address/Phone, exactly matching,
   across every place Triple H is listed online -- Google, Yelp,
   Facebook, BBB, any directory). Inconsistent phone formatting or an
   old address anywhere confuses Google's local-ranking algorithm. A
   one-time manual audit, worth doing once and then keeping in sync.
5. **Google Search Console**: verify site ownership (a one-time
   dashboard/DNS step, can't be done from this repo) if not already
   done, then check it periodically for crawl errors, manual actions, or
   pages Google isn't indexing that should be.
6. **More non-flooring job photos**, handed off for the site to use --
   already flagged under "Proposed visual improvements" below (#1), but
   worth calling out here too: real photos are also a genuine SEO input
   (image search, GBP posts, city-page credibility), not just visual
   polish.
7. **Local sponsorships/community involvement** (a little league team, a
   school fundraiser, a chamber event) that naturally generates a real
   backlink or local news mention -- slower, but the kind of link no
   amount of code can manufacture.

<!-- Add new SEO action items above this line -->

## Visual additions (things a real user/client will actually see)

User-facing UI/content changes made during the recent audit pass, for
reference:

- **Local reviews section** added to all 14 landing/about/work pages --
  real Google reviews, visible social proof above the fold area.
- **FAQ section** added to all 14 landing pages, with matching visible
  Q&A content (not just schema markup).
- **Privacy Policy page** (`privacy.html`) -- new, linked from footers
  site-wide.
- **Mobile hamburger menu** now closes on Escape / click-outside and
  returns focus properly across 16 pages (accessibility fix, subtle but
  user-facing).
- **Quote-to-invoice conversion rate** stat added to the invoice
  generator's Recent Quotes view (internal tool, Workspace users only).
- **Workspace "Getting Started" guide** rewording -- now explains the
  real per-account role system (Owner, Developer, Employee) instead of
  a stale "everyone shares one login" description.
- **City landing page hero distance chip** -- each of the 7 city pages
  (`handyman-cedar-city-ut.html` and siblings) now shows its own
  direction/ETA from St. George (e.g. "About 20-25 minutes east of
  St. George") right under the hero H1, so the hero reads as locally
  specific instead of the same template with only the H1 text swapped.
  Real distinct hero photography per city isn't feasible (no such
  photos exist), and each page already had the site's service-radius
  map further down focused on its own city -- this closes the gap in
  the hero itself.
- **"Liquid Glass"-inspired polish pass** (public site, `styles.css`) --
  targeted touches, not a system-wide restyle:
  - A one-time specular sheen sweeps across primary buttons on hover,
    layered on top of the existing flat fill + hard offset shadow (the
    2026-09-07 fix that deliberately killed a glossy gradient *fill*
    stays intact -- this is a light-catch effect on hover, not that).
  - Buttons and service cards get tactile press feedback (a slight
    scale-down on `:active`).
  - The service-detail modal card is now real frosted glass (blur +
    translucent fill) floating over its already-blurred scrim, instead
    of a flat opaque panel.
  - `.coverage-badge`/`.open-status` (the standard/by-request pill) and
    the new hero distance chip got a deeper blur/saturation, and the
    chip is now an actual pill (background + border) instead of plain
    inline text.
  - The theme toggle got a subtle translucent fill to match, without
    adding blur to it directly (it sits nested inside the sticky
    header, where blur has a known iOS Safari ghosting bug already
    fixed once elsewhere in this file).
  - Skipped on purpose: true cursor-tracking glow (would need a JS
    mousemove listener added to every page) and any change to the
    portal, which already has its own glass/shadow treatment.
- **Masonry gallery + category filter chips** (`our-work.html`) -- the
  62-photo gallery is now a Pinterest-style CSS multi-column layout
  (real aspect ratios, not forced crops) with clickable category chips
  ("All" + one per real `<h4>` category) that filter the visible tiles.
- **Reviews expanded from 3 to 6 per page** (`our-work.html` and all 8
  city landing pages, incl. the new `handyman-st-george-ut.html`) -- the
  same real reviews used on the homepage, shown 4-up with a
  `<details>` toggle for 2 more, replacing the old static 3-card wall.
  Stayed under the existing `<7`-cards-and-no-`aggregateRating` rule for
  non-homepage pages (see `landing-page-social-proof.test.js`) rather
  than duplicating all 7 homepage reviews everywhere.
- **"Try me" hint on the interactive slider sections** (`index.html`
  `#teardownStage`, `#revealJob`) -- a one-time pulsing glow on the
  range thumb fires when the section scrolls into view and stops for
  good the moment a visitor actually drags it.
- **Grouped FAQ lists** (`index.html`, `our-work.html`) -- the flat
  Q&A columns are now split into category sub-headings (Pricing &
  Payment, Scheduling & Availability, Service Area & Coverage,
  Policies), with the FAQPage JSON-LD reordered to match the new
  visible order exactly. The Supabase-fetched live-FAQ path still
  renders flat when it loads -- grouping that too needs a category
  column added to the `site_faq` table, not done here.
- **Custom invoice/quote line-item disclosure** (`portal/dashboard.html`,
  `portal/quotes.html`) -- the existing CSS chevron marker now gets a
  real open/close height transition (CSS-grid `0fr`/`1fr` trick)
  instead of snapping open, respecting `prefers-reduced-motion`.
- **Toast/snackbar system in the portal** (`portal/dashboard.html`,
  `portal/quotes.html`, `portal/settings.html`) -- every `alert()` on an
  error/validation path was replaced with a themed toast
  (`showToast()` in `portal/portal-app.js`), mirroring the same
  convention the internal tools suite already uses, message text
  unchanged.
- **Scroll affordance on the quote date-picker** (`portal/quotes.html`
  `.date-row`) -- a trailing-edge gradient fade now shows only when
  there's more to scroll to, and hides once scrolled to the end.

<!-- Add new visual additions above this line -->

## Proposed visual improvements (not yet built)

Ideas from a UX/visual pass over the public site and client portal,
ranked roughly by impact. None of these are implemented yet -- pick
which ones to greenlight and we'll move them into "Visual additions"
above as they ship.

1. **Add real non-flooring photos to "Other Work"** (`our-work.html`) --
   58 of 62 gallery photos are flooring/tile; only 4 cover anything
   else, and the homepage's "Recent Work" strip is literally hidden in
   code pending more variety. Real appliance-repair/plumbing/drywall
   photos would make "we do more than flooring" credible and let that
   hidden strip go live. **Still blocked: this needs real photos handed
   off from actual jobs -- nothing to build here until those exist, and
   the code can't fabricate them.**
~~2. Masonry layout + category filter chips for the gallery~~ -- **done**,
see "Visual additions" above.
~~3. Local imagery on city landing pages~~ -- **done**, see "Visual
additions" above.
~~4. Lead/hero image on every blog post~~ -- **already done** (every
post, old and new, has a `.blog-diagram` lead image).
~~5. Testimonial carousel instead of a static 3-card wall~~ -- **done**
(as a 4-then-toggle-2 review wall, not a literal carousel -- see "Visual
additions" above), on `our-work.html` and all 8 city landing pages.
6. **Un-hide the homepage "Recent Work" strip** (`index.html`
   `#recentWork`) -- still intentionally hidden, still waiting on real
   gallery variety (#1 above). Left alone on purpose.
~~7. Custom-styled invoice/quote line-item disclosure~~ -- **done**, see
"Visual additions" above.
~~8. Toast/snackbar system instead of `alert()` in the portal~~ --
**done**, see "Visual additions" above.
~~9. Scroll affordance on the quote date-picker~~ -- **done**, see
"Visual additions" above.
~~10. "Try me" hint on the interactive slider sections~~ -- **done**, see
"Visual additions" above.
~~11. Group/categorize the FAQ list~~ -- **done**, see "Visual additions"
above.
12. **Photo thumbnails on the busiest service cards** (`index.html`
    `.services-grid`) -- all six cards use identical-style line-icon
    SVGs. Swapping 1-2 of the busiest (Appliance Repair, Emergency
    Calls) for a real photo thumbnail would add warmth over icon-only.
13. **Loading indicator during initial portal auth check**
    (`portal/dashboard.html`, `portal/quotes.html`) -- the invoice/quote
    skeleton shows once session is confirmed, but there's a blank-white
    instant before that during the Supabase session lookup itself.

<!-- Add new proposed visual improvements above this line -->
