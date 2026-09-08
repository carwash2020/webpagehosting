// U04/W17 fix (High-Impact Upgrades, Master Audit, 2026-09-08):
// business-hours.js's findNextAvailableSlot() is the one function
// behind the homepage's "next opening" line -- walks forward day by
// day using the exact same fetchBookingsForDate/computeSlotsForDate
// booking.html's own real flow uses, so it can never promise a slot
// the real booking page wouldn't also offer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'business-hours.js'), 'utf8');

function makeContext({ fetchImpl, now }) {
  const ctx = {
    console,
    fetch: fetchImpl,
    Date: now ? makeFixedDate(now) : Date,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

function makeFixedDate(isoNow) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(isoNow);
      return new RealDate(...args);
    }
    static now() { return new RealDate(isoNow).getTime(); }
  }
  return FixedDate;
}

test('finds the very first slot when nothing else is booked that day', async () => {
  // A Tuesday, 2026-09-08, hours 14-22 per HOURS_BY_WEEKDAY[2] -- fixed
  // "now" well before opening so the earliest slot is the day's own open.
  const ctx = makeContext({ now: '2026-09-08T10:00:00-06:00', fetchImpl: async () => ({ ok: true, json: async () => [] }) });
  const result = await ctx.findNextAvailableSlot('https://example.supabase.co', 'anon-key', 45);
  assert.ok(result, 'expected a slot to be found');
  assert.equal(result.dateStr, '2026-09-08');
  assert.equal(result.slot.label, '2:00 PM');
});

test('skips a fully-booked day and finds the next one that actually has room', async () => {
  const ctx = makeContext({
    now: '2026-09-08T10:00:00-06:00',
    fetchImpl: async (url, opts) => {
      const body = JSON.parse(opts.body);
      const dayOfRequest = body.p_range_start.slice(0, 10);
      // The first day this function will check is 2026-09-08 itself
      // (fetchBookingsForDate queries a 1-day-before window, so its
      // request's own p_range_start lands on 2026-09-07) -- return one
      // giant booking spanning the whole business day for 09-08, and
      // nothing for any other day.
      if (dayOfRequest === '2026-09-07') {
        return { ok: true, json: async () => ([{ start_at: '2026-09-08T20:00:00Z', end_at: '2026-09-09T04:00:00Z' }]) };
      }
      return { ok: true, json: async () => [] };
    },
  });
  const result = await ctx.findNextAvailableSlot('https://example.supabase.co', 'anon-key', 45);
  assert.ok(result);
  assert.notEqual(result.dateStr, '2026-09-08', 'the fully-booked day should have been skipped');
});

test('returns null (never a broken promise) when nothing opens up within the search horizon', async () => {
  const ctx = makeContext({ now: '2026-09-08T10:00:00-06:00', fetchImpl: async () => { throw new Error('network down'); } });
  const result = await ctx.findNextAvailableSlot('https://example.supabase.co', 'anon-key', 45, 3);
  assert.equal(result, null);
});

test('one failed day\'s lookup does not stop the search from checking the next day', async () => {
  let calls = 0;
  const ctx = makeContext({
    now: '2026-09-08T10:00:00-06:00',
    fetchImpl: async () => {
      calls++;
      if (calls === 1) throw new Error('transient failure on the first day checked');
      return { ok: true, json: async () => [] };
    },
  });
  const result = await ctx.findNextAvailableSlot('https://example.supabase.co', 'anon-key', 45);
  assert.ok(result, 'expected the search to recover and find a slot on a later day');
  assert.ok(calls >= 2, 'expected more than one day to have been checked');
});
