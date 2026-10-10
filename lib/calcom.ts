// Cal.com (free individual plan) — used by the voice agent as mid-call tools
// so a qualified caller hangs up with a consultation already on the calendar.

const BASE = "https://api.cal.com/v2";
const TZ = "Asia/Kolkata";

function headers(version: string) {
  const key = process.env.CALCOM_API_KEY;
  if (!key) throw new Error("CALCOM_API_KEY not set");
  return { authorization: `Bearer ${key}`, "cal-api-version": version, "content-type": "application/json" };
}

const eventTypeId = () => Number(process.env.CALCOM_EVENT_TYPE_ID);

export async function getSlots(days = 7, max = 6): Promise<{ start: string; spoken: string }[]> {
  const start = new Date();
  const end = new Date(start.getTime() + days * 86400000);
  const qs = new URLSearchParams({
    eventTypeId: String(eventTypeId()),
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    timeZone: TZ,
  });
  const res = await fetch(`${BASE}/slots?${qs}`, { headers: headers("2024-09-04") });
  if (!res.ok) throw new Error(`Cal.com slots ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const all: string[] = Object.values<{ start: string }[]>(j.data ?? {}).flat().map((s) => s.start);
  // Spread suggestions across days rather than six slots on the same morning.
  const byDay = new Map<string, string>();
  for (const s of all) {
    const day = new Date(s).toLocaleDateString("en-CA", { timeZone: TZ });
    if (!byDay.has(day)) byDay.set(day, s);
  }
  return [...byDay.values()].slice(0, max).map((s) => ({
    start: s,
    spoken: new Date(s).toLocaleString("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }),
  }));
}

export async function bookSlot(input: { start: string; name: string; phone: string | null; notes?: string }) {
  const res = await fetch(`${BASE}/bookings`, {
    method: "POST",
    headers: headers("2024-08-13"),
    body: JSON.stringify({
      start: new Date(input.start).toISOString(),
      eventTypeId: eventTypeId(),
      attendee: {
        name: input.name || "Caller",
        // Phone callers rarely spell out an email. Confirmation goes to the studio's
        // front-desk inbox; the designer reaches the caller on the phone number.
        email: process.env.CALCOM_ATTENDEE_EMAIL || "frontdesk@example.com",
        timeZone: TZ,
        ...(input.phone ? { phoneNumber: input.phone } : {}),
      },
      metadata: { source: "voice-agent", phone: input.phone ?? "", notes: (input.notes ?? "").slice(0, 400) },
    }),
  });
  if (!res.ok) throw new Error(`Cal.com booking ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return { uid: j.data?.uid as string, start: (j.data?.start as string) ?? input.start };
}
