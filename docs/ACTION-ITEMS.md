# Action Items

A running list of things that can't be finished from code alone, plus a
running list of user-visible additions worth knowing about. Add to these
as new items come up.

## Reserved images (supplied, not yet placed)

Real photos the owner supplied directly during the 2026-09-16 blog-image
pass, not used yet because nothing on the site is the right fit for them.
Kept here so they don't get lost -- pull from this list before reaching
for stock photos next time something needs a real kitchen or laundry
image.

1. **Farmhouse-style kitchen** (black cabinets, subtle range, dishwasher,
   farmhouse sink, wood countertops, red enamel cookware) --
   `https://images.unsplash.com/photo-1556909172-54557c7e4fb7?fm=jpg&q=80&w=1400&auto=format&fit=crop`.
   Supplied for `dryer-not-heating.html` but doesn't show a dryer/laundry
   at all, so it wasn't used there. Good candidate for a future blog
   post (a kitchen-remodel or general-handyman piece) or another page
   that wants a warm, real-kitchen photo.
2. **Stacked washer/dryer in a modern bathroom laundry nook** (dark
   vanity, towels, plant) --
   `https://images.unsplash.com/photo-1721395285456-05a8b9b45b9f?fm=jpg&q=80&w=1400&auto=format&fit=crop`.
   Supplied after `dryer-not-heating.html` (the last post needing an
   image) had already been filled with a different photo, so there was
   no open slot for this one. Good candidate for a future laundry-
   related blog post, or to replace a stock laundry photo elsewhere on
   the site if one turns up.

<!-- Add new reserved images above this line -->

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
   repo can act on it; it's a dashboard/account task. **Description,
   category, service list, and seed Q&A drafted and ready to paste in --
   see "SEO copy drafts" below.**
5. **Google Local Services Ads ("Google Guaranteed")** -- pay-per-lead,
   usually the best ROI channel for handyman/appliance repair
   specifically. Requires setting up and getting verified/background-
   checked through Google's own LSA program, outside this repo.
6. **Review count mismatch (2026-09-16): the site shows 7 reviews, Google
   shows 6.** One of the 7 real quotes on `index.html`'s reviews wall is
   labeled "on Google" but isn't actually a Google review. Every card
   uses the same label in the markup, so which one to fix can't be
   worked out from the code -- check which one on Google's own listing
   is missing, then tell me which quote it is (first few words is
   enough) so I can remove that card and update the `aggregateRating`
   `reviewCount` (currently 7) and the homepage's "Real 5-Star Reviews"
   stat to 6. **Not yet done -- waiting on this answer.**

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

## SEO copy drafts (ready to paste in, 2026-09-16)

Drafted so items 1 and 3 above are copy/paste instead of blank-page work.
**NAP audited against the site first** (index.html, `LocalBusiness` schema)
and confirmed consistent -- use exactly this everywhere a listing asks for
name/address/phone, so nothing has to be fixed later:

- **Name:** Triple H Enterprises (LLC)
- **Phone:** (435) 414-1667
- **Email:** steve@triplehenterprisesllc.biz
- **Address:** St. George, UT 84790 (service-area business, no public
  storefront -- on Google Business Profile, set this up as a "service
  area business" and hide the address, which is the correct setting for
  an owner-operator who drives to jobs rather than a shop customers visit)
- **Website:** https://www.triplehenterprisesllc.biz/
- **Service area:** St. George, Hurricane, Washington City, Santa Clara,
  Ivins, La Verkin, Leeds, Cedar City, Mesquite NV

### Google Business Profile

- **Primary category:** Appliance repair service
- **Additional categories:** Handyman, Contractor
- **Short description (750 char limit):**
  > Owner-operated handyman and appliance repair serving St. George and
  > Southern Utah. Washers, dryers, dishwashers, fridges, ranges, general
  > handyman repairs, plumbing fixes, drywall and painting, assembly and
  > installation, and emergency calls. When you call, you're talking
  > directly to the owner -- not a call center or rotating
  > subcontractors. Same-day service available. Serving St. George,
  > Hurricane, Washington City, Santa Clara, Ivins, La Verkin, Leeds,
  > Cedar City, and Mesquite NV. Call or text (435) 414-1667.
- **Services to list individually** (GBP lets you add each as its own
  service under the category, which helps it match more specific
  searches): Washer repair, Dryer repair, Dishwasher repair,
  Refrigerator repair, Range/oven repair, General handyman repair,
  Plumbing repair, Drywall repair, Interior painting, Furniture
  assembly, TV mounting, Emergency repair
- **Seed Q&A** (post these yourself as the owner, so they show up
  answered from day one instead of sitting empty for a stranger to ask):
  - Q: "Do you charge a trip fee?" A: (use each city page's actual
    trip-fee wording, already live on the site -- keep it consistent)
  - Q: "Do you offer same-day service?" A: "Yes, when the schedule
    allows -- call or text (435) 414-1667 to check same-day
    availability."
  - Q: "What brands of washers/dryers do you repair?" A: "All major
    brands -- Whirlpool, Maytag, LG, Samsung, GE, and more."
- **Weekly cadence:** one photo from a real job, one GBP post/update,
  answer new Q&A and reviews within a few days (see item 1 above).

### Directory listings (BBB, Angi, Thumbtack, Yelp, Nextdoor, Yellow Pages)

Use the same description on every one so the business reads as one
consistent entity across the web, not five slightly different ones:

> Triple H Enterprises is an owner-operated handyman and appliance
> repair business based in St. George, Utah. We repair washers, dryers,
> dishwashers, refrigerators, and ranges, plus general handyman work:
> plumbing fixes, drywall and painting, furniture assembly, and TV
> mounting. Emergency calls welcome. Serving St. George, Hurricane,
> Washington City, Santa Clara, Ivins, La Verkin, Leeds, Cedar City, and
> Mesquite, NV. Call or text (435) 414-1667.

- **Categories to select where the site offers a picklist:** Appliance
  Repair, Handyman Services, General Contractor (if offered, otherwise
  skip)
- **Website field:** always the full `https://www.triplehenterprisesllc.biz/`
  URL, not a bare domain or a page deep-link, so backlink value goes to
  the homepage.
- Yelp and Nextdoor in particular reward profile completeness (hours,
  photos, service list) for initial visibility, so fill in every field
  the form offers rather than the minimum required.

<!-- Add new SEO copy drafts above this line -->

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

- **Portal toast/snackbar** replacing every `window.alert()` in the
  client portal (`portal/quotes.html`, `portal/dashboard.html`,
  `portal/settings.html`) -- also fixed a real bug where
  `portal/work-orders.html` already called a `showToast()` that didn't
  exist anywhere in the portal, silently throwing instead of telling
  the client their message failed to send.

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
~~8. Toast/snackbar system instead of `alert()` in the portal~~ --
   **done (2026-09-16)**, see "Visual additions" above.
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
