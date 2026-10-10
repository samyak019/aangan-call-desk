// One-time Telegram setup helper.
//   1. Checks the bot token works (getMe).
//   2. Lists every group/chat the bot has seen a message in, with its chat id.
//   3. With --test <chat_id>, sends a sample handoff to that chat.
//
//   TELEGRAM_BOT_TOKEN=... npm run telegram:setup
//   TELEGRAM_BOT_TOKEN=... npm run telegram:setup -- --test -1001234567890

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN first (from @BotFather).");
  process.exit(1);
}
const api = (method: string, body?: unknown) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

async function main() {
  const me = await api("getMe");
  if (!me.ok) throw new Error(`Token rejected: ${me.description}`);
  console.log(`✓ Bot: @${me.result.username} (${me.result.first_name})\n`);

  const testIdx = process.argv.indexOf("--test");
  if (testIdx > -1) {
    const chatId = process.argv[testIdx + 1];
    const r = await api("sendMessage", {
      chat_id: chatId,
      text: [
        "📌 NEW QUALIFIED LEAD HANDOFF (test)",
        "- Caller Name: Priya",
        "- Contact Number: +91 98•••••001",
        "- Location & Property Type: 3BHK apartment, Kothrud, 1,400 sq ft",
        "- Scope: Full home (kitchen, living room, bedrooms)",
        "- Possession & Timeline: done by March",
        "- Budget Mentioned: Unspecified",
        "- Key Notes & Vibe: Co-owner with husband · Referred by Shruti Joshi",
        "- Action Taken: No slot booked on the call — call back within 1 hour",
      ].join("\n"),
    });
    console.log(r.ok ? `✓ Test message sent to ${chatId}` : `✗ ${r.description}`);
    return;
  }

  const upd = await api("getUpdates");
  const chats = new Map<string, string>();
  for (const u of upd.result ?? []) {
    const chat = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
    if (chat) chats.set(String(chat.id), `${chat.type.padEnd(10)} ${chat.title ?? chat.username ?? chat.first_name ?? ""}`);
  }
  if (!chats.size) {
    console.log("No chats yet. Add the bot to your groups, send any message in each (e.g. /start), then run this again.");
    console.log("If a group still doesn't show: @BotFather → /setprivacy → choose the bot → Disable, and send another message.");
    return;
  }
  console.log("chat_id               type       name");
  for (const [id, label] of chats) console.log(`${id.padEnd(21)} ${label}`);
  console.log("\nPut these in Vercel as TELEGRAM_DESIGNERS_CHAT_ID / TELEGRAM_ESCALATION_CHAT_ID / TELEGRAM_FRONTDESK_CHAT_ID.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
