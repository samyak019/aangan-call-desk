// Everything Nikhil used to pull by hand, computed from the database.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, dbConfigured } from "./db";
import type { GateName, Outcome } from "./types";

export interface Row {
  ts: string;
  endedAt: string | null;
  durationSeconds: number;
  afterHours: boolean;
  status: string;
  outcome: Outcome | null;
  failedGates: GateName[];
  notifiedAt: string | null;
  bookedSlot: string | null;
  askedPricing: boolean;
  pricingLeak: boolean;
  name: string | null;
  phone: string | null;
  location: string | null;
  project: string | null;
  summary: string | null;
  billedCost: number;
  shadowCost: number;
}

export async function loadRows(sinceDays = 30): Promise<{ rows: Row[]; demo: boolean }> {
  if (!dbConfigured()) {
    try {
      const raw = await readFile(path.join(process.cwd(), "fixtures", "demo_rows.json"), "utf8");
      return { rows: JSON.parse(raw), demo: true };
    } catch {
      return { rows: [], demo: true };
    }
  }
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const { data, error } = await db()
    .from("calls")
    .select(
      "call_timestamp, call_ended_at, duration_seconds, after_hours, status, agent_pricing_leak, caller_phone, " +
        "leads(qualification_status, failed_gates, notified_at, booked_slot, asked_for_pricing, caller_name, location, project_type, handoff_payload), " +
        "system_costs(total_cost, shadow_voice_cost, shadow_llm_cost)",
    )
    .gte("call_timestamp", since)
    .order("call_timestamp", { ascending: false })
    .limit(5000);
  if (error) throw error;
  const one = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x);
  const rows: Row[] = (data ?? []).map((c: any) => {
    const l = one(c.leads) as any;
    const s = one(c.system_costs) as any;
    return {
      ts: c.call_timestamp,
      endedAt: c.call_ended_at,
      durationSeconds: c.duration_seconds,
      afterHours: c.after_hours,
      status: c.status,
      outcome: l?.qualification_status ?? null,
      failedGates: l?.failed_gates ?? [],
      notifiedAt: l?.notified_at ?? null,
      bookedSlot: l?.booked_slot ?? null,
      askedPricing: l?.asked_for_pricing ?? false,
      pricingLeak: c.agent_pricing_leak,
      name: l?.caller_name ?? null,
      phone: c.caller_phone,
      location: l?.location ?? null,
      project: l?.project_type ?? null,
      summary: l?.handoff_payload?.facts?.summary ?? null,
      billedCost: Number(s?.total_cost ?? 0),
      shadowCost: Number(s?.shadow_voice_cost ?? 0) + Number(s?.shadow_llm_cost ?? 0),
    };
  });
  return { rows, demo: false };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarise(rows: Row[]) {
  const by = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
  const enquiries = rows.filter((r) => r.outcome && ["QUALIFIED", "NOT_QUALIFIED", "NEEDS_FOLLOW_UP"].includes(r.outcome)).length;
  const qualified = rows.filter((r) => r.outcome === "QUALIFIED");
  const handoffSecs = qualified
    .filter((r) => r.notifiedAt && r.endedAt)
    .map((r) => (new Date(r.notifiedAt!).getTime() - new Date(r.endedAt!).getTime()) / 1000);
  const gateCounts: Record<GateName, number> = { scope: 0, geography: 0, timeline: 0, budget: 0, authority: 0 };
  rows.forEach((r) => r.failedGates.forEach((g) => (gateCounts[g] += 1)));
  const billed = rows.reduce((a, r) => a + r.billedCost, 0);
  const shadow = rows.reduce((a, r) => a + r.shadowCost, 0);

  return {
    calls: rows.length,
    answered: rows.filter((r) => r.status === "COMPLETED").length,
    missedOrDropped: rows.filter((r) => r.status !== "COMPLETED").length,
    afterHours: rows.filter((r) => r.afterHours).length,
    afterHoursAnswered: rows.filter((r) => r.afterHours && r.status === "COMPLETED").length,
    enquiries,
    qualified: qualified.length,
    notified: qualified.filter((r) => r.notifiedAt).length,
    booked: qualified.filter((r) => r.bookedSlot).length,
    outcomes: {
      QUALIFIED: by("QUALIFIED"),
      NEEDS_FOLLOW_UP: by("NEEDS_FOLLOW_UP"),
      NOT_QUALIFIED: by("NOT_QUALIFIED"),
      ESCALATE: by("ESCALATE"),
      EXISTING_CLIENT: by("EXISTING_CLIENT"),
      NOT_AN_ENQUIRY: by("NOT_AN_ENQUIRY"),
      MISSED: by("MISSED"),
    } as Record<Outcome, number>,
    gateCounts,
    medianHandoffSecs: median(handoffSecs),
    within5Min: handoffSecs.filter((s) => s <= 300).length,
    handoffMeasured: handoffSecs.length,
    askedPricing: rows.filter((r) => r.askedPricing).length,
    pricingLeaks: rows.filter((r) => r.pricingLeak).length,
    billed,
    shadow,
    shadowPerQualified: qualified.length ? shadow / qualified.length : null,
    voiceMinutes: rows.reduce((a, r) => a + r.durationSeconds, 0) / 60,
  };
}
