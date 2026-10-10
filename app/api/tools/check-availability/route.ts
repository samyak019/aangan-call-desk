// Mid-call tool: "What consultation slots are free?" → short list the agent can read out.
import { authorised } from "@/lib/auth";
import { getSlots } from "@/lib/calcom";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: "unauthorised" }, { status: 401 });
  try {
    const slots = await getSlots(7, 4);
    if (!slots.length) return Response.json({ slots: [], say: "I don't see an open slot this week — I'll have a designer call you to fix a time." });
    return Response.json({
      slots,
      say: `I have ${slots.map((s) => s.spoken).join(", or ")}. Which works best?`,
    });
  } catch (e) {
    console.error(e);
    return Response.json({ slots: [], say: "Let me have a designer call you within the hour to fix a time that suits you." });
  }
}
