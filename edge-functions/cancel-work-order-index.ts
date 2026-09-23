// Supabase Edge Function: cancel-work-order
//
// Lets a client cancel their OWN work-order request, only while it's
// still 'submitted' -- client_portal_work_orders deliberately has no
// client UPDATE or DELETE policy at all (see
// create_client_portal_work_orders.sql's own comment #3, which
// specifically anticipated this: "an explicit status transition
// through an edge function, not a raw delete"). Same shape as
// respond-to-quote: service role does the actual write, this function
// is the only thing standing between a client's request and it.
//
// Only reachable from 'submitted' -- once Steve has started actually
// working a request (reviewing/quoted/scheduled), workspace.html's own
// queue reads an explicit list of "open" statuses that never includes
// 'cancelled', so a cancel past that point would make the request
// silently vanish from his queue with no record of why. Restricting to
// 'submitted' means a cancel can only ever remove something he hasn't
// started on yet.
//
// Tells Steve (2026-09-22). A cancel used to be silent: the request just
// dropped out of his queue, and if he'd already read the new-request
// email he could still be planning to call. Now the cancel also posts a
// message on the request's own thread ("I've cancelled this request in
// the portal." plus the client's optional reason). That insert fires the
// existing on_work_order_message_send_email trigger, so the internal
// team gets the same "New message from <client>" email as any reply --
// no second notification path to maintain -- and the thread keeps a
// record of why. The status write is also conditional on still being
// 'submitted' at the moment of writing, so a cancel racing Steve's own
// status change can't overwrite it.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ORIGIN = "https://www.triplehenterprisesllc.biz";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function decodeJwtPayload(token: string): { email?: string; role?: string } {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const claims = decodeJwtPayload(token);

    // Any real, authenticated session is enough here -- this caller is
    // a CLIENT, not an internal account. The real authorization check
    // is below: does the request being cancelled actually belong to
    // this specific caller.
    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in." }, 401);
    }

    const { work_order_id, reason } = await req.json();
    if (typeof work_order_id !== "number") {
      return json({ ok: false, error: "Missing work_order_id." }, 400);
    }
    const reasonText = typeof reason === "string" ? reason.trim().slice(0, 500) : "";

    const woRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_work_orders?id=eq.${work_order_id}&select=id,client_email,status`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!woRes.ok) {
      return json({ ok: false, error: "Could not look up that request." }, 502);
    }
    const rows = await woRes.json();
    if (!rows.length) {
      return json({ ok: false, error: "Request not found." }, 404);
    }
    const workOrder = rows[0];

    // The real authorization boundary: the request being cancelled
    // must belong to the exact email on the caller's own verified
    // session -- never trust a work_order_id alone to imply the
    // caller is allowed to cancel it.
    if (workOrder.client_email.toLowerCase() !== claims.email.toLowerCase()) {
      return json({ ok: false, error: "That request doesn't belong to this account." }, 403);
    }
    if (workOrder.status !== "submitted") {
      return json({ ok: false, error: "This request is already being worked on -- please call or text us to cancel it." }, 400);
    }

    // status=eq.submitted in the filter, not just the check above: if
    // Steve moves it to reviewing between that read and this write, this
    // updates nothing instead of cancelling work he's started.
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_work_orders?id=eq.${work_order_id}&status=eq.submitted`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() }),
      },
    );
    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return json({ ok: false, error: `Database error: ${errText.slice(0, 300)}` }, 502);
    }
    const updated = await patchRes.json();
    if (!Array.isArray(updated) || !updated.length) {
      return json({ ok: false, error: "This request is already being worked on -- please call or text us to cancel it." }, 409);
    }

    // Best-effort: the cancel itself already succeeded, so a failure here
    // is logged and reported, never turned into an error for the client.
    const message = "I've cancelled this request in the portal." + (reasonText ? `\n\nReason: ${reasonText}` : "");
    let notified = false;
    try {
      const msgRes = await fetch(`${SUPABASE_URL}/rest/v1/client_portal_work_order_messages`, {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          work_order_id,
          sender_type: "client",
          sender_email: workOrder.client_email,
          message,
        }),
      });
      notified = msgRes.ok;
      if (!msgRes.ok) console.error("cancel-work-order: message insert failed", msgRes.status, (await msgRes.text()).slice(0, 300));
    } catch (err: any) {
      console.error("cancel-work-order: message insert error", err.message);
    }

    return json({ ok: true, notified });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
