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

<!-- Add new entries above this line -->
