// File 2 — LLM structured extractor.
// Gemini (free tier, AI Studio key) first; Groq (free tier) as fallback.
// The model returns FACTS as strict JSON; lib/gates.ts makes the decision.

import { decide } from "./gates";
import type { CallInput, Classification, ExtractedCall, Turn } from "./types";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You extract facts from a phone call transcript between Aangan Studio (an interior design studio in Pune, India) and a caller.
Return ONLY a JSON object with exactly these keys. Use null when the caller did not say it — never guess.

{
  "intent": "NEW_ENQUIRY" | "EXISTING_PROJECT_COMPLAINT" | "EXISTING_PROJECT_QUERY" | "VENDOR_OR_JOB" | "SPAM_OR_WRONG_NUMBER" | "NO_CONVERSATION",
  "caller_name": string | null,
  "caller_role": string | null,                 // e.g. "owner", "co-owner with husband", "son of owners", "founder"
  "segment": "RESIDENTIAL" | "COMMERCIAL_OFFICE" | "COMMERCIAL_OTHER" | "UNKNOWN",   // COMMERCIAL_OTHER = restaurant, hotel, retail, gym, salon, etc.
  "commercial_category": string | null,         // "office", "clinic", "restaurant", "gym", "coworking pod"...
  "property_type": string | null,               // short label, e.g. "3BHK apartment", "villa (G+2)", "bare-shell office"
  "bhk": number | null,
  "locality": string | null,                    // neighbourhood exactly as said, e.g. "Kothrud — Dahanukar Colony"
  "city": string | null,                        // city if stated or unambiguous from the locality, e.g. "Pune", "Nashik"
  "carpet_area_sqft": number | null,
  "full_home": boolean | null,
  "rooms_in_scope": string[],                   // e.g. ["kitchen","living room","2 bedrooms"]
  "service_requested": "DESIGN_AND_EXECUTION" | "ADVICE_ONLY" | "DESIGN_ONLY_DIY_EXECUTION" | "VASTU_ONLY" | "FURNITURE_SOURCING_ONLY" | "STRUCTURAL_OR_ARCHITECTURE" | "UNCLEAR",
  "just_exploring": boolean,
  "rented": boolean | null,
  "timeline_text": string | null,               // caller's words, e.g. "done by March", "before Diwali"
  "timeline_flexible": boolean,                 // true if caller said no deadline / flexible / no rush
  "weeks_until_completion_needed": number | null,   // weeks from the CALL DATE until they need it FINISHED; null if no finish deadline
  "weeks_until_execution_can_start": number | null, // weeks from the CALL DATE until the site is available for work (0 if available now)
  "budget_text": string | null,                 // ONLY if the caller volunteered a budget
  "budget_max_inr": number | null,              // upper bound in rupees (1 lakh = 100000, 1 crore = 10000000)
  "decision_authority": "DECISION_MAKER" | "AUTHORISED_REPRESENTATIVE" | "RESEARCHING_FOR_OTHERS" | "NO_AUTHORITY" | "UNKNOWN",
  "decision_notes": string | null,              // e.g. "Owner with husband; husband approved booking"
  "asked_for_pricing": boolean,
  "preferred_consultation_time": string | null,
  "site_visit_requested": boolean,              // true ONLY if the caller asked for the designer to visit the property
  "referral_source": string | null,             // "Instagram", "referral from Shruti Joshi", ...
  "preferences": string | null,                 // style, special requests, constraints worth a designer knowing
  "sentiment": "POSITIVE" | "NEUTRAL" | "FRUSTRATED" | "ANGRY",
  "complaint_summary": string | null,
  "summary": string                             // one sentence a designer can read in 5 seconds
}

