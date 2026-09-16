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

1. **Stacked washer/dryer in a modern bathroom laundry nook** (dark
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
2. ~~Enable MFA availability~~ -- **done.** TOTP enabled in the
   Supabase dashboard (Authentication -> MFA), and the enrollment UI
   plus login-time step-up challenge this item originally flagged as
   "a separate, larger feature decision" were built (2026-09-16): a
   "Two-Factor Authentication" card in `portal/settings.html` (enroll
   with a real QR code, verify, or turn off -- via
   `client.auth.mfa.enroll/challengeAndVerify/unenroll`), and
   `portal/login.html` now checks
   `client.auth.mfa.getAuthenticatorAssuranceLevel()` after a correct
   password and prompts for a 6-digit code before finishing sign-in
   when a client has a verified TOTP factor. Client-portal only, by
   design -- doesn't touch the internal `/tools/` suite's own
   Owner/Developer/Employee auth (a separate, unrelated concern; see
   `docs/CLIENT-PORTAL.md`'s "Still pending" item 3 for that one).
   Opt-in, not required: an account with no factor enrolled signs in
   exactly as before.
3. **Set up a Google Ads or Meta Pixel account** for retargeting. GA4
   events are already firing (`lead_form_submitted`, phone-click events,
   etc.) and ready to feed a remarketing audience the moment one exists
   -- give me the conversion ID (`AW-...`) or Pixel ID once you have an
   account and I'll wire up the actual tag/base code. **Not yet done
   (no account exists to wire up).**
4. ~~Claim/verify Google Business Profile~~ -- **confirmed done
   (2026-09-16): "Triple H Enterprises LLC", verified badge, category
   already "Appliance repair service", 5.0 stars / 7 Google reviews
   (as of the latest screenshot), phone matches.** Still open: paste
   in the longer description,
   individually-listed services, and the 3 seed Q&As drafted under "SEO
   copy drafts" below -- profile exists and is verified, but that
   content doesn't look filled in yet from the screenshot. **Ongoing
   after that:** regular posts, fresh job photos, and prompt review
   responses keep moving the local 3-pack ranking -- not a one-time
   task.
5. **Google Local Services Ads ("Google Guaranteed")** -- pay-per-lead,
   usually the best ROI channel for handyman/appliance repair
   specifically. Requires setting up and getting verified/background-
   checked through Google's own LSA program, outside this repo.
6. **Review count mismatch: the site showed 7 reviews, Google showed
   6.** Checked directly against the real Google listing via
   screenshots the owner sent: only 3 of the original 7 quotes matched
   a real, verifiable Google review (Google had 6 total reviews, but 2
   of them -- Austin Mayer, Micah Naegle -- are star-only with no
   written text). The other 4 site quotes couldn't be traced to any
   real source, so they were removed rather than kept unverified or
   rewritten to fit a real reviewer's name. Jilleen Walker's real
   review (never on the site before) was added in as a genuine 4th
   card. `aggregateRating.reviewCount` and the "Real 5-Star Reviews"
   stat now both say 4, matching visible content, consistent with this
   site's existing policy (see `reviews-wall.test.js`) that the count
   must match what's actually shown, not just Google's raw total.
   **Done, as far as this was verified directly with the owner.**

   ~~**Update (2026-09-16, confirmed with real evidence):**~~ Google
   genuinely has 7 reviews now (owner-confirmed screenshot: "5.0 ★★★★★
   7 Google reviews"), but the owner confirmed the 7th has **no
   written text** -- same case as Austin Mayer and Micah Naegle. **No
   code change needed**: this site's schema-honesty policy (see
   `reviews-wall.test.js`) counts visible, written quotes, not
   Google's raw review total, so `aggregateRating.reviewCount` and the
   "Real 5-Star Reviews" stat correctly stay at 4. Fully resolved --
   if that 7th review ever gets real text (or any future review does),
   send it over and it'll be added as a genuine 5th card.
7. ~~Deploy the new `send-payment-reminder` edge function and run its
   cron SQL~~ -- **done (2026-09-16).** Deployed via the Supabase MCP
   tools now available to this session (an access path the item was
   originally written before) and its daily cron job (`send-payment-
   reminders-daily`, 15:00 UTC) registered directly against the
   project. Reused the existing `send_push_service_role_key` vault
   secret and `RESEND_API_KEY`/`LEAD_EMAIL_FROM`/`LEAD_EMAIL_TO`
   project secrets -- both already configured, no new secret was
   needed. **Redeployed again same day** during the security-audit
   follow-up (PR #249) to carry a real fix into production: the version
   deployed above had no auth check on incoming requests at all, letting
   anyone with the public anon key trigger real client-facing emails on
   demand. Confirmed via `mcp__Supabase__get_edge_function` that the live
   source lacked the check before redeploying, and that the redeployed
   source (matching what merged into `main`) has it. Not live-fired as
   part of either deploy since doing so would email real clients with
   real overdue invoices; its first real run is the 15:00 UTC cron.
8. ~~Deploy the new `send-quote-followup` edge function and run its
   cron SQL~~ -- **done (2026-09-16).** Same deploy path as item 7,
   daily cron job (`send-quote-followup-daily`, 16:00 UTC) registered,
   and same same-day redeploy to carry the identical auth-check security
   fix into production. The updated `send-push` (the new "Review
   Follow-Up Due" push check) needed no separate deploy step -- it's the
   same already-deployed function, already current on this branch.

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
4. ~~**NAP consistency check**~~ **Done (2026-09-16).** Checked against
   the site's own canonical NAP (Triple H Enterprises LLC, (435)
   414-1667, steve@triplehenterprisesllc.biz, St. George, UT 84790):
   Yelp matches, Facebook matches. No BBB listing (costs money --
   skipped on purpose, not an oversight; still worth revisiting under
   "real backlinks" above once there's budget for it, since a BBB
   listing is both a NAP-consistent citation and a real backlink).
   **Found a real mismatch on Google Business Profile**: an old
   business-card-style photo on the listing showed a stale phone number
   (801-357-9940) and email (triplehenterprises88@gmail.com). Two
   updated photos (a current-logo profile photo and a corrected
   business-card cover photo with the real phone/email) were generated
   and handed off to replace it -- **still needs the actual "Edit
   profile" phone/website fields on the GBP listing itself checked
   too**, not just the photo, since that's the field Google's ranking
   algorithm actually reads.
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
- **Angi, HomeAdvisor, and Thumbtack are lead-generation marketplaces,
  not free citations like Yelp/Nextdoor/BBB** -- a free basic profile
  is usually possible (still worth the backlink/citation value even
  unpaid), but ranking within their own search and getting routed real
  leads typically requires a paid membership or per-lead fee. Worth
  doing the free profile everywhere either way; treat the paid tier on
  any of these as a separate cost/ROI decision, not part of this
  backlink pass.

### St. George Area Chamber of Commerce

Chamber directories usually want a slightly more community-facing tone
than a repair-marketplace listing, and often ask for a member
"spotlight" or "about us" blurb separate from the plain business
description above:

> Triple H Enterprises is a locally owned, owner-operated handyman and
> appliance repair business serving St. George and the surrounding
> Southern Utah communities -- Hurricane, Washington City, Santa Clara,
> Ivins, La Verkin, Leeds, Cedar City, and Mesquite, NV. We handle
> everything from washer/dryer and appliance repair to plumbing fixes,
> drywall and painting, furniture assembly, and general handyman work,
> with the owner answering the phone directly on every call. Honesty,
> hustle, and helpfulness aren't just a slogan -- they're how we run
> every job. Call or text (435) 414-1667.

- Chamber membership itself is usually a paid annual fee (unlike the
  free-tier directories above) -- confirm current pricing with the
  Chamber directly before joining; the payoff here isn't just the
  directory backlink, it's the local-sponsorship/event angle in item 7
  above (a Chamber event or mixer is a natural, real way to pick up
  that kind of link/mention, not something code can manufacture).
- If the Chamber's own directory offers a logo/photo upload, use the
  same current orange logo (`images/logo-signature-orange.webp`) and
  the GBP business-card photo generated earlier this session, so the
  brand looks consistent everywhere it shows up.

### Yelp profile refinement (2026-09-16)

NAP already confirmed matching (see "NAP consistency check" above) --
this is about filling in the fields that actually move Yelp's own
search ranking and conversion, past the bare minimum:

- **"From the Business" long description** (Yelp allows up to ~1,000
  characters here, separate from the shorter summary blurb above):
  > Triple H Enterprises is a locally owned, owner-operated handyman
  > and appliance repair business based in St. George, Utah. When you
  > call, you're talking directly to the owner, Steve -- not a call
  > center or a rotating cast of subcontractors. We repair washers,
  > dryers, dishwashers, refrigerators, and ranges, and handle general
  > handyman work: plumbing fixes, drywall and painting, furniture
  > assembly, and TV mounting. Jobs within 15 miles of St. George have
  > no trip fee. All work is guaranteed, and parts carry whatever
  > warranty the manufacturer sets. Refer a friend and get a $25
  > credit toward your next service once their job is complete and
  > paid. Serving St. George, Hurricane, Washington City, Santa Clara,
  > Ivins, La Verkin, Leeds, Cedar City, and Mesquite, NV. Call or text
  > (435) 414-1667.
- **Specialties field:** Washer & dryer repair, dishwasher repair,
  refrigerator repair, range/oven repair, plumbing repairs, drywall &
  painting, furniture assembly, TV mounting, emergency repairs.
- **Business highlights to toggle on** (only the ones actually true --
  confirmed against the site's own FAQ/terms content, not guessed):
  Licensed & Insured (`index.html`'s own trust-strip already claims
  this), Guaranteed Work, Locally Owned & Operated, Emergency Services
  Offered, Accepts Credit Cards (Stripe). Skip anything Yelp offers
  that isn't independently confirmed (e.g. don't toggle "Free
  Estimates" -- pricing is set after an in-person diagnosis per the
  site's own FAQ, not a free walk-through estimate, so that highlight
  would be inaccurate).
- **Payment methods to list:** Cash, check, Venmo, Cash App, credit/
  debit card.
- **Photos:** the two GBP photos generated earlier this session (the
  current-logo profile photo and the corrected business-card cover
  photo) work here too for brand consistency, but Yelp specifically
  rewards real job-site photos more than any other platform for
  driving actual clicks-to-call -- this is the single highest-value
  place to use real job photos once they're handed off (see item 6
  above).
- **Yelp "Request a Quote" messaging button:** if Yelp's own lead
  button is enabled, make sure notifications route somewhere actually
  checked daily -- an unanswered Yelp lead is worse than no Yelp
  presence, since Yelp's own algorithm penalizes slow/no response rate
  in future placement.

**Done (2026-09-16), confirmed by the owner:** all of the above was
pasted into the live Yelp listing (About/description, specialties,
highlights, payment methods, photos, lead notification check).

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
- **One-click "Create Invoice" from a job** (`tools/job-tracker.html` ->
  `tools/invoice-generator.html`) -- closes the "converting a recurring
  job template straight to an invoice (still fully manual each time)"
  gap noted in `README.md`'s 2026-09-16 audit entry. See that day's
  final changelog entry for the full write-up.

- **New blog post: "Oven Not Heating Right?"** (`blog/oven-not-heating-right.html`,
  2026-09-16) -- closes the one real gap in the blog lineup: range/oven
  repair is a listed service with no post covering it, while washers,
  dryers, dishwashers, and fridges each already had one. Covers
  calibration drift, a partially-failed bake element (uneven baking),
  and a gas igniter that clicks without lighting. Uses the reserved
  farmhouse-kitchen photo from "Reserved images" above (a real supplied
  photo showing an actual range, not stock-picked for the topic).
  Linked from the blog index and `sitemap.xml`.

- **Washer/dryer service page now lists all appliance types actually
  sold** (`washer-dryer-repair.html`, 2026-09-16) -- added Dishwashers,
  Refrigerators, and Ranges & Ovens as real service cards, a matching
  FAQ entry, and a Service-schema `additionalType`, closing a gap where
  the GBP profile and three blog posts already promised those repairs
  but the dedicated service page didn't mention them. Page URL, title,
  H1, and nav label deliberately left as "Washer & Dryer Repair" --
  rebranding the page/nav into "Appliance Repair" is a bigger structural
  call, not a copy change.

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
