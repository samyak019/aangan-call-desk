// Offline tests of the decision boundary — no API keys needed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { detectPricingLeak, normaliseWebhook } from "../lib/call";
import { coerce } from "../lib/classifier";
import { decide } from "../lib/gates";
import type { ExtractedCall } from "../lib/types";

const base = (o: Partial<ExtractedCall>): ExtractedCall =>
  ({
    ...coerce({ intent: "NEW_ENQUIRY", summary: "test" }),
    segment: "RESIDENTIAL",
    service_requested: "DESIGN_AND_EXECUTION",
    locality: "Kothrud",
    city: "Pune",
    timeline_text: "by March",
    weeks_until_completion_needed: 26,
    decision_authority: "DECISION_MAKER",
    ...o,
  }) as ExtractedCall;

test("T01-style full home in Kothrud qualifies", () => {
  assert.equal(decide(base({ bhk: 3, carpet_area_sqft: 1400, full_home: true })).outcome, "QUALIFIED");
});

test("T03 Nashik fails geography", () => {
  const d = decide(base({ locality: null, city: "Nashik" }));
  assert.equal(d.outcome, "NOT_QUALIFIED");
  assert.deepEqual(d.failedGates, ["geography"]);
});

test("Talegaon fails even when city is given as Pune", () => {
  assert.deepEqual(decide(base({ locality: "Talegaon Dabhade", city: "Pune" })).failedGates, ["geography"]);
});

test("T04 advice-only fails scope", () => {
  assert.deepEqual(decide(base({ service_requested: "ADVICE_ONLY" })).failedGates, ["scope"]);
});

test("T07 Diwali in 3 weeks fails timeline", () => {
  assert.deepEqual(decide(base({ weeks_until_completion_needed: 3, timeline_text: "before Diwali" })).failedGates, ["timeline"]);
});

test("T10 ₹1.5L for kitchen + bedroom fails budget", () => {
  const d = decide(base({ locality: "Kharadi", bhk: 1, carpet_area_sqft: 550, full_home: false, rooms_in_scope: ["kitchen", "bedroom"], budget_text: "1 to 1.5 lakh", budget_max_inr: 150000 }));
  assert.deepEqual(d.failedGates, ["budget"]);
});

test("A sensible volunteered budget passes", () => {
  const d = decide(base({ bhk: 3, carpet_area_sqft: 1400, full_home: true, budget_text: "15-20 lakh", budget_max_inr: 2000000 }));
  assert.equal(d.outcome, "QUALIFIED");
});

test("T18 180 sq ft coworking pod fails scope", () => {
  const d = decide(base({ segment: "COMMERCIAL_OFFICE", commercial_category: "coworking pod", locality: null, carpet_area_sqft: 180 }));
  assert.deepEqual(d.failedGates, ["scope"]);
});

test("T19 restaurant fails scope", () => {
  assert.deepEqual(decide(base({ segment: "COMMERCIAL_OTHER", commercial_category: "restaurant", locality: "Koregaon Park" })).failedGates, ["scope"]);
});

test("T06 800 sq ft Baner office qualifies", () => {
  assert.equal(decide(base({ segment: "COMMERCIAL_OFFICE", commercial_category: "office", locality: "Baner", carpet_area_sqft: 800 })).outcome, "QUALIFIED");
});

test("T09 complaint escalates", () => {
  assert.equal(decide(base({ intent: "EXISTING_PROJECT_COMPLAINT" })).outcome, "ESCALATE");
});

test("T14 calling for parents: qualified with a decision-maker note", () => {
  const d = decide(base({ locality: "Hadapsar", decision_authority: "RESEARCHING_FOR_OTHERS", decision_notes: "Son calling; parents decide and will attend" }));
  assert.equal(d.outcome, "QUALIFIED");
  assert.ok(d.notes.some((n) => n.startsWith("Decision-maker")));
});

test("Unknown location → one follow-up question, not a handoff", () => {
  const d = decide(base({ locality: null, city: null }));
  assert.equal(d.outcome, "NEEDS_FOLLOW_UP");
  assert.match(d.followUpQuestion ?? "", /Which area of Pune/);
});

test("Missing timeline still forwards, with the question in the note", () => {
  const d = decide(base({ timeline_text: null, weeks_until_completion_needed: null }));
  assert.equal(d.outcome, "QUALIFIED");
  assert.ok(d.notes.some((n) => n.includes("When would you need the project complete?")));
});

test("Two failed gates → declined", () => {
  const d = decide(base({ city: "Mumbai", locality: null, service_requested: "ADVICE_ONLY" }));
  assert.equal(d.outcome, "NOT_QUALIFIED");
  assert.equal(d.failedGates.length, 2);
});

test("Pricing guardrail: agent quoting a rate is caught", () => {
  assert.ok(detectPricingLeak([{ speaker: "agent", text: "We usually charge ₹1,800 per sq ft for standard." }]));
  assert.ok(detectPricingLeak([{ speaker: "agent", text: "For a 2BHK it's typically 12 lakh." }]));
});

test("Pricing guardrail: echoing the caller's own budget (T10) is not a leak", () => {
  assert.equal(
    detectPricingLeak([
      { speaker: "caller", text: "My budget is 1 to 1.5 lakh maximum for everything." },
      { speaker: "agent", text: "For that scope, 1 to 1.5 lakh would be significantly below what it would cost with us." },
    ]),
    null,
  );
});

test("Pricing guardrail: the deflection script is clean", () => {
  assert.equal(
    detectPricingLeak([{ speaker: "agent", text: "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it." }]),
    null,
  );
});

test("Pricing guardrail: words ending in 'rs' are not rupees (T02 false alarm)", () => {
  assert.equal(
    detectPricingLeak([{ speaker: "agent", text: "The best way is a consultation with one of our designers, who can walk you through everything." }]),
    null,
  );
  assert.ok(detectPricingLeak([{ speaker: "agent", text: "It's about Rs. 1,800 per sq ft." }]));
  assert.ok(detectPricingLeak([{ speaker: "agent", text: "Usually around ₹12 lakh." }]));
});

test("Vaani transcript format: timestamps stripped, AGENT/USER mapped, duration and phone found", () => {
  const c = normaliseWebhook({
    call_id: "outbound-1",
    data: { customer: { phone_number: "+91 98765 43210" } },
    transcript: "[13:04:30] AGENT: Good evening, Aangan Studio.\n[13:04:35] USER: I need a three BHK flat done.\n[13:06:10] AGENT: When would you need it complete?",
  });
  assert.deepEqual(c.turns.map((t) => t.speaker), ["agent", "caller", "agent"]);
  assert.equal(c.turns[1].text, "I need a three BHK flat done.");
  assert.equal(c.callerPhone, "+91 98765 43210");
  assert.equal(c.durationSeconds, 100);
});
