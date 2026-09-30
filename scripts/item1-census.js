#!/usr/bin/env node
// Item 1 reader/writer census (docs/ITEM-1-MIGRATION-PLAN.md, Phase 0b).
//
// Lists every localStorage read and write of the keys Item 1 migrates, with
// page, enclosing function and line. The Phase 4 device checklist and the
// Phase 5 cutover use this list: a call site missing from it is a page that
// keeps reading stale local data after cutover.
//
// Keys are often reached through a constant, so a plain grep misses them.
// This resolves three alias forms per file:
//   - data-layer.js's shared TH_KEYS.<name>
//   - a local constant:        const EXPENSE_STORAGE_KEY = 'th_expense_log'
//   - a local key-map object:  const STORAGE_KEYS = { contacts: 'th_tracker_contacts' }
// It also lists the shared helpers in data-layer.js / sync.js that touch a
// migrated key directly, and every page that calls one (indirect access).
//
// Usage: node scripts/item1-census.js            (markdown to stdout)
//        node scripts/item1-census.js --json     (machine-readable)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Migrated keys (plan Phase 0a, decisions 1/2/6 of 2026-09-30) and the
// tombstone key that protects each.
const MIGRATED = {
  th_tracker_jobs: 'jobs',
  th_job_tombstones: 'jobs',
  th_invoices: 'invoices',
  th_invoice_tombstones: 'invoices',
  th_quotes: 'quotes',
  th_quote_tombstones: 'quotes',
  th_contracts: 'contracts',
  th_contract_tombstones: 'contracts',
  th_expense_log: 'expenses',
  th_expense_tombstones: 'expenses',
  th_income_log: 'income',
  th_income_tombstones: 'income',
  th_tracker_contacts: 'contacts (-> clients)',
  th_contact_tombstones: 'contacts (-> clients)',
  th_clients: 'clients',
  th_client_tombstones: 'clients',
};

const SCAN_DIRS = ['tools', 'portal'];
const SCAN_ROOT_FILES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));

function listFiles() {
  const out = [];
  for (const d of SCAN_DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/\.(html|js)$/.test(f) && !/\.min\.js$/.test(f)) out.push(path.join(d, f));
    }
  }
  return out.concat(SCAN_ROOT_FILES);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Shared TH_KEYS map from data-layer.js.
function thKeysMap() {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'data-layer.js'), 'utf8');
  const m = src.match(/const TH_KEYS = \{([\s\S]*?)\};/);
  const map = {};
  if (m) for (const p of m[1].matchAll(/(\w+):\s*'([^']+)'/g)) map[p[1]] = p[2];
  return map;
}

// Per-file aliases: expression text -> key.
function aliasesFor(src, thKeys) {
  const aliases = {};
  for (const [prop, key] of Object.entries(thKeys)) {
    if (MIGRATED[key]) aliases[`TH_KEYS.${prop}`] = key;
  }
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*'(th_[a-z0-9_]+)'/g)) {
    if (MIGRATED[m[2]]) aliases[m[1]] = m[2];
  }
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*\{([^{}]*)\}/g)) {
    for (const p of m[2].matchAll(/(\w+):\s*'(th_[a-z0-9_]+)'/g)) {
      if (MIGRATED[p[2]]) aliases[`${m[1]}.${p[1]}`] = p[2];
    }
  }
  return aliases;
}

const FN_PATTERNS = [
  /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/,
  /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/, // method shorthand
];

function enclosingFunction(lines, idx) {
  for (let i = idx; i >= 0 && i > idx - 400; i--) {
    for (const re of FN_PATTERNS) {
      const m = lines[i].match(re);
      if (m && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1])) return m[1];
    }
  }
  return '(top level)';
}

// Nearest enclosing function declared at column 0 (a shared helper other
// files can call), ignoring inner arrow functions like `const match = ...`.
function topLevelFunction(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    const m = lines[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/) ||
      lines[i].match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/);
    if (m) return m[1];
  }
  return null;
}

// How a line uses the key.
function classify(line, exprRe) {
  const e = exprRe.source;
  if (new RegExp(`localStorage\\.setItem\\(\\s*${e}`).test(line) || new RegExp(`\\bthWrite\\(\\s*${e}`).test(line)) return 'write';
  if (new RegExp(`localStorage\\.removeItem\\(\\s*${e}`).test(line)) return 'remove';
  if (new RegExp(`localStorage\\.getItem\\(\\s*${e}`).test(line) || new RegExp(`\\bthRead\\(\\s*${e}`).test(line)) return 'read';
  return 'ref';
}

