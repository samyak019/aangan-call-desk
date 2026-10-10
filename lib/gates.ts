// Decision boundary. The LLM extracts facts; this file — plain, testable code —
// applies Nikhil's five gates (qualified.md) to them. No model call can talk
// its way past a rule here.

import {
  BUDGET_FLOOR, COMMERCIAL_HARD_MAX_SQFT, COMMERCIAL_MAX_SQFT, COMMERCIAL_MIN_SQFT,
  FOLLOW_UP_QUESTIONS, IN_AREA_CITIES, MIN_WEEKS_TO_COMPLETION, OUT_OF_AREA,
  OUT_OF_SCOPE_COMMERCIAL, SERVICE_AREA, TIGHT_WEEKS_TO_COMPLETION,
} from "./rules";
import type { Decision, ExtractedCall, GateName, GateResult } from "./types";

const pass = (reason: string): GateResult => ({ status: "PASS", reason });
const fail = (reason: string): GateResult => ({ status: "FAIL", reason });
const unclear = (reason: string): GateResult => ({ status: "UNCLEAR", reason });

function matchAny(haystack: string | null | undefined, needles: string[]): string | null {
  if (!haystack) return null;
  const h = ` ${haystack.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  for (const n of needles) {
    const k = ` ${n.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
    if (h.includes(k)) return n;
  }
  return null;
}

// Gate 1 — real project: design AND execution, a kind of space we do.
export function scopeGate(f: ExtractedCall): GateResult {
  const svc = f.service_requested;
  if (svc === "ADVICE_ONLY") return fail("Wants advice/ideas only — minimum engagement is a room redesign with execution");
  if (svc === "DESIGN_ONLY_DIY_EXECUTION") return fail("Wants design only and will execute themselves");
  if (svc === "VASTU_ONLY") return fail("Standalone Vastu consultation — not offered");
  if (svc === "FURNITURE_SOURCING_ONLY") return fail("Furniture sourcing without a design project — not offered");
  if (svc === "STRUCTURAL_OR_ARCHITECTURE") return fail("Structural/architectural work — we are interior designers, not architects");

  const isCommercial = f.segment === "COMMERCIAL_OFFICE" || f.segment === "COMMERCIAL_OTHER";
  if (isCommercial && f.carpet_area_sqft != null) {
    if (f.carpet_area_sqft < COMMERCIAL_MIN_SQFT)
      return fail(`${f.carpet_area_sqft} sq ft commercial space is below our ~${COMMERCIAL_MIN_SQFT} sq ft minimum`);
    if (f.carpet_area_sqft > COMMERCIAL_HARD_MAX_SQFT)
      return fail(`${f.carpet_area_sqft} sq ft office is above our ~${COMMERCIAL_MAX_SQFT} sq ft ceiling`);
  }

  const badCategory = matchAny(f.commercial_category, OUT_OF_SCOPE_COMMERCIAL);
  if (badCategory) return fail(`${f.commercial_category} is outside scope — we don't do restaurants, hotels, retail or gyms`);
  if (f.segment === "COMMERCIAL_OTHER")
    return fail(`${f.commercial_category ?? "This space"} isn't a home or office — outside our scope`);

  if (svc === "UNCLEAR")
    return unclear(f.just_exploring ? "Early stage / exploring — not yet clear it's a design + execution project" : "Not clear whether they want design and execution");
  return pass("Design + execution");
}

// Gate 2 — Pune city or PCMC.
export function geographyGate(f: ExtractedCall): GateResult {
  const where = [f.locality, f.city].filter(Boolean).join(", ");
  const out = matchAny(where, OUT_OF_AREA);
  if (out) return fail(`Site is in ${where} — outside Pune/PCMC`);
  const inArea = matchAny(where, SERVICE_AREA);
  if (inArea) return pass(`${where} is in the service area`);
  if (matchAny(f.city, IN_AREA_CITIES)) return pass(`${where} (Pune/PCMC)`);
  if (f.city) return fail(`Site is in ${f.city} — outside Pune/PCMC`);
  if (f.locality) return unclear(`Couldn't place "${f.locality}" — confirm it's within Pune/PCMC`);
  return unclear("Location not mentioned");
}

// Gate 3 — realistic timeline.
export function timelineGate(f: ExtractedCall): GateResult {
  const w = f.weeks_until_completion_needed;
  if (w != null && w < MIN_WEEKS_TO_COMPLETION)
    return fail(`Needs it done in ~${Math.max(0, Math.round(w))} weeks — design alone takes 3–4 weeks; minimum lead time is ${MIN_WEEKS_TO_COMPLETION}`);
  if (w != null && w < TIGHT_WEEKS_TO_COMPLETION)
    return pass(`Tight: needs completion in ~${Math.round(w)} weeks (${f.timeline_text ?? ""})`.trim());
  if (f.timeline_text || f.timeline_flexible || f.weeks_until_execution_can_start != null)
    return pass(f.timeline_text ?? "Flexible");
  return unclear("Timeline not discussed");
}

