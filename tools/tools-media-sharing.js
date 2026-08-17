// tools-media-sharing.js -- one of 4 files split out of the former
// tools-common.js (2026-08-20, structural item #42). See tools-effects.js
// for the full explanation of why and how this split was done safely.
//
// This file: the photo lightbox, voice dictation, toast show/dismiss,
// PDF share-or-download, client-side error logging, and the swipe-to-
// dismiss-modal gesture system.

// ---------------------------------------------------------------------------
// PHOTO LIGHTBOX -- added 2026-08-18 (item #1). Job photos were fixed
// 110x110px thumbnails with no way to actually see the detail in them --
// someone documenting a leaking pipe or a damaged part couldn't zoom in
// at all. photos: [{ url, label }], startIndex: which one was tapped.
//
// Swipe uses the same pointer-events technique already proven safe by
// the before/after slider elsewhere in this app (not a new gesture
// system) -- a real drag distance threshold, cancelled on any large
// vertical movement so it can't be confused with a page-scroll attempt.
// Prev/next buttons exist independently as the primary, always-visible
// way to navigate, so swipe is a bonus, not the only path.
// ---------------------------------------------------------------------------
function openPhotoLightbox(photos, startIndex) {
  if (!photos || !photos.length) return;
  let index = Math.max(0, Math.min(startIndex || 0, photos.length - 1));

  const overlay = document.createElement('div');
  overlay.className = 'photo-lightbox-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Photo viewer');
  overlay.innerHTML =
    '<button class="photo-lightbox-close" aria-label="Close">&times;</button>' +
    '<div class="photo-lightbox-stage">' +
      '<img class="photo-lightbox-img" alt="">' +
      '<button class="photo-lightbox-nav photo-lightbox-prev" aria-label="Previous photo">&#10094;</button>' +
      '<button class="photo-lightbox-nav photo-lightbox-next" aria-label="Next photo">&#10095;</button>' +
    '</div>' +
    '<div class="photo-lightbox-caption"></div>' +
    '<div class="photo-lightbox-counter"></div>';

  const imgEl = overlay.querySelector('.photo-lightbox-img');
  const captionEl = overlay.querySelector('.photo-lightbox-caption');
  const counterEl = overlay.querySelector('.photo-lightbox-counter');
  const prevBtn = overlay.querySelector('.photo-lightbox-prev');
  const nextBtn = overlay.querySelector('.photo-lightbox-next');
  const stage = overlay.querySelector('.photo-lightbox-stage');

  function render() {
    const p = photos[index];
    imgEl.src = p.url;
    imgEl.alt = p.label || 'Job photo';
    captionEl.textContent = p.label || '';
    counterEl.textContent = photos.length > 1 ? (index + 1) + ' / ' + photos.length : '';
    prevBtn.style.display = photos.length > 1 ? '' : 'none';
    nextBtn.style.display = photos.length > 1 ? '' : 'none';
  }
  function go(delta) {
    index = (index + delta + photos.length) % photos.length;
    render();
  }
  function close() {
    overlay.classList.remove('is-shown');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 200);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  }

  overlay.querySelector('.photo-lightbox-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  prevBtn.addEventListener('click', () => go(-1));
  nextBtn.addEventListener('click', () => go(1));
  document.addEventListener('keydown', onKey);

  // Swipe: same drag-and-cancel pattern as the before/after slider.
  let dragStartX = 0, dragStartY = 0, dragging = false;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true; dragStartX = e.clientX; dragStartY = e.clientY;
  });
  stage.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
    if (Math.abs(dy) > Math.abs(dx) * 1.5) return; // treat as a vertical/scroll gesture, not a swipe
    if (dx > 50) go(-1);
    else if (dx < -50) go(1);
  });
  stage.addEventListener('pointercancel', () => { dragging = false; });

  render();
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-shown'));
}

