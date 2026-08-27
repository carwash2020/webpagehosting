// tools-dialogs.js -- one of 4 files split out of the former
// tools-common.js (2026-08-20, structural item #42). See tools-effects.js
// for the full explanation of why and how this split was done safely.
//
// This file: the custom confirm/alert dialog system (with real Tab-key
// focus-trapping), money/escapeHtml/debouncedCall formatting utilities,
// the toast container setup, and the shared long-press gesture utility.

// ---------------------------------------------------------------------------
// Haptic feedback (expanded 2026-08-26, requested directly as part of a
// broader "make it feel like an app" pass). Previously only fired on
// long-press (see the gesture utility further down). Deliberately kept
// to meaningful moments -- a real confirmation, a real error, a real
// preference change -- not wired to every button tap generally, which
// on a real device feels like noise rather than polish; that's not how
// native apps use haptics either. no-ops silently everywhere unsupported
// (notably iOS Safari, which has never implemented the Vibration API at
// all -- there's no feature-detection workaround for that, only Apple
// shipping it).
function haptic(type) {
  if (!navigator.vibrate) return;
  switch (type) {
    case 'light': navigator.vibrate(12); break;
    case 'success': navigator.vibrate([10, 40, 10]); break;
    case 'warning': navigator.vibrate([15, 50, 15]); break;
    case 'error': navigator.vibrate([20, 60, 20, 60, 20]); break;
    default: navigator.vibrate(12);
  }
}

// ---------------------------------------------------------------------------
// Custom confirm/alert dialogs -- replace native browser confirm()/alert()
// with something styled to match the app instead of the browser's plain
// system dialog look. Both return a Promise, so call sites use `await`.
//
//   await showAlert('Something happened.');
//   const yes = await showConfirm('Delete this?', { danger: true });
//
// The overlay/panel are created once, lazily, and reused for every call.
// ---------------------------------------------------------------------------

function ensureDialogModalExists() {
  if (document.getElementById('customDialogOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'customDialogOverlay';
  overlay.className = 'help-modal-overlay';
  overlay.innerHTML =
    '<div class="help-modal">' +
      '<p class="dialog-message" id="customDialogMessage"></p>' +
      '<textarea id="customDialogTextarea" class="dialog-textarea" style="display:none;" rows="3"></textarea>' +
      '<div class="dialog-buttons" id="customDialogButtons"></div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    // Clicking the dark backdrop (not the panel itself) cancels, same as
    // clicking outside the help modal already does elsewhere in the app.
    if (e.target === overlay) {
      const cancelBtn = document.getElementById('customDialogCancelAction');
      if (cancelBtn) cancelBtn.click();
    }
  });

  // Item #30 (2026-08-19): real Tab-key focus-trapping. Previously
  // absent entirely -- a keyboard user could Tab past the last button
  // in an open confirm/alert dialog and land on content behind it,
  // which is supposed to be blocked while the dialog is open. Wired
  // once here (the overlay element itself is created once and reused
  // for every showConfirm/showAlert call), but queries the CURRENT
  // buttons live at keydown time, since those are rebuilt fresh on
  // every call.
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(overlay.querySelectorAll('button, a, input, select, textarea'))
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });
}

// Remembers whatever had focus right before a dialog opened, so it can
// be restored once the dialog closes -- the other half of the standard
// modal accessibility pattern (trap focus while open, return it after).
let _dialogPreviousFocus = null;
function _restoreFocusAfterDialog() {
  if (_dialogPreviousFocus && document.body.contains(_dialogPreviousFocus)) _dialogPreviousFocus.focus();
  _dialogPreviousFocus = null;
}

