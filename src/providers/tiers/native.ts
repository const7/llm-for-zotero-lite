import type { ProviderCapabilities, ProviderParams } from "../types";

/**
 * Tier 1 — Native API providers.
 *
 * OpenAI Responses API (gpt-4o, gpt-5, o-series, chatgpt), Anthropic
 * Messages API, and Gemini Native API.  These providers accept binary
 * PDF data directly in the message payload.
 */

export function matches(params: ProviderParams): boolean {
  const proto = (params.protocol || "").toLowerCase();
  const m = (params.model || "").toLowerCase();
  return (
    proto === "anthropic_messages" ||
    proto === "gemini_native" ||
    (proto === "responses_api" && /gpt-4o|gpt-5|o[1-9]|chatgpt/.test(m))
  );
}

export const capabilities: Omit<ProviderCapabilities, "multimodal"> = {
  tier: "native",
  label: "Native API",
  pdf: "native",
  images: true,
};
