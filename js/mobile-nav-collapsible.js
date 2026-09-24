// mobile-nav-collapsible.js -- 2026-09-19
//
// Toggles the "Services"/"Areas" sub-lists in the mobile hamburger menu
// (.mobile-services-sublist / .mobile-areas-sublist), collapsed by
// default (hidden attribute set in the markup). Between them those two
// lists carry 5 and 8 links -- with both always expanded, they used to
// push everything below (Gallery, Blog, Reviews, Schedule, Contact,
// Call) off the bottom of the menu on most phones.
//
// Deliberately a standalone file with no dependency on any page's own
// inline nav-toggle script -- those already differ slightly page to
// page (index.html's has a closeMobileMenu() helper + Escape/outside-
// click handling; several other pages use a shorter inline version) --
// this only needs the caret buttons themselves to exist, so it works
// the same everywhere it's included, regardless of which flavor of
// inline script that page also carries. Loaded with `defer`, so the DOM
// is already parsed by the time this runs -- no DOMContentLoaded wrapper
// needed.
(function () {
  document.querySelectorAll('.mobile-nav-caret').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var list = document.getElementById(btn.getAttribute('aria-controls'));
      if (!list) return;
      var isOpen = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!isOpen));
      list.hidden = isOpen;
    });
  });
})();
