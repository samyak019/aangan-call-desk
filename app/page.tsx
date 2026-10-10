import { loadRows, summarise, type Row } from "@/lib/metrics";

export const dynamic = "force-dynamic";

const OUTCOME_LABEL: Record<string, string> = {
  QUALIFIED: "Qualified → designer",
  NEEDS_FOLLOW_UP: "Needs one answer",
  NOT_QUALIFIED: "Declined politely",
  ESCALATE: "Escalated complaint",
  EXISTING_CLIENT: "Existing client",
  NOT_AN_ENQUIRY: "Not an enquiry",
  MISSED: "Missed / dropped",
};
const GATE_LABEL: Record<string, string> = {
  scope: "Scope (advice-only, restaurant, too small…)",
  geography: "Outside Pune / PCMC",
  timeline: "Rush timeline (< 6 weeks)",
  budget: "Volunteered budget far too low",
  authority: "No decision authority",
};

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
const mask = (p: string | null) => (p ? p.replace(/\d(?=\d{3})/g, "•") : "—");
const secs = (s: number | null) => (s == null ? "—" : s < 90 ? `${Math.round(s)}s` : `${(s / 60).toFixed(1)} min`);
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone?: string }) {
  return (
    <div className="bar">
      <div className="bar-label">
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className="bar-track">
        <div className={`bar-fill ${tone ?? ""}`} style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
      </div>
    </div>
  );
}

export default async function Dashboard() {
  let rows: Row[] = [];
  let demo = false;
  let err: string | null = null;
  try {
    ({ rows, demo } = await loadRows(30));
  } catch (e) {
    err = String(e);
  }
  const m = summarise(rows);
  const funnel = [
    { label: "Calls received", value: m.calls },
    { label: "Answered by the agent", value: m.answered },
    { label: "Real new-project enquiries", value: m.enquiries },
    { label: "Qualified", value: m.qualified },
    { label: "Handed to a designer", value: m.notified },
    { label: "Consultation booked on the call", value: m.booked },
  ];
  const maxGate = Math.max(1, ...Object.values(m.gateCounts));
  const maxOutcome = Math.max(1, ...Object.values(m.outcomes));

  return (
    <main>
      <header>
        <div>
          <h1>Aangan Studio · Call Desk</h1>
          <p className="sub">Last 30 days · every inbound call, answered 24/7 by the voice agent</p>
        </div>
        {demo && <span className="badge">Demo data · September 2026 transcripts — connect Supabase for live numbers</span>}
      </header>
      {err && <p className="error">Couldn&apos;t load data: {err}</p>}

      <section className="kpis">
        <div className="kpi">
          <span>Calls answered</span>
          <b>{pct(m.answered, m.calls)}</b>
          <small>{m.answered} of {m.calls} · was ~52% within 48 hrs</small>
        </div>
        <div className="kpi">
          <span>After-hours calls caught</span>
          <b>{m.afterHoursAnswered}</b>
          <small>{pct(m.afterHours, m.calls)} of calls came outside 10am–7pm</small>
        </div>
        <div className="kpi">
          <span>Qualified leads → designers</span>
          <b>{m.qualified}</b>
          <small>pipeline ≈ ₹{(m.qualified * 8) / 100}–{(m.qualified * 14) / 100} Cr at ₹8–14 L avg</small>
        </div>
        <div className="kpi">
          <span>Call end → designer&apos;s phone</span>
          <b>{secs(m.medianHandoffSecs)}</b>
          <small>median · {m.within5Min}/{m.handoffMeasured} inside 5 min</small>
        </div>
        <div className="kpi accent">
          <span>Cost to run (billed)</span>
          <b>{usd(m.billed)}</b>
          <small>at paid rates it would be {usd(m.shadow)} · {m.shadowPerQualified != null ? `${usd(m.shadowPerQualified)}/qualified lead` : "—"}</small>
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <h2>Funnel</h2>
          {funnel.map((f) => (
            <Bar key={f.label} label={f.label} value={f.value} max={Math.max(1, m.calls)} />
          ))}
        </div>
        <div className="card">
          <h2>Where every call ended up</h2>
          {Object.entries(m.outcomes).map(([k, v]) => (
            <Bar key={k} label={OUTCOME_LABEL[k]} value={v} max={maxOutcome} tone={k === "ESCALATE" ? "warn" : k === "QUALIFIED" ? "good" : ""} />
          ))}
        </div>
        <div className="card">
          <h2>Why enquiries were declined</h2>
          {Object.entries(m.gateCounts).map(([k, v]) => (
            <Bar key={k} label={GATE_LABEL[k]} value={v} max={maxGate} tone="muted" />
          ))}
        </div>
        <div className="card">
          <h2>Guardrails</h2>
          <dl>
            <dt>Callers who asked for pricing</dt>
            <dd>{m.askedPricing} — all given the designer-consultation answer</dd>
            <dt>Calls where the agent said a ₹ figure</dt>
            <dd className={m.pricingLeaks ? "bad" : "ok"}>{m.pricingLeaks}{m.pricingLeaks ? " — check alerts" : " ✓"}</dd>
            <dt>Complaints escalated to Nikhil</dt>
            <dd>{m.outcomes.ESCALATE}</dd>
            <dt>Voice minutes handled</dt>
            <dd>{m.voiceMinutes.toFixed(0)} min</dd>
          </dl>
        </div>
      </section>

      <section className="card">
        <h2>Recent calls</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When (IST)</th>
                <th>Caller</th>
                <th>Project</th>
                <th>Outcome</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 40).map((r, i) => (
                <tr key={i}>
                  <td className="nowrap">{when(r.ts)}{r.afterHours && <span className="tag">after hrs</span>}</td>
                  <td>{r.name ?? "—"}<br /><small>{mask(r.phone)}</small></td>
                  <td>{[r.project, r.location].filter(Boolean).join(" · ") || "—"}</td>
                  <td><span className={`pill ${r.outcome ?? ""}`}>{r.outcome ? OUTCOME_LABEL[r.outcome] : r.status}</span></td>
                  <td className="summary">{r.summary ?? ""}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={5} className="empty">No calls yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
