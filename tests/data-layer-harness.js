// Installs the real tools/data-layer.js into a jsdom window (2026-11-03).
//
// jsdom page harnesses load one page's HTML and never fetch its
// <script src> files, so anything the page now reads from data-layer.js --
// the thInvoices/thQuotes/... seams that replaced each page's own
// load/save pairs (Item 1 Phase 2, handoff 2026-11-03 §2) -- has to be put
// in the window by hand. Call it from beforeParse so it is in place before
// the page's own scripts run, exactly like the deferred script would be by
// the time anything calls it; stubs a test assigns afterwards still win.
//
// data-layer.js declares its seams with top-level const, which an eval'd
// script keeps in its own scope, so they are copied onto the window.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'tools', 'data-layer.js'), 'utf8');
const EXPORTED = ['TH_KEYS', 'thJobs', 'thInvoices', 'thQuotes', 'thIncome', 'thExpenses', 'thContracts', 'thContacts', 'thNotes', 'thMakeCollection'];

function installDataLayer(w) {
  w.eval(SRC + '\n;Object.assign(window, { ' + EXPORTED.join(', ') + ' });');
}

module.exports = { installDataLayer };
