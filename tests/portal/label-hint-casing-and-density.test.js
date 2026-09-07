// Tests for four fixes found by rendering the real pages in a browser
// and reading computed styles, rather than by reading the CSS
// (2026-09-07):
//
//   1. Every explanatory hint nested inside a <label> -- across both the
//      portal and the tool suite -- rendered in letter-spaced ALL CAPS,
//      including sentences over 100 characters long.
//   2. The home stat cards were hardcoded plural, so a client with one
//      invoice was greeted with "1 INVOICES".
//   3. The "Need Something?" card offered three visually identical
//      actions and therefore had no default.
//   4. Collapsed Settings rows measured ~106px to show one line of text,
//      undercutting the very scroll reduction collapsing them was for.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = (...p) => path.join(__dirname, '..', '..', ...p);
const STYLES = fs.readFileSync(repo('styles.css'), 'utf8');
const POLISH = fs.readFileSync(repo('portal', 'portal-polish.css'), 'utf8');
const TOOLS_CSS = fs.readFileSync(repo('tools', 'styles-tools.css'), 'utf8');
const HOME = fs.readFileSync(repo('portal', 'home.html'), 'utf8');
const WORK_ORDERS = fs.readFileSync(repo('portal', 'work-orders.html'), 'utf8');

// ---- 1. the inherited all-caps ----

test('styles.css still carries the bare label rule these resets exist to answer', () => {
  // If this ever gets scoped properly, the resets below become dead
  // weight and this test is the thing that says so. text-transform and
  // letter-spacing are both inherited properties, which is the whole
  // mechanism: a <span> inside a <label> picks them up.
  // styles.css has more than one bare label{} rule; the one that matters
  // here is whichever sets casing.
  const casingRule = [...STYLES.matchAll(/(?:^|[},;\s])label\{[^}]*\}/g)]
    .map((m) => m[0])
    .find((r) => /text-transform/.test(r));
  assert.ok(casingRule, 'expected a bare label{} rule setting text-transform in styles.css');
  assert.match(casingRule, /text-transform:uppercase/);
  assert.match(casingRule, /letter-spacing:1px/);
});

test('portal hints nested in a label are reset to sentence case', () => {
  const rule = POLISH.match(/label \.wo-hint \{[^}]*\}/);
  assert.ok(rule, 'expected a label .wo-hint reset in portal-polish.css');
  assert.match(rule[0], /text-transform: none/);
  assert.match(rule[0], /letter-spacing: normal/);
});

test('tool-suite hints nested in a label are reset to sentence case', () => {
  const rule = TOOLS_CSS.match(/label \.tool-sub,\s*\n?label \.col-hint,\s*\n?\.label-hint\{[^}]*\}/);
  assert.ok(rule, 'expected the nested-hint reset in styles-tools.css');
  assert.match(rule[0], /text-transform:none/);
  assert.match(rule[0], /letter-spacing:normal/);
});

test('the labels themselves stay uppercase -- the fix is deliberately narrow', () => {
  // Uppercase field labels are a real, consistent choice across both
  // apps. Only the nested body copy reverts. A reset that matched bare
  // `label` would be the wrong fix.
  assert.ok(!/^label\s*\{[^}]*text-transform:\s*none/m.test(POLISH), 'portal-polish must not reset label casing wholesale');
  assert.ok(!/^label\{[^}]*text-transform:none/m.test(TOOLS_CSS), 'styles-tools must not reset label casing wholesale');
});

test('no long hint sentence nested in a label is left inheriting uppercase', () => {
  // The enumeration that found this originally, kept as a guard so a new
  // hint cannot quietly reintroduce the bug.
  //
  // The threshold is the point of the test, not an arbitrary number: the
  // bare label{} rule was written for short field labels, and two-word
  // chips like "Show closed (3)" on tools/clients.html genuinely read as
  // intentional small caps. What broke was body copy -- explanatory
  // sentences of 60 to 121 characters -- inheriting the same treatment.
  // So a nested span only has to carry a reset class once it is long
  // enough that all-caps costs legibility.
  const COVERED = new Set(['wo-hint', 'tool-sub', 'col-hint', 'label-hint']);
  const MAX_UNRESET = 25;
  const files = [
    ...fs.readdirSync(repo('portal')).filter((f) => f.endsWith('.html')).map((f) => repo('portal', f)),
    ...fs.readdirSync(repo('tools')).filter((f) => f.endsWith('.html')).map((f) => repo('tools', f)),
  ];
  const uncovered = [];
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    for (const label of html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) {
      for (const span of label[1].matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/g)) {
        const text = span[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (text.length <= MAX_UNRESET) continue;
        const cls = span[1].match(/class="([^"]*)"/);
        const names = cls ? cls[1].split(/\s+/) : [];
        if (!names.some((n) => COVERED.has(n))) {
          uncovered.push(`${path.basename(file)}: "${text.slice(0, 40)}..."`);
        }
      }
    }
  }
  assert.deepEqual(uncovered, [], `these label hints inherit uppercase with no reset: ${uncovered.join(', ')}`);
});

