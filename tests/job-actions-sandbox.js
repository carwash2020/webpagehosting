// What a vm sandbox needs to run Job Tracker / Job Detail functions that ask
// thJobActions() (data-layer.js, 2026-11-03: actions match the job's state).
// thJobActions is the real one; thJobMoneyStage is a stand-in that is exact
// for fixtures with no invoices or payments, where the stage follows the
// job's status alone (see thJobMoneyStage in data-layer.js).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DL = fs.readFileSync(path.join(__dirname, '..', 'tools', 'data-layer.js'), 'utf8');
function extract(name) {
  const start = DL.indexOf('function ' + name + '(');
  let i = DL.indexOf('{', start), depth = 0;
  for (; i < DL.length; i++) {
    if (DL[i] === '{') depth++;
    else if (DL[i] === '}') { depth--; if (depth === 0) return DL.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const box = {};
vm.createContext(box);
vm.runInContext(extract('thJobActions') + ';this.thJobActions = thJobActions;', box);

function jobActionsSandbox() {
  return {
    thJobActions: box.thJobActions,
    thJobMoneyStage: (job) => ({ stage: job.status === 'done' ? (job.noInvoice ? 'no-charge' : 'to-invoice') : job.status === 'in-progress' ? 'working' : 'booked', invoices: [], payments: [] }),
    thRead: (key, fallback) => fallback,
    TH_KEYS: { invoices: 'th_invoices', income: 'th_income_log', jobs: 'th_tracker_jobs' },
  };
}
module.exports = { jobActionsSandbox };
