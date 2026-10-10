// Which integrations are configured (never returns secret values).
export const runtime = "nodejs";

export async function GET() {
  const has = (k: string) => Boolean(process.env[k]);
  return Response.json({
    llm: { gemini: has("GEMINI_API_KEY"), groq_fallback: has("GROQ_API_KEY") },
    database: has("SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY"),
    handoff: {
      gmail: has("GMAIL_USER") && has("GMAIL_APP_PASSWORD") && has("HANDOFF_EMAIL_DESIGNERS"),
      telegram_fallback: has("TELEGRAM_BOT_TOKEN") && has("TELEGRAM_DESIGNERS_CHAT_ID"),
    },
    crm_hubspot: has("HUBSPOT_TOKEN"),
    calcom: has("CALCOM_API_KEY") && has("CALCOM_EVENT_TYPE_ID"),
    webhook_secret: has("VAANI_WEBHOOK_SECRET"),
  });
}
