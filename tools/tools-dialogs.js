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
  // Chrome refuses vibrate() until the person has tapped the page, and logs
  // a console error each time ("Blocked call to navigator.vibrate..."). A
  // form sheet opened from a link (job-tracker.html#add-job from the + Job
  // button, a client's New job, the command palette) buzzes as the sheet
  // opens, before any tap, so it hit that on every open; it couldn't buzz
  // there anyway, so skip it. Browsers without userActivation carry on as
  // before.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
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
      '<div class="dialog-fields" id="customDialogFields" style="display:none;"></div>' +
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

// Shared "today, in the business's own timezone" date string. Several
// tool pages independently defaulted a date field with
// `new Date().toISOString().slice(0, 10)` -- toISOString() is always
// UTC, and the business (America/Denver) is 6-7 hours behind it, so any
// time after ~5-6pm local, that call has already rolled to tomorrow's
// date. Found as a real bug (an evening invoice/expense/job silently
// dated a day ahead, and Route Planner's "pull today's jobs" matching
// zero jobs) across invoice-generator.html, job-tracker.html, and
// route-planner.html. business-hours.js already solves this exact
// problem for the public booking flow (todayDateStrInBusinessTz()), but
// isn't loaded on these internal tool pages -- this is the same Intl-
// based approach, in the one script every tool page already shares.
function dateStrBusinessTz(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  return map.year + '-' + map.month + '-' + map.day;
}
function todayDateStrBusinessTz() {
  return dateStrBusinessTz(new Date());
}

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

