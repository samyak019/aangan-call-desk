"use client";

// In-browser voice call with Meher: browser speech-to-text → /api/agent/turn (Gemini) →
// browser text-to-speech. On hang-up the transcript goes through the same pipeline as a
// phone call (/api/agent/end). Typing works too, for browsers without speech recognition.

import { useCallback, useEffect, useRef, useState } from "react";

type Turn = { speaker: "agent" | "caller"; text: string };
type Phase = "idle" | "speaking" | "listening" | "thinking" | "ending" | "done";

const OUTCOME_COPY: Record<string, string> = {
  QUALIFIED: "Qualified. The lead was emailed to the designers.",
  NEEDS_FOLLOW_UP: "Needs one answer. The front desk was emailed the question to ask.",
  NOT_QUALIFIED: "Not a fit. Declined politely and logged on the dashboard.",
  ESCALATE: "Escalated. Nikhil was emailed about the complaint.",
  EXISTING_CLIENT: "Existing client. The front desk was emailed.",
  NOT_AN_ENQUIRY: "Not an enquiry. Logged on the dashboard.",
  MISSED: "Too short to classify. Logged as a call-back for the front desk.",
};

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date()));
  const part = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  return `Good ${part}, Aangan Studio. This is Meher. How can I help you today?`;
}

function getRecognizer(): any | null {
  if (typeof window === "undefined") return null;
  const W = window as any;
  const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "en-IN";
  r.interimResults = true;
  r.continuous = false;
  r.maxAlternatives = 1;
  return r;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return (
    voices.find((v) => v.lang === "en-IN" && /female|veena|rishi|isha|lekha/i.test(v.name)) ||
    voices.find((v) => v.lang === "en-IN") ||
    voices.find((v) => v.lang.startsWith("en-GB")) ||
    voices.find((v) => v.lang.startsWith("en")) ||
    null
  );
}

