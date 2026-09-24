// Every public page of the site (root, services, locations, blog), as
// repo-relative paths, for the site-content tests that check a hook is
// never missed on any of them. The Google Search Console verification
// files are not pages.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function publicHtmlFiles() {
  const out = [];
  for (const dir of ['', 'services', 'locations', 'blog']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (f.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(f)) out.push(path.posix.join(dir, f));
    }
  }
  return out;
}

module.exports = { publicHtmlFiles };