// Exhaustive escapeHtml() audit (closing a real gap flagged after the
// CodeQL fix pass below and runway-dashboard.html's own equivalent fix
// were both confirmed to be targeted at flagged call sites only, never
// an exhaustive sweep): escapeHtml() above is only safe for HTML
// *text-node* content -- it escapes &, <, > (what the browser's own
// innerHTML serializer escapes when building text-node content via
// textContent), but never touches a double-quote, since quotes aren't
// special there. Two real, previously-unaudited call sites were found
// interpolating an escapeHtml()'d value directly into a double-quoted
// HTML attribute (site-content.html's FAQ question `value="..."`,
// workspace.html's vendor/client `title="..."` and a photo `alt="..."`)
// -- an un-escaped `"` in ordinary business data (a job note mentioning
// a `24" TV`, a client name, a photo caption) lets the string break out
// of the attribute and inject new attributes/markup, exactly the same
// bug shape runway-dashboard.html already fixed once for itself.
// Verified via the same real jsdom round-trip against 9 adversarial
// inputs (lone single/double quotes, both together, backslashes,
// ampersands, angle brackets, a raw newline, and a realistic combined
// case) already proven for escapeForInlineHandler below and
// runway-dashboard.html's own escapeAttr(), byte-for-byte the same
// implementation as that file's -- moved here instead of duplicated
// again, since every page with this bug shape already loads this file.
function escapeAttr(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

// Generic styled multi-field prompt dialog (2026-09-19), replacing the
// remaining native prompt() call sites across the tools suite (recurring
// job templates in job-tracker.html, a custom price-reference label in
// finance.html, license entries in workspace.html) -- those were the
// last spots still popping the browser's own unstyled dialog in an
// otherwise consistently dark-themed PWA. Also fixes a real bug in the
// recurring-template flow specifically: it used to be 3 stacked
// prompt() calls, and `prompt(...) || ''` can't tell a genuine Cancel
// (prompt() returns null) apart from OK on a deliberately empty field
// (prompt() returns ''), so cancelling the 2nd of 3 prompts silently
// continued with a blank value instead of aborting the whole thing.
// Resolves with an object keyed by each field's id, or null if the
// dialog was cancelled (Cancel button, backdrop click, or Escape) --
// same null-vs-object distinction showFlagDialog() already makes, and
// unambiguous here since every field only ever resolves once, together.
function showPromptForm(message, fields, options) {
  options = options || {};
  return new Promise((resolve) => {
    ensureDialogModalExists();
    _dialogPreviousFocus = document.activeElement;
    const overlay = document.getElementById('customDialogOverlay');
    document.getElementById('customDialogMessage').textContent = message;
    const fieldsContainer = document.getElementById('customDialogFields');
    fieldsContainer.innerHTML = fields.map(function (f, i) {
      return '<label class="dialog-field-label" for="customDialogField' + i + '">' + escapeHtml(f.label) + '</label>' +
        '<input type="' + (f.type || 'text') + '" class="dialog-field-input" id="customDialogField' + i +
        '" placeholder="' + escapeAttr(f.placeholder || '') + '" value="' + escapeAttr(f.defaultValue || '') + '">';
    }).join('') + '<p class="dialog-field-error" id="customDialogFieldsError" style="display:none;"></p>';
    fieldsContainer.style.display = 'block';
    const buttons = document.getElementById('customDialogButtons');
    buttons.innerHTML = '';

    const close = () => {
      fieldsContainer.style.display = 'none';
      fieldsContainer.innerHTML = '';
      overlay.classList.remove('is-open');
      _restoreFocusAfterDialog();
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dialog-btn dialog-btn-cancel';
    cancelBtn.id = 'customDialogCancelAction';
    cancelBtn.textContent = options.cancelText || 'Cancel';
    cancelBtn.onclick = () => { close(); resolve(null); };

    const submitBtn = document.createElement('button');
    submitBtn.className = 'dialog-btn dialog-btn-primary';
    submitBtn.textContent = options.confirmText || 'Save';
    function submit() {
      const values = {};
      fields.forEach(function (f, i) {
        values[f.id] = document.getElementById('customDialogField' + i).value.trim();
      });
      const error = options.validate ? options.validate(values) : null;
      const errorEl = document.getElementById('customDialogFieldsError');
      if (error) {
        errorEl.textContent = error;
        errorEl.style.display = 'block';
        return;
      }
      close();
      resolve(values);
    }
    submitBtn.onclick = submit;

    buttons.appendChild(cancelBtn);
    buttons.appendChild(submitBtn);
    overlay.classList.add('is-open');
    const inputs = fieldsContainer.querySelectorAll('input');
    inputs.forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    });
    if (inputs[0]) inputs[0].focus();
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
    // tap behavior -- except a row that opts in with
    // data-long-press-target (2026-09-22): list rows whose whole body is
    // one link or button (the Clients directory's .th-row-link, the
    // invoice list's), where a tap opens the record and a hold is the
    // quick-action sheet, like a phone's contacts app. For those, the
    // click that follows a fired hold is swallowed so letting go doesn't
    // also navigate.
    const control = e.target.closest('button, a, select, input, textarea');
    if (control && !control.hasAttribute('data-long-press-target')) return;

    activeEl = item;
    startX = e.clientX;
    startY = e.clientY;
    timer = setTimeout(() => {
      if (!activeEl) return;
      activeEl.classList.remove('is-long-pressing');
      haptic('light'); // no-ops silently where unsupported (notably iOS Safari)
      const el = activeEl;
      activeEl = null;
      if (control) swallowNextClick(containerEl);
      onLongPress(el);
    }, HOLD_MS);
    item.classList.add('is-long-pressing');
  }, { passive: true });

  // The browser's own long-press menu (Android's link menu) would open on
  // top of the quick-action sheet on an opted-in link.
  containerEl.addEventListener('contextmenu', (e) => {
    if (e.target.closest && e.target.closest('[data-long-press-target]')) e.preventDefault();
  });

  containerEl.addEventListener('pointermove', (e) => {
    if (!activeEl) return;
    if (Math.abs(e.clientX - startX) > MOVE_CANCEL_PX || Math.abs(e.clientY - startY) > MOVE_CANCEL_PX) cancel();
  }, { passive: true });

  containerEl.addEventListener('pointerup', cancel, { passive: true });
  containerEl.addEventListener('pointercancel', cancel, { passive: true });
  containerEl.addEventListener('scroll', cancel, { passive: true });
}

function swallowNextClick(el) {
  const stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  el.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 800);
}