function scan() {
  const thKeys = thKeysMap();
  const rows = [];
  const files = listFiles();
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const lines = src.split('\n');
    const aliases = aliasesFor(src, thKeys);
    const exprs = [
      ...Object.keys(MIGRATED).map((k) => [new RegExp(`['"\`]${esc(k)}['"\`]`), k]),
      ...Object.entries(aliases).map(([a, k]) => [new RegExp(`\\b${esc(a)}\\b`), k]),
    ];
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      for (const [re, key] of exprs) {
        if (!re.test(line)) continue;
        // Skip the alias definition itself.
        if (/^\s*(?:const|let|var)\s+[A-Z][A-Z0-9_]*\s*=\s*'th_/.test(line) && classify(line, re) === 'ref') continue;
        rows.push({ file, line: i + 1, fn: enclosingFunction(lines, i), topFn: topLevelFunction(lines, i), key, entity: MIGRATED[key], kind: classify(line, re), text: line.trim().slice(0, 140) });
      }
    });
  }
  // De-duplicate (a line can match both the literal and an alias).
  const seen = new Set();
  return rows.filter((r) => { const k = `${r.file}:${r.line}:${r.key}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Shared helpers that touch a migrated key directly, and who calls them.
function helpers(rows) {
  const shared = ['tools/data-layer.js', 'tools/sync.js'];
  const fns = new Map();
  for (const r of rows) {
    if (!shared.includes(r.file) || !r.topFn || r.kind === 'ref') continue;
    const f = fns.get(r.topFn) || { file: r.file, keys: new Set(), kinds: new Set() };
    f.keys.add(r.key); f.kinds.add(r.kind); fns.set(r.topFn, f);
  }
  const files = listFiles();
  const sources = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')]));
  const callersOf = (name) => {
    const callers = [];
    for (const file of files) {
      const lines = sources[file];
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        if (new RegExp(`(?<![\\w.$])${esc(name)}\\s*\\(`).test(line) && !new RegExp(`function\\s+${esc(name)}\\b`).test(line)) {
          callers.push({ file, line: i + 1, fn: enclosingFunction(lines, i), topFn: topLevelFunction(lines, i) });
        }
      });
    }
    return callers;
  };
  // Follow calls through the shared files until no new helper turns up:
  // a shared function that calls a helper is itself a helper (indirect).
  const out = new Map();
  const queue = [...fns.keys()];
  while (queue.length) {
    const name = queue.shift();
    if (out.has(name)) continue;
    const info = fns.get(name);
    const callers = callersOf(name);
    out.set(name, { name, file: info.file, keys: [...info.keys], kinds: [...info.kinds], via: info.via || null, callers });
    for (const c of callers) {
      if (!shared.includes(c.file) || !c.topFn || c.topFn === name) continue;
      const existing = fns.get(c.topFn);
      if (existing) { info.keys.forEach((k) => existing.keys.add(k)); continue; }
      fns.set(c.topFn, { file: c.file, keys: new Set(info.keys), kinds: new Set(['indirect']), via: name });
      queue.push(c.topFn);
    }
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function markdown(rows, helperList) {
  const out = [];
  const byEntity = {};
  for (const r of rows) (byEntity[r.entity] = byEntity[r.entity] || []).push(r);
  out.push(`Generated by \`node scripts/item1-census.js\`. ${rows.length} direct call sites.`);
  out.push('');
  out.push('| Entity | Reads | Writes | Removes | Other references |');
  out.push('|---|---|---|---|---|');
  for (const [entity, list] of Object.entries(byEntity)) {
    const n = (k) => list.filter((r) => r.kind === k).length;
    out.push(`| ${entity} | ${n('read')} | ${n('write')} | ${n('remove')} | ${n('ref')} |`);
  }
  for (const [entity, list] of Object.entries(byEntity)) {
    out.push('', `#### ${entity}`, '', '| Page | Function | Line | Key | Access |', '|---|---|---|---|---|');
    for (const r of list.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      out.push(`| ${r.file} | \`${r.fn}\` | ${r.line} | \`${r.key}\` | ${r.kind} |`);
    }
  }
  out.push('', '#### Shared helpers (indirect access)', '',
    'Functions in `data-layer.js` / `sync.js` that read or write a migrated key directly. Every caller below reaches the key through them.', '',
    '| Helper | Defined in | Keys | Access | Callers |', '|---|---|---|---|---|');
  for (const h of helperList) {
    const callers = h.callers.length
      ? h.callers.map((c) => `${c.file}:${c.line} (\`${c.fn}\`)`).join('<br>')
      : '(none outside its own file)';
    out.push(`| \`${h.name}\` | ${h.file} | ${h.keys.map((k) => `\`${k}\``).join(', ')} | ${h.kinds.join(', ')}${h.via ? ` (via \`${h.via}\`)` : ''} | ${callers} |`);
  }
  return out.join('\n');
}

if (require.main === module) {
  const rows = scan();
  const helperList = helpers(rows);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ rows, helpers: helperList }, null, 2));
  else console.log(markdown(rows, helperList));
}

module.exports = { scan, helpers, MIGRATED };
