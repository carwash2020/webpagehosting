// Where a Workspace page can be reached from (2026-11-04). Since the nav
// became the nine (handoff §2), "still in the nav" is no longer the rule a
// page that left it must pass; "still reachable" is: the nav, Search
// (Cmd-K), or Settings. Add-on pages (Route Planner, Appliance Wiki) are
// reachable only while their add-on is on -- see their own tests.
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
  const places = [];
  const bare = href.split('#')[0];
  if (sidebar.includes("'" + href + "'")) places.push('nav');
  if (actions.includes("href: '" + href) || actions.includes("href: '" + bare + "'") || actions.includes("href: '" + bare + '#')) places.push('search');
  if (settings.includes('href="' + href + '"')) places.push('settings');
  return places;
}

module.exports = { whereReachable };
