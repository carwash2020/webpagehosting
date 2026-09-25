// The service-area diagram places each city by its angle from St. George,
// clockwise from north. From 2026-09-11 Leeds sat south-east (150 degrees)
// and La Verkin north-west (300), against their own "north"/"east"
// notes, because they were dropped into the two gaps left free. Since
// 2026-09-25 they sit on their real bearings as far as the drawing allows.
// Real bearings from St. George, town centre to town centre: Leeds ~52,
// Washington City ~63, La Verkin ~61-68, Hurricane ~72.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const HUB = { x: 380, y: 210 };

const PAGES = ['index.html',
  ...fs.readdirSync(repo('locations')).filter((f) => f.endsWith('.html')).map((f) => `locations/${f}`),
  ...fs.readdirSync(repo('services')).filter((f) => f.endsWith('.html')).map((f) => `services/${f}`)]
  .map((page) => ({ page, html: fs.readFileSync(repo(page), 'utf8') }))
  .filter(({ html }) => html.includes('class="radius-figure'));

function bearings(html) {
  const start = html.indexOf('class="radius-figure');
  const svg = html.slice(start, html.indexOf('</svg>', start));
  const out = {};
  for (const [, city, body] of svg.matchAll(/<g data-city="([a-z-]+)"[^>]*>([\s\S]*?)<\/g>/g)) {
    const m = body.match(/<circle [^>]*cx="([\d.]+)" cy="([\d.]+)"/);
    const x = Number(m[1]) - HUB.x, y = Number(m[2]) - HUB.y;
    out[city] = { deg: (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360, r: Math.hypot(x, y) };
  }
  return out;
}

for (const { page, html } of PAGES) {
  test(`${page}: Leeds and La Verkin are drawn in their real direction from St. George`, () => {
    const b = bearings(html);
    assert.ok(Math.abs(b.leeds.deg - 52) <= 8, `Leeds drawn at ${b.leeds.deg.toFixed(0)} degrees; it's ~52 (north-east)`);
    assert.ok(Math.abs(b['washington-city'].deg - 63) <= 8, `Washington City drawn at ${b['washington-city'].deg.toFixed(0)}; it's ~63`);
    // La Verkin can't share Washington City's line, so it only has to be
    // east-north-east: north of Hurricane, and farther out than it.
    assert.ok(b['la-verkin'].deg > b.leeds.deg && b['la-verkin'].deg < b.hurricane.deg,
      `La Verkin drawn at ${b['la-verkin'].deg.toFixed(0)}; it belongs between Leeds and Hurricane`);
    assert.ok(b['la-verkin'].deg >= 45 && b['la-verkin'].deg <= 90, 'La Verkin is east-north-east of St. George');
    assert.ok(b['la-verkin'].r > b.hurricane.r, 'La Verkin is farther from St. George than Hurricane');
    assert.ok(b['washington-city'].r < b.leeds.r && b['washington-city'].r < b['la-verkin'].r, 'Washington City is the closest of the three');
  });
}
