// Supabase Edge Function: respond-to-contract
//
// Same shape as respond-to-quote, adapted for contract signing. Called
// from portal/contracts.html when a client signs or declines one of
// their own contracts. client_portal_contracts has no update policy for
// the authenticated role at all -- this function is the only way that
// status/signature field ever changes.
//
// 2026-11-04 (handoff §3D; approved "Contract signing flow" design: "After
// Sign: 'Signed on Nov 3, 2026' with a copy emailed to you. Steve and Connor
// are emailed the signed contract too (today nobody is told)"):
//   * Signed: the client gets a copy (the contract text as sent, the date,
//     and their signature attached); Steve and Connor get the same copy.
//   * Declined: Steve and Connor are told. The client is not emailed.
//   * The email is best-effort: a failed send never undoes or blocks the
//     signature, which is already saved by then.
//   * Only a confirmed account can sign or decline (the same rule as
//     sql/portal/portal_self_signup_and_confirmed_email_lock.sql).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const LEAD_EMAIL_FROM = Deno.env.get("LEAD_EMAIL_FROM") || "";
const LOGO_URL = "https://www.triplehenterprisesllc.biz/images/logo-signature-email.png";
const STEVE_EMAIL = "steve@triplehenterprisesllc.biz";
const CONNOR_EMAIL = "connor@triplehenterprisesllc.biz";
const PORTAL_CONTRACTS_URL = "https://www.triplehenterprisesllc.biz/portal/contracts.html";
const WORKSPACE_CONTRACTS_URL = "https://www.triplehenterprisesllc.biz/tools/contract-generator.html";

function escapeHtml(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function signedOnText(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Denver", year: "numeric", month: "short", day: "numeric" });
}

// The contract as sent, in the same block shape portal/contracts.html
// renders (renderBlock): headings, section labels, paragraphs, filled-in
// fields, the total, footnotes.
function contractCopyHtml(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const p = "font-size: 14px; line-height: 1.5; color: #222; margin: 0 0 10px;";
  return blocks.map((b: any) => {
    if (!b || typeof b !== "object") return "";
    switch (b.type) {
      case "heading": return `<p style="font-size: 17px; font-weight: 700; color: #0a0a0a; margin: 16px 0 4px;">${escapeHtml(b.text)}</p>${b.sub ? `<p style="${p} color: #555;">${escapeHtml(b.sub)}</p>` : ""}`;
      case "sectionLabel": return `<p style="font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #c96400; margin: 16px 0 6px;">${escapeHtml(b.text)}</p>`;
      case "paragraph": return `<p style="${p}">${escapeHtml(b.text)}</p>`;
      case "field": return b.value ? `<p style="${p}"><span style="color: #777;">${escapeHtml(b.label)}:</span> ${escapeHtml(b.value)}</p>` : "";
      case "totalHighlight": return `<p style="${p} font-weight: 700;">${escapeHtml(b.label)}: ${escapeHtml(b.value)}</p>`;
      case "footnote": return `<p style="${p} font-size: 12px; color: #777;">${escapeHtml(b.text)}</p>`;
      default: return "";
    }
  }).join("");
}
function contractCopyText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks.map((b: any) => {
    if (!b || typeof b !== "object") return "";
    switch (b.type) {
      case "heading": return `\n${String(b.text || "").toUpperCase()}${b.sub ? `\n${b.sub}` : ""}`;
      case "sectionLabel": return `\n${String(b.text || "").toUpperCase()}`;
      case "paragraph": case "footnote": return String(b.text || "");
      case "field": return b.value ? `${b.label}: ${b.value}` : "";
      case "totalHighlight": return `${b.label}: ${b.value}`;
      default: return "";
    }
  }).filter(Boolean).join("\n");
}

