# Content & SEO specialist log

Started 2026-09-16, alongside the `tripleh-content` skill. See `README.md`
in this directory for how these logs work.

One seed entry, carried over from before this log existed: this
environment's network policy has, at times, blocked outbound access to
every image CDN (Unsplash, Pexels, Pixabay, even Wikipedia), not just one
site. If a candidate photo can't be fetched, ask the owner to send it
directly rather than guessing at URLs -- and check `docs/ACTION-ITEMS.md`'s
"Reserved images" section first, since a real unused photo may already be
sitting there for exactly this slot. Also: never use an Unsplash+
(`plus.unsplash.com/premium_photo-...`) image -- it needs a paid license
and often carries a visible watermark; free Unsplash is `images.unsplash.com/photo-...`.

## 2026-09-18 -- refrigerator and dishwasher repair in St. George

Wrote two more service × city pages rather than a dryer-only clone of
the washer/St. George LP (that page already covers both laundry
appliances). Fridge copy is St. George neighborhoods plus the shop
notes already public on `blog/fridge-not-cooling.html` (dusty coils,
frosted evaporator, freezer-ok/fridge-not, ice maker / defrost drain).
Dishwasher copy matches `blog/dishwasher-not-cleaning.html` (spray
arms, water temperature, drain, gasket/latch). Repair-vs-replace FAQs
use those same facts, not a washer find-and-replace.

Trust line is "5.0 from 7 Google reviews." Hero proof on both pages
uses the verified appliances quote ("Had a few of my appliances fixed
in no time"), not a fake fridge- or dishwasher-specific review. Wall
reuses the same three written Google quotes already on the washer LP.
No new Review objects, no AggregateRating.

## 2026-09-18 -- homepage high-intent FAQ next to the estimate form

Duplicated five existing answers next to the homepage hero form:
trip fee, same-day/emergency, work guarantee, repair vs replace, and
payment methods. Trip fee / same-day / guarantee / payment are the
homepage modal wording. Repair vs replace is the washer St. George LP
wording (the only existing FAQ for that objection). Did not invent a
fee, a same-day promise, or a new warranty. Did not add a second
FAQPage — the modal still owns schema and the live `site_faq` fetch.
"See all FAQs" opens that modal.

## 2026-09-18 -- washer / appliance repair in St. George (service × city)

Wrote the first combined service + city page. Copy is St. George /
Washington County specific (home base, neighborhoods already named on
the city page) plus washer FAQs already used on the service page:
repair vs replace, trip fee, same-visit when the part is on the truck,
work guaranteed / manufacturer parts warranty. Same-day arrival is
"when the schedule allows, call to check" -- the GBP seed Q&A and the
homepage emergency FAQ, not a guaranteed same-day promise.

Trust line is "5.0 from 7 Google reviews" with the existing washer
quote. No new Review objects, no extra wall cards for star-only
Google reviews. Service JSON-LD has no aggregateRating.

## 2026-09-16

Audited the blog lineup against the site's own service list and found
one real gap: washers, dryers, dishwashers, and fridges each had a post,
but ranges/ovens (a listed service on the GBP draft and elsewhere) had
none. Wrote `blog/oven-not-heating-right.html` covering the three actual
complaints that get lumped under "not heating right" -- calibration
drift, a partially-failed bake element, and a gas igniter that clicks
without lighting -- added it to the blog index and `sitemap.xml`, and
used the reserved farmhouse-kitchen photo (see ACTION-ITEMS.md) instead
of hunting for new stock art, since it already shows a real range and
had been sitting unused. Ran `check-consistency` and `check-links.py`
clean; `check-undefined-vars.js` couldn't run in this environment
(missing `eslint` module, pre-existing and unrelated to this change).

Everything in ACTION-ITEMS.md's "SEO copy drafts" section is already
pasted in live and owner-confirmed (GBP, Yelp, directories, Chamber) --
nothing left to draft there. The only open content-adjacent item (GBP
description/services/Q&A still needing to be pasted in per item 4 under
"Manual action items") needs dashboard access this session doesn't have.

Separately, closed a real internal-linking gap: `washer-dryer-repair.html`
already had a "Recent Notes From the Shop" section linking to its 2
matching blog posts, but the other 4 service pages
(`drywall-painting.html`, `plumbing-repairs.html`,
`assembly-installation.html`, `handyman-repairs.html`) had zero links
into the blog at all -- confirmed by grepping each file for `blog/`
before assuming. Added the same section, same markup/icons already used
on the blog index, to each of the 4, linking only to the one existing
post that's genuinely topically relevant per page (drywall-crack post,
toilet-flapper post, TV-mount post, and the general to-do-list post,
respectively) -- titles/deks copied verbatim from each post's real
`<title>`/meta description, nothing invented. `check-consistency`,
`check-links.py` clean; `check-undefined-vars.js` still can't run in
this environment (missing `eslint`, pre-existing); full `npm test`
has 107 pre-existing failures, all in unrelated internal-tools/dashboard
suites (workspace tour, job-tracker, baseline-diff tooling) -- none
touch the 4 files changed here. Pushed to
`content/service-page-blog-links`, not yet a PR.

