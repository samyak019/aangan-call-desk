import { loadRows, summarise, type Row } from "@/lib/metrics";

export const dynamic = "force-dynamic";

const USD_INR = Number(process.env.USD_INR) || 88;

const OUTCOMES: { key: string; label: string; tone: string }[] = [
  { key: "QUALIFIED", label: "Qualified → designer", tone: "good" },
  { key: "NEEDS_FOLLOW_UP", label: "Needs one answer", tone: "brass" },
  { key: "NOT_QUALIFIED", label: "Declined politely", tone: "muted" },
  { key: "ESCALATE", label: "Escalated to Nikhil", tone: "bad" },
  { key: "MISSED", label: "Missed / dropped", tone: "muted" },
  { key: "EXISTING_CLIENT", label: "Existing client", tone: "muted" },
  { key: "NOT_AN_ENQUIRY", label: "Not an enquiry", tone: "muted" },
];
const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.key, o.label]));
const GATES: { key: string; label: string; example: string }[] = [
  { key: "scope", label: "Wrong scope", example: "advice-only, restaurant, 180 sq ft pod" },
  { key: "geography", label: "Outside Pune / PCMC", example: "Nashik, Talegaon" },
  { key: "timeline", label: "Rush job", example: "needed in under 6 weeks" },
  { key: "budget", label: "Budget far too low", example: "₹1.5 L for a flat" },
  { key: "authority", label: "No decision-maker", example: "" },
];

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const inr = (usd: number) => {
  const r = usd * USD_INR;
  return r === 0 ? "₹0" : r < 10 ? `₹${r.toFixed(2)}` : `₹${Math.round(r).toLocaleString("en-IN")}`;
};
const mask = (p: string | null) => (p ? p.replace(/\d(?=\d{3})/g, "•") : "—");
const secs = (s: number | null) => (s == null ? "—" : s < 90 ? `${Math.round(s)}s` : `${(s / 60).toFixed(1)}m`);
const istHour = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date(iso)));
const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

function health() {
  const has = (k: string) => Boolean(process.env[k]);
  return [
    { label: "Voice agent", ok: has("GEMINI_API_KEY") },
    { label: "Database", ok: has("SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY") },
    { label: "Gmail handoff", ok: has("GMAIL_USER") && has("GMAIL_APP_PASSWORD") },
    { label: "Vaani webhook", ok: has("VAANI_WEBHOOK_SECRET") },
  ];
}

/* ---------- charts (pure SVG, theme tokens) ---------- */

