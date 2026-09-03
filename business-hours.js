// business-hours.js -- single source of truth for Triple H
// Enterprises' actual business hours and the timezone-safe date math
// built around them (2026-09-03).
//
// Extracted from booking.html, which used to keep its own private
// copy of this exact table and these exact helper functions.
// Requested directly: "change the 'when would be best' part of the
// bookings to just match our actual bookings page... follows business
// hours," plus "think of... other ways we can connect all 3 together
// even more." A client-facing day-picker on the portal's Request Work
// form needs the SAME real hours booking.html uses -- keeping two
// separate copies would drift the moment hours change in one place
// and not the other, silently showing a client a "possible" day the
// public booking page would never actually offer. One file, loaded by
// both, makes that class of drift structurally impossible rather than
// something to remember to keep in sync by hand.
//
// Deliberately served from the SITE ROOT, not /tools/ -- these are
// public business facts (the hours are already shown on the site) and
// pure, side-effect-free date math with no auth, no Supabase, no sync
// dependency. Loading it from portal/work-orders.html does not cross
// the portal's real isolation boundary (no internal /tools/ scripts),
// since this file isn't one.
//
// No exports/module system -- matches how every other shared script
// in this project works: loaded via a plain <script src> tag, and
// everything here becomes a plain global for whichever page loaded it.

const BUSINESS_TIMEZONE = 'America/Denver';

// Keyed 0 (Sunday) through 6 (Saturday). Each value is [openHour,
// closeHour] in 24-hour LOCAL business time. Confirmed directly
// against booking.html's own real, live schedule -- not assumed.
const HOURS_BY_WEEKDAY = {
  0: [14, 20], 1: [14, 22], 2: [14, 22], 3: [14, 22], 4: [14, 22], 5: [14, 22], 6: [7, 22],
};

const DAYS_AHEAD_SHOWN = 14;

// --- timezone helpers, identical to booking.html's own (now shared) ---

function zonedTimeToUtc(dateStr, hh, mm) {
  const timeStr = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  const naiveUtc = new Date(dateStr + 'T' + timeStr + ':00Z');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(naiveUtc);
  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  const hourFixed = map.hour === '24' ? '00' : map.hour;
  const asIfLocal = new Date(map.year + '-' + map.month + '-' + map.day + 'T' + hourFixed + ':' + map.minute + ':' + map.second + 'Z');
  const diff = naiveUtc.getTime() - asIfLocal.getTime();
  return new Date(naiveUtc.getTime() + diff);
}

function businessWeekday(dateStr) {
  const noonUtc = zonedTimeToUtc(dateStr, 12, 0);
  const s = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS_TIMEZONE, weekday: 'short' }).format(noonUtc);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(s);
}

function todayDateStrInBusinessTz() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  return map.year + '-' + map.month + '-' + map.day;
}

function addDaysToDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Formats a weekday's open/close hours as a short human label, e.g.
// "7 AM-10 PM". Used by the portal's day-picker to show real hours
// per day, not a generic "business hours apply" disclaimer -- pulled
// out as its own helper since booking.html never needed this exact
// framing (it shows real time SLOTS, not a plain hours label).
function formatHoursLabel(weekday) {
  const hours = HOURS_BY_WEEKDAY[weekday];
  if (!hours) return '';
  const fmt = (h) => {
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ' ' + period;
  };
  return fmt(hours[0]) + '\u2013' + fmt(hours[1]);
}
