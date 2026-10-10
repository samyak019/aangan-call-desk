// Post-call webhook: the voice platform POSTs here when a call ends.
import { authorised } from "@/lib/auth";
import { normaliseWebhook } from "@/lib/call";
import { processCall } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!authorised(req)) return Response.json({ error: "unauthorised" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const result = await processCall(normaliseWebhook(body));
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("webhook failed", e);
    // 500 so the platform retries; processing is idempotent on external_call_id.
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
