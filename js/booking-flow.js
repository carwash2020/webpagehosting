// booking-flow.js -- shared helpers for the pages that book or move an
// appointment: the public booking pages (booking.html,
// manage-booking.html) and, since round 4 of the same pass, the client
// portal's three self-scheduling spots (quotes.html, jobs.html,
// work-orders.html -- createBookingPicker() below). Added 2026-09-22 in
// the booking-flow pass. Loaded AFTER /js/business-hours.js, whose
// globals (zonedTimeToUtc, addDaysToDateStr, businessWeekday,
// HOURS_BY_WEEKDAY, computeSlotsForDate, fetchBookingsForDate,
// todayDateStrInBusinessTz, DAYS_AHEAD_SHOWN, BUSINESS_TIMEZONE)
// everything here builds on.
//
// Deliberately a separate file rather than more code in
// business-hours.js: that file is also loaded by tools/workspace.html
// and precached by the portal's service worker, so touching it would
// ripple a version bump into both. These helpers only matter to the
// pages that book or move an appointment, and every one of those pages
// keeps working (with its original picker) if this file fails to load.
//
// No module system -- plain globals, same convention as every other
// shared script on this site.

// ---------- whole-window availability ----------
// Every date picker used to fetch ONE day at a time, only after that
// day was tapped: a visitor saw "Loading times..." on every tap and had
// no way to know which of the 14 days had anything open until they'd
// tried them one by one (booking.html opened on today, which the
// 2-hour lead time and afternoon weekday hours usually leave empty).
// get_booking_availability already accepts any range, so this asks for
// the whole window in ONE call. Same padding, filter and
// throw-on-non-OK contract as business-hours.js's fetchBookingsForDate(),
// which stays exactly as it was for its existing callers.
async function fetchBookingsForRange(supabaseUrl, supabaseAnonKey, startDateStr, days, excludeStartIso) {
  const firstDayUtc = zonedTimeToUtc(startDateStr, 0, 0);
  const afterLastDayUtc = zonedTimeToUtc(addDaysToDateStr(startDateStr, days), 0, 0);
  const rangeStart = new Date(firstDayUtc.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const rangeEnd = new Date(afterLastDayUtc.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(supabaseUrl + '/rest/v1/rpc/get_booking_availability', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: 'Bearer ' + supabaseAnonKey,
    },
    body: JSON.stringify({ p_range_start: rangeStart, p_range_end: rangeEnd }),
  });
  if (!res.ok) throw new Error('availability check failed (HTTP ' + res.status + ')');
  const rows = await res.json();
  return rows
    .filter(function (r) { return r.start_at !== excludeStartIso; })
    .map(function (r) { return { start: new Date(r.start_at), end: new Date(r.end_at) }; });
}

// Slots for every day of a window, keyed "YYYY-MM-DD", from ONE bookings
// list. computeSlotsForDate() only checks overlap against the list it's
// handed, so giving it the whole window's bookings for each day yields
// exactly what the old per-day fetch did. `closed` marks a weekday with
// no business hours at all, so a picker can say "Closed" rather than
// "Full" for a day nobody could ever book. `noTimes` (2026-09-22, round
// 4) marks an open day that has nothing left even with NOTHING booked --
// today, once its hours (less the 2-hour lead time) are used up -- so an
// evening visitor sees "No times" on today instead of "Full", which read
// as booked solid when it simply wasn't bookable any more.
function computeSlotsByDate(startDateStr, days, durationMinutes, bookings) {
  const byDate = {};
  for (let i = 0; i < days; i++) {
    const dateStr = addDaysToDateStr(startDateStr, i);
    const slots = computeSlotsForDate(dateStr, durationMinutes, bookings);
    const closed = !HOURS_BY_WEEKDAY[businessWeekday(dateStr)];
    byDate[dateStr] = {
      slots: slots,
      closed: closed,
      noTimes: !closed && !slots.length && !computeSlotsForDate(dateStr, durationMinutes, []).length,
    };
  }
  return byDate;
}

// Which day the picker should open on, or null if nothing in the window
// has room. `preferred` (a deep link's own date, or the day the visitor
// already picked) wins when it has room; when it's full, the nearest
// open day AFTER it -- they asked for Thursday, so Friday, not Monday --
// and only if nothing later is open, the earliest open day before it.
// With no preference, simply the earliest open day.
function firstBookableDate(byDate, preferred) {
  const keys = Object.keys(byDate).sort();
  const open = function (k) { return byDate[k] && byDate[k].slots.length > 0; };
  if (preferred && open(preferred)) return preferred;
  if (preferred) {
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] > preferred && open(keys[i])) return keys[i];
    }
  }
  for (let i = 0; i < keys.length; i++) {
    if (open(keys[i])) return keys[i];
  }
  return null;
}

