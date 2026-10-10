# Aangan Studio — Inbound Call Qualification & Lead Handoff

Every call to the studio is answered within a few seconds, at any hour, by a voice agent. The agent qualifies the caller against Nikhil's five gates and books qualified callers into a consultation. Within seconds of the call ending, the right person gets a complete handoff note by email (Gmail). Every call, outcome and rupee of running cost lands on a dashboard.

```
Caller ──► Vaani voice agent (STT → LLM → TTS, free tier)
            │  prompt: prompts/vaani_agent_prompt.md
            │  mid-call tools ─► /api/tools/check-availability ─► Cal.com
            │                 └► /api/tools/book-consultation  ─► Cal.com + tool_bookings
            ▼  call ends
   POST /api/vaani/webhook
            │ 1. normalise payload, idempotency on call id         lib/call.ts
            │ 2. pricing guardrail on agent turns                   lib/call.ts
            │ 3. Gemini Flash → strict JSON facts (Groq fallback)   lib/classifier.ts
            │ 4. five gates, deterministic code                     lib/gates.ts + lib/rules.ts
            │ 5. route: designers / Nikhil / front desk             lib/handoff_notifier.ts
            │ 6. qualified → HubSpot contact + deal                 lib/hubspot.ts
            │ 7. write calls, leads, system_costs                   lib/pipeline.ts → Supabase
            ▼
   Dashboard (/) on Vercel: funnel, outcomes, decline reasons, speed, guardrails, cost
```

**Design rule: the LLM extracts facts, and code decides.** The model reports what was said (location, scope, timeline, volunteered budget and so on). Qualification lives in `lib/gates.ts`, which is plain code with unit tests, so a model can't talk its way past a rule. Changing a rule (a new locality, a different minimum size) is a one-line edit in `lib/rules.ts`.

## Results on the September transcripts

`npm run eval` replays all 20 phone calls from *Aangan_Sep 2026_Enquiries* through the real classifier. T17 counts as two calls, the dropped one and the call-back.

| Call | Outcome | Why |
|---|---|---|
| T01, T02, T05, T06, T11–T15, T17b, T20 | QUALIFIED → designers | All gates pass (T02/T13 asked for pricing and were deflected; T14 forwarded with a "parents decide" note) |
| T03 | Declined | Nashik: outside Pune/PCMC |
| T04 | Declined | Wants ideas only, no execution |
| T07 | Declined | Wants it before Diwali, ~3 weeks away |
| T10 | Declined | Volunteered ₹1–1.5 L for a kitchen and a bedroom |
| T18 | Declined | 180 sq ft pod, below the ~500 sq ft minimum |
| T19 | Declined | Restaurant |
| T09 | ESCALATE → Nikhil | Existing client complaint |
| T08, T17a | MISSED → front desk call-back | No conversation |
| T16 | QUALIFIED or NEEDS_FOLLOW_UP | Scope wasn't stated; either way it is flagged as a frustrated repeat caller |

**Score: 21/21** (two runs, `gemini-3.6-flash`). Each call uses about 2.5k tokens, and the handoff fires about 5–10 s after the call ends. `npm test` runs 18 offline tests of the gates and the pricing guardrail, with no keys needed.

## The decision boundary

| Situation | What happens |
|---|---|
| Any gate clearly fails | NOT_QUALIFIED. The agent closes with the decline script. Logged, nobody notified |
| Scope or location unclear | NEEDS_FOLLOW_UP. One question goes to the front desk ("Which area of Pune is the property in?") |
| Timeline unclear | Forwarded, with "Timeline not confirmed — ask: …" in the note. Speed beats completeness: a lead answered in under 1 hour converts at 4× |
| Budget or decision-maker unclear | Forwarded, with a note (qualified.md: "do not push") |
| Existing project complaint | ESCALATE to Nikhil's chat immediately |
| Caller asks for price | Deflected word-for-word. **Not** a disqualifier. The designer is told to come ready to discuss numbers |

## The Cut: no price quotes

Nikhil asked for the agent to "quote our standard per-square-foot pricing." It doesn't. His own `pricing.md` says *"No number from this guide should be quoted to a client"*, and his front desk already refuses (T02, T13). The guide's own standard-to-luxury spread is about 2×, so any number given on a call is wrong for most callers and anchors the negotiation. The agent uses the deflection script, and three layers enforce it:
1. The prompt rule (`prompts/vaani_agent_prompt.md`). The pricing numbers are never put in the agent's context.
2. A post-call guardrail (`detectPricingLeak`) flags any ₹ figure or per-sq-ft rate the agent says that the caller didn't say first, and emails Nikhil an alert.
3. The dashboard shows a "Calls where the agent said a ₹ figure" counter, with a target of 0.

What Nikhil actually wants is for nobody to wait for the price, and that is met by booking the consultation during the call.

## Why Gmail, not Telegram

