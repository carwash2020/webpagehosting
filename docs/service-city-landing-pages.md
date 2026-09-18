# Service × city landing pages

One converting page per **service + city** pair, not a factory of thin
near-duplicates. Google treats doorway pages as spam; this template
exists so a real query like "washer repair St. George" lands on a page
written for that query, with unique copy, not a find-and-replace of
the city name.

## Live path (first instance)

https://www.triplehenterprisesllc.biz/washer-dryer-repair-st-george-ut.html

File: `washer-dryer-repair-st-george-ut.html`

## URL pattern

`{service-slug}-{city-slug}.html`

Reuse slugs already in the repo:

| Piece | Existing examples |
|---|---|
| Service | `washer-dryer-repair`, `plumbing-repairs`, `drywall-painting`, `handyman-repairs`, `assembly-installation` |
| City | `st-george-ut`, `hurricane-ut`, `washington-city-ut`, `santa-clara-ivins-ut`, `leeds-ut`, `la-verkin-ut`, `cedar-city-ut`, `mesquite-nv` |

Planned clones named in the original request:

- Dryer in Hurricane → `washer-dryer-repair-hurricane-ut.html` (same appliance page, swap city copy) or a dryer-specific slug only if the H1 is truly dryer-only
- Fridge in Washington → `washer-dryer-repair-washington-city-ut.html` (same, fridge-forward H1/FAQs) — Washington City's city slug is `washington-city-ut`, not `washington-ut`

Do not invent a third naming scheme. City-only pages stay
`handyman-{city}.html`. Service-only pages stay `{service}.html`.

## How to clone

1. Copy `washer-dryer-repair-st-george-ut.html`.
2. Replace title, meta description, canonical, og/twitter tags, H1, and
   hero lede so they name **this** service and **this** city. Keep the
   outcome: diagnose in person, price before work starts.
3. Trip-fee FAQ is city-specific (St. George is home base, almost never
   a fee; Hurricane/Washington use the $25-beyond-15-miles wording
   already on those city pages). Same-day wording can mention faster
   St. George openings only on St. George pages.
4. "What we fix" cards and shop-notes blog links must match the
   service. Do not link a fridge page to a drywall post.
5. BreadcrumbList: Home → parent service page → this page.
6. Service JSON-LD: `areaServed` is this city (plus county if the copy
   actually covers it). Provider NAP stays ZIP 84790, no street.
7. **Do not invent reviews.** Reuse the four verified Google quotes
   already on the site. Visible "5.0 from 7 Google reviews" is the
   GBP-matched total. Do **not** add `aggregateRating` (city/service
   pages are forbidden from claiming a rating without the homepage
   wall). If you add it anyway, it must stay `ratingValue` 5.0 /
   `reviewCount` 7.
8. Link **out** to `/booking.html`, the parent service page, the parent
   city page, and one or two neighboring cities. Link **in** from the
   parent service page's `.areas-links` block and from the parent city
   page's matching service card.
9. Add the file to `sitemap.xml`.
10. Add the filename to the landing-page test lists (social proof, FAQ
    schema, sticky Call+Book, booking-path, privacy footer, analytics,
    promo banner, hamburger, blueprint background, nav dropdown) and
    extend `tests/seo/service-city-landing-page.test.js` — or copy that
    file's assertions onto the new path.
11. Reuse `styles.css` and the existing header/footer/sticky bar. Do
    not add a new design system.

## What not to do

- Do not generate all 5 services × 8 cities in one pass. One real page
  at a time, with copy you can stand behind.
- Do not put AggregateRating on these pages unless the visible review
  wall matches the homepage (it should not).
- Do not write review text attributed to a real person that they did
  not write.
- Do not promise guaranteed same-day service. The honest line is:
  same-day arrival when the schedule allows (call/text to check);
  same-visit repair when the part is on the truck or can be sourced
  that day.
