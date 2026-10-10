// Call ended in the browser → same pipeline as a phone call (classify, hand off, log, cost).
// Body: { callId, phone?, startedAt, turns }
import { processCall } from "@/lib/pipeline";
import { cleanTurns } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const turns = cleanTurns(body.turns);
  const callId = String(body.callId ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  if (!callId) return Response.json({ error: "callId required" }, { status: 400 });

  const startedAt = new Date(body.startedAt ?? Date.now());
  const safeStart = isNaN(startedAt.getTime()) ? new Date() : startedAt;
  const phone = typeof body.phone === "string" && body.phone.replace(/\D/g, "").length >= 8 ? body.phone.trim().slice(0, 20) : null;

  try {
    const r = await processCall({
      externalCallId: `web-${callId}`,
      callerPhone: phone,
      startedAt: safeStart,
      durationSeconds: Math.max(0, Math.round((Date.now() - safeStart.getTime()) / 1000)),
      turns,
    });
    return Response.json({ ok: true, ...r });
  } catch (e) {
    console.error("end-of-call processing failed", e);
    return Response.json({ ok: false, error: "Couldn't save the call" }, { status: 500 });
  }
}