// Short label under each day in the strip: "3 open", "Full", "Closed",
// or "No times" (see computeSlotsByDate's noTimes).
function bookingDayLabel(entry) {
  if (!entry) return '';
  if (entry.closed) return 'Closed';
  const n = entry.slots.length;
  if (n) return n + ' open';
  return entry.noTimes ? 'No times' : 'Full';
}

// ---------- small picker helpers (2026-09-25 booking polish) ----------
// Why a greyed-out day can't be picked, for the note a tap on it shows:
// "<strong>Saturday, Sep 26</strong> is fully booked. Pick another day."
function bookingUnavailableDayText(dateStr, entry) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIMEZONE, weekday: 'long', month: 'short', day: 'numeric' }).format(zonedTimeToUtc(dateStr, 12, 0));
  let why = 'is fully booked';
  if (entry && entry.closed) why = 'is closed';
  else if (entry && entry.noTimes) why = 'has no times left to book online';
  return '<strong>' + label + '</strong> ' + why + '. Pick another day.';
}

// A short shake on a tapped full day (CSS .is-nudged, dayNudge keyframes
// on each page). Removed on animationend so the next tap replays it.
function bookingNudge(btn) {
  if (!btn) return;
  btn.classList.remove('is-nudged');
  void btn.offsetWidth; // restart the animation
  btn.classList.add('is-nudged');
  btn.addEventListener('animationend', function done() {
    btn.classList.remove('is-nudged');
    btn.removeEventListener('animationend', done);
  });
}

// Edge fades on a horizontally scrolling date strip: .has-more-left /
// .has-more-right on its .date-row-wrap parent, only while there's more
// to scroll that way. Safe to call again after every re-render.
function bookingScrollFade(rowEl) {
  const wrap = rowEl && rowEl.closest ? rowEl.closest('.date-row-wrap') : null;
  if (!wrap) return;
  function update() {
    const max = rowEl.scrollWidth - rowEl.clientWidth;
    wrap.classList.toggle('has-more-left', rowEl.scrollLeft > 2);
    wrap.classList.toggle('has-more-right', rowEl.scrollLeft < max - 2);
  }
  if (!rowEl._bookingFade) {
    rowEl._bookingFade = true;
    rowEl.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
  }
  update();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(update);
}

