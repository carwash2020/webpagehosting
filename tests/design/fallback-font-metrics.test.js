// Fallback-font metrics (2026-09-23). The 2026-09-10 fallbacks matched
// cap-height, which scaled Arial UP for Anton (120%) and Oswald (113%) --
// both condensed faces, far narrower than Arial -- so a Windows/macOS first
// visit wrapped the homepage H1 onto 4 lines before snapping to 2 (desktop
// CLS 0.22-0.29). They also named only local('Arial'), which matches nothing
// on Linux, ChromeOS or Android. These tests lock in the lessons, not the
// exact tuned numbers: condensed faces shrink, every face names local fonts
// that really resolve, overrides stay consistent with size-adjust, and the
// stacks try both fallbacks before the generic family.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Comments stripped: styles.css explains these rules in prose that quotes
// the exact tokens (local('Roboto'), 64ch) the tests forbid in real CSS.
const CSS = fs.readFileSync(path.join(__dirname, '..', '..', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const FAMILIES = ['Anton', 'Oswald', 'Newsreader', 'Archivo'];
// hhea ascent/descent over unitsPerEm, read from each webfont with fontTools.
const METRICS = { Anton: [1.1763, 0.3291], Oswald: [1.1930, 0.2890], Newsreader: [0.7350, 0.2650], Archivo: [0.8780, 0.2100] };

function face(name) {
  const m = CSS.match(new RegExp(`@font-face \\{\\s*font-family: '${name}';([^}]*)\\}`));
  assert.ok(m, `missing @font-face for '${name}'`);
  const body = m[1];
  const pct = (prop) => { const v = body.match(new RegExp(`${prop}: ([0-9.]+)%;`)); assert.ok(v, `${name} has no ${prop}`); return parseFloat(v[1]) / 100; };
  return { src: body.match(/src: ([^;]+);/)[1], size: pct('size-adjust'), ascent: pct('ascent-override'), descent: pct('descent-override'), gap: pct('line-gap-override') };
}

test('every family has an Arial-metric fallback and a Roboto fallback', () => {
  for (const fam of FAMILIES) {
    const a = face(`${fam} Fallback`);
    for (const local of ["local('Arial')", "local('ArialMT')", "local('Liberation Sans')", "local('Arimo')"]) {
      assert.ok(a.src.includes(local), `${fam} Fallback should try ${local}`);
    }
    const r = face(`${fam} Fallback Roboto`);
    assert.ok(r.src.includes("local('Roboto Regular')") && r.src.includes("local('Roboto-Regular')"), `${fam} Fallback Roboto should name Roboto by full and PostScript name`);
  }
});

test("no fallback relies on local('Roboto'), which matches nothing (local() needs a full or PostScript name)", () => {
  assert.doesNotMatch(CSS, /local\('Roboto'\)/);
});

test('the condensed faces (Anton, Oswald) are scaled DOWN, never up', () => {
  for (const fam of ['Anton', 'Oswald']) {
    for (const suffix of ['', ' Roboto']) {
      const f = face(`${fam} Fallback${suffix}`);
      assert.ok(f.size < 0.9, `${fam} Fallback${suffix} size-adjust is ${(f.size * 100).toFixed(2)}% -- a condensed face needs the fallback narrower than the system font, not wider`);
    }
  }
});

test('ascent/descent overrides land on the webfont\'s real metrics once scaled by size-adjust', () => {
  for (const fam of FAMILIES) {
    for (const suffix of ['', ' Roboto']) {
      const f = face(`${fam} Fallback${suffix}`);
      const [asc, desc] = METRICS[fam];
      assert.ok(Math.abs(f.ascent * f.size - asc) < 0.002, `${fam} Fallback${suffix}: ascent-override x size-adjust = ${(f.ascent * f.size).toFixed(4)}, want ${asc}`);
      assert.ok(Math.abs(f.descent * f.size - desc) < 0.002, `${fam} Fallback${suffix}: descent-override x size-adjust = ${(f.descent * f.size).toFixed(4)}, want ${desc}`);
      assert.equal(f.gap, 0);
    }
  }
});

test('arrows, which Oswald lacks entirely, keep a cap-height-matched face declared after the width-matched one', () => {
  // The fallback draws these glyphs even after Oswald loads, so their size
  // can't cause CLS -- it only decides how "->" looks next to Oswald text.
  for (const name of ['Oswald Fallback', 'Oswald Fallback Roboto']) {
    const faces = [...CSS.matchAll(new RegExp(`@font-face \\{\\s*font-family: '${name}';([^}]*)\\}`, 'g'))].map((m) => m[1]);
    assert.equal(faces.length, 2, `${name}: expected a main face and an arrows face`);
    assert.doesNotMatch(faces[0], /unicode-range/, `${name}: the first (main) face must cover everything`);
    assert.match(faces[1], /unicode-range: U\+2190-21FF;/, `${name}: the arrows face must come second so it wins inside its range`);
    const size = parseFloat(faces[1].match(/size-adjust: ([0-9.]+)%/)[1]) / 100;
    const asc = parseFloat(faces[1].match(/ascent-override: ([0-9.]+)%/)[1]) / 100;
    assert.ok(size > 1.1, `${name} arrows should be cap-height-matched (~113%), got ${size}`);
    assert.ok(Math.abs(asc * size - METRICS.Oswald[0]) < 0.002, `${name} arrows keep Oswald's line box`);
  }
});

test('each type token tries the webfont, then both fallbacks, then the generic stack', () => {
  const tokens = { display: 'Anton', body: 'Newsreader', ui: 'Oswald', app: 'Archivo' };
  for (const [token, fam] of Object.entries(tokens)) {
    const m = CSS.match(new RegExp(`--font-${token}:([^;]+);`));
    assert.ok(m, `--font-${token} missing`);
    assert.ok(m[1].trim().startsWith(`'${fam}', '${fam} Fallback', '${fam} Fallback Roboto',`), `--font-${token} is ${m[1].trim()}`);
  }
});

test('the city/service hero lede is capped in px, not ch (ch follows the fallback font\'s "0" until the webfont loads)', () => {
  const m = CSS.match(/\.hero-lede\{([^}]*)\}/);
  assert.ok(m);
  assert.match(m[1], /max-width:640px;/);
  assert.doesNotMatch(m[1], /max-width:[0-9.]+ch/);
});
