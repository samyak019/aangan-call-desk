// Sends a sample qualified-lead handoff through the real email path (Gmail SMTP).
//   npm run email:test -- you@example.com
import { dispatchHandoff } from "../lib/handoff_notifier";
import { coerce } from "../lib/classifier";
import { decide } from "../lib/gates";

const to = process.argv[2] || process.env.HANDOFF_EMAIL_DESIGNERS;
if (!to) {
  console.error("Usage: npm run email:test -- you@example.com");
  process.exit(1);
}
process.env.HANDOFF_EMAIL_DESIGNERS = to;
delete process.env.TELEGRAM_DESIGNERS_CHAT_ID; // test the email path only

const facts = coerce({
  intent: "NEW_ENQUIRY", caller_name: "Priya (TEST)", segment: "RESIDENTIAL", property_type: "3BHK apartment",
  bhk: 3, locality: "Kothrud — Dahanukar Colony", city: "Pune", carpet_area_sqft: 1400, full_home: true,
  rooms_in_scope: ["kitchen", "living room", "2 bedrooms"], service_requested: "DESIGN_AND_EXECUTION",
  timeline_text: "done by March, no rush", weeks_until_completion_needed: 24, decision_authority: "DECISION_MAKER",
  decision_notes: "Co-owner with husband; he approved going ahead", referral_source: "referral from Shruti Joshi",
  summary: "TEST — full-home redesign of a 1,400 sq ft 3BHK in Kothrud, done by March.",
});
const c = { facts, decision: decide(facts), usage: { provider: "test", model: "", inputTokens: 0, outputTokens: 0, latencyMs: 0 } };

dispatchHandoff(c, { callerPhone: "+91 98•••••001", callStartedAt: new Date(), bookedSlot: null, repeatCallerNote: null, pricingLeak: false })
  .then((r) => {
    console.log(r.sent ? `✓ Sent via ${r.channel} to ${to}` : `✗ Not sent: ${r.error}`);
    if (!r.sent) process.exit(1);
  });
