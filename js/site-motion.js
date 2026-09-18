/* site-motion.js -- shared scroll-reveal for the public marketing pages
   other than index.html (the 5 city landing pages and the blog).

   index.html keeps its own inline copy plus page-specific work (the
   rebuild control, the motto rail, hero depth). It is proven in
   production, so it is deliberately left alone rather than refactored.

   WHY THIS IS BUILT DEFENSIVELY
   These pages hide [data-reveal] content until something reveals it, so
   a reveal mechanism that silently fails would blank real content on a
   live lead-generating site. That is not an acceptable failure mode for
   a scroll animation, so this file never depends on a single mechanism:

     1. `reveal-ready` is only added once we are committed to revealing.
        Without it, styles.css keeps every [data-reveal] fully visible,
        so no-JS and blocked-script visitors are safe by default.
     2. Geometry is checked directly (getBoundingClientRect) on load,
        scroll and resize -- no IntersectionObserver required.
     3. IntersectionObserver is used too when present, purely as the
        cheap path.
     4. A watchdog reveals everything if, after 2.5s, nothing has been
        revealed at all -- which is what a wholesale mechanism failure
        looks like. A page that loses its animation is a small problem.
        A page that loses its text is a real one.

   Reduced motion is handled in styles.css, which zeroes transitions
   globally and pins the revealed state on. */
(function () {
  var nodes = [].slice.call(document.querySelectorAll('[data-reveal]'));
  if (!nodes.length) return;

  var revealedAny = false;

  function reveal(el) {
    if (el.classList.contains('is-visible')) return;
    el.classList.add('is-visible');
    revealedAny = true;
  }

  function inView(el) {
    var r = el.getBoundingClientRect();
    var h = window.innerHeight || document.documentElement.clientHeight;
    return r.top < h * 0.92 && r.bottom > 0;
  }

  function sweep() {
    for (var i = nodes.length - 1; i >= 0; i--) {
      if (inView(nodes[i])) {
        reveal(nodes[i]);
        nodes.splice(i, 1);
      }
    }
    if (!nodes.length) detach();
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    raf(function () { ticking = false; sweep(); });
  }

  function detach() {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  }

  // Committed: from here on, CSS may hide un-revealed elements.
  document.documentElement.classList.add('reveal-ready');

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        reveal(entry.target);
        io.unobserve(entry.target);
        var i = nodes.indexOf(entry.target);
        if (i > -1) nodes.splice(i, 1);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    nodes.forEach(function (el) { io.observe(el); });
  }

  sweep();

  // Watchdog: nothing revealed at all means the mechanism is not working
  // on this browser. Show everything rather than leave the page blank.
  setTimeout(function () {
    if (revealedAny) return;
    [].forEach.call(document.querySelectorAll('[data-reveal]'), function (el) {
      el.classList.add('is-visible');
    });
    detach();
  }, 2500);
})();

/* ---------- blog reading progress + reading time ----------
   Only runs on article pages (gated on .blog-article), so the landing
   pages that share this file are untouched. The reading time is a plain
   words-divided-by-rate estimate, labelled "about", not a claim.
   Everything here is additive: if it fails, the article still reads. */
(function () {
  var article = document.querySelector('.blog-article');
  if (!article) return;

  try {
    // "about N min read", placed above the article body.
    var words = (article.textContent || '').trim().split(/\s+/).length;
    var mins = Math.max(1, Math.round(words / 200));
    var meta = document.createElement('p');
    meta.className = 'read-meta';
    meta.textContent = 'About ' + mins + ' min read';
    article.parentNode.insertBefore(meta, article);

    // Progress bar across the top, driven by how far through the article
    // body the visitor actually is -- not the whole document, which would
    // count the header and footer as "reading".
    var bar = document.createElement('div');
    bar.className = 'read-progress';
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '<i></i>';
    document.body.appendChild(bar);

    var ticking = false;
    var update = function () {
      ticking = false;
      var rect = article.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var span = rect.height - vh;
      var p = span > 0 ? (-rect.top) / span : (rect.top <= 0 ? 1 : 0);
      p = p < 0 ? 0 : (p > 1 ? 1 : p);
      bar.style.setProperty('--read', p.toFixed(4));
    };
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
      raf(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  } catch (e) {
    /* an article that loses its progress bar still reads fine */
  }
})();
