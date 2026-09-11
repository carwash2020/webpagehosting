// eslint.config.js
//
// Narrow, bug-catching-only lint pass (2026-09-11) -- deliberately NOT a
// full lint setup, matching this project's own established philosophy of
// small, auditable, purpose-built tooling with no external opinion
// imposed (see check-undefined-vars.js, check-consistency.js,
// check-links.py, and their own comments on exactly this point).
//
// Real correctness rules only -- an assignment where a comparison was
// probably meant, unreachable code, a switch case falling through,
// comparing a value to itself, a regex that can never match, and
// similar things that are always bugs, never a style preference.
// Deliberately excludes:
//
// - no-undef / no-unused-vars: check-undefined-vars.js already covers
//   this far more accurately. It knows exactly which <script src> files
//   share a given page's global scope (built per-page from the real
//   HTML), so it can tell a genuinely undefined reference apart from a
//   completely legitimate cross-file global. A project-wide lint pass
//   run one file at a time has no way to know that, and would flood
//   with false "not defined"/"unused" positives for every shared global
//   this site's own script-splitting convention depends on.
// - Every style rule (formatting, naming, preferred syntax). Not what
//   this pass is for, and exactly the kind of external opinion this
//   project's tooling has always deliberately avoided imposing.
//
// Only lints real, standalone .js files -- not the inline <script>
// blocks embedded in .html pages, which is a different problem
// check-undefined-vars.js already solves with real page-by-page scope
// awareness.

module.exports = [
  {
    ignores: [
      'node_modules/**',
      // Vendored third-party code (Kazuhiko Arase's MIT-licensed QR
      // code generator) -- not ours to "fix" findings in, and any
      // report on it would be noise we can't responsibly act on.
      'tools/qrcode-lib.js',
    ],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
    },
    // Several test files carry an eslint-disable comment for a rule
    // (no-eval, no-new-func) that a real, stricter project config
    // would enable but this narrow correctness-only pass deliberately
    // doesn't -- reportUnusedDisableDirectives defaults on in flat
    // config (it did not in ESLint 8) and would otherwise flag those
    // as "unused" from this pass's own limited rule set, even though
    // they guard against a real, different lint context.
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      // Likely typos / logic errors
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-compare-neg-zero': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-unsafe-finally': 'error',

      // Dead / unreachable code
      'no-unreachable': 'error',
      'no-unreachable-loop': 'error',
      'no-fallthrough': 'error',
      'no-empty-character-class': 'error',
      'no-empty-pattern': 'error',

      // Things that can never work as written
      'no-const-assign': 'error',
      'no-class-assign': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-obj-calls': 'error',
      'no-setter-return': 'error',
      'no-this-before-super': 'error',
      'constructor-super': 'error',
      'for-direction': 'error',

      // Malformed regex / string literals
      'no-invalid-regexp': 'error',
      'no-control-regex': 'error',
      'no-misleading-character-class': 'error',
      'no-irregular-whitespace': 'error',
      'no-loss-of-precision': 'error',
      'no-sparse-arrays': 'error',

      // Leftover debugging code / obviously-wrong async usage
      'no-debugger': 'error',
      'no-async-promise-executor': 'error',
      'no-inner-declarations': 'error',
    },
  },
];
