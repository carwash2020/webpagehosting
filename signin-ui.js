// Triple H sign-in: small shared helpers for portal/login.html and
// tools/login.html (Show/Hide password, busy buttons, wrong-entry state, and
// the ~600ms success animation). No auth logic lives here -- every Supabase
// call stays in the page that makes it.
// The one shared global: a top-level var, so it is also window.ThSignin.
var ThSignin = (function () {
  var SUCCESS_MS = 600;

  function prefersReducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }

  // Wires every [data-si-pw] wrapper: <div class="si-pw" data-si-pw><input> <button class="si-toggle">.
  function initPasswordToggles(root) {
    (root || document).querySelectorAll('[data-si-pw]').forEach(function (wrap) {
      var input = wrap.querySelector('input');
      var btn = wrap.querySelector('.si-toggle');
      if (!input || !btn) return;
      btn.addEventListener('click', function () {
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Hide' : 'Show';
        btn.setAttribute('aria-pressed', show ? 'true' : 'false');
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        input.focus();
      });
    });
  }

  // Busy state for a submit button: spinner + label, announced via aria-busy.
  function setBusy(btn, busy, busyLabel, idleLabel) {
    if (!btn) return;
    btn.disabled = !!busy;
    if (busy) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
    btn.textContent = busy ? busyLabel : idleLabel;
  }

  // Marks inputs invalid (red border + aria-invalid) and ties them to the error text.
  function setInvalid(inputs, errorEl, on) {
    [].concat(inputs || []).forEach(function (el) {
      if (!el) return;
      if (on) {
        el.setAttribute('aria-invalid', 'true');
        if (errorEl && errorEl.id) el.setAttribute('aria-describedby', errorEl.id);
      } else {
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
      }
    });
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove('si-shake');
    void el.offsetWidth;
    el.classList.add('si-shake');
  }

  // Success: the ghosted logo un-ghosts and the form settles over ~600ms,
  // then done() runs (the page's existing redirect). With
  // prefers-reduced-motion the state flips instantly (CSS drops the
  // transitions) and the redirect follows after a short beat.
  var succeeded = false;
  function success(done) {
    if (succeeded) return;
    succeeded = true;
    var live = document.getElementById('siLive');
    if (live) live.textContent = 'Signed in. Opening your account.';
    document.body.classList.add('is-success');
    setTimeout(done, prefersReducedMotion() ? 150 : SUCCESS_MS);
  }

  return {
    SUCCESS_MS: SUCCESS_MS,
    prefersReducedMotion: prefersReducedMotion,
    initPasswordToggles: initPasswordToggles,
    setBusy: setBusy,
    setInvalid: setInvalid,
    shake: shake,
    success: success,
  };
})();
