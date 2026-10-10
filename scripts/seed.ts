// Replays the September phone transcripts through the full live pipeline
// (Supabase + classifier + Telegram) — an end-to-end test of a real deployment.
//
//   npm run seed            # writes to DB, sends handoffs
//   npm run seed -- --quiet # writes to DB, no Telegram/email
import { processCall } from "../lib/pipeline";
import type { Turn } from "../lib/types";
import calls from "../fixtures/phone_calls.json";

if (process.argv.includes("--quiet")) {
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.RESEND_API_KEY;
}

async function main() {
  for (const fx of calls as { id: string; phone: string; started_at: string; duration_seconds: number; turns: Turn[] }[]) {
    const r = await processCall({
      externalCallId: `fixture-${fx.id}`,
      callerPhone: fx.phone,
      startedAt: new Date(fx.started_at),
      durationSeconds: fx.duration_seconds,
      turns: fx.turns,
    });
    console.log(fx.id, JSON.stringify(r));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