function emailShell(heading: string, inner: string): string {
  const font = "font-family: -apple-system, Helvetica, Arial, sans-serif;";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"><title>${escapeHtml(heading)}, Triple H Enterprises</title></head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f4" style="background: #f4f4f4; padding: 32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width: 560px; background: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #e5e5e5;">
<tr><td align="center" bgcolor="#0a0a0a" style="background: #0a0a0a; padding: 28px 24px;"><img src="${LOGO_URL}" alt="Triple H Enterprises" width="140" style="display: block; border: 0;"></td></tr>
<tr><td style="padding: 32px 28px 24px; ${font}"><h1 style="color: #ff8000; font-size: 22px; margin: 0 0 20px; text-align: center;">${escapeHtml(heading)}</h1>${inner}</td></tr>
<tr><td style="background: #ff8000; height: 4px; line-height: 4px; font-size: 1px;">&nbsp;</td></tr>
<tr><td align="center" style="padding: 16px 24px; ${font}"><p style="color: #999; font-size: 12px; margin: 0;">(435) 414-1667 &middot; triplehenterprisesllc.biz</p></td></tr>
</table></td></tr></table></body></html>`;
}

// The signature as an attachment: most email apps block data: images inline.
function signatureAttachment(dataUrl: unknown): { filename: string; content: string } | null {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return m ? { filename: `signature.${m[1] === "jpeg" ? "jpg" : "png"}`, content: m[2] } : null;
}

async function sendEmail(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from: `Triple H Enterprises <${LEAD_EMAIL_FROM}>`, ...payload }),
    });
    if (!res.ok) console.error(`respond-to-contract: email failed (HTTP ${res.status})`);
    return res.ok;
  } catch (err: any) {
    console.error(`respond-to-contract: email failed (${err.message})`);
    return false;
  }
}

async function tellEveryone(contract: any, status: "signed" | "declined", respondedAt: string, signatureDataUrl: unknown) {
  const title = String(contract.contract_title || "Contract");
  const who = String(contract.client_name || contract.client_email);
  const when = signedOnText(respondedAt);
  const attachment = status === "signed" ? signatureAttachment(signatureDataUrl) : null;
  const copyHtml = contractCopyHtml(contract.blocks);
  const copyText = contractCopyText(contract.blocks);
  const p = (t: string) => `<p style="color: #222; font-size: 15px; line-height: 1.5; margin: 0 0 16px;">${t}</p>`;
  const divider = `<hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">`;
  const sigNote = attachment ? p(`<span style="color: #777; font-size: 13px;">Signed electronically by ${escapeHtml(who)} on ${escapeHtml(when)}. The signature is attached.</span>`) : "";

  const team = status === "signed"
    ? {
      subject: `Signed: ${title} (${who})`,
      html: emailShell("Contract signed", p(`<strong>${escapeHtml(who)}</strong> (${escapeHtml(contract.client_email)}) signed <strong>${escapeHtml(title)}</strong> on ${escapeHtml(when)}.`) +
        p(`<a href="${WORKSPACE_CONTRACTS_URL}" style="color: #c96400;">Open Contracts in the Workspace</a>`) + divider + copyHtml + sigNote),
      text: [`${who} (${contract.client_email}) signed ${title} on ${when}.`, `Workspace: ${WORKSPACE_CONTRACTS_URL}`, "", copyText].join("\n"),
    }
    : {
      subject: `Declined: ${title} (${who})`,
      html: emailShell("Contract declined", p(`<strong>${escapeHtml(who)}</strong> (${escapeHtml(contract.client_email)}) declined <strong>${escapeHtml(title)}</strong> on ${escapeHtml(when)}.`) +
        p(`<a href="${WORKSPACE_CONTRACTS_URL}" style="color: #c96400;">Open Contracts in the Workspace</a>`)),
      text: [`${who} (${contract.client_email}) declined ${title} on ${when}.`, `Workspace: ${WORKSPACE_CONTRACTS_URL}`].join("\n"),
    };
  const sends: Promise<boolean>[] = [sendEmail({ to: [STEVE_EMAIL, CONNOR_EMAIL], ...team, ...(attachment ? { attachments: [attachment] } : {}) })];

  if (status === "signed") {
    const link = `${PORTAL_CONTRACTS_URL}#contract-card-${contract.id}`;
    sends.push(sendEmail({
      to: contract.client_email,
      subject: `Signed: ${title}`,
      html: emailShell("Signed. Thank you!", p(`Signed on ${escapeHtml(when)}. Here's a copy of <strong>${escapeHtml(title)}</strong> for your records. It's also in your portal any time.`) +
        p(`<a href="${link}" style="color: #c96400;">View it in your portal</a>`) + p("Questions? Call or text (435) 414-1667.") + divider + copyHtml + sigNote),
      text: [`Signed on ${when}. Here's a copy of ${title} for your records.`, `View it in your portal: ${link}`, "Questions? Call or text (435) 414-1667.", "", copyText].join("\n"),
      ...(attachment ? { attachments: [attachment] } : {}),
    }));
  }
  await Promise.all(sends);
}

