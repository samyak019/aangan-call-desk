// Runs the real classifier over the 20 September phone transcripts and scores it
// against the outcome the studio actually reached. Also renders every handoff note
// and writes fixtures/demo_rows.json for the dashboard's demo mode.
//
//   GEMINI_API_KEY=... npm run eval
import { writeFile } from "node:fs/promises";
import { detectPricingLeak, isAfterHours } from "../lib/call";
import { classifyCall } from "../lib/classifier";
import { computeCosts } from "../lib/costs";
import { formatOpsMessage, formatQualifiedLead } from "../lib/handoff_notifier";
import type { Row } from "../lib/metrics";
import type { Turn } from "../lib/types";
import calls from "../fixtures/phone_calls.json";

type Fixture = { id: string; phone: string; started_at: string; duration_seconds: number; expected: string[]; expected_failed_gate: string | null; turns: Turn[] };

async function main() {
  const rows: Row[] = [];
  let correct = 0;
  const misses: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  const seen = new Map<string, string>();

  for (const fx of calls as Fixture[]) {
    const startedAt = new Date(fx.started_at);
    const c = await classifyCall({ turns: fx.turns, startedAt });
    const { outcome, failedGates } = c.decision;
    const gateOk = !fx.expected_failed_gate || failedGates.includes(fx.expected_failed_gate as never);
    const ok = fx.expected.includes(outcome) && gateOk;
    if (ok) correct++;
    else misses.push(`${fx.id}: got ${outcome} [${failedGates.join(",")}], expected ${fx.expected.join("|")} ${fx.expected_failed_gate ?? ""}`);
    tokensIn += c.usage.inputTokens;
    tokensOut += c.usage.outputTokens;

    const ctx = {
      callerPhone: fx.phone,
      callStartedAt: startedAt,
      bookedSlot: null,
      repeatCallerNote: seen.has(fx.phone) ? `Repeat caller — called earlier at ${seen.get(fx.phone)}` : null,
      pricingLeak: false,
    };
    seen.set(fx.phone, startedAt.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }));

    console.log(`\n${ok ? "✅" : "❌"} ${fx.id}  ${outcome}${failedGates.length ? ` (failed: ${failedGates.join(", ")})` : ""}  · ${c.usage.provider} ${c.usage.latencyMs}ms`);
    if (outcome === "QUALIFIED") console.log(indent(formatQualifiedLead(c, ctx)));
    else if (["ESCALATE", "NEEDS_FOLLOW_UP", "MISSED"].includes(outcome)) console.log(indent(formatOpsMessage(outcome, c, ctx)));
    else console.log(indent(c.decision.notes.join("\n") || c.facts.summary));

    const endedAt = new Date(startedAt.getTime() + fx.duration_seconds * 1000);
    const costs = computeCosts({ durationSeconds: fx.duration_seconds, inputTokens: c.usage.inputTokens, outputTokens: c.usage.outputTokens, provider: c.usage.provider });
    rows.push({
      ts: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSeconds: fx.duration_seconds,
      afterHours: isAfterHours(startedAt),
      status: fx.turns.length ? (outcome === "MISSED" ? "DROPPED" : "COMPLETED") : "MISSED",
      outcome,
      failedGates,
      notifiedAt: ["QUALIFIED", "ESCALATE", "NEEDS_FOLLOW_UP", "MISSED"].includes(outcome) ? new Date(endedAt.getTime() + c.usage.latencyMs + 1500).toISOString() : null,
      bookedSlot: null,
      askedPricing: c.facts.asked_for_pricing,
      pricingLeak: Boolean(detectPricingLeak(fx.turns)),
      name: c.facts.caller_name,
      phone: fx.phone,
      location: [c.facts.locality, c.facts.city].filter(Boolean).join(", ") || null,
      project: c.facts.property_type,
      summary: c.facts.summary,
      billedCost: costs.stt_cost + costs.llm_cost + costs.tts_cost,
      shadowCost: costs.shadow_voice_cost + costs.shadow_llm_cost,
    });
  }

  rows.sort((a, b) => b.ts.localeCompare(a.ts));
  await writeFile(new URL("../fixtures/demo_rows.json", import.meta.url), JSON.stringify(rows, null, 1));

  console.log(`\n──────────\nAccuracy: ${correct}/${calls.length}`);
  misses.forEach((m) => console.log("  " + m));
  console.log(`LLM tokens: ${tokensIn} in / ${tokensOut} out (${Math.round((tokensIn + tokensOut) / calls.length)} per call)`);
  if (correct < calls.length) process.exitCode = 1;
}

const indent = (s: string) => s.split("\n").map((l) => "   " + l).join("\n");

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
