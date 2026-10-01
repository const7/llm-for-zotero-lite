import type { ProviderCapabilities, ProviderParams } from "../types";

// Codex receives paper text and rendered page images through a temporary thread.

export function matches(params: ProviderParams): boolean {
  const auth = (params.authMode || "").toLowerCase();
  const proto = (params.protocol || "").toLowerCase();
  return auth === "codex_app_server" || proto === "codex_app_server";
}

export const capabilities: Omit<ProviderCapabilities, "multimodal"> = {
  tier: "codex",
  label: "Codex App Server",
  pdf: "vision",
  images: true,
};
