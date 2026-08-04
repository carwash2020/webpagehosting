// Shared behavior for the internal Workspace tool suite.
// Loaded by workspace.html and every tool page via <script src="/tools-common.js" defer>.

// Captured once, immediately -- before any button on the page could
// possibly have been clicked yet, since this script is deferred and only
// runs after the whole page has parsed. This means per-section "?"
// bubbles (openInfoModal) can safely reuse the exact same modal element
// as the page's main "How to Use" button, without ever permanently
// overwriting that page's real help content with whatever a bubble
// showed most recently.
let _fullHelpTitle = '';
let _fullHelpBody = '';
(function captureFullHelpContent() {
  const overlay = document.getElementById('helpModalOverlay');
  if (!overlay) return;
  const h3 = overlay.querySelector('h3');
  const body = overlay.querySelector('.help-modal-body');
  _fullHelpTitle = h3 ? h3.innerHTML : '';
  _fullHelpBody = body ? body.innerHTML : '';
})();

function openInfoModal(title, bodyHtml) {
  const overlay = document.getElementById('helpModalOverlay');
  if (!overlay) return;
  const h3 = overlay.querySelector('h3');
  const body = overlay.querySelector('.help-modal-body');
  if (h3) h3.innerHTML = title;
  if (body) body.innerHTML = bodyHtml;
  overlay.classList.add('is-open');
}

// Generic collapsed-icon search: a magnifying-glass button that expands
// into the real search input when tapped, and collapses back to just the
// icon if it loses focus while still empty -- keeps a page's toolbar
// compact until a search is actually wanted, everywhere this pattern is
// used across the app.
function toggleIconSearch(wrapId, forceOpen) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const input = wrap.querySelector('input');
  const shouldOpen = forceOpen !== undefined ? forceOpen : !wrap.classList.contains('is-expanded');
  if (shouldOpen) {
    wrap.classList.add('is-expanded');
    if (input) setTimeout(() => input.focus(), 50);
  } else {
    wrap.classList.remove('is-expanded');
  }
}
document.addEventListener('focusout', (e) => {
  const wrap = e.target.closest && e.target.closest('.icon-search');
  if (!wrap) return;
  setTimeout(() => {
    if (wrap.contains(document.activeElement)) return;
    const input = wrap.querySelector('input');
    if (input && !input.value.trim()) wrap.classList.remove('is-expanded');
  }, 120);
});

// Generic collapse/expand for "Add X"-style form sections -- used across
// multiple tool pages so a form starts collapsed and the page opens
// showing actual data first, rather than an empty form.
// Fades and collapses ONE specific row before its underlying data
// actually gets deleted and the list re-renders -- called from a real
// delete-button click, never from a render/filter pass, so this can
// never fire on every keystroke the way animating the whole list would.
// Measures the row's own real height first rather than guessing a fixed
// value, since these rows vary in height (wrapped text, extra fields).
function animateRowExit(rowElement, onComplete) {
  if (!rowElement) { onComplete(); return; }
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) { onComplete(); return; }
  const isTableRow = rowElement.tagName === 'TR';
  // A <tr>'s rendered height is governed by the table layout algorithm,
  // not the normal box model -- max-height doesn't actually shrink a
  // table row's real height the way it does for a div, even though the
  // computed style itself transitions fine. Verified this directly
  // rather than assuming: for a <tr>, fall back to an opacity-only fade
  // instead of a collapse that would look subtly broken (correctly
  // fading, but leaving an empty gap where the row's height should be
  // shrinking) rather than actually smooth.
  if (isTableRow) {
    rowElement.style.transition = 'opacity .22s ease';
    requestAnimationFrame(() => { requestAnimationFrame(() => { rowElement.style.opacity = '0'; }); });
    setTimeout(onComplete, 230);
    return;
  }
  const height = rowElement.scrollHeight;
  rowElement.style.maxHeight = height + 'px';
  rowElement.style.overflow = 'hidden';
  rowElement.style.transition = 'opacity .22s ease, max-height .22s ease, margin .22s ease, padding .22s ease, border-width .22s ease';
  // Two rAFs, not one -- the browser needs to actually paint the
  // starting max-height (the row's real current height) as a distinct
  // frame before the target value changes, or the transition has
  // nothing to animate from and just snaps straight to the end state.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      rowElement.style.opacity = '0';
      rowElement.style.maxHeight = '0px';
      rowElement.style.marginTop = '0';
      rowElement.style.marginBottom = '0';
      rowElement.style.paddingTop = '0';
      rowElement.style.paddingBottom = '0';
      rowElement.style.borderWidth = '0';
    });
  });
  setTimeout(onComplete, 230);
}

// Swipe right anywhere on the page navigates back to Workspace, mirroring
// the native "swipe back" gesture already familiar from the rest of the
// phone. Reuses the exact same distance/speed thresholds already proven
// on Runway Dashboard's own tab-swipe gesture, for a consistent feel
// everywhere this is used. Skips touches that start inside a <table> --
// a wide table on a narrow phone may need its own horizontal scroll, and
// that shouldn't get hijacked into navigating away mid-scroll instead.
function setupSwipeBackToWorkspace() {
  let touchStartX = 0, touchStartY = 0, touchStartTime = 0, touchStartedInTable = false;
  document.body.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
    touchStartedInTable = !!(e.target.closest && e.target.closest('table'));
  }, { passive: true });
  document.body.addEventListener('touchend', (e) => {
    if (!e.changedTouches.length || touchStartedInTable) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const elapsed = Date.now() - touchStartTime;
    const isMostlyHorizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
    const isFarEnough = dx > 60; // rightward only, matching the "swipe back" convention
    const isFastEnough = elapsed < 600;
    if (isMostlyHorizontal && isFarEnough && isFastEnough) {
      window.location.href = '/workspace.html';
    }
  }, { passive: true });
}