function HourStrip({ rows }: { rows: Row[] }) {
  const counts = Array.from({ length: 24 }, () => 0);
  rows.forEach((r) => (counts[istHour(r.ts)] += 1));
  const max = Math.max(1, ...counts);
  const W = 720, H = 150, padL = 4, padB = 26, bw = (W - padL * 2) / 24;
  const x = (h: number) => padL + h * bw;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Calls by hour of day, IST">
      <rect x={x(10)} y={0} width={bw * 9} height={H - padB} className="band" rx={6} />
      <text x={x(10) + 8} y={16} className="band-label">Front desk 10am–7pm</text>
      {counts.map((c, h) => {
        const bh = ((H - padB - 26) * c) / max;
        const after = h < 10 || h >= 19;
        return (
          <g key={h}>
            <rect x={x(h) + 3} y={H - padB - bh} width={bw - 6} height={Math.max(bh, c ? 3 : 0)} rx={3} className={after ? "bar-after" : "bar-in"} />
            {c > 0 && <text x={x(h) + bw / 2} y={H - padB - bh - 5} textAnchor="middle" className="val">{c}</text>}
          </g>
        );
      })}
      <line x1={padL} x2={W - padL} y1={H - padB} y2={H - padB} className="axis" />
      {[0, 6, 10, 12, 15, 19, 23].map((h) => (
        <text key={h} x={x(h) + bw / 2} y={H - 8} textAnchor="middle" className="tick">
          {h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`}
        </text>
      ))}
    </svg>
  );
}

function DayBars({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p className="empty">No calls yet.</p>;
  const byDay = new Map<string, { q: number; o: number }>();
  rows.forEach((r) => {
    const d = istDay(r.ts);
    const v = byDay.get(d) ?? { q: 0, o: 0 };
    if (r.outcome === "QUALIFIED") v.q += 1;
    else v.o += 1;
    byDay.set(d, v);
  });
  const days = [...byDay.keys()].sort();
  const start = new Date(days[0]), end = new Date(days[days.length - 1]);
  const all: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) all.push(d.toISOString().slice(0, 10));
  const max = Math.max(1, ...[...byDay.values()].map((v) => v.q + v.o));
  const W = 720, H = 150, padB = 26, bw = (W - 8) / all.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Calls per day">
      {all.map((d, i) => {
        const v = byDay.get(d) ?? { q: 0, o: 0 };
        const scale = (H - padB - 14) / max;
        const hq = v.q * scale, ho = v.o * scale;
        const xx = 4 + i * bw + Math.min(2, bw * 0.15);
        const w = Math.max(2, bw - Math.min(4, bw * 0.3));
        return (
          <g key={d}>
            <rect x={xx} y={H - padB - ho - hq} width={w} height={ho} rx={2} className="bar-other" />
            <rect x={xx} y={H - padB - hq} width={w} height={hq} rx={2} className="bar-q" />
          </g>
        );
      })}
      <line x1={4} x2={W - 4} y1={H - padB} y2={H - padB} className="axis" />
      {[0, Math.floor(all.length / 2), all.length - 1].map((i) => (
        <text key={i} x={4 + i * bw + bw / 2} y={H - 8} textAnchor={i === 0 ? "start" : i === all.length - 1 ? "end" : "middle"} className="tick">
          {new Date(all[i]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </text>
      ))}
    </svg>
  );
}

/* ---------- page ---------- */

export default async function Dashboard() {
  let rows: Row[] = [];
  let demo = false;
  let err: string | null = null;
  try {
    ({ rows, demo } = await loadRows(90));
  } catch (e) {
    err = String(e);
  }
  const m = summarise(rows);
  const services = health();
  const funnel = [
    { label: "Calls in", value: m.calls },
    { label: "Answered", value: m.answered },
    { label: "Real enquiries", value: m.enquiries },
    { label: "Qualified", value: m.qualified },
    { label: "Designer notified", value: m.notified },
  ];
  const maxOutcome = Math.max(1, ...Object.values(m.outcomes));
  const maxGate = Math.max(1, ...Object.values(m.gateCounts));
  const pipelineLo = (m.qualified * 8) / 100, pipelineHi = (m.qualified * 14) / 100;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" className="mark" aria-hidden="true">
            <rect x="2" y="2" width="28" height="28" rx="7" className="mark-outer" />
            <rect x="10" y="10" width="12" height="12" rx="2.5" className="mark-inner" />
          </svg>
          <div>
            <div className="brand-name">Aangan Studio</div>
            <div className="brand-sub">Call Desk · Pune</div>
          </div>
        </div>
        <div className="status">
          {services.map((s) => (
            <span key={s.label} className={`chip ${s.ok ? "on" : "off"}`}>
              <i aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </div>
        <a className="cta" href="/call">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.6a1 1 0 0 1-.25 1z" /></svg>
          Call Meher
        </a>
      </header>

      <main className="wrap">
        {demo && <p className="notice">Showing September 2026 demo data. Connect Supabase for live numbers.</p>}
        {err && <p className="notice bad">Couldn&apos;t load data: {err}</p>}

        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Last 90 days</span>
            <h1>
              <em>{m.qualified}</em> leads reached a designer with everything already asked.
            </h1>
            <p>
              Meher answered {m.answered} of {m.calls} calls, {m.afterHoursAnswered} of them after the front desk had gone home.
              Median {secs(m.medianHandoffSecs)} from hang-up to the designer&apos;s inbox. Running cost {inr(m.billed)}.
            </p>
          </div>
          <div className="compare" aria-label="Before and after">
            <div className="col before">
              <span className="eyebrow">Before</span>
              <div className="row"><b>48%</b><span>unanswered for 48 hours</span></div>
              <div className="row"><b>~1 day</b><span>to reach a designer</span></div>
              <div className="row"><b>0</b><span>calls answered after 7pm</span></div>
            </div>
            <div className="col after">
              <span className="eyebrow">Now</span>
              <div className="row"><b>{pct(m.answered, m.calls)}%</b><span>answered, instantly</span></div>
              <div className="row"><b>{secs(m.medianHandoffSecs)}</b><span>to a designer&apos;s inbox</span></div>
              <div className="row"><b>{m.afterHoursAnswered}</b><span>after-hours calls caught</span></div>
            </div>
          </div>
        </section>

        <section className="kpis">
          <div className="kpi"><span>Calls answered</span><b>{pct(m.answered, m.calls)}<small>%</small></b><em>{m.answered} of {m.calls}</em></div>
          <div className="kpi"><span>Qualified leads</span><b>{m.qualified}</b><em>pipeline ₹{pipelineLo.toFixed(1)}–{pipelineHi.toFixed(1)} Cr</em></div>
          <div className="kpi"><span>Hang-up → designer</span><b>{secs(m.medianHandoffSecs)}</b><em>{m.within5Min}/{m.handoffMeasured} inside 5 min</em></div>
          <div className="kpi"><span>Price quoted by agent</span><b className={m.pricingLeaks ? "bad" : "good"}>{m.pricingLeaks}</b><em>{m.pricingLeaks ? "check the alert emails" : `${m.askedPricing} callers asked; all deflected`}</em></div>
          <div className="kpi"><span>Cost to run</span><b>{inr(m.billed)}</b><em>{inr(m.shadow)} at paid rates · {m.shadowPerQualified != null ? `${inr(m.shadowPerQualified)}/lead` : "—"}</em></div>
        </section>

        <section className="grid two">
          <div className="card">
            <div className="card-head"><h2>When calls arrive</h2><span className="legend"><i className="lg-in" />Desk hours <i className="lg-after" />After hours</span></div>
            <HourStrip rows={rows} />
            <p className="foot">{pct(m.afterHours, m.calls)}% of calls came outside 10am–7pm. Before, nobody picked these up.</p>
          </div>
          <div className="card">
            <div className="card-head"><h2>Calls per day</h2><span className="legend"><i className="lg-q" />Qualified <i className="lg-o" />Other</span></div>
            <DayBars rows={rows} />
            <p className="foot">{m.voiceMinutes.toFixed(0)} minutes of conversation handled by Meher.</p>
          </div>
        </section>

        <section className="grid three">
          <div className="card">
            <h2>Funnel</h2>
            <ol className="funnel">
              {funnel.map((f, i) => (
                <li key={f.label}>
                  <div className="f-bar" style={{ width: `${Math.max(6, pct(f.value, Math.max(1, m.calls)))}%` }} />
                  <span className="f-label">{f.label}</span>
                  <b>{f.value}</b>
                  {i > 0 && <span className="f-rate">{pct(f.value, Math.max(1, funnel[i - 1].value))}%</span>}
                </li>
              ))}
            </ol>
          </div>
          <div className="card">
            <h2>Where every call ended up</h2>
            <ul className="hbars">
              {OUTCOMES.filter((o) => m.outcomes[o.key as keyof typeof m.outcomes] > 0 || o.key === "ESCALATE").map((o) => {
                const v = m.outcomes[o.key as keyof typeof m.outcomes];
                return (
                  <li key={o.key}>
                    <span>{o.label}</span><b>{v}</b>
                    <div className="track"><div className={`fill ${o.tone}`} style={{ width: `${(v / maxOutcome) * 100}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="card">
            <h2>Why callers were declined</h2>
            <ul className="hbars">
              {GATES.filter((g) => g.key !== "authority" || m.gateCounts.authority > 0).map((g) => {
                const v = m.gateCounts[g.key as keyof typeof m.gateCounts];
                return (
                  <li key={g.key}>
                    <span>{g.label}{g.example && <small>{g.example}</small>}</span><b>{v}</b>
                    <div className="track"><div className="fill ink" style={{ width: `${(v / maxGate) * 100}%` }} /></div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Recent calls</h2><span className="legend">Phone numbers masked</span></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>When (IST)</th><th>Caller</th><th>Project</th><th>Outcome</th><th>What they said</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((r, i) => (
                  <tr key={i}>
                    <td className="nowrap mono">{when(r.ts)}{r.afterHours && <span className="tag">after hrs</span>}</td>
                    <td><div className="who">{r.name ?? "Unknown"}</div><div className="mono dim">{mask(r.phone)}</div></td>
                    <td>{[r.project, r.location].filter(Boolean).join(" · ") || "—"}</td>
                    <td><span className={`pill ${r.outcome ?? ""}`}>{r.outcome ? OUTCOME_LABEL[r.outcome] : r.status}</span></td>
                    <td className="said">{r.summary ?? ""}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={5} className="empty">No calls yet. Ring Meher to see the first one land here.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="footer">
          Qualification follows Nikhil&apos;s five gates (scope, area, timeline, budget, decision-maker). Meher never quotes a price. Costs in ₹ at {USD_INR}/USD.
        </footer>
      </main>
    </div>
  );
}