// Small bottom-sheet action menu, triggered by attachLongPress above.
// actions: [{ label, onClick, isDanger }]
// options.cancelLabel (2026-09-23): when closing the sheet means something
// ("Not done yet" after stopping a job's clock), say so instead of Cancel.
//
// v2 (2026-09-28, Workspace app redesign v2 §7 "Row action menu"): the same
// sheet is now also the row action menu, so every existing caller gets the
// v2 look for free (a bottom sheet on a phone, a 440px side panel on a
// computer -- styles-tools.css "V2.4"). Everything it did before is
// unchanged: same classes, same title-as-HTML contract, same button text,
// same order. Additions, all optional and backward compatible:
//   action.icon     sprite name (#icon-<name>) drawn before the label
//   action.kind     'edit' | 'extra' | 'duplicate' | 'delete' | 'open' -- a
//                   data-kind hook for styling; openRowMenu() below also
//                   sorts by it and picks a default icon
//   options.subtitle plain text under the title (escaped here)
//   options.opener  element focus returns to on close (default: whatever
//                   had focus when the sheet opened)
// It also gained what a dialog needs: Esc closes it, focus moves into it
// and is held there (Tab trap), focus goes back on close, and on touch a
// downward swipe dismisses it (attachSwipeToDismiss, when loaded).
function showQuickActionSheet(title, actions, options) {
  options = options || {};
  const cancelLabel = options.cancelLabel || 'Cancel';
  const returnFocus = options.opener || document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'quick-actions-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'quick-actions-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  const iconHtml = (name) => name ? '<svg class="th-icon" aria-hidden="true"><use href="#icon-' + name + '" xlink:href="#icon-' + name + '"></use></svg>' : '';
  sheet.innerHTML =
    '<div class="quick-actions-handle" aria-hidden="true"></div>' +
    '<div class="quick-actions-title">' + title + '</div>' +
    (options.subtitle ? '<div class="quick-actions-sub">' + escapeHtml(options.subtitle) + '</div>' : '') +
    actions.map((a, i) =>
      '<button class="quick-actions-btn' + (a.isDanger ? ' is-danger' : '') + (a.icon ? ' has-icon' : '') + '" data-action-index="' + i + '"' +
        (a.kind ? ' data-kind="' + escapeAttr(a.kind) + '"' : '') + (a.disabled ? ' disabled' : '') + '>' + iconHtml(a.icon) + a.label + '</button>'
    ).join('') +
    '<button class="quick-actions-btn quick-actions-cancel">' + cancelLabel + '</button>';
  const titleEl = sheet.querySelector('.quick-actions-title');
  if (titleEl && titleEl.textContent) sheet.setAttribute('aria-label', titleEl.textContent);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.classList.remove('is-shown');
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('th-actionsheet-open');
    setTimeout(() => overlay.remove(), 220);
    if (returnFocus && typeof returnFocus.focus === 'function' && document.body.contains(returnFocus)) {
      try { returnFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }
  function onKey(e) {
    if (!overlay.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const focusable = Array.from(sheet.querySelectorAll('button:not([disabled])'));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
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
  document.body.classList.add('th-actionsheet-open');
  document.addEventListener('keydown', onKey, true);
  if (typeof attachSwipeToDismiss === 'function') attachSwipeToDismiss(sheet, close);
  requestAnimationFrame(() => overlay.classList.add('is-shown'));
  const firstBtn = sheet.querySelector('.quick-actions-btn:not([disabled])');
  if (firstBtn) setTimeout(() => { try { firstBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 30);
}

// ---------------------------------------------------------------------------
// ROW ACTION MENU (v2, 2026-09-28) -- the shared "⋯" on every editable row.
//
// Workspace app redesign v2 §7: every editable row gets a 38px ⋯ button that
// opens an action sheet (bottom sheet on a phone, 440px right side panel on
// a computer) listing Edit, the row's extra action (Resend, Convert to
// invoice, Download PDF, Attach receipt, Approve...), Duplicate where the
// page already has one, and a red Delete, with Cancel at the bottom.
// Long-press on the row opens the same sheet. It only ever calls the
// page's EXISTING handlers -- nothing new is written to data, and a
// Delete keeps whatever confirm dialog / undo toast that handler already
// shows. Built on showQuickActionSheet() above, so tests and pages that
// stub or call that keep working.
//
// CALLING CONVENTION (for every page -- Money, Runway, Clients, Reviews...)
//
// 1) Lowest level: open the sheet yourself.
//      openRowMenu('INV-1042 · Joe Patel', [
//        { kind: 'edit',      label: 'Edit',              onClick: () => editInvoice(id) },
//        { kind: 'extra',     label: 'Resend',            onClick: () => resendInvoice(id), icon: 'mail' },
//        { kind: 'duplicate', label: 'Duplicate',         onClick: () => duplicateInvoice(id) },
//        { kind: 'delete',    label: 'Delete',            onClick: () => deleteInvoiceLogEntry(id) },
//      ], { subtitle: '$385 · overdue 15 days', opener: buttonEl });
//    - title is PLAIN TEXT (escaped here), unlike showQuickActionSheet's.
//    - actions are sorted edit -> extra/open/other -> duplicate -> delete
//      (stable within a kind); delete is always red. Leave out any kind the
//      page has no handler for -- never invent one.
//    - icon defaults by kind (edit: 'edit', duplicate: 'copy', delete:
//      'trash', open: 'external'); pass icon: 'name' for any sprite icon.
//
// 2) The ⋯ button markup, for rows you render yourself:
//      rowMenuButtonHtml('INV-1042')  ->
//      <button type="button" class="th-row-menu-btn" aria-label="More actions for INV-1042"
//              aria-haspopup="dialog"><svg class="th-icon">…#icon-more…</svg></button>
//    38px round, text-dim, orange on focus; styles-tools.css "V2.4".
//
// 3) Wire a whole list once (delegated; survives innerHTML re-renders):
//      attachRowMenu(listEl, '.inv-item', {
//        getMenu: (row) => ({ title: row.dataset.title, subtitle: '…', actions: [...] }),
//        decorate: true,           // append a ⋯ to every row that lacks one (default true)
//        buttonHost: '.inv-right', // where inside the row the ⋯ goes (default: the row)
//        longPress: true,          // hold the row -> same sheet (default true; pass false
//                                  // where the list already calls attachLongPress itself)
//      });
//    getMenu may return null to skip a row. Without getMenu, the menu is
//    built from the row's own controls (4), titled from the row's
//    data-row-title attribute (or its first .th-row-title / heading text).
//    To point at controls a render function already emits WITHOUT touching
//    its markup, pass selector specs; each render is re-marked at runtime:
//      attachRowMenu(listEl, '.lead-card', { buttonHost: '.dash-list-item-right',
//        actions: [{ kind: 'delete', selector: '.small-btn.danger', label: 'Delete lead' }] });
//
// 4) Zero-JS-change rows: mark the row's EXISTING buttons/links with
//    data-row-action="edit|extra|duplicate|delete|open" (and optionally
//    data-row-action-label="Delete lead"). rowMenuActionsFromButtons(row)
//    turns them into menu actions whose onClick is that element's own
//    .click() -- the exact existing handler, confirm dialog included. On a
//    row that has a ⋯ (class th-has-row-menu), CSS tucks those marked
//    controls away so the row shows only its primary action and the ⋯;
//    they stay in the DOM, reachable through the sheet.
// ---------------------------------------------------------------------------
const TH_ROW_MENU_ORDER = { edit: 0, open: 1, extra: 1, other: 1, duplicate: 2, delete: 3 };
const TH_ROW_MENU_ICON = { edit: 'edit', duplicate: 'copy', delete: 'trash', open: 'external' };

function openRowMenu(title, actions, options) {
  options = options || {};
  const list = (actions || []).filter(Boolean).map((a, i) => ({ a, i }))
    .sort((x, y) => ((TH_ROW_MENU_ORDER[x.a.kind || 'other'] ?? 1) - (TH_ROW_MENU_ORDER[y.a.kind || 'other'] ?? 1)) || (x.i - y.i))
    .map(({ a }) => ({
      label: escapeHtml(a.label),
      onClick: a.onClick,
      kind: a.kind || 'other',
      icon: a.icon || TH_ROW_MENU_ICON[a.kind] || '',
      isDanger: a.kind === 'delete' || !!a.isDanger,
      disabled: !!a.disabled,
    }));
  if (!list.length) return;
  showQuickActionSheet(escapeHtml(title || 'Actions'), list, {
    subtitle: options.subtitle || '',
    opener: options.opener,
    cancelLabel: options.cancelLabel,
  });
}

function rowMenuButtonHtml(label) {
  return '<button type="button" class="th-row-menu-btn" aria-label="' + escapeAttr('More actions' + (label ? ' for ' + label : '')) + '" aria-haspopup="dialog">' +
    '<svg class="th-icon" aria-hidden="true"><use href="#icon-more" xlink:href="#icon-more"></use></svg></button>';
}

function rowMenuActionsFromButtons(rowEl) {
  if (!rowEl) return [];
  return Array.from(rowEl.querySelectorAll('[data-row-action]'))
    .filter(el => !el.disabled && el.closest('.th-row-menu-btn') === null)
    .map(el => ({
      kind: el.getAttribute('data-row-action') || 'other',
      label: (el.getAttribute('data-row-action-label') || el.textContent || '').trim() || 'Action',
      icon: el.getAttribute('data-row-action-icon') || '',
      onClick: () => el.click(),
    }));
}

function rowMenuTitle(rowEl) {
  if (!rowEl) return '';
  const own = rowEl.getAttribute('data-row-title');
  if (own) return own;
  const t = rowEl.querySelector('[data-row-title], .th-row-title, .dash-list-item-title, .lead-card-name, h4, h3');
  return t ? (t.getAttribute('data-row-title') || t.textContent || '').trim() : '';
}

function attachRowMenu(containerEl, rowSelector, options) {
  if (!containerEl || containerEl._thRowMenu) return;
  options = options || {};
  containerEl._thRowMenu = true;
  const mark = (row) => {
    (options.actions || []).forEach(spec => {
      if (!spec || !spec.selector) return;
      row.querySelectorAll(spec.selector).forEach(el => {
        if (el.hasAttribute('data-row-action') || el.closest('.th-row-menu-btn')) return;
        el.setAttribute('data-row-action', spec.kind || 'other');
        if (spec.label) el.setAttribute('data-row-action-label', spec.label);
        if (spec.icon) el.setAttribute('data-row-action-icon', spec.icon);
      });
    });
  };
  const menuFor = (row) => {
    if (typeof options.getMenu === 'function') return options.getMenu(row);
    mark(row);
    const actions = rowMenuActionsFromButtons(row);
    return actions.length ? { title: rowMenuTitle(row), actions } : null;
  };
  const open = (row, opener) => {
    const m = menuFor(row);
    if (!m || !m.actions || !m.actions.length) return;
    openRowMenu(m.title, m.actions, { subtitle: m.subtitle, opener: opener || row.querySelector('.th-row-menu-btn') });
  };
  containerEl.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('.th-row-menu-btn');
    if (!btn || !containerEl.contains(btn)) return;
    const row = btn.closest(rowSelector);
    if (!row || !containerEl.contains(row)) return;
    e.preventDefault();
    e.stopPropagation();
    open(row, btn);
  });
  if (options.longPress !== false && typeof attachLongPress === 'function') {
    attachLongPress(containerEl, rowSelector, (row) => open(row));
  }
  if (options.decorate === false) return;
  const decorate = () => {
    containerEl.querySelectorAll(rowSelector).forEach(row => {
      mark(row);
      if (row.querySelector('.th-row-menu-btn')) { row.classList.add('th-has-row-menu'); return; }
      const m = menuFor(row);
      if (!m || !m.actions || !m.actions.length) return;
      const host = (options.buttonHost && row.querySelector(options.buttonHost)) || row;
      host.insertAdjacentHTML('beforeend', rowMenuButtonHtml(m.title));
      row.classList.add('th-has-row-menu');
    });
  };
  decorate();
  if (typeof MutationObserver !== 'undefined') {
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      (window.queueMicrotask || setTimeout)(() => { queued = false; decorate(); });
    }).observe(containerEl, { childList: true, subtree: true });
  }
}


// ---------------------------------------------------------------------------
// RINGS, DONUTS AND GAUGES (v2, 2026-09-28) -- one SVG helper for every
// "iOS Health" ring in the Workspace (Today's three rings, the job clock,
// Insights' job-status donut, and Money/Runway's safe-to-spend ring and
// runway gauge). Lives here, not in tools-effects.js, because
// runway-dashboard.html loads this file but not that one.
//
// Drawn with stroke-dasharray on an SVG circle, coloured by CSS tokens
// (styles-tools.css "V2.3": .th-ring--<tone>), so light mode and dark mode
// both come for free. On first paint the fill grows from 0 (<=600ms), but
// only under prefers-reduced-motion: no-preference; a re-render of the same
// ring (same `key`) never replays it.
//
//   thRingSvg({
//     value: 0.42,            // fraction filled, clamped to 0..1 (required)
//     size: 86,               // px, outer box (default 86)
//     stroke: 9,              // px, ring thickness (default 9)
//     tone: 'orange',         // orange | green | blue | red | purple | idle (default orange)
//     sweep: 1,               // fraction of the circle used; <1 draws a gauge with the
//                             // gap at the bottom (e.g. 0.75) (default 1)
//     center: '<b>3/5</b>',   // HTML placed in the middle (caller escapes it)
//     label: '3 of 5 jobs done', // aria-label; the ring is role="img" when given
//     key: 'today-jobs',      // animate this ring only the first time it paints
//     className: 'my-extra'   // extra class on the wrapper
//   }) -> '<div class="th-ring th-ring--orange" style="--th-ring-size:86px">…</div>'
//
//   thDonutSvg([{ value: 8, tone: 'blue', label: 'Not started' }, …],
//              { size: 132, stroke: 16, center: '<b>32</b><span>jobs</span>', label, key, gap: 2 })
//     -> the same wrapper with one arc per segment (a 2px gap between arcs);
//        an all-zero list draws just the track.
//
//   thAnimateRings(rootEl)      -- call after inserting ring markup into the DOM
//                                 (grows each not-yet-seen fill from 0).
//   thSetRingValue(ringEl, v)   -- move an existing ring to a new fraction with
//                                 no replay (e.g. a ticking clock).
// ---------------------------------------------------------------------------
var _thRingsSeen = {};
function _thRingGeom(size, stroke, sweep) {
  var r = (size - stroke) / 2;
  var c = 2 * Math.PI * r;
  var rot = sweep >= 1 ? -90 : 90 + (360 * (1 - sweep)) / 2;
  return { r: r, c: c, rot: rot, cx: size / 2 };
}
function thRingSvg(opts) {
  opts = opts || {};
  var size = Number(opts.size) || 86;
  var stroke = Number(opts.stroke) || 9;
  var sweep = Math.max(0.05, Math.min(1, Number(opts.sweep) || 1));
  var v = Math.max(0, Math.min(1, Number(opts.value) || 0));
  var g = _thRingGeom(size, stroke, sweep);
  var arc = g.c * sweep;
  var fill = arc * v;
  var tone = /^(orange|green|blue|red|purple|idle)$/.test(opts.tone || '') ? opts.tone : 'orange';
  var aria = opts.label ? ' role="img" aria-label="' + escapeAttr(opts.label) + '"' : ' aria-hidden="true"';
  var key = opts.key ? ' data-ring-key="' + escapeAttr(opts.key) + '"' : '';
  return '<div class="th-ring th-ring--' + tone + (sweep < 1 ? ' is-gauge' : '') + (opts.className ? ' ' + escapeAttr(opts.className) : '') + '"' +
      ' style="--th-ring-size:' + size + 'px"' + aria + key + '>' +
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="transform:rotate(' + g.rot + 'deg)" focusable="false" aria-hidden="true">' +
      '<circle class="th-ring-track" cx="' + g.cx + '" cy="' + g.cx + '" r="' + g.r.toFixed(2) + '" fill="none" stroke-width="' + stroke + '"' +
        (sweep < 1 ? ' stroke-dasharray="' + arc.toFixed(2) + ' ' + g.c.toFixed(2) + '" stroke-linecap="round"' : '') + '></circle>' +
      '<circle class="th-ring-fill" cx="' + g.cx + '" cy="' + g.cx + '" r="' + g.r.toFixed(2) + '" fill="none" stroke-width="' + stroke + '" stroke-linecap="round"' +
        ' stroke-dasharray="' + fill.toFixed(2) + ' ' + g.c.toFixed(2) + '" data-ring-c="' + g.c.toFixed(2) + '" data-ring-arc="' + arc.toFixed(2) + '"' +
        (v === 0 ? ' style="opacity:0"' : '') + '></circle>' +
    '</svg>' +
    (opts.center ? '<div class="th-ring-center">' + opts.center + '</div>' : '') +
  '</div>';
}
function thDonutSvg(segments, opts) {
  opts = opts || {};
  var size = Number(opts.size) || 132;
  var stroke = Number(opts.stroke) || 16;
  var gap = opts.gap === undefined ? 2 : Number(opts.gap) || 0;
  var g = _thRingGeom(size, stroke, 1);
  var total = (segments || []).reduce(function (s, x) { return s + Math.max(0, Number(x.value) || 0); }, 0);
  var acc = 0;
  var arcs = total > 0 ? segments.map(function (s) {
    var val = Math.max(0, Number(s.value) || 0);
    var len = g.c * val / total;
    var tone = /^(orange|green|blue|red|purple|idle)$/.test(s.tone || '') ? s.tone : 'orange';
    var out = val > 0
      ? '<circle class="th-ring-fill th-ring-seg th-ring-seg--' + tone + '" cx="' + g.cx + '" cy="' + g.cx + '" r="' + g.r.toFixed(2) + '" fill="none" stroke-width="' + stroke + '"' +
        ' stroke-dasharray="' + Math.max(0, len - (segments.length > 1 ? gap : 0)).toFixed(2) + ' ' + g.c.toFixed(2) + '" stroke-dashoffset="' + (-acc).toFixed(2) + '"' +
        ' data-ring-c="' + g.c.toFixed(2) + '"></circle>'
      : '';
    acc += len;
    return out;
  }).join('') : '';
  var aria = opts.label ? ' role="img" aria-label="' + escapeAttr(opts.label) + '"' : ' aria-hidden="true"';
  var key = opts.key ? ' data-ring-key="' + escapeAttr(opts.key) + '"' : '';
  return '<div class="th-ring th-ring--donut' + (opts.className ? ' ' + escapeAttr(opts.className) : '') + '" style="--th-ring-size:' + size + 'px"' + aria + key + '>' +
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" style="transform:rotate(-90deg)" focusable="false" aria-hidden="true">' +
      '<circle class="th-ring-track" cx="' + g.cx + '" cy="' + g.cx + '" r="' + g.r.toFixed(2) + '" fill="none" stroke-width="' + stroke + '"></circle>' +
      arcs +
    '</svg>' +
    (opts.center ? '<div class="th-ring-center">' + opts.center + '</div>' : '') +
  '</div>';
}
function thAnimateRings(root) {
  root = root || document;
  var motionOk = !window.matchMedia || window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  (root.querySelectorAll ? root.querySelectorAll('.th-ring') : []).forEach(function (ring) {
    var key = ring.getAttribute('data-ring-key');
    if (ring.dataset.ringDrawn) return;
    ring.dataset.ringDrawn = '1';
    if (key) { if (_thRingsSeen[key]) return; _thRingsSeen[key] = true; }
    if (!motionOk) return;
    ring.querySelectorAll('.th-ring-fill').forEach(function (fill) {
      var target = fill.getAttribute('stroke-dasharray');
      var c = fill.getAttribute('data-ring-c');
      if (!target || !c) return;
      fill.style.transition = 'none';
      fill.style.strokeDasharray = '0 ' + c;
      void fill.getBoundingClientRect(); // commit the 0 before transitioning away from it
      fill.style.transition = 'stroke-dasharray .6s var(--th-ease, cubic-bezier(.2,.8,.2,1))';
      requestAnimationFrame(function () { fill.style.strokeDasharray = ''; });
      setTimeout(function () { fill.style.transition = ''; }, 700);
    });
  });
}
function thSetRingValue(ringEl, value) {
  if (!ringEl) return;
  var fill = ringEl.querySelector('.th-ring-fill');
  if (!fill) return;
  var c = Number(fill.getAttribute('data-ring-c')) || 0;
  var arc = Number(fill.getAttribute('data-ring-arc')) || c;
  var v = Math.max(0, Math.min(1, Number(value) || 0));
  fill.setAttribute('stroke-dasharray', (arc * v).toFixed(2) + ' ' + c.toFixed(2));
  fill.style.opacity = v === 0 ? '0' : '';
}
