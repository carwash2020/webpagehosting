/* triage.js -- the "Is it worth fixing?" symptom tool, shared by the
   homepage and the 5 city landing pages.

   Moved verbatim out of index.html so the landing pages can carry it too:
   they are the pages people actually land on from a search like "dryer
   not heating st george", which is exactly the moment this tool is
   useful. Nothing in the logic changed in the move.

   The content is qualitative on purpose -- what a symptom COMMONLY
   indicates -- with no prices, no percentages and no invented statistics,
   and every path ends at an explicit caveat that the machine has to be
   looked at. The dryer entries match what the blog already says publicly.

   Self-contained and side-effect free: it does nothing at all unless the
   page contains #triageAppliances, so it is safe to load anywhere. */
// ---------- symptom triage ----------
  // Qualitative on purpose: what a symptom COMMONLY indicates. No prices,
  // no percentages, no invented statistics, and every path ends at "we'd
  // have to look at it." The dryer entries match what this site's own blog
  // already says publicly.
  (function () {
    const DATA = {
      washer: { label: 'Washer', symptoms: [
        { q: "Won't drain", v: 'Usually a blockage, not a dead machine',
          a: "A washer that fills and washes but won't drain is most often a clogged pump filter or a blocked drain hose, and very often there's something small lodged where it shouldn't be. This is frequently sorted in a single visit." },
        { q: "Won't spin", v: 'Commonly a belt or a switch',
          a: "No spin usually points to a worn drive belt, a failed lid or door switch, or a load the machine has decided is too unbalanced to spin. These are parts, not a reason to replace the machine." },
        { q: 'Leaking water', v: 'Worth looking at quickly',
          a: "Leaks are most often a door seal, a hose connection, or the pump. Whatever the cause, this is the one to move fast on, because water damage costs far more than the repair does." },
        { q: 'No power at all', v: 'Often smaller than it looks',
          a: "A washer that seems completely dead is frequently a door latch or lid switch rather than the machine itself. Worth checking before assuming the worst." } ] },
      dryer: { label: 'Dryer', symptoms: [
        { q: "Runs but won't heat", v: 'Very often an inexpensive part',
          a: "This is usually the thermal fuse, a one-time-use part that blows when airflow gets restricted. Replacing it is straightforward, but the real job is finding why it blew, because a fuse that blew once will blow again if the airflow problem is still there." },
        { q: 'Takes forever to dry', v: 'Usually airflow, not parts',
          a: "Long dry times almost always mean restricted airflow: a clogged vent line, lint buildup, or a crushed duct behind the machine. This is frequently a cleaning problem rather than a broken dryer." },
        { q: 'Loud thumping or grinding', v: 'Catch it early',
          a: "Noise like that typically means drum rollers, the idler pulley, or something trapped inside the drum grinding against it. Worth catching early, since running it noisy tends to turn a small repair into a bigger one." },
        { q: "Won't turn on", v: 'Commonly a switch or a fuse',
          a: "A dryer that won't start is often the door switch, the thermal fuse, or the start switch. All standard parts." } ] },
      dishwasher: { label: 'Dishwasher', symptoms: [
        { q: 'Not draining', v: 'Usually a clog',
          a: "Standing water at the bottom is most often the drain filter, the drain hose, or the pump. This one frequently clears in a single visit." },
        { q: 'Not cleaning well', v: 'Often not broken at all',
          a: "Poor cleaning commonly comes down to clogged spray arms, a worn seal, or water that isn't getting hot enough. Quite often there's nothing mechanically wrong with the machine." },
        { q: 'Leaking', v: 'Most often a seal',
          a: "Dishwasher leaks are usually the door gasket or a hose fitting. Worth handling promptly given where the water goes." },
        { q: "Won't start", v: 'Commonly the latch',
          a: "Often the door latch switch, which the machine uses to confirm the door is properly shut, or the control panel." } ] },
      refrigerator: { label: 'Refrigerator', symptoms: [
        { q: 'Not cooling', v: 'Sometimes just cleaning',
          a: "This is commonly a frosted-over evaporator, a failed defrost component, or condenser coils packed with dust. Coils are sometimes purely a cleaning job." },
        { q: "Freezer works, fridge doesn't", v: 'Usually airflow between the two',
          a: "When the freezer is fine but the fridge isn't, it's typically airflow between the compartments: a blocked vent, a failed damper, or the circulating fan." },
        { q: 'Leaking water inside', v: 'Often a simple drain clog',
          a: "Water pooling inside is frequently a clogged defrost drain, which is one of the more common and less expensive things to put right." },
        { q: 'Ice maker not working', v: 'Usually the valve or the module',
          a: "Commonly the water inlet valve, the fill line, or the ice maker module itself." } ] },
      range: { label: 'Range / Oven', symptoms: [
        { q: "Oven won't heat", v: 'A standard part either way',
          a: "On an electric oven this is usually the bake element; on gas, it's often the igniter. Both are normal replacement parts." },
        { q: "Burner won't light", v: 'Typically the igniter',
          a: "Usually the igniter or a burner port that's clogged and needs clearing." },
        { q: 'Temperature is way off', v: 'Often just the sensor',
          a: "Baking that comes out consistently wrong is frequently the oven temperature sensor. Worth ruling out before anything larger gets replaced." },
        { q: "Won't turn on", v: 'Power or control board',
          a: "Frequently the power supply to the unit, or the control board." } ] }
    };

    // U02 fix (High-Impact Upgrades, 2026-09-08): exposed so the
    // symptom-first entry grid below can build its buttons FROM this
    // one source of truth, rather than a second, driftable copy of
    // the same 20 symptom labels.
    window.TRIAGE_DATA = DATA;

    // Design feedback (2026-09-08): the 5 appliance rows read as a flat,
    // undifferentiated list of text bars. One small line icon per
    // appliance, same stroke style as every other icon on the site
    // (24x24, stroke-width 2, round caps), gives each row something to
    // actually scan instead of reading five identical rows top to bottom.
    const APPLIANCE_ICONS = {
      washer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="7" y1="6" x2="9" y2="6"/><circle cx="12" cy="14" r="5"/><circle cx="12" cy="14" r="1.8"/></svg>',
      dryer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="7" y1="6" x2="9" y2="6"/><circle cx="12" cy="14" r="5"/><path d="M9.8 14c0-1.2 1.2-1.2 1.2-2.4S9.8 10.4 9.8 9.2M14.2 14c0-1.2 1.2-1.2 1.2-2.4s-1.2-1.2-1.2-2.4"/></svg>',
      dishwasher: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="8" x2="21" y2="8"/><line x1="8" y1="12" x2="8" y2="19"/><line x1="12" y1="12" x2="12" y2="19"/><line x1="16" y1="12" x2="16" y2="19"/></svg>',
      refrigerator: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="5" y1="9" x2="19" y2="9"/><line x1="15" y1="4" x2="15" y2="6.5"/><line x1="15" y1="11" x2="15" y2="14"/></svg>',
      range: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="7.5" r="1"/><circle cx="16" cy="7.5" r="1"/><circle cx="8" cy="11.5" r="1"/><circle cx="16" cy="11.5" r="1"/><rect x="6" y="14" width="12" height="6" rx="1"/></svg>',
    };

    const appEl = document.getElementById('triageAppliances');
    const symStep = document.getElementById('triageSymptomStep');
    const symEl = document.getElementById('triageSymptoms');
    const result = document.getElementById('triageResult');
    const verdict = document.getElementById('triageVerdict');
    const body = document.getElementById('triageBody');
    if (!appEl || !symEl || !result) return;

    function chip(text, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'triage-chip';
      b.textContent = text;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', onClick);
      return b;
    }

    function clearPressed(scope) {
      scope.querySelectorAll('.triage-chip').forEach(function (b) {
        b.setAttribute('aria-pressed', 'false');
      });
    }

    // Pulled out of the per-appliance click handler below (2026-09-08,
    // U02) so the symptom-first entry grid can show a result directly,
    // without needing to simulate two clicks through the step-by-step
    // picker to get the exact same effect.
    function showSymptomResult(s) {
      verdict.textContent = s.v;
      body.textContent = s.a;
      result.hidden = false;
    }

    function selectAppliance(key, applianceBtn) {
      clearPressed(appEl);
      if (applianceBtn) applianceBtn.setAttribute('aria-pressed', 'true');
      symEl.innerHTML = '';
      DATA[key].symptoms.forEach(function (s) {
        symEl.appendChild(chip(s.q, function () {
          clearPressed(symEl);
          this.setAttribute('aria-pressed', 'true');
          showSymptomResult(s);
        }));
      });
      symStep.hidden = false;
    }

    const applianceButtons = {};
    Object.keys(DATA).forEach(function (key) {
      const btn = chip(DATA[key].label, function () {
        selectAppliance(key, btn);
        result.hidden = true;
      });
      applianceButtons[key] = btn;
      appEl.appendChild(btn);
    });

    // U02 fix (High-Impact Upgrades, 2026-09-08): "Customers do not
    // arrive thinking 'appliance repair'; they arrive thinking 'it
    // won't drain'." A flat grid of the same 20 symptoms already above,
    // in the customer's own words, as the real entry point -- each one
    // jumps straight to its result. The step-by-step appliance picker
    // above stays exactly as it was, for anyone who'd rather browse by
    // appliance first; this doesn't touch or duplicate its logic, only
    // drives it programmatically to land on the same result a manual
    // two-click path would reach.
    // Regression-recovery fix (2026-09-08): 20 flat cards in one grid
    // alone accounted for +336px of this section's growth during the
    // improvement session (measured directly, 490px -> 826px, +69%).
    // Grouped into 5 collapsible rows, one per appliance, closed by
    // default -- the same zero-JS-needed <details> disclosure already
    // used for the appliance-first picker below. Every card, its click
    // handler, and its content are otherwise unchanged.
    const gridEl = document.getElementById('triageSymptomGrid');
    if (gridEl) {
      Object.keys(DATA).forEach(function (key) {
        const row = document.createElement('details');
        row.className = 'triage-appliance-row';
        const summary = document.createElement('summary');
        const heading = document.createElement('span');
        heading.className = 'triage-appliance-heading';
        heading.innerHTML = '<span class="triage-appliance-icon">' + APPLIANCE_ICONS[key] + '</span><span>' + DATA[key].label + '</span>';
        summary.appendChild(heading);
        row.appendChild(summary);
        const rowCards = document.createElement('div');
        rowCards.className = 'triage-symptom-row-cards';
        DATA[key].symptoms.forEach(function (s) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'triage-symptom-card';
          btn.innerHTML = '<span class="triage-symptom-card-q">' + s.q + '</span>';
          btn.addEventListener('click', function () {
            selectAppliance(key, applianceButtons[key]);
            const symBtn = Array.prototype.find.call(symEl.querySelectorAll('.triage-chip'), function (b) { return b.textContent === s.q; });
            clearPressed(symEl);
            if (symBtn) symBtn.setAttribute('aria-pressed', 'true');
            showSymptomResult(s);
            result.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          rowCards.appendChild(btn);
        });
        row.appendChild(rowCards);
        gridEl.appendChild(row);
      });
    }
  })();

  // ---------- live open / closed ----------
  // Reads the same HOURS_BY_WEEKDAY table booking.html uses via
  // business-hours.js, so this pill can never contradict the booking page.
  // Stays hidden entirely unless that table is actually available.
  //
  // W20/M04 fix (Master Audit, 2026-09-08): generalized from a single
  // getElementById lookup to every .open-status on the page, so the new
  // closing section (see index.html) can show the exact same live status
  // as the hero, computed once and applied everywhere -- not a second,
  // driftable copy of this logic.
  (function () {
    const pills = document.querySelectorAll('.open-status');
    if (!pills.length) return;
    if (typeof HOURS_BY_WEEKDAY === 'undefined'
        || typeof businessWeekday !== 'function'
        || typeof todayDateStrInBusinessTz !== 'function'
        || typeof BUSINESS_TIMEZONE === 'undefined') return;

    function label(h) {
      const hour = h % 12 === 0 ? 12 : h % 12;
      return hour + (h < 12 ? ' AM' : ' PM');
    }

    try {
      const today = todayDateStrInBusinessTz();
      const weekday = businessWeekday(today);
      const span = HOURS_BY_WEEKDAY[weekday];
      if (!span) return;

      // Current hour in BUSINESS time, not the visitor's own timezone.
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: BUSINESS_TIMEZONE, hour: 'numeric', hour12: false
      }).formatToParts(new Date());
      const hourPart = parts.find(function (p) { return p.type === 'hour'; });
      if (!hourPart) return;
      const hour = parseInt(hourPart.value, 10);
      if (isNaN(hour)) return;

      let statusClass, html;
      if (hour >= span[0] && hour < span[1]) {
        statusClass = 'is-open';
        html = '<b>Open now</b> &middot; until ' + label(span[1]);
      } else if (hour < span[0]) {
        statusClass = 'is-closed';
        html = '<b>Closed right now</b> &middot; open today at ' + label(span[0])
          + ' &middot; <a href="/booking.html">Book online</a>';
      } else {
        statusClass = 'is-closed';
        const next = HOURS_BY_WEEKDAY[(weekday + 1) % 7];
        html = (next
          ? '<b>Closed right now</b> &middot; open tomorrow at ' + label(next[0])
          : '<b>Closed right now</b>')
          + ' &middot; <a href="/booking.html">Book online</a>';
      }

      pills.forEach(function (pill) {
        const text = pill.querySelector('.open-status-text');
        if (!text) return;
        pill.classList.add(statusClass);
        text.innerHTML = html;
        pill.hidden = false;
      });
    } catch (e) {
      /* A status pill is never worth breaking the hero over. */
    }
  })();

  // ---------- next real opening (U04, High-Impact Upgrades, 2026-09-08) ----------
  // "A site that says 'next opening Thursday 9:00 AM' feels staffed and
  // organised in a way almost no trade site does." Reads the real next
  // free slot from the same th_bookings availability logic booking.html
  // itself uses (business-hours.js's findNextAvailableSlot), rather than
  // the pill's own static hours-only guess above, which doesn't know
  // about existing bookings. Entirely separate from and additive to the
  // pill -- if this lookup is slow, unavailable, or fails, nothing here
  // ever appears and the pill above stands exactly as it already did.
  //
  // W20/M04 fix (2026-09-08): generalized the same way as the pill above
  // -- every .next-opening on the page gets the same result from one
  // shared lookup, so the closing section's own line never needs (or
  // risks drifting from) a second fetch.
  (function () {
    const els = document.querySelectorAll('.next-opening');
    if (!els.length) return;
    if (typeof findNextAvailableSlot !== 'function') return;

    const SUPABASE_URL = 'https://csvfqdjuobylgafgolho.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNzdmZxZGp1b2J5bGdhZmdvbGhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUzNTQ3MjcsImV4cCI6MjEwMDkzMDcyN30.6GlvK-DfXf2lppS1kciZtsl4wHOpZz_yKtwsS1lyjrs';
    // Inspection is the shortest service (45 min) -- using it here finds
    // the earliest slot that could fit ANY visit, not just a specific
    // service the visitor hasn't chosen yet.
    const NEXT_OPENING_DURATION_MINUTES = 45;
    const NEXT_OPENING_SERVICE_KEY = 'inspection';

    findNextAvailableSlot(SUPABASE_URL, SUPABASE_ANON_KEY, NEXT_OPENING_DURATION_MINUTES).then(function (result) {
      if (!result) return;
      const dateLabel = new Intl.DateTimeFormat('en-US', {
        timeZone: BUSINESS_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric',
      }).format(result.slot.startUtc);
      const html = 'Next opening: <b>' + dateLabel + ' at ' + result.slot.label + '</b> &middot; ' +
        '<a href="/booking.html?service=' + NEXT_OPENING_SERVICE_KEY + '&date=' + result.dateStr + '">Book this slot</a>';
      els.forEach(function (el) {
        el.innerHTML = html;
        el.hidden = false;
      });
    }).catch(function () {
      /* Fails silently to the pill above, exactly as this feature's own spec says. */
    });
  })();