## 2026-09-16 (later same day)

Found a second real gap while auditing the service pages against what's
already live on the GBP/Yelp listings: `washer-dryer-repair.html` (the
only dedicated appliance service page) listed just washers, dryers,
installation, and vent cleaning in its "What We Fix" grid, even though
the GBP profile and three separate blog posts already promise
dishwasher, refrigerator, and range/oven repair. Added those three as
real service cards, a matching FAQ (both the visible "Common Questions"
copy and the schema-paired "Frequently Asked Questions" section --
learned the hard way via `seo/landing-page-faq-schema.test.js` that
those are two separate FAQ lists on this page, not one, so a new
question has to go in both or the schema-vs-visible count check fails),
an `additionalType` addition to the page's Service schema, and two more
"Recent Notes From the Shop" links to the fridge and oven blog posts.
Deliberately left the page's URL, `<title>`, H1, and nav label as
"Washer & Dryer Repair" -- broadening those into a full appliance-repair
rebrand touches site structure/nav across 16 pages, which is a bigger
call than page copy and belongs with the owner or the features
specialist if wanted.

Also installed `jsdom`/`eslint` locally (`npm install --no-save jsdom
eslint`) to actually run the full test suite and `check-undefined-vars.js`
in this environment -- neither was present, so most of `npm test`'s
failures on a fresh checkout are that missing-module gap, not real
regressions. Worth a `package-lock.json`/CI check on why `npm ci` doesn't
already restore them, but that's bugfix/automation territory, not content.

## 2026-09-17

Spot-checked the 4-page "Recent Notes From the Shop" work from yesterday
(`content/service-page-blog-links`) against current `main` -- confirmed
live on `drywall-painting.html`, `plumbing-repairs.html`,
`assembly-installation.html`, and `handyman-repairs.html`, one relevant
blog link each, matching the branch that merged as PR #257.

