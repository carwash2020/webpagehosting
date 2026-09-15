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
3. **Set up a Google Ads or Meta Pixel account** for retargeting. GA4
   events are already firing (`lead_form_submitted`, phone-click events,
   etc.) and ready to feed a remarketing audience the moment one exists
   -- give me the conversion ID (`AW-...`) or Pixel ID once you have an
   account and I'll wire up the actual tag/base code. **Not yet done
   (no account exists to wire up).**
4. **Google Business Profile** -- regular posts, Q&A seeding, fresh
   photos, and review velocity there move the local 3-pack ranking more
   than the website itself does for "near me" searches. Nothing in this
   repo can act on it; it's a dashboard/account task.
5. **Google Local Services Ads ("Google Guaranteed")** -- pay-per-lead,
   usually the best ROI channel for handyman/appliance repair
   specifically. Requires setting up and getting verified/background-
   checked through Google's own LSA program, outside this repo.

<!-- Add new manual action items above this line -->

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
- **Lead-generation pass** (2026-09-15), from "how do we get more leads
  / more traffic":
  - **Service x city cross-links**: each of the 5 service pages
    (`assembly-installation.html` and siblings) now has a real
    `areas-links` block linking to all 7 city pages, with the service
    name baked into the visible anchor text (e.g. "Plumbing Repairs in
    Hurricane") -- targets long-tail "[service] [city]" searches that
    previously had no on-page text at all, without creating 42 thin
    near-duplicate pages (a doorway-page anti-pattern Google penalizes).
  - **Speed-to-lead note** added to the homepage's lead form, reusing
    the same honest "usually within a few hours" claim already used in
    the chat panel, so it's consistent site-wide.
  - **First-time-customer discount banner**: a dismissible 15%-off
    banner (code `WELCOME15`) now populates `#siteBanner1`, a scaffold
    every public page had declared from the start but that no script
    had ever written into or styled. Staff apply the discount manually
    via the existing "Discount label / amount" field already in the
    invoice generator. Shown on the homepage, all 7 city pages, and all
    5 service pages; dismissal is remembered via localStorage so it
    doesn't nag a returning visitor.
  - Blog post CTAs were checked and are already in good shape (every
    real post already ends with a `.blog-cta` call-to-action) -- no
    change needed there.
  - Retargeting and Google Business Profile/Local Services Ads are
    listed under "Manual action items" above -- they need an actual ad
    account or dashboard access this repo doesn't have.

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
   hidden strip go live (see #6 below -- nearly free once photos exist).
2. **Masonry layout + category filter chips for the gallery**
   (`our-work.html`) -- 62 photos currently render as a flat, uniform
   grid with plain `<h4>` dividers. A Pinterest-style masonry layout
   (real aspect ratios already in the markup) plus filter chips would
   make it far less of a scroll.
~~3. Local imagery on city landing pages~~ -- **done**, see "Visual
additions" above.
4. **Lead/hero image on every blog post** (`blog/*.html`) -- posts are
   currently text-only. A relevant photo at the top would improve
   scannability and how posts look when shared (currently falls back to
   a generic og-image for every post).
5. **Testimonial carousel instead of a static 3-card wall**
   (`index.html` `#reviews`, `our-work.html` `#local-reviews`) -- only 3
   of the claimed 7 real 5-star reviews show, hardcoded per page. A
   small rotating/paginated component pulling from one shared source
   would surface more social proof without duplicating markup.
6. **Un-hide the homepage "Recent Work" strip** (`index.html`
   `#recentWork`) -- sitting hidden waiting on gallery variety (#1).
   Cheap to flip on once that's done.
7. **Custom-styled invoice/quote line-item disclosure**
   (`portal/dashboard.html`, `portal/quotes.html`) -- currently a plain
   `<details>`/`<summary>` toggle with the default browser triangle. A
   chevron icon + smooth height transition would match the portal's
   existing polish.
8. **Toast/snackbar system instead of `alert()` in the portal**
   (`portal/quotes.html`) -- a few error paths (e.g. "Couldn't reach the
   server...") still use native `alert()`, which blocks the UI and
   looks dated next to the custom modals already on the same page.
9. **Scroll affordance on the quote date-picker**
   (`portal/quotes.html` `.date-row`) -- a horizontally-scrolling single
   row with nothing indicating more dates exist off-screen. A subtle
   fade/gradient edge or arrow hint would fix that.
10. **"Try me" hint on the interactive slider sections** (`index.html`
    `#teardownStage`, `#revealJob`) -- both are plain range sliders that
    can read as decoration; a subtle pulse/glint on first view would
    signal they're interactive.
11. **Group/categorize the FAQ list** (`index.html`, `our-work.html`) --
    15+ Q&As currently sit in one flat column with no grouping (pricing
    vs. scheduling vs. policy); light categorization would help visitors
    self-serve faster.
12. **Photo thumbnails on the busiest service cards** (`index.html`
    `.services-grid`) -- all six cards use identical-style line-icon
    SVGs. Swapping 1-2 of the busiest (Appliance Repair, Emergency
    Calls) for a real photo thumbnail would add warmth over icon-only.
13. **Loading indicator during initial portal auth check**
    (`portal/dashboard.html`, `portal/quotes.html`) -- the invoice/quote
    skeleton shows once session is confirmed, but there's a blank-white
    instant before that during the Supabase session lookup itself.

<!-- Add new proposed visual improvements above this line -->
