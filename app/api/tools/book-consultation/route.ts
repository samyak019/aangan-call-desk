// Mid-call tool: book the slot the caller picked.
// Body: { start: ISO string, name: string, phone?: string, notes?: string }
import { authorised } from "@/lib/auth";
import { bookSlot } from "@/lib/calcom";
import { db, dbConfigured } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: "unauthorised" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.start) return Response.json({ booked: false, say: "Which day and time would suit you?" }, { status: 400 });
  try {
    const b = await bookSlot({ start: body.start, name: body.name ?? "", phone: body.phone ?? null, notes: body.notes });
    if (dbConfigured()) {
      await db().from("tool_bookings").insert({ caller_phone: body.phone ?? null, slot_start: b.start, calcom_uid: b.uid });
    }
    const spoken = new Date(b.start).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
    return Response.json({ booked: true, start: b.start, say: `You're booked for ${spoken}. Your designer will call you before then.` });
  } catch (e) {
    console.error(e);
    return Response.json({ booked: false, say: "That slot just went — I'll have a designer call you within the hour to confirm a time." });
  }
}