// Gate 4 — budget only fails when the caller VOLUNTEERED a number that is clearly too low.
export function estimateFloorInr(f: ExtractedCall): number | null {
  const area =
    f.carpet_area_sqft ?? (f.bhk != null ? BUDGET_FLOOR.typicalCarpetByBhk[Math.min(5, Math.max(1, f.bhk))] : null);
  if (f.segment === "COMMERCIAL_OFFICE") return area != null ? area * BUDGET_FLOOR.commercialPerSqft : null;
  if (f.full_home && area != null) return area * BUDGET_FLOOR.residentialPerSqft;
  const rooms = Math.max(1, f.rooms_in_scope.length);
  return rooms * BUDGET_FLOOR.singleRoom;
}

export function budgetGate(f: ExtractedCall): GateResult {
  if (f.budget_max_inr == null) return pass(f.budget_text ? `Mentioned: ${f.budget_text}` : "Not mentioned — not probed");
  const floor = estimateFloorInr(f);
  if (floor != null && f.budget_max_inr < floor * BUDGET_FLOOR.clearlyBelowRatio)
    return fail(`Volunteered budget (${f.budget_text ?? f.budget_max_inr}) is clearly below what this scope costs`);
  return pass(`Mentioned: ${f.budget_text ?? f.budget_max_inr}`);
}

// Gate 5 — decision-maker or authorised. Never pushed: unclear passes with a note.
export function authorityGate(f: ExtractedCall): GateResult {
  switch (f.decision_authority) {
    case "DECISION_MAKER":
      return pass(f.decision_notes ?? "Caller is the decision-maker");
    case "AUTHORISED_REPRESENTATIVE":
      return pass(f.decision_notes ?? "Calling with authority on behalf of the owner");
    case "NO_AUTHORITY":
      return fail(f.decision_notes ?? "Caller has no authority over the project");
    default:
      return unclear(f.decision_notes ?? "not confirmed on the call");
  }
}

export function decide(f: ExtractedCall): Decision {
  const base = { gates: null, failedGates: [] as GateName[], followUpQuestion: null, notes: [] as string[] };

  if (f.intent === "NO_CONVERSATION") return { ...base, outcome: "MISSED", notes: ["Call dropped / no conversation — call back"] };
  if (f.intent === "EXISTING_PROJECT_COMPLAINT")
    return { ...base, outcome: "ESCALATE", notes: [f.complaint_summary ?? f.summary] };
  if (f.intent === "EXISTING_PROJECT_QUERY") return { ...base, outcome: "EXISTING_CLIENT", notes: [f.summary] };
  if (f.intent === "VENDOR_OR_JOB" || f.intent === "SPAM_OR_WRONG_NUMBER")
    return { ...base, outcome: "NOT_AN_ENQUIRY", notes: [f.summary] };

  const gates: Record<GateName, GateResult> = {
    scope: scopeGate(f),
    geography: geographyGate(f),
    timeline: timelineGate(f),
    budget: budgetGate(f),
    authority: authorityGate(f),
  };
  const failedGates = (Object.keys(gates) as GateName[]).filter((g) => gates[g].status === "FAIL");
  const notes: string[] = [];

  // qualified.md: "If it fails one, close gracefully — don't forward an incomplete lead."
  if (failedGates.length > 0) {
    return { outcome: "NOT_QUALIFIED", gates, failedGates, followUpQuestion: null, notes: failedGates.map((g) => gates[g].reason) };
  }

  // Unclear on scope or geography → one direct question before a designer spends time.
  for (const g of ["scope", "geography"] as const) {
    if (gates[g].status === "UNCLEAR")
      return { outcome: "NEEDS_FOLLOW_UP", gates, failedGates, followUpQuestion: FOLLOW_UP_QUESTIONS[g], notes: [gates[g].reason] };
  }

  // Unclear timeline doesn't hold the lead back (the agent asks on the call; if the caller
  // didn't know, "not knowing exactly what they want" doesn't disqualify). Speed wins: a lead
  // answered in <1 hr converts 4×. Forward it with the gap called out.
  if (gates.timeline.status === "UNCLEAR") notes.push(`Timeline not confirmed — ask: "${FOLLOW_UP_QUESTIONS.timeline}"`);
  if (gates.timeline.reason.startsWith("Tight")) notes.push(gates.timeline.reason);
  if (gates.authority.status === "UNCLEAR") notes.push(`Decision-maker: ${gates.authority.reason}`);
  return { outcome: "QUALIFIED", gates, failedGates, followUpQuestion: null, notes };
}
