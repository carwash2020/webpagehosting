// Supabase Edge Function: resend-webhook
//
// Receives Resend's own delivery webhook events (email.sent,
// email.delivered, email.bounced, email.complained, email.opened) and
// records the guest-facing booking confirmation's delivery status onto
// th_bookings, matched by resend_message_id (set by
// send-booking-email-index.ts right after it first sends that email).
// Added alongside the delivery-tracking columns
// (add_booking_email_delivery_tracking.sql, 2026-10-20) -- before
// this, knowing whether a customer actually got (or opened, or
// bounced) their confirmation meant asking them.
//
// Deployed with verify_jwt: false -- Resend can't send a Supabase JWT,
// so the ONLY thing authenticating an incoming request here is the
// Svix signature Resend signs every webhook payload with, verified
// below. Same reasoning as stripe-webhook-index.ts's own header
// comment: the raw body is read with .text() before any JSON parsing
// -- signature verification needs the exact original bytes Resend
// sent, and parsing then re-serializing JSON can subtly change them
// enough to break verification.
//
// Resend delivers webhooks via Svix (not a bespoke signing scheme) --
// see https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests.
// signature = base64(HMAC-SHA256(secret_bytes, "{svix-id}.{svix-timestamp}.{raw_body}")),
// where secret_bytes = base64-decode(the whsec_... secret with that
// prefix stripped). The svix-signature header can carry multiple
// space-separated "v1,<sig>" entries (for secret rotation) -- a match
// against any one of them is enough.
//
// Required secret (Supabase dashboard -> Edge Functions -> Secrets):
//   RESEND_WEBHOOK_SIGNING_SECRET -- shown once when the webhook
//   endpoint is registered in the Resend dashboard (Webhooks -> Add
//   endpoint, pointing at this function's own URL). This is a
//   SEPARATE secret from RESEND_API_KEY, the same way Stripe's webhook
//   signing secret is separate from its API key.
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided by Supabase.)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SIGNING_SECRET") || "";

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

async function verifySvixSignature(svixId: string, svixTimestamp: string, rawBody: string, svixSignatureHeader: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) {
    console.error("verifySvixSignature: RESEND_WEBHOOK_SIGNING_SECRET is not set");
    return false;
  }
  const secretB64 = WEBHOOK_SECRET.startsWith("whsec_") ? WEBHOOK_SECRET.slice("whsec_".length) : WEBHOOK_SECRET;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(secretB64);
  } catch (err: any) {
    console.error("verifySvixSignature: could not base64-decode the signing secret:", err.message);
    return false;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expected = bytesToBase64(mac);
  // svix-signature looks like "v1,<base64> v1,<base64>" (space-separated,
  // multiple entries during a secret rotation) -- any match is enough.
  const candidates = svixSignatureHeader.split(" ").map((part) => part.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const [, sig] = candidate.split(",");
    if (sig && sig === expected) return true;
  }
  return false;
}

async function updateBookingDeliveryStatus(messageId: string, status: string): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/th_bookings?resend_message_id=eq.${encodeURIComponent(messageId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ email_delivery_status: status, email_delivery_updated_at: new Date().toISOString() }),
    },
  );
  if (!res.ok) {
    console.error("updateBookingDeliveryStatus: PATCH failed:", res.status, await res.text());
  }
}

// Resend's webhook event "type" strings -> the single-word status this
// function stores. Only events relevant to a guest's own confirmation
// are tracked; anything else (e.g. email.delivery_delayed) is
// acknowledged but ignored below.
const EVENT_TO_STATUS: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

Deno.serve(async (req: Request) => {
  try {
    const svixId = req.headers.get("svix-id") || "";
    const svixTimestamp = req.headers.get("svix-timestamp") || "";
    const svixSignature = req.headers.get("svix-signature") || "";
    const rawBody = await req.text();

    if (!svixId || !svixTimestamp || !svixSignature) {
      return new Response(JSON.stringify({ ok: false, error: "Missing Svix headers" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const valid = await verifySvixSignature(svixId, svixTimestamp, rawBody, svixSignature);
    if (!valid) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody);
    const status = EVENT_TO_STATUS[payload?.type];
    const messageId = payload?.data?.email_id;

    if (!status || typeof messageId !== "string" || !messageId) {
      // Not an event this function tracks (or malformed) -- acknowledge
      // anyway so Resend doesn't keep retrying a webhook we'll never act on.
      return new Response(JSON.stringify({ ok: true, skipped: true }), { headers: { "Content-Type": "application/json" } });
    }

    await updateBookingDeliveryStatus(messageId, status);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("resend-webhook error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
