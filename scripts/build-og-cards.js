#!/usr/bin/env node
// Builds the share cards (Open Graph images): one 1200x630 JPEG per entry
// in scripts/og-cards/cards.json, written to images/og/<slug>.jpg. Claude
// Design's Package D14 (2026-09-29).
//
// images/og-image.jpg, the one image every page used to share, is rewritten
// as a copy of the homepage card.
//
// Not part of `npm test` and not run on deploy -- the site stays a plain
// static folder and the JPEGs are committed. Rerun this after changing a
// card, the template, a font or the logo, then commit images/og/.
// tests/design/package-d-public-site.test.js checks that every page's
// og:image points at its own card and that the file exists.
//
// Needs Playwright with a Chromium it can launch. It is deliberately not a
// devDependency (it would add a browser download to every `npm ci`):
//   npx -y playwright@1 install chromium   # once, if you have no Chromium
//   NODE_PATH=$(npm root -g) node scripts/build-og-cards.js
// CHROMIUM_PATH=/path/to/chrome points it at a browser you already have.
//
// Usage: node scripts/build-og-cards.js [slug ...]   (no slugs = all cards)

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const CARD_DIR = path.join(__dirname, 'og-cards');
const OUT_DIR = path.join(REPO_ROOT, 'images', 'og');
// Centre 1080x566 safe area (square-ish crops keep this part).
const SAFE = { left: 60, right: 1140, top: 32, bottom: 598 };

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('build-og-cards: Playwright is not installed. See the note at the top of scripts/build-og-cards.js.');
  process.exit(1);
}

async function main() {
  const { cards } = JSON.parse(fs.readFileSync(path.join(CARD_DIR, 'cards.json'), 'utf8'));
  const only = process.argv.slice(2);
  const todo = only.length ? cards.filter((c) => only.includes(c.slug)) : cards;
  if (only.length && todo.length !== only.length) {
    const known = new Set(cards.map((c) => c.slug));
    console.error('build-og-cards: no card named ' + only.filter((s) => !known.has(s)).join(', '));
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(CARD_DIR, 'template.html'));
  await page.waitForFunction(() => document.querySelector('.brand img').complete);

  const problems = [];
  for (const card of todo) {
    const art = card.art ? fs.readFileSync(path.join(CARD_DIR, 'art', card.art), 'utf8') : '';
    const m = await page.evaluate(([c, a]) => window.renderCard(c, a), [card, art]);
    if (!m.fontsLoaded) problems.push(card.slug + ': Anton/Oswald did not load');
    if (!m.fits) problems.push(card.slug + ': title does not fit even at the smallest size');
    if (m.eyebrowRight > SAFE.right) problems.push(card.slug + ': eyebrow runs past the safe area');
    if ((m.badgeBottom || m.titleBottom) > 484 - 20) problems.push(card.slug + ': title/badge crowd the brand block');
    await page.screenshot({ path: path.join(OUT_DIR, card.slug + '.jpg'), type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: 1200, height: 630 } });
    console.log(card.slug.padEnd(40) + ' title ' + m.size + 'px');
  }
  await browser.close();
  // The old single share image's URL stays live for anything that cached
  // it (no page links it any more); it carries the homepage card, so the
  // retired blue-logo artwork is gone from there too.
  if (todo.some((c) => c.slug === 'home')) {
    fs.copyFileSync(path.join(OUT_DIR, 'home.jpg'), path.join(REPO_ROOT, 'images', 'og-image.jpg'));
  }
  if (problems.length) {
    console.error('\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('\n' + todo.length + ' card(s) written to images/og/');
}

main().catch((err) => { console.error(err); process.exit(1); });
