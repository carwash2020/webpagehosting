// booking-flow.js -- shared helpers for the public booking pages
// (booking.html, manage-booking.html), added 2026-09-22 in the
// booking-flow pass. Loaded AFTER /js/business-hours.js, whose globals
// (zonedTimeToUtc, addDaysToDateStr, businessWeekday, HOURS_BY_WEEKDAY,
// computeSlotsForDate, BUSINESS_TIMEZONE) everything here builds on.
//
// Deliberately a separate file rather than more code in
// business-hours.js: that file is also loaded by tools/workspace.html
// and precached by the portal's service worker, so touching it would
// ripple a version bump into both. These helpers only matter to the
// pages that book or move an appointment.
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
// "Full" for a day nobody could ever book.
function computeSlotsByDate(startDateStr, days, durationMinutes, bookings) {
  const byDate = {};
  for (let i = 0; i < days; i++) {
    const dateStr = addDaysToDateStr(startDateStr, i);
    byDate[dateStr] = {
      slots: computeSlotsForDate(dateStr, durationMinutes, bookings),
      closed: !HOURS_BY_WEEKDAY[businessWeekday(dateStr)],
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

// Short label under each day in the strip: "3 open", "Full", "Closed".
function bookingDayLabel(entry) {
  if (!entry) return '';
  if (entry.closed) return 'Closed';
  const n = entry.slots.length;
  return n ? n + ' open' : 'Full';
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