// ---------------------------------------------------------------------------
// VOICE DICTATION -- added 2026-08-18 (item #2). Useful for exactly how
// this app gets used -- describing a job while standing in a client's
// kitchen with dirty hands. Checks for real browser support first
// (SpeechRecognition is not implemented in every browser) and simply
// never shows the mic button where it's missing, rather than showing a
// button that would error when tapped.
// ---------------------------------------------------------------------------
function voiceDictationSupported() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Call once per field, right after that field's own markup exists in the
// DOM. Appends recognized speech to whatever the field already contains
// (with a separating space) rather than overwriting it, so dictating
// doesn't destroy something already typed.
function attachVoiceDictation(fieldId, buttonId) {
  if (!voiceDictationSupported()) return;
  const field = document.getElementById(fieldId);
  const button = document.getElementById(buttonId);
  if (!field || !button) return;
  button.style.display = '';

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;

  function stop() {
    if (recognizer) recognizer.stop();
    listening = false;
    button.classList.remove('is-listening');
  }

  button.addEventListener('click', () => {
    if (listening) { stop(); return; }

    recognizer = new SpeechRecognitionCtor();
    recognizer.lang = 'en-US';
    recognizer.interimResults = false;
    recognizer.continuous = true;

    recognizer.onresult = (event) => {
      let addition = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) addition += event.results[i][0].transcript;
      }
      if (!addition.trim()) return;
      const sep = field.value && !/\s$/.test(field.value) ? ' ' : '';
      field.value += sep + addition.trim();
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    recognizer.onerror = () => stop();
    recognizer.onend = () => stop();

    try {
      recognizer.start();
      listening = true;
      button.classList.add('is-listening');
    } catch (e) { stop(); }
  });
}

