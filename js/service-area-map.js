// service-area-map.js -- the service-area map's small interactions
// (2026-09-29), on every page that carries the .radius-figure map: the
// homepage and the 16 city and service pages.
//
// - "No trip fee within 15 miles" shows or hides the 15-mile ring.
// - On the pages with a .radius-key list beside the map, hovering a
//   town in the list lights it on the map, the same .is-linked state the
//   homepage's town cards already drive from index.html's own script.
//   Keyboard focus does the same (Package A4, 2026-09-29): each town is
//   a tabindex="0" stop, and focusin/focusout mirror the hover.
// - Each town's dot gets a .radius-focus ring, drawn 5 units outside the
//   node and shown while the town is linked, so the link reads without
//   relying on colour or the glow.
//
// No module system -- a plain IIFE, same convention as every other
// shared script on this site. Without it the map is complete: the ring
// shows and nothing else depends on this file.
(function () {
  document.querySelectorAll('.radius-figure').forEach(function (figure) {
    const toggle = figure.querySelector('.radius-ring-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        const on = toggle.getAttribute('aria-pressed') !== 'true';
        toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
        figure.classList.toggle('is-ring-off', !on);
      });
    }

    const groups = figure.querySelectorAll('g[data-city]');
    groups.forEach(function (g) {
      const node = g.querySelector('.radius-node, .radius-hub');
      if (!node || g.querySelector('.radius-focus')) return;
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('class', 'radius-focus');
      ring.setAttribute('cx', node.getAttribute('cx'));
      ring.setAttribute('cy', node.getAttribute('cy'));
      ring.setAttribute('r', String(parseFloat(node.getAttribute('r')) + 5));
      ring.setAttribute('aria-hidden', 'true');
      node.parentNode.insertBefore(ring, node.nextSibling);
    });

    const key = figure.parentElement && figure.parentElement.querySelector('.radius-key');
    if (!key) return;
    function link(city, on) {
      groups.forEach(function (g) { g.classList.toggle('is-linked', on && g.getAttribute('data-city') === city); });
    }
    key.querySelectorAll('li[data-city]').forEach(function (li) {
      const city = li.getAttribute('data-city');
      function on() { li.classList.add('is-linked'); link(city, true); }
      function off() { li.classList.remove('is-linked'); link(city, false); }
      li.addEventListener('mouseenter', on);
      li.addEventListener('mouseleave', function () { if (li !== document.activeElement) off(); });
      li.addEventListener('focusin', on);
      li.addEventListener('focusout', off);
    });
  });
})();
