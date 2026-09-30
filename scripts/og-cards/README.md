# Share cards

The 1200x630 images link previews show (iMessage, Facebook, Slack, Google
Business posts). One per page, in `images/og/<slug>.jpg`, each page's
`og:image` / `twitter:image` pointing at its own. Claude Design's Package
D14 (2026-09-29), recoloured orange-only at the owner's word: no blue.

- `cards.json`: one entry per page (page, slug, eyebrow, title, and
  optionally `badge: standard | request` for towns and `art` for a
  drawing from `art/`).
- `template.html`: the card. Dark always; Anton title (in capitals, as on
  the site) sized to fit, Oswald eyebrow, the orange logo, name and phone.
- `../build-og-cards.js`: renders every card with Playwright and fails if
  a title can't fit or runs into the safe area. Usage is at its top.

Adding a page: add its entry to `cards.json`, run the build, set the
page's `og:image` to the new file. `tests/design/package-d-public-site.test.js`
fails until the page and its card agree.

No star rating on the cards: the rating is edited live in Site Content,
and a number baked into an image would go stale.

## Fonts

`fonts/anton.woff2` and `fonts/oswald.woff2` are the Latin subsets Google
Fonts serves, kept here so a build doesn't depend on the network. Both are
under the SIL Open Font License 1.1; the licence texts sit beside them
(`fonts/OFL-Anton.txt`, `fonts/OFL-Oswald.txt`). The drawing in
`art/drain.svg` is from Claude Design's symptom illustrations.
