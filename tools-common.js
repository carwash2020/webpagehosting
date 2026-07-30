// Shared behavior for the internal Workspace tool suite.
// Loaded by workspace.html and every tool page via <script src="/tools-common.js" defer>.

function openHelpModal() {
  const overlay = document.getElementById('helpModalOverlay');
  if (overlay) overlay.classList.add('is-open');
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
