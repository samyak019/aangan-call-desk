// Webhook payload normalisation + call-level guardrails.

import { FRONT_DESK_HOURS_IST } from "./rules";
import type { CallInput, Turn } from "./types";

type Json = Record<string, any>;

const pick = (o: Json, keys: string[]) => {
  for (const k of keys) {
    const v = k.split(".").reduce<any>((acc, p) => (acc == null ? acc : acc[p]), o);
    if (v != null && v !== "") return v;
  }
  return null;
};

const AGENT_ROLES = ["agent", "assistant", "bot", "ai", "studio", "front desk"];

function toTurns(t: unknown): Turn[] {
  if (Array.isArray(t)) {
    return t
      .map((m: Json) => {
        const role = String(m.role ?? m.speaker ?? m.from ?? "").toLowerCase();
        const text = String(m.content ?? m.text ?? m.message ?? m.transcript ?? "").trim();
        return { speaker: AGENT_ROLES.includes(role) ? "agent" : "caller", text } as Turn;
      })
      .filter((m) => m.text);
  }
  if (typeof t === "string") {
    // "Agent: ...\nUser: ..." style plain transcripts
    return t
      .split(/\n+/)
      .map((line) => {
        const m = line.match(/^\s*([A-Za-z ]{2,20}):\s*(.*)$/);
        if (!m) return { speaker: "caller", text: line.trim() } as Turn;
        return { speaker: AGENT_ROLES.includes(m[1].trim().toLowerCase()) ? "agent" : "caller", text: m[2].trim() } as Turn;
      })
      .filter((x) => x.text);
  }
  return [];
}

// Vaani's exact post-call payload isn't something we control; accept the common shapes
// and map field names here (one place to adjust if the platform renames anything).
export function normaliseWebhook(body: Json): CallInput {
  const startedRaw = pick(body, ["started_at", "start_time", "call.started_at", "created_at", "timestamp"]);
  const startedAt = startedRaw ? new Date(typeof startedRaw === "number" && startedRaw < 1e12 ? startedRaw * 1000 : startedRaw) : new Date();
  const transcript = pick(body, ["transcript", "messages", "conversation", "call.transcript", "data.transcript"]);
  return {
    externalCallId: String(pick(body, ["call_id", "id", "call.id", "session_id", "data.call_id"]) ?? `anon-${startedAt.getTime()}`),
    callerPhone: pick(body, ["from", "caller_number", "caller_phone", "phone_number", "customer.number", "call.from"]),
    startedAt: isNaN(startedAt.getTime()) ? new Date() : startedAt,
    durationSeconds: Math.round(Number(pick(body, ["duration_seconds", "duration", "call.duration", "call_duration"]) ?? 0)),
    turns: toTurns(transcript),
    bookedSlot: pick(body, ["booked_slot", "metadata.booked_slot", "variables.booked_slot"]),
  };
}

export function isAfterHours(d: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false, weekday: "short" }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  return weekday === "Sun" || hour < FRONT_DESK_HOURS_IST.open || hour >= FRONT_DESK_HOURS_IST.close;
}

// ---------------------------------------------------------------------------
// Pricing guardrail (pricing.md: "What the agent must never say").
// Flags any per-sq-ft figure from the agent, and any rupee/lakh amount the agent
// says that the caller didn't say first (echoing the caller's own budget is fine).
// ---------------------------------------------------------------------------
const PER_SQFT = /\d[\d,]*\s*(?:rs\.?|rupees|₹)?\s*(?:\/|per|a)\s*(?:sq\.?\s*f(?:ee)?t|square\s*f(?:ee|oo)t)/i;
// A number must start with a digit, and "rs"/"inr" must be whole words ("designers, who" is not a price).
const AMOUNT = /(?:₹|\b(?:rs\.?|inr)\b)\s*(\d[\d,.]*)\s*(lakh|lac|lakhs|crore|cr|k)?|(\d[\d,.]*)\s*(lakh|lac|lakhs|crore|cr)\b/gi;

function amounts(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(AMOUNT)) out.add(`${(m[1] ?? m[3]).replace(/,/g, "")}${(m[2] ?? m[4] ?? "").toLowerCase().slice(0, 1)}`);
  return out;
}

export function detectPricingLeak(turns: Turn[]): string | null {
  const callerAmounts = new Set<string>();
  for (const t of turns) {
    if (t.speaker === "caller") {
      amounts(t.text).forEach((a) => callerAmounts.add(a));
      // "1 to 1.5 lakh" — the first number carries the unit implicitly
      for (const m of t.text.matchAll(/([\d.]+)\s*(?:to|-|–)\s*([\d.]+)\s*(lakh|lac|crore)/gi)) callerAmounts.add(`${m[1]}${m[3][0].toLowerCase()}`);
      continue;
    }
    if (PER_SQFT.test(t.text)) return t.text;
    for (const a of amounts(t.text)) if (!callerAmounts.has(a)) return t.text;
  }
  return null;
}
