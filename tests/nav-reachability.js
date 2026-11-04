// Where a Workspace page can be reached from (2026-11-04). Since the nav
// became the nine (handoff §2), "still in the nav" is no longer the rule a
// page that left it must pass; "still reachable" is: the nav, Search
// (Cmd-K), Settings, or -- for the two add-ons -- their one way in: My
// Day's Plan today's route, and the invoice/quote line items' Look Up in Wiki. Add-on pages (Route Planner, Appliance Wiki) are reachable only
// while their add-on is on (tests/workspace/addons.test.js).
const fs = require('fs');
const path = require('path');

const TOOLS = path.join(__dirname, '..', 'tools');
const read = (f) => fs.readFileSync(path.join(TOOLS, f), 'utf8');

function whereReachable(href) {
  const nav = read('tools-nav-pwa.js');
  const sidebar = nav.slice(nav.indexOf('var SIDEBAR_DESTS = ['), nav.indexOf('];', nav.indexOf('var SIDEBAR_DESTS = [')));
  const palette = read('tools-command-palette.js');
  const actions = palette.slice(palette.indexOf('var ACTIONS = ['), palette.indexOf('];', palette.indexOf('var ACTIONS = [')));
  const settings = read('settings.html');
  const workspace = read('workspace.html');
  const places = [];
  const bare = href.split('#')[0];
  if (sidebar.includes("'" + href + "'")) places.push('nav');
  if (actions.includes("href: '" + href) || actions.includes("href: '" + bare + "'") || actions.includes("href: '" + bare + '#')) places.push('search');
  if (settings.includes('href="' + href + '"')) places.push('settings');
  if (workspace.includes('<a href="' + bare + '#today" class="dash-route-btn" id="dashRouteBtn" hidden>')) places.push('my-day');
  const invoices = read('invoice-generator.html');
  if (bare === '/tools/parts-reference.html' && invoices.includes("const url = '/tools/parts-reference.html' +") && /data-addon-wiki hidden onclick="openWikiLookup\('jobDescription'\)"/.test(invoices)) places.push('invoice line items');
  return places;
}

module.exports = { whereReachable };