While re-checking `washer-dryer-repair.html` (which got Dishwashers,
Refrigerators, and Ranges & Ovens added as real service cards
yesterday), found it only linked to 4 of the 5 relevant appliance blog
posts in its own "Recent Notes From the Shop" section -- washer, dryer,
fridge, and oven, but not `dishwasher-not-cleaning.html`, even though
dishwashers are now a listed service card on that exact page. Added the
dishwasher card using the identical icon/title/dek already used for it
on `blog/index.html`, so nothing was invented. `check-consistency` and
`check-links.py` clean; `check-undefined-vars.js` and the `jsdom`-based
FAQ-schema-sync test still can't run in this environment (missing
`eslint`/`jsdom`, pre-existing per the 2026-09-16 entry above); the
`landing-page-faq-schema.test.js` and `blog-index-cards.test.js` suites
(the ones that don't need `jsdom`) both pass in full, and neither
touches this page's blog-link section anyway.

Also re-checked ACTION-ITEMS.md's "SEO copy drafts" section against the
"Manual action items" section, which still shows item 4 (GBP long
description, individually-listed services, seed Q&As) as *not yet
pasted in* per the latest owner screenshot -- correcting my 2026-09-16
note above, which said everything there was owner-confirmed. Yelp is
confirmed done; GBP's own paste-in is still open and needs dashboard
access this session doesn't have, so it stays a manual action item, not
something to redo here.

## 2026-09-17 (later same day)

After PR #258 (dishwasher blog link) merged, kept auditing
`washer-dryer-repair.html`'s "Recent Notes From the Shop" section and
found one more real gap: `blog/appliance-repair-or-replace.html` (the
general "should I fix it or replace it" decision post) is relevant to
any appliance the page covers, not just one, but wasn't linked at all.
Added it as a 6th card, reusing the exact icon/title/dek already used
for it on `blog/index.html` -- it shares the generic appliance icon
with the dryer card there too, so this isn't a new visual pattern.
`check-consistency` and `check-links.py` both clean.

Swept the other 4 service pages (`drywall-painting.html`,
`plumbing-repairs.html`, `assembly-installation.html`,
`handyman-repairs.html`) for the same kind of gap and found none --
each already links the one blog post that's genuinely on-topic for it,
and no second relevant post exists in the current 10-post lineup for
any of them.

Also checked whether the 8 city landing pages (`handyman-*-ut.html`,
`handyman-mesquite-nv.html`) have a "Recent Notes From the Shop"
section: none do. Not fixing this now -- unlike the service pages,
where PR #257 already established "one clearly on-topic post per
page" as the pattern, a city page has no single obviously-matching
post (it's location-focused, not service-focused), so picking one
would be more of a design call than a found gap. Flagging as an idea
for later, not building it speculatively: either the owner picks a
rotation/criterion, or the site decides city pages should surface the
2-3 most recent posts generically instead of a topical match.

## 2026-09-17 -- booking success copy + referral + schema (no rating)

booking.html had no JSON-LD. Added Service (provider =
HomeAndConstructionBusiness, NAP + ZIP 84790, no street) with
potentialAction ReserveAction, plus BreadcrumbList. Did not copy
AggregateRating onto this page — Google's guideline still wants
visible review content, and the homepage 5.0 / 4 figure must not
move.

Confirmation microcopy: the slot is held; email has the
reschedule/cancel link; pay-after methods unchanged. Dropped "we'll
call or text if anything needs clarifying" as the implied confirm
step. Emergency call/text stays as a line under the timeline, not a
promise that the booking is pending a callback.

$25 referral credit now appears on step 1 and the confirmation card,
using the same complete-and-paid terms as the homepage FAQ. No new
testimonials.

## 2026-09-17 -- AggregateRating matches GBP 5.0 / 7

Connor unlocked matching Google Business Profile: **5.0 stars from 7
Google reviews**. The site had been locked at 5.0 / 4 (written quotes
only). Updated JSON-LD `aggregateRating` (`ratingValue` 5.0,
`reviewCount` 7), the homepage "Real 5-Star Reviews" stat, and the
"5.0 from 7 Google reviews" CTA lines on `index.html` and
`booking.html`. Left the homepage wall at the 4 verified written
quotes -- no invented Review objects or fake cards for the star-only
Google reviews. Tests that locked the count at 4 now expect 7.

## 2026-09-21: Fixed the 9-page duplicate meta description finding

Follow-up to the 2026-09-19 static SEO audit's main finding: 9 of 16
city/service/appliance landing pages shared an identical closing
sentence in their `<meta name="description">` -- a real
duplicate-content risk, logged then but not fixed at the time.

Two groups shared one sentence each:
- 6 city pages (Hurricane, La Verkin, Leeds, Santa Clara/Ivins,
  St. George, Washington City) all ended "Honest pricing, nothing done
  until you approve it."
- 3 appliance pages (dishwasher/refrigerator/washer-dryer, all
  St. George) all ended "Steven diagnoses it in person, prices it
  before any work starts, and often finishes the same visit."

Rewrote each closer with a real, page-specific fact already present
elsewhere on that same page (its own drive time/route from St. George,
its trip-fee note, or its own real symptom list), rather than a
synonym swap -- meaningfully different content, not just different
words for the same sentence. Kept the required opening sentence intact
on the 3 appliance pages (`service-city-landing-page.test.js` anchors
on it). Verified every one of the 9 is now a genuinely unique string
across the whole 16-page set, not just different from its own group.

New test: `tests/seo/unique-meta-descriptions.test.js` (guards against
this regressing -- checks all 16 pages for exact-duplicate descriptions
plus the two groups' closers specifically).

Real gap caught by Cursor Bugbot's own PR summary on the review, not
found here first: the first draft only de-duplicated the plain
`<meta name="description">` tag -- `og:description` on all 9 pages,
and `twitter:description` on all 9 (including its own separate,
narrower 3-way duplicate across just the appliance pages, "Diagnose
first, price before work starts."), still carried the exact old
shared text. Verified the bot's claim directly before trusting it,
then fixed both tags on all 9 pages the same way as the primary
description, and extended the regression test to cover both.

Also, while checking a related earlier flag (the `logo-signature.png`
vs `logo-signature-orange.png` naming discrepancy): that one turned
out to already be moot. The old flagged PNG is gone entirely (removed
in an earlier session extracting it from base64), and the current
`.webp` pair (`logo-signature.webp` / `logo-signature-orange.webp`,
both still in real use across the site) are visually identical --
same orange/gray/black shield mark, just different crops. No fix
needed; the underlying concern the flag described no longer applies
to the files that exist today.

Verified: full suite **2575/2575** passing. `check-consistency`/
`check-undefined-vars`/`check-links.py` all clean.

## 2026-09-23 -- note from the visual lane: the 2026-09-16 "Recent Notes" cards, and hotlinked blog images

- The "Recent Notes From the Shop" section added to plumbing, drywall, handyman-repairs and assembly (PR #257) reused the blog-index card markup. Those pages didn't load `blog/blog.css`, where all the card's styles live, so the icon and arrow rendered at 820px wide. Fixed in the visual lane (each page now loads `blog.css`). `tests/design/blog-index-cards.test.js` now fails for any page that uses the markup without it. If you add the card to another page, add the `blog.css` link too.
- Blog lead images load from `images.unsplash.com`, not from this site. That's a third-party connection on each post's likely LCP image, with no control over caching or availability. Worth copying them into `images/blog/` as sized WebP. The visual lane couldn't do it: the sandbox's egress policy blocks Unsplash, so the originals can't be downloaded.

## 2026-09-25 -- three triage symptoms get their own posts

`js/triage.js` lists 20 symptoms (5 appliances x 4). Only 5 had a post,
each the first symptom in its appliance's list. Wrote three more:
`blog/washer-leaking-water.html`, `blog/dryer-wont-turn-on.html`, and
`blog/dishwasher-not-draining.html`.

Why these three: each has high search intent, and none overlaps an
existing post. Skipped "dryer takes forever to dry" because
`dryer-not-heating.html` already targets damp clothes and vent
restriction, so a second post would compete with it. Skipped the fridge
extras (freezer-works-fridge-doesn't, leaking inside, ice maker) because
the fridge post already covers all three in short form. Skipped oven
"temperature off" because `oven-not-heating-right.html` already covers
calibration.

Each post restates its triage entry's `v`/`a` text and builds on it with
general repair knowledge. It adds no prices, percentages, or claims about
our own call volume. The one reused site fact is the homepage's April
care tip about checking washer fill hoses, which closes the washer post.

The request assumed each existing post links to its triage entry and to
`booking.html`. None does. Booking appears only in the shared nav and
footer, and the CTA is a `tel:` button. The new posts follow the real
pattern. Each has exactly one in-body link: plumbing for the washer and
dishwasher posts (standpipe, disposal), and the dryer-not-heating post
for the dryer (thermal fuse).

Wiring: blog index, the three appliance service pages' "Recent Notes",
`sitemap.xml`, `check-links.py`, and the tests that pin the post list or
the public page count. Added one inbound in-prose link each from
`washer-wont-drain.html` ("water on the floor") and
`dishwasher-not-cleaning.html` ("standing water"), because their text
already named those symptoms.

Images: Unsplash is still blocked. The washer post uses the reserved
bathroom-laundry photo, now marked placed in ACTION-ITEMS.md. The dryer
and dishwasher posts reuse their sibling posts' lead photos (the
tv-mount and to-do-list posts already share one). Swap them if the owner
sends better photos.

Still open: 12 triage symptoms have no post. Next strongest by intent:
washer won't spin, dishwasher leaking, washer no power, range burner
won't light.

<!-- Add new entries above this line -->
