// Live conversational turn for the in-browser voice agent ("Meher").
// Same persona and rules as prompts/vaani_agent_prompt.md; Gemini with minimal thinking
// so a spoken reply comes back in ~1.5 s.

import { readFileSync } from "node:fs";
import path from "node:path";
import { detectPricingLeak } from "./call";
import { SCRIPTS } from "./rules";
import type { Turn } from "./types";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
export const END_TOKEN = "[END]";

let cachedPrompt: string | null = null;

function systemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;
  const raw = readFileSync(path.join(process.cwd(), "prompts", "vaani_agent_prompt.md"), "utf8");
  const persona = raw.split(/\n---\n/).slice(1).join("\n---\n").trim() || raw;
  cachedPrompt = `${persona}

## This call
- This is a voice call through the studio's website. Everything you write is spoken aloud by a text-to-speech voice, so write plain spoken sentences only: no lists, no markdown, no emoji, no symbols such as ₹ or /.
- Keep every reply to one or two short sentences and ask only one question at a time.
- There is no calendar tool on this line. When the enquiry fits, ask which day and time suits them for the consultation, then say a designer will call them within the hour to confirm it.
- If they have not given their name, ask for it before you close.
- When the conversation is finished (you have closed politely, or they say goodbye), say a short goodbye and end your reply with ${END_TOKEN}.`;
  return cachedPrompt;
}

export async function agentTurn(turns: Turn[]): Promise<{ reply: string; end: boolean }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");

  const contents = turns.map((t) => ({ role: t.speaker === "agent" ? "model" : "user", parts: [{ text: t.text }] }));
  // Gemini needs the conversation to start with a user turn.
  if (contents[0]?.role === "model") contents.unshift({ role: "user", parts: [{ text: "(The caller has dialled the studio.)" }] });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents,
      generationConfig: { temperature: 0.5, maxOutputTokens: 300, thinkingConfig: { thinkingLevel: "minimal" } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const parts: { text?: string; thought?: boolean }[] = j.candidates?.[0]?.content?.parts ?? [];
  let reply = parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("").trim();

  const end = reply.includes(END_TOKEN);
  reply = reply.replace(END_TOKEN, "").replace(/[*_#`]/g, "").trim();

  // Hard guardrail: whatever the model says, no price leaves this server.
  const callerTurns = turns.filter((t) => t.speaker === "caller");
  if (detectPricingLeak([...callerTurns, { speaker: "agent", text: reply }])) {
    reply = SCRIPTS.pricingDeflection;
  }
  return { reply: reply || "Sorry, could you say that again?", end };
}

// Sanitise turns posted from the browser.
export function cleanTurns(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-40)
    .map((t: { speaker?: string; text?: unknown }) => ({
      speaker: t?.speaker === "agent" ? "agent" : "caller",
      text: String(t?.text ?? "").slice(0, 1500).trim(),
    }))
    .filter((t) => t.text) as Turn[];
}
