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
  if (e.key === 'Escape') closeHelpModal();
});
