// One conversational turn of the in-browser voice agent.
// Body: { turns: [{ speaker: "agent" | "caller", text }] }
import { agentTurn, cleanTurns } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const turns = cleanTurns(body.turns);
  if (!turns.length) return Response.json({ error: "no turns" }, { status: 400 });
  try {
    return Response.json(await agentTurn(turns));
  } catch (e) {
    console.error("agent turn failed", e);
    return Response.json({ reply: "Sorry, I didn't catch that. Could you say it again?", end: false });
  }
}
