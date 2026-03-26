import type { ProviderCapabilities, ProviderParams } from "../types";

/**
 * Tier 3 — Third-party OpenAI-compatible providers.
 *
 * OpenRouter, relay/proxy services (e.g. right.codes), and any other
 * provider using the /v1/chat/completions endpoint.  PDFs are sent as
 * data:application/pdf;base64,... inside an image_url content part —
 * relay services pass this through transparently to the underlying
 * model.  This is the same approach used by zotero-AI-Butler.
 */

export function matches(params: ProviderParams): boolean {
  const proto = (params.protocol || "").toLowerCase();
  const auth = (params.authMode || "").toLowerCase();
  return proto === "openai_chat_compat" || (!proto && !auth);
}

export const capabilities: Omit<ProviderCapabilities, "multimodal"> = {
  tier: "third_party",
  label: "Third-party (OpenAI-compatible)",
  pdf: "image_url",
  images: true,
};