Rules:
- Design + execution is the default reading when someone wants a room/home "done", "redesigned", "redone" or "designed" with kitchen/wardrobes/furniture. Use ADVICE_ONLY for "ideas", "suggestions", "come and advise", "colours".
- Offices, clinics, studios and coworking spaces are COMMERCIAL_OFFICE. COMMERCIAL_OTHER is only restaurants, cafes, hotels, retail/showrooms, gyms, salons and similar.
- A caller with a running project who is unhappy = EXISTING_PROJECT_COMPLAINT, even if polite.
- Someone who called earlier about a NEW project and wasn't called back is still NEW_ENQUIRY (note it in preferences).
- Convert month names to their next occurrence after the call date. If the conversation itself says how far away a date or festival is ("Diwali is about three weeks away"), use that figure.
- A spouse/family member who "knows and is happy to go ahead" = DECISION_MAKER. Calling for parents who will attend and decide = RESEARCHING_FOR_OTHERS.
- Transcripts may be in English, Hindi, Marathi or a mix. Output English.`;

function renderTranscript(turns: Turn[]): string {
  return turns.map((t) => `${t.speaker === "agent" ? "Studio" : "Caller"}: ${t.text}`).join("\n");
}

async function callGemini(user: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const parts: { text?: string; thought?: boolean }[] = j.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("");
  return {
    provider: "gemini",
    model: GEMINI_MODEL,
    text,
    inputTokens: j.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0),
  };
}

async function callGroq(user: string) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return {
    provider: "groq",
    model: GROQ_MODEL,
    text: j.choices?.[0]?.message?.content ?? "",
    inputTokens: j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usage?.completion_tokens ?? 0,
  };
}

// Coerce whatever came back into the exact shape the gates expect.
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v.replace(/[, ]/g, "")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

export function coerce(raw: Record<string, unknown>): ExtractedCall {
  return {
    intent: oneOf(raw.intent, ["NEW_ENQUIRY", "EXISTING_PROJECT_COMPLAINT", "EXISTING_PROJECT_QUERY", "VENDOR_OR_JOB", "SPAM_OR_WRONG_NUMBER", "NO_CONVERSATION"] as const, "NEW_ENQUIRY"),
    caller_name: str(raw.caller_name),
    caller_role: str(raw.caller_role),
    segment: oneOf(raw.segment, ["RESIDENTIAL", "COMMERCIAL_OFFICE", "COMMERCIAL_OTHER", "UNKNOWN"] as const, "UNKNOWN"),
    commercial_category: str(raw.commercial_category),
    property_type: str(raw.property_type),
    bhk: num(raw.bhk),
    locality: str(raw.locality),
    city: str(raw.city),
    carpet_area_sqft: num(raw.carpet_area_sqft),
    full_home: bool(raw.full_home),
    rooms_in_scope: Array.isArray(raw.rooms_in_scope) ? raw.rooms_in_scope.map(String) : [],
    service_requested: oneOf(raw.service_requested, ["DESIGN_AND_EXECUTION", "ADVICE_ONLY", "DESIGN_ONLY_DIY_EXECUTION", "VASTU_ONLY", "FURNITURE_SOURCING_ONLY", "STRUCTURAL_OR_ARCHITECTURE", "UNCLEAR"] as const, "UNCLEAR"),
    just_exploring: raw.just_exploring === true,
    rented: bool(raw.rented),
    timeline_text: str(raw.timeline_text),
    timeline_flexible: raw.timeline_flexible === true,
    weeks_until_completion_needed: num(raw.weeks_until_completion_needed),
    weeks_until_execution_can_start: num(raw.weeks_until_execution_can_start),
    budget_text: str(raw.budget_text),
    budget_max_inr: num(raw.budget_max_inr),
    decision_authority: oneOf(raw.decision_authority, ["DECISION_MAKER", "AUTHORISED_REPRESENTATIVE", "RESEARCHING_FOR_OTHERS", "NO_AUTHORITY", "UNKNOWN"] as const, "UNKNOWN"),
    decision_notes: str(raw.decision_notes),
    asked_for_pricing: raw.asked_for_pricing === true,
    preferred_consultation_time: str(raw.preferred_consultation_time),
    site_visit_requested: raw.site_visit_requested === true,
    referral_source: str(raw.referral_source),
    preferences: str(raw.preferences),
    sentiment: oneOf(raw.sentiment, ["POSITIVE", "NEUTRAL", "FRUSTRATED", "ANGRY"] as const, "NEUTRAL"),
    complaint_summary: str(raw.complaint_summary),
    summary: str(raw.summary) ?? "",
  };
}

function parseJson(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  return JSON.parse(cleaned);
}

export async function classifyCall(call: Pick<CallInput, "turns" | "startedAt">): Promise<Classification> {
  const callerSaidAnything = call.turns.some((t) => t.speaker === "caller" && t.text.trim().split(/\s+/).length >= 4);
  if (!callerSaidAnything) {
    const facts = coerce({ intent: "NO_CONVERSATION", summary: "No conversation — missed or dropped call" });
    return { facts, decision: decide(facts), usage: { provider: "none", model: "", inputTokens: 0, outputTokens: 0, latencyMs: 0 } };
  }

  const dateIst = call.startedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" });
  const user = `Call date: ${dateIst} (IST)\n\nTranscript:\n${renderTranscript(call.turns)}`;

  const started = Date.now();
  let resp;
  let lastErr: unknown;
  for (const attempt of [callGemini, callGroq, callGemini]) {
    try {
      resp = await attempt(user);
      parseJson(resp.text);
      break;
    } catch (e) {
      lastErr = e;
      resp = undefined;
    }
  }
  if (!resp) throw new Error(`All LLM providers failed: ${String(lastErr)}`);

  const facts = coerce(parseJson(resp.text));
  return {
    facts,
    decision: decide(facts),
    usage: { provider: resp.provider, model: resp.model, inputTokens: resp.inputTokens, outputTokens: resp.outputTokens, latencyMs: Date.now() - started },
  };
}
