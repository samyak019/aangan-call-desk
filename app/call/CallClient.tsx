"use client";

// In-browser voice call with Meher: browser speech-to-text → /api/agent/turn (Gemini) →
// browser text-to-speech. On hang-up the transcript goes through the same pipeline as a
// phone call (/api/agent/end). Typing works too, for browsers without speech recognition.

import { useCallback, useEffect, useRef, useState } from "react";

type Turn = { speaker: "agent" | "caller"; text: string };
type Phase = "idle" | "speaking" | "waiting" | "recording" | "thinking" | "ending" | "done";

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
  r.continuous = true;
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
  const [micMsg, setMicMsg] = useState("");

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

  // Caller's turn: wait for a tap. Safari only lets speech recognition start from a tap,
  // and not listening while Meher talks stops her own voice being picked up.
  const listen = useCallback(() => {
    if (phaseRef.current === "ending" || phaseRef.current === "done") return;
    set("waiting");
  }, []);

  const heardRef = useRef("");
  const sendOnEndRef = useRef(false);

  const startRecording = () => {
    window.speechSynthesis?.cancel();
    const rec = getRecognizer();
    if (!rec) {
      setMicOk(false);
      setMicMsg("This browser can't turn speech into text. Type your reply below.");
      set("waiting");
      return;
    }
    recRef.current = rec;
    heardRef.current = "";
    sendOnEndRef.current = true;
    setMicMsg("");
    rec.onresult = (e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heardRef.current = text;
      setInterim(text);
    };
    rec.onerror = (e: { error: string }) => {
      const msg: Record<string, string> = {
        "not-allowed": "Microphone is blocked. In Safari: Safari menu → Settings for this website → Microphone → Allow, then reload.",
        "service-not-allowed": "Speech recognition is switched off on this Mac. Turn on Dictation (System Settings → Keyboard → Dictation), or type your reply below.",
        "audio-capture": "No microphone found. Type your reply below.",
        "no-speech": "I didn't hear anything. Tap the mic and speak a little louder.",
        network: "Speech service couldn't be reached. Type your reply below.",
      };
      setMicMsg(msg[e.error] ?? `Microphone problem (${e.error}). Type your reply below.`);
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") setMicOk(false);
    };
    rec.onend = () => {
      const text = heardRef.current.trim();
      setInterim("");
      if (phaseRef.current !== "recording") return;
      if (sendOnEndRef.current && text) void send(text);
      else set("waiting");
    };
    set("recording");
    try {
      rec.start();
    } catch {
      setMicMsg("Couldn't start the microphone. Tap again, or type your reply below.");
      set("waiting");
    }
  };

  const stopRecording = () => {
    sendOnEndRef.current = true;
    try { recRef.current?.stop(); } catch {}
    // Safari can be slow to fire onend; send what we heard after a short wait.
    setTimeout(() => {
      if (phaseRef.current === "recording") {
        const text = heardRef.current.trim();
        setInterim("");
        if (text) void send(text);
        else { setMicMsg("I didn't catch that. Tap the mic and try again, or type below."); set("waiting"); }
      }
    }, 1200);
  };

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
    speaking: "Meher is speaking… (tap the mic to interrupt)",
    waiting: micOk ? "Your turn. Tap the mic and speak." : "Your turn. Type your reply below.",
    recording: "Listening… tap the mic again when you've finished",
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
          {micOk && (
            <button
              className={`mic ${phase === "recording" ? "on" : ""}`}
              onClick={phase === "recording" ? stopRecording : startRecording}
              disabled={phase === "thinking" || phase === "ending"}
              aria-label={phase === "recording" ? "Stop and send" : "Tap to speak"}
            >
              <span className="mic-icon" aria-hidden="true">🎙</span>
              {phase === "recording" ? "Tap to send" : "Tap to speak"}
            </button>
          )}
          {micMsg && <p className="mic-msg" role="alert">{micMsg}</p>}
          <form onSubmit={submitTyped} className="typed">
            <input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type your reply…" disabled={phase === "thinking" || phase === "ending"} />
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
