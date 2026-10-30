// Shared by shoot.js and verify.js (PR #543 review round 3). Dev-only.
//
// Lets the stubbed pages reach a *healthy* sync state through their own
// code, so the header dot can be checked green rather than only "not red":
//   1. supabase-js is served from a local copy of the exact version the
//      pages pin (the CDN is blocked here). Same file, so the page's SRI
//      hash still has to match. Get it with:
//        npm pack @supabase/supabase-js@2.112.3 && tar xzf supabase-supabase-js-2.112.3.tgz
//      and pass SUPABASE_UMD=/path/to/package/dist/umd/supabase.js
//   2. The Realtime websocket is answered locally: every channel join gets
//      an "ok" reply echoing its postgres_changes bindings (with ids), and
//      heartbeats get "ok". That's what a real server sends, so the page's
//      own subscribe callback reports SUBSCRIBED and the dot goes green.
// Without SUPABASE_UMD this does nothing and the dot is grey (no live
// updates), which is the honest state for a page that can't connect.
const fs = require('fs');

const UMD = process.env.SUPABASE_UMD;

async function installLiveStub(ctx) {
  if (!UMD) return false;
  const body = fs.readFileSync(UMD);
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.112\.3\/dist\/umd\/supabase\.js/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body, headers: { 'access-control-allow-origin': '*' } }));
  if (typeof ctx.routeWebSocket !== 'function') return true;
  await ctx.routeWebSocket(/supabase\.co\/realtime/, (ws) => {
    ws.onMessage((raw) => {
      let m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
      // realtime-js speaks Phoenix vsn 1 (objects) or 2 (arrays).
      const arr = Array.isArray(m);
      const msg = arr ? { join_ref: m[0], ref: m[1], topic: m[2], event: m[3], payload: m[4] } : m;
      const reply = (payload) => {
        const out = { join_ref: msg.join_ref, ref: msg.ref, topic: msg.topic, event: 'phx_reply', payload };
        ws.send(JSON.stringify(arr ? [out.join_ref, out.ref, out.topic, out.event, out.payload] : out));
      };
      if (msg.event === 'phx_join') {
        const pc = ((msg.payload && msg.payload.config && msg.payload.config.postgres_changes) || []).map((b, i) => Object.assign({ id: 1000 + i }, b));
        reply({ status: 'ok', response: { postgres_changes: pc } });
      } else if (msg.event === 'heartbeat' || msg.event === 'access_token' || msg.event === 'phx_leave') {
        reply({ status: 'ok', response: {} });
      }
    });
  });
  return true;
}

module.exports = { installLiveStub };
