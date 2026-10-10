// File 3 — handoff dispatcher.
// Gmail is the primary channel (see README "Why Gmail"); Telegram is an optional fallback
// if Gmail is down or not configured, so a qualified lead is never silently dropped.

import nodemailer, { type Transporter } from "nodemailer";
import type { Classification, Outcome } from "./types";

export interface HandoffContext {
  callerPhone: string | null;
  callStartedAt: Date;
  bookedSlot: string | null;      // ISO
  repeatCallerNote: string | null;
  pricingLeak: boolean;
}

const fmtIst = (d: Date, withTime = true) =>
  d.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "2-digit", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).replace(",", " at");

const inr = (n: number) => `₹${(n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} lakh`;

export function formatQualifiedLead(c: Classification, ctx: HandoffContext): string {
  const f = c.facts;
  const where = [f.property_type, f.locality, f.carpet_area_sqft ? `${f.carpet_area_sqft.toLocaleString("en-IN")} sq ft` : null]
    .filter(Boolean).join(", ");
  const scope = f.full_home ? `Full home${f.rooms_in_scope.length ? ` (${f.rooms_in_scope.join(", ")})` : ""}` : f.rooms_in_scope.join(" + ") || "Not specified";
  const budget = f.budget_text ? `${f.budget_text}${f.budget_max_inr ? ` (up to ${inr(f.budget_max_inr)})` : ""}` : "Unspecified";

  const authorityUnclear = c.decision.gates?.authority.status === "UNCLEAR"; // already in decision.notes
  const notes = [
    authorityUnclear ? null : f.decision_notes ?? f.caller_role,
    f.referral_source && `Came via ${f.referral_source}`,
    f.preferences,
    f.rented && "Rented flat — no structural changes",
    f.site_visit_requested && "Wants the consultation as a site visit",
    f.asked_for_pricing && "Asked about pricing — deflected; come ready to talk numbers",
    f.sentiment === "FRUSTRATED" || f.sentiment === "ANGRY" ? `Caller sounded ${f.sentiment.toLowerCase()} — handle with care` : null,
    ctx.repeatCallerNote,
    ...c.decision.notes,
  ].filter(Boolean);

  const action = ctx.bookedSlot
    ? `Consultation booked via Cal.com for ${fmtIst(new Date(ctx.bookedSlot))}`
    : `No slot booked on the call — call back within 1 hour${f.preferred_consultation_time ? ` (prefers: ${f.preferred_consultation_time})` : ""}`;

  return [
    "📌 NEW QUALIFIED LEAD HANDOFF",
    `- Caller Name: ${f.caller_name ?? "Unknown"}`,
    `- Contact Number: ${ctx.callerPhone ?? "Withheld"}`,
    `- Location & Property Type: ${where || "Not specified"}`,
    `- Scope: ${scope}${f.segment === "COMMERCIAL_OFFICE" ? " (commercial)" : ""}`,
    `- Possession & Timeline: ${f.timeline_text ?? "Not confirmed"}`,
    `- Budget Mentioned: ${budget}`,
    `- Key Notes & Vibe: ${notes.join(" · ") || "—"}`,
    `- Action Taken: ${action}`,
    "",
    `Summary: ${f.summary}`,
    `Call: ${fmtIst(ctx.callStartedAt)} IST`,
  ].join("\n");
}

export function formatOpsMessage(outcome: Outcome, c: Classification, ctx: HandoffContext): string {
  const f = c.facts;
  const who = `${f.caller_name ?? "Unknown caller"} · ${ctx.callerPhone ?? "number withheld"}`;
  const at = `${fmtIst(ctx.callStartedAt)} IST`;
  switch (outcome) {
    case "ESCALATE":
      return [
        "🚨 ESCALATION — EXISTING CLIENT COMPLAINT",
        `- Caller: ${who}`,
        `- Issue: ${f.complaint_summary ?? f.summary}`,
        `- Mood: ${f.sentiment.toLowerCase()}`,
        ctx.repeatCallerNote ? `- History: ${ctx.repeatCallerNote}` : null,
        "- Caller was told a senior person will call back within 15 minutes.",
        `- Call: ${at}`,
      ].filter(Boolean).join("\n");
    case "NEEDS_FOLLOW_UP":
      return [
        "❓ LEAD NEEDS ONE ANSWER BEFORE HANDOFF",
        `- Caller: ${who}`,
        `- What we know: ${f.summary}`,
        `- Ask them: "${c.decision.followUpQuestion}"`,
        `- Call: ${at}`,
      ].join("\n");
    case "MISSED":
      return ["📵 MISSED / DROPPED CALL — CALL BACK", `- Number: ${ctx.callerPhone ?? "withheld"}`, `- Call: ${at}`].join("\n");
    case "EXISTING_CLIENT":
      return ["ℹ️ EXISTING CLIENT CALLED", `- Caller: ${who}`, `- About: ${f.summary}`, `- Call: ${at}`].join("\n");
    default:
      return `${outcome}: ${who} — ${f.summary}`;
  }
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Plain text (no parse_mode): caller-supplied names/notes can't break Markdown escaping.
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(`Telegram ${res.status}: ${j.description ?? "unknown error"}`);
}

