// One call in → stored, classified, handed off, costed.

import { detectPricingLeak, isAfterHours } from "./call";
import { classifyCall } from "./classifier";
import { computeCosts } from "./costs";
import { db } from "./db";
import { alertManagement, dispatchHandoff } from "./handoff_notifier";
import { createDeal, hubspotConfigured } from "./hubspot";
import type { CallInput } from "./types";

const STITCH_WINDOW_MS = 30 * 60 * 1000;

export async function processCall(input: CallInput) {
  const sb = db();

  // Idempotency: the voice platform may retry the webhook.
  const existing = await sb.from("calls").select("id, processed_at").eq("external_call_id", input.externalCallId).maybeSingle();
  if (existing.data?.processed_at) return { callId: existing.data.id, duplicate: true };

  const endedAt = new Date(input.startedAt.getTime() + input.durationSeconds * 1000);
  const rawTranscript = input.turns.map((t) => `${t.speaker === "agent" ? "Agent" : "Caller"}: ${t.text}`).join("\n");
  const leak = detectPricingLeak(input.turns);

  // History for this number: dropped-call stitching (T17) and repeat-caller context (T16).
  let previousCallId: string | null = null;
  let repeatCallerNote: string | null = null;
  if (input.callerPhone) {
    const prev = await sb
      .from("calls")
      .select("id, call_timestamp, leads(qualification_status)")
      .eq("caller_phone", input.callerPhone)
      .lt("call_timestamp", input.startedAt.toISOString())
      .order("call_timestamp", { ascending: false })
      .limit(5);
    const rows = prev.data ?? [];
    if (rows[0] && input.startedAt.getTime() - new Date(rows[0].call_timestamp).getTime() < STITCH_WINDOW_MS) previousCallId = rows[0].id;
    if (rows.length) {
      const last = new Date(rows[0].call_timestamp).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
      repeatCallerNote = `Repeat caller — ${rows.length} earlier call(s), last on ${last}`;
    }
  }

  const callRow = {
    external_call_id: input.externalCallId,
    caller_phone: input.callerPhone,
    call_timestamp: input.startedAt.toISOString(),
    call_ended_at: endedAt.toISOString(),
    duration_seconds: input.durationSeconds,
    raw_transcript: rawTranscript,
    status: input.turns.length === 0 ? "MISSED" : "COMPLETED",
    after_hours: isAfterHours(input.startedAt),
    previous_call_id: previousCallId,
    agent_pricing_leak: Boolean(leak),
  };
  const ins = await sb.from("calls").upsert(callRow, { onConflict: "external_call_id" }).select("id").single();
  if (ins.error) throw ins.error;
  const callId: string = ins.data.id;

  const classification = await classifyCall(input);
  const { facts, decision } = classification;
  if (decision.outcome === "MISSED" && input.turns.length > 0) await sb.from("calls").update({ status: "DROPPED" }).eq("id", callId);

  // A slot the agent booked mid-call through /api/tools/book-consultation.
  let bookedSlot = input.bookedSlot ?? null;
  if (!bookedSlot && input.callerPhone) {
    const b = await sb
      .from("tool_bookings")
      .select("slot_start")
      .eq("caller_phone", input.callerPhone)
      .gte("created_at", input.startedAt.toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    bookedSlot = b.data?.slot_start ?? null;
  }

  const dispatch = await dispatchHandoff(classification, {
    callerPhone: input.callerPhone,
    callStartedAt: input.startedAt,
    bookedSlot,
    repeatCallerNote,
    pricingLeak: Boolean(leak),
  });

  if (leak) {
    await alertManagement(
      `⚠️ PRICING GUARDRAIL — the voice agent said a figure on a call\n- Caller: ${input.callerPhone ?? "withheld"}\n- Line: "${leak.slice(0, 300)}"\n- Review the agent prompt; pricing.md forbids any number.`,
    );
  }

  // Qualified call → HubSpot contact + deal. A CRM hiccup must never block the handoff.
  let hubspotDealId: string | null = null;
  let hubspotError: string | null = null;
  if (decision.outcome === "QUALIFIED" && hubspotConfigured()) {
    try {
      hubspotDealId = (await createDeal(classification, { callerPhone: input.callerPhone, bookedSlot, handoffText: dispatch.text })).dealId;
    } catch (e) {
      hubspotError = String(e);
      console.error("HubSpot failed", e);
    }
  }

  const projectType = [facts.property_type, facts.full_home ? "full home" : facts.rooms_in_scope.join(", ")].filter(Boolean).join(" — ");
  const leadRow = {
    call_id: callId,
    caller_name: facts.caller_name,
    project_type: projectType || null,
    location: [facts.locality, facts.city].filter(Boolean).join(", ") || null,
    carpet_area: facts.carpet_area_sqft != null ? Math.round(facts.carpet_area_sqft) : null,
    timeline: facts.timeline_text,
    budget_mentioned: facts.budget_text,
    qualification_status: decision.outcome,
    failed_gates: decision.failedGates,
    gate_results: decision.gates,
    follow_up_question: decision.followUpQuestion,
    asked_for_pricing: facts.asked_for_pricing,
    booked_slot: bookedSlot,
    handoff_payload: { message: dispatch.text, facts, notes: decision.notes, pricing_leak_line: leak, dispatch_error: dispatch.error ?? null, hubspot_error: hubspotError },
    hubspot_deal_id: hubspotDealId,
    notified_at: dispatch.sent ? new Date().toISOString() : null,
    notify_channel: dispatch.channel,
  };
  const lead = await sb.from("leads").upsert(leadRow, { onConflict: "call_id" });
  if (lead.error) throw lead.error;

  const costs = computeCosts({
    durationSeconds: input.durationSeconds,
    inputTokens: classification.usage.inputTokens,
    outputTokens: classification.usage.outputTokens,
    provider: classification.usage.provider,
  });
  await sb.from("system_costs").upsert({ call_id: callId, ...costs }, { onConflict: "call_id" });
  await sb.from("calls").update({ processed_at: new Date().toISOString() }).eq("id", callId);

  return { callId, outcome: decision.outcome, notified: dispatch.sent, channel: dispatch.channel, dispatchError: dispatch.error, hubspotDealId };
}