export default function CallClient() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [interim, setInterim] = useState("");
  const [phone, setPhone] = useState("");
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<{ outcome?: string; notified?: boolean; error?: string } | null>(null);
  const [micOk, setMicOk] = useState(true);

  const turnsRef = useRef<Turn[]>([]);
  const phaseRef = useRef<Phase>("idle");
  const recRef = useRef<ReturnType<typeof getRecognizer>>(null);
  const callIdRef = useRef("");
  const startedRef = useRef("");
  const logRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef("");
  phoneRef.current = phone;

  const set = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const push = (t: Turn) => {
    turnsRef.current = [...turnsRef.current, t];
    setTurns(turnsRef.current);
  };

  useEffect(() => {
    setMicOk(Boolean(getRecognizer()));
    window.speechSynthesis?.getVoices();
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, interim]);

  const finish = useCallback(async () => {
    if (phaseRef.current === "ending" || phaseRef.current === "done") return;
    set("ending");
    try { recRef.current?.abort(); } catch {}
    window.speechSynthesis?.cancel();
    try {
      const res = await fetch("/api/agent/end", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId: callIdRef.current, phone: phoneRef.current, startedAt: startedRef.current, turns: turnsRef.current }),
      });
      setResult(await res.json());
    } catch {
      setResult({ error: "Couldn't reach the server to save the call." });
    }
    set("done");
  }, []);

  const listen = useCallback(() => {
    if (phaseRef.current === "ending" || phaseRef.current === "done") return;
    const rec = getRecognizer();
    if (!rec) {
      set("listening"); // typing fallback
      return;
    }
    recRef.current = rec;
    let finalText = "";
    rec.onresult = (e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else live += r[0].transcript;
      }
      setInterim(finalText + live);
    };
    rec.onerror = (e: { error: string }) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setMicOk(false);
    };
    rec.onend = () => {
      setInterim("");
      if (phaseRef.current !== "listening") return;
      if (finalText.trim()) void send(finalText.trim());
      else listen(); // silence: keep listening
    };
    set("listening");
    try { rec.start(); } catch {}
  }, []);

  const speak = useCallback(
    (text: string, then: () => void) => {
      const synth = window.speechSynthesis;
      if (!synth) return then();
      set("speaking");
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.lang = v?.lang ?? "en-IN";
      u.rate = 1.02;
      let done = false;
      const next = () => { if (!done) { done = true; then(); } };
      u.onend = next;
      u.onerror = next;
      synth.cancel();
      synth.speak(u);
      // Safari sometimes never fires onend; don't let the call hang.
      setTimeout(next, Math.max(4000, text.length * 85));
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      if (!text || phaseRef.current === "ending" || phaseRef.current === "done") return;
      try { recRef.current?.abort(); } catch {}
      push({ speaker: "caller", text });
      set("thinking");
      let reply = "Sorry, could you say that again?";
      let end = false;
      try {
        const res = await fetch("/api/agent/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ turns: turnsRef.current }),
        });
        const j = await res.json();
        reply = j.reply ?? reply;
        end = Boolean(j.end);
      } catch {}
      push({ speaker: "agent", text: reply });
      speak(reply, () => (end ? void finish() : listen()));
    },
    [finish, listen, speak],
  );

  const start = () => {
    callIdRef.current = (crypto.randomUUID?.() ?? String(Date.now())).replace(/[^a-zA-Z0-9-]/g, "");
    startedRef.current = new Date().toISOString();
    turnsRef.current = [];
    setTurns([]);
    setResult(null);
    const g = greeting();
    push({ speaker: "agent", text: g });
    speak(g, listen);
  };

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    void send(t);
  };

  const live = phase !== "idle" && phase !== "done";
  const status: Record<Phase, string> = {
    idle: "Ready",
    speaking: "Meher is speaking…",
    listening: micOk ? "Listening… speak now" : "Type your reply below",
    thinking: "Meher is thinking…",
    ending: "Wrapping up the call…",
    done: "Call ended",
  };

  return (
    <div className="call">
      <div className="call-head">
        <div className={`orb ${phase}`} aria-hidden="true" />
        <div>
          <div className="call-name">Meher · Aangan Studio</div>
          <div className="call-status" role="status">{status[phase]}</div>
        </div>
      </div>

      {!live && phase !== "done" && (
        <div className="call-start">
          <label htmlFor="phone">Your phone number <span>(so a designer can call you back)</span></label>
          <input id="phone" type="tel" inputMode="tel" placeholder="+91 98xxx xxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className="btn primary" onClick={start}>📞 Call Aangan Studio</button>
          {!micOk && <p className="hint">This browser can&apos;t do speech recognition. You&apos;ll hear Meher and type your replies. Chrome or Safari work best for talking.</p>}
          <p className="hint">Allow microphone access when your browser asks. Meher answers 24/7 and won&apos;t quote prices; she books a designer instead.</p>
        </div>
      )}

      {(turns.length > 0 || interim) && (
        <div className="log" ref={logRef} aria-live="polite">
          {turns.map((t, i) => (
            <div key={i} className={`bubble ${t.speaker}`}>{t.text}</div>
          ))}
          {interim && <div className="bubble caller interim">{interim}</div>}
        </div>
      )}

      {live && (
        <div className="call-controls">
          <form onSubmit={submitTyped} className="typed">
            <input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={micOk ? "Or type here…" : "Type your reply…"} disabled={phase === "thinking" || phase === "ending"} />
            <button className="btn" type="submit" disabled={phase === "thinking" || phase === "ending"}>Send</button>
          </form>
          <button className="btn hang" onClick={() => void finish()} disabled={phase === "ending"}>Hang up</button>
        </div>
      )}

      {phase === "done" && result && (
        <div className="result">
          {result.error ? (
            <p>{result.error}</p>
          ) : (
            <>
              <p className="result-main">{OUTCOME_COPY[result.outcome ?? ""] ?? "Call saved."}</p>
              <p className="hint">{result.notified ? "Handoff email sent." : "No email needed for this outcome."} The call is now on the <a href="/">dashboard</a>.</p>
            </>
          )}
          <button className="btn primary" onClick={() => { setPhase("idle"); phaseRef.current = "idle"; setTurns([]); turnsRef.current = []; }}>Call again</button>
        </div>
      )}
    </div>
  );
}