function toggleFormSection(id, forceOpen) {
  const el = document.getElementById(id);
  if (!el) return;
  if (forceOpen) el.classList.remove('is-collapsed');
  else el.classList.toggle('is-collapsed');
}

function openHelpModal() {
  openInfoModal(_fullHelpTitle, _fullHelpBody);
}

function closeHelpModal() {
  const overlay = document.getElementById('helpModalOverlay');
  if (overlay) overlay.classList.remove('is-open');
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const dialogOverlay = document.getElementById('customDialogOverlay');
  if (dialogOverlay && dialogOverlay.classList.contains('is-open')) {
    const cancelBtn = document.getElementById('customDialogCancelAction');
    if (cancelBtn) cancelBtn.click();
    return;
  }
  closeHelpModal();
});

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
}

function showAlert(message) {
  return new Promise((resolve) => {
    ensureDialogModalExists();
    const overlay = document.getElementById('customDialogOverlay');
    document.getElementById('customDialogMessage').textContent = message;
    const buttons = document.getElementById('customDialogButtons');
    buttons.innerHTML = '';

    const okBtn = document.createElement('button');
    okBtn.className = 'dialog-btn dialog-btn-primary';
    okBtn.id = 'customDialogCancelAction'; // Escape/backdrop-click resolves the same as OK for a plain alert
    okBtn.textContent = 'OK';
    okBtn.onclick = () => { overlay.classList.remove('is-open'); resolve(true); };
    buttons.appendChild(okBtn);

    overlay.classList.add('is-open');
    okBtn.focus();
  });
}

function showConfirm(message, options) {
  options = options || {};
  return new Promise((resolve) => {
    ensureDialogModalExists();
    const overlay = document.getElementById('customDialogOverlay');
    document.getElementById('customDialogMessage').textContent = message;
    const buttons = document.getElementById('customDialogButtons');
    buttons.innerHTML = '';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dialog-btn dialog-btn-cancel';
    cancelBtn.id = 'customDialogCancelAction'; // Escape/backdrop-click cancels, same as native confirm()
    cancelBtn.textContent = options.cancelText || 'Cancel';
    cancelBtn.onclick = () => { overlay.classList.remove('is-open'); resolve(false); };

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'dialog-btn ' + (options.danger ? 'dialog-btn-danger' : 'dialog-btn-primary');
    confirmBtn.textContent = options.confirmText || 'OK';
    confirmBtn.onclick = () => { overlay.classList.remove('is-open'); resolve(true); };

    buttons.appendChild(cancelBtn);
    buttons.appendChild(confirmBtn);
    overlay.classList.add('is-open');
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

function showToast(message, options) {
  options = options || {};
  const duration = options.duration || 2600;
  const container = ensureToastContainerExists();

  const toast = document.createElement('div');
  toast.className = 'th-toast' + (options.type === 'error' ? ' is-error' : '');
  toast.textContent = message;
  toast.addEventListener('click', () => dismissToast(toast));
  container.appendChild(toast);

  // Letting the element paint in its resting state before adding
  // .is-shown means the CSS transition actually animates in, instead of
  // starting already-visible.
  requestAnimationFrame(() => toast.classList.add('is-shown'));

  const timer = setTimeout(() => dismissToast(toast), duration);
  toast._thTimer = timer;
}

function dismissToast(toast) {
  if (!toast || toast._thDismissed) return;
  toast._thDismissed = true;
  clearTimeout(toast._thTimer);
  toast.classList.remove('is-shown');
  setTimeout(() => toast.remove(), 200);
}

// ---------------------------------------------------------------------------
// Share-or-download for generated PDFs -- tries the native share sheet
// (text it, email it, AirDrop it) first on devices that support sharing
// files, falls back to a normal download everywhere else (most desktop
// browsers, or if the user cancels/it fails). The PDF still gets
// downloaded either way if sharing isn't available, so nothing is lost
// by trying the nicer path first.
// ---------------------------------------------------------------------------

function canShareFiles() {
  return !!(navigator.share && navigator.canShare);
}

async function sharePdfOrDownload(doc, filename, shareTitle) {
  if (canShareFiles()) {
    try {
      const blob = doc.output('blob');
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: shareTitle || filename });
        return; // shared successfully -- no separate download needed
      }
    } catch (e) {
      // AbortError means the user just cancelled the share sheet --
      // respect that and don't fall back to forcing a download they
      // didn't ask for. Any OTHER error (share genuinely failed) falls
      // through to the normal download below instead.
      if (e.name === 'AbortError') return;
    }
  }
  doc.save(filename);
}

// PWA install support -- registers the service worker (see its own file
// for the network-first caching strategy, which gives real offline
// support without risking the stale-cache confusion this project has
// been bitten by before) and satisfies installability requirements in
// browsers that check for one before offering "Add to Home Screen".
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // Silently ignore -- the site works completely fine without the
      // service worker registering; this only affects the install prompt.
    });
  });
}
