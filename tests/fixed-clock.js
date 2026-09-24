// A pinned clock for tests whose answers depend on the day or the time of
// day (2026-09-24). CI runs in UTC at whatever hour someone pushes. The
// shift week card's test, for one, started a shift "2 hours ago" and then
// expected Monday to hold only an earlier, finished shift: true on any
// day but Monday (UTC), when the open shift lands on Monday too, from
// about 8 PM Sunday to 8 PM Monday Mountain time.
//
// install() makes this test process's Date read a fixed moment, still
// ticking, so the test's own Date.now() / new Date() and the page code it
// runs agree on it. Dates built from explicit arguments are untouched, and
// elapsed-time waits still measure real time. Each test file runs in its
// own process (--test-concurrency=1), so this only affects the file that
// installs it. A jsdom window has its own Date, which this doesn't reach.
//
// For time-of-day-only problems, tests/tools/shift-clock-shell.test.js
// uses a fixed-offset TZ instead (#404); that can't fix the day of week.

// Thursday 2026-10-01, 9:00 AM in St. George (MDT, UTC-6): mid-week, a
// weekday morning, clear of DST and of midnight in both UTC and Mountain
// time. Booking hours that day are 2-10 PM, so every slot is still ahead.
const WEEKDAY_MORNING = '2026-10-01T15:00:00Z';

let installed = false;

function install(at = WEEKDAY_MORNING) {
  if (installed) throw new Error('fixed-clock: install() once per test file');
  installed = true;
  const RealDate = Date;
  const offset = Date.parse(at) - RealDate.now();
  global.Date = class PinnedDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(RealDate.now() + offset);
    }
    static now() { return RealDate.now() + offset; }
  };
}

module.exports = { install, WEEKDAY_MORNING };
