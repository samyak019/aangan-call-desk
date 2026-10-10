// Cost per call. Billed cost is 0 while every service stays inside its free tier;
// "shadow" cost prices the same usage at paid rates so the dashboard shows real
// unit economics. Rates are env-configurable — check them against current pricing pages.

const rate = (name: string, dflt: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== "" ? v : dflt;
};

export function computeCosts(opts: { durationSeconds: number; inputTokens: number; outputTokens: number; provider: string }) {
  const minutes = Math.max(0, opts.durationSeconds) / 60;
  const llmIn = rate("SHADOW_LLM_INPUT_USD_PER_M", 0.3);
  const llmOut = rate("SHADOW_LLM_OUTPUT_USD_PER_M", 2.5);
  const voicePerMin = rate("SHADOW_VOICE_USD_PER_MIN", 0.05); // STT+LLM+TTS bundle on a paid voice platform

  const shadowLlm = (opts.inputTokens * llmIn + opts.outputTokens * llmOut) / 1_000_000;
  const shadowVoice = minutes * voicePerMin;

  const onFreeTier = (process.env.BILLING_MODE ?? "free") === "free";
  return {
    stt_cost: onFreeTier ? 0 : shadowVoice / 3,
    tts_cost: onFreeTier ? 0 : shadowVoice / 3,
    llm_cost: onFreeTier ? 0 : shadowLlm + shadowVoice / 3,
    llm_provider: opts.provider,
    llm_input_tokens: opts.inputTokens,
    llm_output_tokens: opts.outputTokens,
    voice_minutes: Math.round(minutes * 100) / 100,
    shadow_voice_cost: shadowVoice,
    shadow_llm_cost: shadowLlm,
  };
}
