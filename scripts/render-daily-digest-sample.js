// Renders the daily digest email from SAMPLE data (no network, no real
// clients) to docs/daily-digest/sample-email.html. Used for the committed
// screenshot. Run: node scripts/render-daily-digest-sample.js
const fs = require('fs');
const path = require('path');
const { loadDigest, sampleState } = require('../tests/edge-functions/daily-digest-harness');

(async () => {
  const state = sampleState();
  const { call } = loadDigest(state);
  const { body } = await call({ dry_run: true });
  const out = path.join(__dirname, '..', 'docs', 'daily-digest', 'sample-email.html');
  fs.writeFileSync(out, body.html);
  console.log('wrote', out, 'subject:', body.subject);
})();