// ---- 2. the home stat cards ----

test('the home stat cards pluralize off their own count', () => {
  // "1 INVOICES" was on every single-invoice client's landing screen.
  // The attention banner directly above already handled this carefully,
  // which is what made the cards read as an oversight rather than a
  // style choice.
  assert.match(HOME, /c\.count === 1 \? c\.label : c\.labelPlural/);
  for (const [singular, plural] of [
    ['Invoice', 'Invoices'],
    ['Estimate', 'Estimates'],
    ['Completed Job', 'Completed Jobs'],
    ['Work Request', 'Work Requests'],
  ]) {
    assert.match(HOME, new RegExp(`label: '${singular}',\\s*\\n\\s*labelPlural: '${plural}',`));
  }
});

// ---- 3. a default action on the help card ----

test('"Request Work" is the primary action on the Need Something card', () => {
  assert.match(HOME, /<a href="\/portal\/work-orders\.html" class="primary">Request Work<\/a>/);
  assert.match(HOME, /<a href="tel:\+14354141667">Call/, 'Call stays secondary');
  assert.match(HOME, /<a href="sms:\+14354141667">Text Us<\/a>/, 'Text stays secondary');
});

test('the primary rule lives where it can actually win the cascade', () => {
  // body.portal-page .help-actions a in portal-polish.css sets
  // background-image at the same specificity and loads after home.html's
  // own <style>, so a page-local .help-actions a.primary ties and loses.
  // That is exactly what happened on the first attempt.
  assert.match(POLISH, /body\.portal-page \.help-actions a\.primary \{/);
  assert.ok(!/\.help-actions a\.primary/.test(HOME), 'the primary rule must not live in home.html, where it loses the tie');
});

// ---- 4. collapsed settings density ----

test('collapsed settings rows drop their now-redundant vertical padding', () => {
  // .set-card-header already guarantees a 52px tap target, so the card's
  // own 18px padding buys nothing while collapsed.
  assert.match(POLISH, /\.set-card-header \{ min-height: 52px; \}/);
  const rule = POLISH.match(/\.set-card\.is-collapsed \{[^}]*\}/);
  assert.ok(rule, 'expected a collapsed-state density rule');
  assert.match(rule[0], /padding-top: 6px/);
  assert.match(rule[0], /padding-bottom: 6px/);
});

test('the expanded settings card is untouched', () => {
  // Only the collapsed state is tightened; opening a section must still
  // give its content the original 18px of breathing room.
  const rule = POLISH.match(/\.set-card\.is-collapsed \{[^}]*\}/)[0];
  assert.ok(!/padding-left|padding-right/.test(rule), 'horizontal padding must not change');
  assert.ok(!/\.set-card \{[^}]*padding-top/.test(POLISH), 'the base .set-card padding must not be overridden');
});

// ---- 5. the schedule toggle groups with the question it belongs to ----

test('the schedule toggle sits closer to the urgency question than to the section below', () => {
  assert.match(WORK_ORDERS, /<div class="wo-field wo-field-schedule">/);
  const rule = WORK_ORDERS.match(/\.wo-field\.wo-field-schedule \{[^}]*\}/);
  assert.ok(rule, 'expected the .wo-field-schedule rule');
  const below = Number(rule[0].match(/margin-bottom: (\d+)px/)[1]);
  const above = Number(WORK_ORDERS.match(/\.schedule-toggle \{[^}]*margin-top: (\d+)px/)[1]);
  assert.ok(below > above, `expected more room below (${below}px) than above (${above}px)`);
});