let gmail: Transporter | null = null;

// Gmail over SMTP with an App Password (free, ~500 recipients/day — far above 200 calls/month).
// Resend is used instead only if Gmail isn't configured.
async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const recipients = to.split(",").map((s) => s.trim()).filter(Boolean);
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (user && pass) {
    gmail ??= nodemailer.createTransport({ service: "gmail", auth: { user, pass: pass.replace(/\s+/g, "") } });
    await gmail.sendMail({
      from: `"${process.env.GMAIL_FROM_NAME || "Aangan Call Desk"}" <${user}>`,
      to: recipients,
      subject,
      text,
    });
    return;
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("No email transport: set GMAIL_USER + GMAIL_APP_PASSWORD");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: process.env.RESEND_FROM || "Aangan Leads <onboarding@resend.dev>", to: recipients, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Subject lines a designer can triage from the inbox list (and Gmail filters can match on).
export function subjectFor(outcome: Outcome, c: Classification): string {
  const f = c.facts;
  const who = f.caller_name ?? "Caller";
  const what = [f.property_type, f.locality].filter(Boolean).join(", ");
  switch (outcome) {
    case "QUALIFIED":
      return `[Aangan Lead] ${who}${what ? ` — ${what}` : ""}`;
    case "ESCALATE":
      return `[Aangan URGENT] Client complaint — ${who}`;
    case "NEEDS_FOLLOW_UP":
      return `[Aangan Follow-up] ${who} — one question before handoff`;
    case "MISSED":
      return "[Aangan Call-back] Missed / dropped call";
    default:
      return `[Aangan] ${outcome.replace(/_/g, " ").toLowerCase()} — ${who}`;
  }
}

type Audience = "designers" | "escalation" | "frontdesk";

function route(audience: Audience) {
  const designers = process.env.TELEGRAM_DESIGNERS_CHAT_ID;
  const chat = {
    designers,
    escalation: process.env.TELEGRAM_ESCALATION_CHAT_ID || designers,
    frontdesk: process.env.TELEGRAM_FRONTDESK_CHAT_ID || designers,
  }[audience];
  const email = {
    designers: process.env.HANDOFF_EMAIL_DESIGNERS,
    escalation: process.env.HANDOFF_EMAIL_ESCALATION || process.env.HANDOFF_EMAIL_DESIGNERS,
    frontdesk: process.env.HANDOFF_EMAIL_FRONTDESK || process.env.HANDOFF_EMAIL_DESIGNERS,
  }[audience];
  return { chat, email };
}

export interface DispatchResult {
  sent: boolean;
  channel: "telegram" | "email" | null;
  text: string | null;
  error?: string;
}

const AUDIENCE: Partial<Record<Outcome, Audience>> = {
  QUALIFIED: "designers",
  ESCALATE: "escalation",
  NEEDS_FOLLOW_UP: "frontdesk",
  MISSED: "frontdesk",
  EXISTING_CLIENT: "frontdesk",
  // NOT_QUALIFIED / NOT_AN_ENQUIRY: logged to the dashboard only — nobody gets an email.
};

export async function dispatchHandoff(c: Classification, ctx: HandoffContext): Promise<DispatchResult> {
  const outcome = c.decision.outcome;
  const audience = AUDIENCE[outcome];
  if (!audience) return { sent: false, channel: null, text: null };

  const text = outcome === "QUALIFIED" ? formatQualifiedLead(c, ctx) : formatOpsMessage(outcome, c, ctx);
  const { chat, email } = route(audience);
  const errors: string[] = [];

  if (email) {
    try {
      await sendEmail(email, subjectFor(outcome, c), text);
      return { sent: true, channel: "email", text };
    } catch (e) {
      errors.push(String(e));
    }
  }
  if (chat) {
    try {
      await sendTelegram(chat, text);
      return { sent: true, channel: "telegram", text };
    } catch (e) {
      errors.push(String(e));
    }
  }
  return { sent: false, channel: null, text, error: errors.join(" | ") || "No channel configured" };
}

// Out-of-band alert to management (e.g. the agent broke the pricing rule on a call).
export async function alertManagement(text: string): Promise<void> {
  const { chat, email } = route("escalation");
  try {
    if (email) return await sendEmail(email, `[Aangan URGENT] ${text.split("\n")[0].replace(/^\W+/, "")}`, text);
    if (chat) return await sendTelegram(chat, text);
  } catch (e) {
    console.error("alertManagement failed", e);
  }
}