// Shared money formatter -- previously defined identically (or nearly
// so) 4 separate times across workspace.html, job-tracker.html,
// invoice-generator.html, and route-planner.html. One copy now.
// Item #54 (2026-08-19): wires a clear (x) button onto the shared
// icon-search input pattern. Call once per input, right after its own
// markup exists. Clicking clears the field and re-renders immediately
// (not through the debounce used for typing, since a deliberate clear
// click should feel instant, not delayed).
function wireSearchClear(inputId, renderFn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const wrap = input.closest('.icon-search');
  if (!wrap) return;
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'icon-search-clear';
  clearBtn.setAttribute('aria-label', 'Clear search');
  clearBtn.textContent = '\u00d7';
  wrap.appendChild(clearBtn);

  function sync() { wrap.classList.toggle('has-text', input.value.length > 0); }
  input.addEventListener('input', sync);
  clearBtn.addEventListener('click', () => {
    input.value = '';
    sync();
    input.focus();
    renderFn();
  });
  sync();
}

function money(v) { return '$' + (v || 0).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,'); }

// Shared HTML-escaping helper -- previously defined 9 separate times
// across the tool suite. 8 copies used a DOM-based trick (assign to
// textContent, read back innerHTML); review-request.html used a
// different regex-based version that explicitly returned '' for
// null/undefined. That distinction mattered: it's called there as
// escapeHtml(entry.phone) with no `|| ''` fallback, and an older saved
// entry with no phone on file would otherwise render the literal string
// "undefined" on screen (since assigning undefined to textContent
// coerces to that word). This keeps the explicit guard, but still uses
// the DOM-based approach -- the majority pattern -- for real strings.
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Fixes a real, confirmed vulnerability (found via CodeQL's "Incomplete
// string escaping or encoding" alerts, 2026-08-26): escapeHtml() above
// is only ever safe for text-node content -- it escapes &, <, > (what
// the browser's own innerHTML serializer escapes for text), but NOT
// quotes, since quotes aren't special in that context. Every flagged
// call site instead embeds a value inside a single-quoted JS string
// literal that's itself inside a double-quoted onclick="..." HTML
// attribute -- a different context entirely, needing two escape layers
// applied in the exact order the browser actually undoes them: the
// browser's HTML parser decodes entities FIRST (to get the raw JS
// source text), THEN the JS engine parses that text as code -- so
// building the string requires the reverse order: JS-string-escape
// first, HTML-attribute-escape on top of that result.
//
// Verified via a real jsdom simulation against 9 adversarial inputs
// (lone single/double quotes, both together, backslashes, ampersands,
// angle brackets, a raw newline, and a realistic combined case --
// `24" TV mount with 'brackets'`) before this was ever used in a
// production file: each one round-trips to the exact original string
// when the handler actually fires, not just "looks escaped."
function escapeForInlineHandler(str) {
  if (str === null || str === undefined) return '';
  const jsEscaped = String(str)
    .replace(/\\/g, '\\\\')   // backslash first -- otherwise the escapes added below would themselves get double-escaped
    .replace(/'/g, "\\'")     // the JS string literal's own delimiter, used throughout this suite's inline handlers
    .replace(/\n/g, '\\n')    // a raw newline would break a single-line JS string literal outright
    .replace(/\r/g, '\\r');
  return jsEscaped
    .replace(/&/g, '&amp;')   // must come before the next line, or a real "&quot;" in the data would get double-escaped
    .replace(/"/g, '&quot;'); // the outer onclick="..." attribute's own delimiter
}

// Item #5 (2026-08-18): shared debounce utility for the 9 live-search
// inputs across the tool suite, all of which previously re-ran a full
// list render on every single keystroke with no debounce at all -- fine
// for a short list, real jank risk as data grows. Keyed by name (not a
// plain debounce(fn) HOF) specifically so it can be called directly from
// an inline oninput="..." attribute without each page needing to
// declare and manage its own wrapper variable.
const _debounceTimers = {};
function debouncedCall(key, fn, delay) {
  clearTimeout(_debounceTimers[key]);
  _debounceTimers[key] = setTimeout(fn, delay || 200);
}

function showAlert(message) {
  return new Promise((resolve) => {
    ensureDialogModalExists();
    _dialogPreviousFocus = document.activeElement;
    const overlay = document.getElementById('customDialogOverlay');
    document.getElementById('customDialogMessage').textContent = message;
    const buttons = document.getElementById('customDialogButtons');
    buttons.innerHTML = '';

    const okBtn = document.createElement('button');
    okBtn.className = 'dialog-btn dialog-btn-primary';
    okBtn.id = 'customDialogCancelAction'; // Escape/backdrop-click resolves the same as OK for a plain alert
    okBtn.textContent = 'OK';
    okBtn.onclick = () => { overlay.classList.remove('is-open'); _restoreFocusAfterDialog(); resolve(true); };
    buttons.appendChild(okBtn);

    overlay.classList.add('is-open');
    okBtn.focus();
  });
}

function showConfirm(message, options) {
  options = options || {};
  return new Promise((resolve) => {
    ensureDialogModalExists();
    _dialogPreviousFocus = document.activeElement;
    const overlay = document.getElementById('customDialogOverlay');
    document.getElementById('customDialogMessage').textContent = message;
    const buttons = document.getElementById('customDialogButtons');
    buttons.innerHTML = '';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dialog-btn dialog-btn-cancel';
    cancelBtn.id = 'customDialogCancelAction'; // Escape/backdrop-click cancels, same as native confirm()
    cancelBtn.textContent = options.cancelText || 'Cancel';
    cancelBtn.onclick = () => { overlay.classList.remove('is-open'); _restoreFocusAfterDialog(); resolve(false); };

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'dialog-btn ' + (options.danger ? 'dialog-btn-danger' : 'dialog-btn-primary');
    confirmBtn.textContent = options.confirmText || 'OK';
    confirmBtn.onclick = () => { haptic(options.danger ? 'warning' : 'success'); overlay.classList.remove('is-open'); _restoreFocusAfterDialog(); resolve(true); };

    buttons.appendChild(cancelBtn);
    buttons.appendChild(confirmBtn);
    overlay.classList.add('is-open');
    // Focuses Cancel, not Confirm -- the safe default, so accidentally
    // hitting Enter/Space without reading carefully never triggers the
    // action being confirmed, destructive or not.
    cancelBtn.focus();
  });
}

// "Flag this page" (2026-08-21), requested directly: a quick way to
// flag something to come back to later, for a moment when there isn't
// time to write a full message -- just the current page, an optional
// short note, and a timestamp, logged to a queue reviewed later in Dev
// Tools. Resolves with the entered note (a string, possibly empty) or
// null if cancelled -- distinct from an empty string, so the caller
// can tell "flagged with no note" apart from "cancelled, don't log
// anything at all."
function showFlagDialog(pageLabel) {
  return new Promise((resolve) => {
    ensureDialogModalExists();
    _dialogPreviousFocus = document.activeElement;
    const overlay = document.getElementById('customDialogOverlay');
    document.getElementById('customDialogMessage').textContent = 'Flag ' + pageLabel + ' for later? Add a quick note if you want (optional).';
    const textarea = document.getElementById('customDialogTextarea');
    textarea.value = '';
    textarea.style.display = 'block';
    textarea.placeholder = 'What\'s off? (optional)';
    const buttons = document.getElementById('customDialogButtons');
    buttons.innerHTML = '';

    const close = () => { textarea.style.display = 'none'; overlay.classList.remove('is-open'); _restoreFocusAfterDialog(); };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dialog-btn dialog-btn-cancel';
    cancelBtn.id = 'customDialogCancelAction';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => { close(); resolve(null); };

    const flagBtn = document.createElement('button');
    flagBtn.className = 'dialog-btn dialog-btn-primary';
    flagBtn.textContent = 'Flag it';
    flagBtn.onclick = () => { const note = textarea.value.trim(); close(); resolve(note); };

    buttons.appendChild(cancelBtn);
    buttons.appendChild(flagBtn);
    overlay.classList.add('is-open');
    textarea.focus();
  });
}


// ---------------------------------------------------------------------------
// Toast -- a brief, non-blocking confirmation for routine successes (job
// saved, invoice logged, contact deleted). Deliberately separate from
// showAlert()/showConfirm() above: those are for things that need an
// acknowledgment or a decision, this is for "that worked, keep going."
// Auto-dismisses; also dismissable early with a tap. Stacks if more than
// one fires in quick succession rather than replacing/losing the first.
//
//   showToast('Job added.');
//   showToast('Could not reach the server.', { type: 'error' });
// ---------------------------------------------------------------------------

function ensureToastContainerExists() {
  if (document.getElementById('thToastContainer')) return document.getElementById('thToastContainer');
  const container = document.createElement('div');
  container.id = 'thToastContainer';
  container.className = 'th-toast-container';
  container.setAttribute('aria-live', 'polite');
  container.setAttribute('role', 'status');
  document.body.appendChild(container);
  return container;
}

// ---------------------------------------------------------------------------
// LONG-PRESS via event delegation -- added 2026-08-17 (item #9). Chosen
// over a swipe-action system: a hold-timer has no distance/velocity math
// to get wrong and can never be misread as a scroll gesture the way a
// horizontal swipe can, since it's cancelled the moment the pointer
// moves more than a few pixels. Uses pointer events (not touch-specific)
// so it works identically with touch and mouse, no separate desktop
// fallback needed.
//
// Delegated on a container rather than attached per-item, so a list that
// re-renders on every data change (job cards, etc.) never risks
// re-attaching duplicate listeners -- this is wired once per container,
// ever.
function attachLongPress(containerEl, itemSelector, onLongPress) {
  const HOLD_MS = 500;
  const MOVE_CANCEL_PX = 10;
  let timer = null;
  let startX = 0, startY = 0, activeEl = null;

  function cancel() {
    clearTimeout(timer);
    timer = null;
    if (activeEl) activeEl.classList.remove('is-long-pressing');
    activeEl = null;
  }

  containerEl.addEventListener('pointerdown', (e) => {
    const item = e.target.closest(itemSelector);
    if (!item || !containerEl.contains(item)) return;
    // A long-press on an interactive control inside the card (a button,
    // select, or link) should never hijack that control's own normal
    // tap behavior.
    if (e.target.closest('button, a, select, input, textarea')) return;

    activeEl = item;
    startX = e.clientX;
    startY = e.clientY;
    timer = setTimeout(() => {
      if (!activeEl) return;
      activeEl.classList.remove('is-long-pressing');
      haptic('light'); // no-ops silently where unsupported (notably iOS Safari)
      const el = activeEl;
      activeEl = null;
      onLongPress(el);
    }, HOLD_MS);
    item.classList.add('is-long-pressing');
  }, { passive: true });

  containerEl.addEventListener('pointermove', (e) => {
    if (!activeEl) return;
    if (Math.abs(e.clientX - startX) > MOVE_CANCEL_PX || Math.abs(e.clientY - startY) > MOVE_CANCEL_PX) cancel();
  }, { passive: true });

  containerEl.addEventListener('pointerup', cancel, { passive: true });
  containerEl.addEventListener('pointercancel', cancel, { passive: true });
  containerEl.addEventListener('scroll', cancel, { passive: true });
}

// Small bottom-sheet action menu, triggered by attachLongPress above.
// actions: [{ label, onClick, isDanger }]
function showQuickActionSheet(title, actions) {
  const overlay = document.createElement('div');
  overlay.className = 'quick-actions-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'quick-actions-sheet';
  sheet.innerHTML =
    '<div class="quick-actions-title">' + title + '</div>' +
    actions.map((a, i) =>
      '<button class="quick-actions-btn' + (a.isDanger ? ' is-danger' : '') + '" data-action-index="' + i + '">' + a.label + '</button>'
    ).join('') +
    '<button class="quick-actions-btn quick-actions-cancel">Cancel</button>';

  function close() {
    overlay.classList.remove('is-shown');
    setTimeout(() => overlay.remove(), 200);
  }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  sheet.querySelector('.quick-actions-cancel').addEventListener('click', close);
  actions.forEach((a, i) => {
    sheet.querySelector('[data-action-index="' + i + '"]').addEventListener('click', () => {
      close();
      a.onClick();
    });
  });

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-shown'));
}