// ---------- one whole-window picker for the client portal ----------
// The portal's three self-scheduling spots -- quotes.html (schedule the
// job on approval), jobs.html (book a due check-up) and work-orders.html
// (a preferred time on a request) -- each carried its own copy of the
// original picker: a bare date strip, one fetch per tap ("Loading
// times..." every time), and no way to see which day had room. This is
// the same whole-window behavior booking.html got, written once so the
// three can't drift apart again:
//   - ONE availability fetch for the whole strip; every day says
//     "3 open" / "Full" / "Closed", and a day with nothing open can't be
//     picked;
//   - it opens on the first day that actually has room, not on today
//     (which the 2-hour lead time and afternoon hours usually empty);
//   - switching days is instant (no refetch);
//   - if the window-wide fetch fails, tapping a day falls back to
//     fetching just that day, exactly as these pickers always did, and
//     there's a Try again button;
//   - a stale-response guard, so a slow load never overwrites a newer
//     one.
// The page keeps owning everything that happens once a time is picked
// (onSelect: the summary line, the confirm button, a stored preferred
// slot) and when a pick stops standing (onClear) -- so none of that
// changes, and a page that can't load this file keeps its own picker.
//
// opts: { dateRowEl, gridEl, emptyEl?, durationMinutes, supabaseUrl,
//         anonKey, onSelect(slot), onClear()? }
// slot is computeSlotsForDate()'s own { startUtc, endUtc, label }.
// Returns { reload, destroy }. reload() re-renders the strip and
// re-fetches; destroy() makes any load still in flight a no-op. Creating
// a second picker on the same date row (a panel closed and reopened
// before its first load landed) destroys the first, so two instances
// can never write into the same strip.
function createBookingPicker(opts) {
  const dateRowEl = opts.dateRowEl;
  if (dateRowEl._bookingPicker) dateRowEl._bookingPicker.destroy();
  const gridEl = opts.gridEl;
  const emptyEl = opts.emptyEl || null;
  const minutes = opts.durationMinutes || 120;
  const onSelect = typeof opts.onSelect === 'function' ? opts.onSelect : function () {};
  const onClear = typeof opts.onClear === 'function' ? opts.onClear : function () {};
  let windowStart = todayDateStrInBusinessTz();
  let byDate = null;
  let loading = false;
  let selectedDate = null;
  let requestId = 0;
  let dayNoteEl = null;

  // The note a tap on a full day shows, just under the strip.
  function showDayNote(html) {
    if (!dayNoteEl) {
      dayNoteEl = document.createElement('p');
      dayNoteEl.className = 'booking-picker-daynote';
      dayNoteEl.setAttribute('role', 'status');
      const anchor = (dateRowEl.closest && dateRowEl.closest('.date-row-wrap')) || dateRowEl;
      anchor.insertAdjacentElement('afterend', dayNoteEl);
    }
    dayNoteEl.innerHTML = html;
    dayNoteEl.hidden = !html;
  }

  function showEmpty(show) {
    if (emptyEl) emptyEl.style.display = show ? 'block' : 'none';
  }

  function skeletonHtml() {
    return '<div class="slot-skel"></div><div class="slot-skel"></div><div class="slot-skel"></div><div class="slot-skel"></div>' +
      '<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;">Loading available times...</span>';
  }

  function errorHtml() {
    return '<p class="booking-picker-msg is-error">Couldn\'t load available times. Check your connection and try again.</p>' +
      '<button type="button" class="slot-btn booking-picker-retry">Try again</button>';
  }

  function wireRetry() {
    const retry = gridEl.querySelector('.booking-picker-retry');
    if (retry) retry.addEventListener('click', reload);
  }

  function renderStrip() {
    let html = '';
    for (let i = 0; i < DAYS_AHEAD_SHOWN; i++) {
      const dateStr = addDaysToDateStr(windowStart, i);
      const noonUtc = zonedTimeToUtc(dateStr, 12, 0);
      const dow = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIMEZONE, weekday: 'short' }).format(noonUtc);
      const dom = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIMEZONE, day: 'numeric' }).format(noonUtc);
      html += '<button type="button" class="date-btn" data-date="' + dateStr + '" aria-pressed="false"><div class="dow">' + dow + '</div><div class="dom">' + dom + '</div><span class="avail is-loading" aria-hidden="true"></span></button>';
    }
    dateRowEl.innerHTML = html;
    dateRowEl.querySelectorAll('.date-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('aria-disabled') === 'true') {
          showDayNote(bookingUnavailableDayText(btn.dataset.date, byDate && byDate[btn.dataset.date]));
          bookingNudge(btn);
          return;
        }
        showDayNote('');
        selectDay(btn.dataset.date);
      });
    });
  }

  function markSelected(dateStr) {
    dateRowEl.querySelectorAll('.date-btn').forEach(function (b) {
      const on = b.dataset.date === dateStr;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function applyLabels() {
    dateRowEl.querySelectorAll('.date-btn').forEach(function (btn) {
      const entry = byDate[btn.dataset.date];
      const label = bookingDayLabel(entry);
      const unavailable = !entry || !entry.slots.length;
      const availEl = btn.querySelector('.avail');
      if (availEl) {
        availEl.classList.remove('is-loading');
        availEl.textContent = label;
      }
      btn.classList.toggle('is-unavailable', unavailable);
      btn.setAttribute('aria-disabled', unavailable ? 'true' : 'false');
      const dow = btn.querySelector('.dow') ? btn.querySelector('.dow').textContent : '';
      const dom = btn.querySelector('.dom') ? btn.querySelector('.dom').textContent : '';
      btn.setAttribute('aria-label', dow + ' ' + dom + ', ' + (label || 'no times'));
    });
  }

  function renderSlots(slots) {
    if (!slots.length) {
      gridEl.innerHTML = '';
      showEmpty(true);
      return;
    }
    showEmpty(false);
    gridEl.innerHTML = slots.map(function (s, i) {
      return '<button type="button" class="slot-btn" data-idx="' + i + '" aria-pressed="false">' + s.label + '</button>';
    }).join('');
    gridEl.querySelectorAll('.slot-btn').forEach(function (btn, i) {
      btn.addEventListener('click', function () {
        gridEl.querySelectorAll('.slot-btn').forEach(function (b) { b.classList.remove('is-selected'); b.setAttribute('aria-pressed', 'false'); });
        btn.classList.add('is-selected');
        btn.setAttribute('aria-pressed', 'true');
        onSelect(slots[i]);
      });
    });
  }

  async function selectDay(dateStr) {
    selectedDate = dateStr;
    markSelected(dateStr);
    onClear();
    if (loading) {
      // The window-wide load is still in flight: it renders whichever day
      // is selected by the time it lands.
      gridEl.innerHTML = skeletonHtml();
      showEmpty(false);
      return;
    }
    if (byDate && byDate[dateStr]) {
      ++requestId; // any older per-day fallback still in flight is now stale
      renderSlots(byDate[dateStr].slots);
      return;
    }
    // Fallback: the window-wide load failed, so fetch just this day,
    // exactly as these pickers always used to.
    const id = ++requestId;
    gridEl.innerHTML = skeletonHtml();
    showEmpty(false);
    let bookings;
    try {
      bookings = await fetchBookingsForDate(opts.supabaseUrl, opts.anonKey, dateStr);
    } catch (e) {
      if (id !== requestId) return;
      gridEl.innerHTML = errorHtml();
      wireRetry();
      return;
    }
    if (id !== requestId) return;
    renderSlots(computeSlotsForDate(dateStr, minutes, bookings));
  }

  async function load() {
    const id = ++requestId;
    byDate = null;
    loading = true;
    gridEl.innerHTML = skeletonHtml();
    showEmpty(false);
    let bookings;
    try {
      bookings = await fetchBookingsForRange(opts.supabaseUrl, opts.anonKey, windowStart, DAYS_AHEAD_SHOWN);
    } catch (e) {
      if (id !== requestId) return;
      loading = false;
      // Back to a plain strip: every day tappable, each tap fetching
      // just that day.
      dateRowEl.querySelectorAll('.date-btn .avail').forEach(function (a) { a.remove(); });
      gridEl.innerHTML = errorHtml();
      wireRetry();
      return;
    }
    if (id !== requestId) return;
    loading = false;
    byDate = computeSlotsByDate(windowStart, DAYS_AHEAD_SHOWN, minutes, bookings);
    applyLabels();
    const target = firstBookableDate(byDate, selectedDate);
    if (!target) {
      selectedDate = null;
      markSelected(null);
      showEmpty(false);
      gridEl.innerHTML = '<p class="booking-picker-msg">Nothing open online in the next two weeks. <a href="tel:+14354141667">Call</a> or <a href="sms:+14354141667">text</a> us and we\'ll find you a time.</p>';
      return;
    }
    selectDay(target);
    const selectedBtn = dateRowEl.querySelector('.date-btn.is-selected');
    if (selectedBtn && typeof selectedBtn.scrollIntoView === 'function') {
      try { selectedBtn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); } catch (e) { /* older browsers */ }
    }
  }

  function reload() {
    windowStart = todayDateStrInBusinessTz();
    selectedDate = null;
    onClear();
    renderStrip();
    return load();
  }

  function destroy() {
    ++requestId; // every load/fetch still in flight is now stale
    loading = false;
  }

  const api = { reload: reload, destroy: destroy };
  dateRowEl._bookingPicker = api;
  reload();
  return api;
}

// ---------- add to calendar ----------
// A calendar file is the one reminder channel that needs no account, no
// app and no email: once it's on the phone's own calendar, the phone
// reminds them. Mirrors portal-app.js's proven portalBuildVisitIcs()
// (RFC 5545 TEXT escaping and 75-octet line folding), plus a day-before
// alarm alongside the 2-hour one, and the manage link when there is one.
function bookingIcsEscape(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function bookingIcsFold(line) {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length) {
    parts.push(' ' + rest.slice(0, 72));
    rest = rest.slice(72);
  }
  return parts.join('\r\n');
}

function bookingIcsUtc(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const BOOKING_SITE_ORIGIN = 'https://www.triplehenterprisesllc.biz';

// visit: { uid, title, start, end, address?, manageUrl? } where
// manageUrl is a site-relative path like /manage-booking.html?token=...
function bookingBuildIcs(visit, now) {
  const start = new Date(visit.start);
  const end = visit.end ? new Date(visit.end) : new Date(start.getTime() + 120 * 60 * 1000);
  const descParts = ['Questions, or running late? Call or text Triple H at (435) 414-1667.'];
  if (visit.manageUrl) descParts.push('Reschedule or cancel: ' + BOOKING_SITE_ORIGIN + visit.manageUrl);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Triple H Enterprises//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + bookingIcsEscape(visit.uid || ('th-visit-' + bookingIcsUtc(start))) + '@triplehenterprisesllc.biz',
    'DTSTAMP:' + bookingIcsUtc(now || new Date()),
    'DTSTART:' + bookingIcsUtc(start),
    'DTEND:' + bookingIcsUtc(end),
    'SUMMARY:' + bookingIcsEscape('Triple H Enterprises: ' + (visit.title || 'Service visit')),
    visit.address ? 'LOCATION:' + bookingIcsEscape(visit.address) : '',
    'DESCRIPTION:' + bookingIcsEscape(descParts.join('\n')),
    visit.manageUrl ? 'URL:' + BOOKING_SITE_ORIGIN + visit.manageUrl : '',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + bookingIcsEscape('Triple H visit tomorrow'),
    'TRIGGER:-P1D',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + bookingIcsEscape('Triple H visit in 2 hours'),
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(bookingIcsFold).join('\r\n') + '\r\n';
}

function bookingDownloadIcs(visit) {
  const blob = new Blob([bookingBuildIcs(visit)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Triple-H-' + String(visit.title || 'appointment').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) + '.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
}

// Google Calendar's documented "TEMPLATE" link -- opens a pre-filled new
// event for anyone on Android/Gmail who'd rather not deal with a file.
function bookingGoogleCalendarUrl(visit) {
  const start = new Date(visit.start);
  const end = visit.end ? new Date(visit.end) : new Date(start.getTime() + 120 * 60 * 1000);
  const details = ['Questions, or running late? Call or text Triple H at (435) 414-1667.'];
  if (visit.manageUrl) details.push('Reschedule or cancel: ' + BOOKING_SITE_ORIGIN + visit.manageUrl);
  const params = [
    'action=TEMPLATE',
    'text=' + encodeURIComponent('Triple H Enterprises: ' + (visit.title || 'Service visit')),
    'dates=' + bookingIcsUtc(start) + '/' + bookingIcsUtc(end),
    'details=' + encodeURIComponent(details.join('\n')),
  ];
  if (visit.address) params.push('location=' + encodeURIComponent(visit.address));
  return 'https://calendar.google.com/calendar/render?' + params.join('&');
}

// ---------- the "you're booked" moment ----------
// A short burst of brand-colored flecks out of an element (the success
// checkmark), for the one moment on the site that deserves it. Uses the
// Web Animations API so there's no stylesheet dependency; does nothing
// at all for visitors who asked for reduced motion, or in a browser
// without element.animate. Every fleck removes itself when done.
function bookingCelebrate(anchorEl) {
  try {
    if (!anchorEl || typeof anchorEl.animate !== 'function') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = anchorEl.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;
    const colors = ['#ff8000', '#ffb347', '#3ad66b', '#ffffff', '#c96400'];
    const layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:95;';
    document.body.appendChild(layer);
    const COUNT = 28;
    let remaining = COUNT;
    for (let i = 0; i < COUNT; i++) {
      const fleck = document.createElement('span');
      const size = 5 + Math.random() * 5;
      const isDot = i % 3 === 0;
      fleck.style.cssText = 'position:absolute;left:' + originX + 'px;top:' + originY + 'px;width:' + size + 'px;height:' + (isDot ? size : size * 0.45) + 'px;' +
        'background:' + colors[i % colors.length] + ';border-radius:' + (isDot ? '50%' : '1px') + ';will-change:transform,opacity;';
      layer.appendChild(fleck);
      const angle = (Math.PI * 2 * i) / COUNT + (Math.random() - 0.5) * 0.5;
      const distance = 70 + Math.random() * 90;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance - 30;
      const spin = (Math.random() - 0.5) * 720;
      const anim = fleck.animate([
        { transform: 'translate(-50%,-50%) scale(0.4) rotate(0deg)', opacity: 1 },
        { transform: 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(1) rotate(' + (spin / 2) + 'deg)', opacity: 1, offset: 0.55 },
        { transform: 'translate(calc(-50% + ' + (dx * 1.15) + 'px), calc(-50% + ' + (dy + 90) + 'px)) scale(0.8) rotate(' + spin + 'deg)', opacity: 0 },
      ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
      anim.onfinish = function () {
        fleck.remove();
        remaining--;
        if (remaining === 0) layer.remove();
      };
    }
    // Safety net: never leave the layer behind even if an animation
    // never reports finishing (a backgrounded tab, for instance).
    setTimeout(function () { if (layer.parentNode) layer.remove(); }, 3000);
  } catch (e) {
    /* a celebration is never worth breaking the confirmation over */
  }
}

// A tiny, supported-devices-only tap of haptic feedback at the moment of
// confirmation. navigator.vibrate is a no-op or absent on iOS and desktop.
function bookingHaptic() {
  try {
    if (navigator.vibrate && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      navigator.vibrate([12, 40, 18]);
    }
  } catch (e) { /* ignore */ }
}