function showToast(message, options) {
  options = options || {};
  const duration = options.duration || 2600;
  const container = ensureToastContainerExists();

  const toast = document.createElement('div');
  toast.className = 'th-toast' + (options.type === 'error' ? ' is-error' : '');
  const iconName = options.type === 'error' ? 'warning' : 'check-circle';
  toast.innerHTML =
    '<svg class="th-icon" aria-hidden="true"><use href="#icon-' + iconName + '" xlink:href="#icon-' + iconName + '"></use></svg>' +
    '<span></span>';
  toast.querySelector('span').textContent = message; // textContent, not innerHTML -- message may contain user data
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

// Item #13 (2026-08-20): a dedicated toast with a real Undo action, for
// deletions that are actually reversible for a short window -- built as
// its own function rather than extending showToast() itself, which is
// called from dozens of places throughout the app that don't need this
// and shouldn't risk being affected by it. This function owns no
// deletion logic of its own: onUndo is whatever the caller needs to run
// to cancel its own pending action (typically clearTimeout on a
// setTimeout that would otherwise finalize the delete).
function showUndoToast(message, onUndo, options) {
  options = options || {};
  const duration = options.duration || 6000; // longer than a normal toast's 2.6s -- undo needs a real moment to notice and react
  const container = ensureToastContainerExists();

  const toast = document.createElement('div');
  toast.className = 'th-toast th-toast-undo';
  toast.innerHTML =
    '<svg class="th-icon" aria-hidden="true"><use href="#icon-check-circle" xlink:href="#icon-check-circle"></use></svg>' +
    '<span></span>' +
    '<button type="button" class="th-toast-undo-btn">Undo</button>';
  toast.querySelector('span').textContent = message; // textContent, not innerHTML -- message may contain user data

  toast.querySelector('.th-toast-undo-btn').addEventListener('click', (e) => {
    e.stopPropagation(); // don't also trigger the toast's own dismiss-on-click below
    onUndo();
    dismissToast(toast);
  });
  // Clicking anywhere else on the toast (not the Undo button) just
  // dismisses it early WITHOUT undoing -- same as a normal toast's
  // click-to-dismiss, and correctly does nothing to cancel the pending
  // action, since that's not what tapping past a toast means.
  toast.addEventListener('click', () => dismissToast(toast));

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-shown'));

  const timer = setTimeout(() => dismissToast(toast), duration);
  toast._thTimer = timer;
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

// Lightweight client-side error capture -- the cheap alternative to a
// paid error-tracking service for a project this size. Runs on every
// tool page (this file is shared by all of them), capped at the last
// 20 (per device before merging, and again after merging two devices'
// logs together -- see mergeClientErrorLog in sync.js) so it can't
// grow unbounded on a device that's been running a long time.
//
// Synced across devices (see sync.js) -- each entry gets its own
// unique id specifically so two devices' logs merge together safely
// instead of one overwriting the other. This was deliberately left
// device-local in an earlier version, right after the exact lesson
// about the synced payload's old 64 KiB size cap -- but that cap came
// from a `keepalive: true` flag on the push request that's since been
// removed entirely, so it no longer applies. Syncing this is what
// actually makes it useful for a two-person team: one person can now
// see what broke on the other's device, not just their own.
const CLIENT_ERROR_LOG_KEY = 'th_client_errors';
const CLIENT_ERROR_LOG_MAX = 20;

function logClientError(message, source, lineno, colno, stack) {
  try {
    let log = [];
    try { log = JSON.parse(localStorage.getItem(CLIENT_ERROR_LOG_KEY) || '[]'); } catch (e) { log = []; }
    log.unshift({
      // Random-suffixed id, not just Date.now() -- needed so two
      // different devices logging an error can merge correctly on
      // sync (see sync.js) without ever colliding, even in the
      // unlikely case both log something in the same millisecond.
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      message: String(message == null ? 'Unknown error' : message).slice(0, 500),
      source: source || '',
      line: lineno || null,
      col: colno || null,
      stack: stack ? String(stack).slice(0, 1000) : '',
      page: (typeof window !== 'undefined' && window.location) ? window.location.pathname : '',
      time: new Date().toISOString(),
    });
    if (log.length > CLIENT_ERROR_LOG_MAX) log.length = CLIENT_ERROR_LOG_MAX;
    localStorage.setItem(CLIENT_ERROR_LOG_KEY, JSON.stringify(log));
    // sync.js loads after this file but before any real error could
    // actually fire, so scheduleSync will exist by the time this
    // callback runs for real -- same defensive guard used everywhere
    // else in this codebase that writes synced data.
    if (typeof scheduleSync === 'function') scheduleSync();
  } catch (e) {
    // If even logging the error fails, give up silently rather than
    // risk looping back into another error.
  }
}

window.addEventListener('error', (event) => {
  logClientError(event.message, event.filename, event.lineno, event.colno, event.error && event.error.stack);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  logClientError(
    reason && reason.message ? reason.message : String(reason),
    '', null, null,
    reason && reason.stack
  );
});

// ---------------------------------------------------------------------------
// SWIPE-TO-DISMISS FOR MODALS -- added 2026-08-15
//
// Real drag physics rather than a "detect a flick, then close" shortcut:
// the modal actually tracks your finger, resists being pulled the wrong
// way, and either flies off or springs back based on how you release it.
//
// Three rules, all of which come from how native sheets behave:
//   1. VELOCITY OVERRIDES DISTANCE. A fast flick dismisses from anywhere,
//      even 20px in. A slow drag most of the way down still springs back
//      if you release it stationary -- because stopping means you changed
//      your mind. Judging on distance alone gets both cases wrong.
//   2. RESISTANCE UPWARD. Dragging up (the non-dismiss direction) moves
//      the modal a fraction of your finger's distance, on a curve, so it
//      feels tethered instead of broken.
//   3. NEVER FIGHT THE SCROLLBAR. .help-modal is `overflow-y:auto` and
//      can be taller than the screen. A drag only becomes a dismiss
//      gesture if the content is already scrolled to the very top AND
//      you're pulling downward. Otherwise it's a scroll and we don't
//      touch it. This is the single most common way swipe-to-dismiss
//      gets implemented badly.
// ---------------------------------------------------------------------------

const SWIPE_DISMISS_VELOCITY = 0.5;   // px/ms -- a genuine flick, matches the ~500px/s used by native sheet implementations
const SWIPE_DISMISS_DISTANCE = 0.25;  // fraction of modal height dragged past which a slow release still dismisses
const SWIPE_START_SLOP = 6;           // px of movement before committing to "this is a drag", so taps stay taps
const SWIPE_UP_RESISTANCE = 0.32;     // multiplier on upward (wrong-way) movement
const SWIPE_SPRING_BACK = 'transform .3s cubic-bezier(.22,1,.36,1)'; // decelerating ease-out, no overshoot wobble

function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function attachSwipeToDismiss(modalEl, onDismiss) {
  if (!modalEl || modalEl._swipeAttached) return;
  modalEl._swipeAttached = true;

  let startY = 0;
  let currentY = 0;
  let engaged = false;      // committed to dragging (vs scrolling or tapping)
  let decided = false;      // whether this touch has already been classified
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;         // px/ms, positive = moving down

  function setOffset(px) {
    modalEl.style.transform = px ? 'translateY(' + px + 'px)' : '';
  }

  function reset(animate) {
    modalEl.style.transition = animate && !prefersReducedMotion() ? SWIPE_SPRING_BACK : '';
    setOffset(0);
    modalEl.style.opacity = '';
    if (animate) {
      setTimeout(() => { modalEl.style.transition = ''; }, 320);
    } else {
      modalEl.style.transition = '';
    }
  }

  modalEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startY = currentY = lastY = e.touches[0].clientY;
    lastT = e.timeStamp;
    velocity = 0;
    engaged = false;
    decided = false;
    modalEl.style.transition = '';
  }, { passive: true });

  // Not passive -- this handler needs preventDefault() to stop the page
  // scrolling underneath once a drag is actually engaged.
  modalEl.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const y = e.touches[0].clientY;
    const dy = y - startY;

    if (!decided) {
      if (Math.abs(dy) < SWIPE_START_SLOP) return; // still within tap slop
      decided = true;
      // Only a downward pull from an already-top-scrolled modal counts.
      // Anything else is the user scrolling the modal's own content.
      engaged = (dy > 0 && modalEl.scrollTop <= 0);
      if (!engaged) return;
    }
    if (!engaged) return;

    e.preventDefault();

    const dt = e.timeStamp - lastT;
    if (dt > 0) {
      // Smoothed so one jittery sample can't spike the reading
      velocity = 0.7 * ((y - lastY) / dt) + 0.3 * velocity;
      lastY = y;
      lastT = e.timeStamp;
    }
    currentY = y;

    const raw = y - startY;
    // Downward: follow the finger exactly. Upward: heavy resistance on a
    // curve, so it gives a little but clearly doesn't want to go there.
    const offset = raw >= 0 ? raw : -Math.pow(-raw, 0.8) * SWIPE_UP_RESISTANCE;
    setOffset(offset);
    // Fade slightly as it goes, so dismissal feels continuous rather than
    // a sudden disappearance at the end.
    if (offset > 0) {
      const fade = Math.max(0, 1 - (offset / (modalEl.offsetHeight || 400)) * 0.6);
      modalEl.style.opacity = String(fade);
    }
  }, { passive: false });

  modalEl.addEventListener('touchend', () => {
    if (!engaged) { decided = false; return; }
    engaged = false;
    decided = false;

    const travelled = currentY - startY;
    const height = modalEl.offsetHeight || 400;
    const flicked = velocity > SWIPE_DISMISS_VELOCITY;
    const draggedFar = travelled > height * SWIPE_DISMISS_DISTANCE;

    if (travelled > 0 && (flicked || draggedFar)) {
      if (prefersReducedMotion()) {
        reset(false);
        if (typeof onDismiss === 'function') onDismiss();
        return;
      }
      // Continue in the direction it was already moving rather than
      // snapping to a fixed animation -- keeps the motion continuous
      // with the finger that launched it.
      modalEl.style.transition = 'transform .22s ease-out, opacity .22s ease-out';
      setOffset(height);
      modalEl.style.opacity = '0';
      setTimeout(() => {
        reset(false);
        if (typeof onDismiss === 'function') onDismiss();
      }, 200);
    } else {
      reset(true);
    }
  }, { passive: true });

  modalEl.addEventListener('touchcancel', () => {
    if (engaged) reset(true);
    engaged = false;
    decided = false;
  }, { passive: true });
}

// Wires every .help-modal on the page to close its own overlay. Safe to
// call more than once -- _swipeAttached guards against double-binding.
function initSwipeToDismissModals() {
  document.querySelectorAll('.help-modal-overlay').forEach(overlay => {
    const modal = overlay.querySelector('.help-modal');
    if (!modal) return;
    attachSwipeToDismiss(modal, () => {
      overlay.classList.remove('is-open');
    });
  });
}

document.addEventListener('DOMContentLoaded', initSwipeToDismissModals);

