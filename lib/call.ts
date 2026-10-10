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

const TS_PREFIX = /^\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*/; // Vaani: "[13:04:30] AGENT: ..."

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
    // "Agent: ..." / "[13:04:30] AGENT: ..." lines; unlabelled lines continue the previous turn.
    const turns: Turn[] = [];
    for (const raw of t.split(/\n+/)) {
      const line = raw.replace(TS_PREFIX, "").trim();
      if (!line) continue;
      const m = line.match(/^([A-Za-z ]{2,20}):\s*(.*)$/);
      if (m) {
        turns.push({ speaker: AGENT_ROLES.includes(m[1].trim().toLowerCase()) ? "agent" : "caller", text: m[2].trim() });
      } else if (turns.length) {
        turns[turns.length - 1].text += ` ${line}`;
      } else {
        turns.push({ speaker: "caller", text: line });
      }
    }
    return turns.filter((x) => x.text);
  }
  return [];
}

// Depth-first search for the first value whose key matches — Vaani nests call details.
function findDeep(o: unknown, keyRe: RegExp, ok: (v: unknown) => boolean, depth = 0): unknown {
  if (!o || typeof o !== "object" || depth > 5) return null;
  for (const [k, v] of Object.entries(o as Json)) if (keyRe.test(k) && ok(v)) return v;
  for (const v of Object.values(o as Json)) {
    const hit = findDeep(v, keyRe, ok, depth + 1);
    if (hit != null) return hit;
  }
  return null;
}

const looksLikePhone = (v: unknown) => typeof v === "string" && v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 15;
const positiveNumber = (v: unknown) => Number(v) > 0 && Number.isFinite(Number(v));

function keyList(o: unknown, prefix = "", depth = 0): string[] {
  if (!o || typeof o !== "object" || Array.isArray(o) || depth > 3) return [];
  return Object.entries(o as Json).flatMap(([k, v]) => [prefix + k, ...keyList(v, `${prefix}${k}.`, depth + 1)]);
}

function durationFromTranscript(t: unknown): number {
  if (typeof t !== "string") return 0;
  const stamps = [...t.matchAll(/\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g)].map((m) => +m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0));
  return stamps.length > 1 ? Math.max(0, stamps[stamps.length - 1] - stamps[0]) : 0;
}

// Vaani's exact post-call payload isn't something we control; accept the common shapes
// and map field names here (one place to adjust if the platform renames anything).
export function normaliseWebhook(body: Json): CallInput {
  console.log("webhook payload keys:", keyList(body).slice(0, 80).join(", ")); // keys only, never values
  const startedRaw = pick(body, ["started_at", "start_time", "call.started_at", "created_at", "timestamp"]);
  const startedAt = startedRaw ? new Date(typeof startedRaw === "number" && startedRaw < 1e12 ? startedRaw * 1000 : startedRaw) : new Date();
  const transcript = pick(body, ["transcript", "messages", "conversation", "call.transcript", "data.transcript"]) ?? findDeep(body, /transcript|conversation/i, (v) => typeof v === "string" || Array.isArray(v));
  const phone =
    pick(body, ["from", "caller_number", "caller_phone", "phone_number", "customer.number", "call.from"]) ??
    findDeep(body, /(phone|number|mobile|msisdn|^to$|^from$|recipient|customer|contact)/i, looksLikePhone);
  const declared = Number(pick(body, ["duration_seconds", "duration", "call.duration", "call_duration"]) ?? findDeep(body, /duration/i, positiveNumber) ?? 0);
  return {
    externalCallId: String(pick(body, ["call_id", "id", "call.id", "session_id", "data.call_id"]) ?? `anon-${startedAt.getTime()}`),
    callerPhone: (phone as string | null) ?? null,
    startedAt: isNaN(startedAt.getTime()) ? new Date() : startedAt,
    durationSeconds: Math.round(declared > 0 ? (declared > 36000 ? declared / 1000 : declared) : durationFromTranscript(transcript)),
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