// Same rule as the database's "Confirmed email only" policies: an account
// whose email was never confirmed can't act on a contract.
async function emailIsConfirmed(email: string): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/portal_account_status`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_email: email }),
    });
    return res.ok && (await res.json()) === "confirmed";
  } catch {
    return false;
  }
}

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

// A signature is expected to be a data: URL (a PNG canvas export, same
// shape tools/contract-generator.html already produces for its two
// in-person pads) -- checked loosely here (real validation is "does it
// decode/render," which only matters when the PDF is actually built;
// this guards against an empty string or an obviously wrong type, not
// against a corrupt-but-plausible data URL).
function looksLikeSignatureDataUrl(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("data:image/") && value.length > 100;
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
    // a CLIENT, not an internal account, so no account_roles check.
    // The real authorization check is below: does the contract being
    // responded to actually belong to this specific caller.
    if (claims.role !== "authenticated" || !claims.email) {
      return json({ ok: false, error: "Must be signed in." }, 401);
    }
    if (!(await emailIsConfirmed(claims.email))) {
      return json({ ok: false, error: "Confirm your email first: use the code we sent when you created your account." }, 403);
    }

    const { contract_id, action, client_signature_data_url } = await req.json();
    if (typeof contract_id !== "number") {
      return json({ ok: false, error: "Missing contract_id." }, 400);
    }
    if (action !== "sign" && action !== "decline") {
      return json({ ok: false, error: "action must be 'sign' or 'decline'." }, 400);
    }
    if (action === "sign" && !looksLikeSignatureDataUrl(client_signature_data_url)) {
      return json({ ok: false, error: "A signature is required to sign this contract." }, 400);
    }

    const contractRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_contracts?id=eq.${contract_id}&select=id,client_email,client_name,contract_title,blocks,status`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!contractRes.ok) {
      return json({ ok: false, error: "Could not look up that contract." }, 502);
    }
    const rows = await contractRes.json();
    if (!rows.length) {
      return json({ ok: false, error: "Contract not found." }, 404);
    }
    const contract = rows[0];

    // The real authorization boundary: the contract being responded to
    // must belong to the exact email on the caller's own verified
    // session -- never trust a contract_id alone to imply the caller is
    // allowed to respond to it.
    if (contract.client_email.toLowerCase() !== claims.email.toLowerCase()) {
      return json({ ok: false, error: "That contract doesn't belong to this account." }, 403);
    }
    if (contract.status !== "pending") {
      return json({ ok: false, error: `This contract was already ${contract.status}.` }, 400);
    }

    const newStatus = action === "sign" ? "signed" : "declined";
    const respondedAt = new Date().toISOString();
    const patchBody: Record<string, unknown> = {
      status: newStatus,
      responded_at: respondedAt,
    };
    if (action === "sign") patchBody.client_signature_data_url = client_signature_data_url;

    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/client_portal_contracts?id=eq.${contract_id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patchBody),
      },
    );
    if (!patchRes.ok) {
      const errText = await patchRes.text();
      return json({ ok: false, error: `Database error: ${errText.slice(0, 300)}` }, 502);
    }

    await tellEveryone(contract, newStatus, respondedAt, client_signature_data_url).catch((err: any) => {
      console.error(`respond-to-contract: notices failed (${err.message})`);
    });

    return json({ ok: true, status: newStatus, signed_on: newStatus === "signed" ? signedOnText(respondedAt) : null });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
