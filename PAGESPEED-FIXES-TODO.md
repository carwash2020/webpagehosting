# PageSpeed/Lighthouse fixes for triplehenterprisesllc.biz

Repo: `carwash2020/webpagehosting` (static site, GitHub Pages with custom
domain via `CNAME`, no `_headers`/`netlify.toml` support). Site
convention: shared files (`styles.css`, `triage.js`, `business-hours.js`,
`site-motion.js`, `analytics-events.js`) are in `GLOBAL_SHARED_FILES` in
`scripts/check-consistency.js` -- any edit to one requires running
`node scripts/check-consistency.js --fix-versions` afterward to bump
`?v=` hashes site-wide, then `node scripts/check-consistency.js` to
verify. Also run `npm run check-undefined-vars`,
`npm run check-visual-snapshot`, `python3 scripts/check-links.py`, and
`npm test` (already configured serial via `--test-concurrency=1`)
before committing -- all must pass clean.

A Lighthouse/PageSpeed report on the homepage (`index.html`) flagged 5
issues. Fix in this order:

## 1. Google Fonts CSS is render-blocking (~780ms)

In `index.html` (and likely every public page -- check all of them),
there's:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400..700&family=Newsreader:ital,opsz,wght@0,6..72,300..600&family=Oswald:wght@200..700&display=swap" rel="stylesheet">
```
Change the fonts `<link>` to the preload+swap pattern:
```html
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=...&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=...&display=swap" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=...&display=swap"></noscript>
```
Do this on every public page that loads fonts this way. Leave
`styles.css` itself as a normal blocking stylesheet (don't apply this
trick there -- real risk of FOUC on a live business site).

## 2. Image delivery (~74 KiB)

- `images/hero-bg-canyon.webp` (1600x1066, used as a CSS
  `background-image` in `.hero` in `styles.css`, sits behind a heavy
  dark gradient overlay) -- re-encode at a lower WebP quality (try
  ~65-70; visually check against the gradient since fine detail is
  already hidden). Update the `?v=` cache-bust hash in `styles.css`
  after.
- `images/logo-signature.webp` (550x506 actual, but used at 438x403
  for the "badge" instance -- check `<img class="logo-img" ...
  alt="Triple H Enterprises badge">` in `index.html`, used in 3 places
  at different sizes) -- resize the source file down closer to its
  largest actual display size, or add a second smaller variant for the
  badge use specifically if the other 2 usages need the larger size.

## 3. Supabase preconnect (free, zero-risk)

Add next to the existing font preconnects in `index.html`'s `<head>`
(and other pages that fetch from Supabase for site content):
```html
<link rel="preconnect" href="https://csvfqdjuobylgafgolho.supabase.co">
```

## 4. Layout shift from web fonts (CLS 0.189)

The 4 fonts (Anton, Archivo, Newsreader, Oswald) reflow the hero on
swap-in. Add `@font-face` overrides in `styles.css` with
`size-adjust`/`ascent-override`/`descent-override`/`line-gap-override`
for a fallback (e.g. `Arial`) tuned to each webfont's metrics, so the
fallback-to-webfont swap doesn't shift layout. Use a metrics tool (e.g.
https://www.industrialempathy.com/perfect-ish-font-fallback/ or
Capsize) to generate the actual descriptor values per font rather than
guessing -- this is the fiddly part, don't skip the metric generation
step.

## 5. Cache lifetimes (391 KiB) -- NOT a code fix, flag to the user

GitHub Pages serves everything with a fixed ~10-minute `Cache-Control`
and this repo has no way to override it (no `_headers` support). The
only real fix is moving the domain to Cloudflare-proxied DNS and
adding a Cache Rule for `?v=`-tagged URLs (`max-age=31536000,
immutable`). That's a DNS/dashboard change outside the repo -- don't
attempt it in code, just tell the user this requires their action
outside the codebase.

---

After making changes 1-4: run the full validation suite listed above,
visually check the hero and logo images for quality regressions, then
commit on the designated feature branch and push (do not open a PR
unless asked).
