// Supabase Edge Function: uptime-alert
//
// Sends an alert (push notification AND email) when the uptime-check
// GitHub Actions workflow detects a real state transition -- the site
// going from up to down, or recovering from down back to up. Not
// called on every single check, only on a transition: the workflow
// itself is responsible for comparing against the last logged status
// and only calling this function when something actually changed, to
// avoid alert fatigue from re-notifying on every check during an
// extended outage.
//
// Deliberately its own function, not a branch merged into send-push
// or send-lead-email: keeps each notification channel's failure mode
// independent, the same reasoning already applied to every other
// notification pathway built this session.
//
// Expected payload: { "status": "up" | "down", "message": string }
//
// Deploy with: supabase functions deploy uptime-alert
// Required secrets (both already configured for the lead-email
// pipeline, reused here -- no new secrets needed):
//   RESEND_API_KEY
//   LEAD_EMAIL_TO
//   LEAD_EMAIL_FROM
// Also needs (already configured for send-push's own triggers):
//   Calls Send-Push's own genuine "uptime-alert" payload branch
//   (added alongside this function), authenticated with the same
//   service_role bearer token the caller (the GitHub Actions
//   workflow) is invoked with.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const LEAD_EMAIL_TO = Deno.env.get("LEAD_EMAIL_TO")!
  .split(",")
  .map((addr: string) => addr.trim())
  .filter((addr: string) => addr.length > 0);
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sendPushAlert(title: string, body: string): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/Send-Push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ type: "uptime-alert", title, body }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error("sendPushAlert: Send-Push returned error:", res.status, errBody);
    }
  } catch (err: any) {
    console.error("sendPushAlert error:", err.message);
  }
}

async function sendEmailAlert(subject: string, message: string): Promise<void> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: LEAD_EMAIL_FROM,
        to: LEAD_EMAIL_TO,
        subject,
        text: message,
        html: `<p style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 15px;">${message}</p>`,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error("sendEmailAlert: Resend API error:", res.status, errBody);
    }
  } catch (err: any) {
    console.error("sendEmailAlert error:", err.message);
  }
}

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const status = payload.status === "down" ? "down" : "up";
    const message = typeof payload.message === "string" ? payload.message : "";
    const providedTitle = typeof payload.title === "string" && payload.title ? payload.title : "";

    const title = providedTitle || (status === "down" ? "Site is DOWN" : "Site is back UP");
    const body = message || (status === "down" ? "triplehenterprisesllc.biz stopped responding." : "triplehenterprisesllc.biz is responding again.");

    // Independent sends, each in its own try/catch (inside the helper
    // functions above) -- a failure in one channel never blocks the
    // other from being attempted.
    await Promise.all([
      sendPushAlert(title, body),
      sendEmailAlert(title, body),
    ]);

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("uptime-alert error:", err.message);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
