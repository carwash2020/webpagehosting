// Shared drawn-signature capture (2026-09-22), extracted from the canvas
// signature pad portal/contracts.html already had working for client
// contract e-signatures (initSignaturePad/clearContractSignature/
// getContractSignatureDataUrl) -- generalized here so the same, proven
// pattern can be reused anywhere a card-authorization signature is
// currently just a typed name, instead of writing a new implementation
// per page. Deliberately a plain root-level script, not folded into
// tools-dialogs.js or portal-app.js: portal/*.html and tools/*.html are
// two isolated script worlds by design (see portal/contracts.html's own
// comment on why it loads none of the internal /tools/ scripts), and
// this needs to be loadable by both without crossing that boundary.
//
// Keyed by canvasId (not a record id) so a page can host more than one
// pad, or wire one up without inventing a naming convention -- pass
// whatever DOM id the canvas already has. Functions are prefixed
// sigPad* (not initSignaturePad/etc.) so a page that already has its
// own like-named wrapper (portal/contracts.html's initSignaturePad(contractId),
// kept for its existing onclick handlers) never collides with this
// shared file's own globals.

const _signaturePadState = {};

function sigPadInit(canvasId, statusElId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  _signaturePadState[canvasId] = { hasDrawing: false };
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  let drawing = false;

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    _signaturePadState[canvasId].hasDrawing = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (statusElId) {
      const statusEl = document.getElementById(statusElId);
      if (statusEl) statusEl.textContent = 'Signature captured';
    }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  canvas.addEventListener('pointercancel', () => { drawing = false; });
}

function sigPadClear(canvasId, statusElId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (_signaturePadState[canvasId]) _signaturePadState[canvasId].hasDrawing = false;
  if (statusElId) {
    const statusEl = document.getElementById(statusElId);
    if (statusEl) statusEl.textContent = '';
  }
}

function sigPadHasDrawing(canvasId) {
  return !!(_signaturePadState[canvasId] && _signaturePadState[canvasId].hasDrawing);
}

// Returns null (not an empty/blank data URL) when nothing has actually
// been drawn -- callers use this to tell "no signature yet" apart from
// "a signature exists," the same distinction portal/contracts.html's
// original getContractSignatureDataUrl() already made.
function sigPadDataUrl(canvasId) {
  if (!sigPadHasDrawing(canvasId)) return null;
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  return canvas.toDataURL('image/png');
}