- **Designers already live in it.** The studio runs on email: client threads, vendor quotes and site photos. A lead in Gmail sits next to everything else about that client. There's no new app to install and no group chat to babysit.
- **It's the record.** Each lead is its own thread. The designer replies, forwards it to a colleague, or searches "Kothrud 3BHK" six months later. In a Telegram group, lead #40 is buried under 39 others.
- **Free, with no domain setup.** Gmail SMTP with an App Password sends about 500 emails a day for free. Aangan gets about 200 calls a month. Unlike Resend, no DNS records or domain verification are needed.
- **Speed is protected by the subject line.** The weakness of email is that a lead can sit unread. Subjects are prefixed (`[Aangan Lead]`, `[Aangan URGENT]`, `[Aangan Follow-up]`, `[Aangan Call-back]`), so a one-line Gmail filter can mark leads Important and star them. Phone notifications then fire for those emails only. The dashboard tracks call-end → email-sent time against the 5-minute promise.
- **Routing by audience.** Three recipient lists: designers (qualified leads), Nikhil (complaints and pricing-guardrail alerts) and front desk (call-backs and one-question follow-ups). Nobody gets an email for a declined call.
- **Fallback.** If Gmail fails, the same note goes to Telegram when that's configured. Every handoff is also saved in `leads.handoff_payload`.

**Trade-off we accepted:** Telegram would buzz a designer's phone about a second faster. But the 4× conversion gain is measured against *the next day*, not the next minute. An Important-flagged email seen within the hour captures that gain, and it keeps the lead in the tool where the project will actually be run.

## Cost: $0.00, tracked per call

Each call gets a `system_costs` row with tokens, voice minutes and **billed** cost, which is $0 while every service is on its free tier. It also gets a **shadow** cost: the same usage priced at paid rates, which you set in `.env`. The dashboard shows both, plus the shadow cost per qualified lead. Nikhil sees the real unit economics before the free tier runs out. Against an ₹8–14 L average project, the cost is a rounding error.

| Layer | Service | Free tier |
|---|---|---|
| Voice | Vaani (MESA invite code) | Platform free tier |
| LLM | Gemini Flash (Groq fallback) | AI Studio free tier |
| DB | Supabase | 500 MB Postgres |
| Calendar | Cal.com | Individual plan |
| Handoff | Gmail SMTP + App Password (Telegram fallback) | Free, ~500 emails/day |
| CRM | HubSpot | Free CRM, forever |
| Hosting | Vercel Hobby | Free |

## Setup

1. **Database.** Create a Supabase project, then run `db/schema.sql` in the SQL editor. Copy the URL and the *service-role* key.
2. **Gmail.** Use a dedicated account, such as `aangan.calldesk@gmail.com`. Turn on 2-Step Verification, then create an App Password at myaccount.google.com/apppasswords. Put the address, password and the three recipient lists in the env vars. Check it with `npm run email:test -- you@example.com`. Then, in each designer's Gmail, create a filter: `subject:[Aangan` → *Always mark as important* + *Star it*.
3. **Gemini.** Get a free key at aistudio.google.com.
4. **Cal.com.** Create a "Design consultation" event type. Copy its id and an API key (Settings → Developer).
5. **HubSpot.** Settings → Integrations → Private apps. Create one with contacts and deals write scopes and copy the token. Each qualified call becomes a contact plus a deal: "Qualified to buy", or "Appointment scheduled" if it was booked on the call. A HubSpot failure is logged but never blocks the email handoff.
6. Copy `.env.example` to `.env.local` and fill it in. Then run:
   ```bash
   npm install && npm test && npm run eval
   ```
7. **Deploy.** Import the folder into Vercel, add the same env vars, and set `DASHBOARD_PASSWORD`.
8. **Vaani.** Sign up with your MESA invite code and create an agent:
   - Paste `prompts/vaani_agent_prompt.md` as the system prompt.
   - Set the post-call webhook to `https://<app>.vercel.app/api/vaani/webhook?secret=<VAANI_WEBHOOK_SECRET>`.
   - If the platform supports custom HTTP tools, add `check_availability` and `book_consultation` pointing at `/api/tools/...` with the same secret.
   - Attach the studio number, or forward to it.
   - The webhook accepts the common payload shapes (`transcript` as a string or as a list of `{role, content}`, plus `call_id`, `from`, `duration`, `started_at`). If Vaani names fields differently, map them in `normaliseWebhook` in `lib/call.ts`.
9. **Smoke test.** Run `npm run seed -- --quiet` to replay September into the live database and watch the dashboard fill. Drop `--quiet` to also send the handoff emails.

`GET /api/health` reports which integrations are configured, without exposing any values.

## Extending to WhatsApp and the web form (not built)

Only the input changes. A WhatsApp Business webhook or a form POST becomes a `CallInput` with turns from the thread, and goes through the same `processCall` with the same gates, handoff and dashboard. The form already captures most gate fields, so it would usually skip straight to the handoff. WhatsApp would add an auto-reply that runs the same five-question flow as text.

## Files

| File | What it is |
|---|---|
| `db/schema.sql` | **File 1**: calls, leads, system_costs, tool_bookings |
| `lib/classifier.ts` | **File 2**: Gemini/Groq structured extraction, returns facts and a decision |
| `lib/handoff_notifier.ts` | **File 3**: handoff formatting, Gmail (primary), Telegram fallback |
| `lib/hubspot.ts` | Qualified call → HubSpot contact and deal |
| `lib/gates.ts`, `lib/rules.ts` | Decision boundary and studio rules |
| `prompts/vaani_agent_prompt.md` | Voice agent system prompt |
| `app/page.tsx`, `lib/metrics.ts` | Executive dashboard |
| `app/api/...` | Webhook, Cal.com tools, health |
| `fixtures/phone_calls.json` | September transcripts with expected outcomes |
| `scripts/eval.ts`, `tests/` | Accuracy eval and offline tests |
