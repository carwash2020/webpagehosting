// service-area-map.js -- the service-area map's small interactions
// (2026-09-29), on every page that carries the .radius-figure map: the
// homepage and the 16 city and service pages.
//
// - "No trip fee within 15 miles" shows or hides the 15-mile ring.
// - On the pages with a .radius-key list beside the map, hovering a
//   town in the list lights it on the map, the same .is-linked state the
//   homepage's town cards already drive from index.html's own script.
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

    const key = figure.parentElement && figure.parentElement.querySelector('.radius-key');
    if (!key) return;
    const groups = figure.querySelectorAll('g[data-city]');
    function link(city, on) {
      groups.forEach(function (g) { g.classList.toggle('is-linked', on && g.getAttribute('data-city') === city); });
    }
    key.querySelectorAll('li[data-city]').forEach(function (li) {
      const city = li.getAttribute('data-city');
      li.addEventListener('mouseenter', function () { li.classList.add('is-linked'); link(city, true); });
      li.addEventListener('mouseleave', function () { li.classList.remove('is-linked'); link(city, false); });
    });
  });
})();
