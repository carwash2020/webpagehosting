// Client portal shared app-shell JavaScript (2026-09-04), paired
// with portal/portal-app.css. Currently just the skeleton-loading
// helpers, requested directly: "Skeleton loading states." A
// dedicated home for this rather than duplicating the same template
// string across five pages, and a natural place for other shared
// app-shell behavior (pull-to-refresh, an offline indicator) as
// those get built.

// A generic card shape (title bar + two lines of varying width),
// repeated `count` times. Not a bespoke skeleton per page -- this is
// a reasonable approximation of every real card class on the portal
// (invoice-card, job-card, quote-card, wo-card, set-card), and
// building a pixel-matched skeleton per page would be considerably
// more work for a perceptual improvement that doesn't need it.
function portalSkeletonCards(count) {
  const card =
    '<div class="skeleton-card">' +
    '<div class="skeleton-line is-title"></div>' +
    '<div class="skeleton-line is-wide"></div>' +
    '<div class="skeleton-line is-narrow"></div>' +
    '</div>';
  return card.repeat(count);
}

// A smaller variant for nested contexts, e.g. a message thread
// opening inside an already-visible work order card, where a
// full-sized card skeleton would be visually heavier than the space
// it sits in.
function portalSkeletonLines(count) {
  const line =
    '<div class="skeleton-mini">' +
    '<div class="skeleton-line is-medium"></div>' +
    '</div>';
  return line.repeat(count);
}
