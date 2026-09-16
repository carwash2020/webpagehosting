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

<!-- Add new entries above this line -->
