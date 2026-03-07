export type SupportedProviderPresetId =
  | "openai"
  | "gemini"
  | "anthropic"
  | "deepseek"
  | "grok"
  | "qwen"
  | "kimi";

export type ProviderPresetId = SupportedProviderPresetId | "customized";

export type ProviderPreset = {
  id: SupportedProviderPresetId;
  label: string;
  defaultApiBase: string;
  helperText: string;
  matches: (apiBase: string) => boolean;
  /** When true, prefer /v1/responses over /v1/chat/completions when calling the API. */
  supportsResponsesEndpoint?: boolean;
};

type ParsedApiBase = {
  hostname: string;
  pathname: string;
};

function normalizeApiBase(apiBase: string): string {
  return typeof apiBase === "string" ? apiBase.trim().replace(/\/+$/, "") : "";
}

function parseApiBase(apiBase: string): ParsedApiBase | null {
  const normalized = normalizeApiBase(apiBase);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    return {
      hostname: parsed.hostname.trim().toLowerCase(),
      pathname: parsed.pathname.replace(/\/+$/, "") || "/",
    };
  } catch (_err) {
    return null;
  }
}

function matchesPaths(pathname: string, paths: string[]): boolean {
  return paths.includes(pathname);
}

function isHost(parsed: ParsedApiBase | null, hosts: string[]): boolean {
  if (!parsed) return false;
  return hosts.includes(parsed.hostname);
}

function makeHostAndPathMatcher(hosts: string[], paths: string[]) {
  return (apiBase: string) => {
    const parsed = parseApiBase(apiBase);
    if (!parsed) return false;
    return isHost(parsed, hosts) && matchesPaths(parsed.pathname, paths);
  };
}

const OPENAI_PATHS = [
  "/",
  "/v1",
  "/v1/chat/completions",
  "/v1/responses",
  "/v1/files",
  "/v1/embeddings",
];

const GEMINI_PATHS = [
  "/",
  "/v1beta",
  "/v1beta/openai",
  "/v1beta/openai/chat/completions",
  "/v1beta/openai/responses",
  "/v1beta/openai/files",
];

const ANTHROPIC_PATHS = ["/", "/v1", "/v1/chat/completions"];
const DEEPSEEK_PATHS = ["/", "/v1", "/v1/chat/completions"];
const GROK_PATHS = ["/", "/v1", "/v1/chat/completions", "/v1/responses"];
const QWEN_PATHS = ["/", "/compatible-mode/v1", "/compatible-mode/v1/chat/completions"];
const KIMI_PATHS = ["/", "/v1", "/v1/chat/completions"];

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    defaultApiBase: "https://api.openai.com/v1/responses",
    helperText: "Preset uses OpenAI's official Responses endpoint.",
    matches: makeHostAndPathMatcher(["api.openai.com"], OPENAI_PATHS),
    supportsResponsesEndpoint: true,
  },
  {
    id: "gemini",
    label: "Gemini",
    defaultApiBase:
      "https://generativelanguage.googleapis.com/v1beta/openai/responses",
    helperText:
      "Preset uses Gemini's Responses endpoint when available; falls back to chat/completions.",
    matches: makeHostAndPathMatcher(
      ["generativelanguage.googleapis.com"],
      GEMINI_PATHS,
    ),
    supportsResponsesEndpoint: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultApiBase: "https://api.anthropic.com/v1",
    helperText:
      "Preset uses Anthropic's official OpenAI SDK compatibility endpoint.",
    matches: makeHostAndPathMatcher(["api.anthropic.com"], ANTHROPIC_PATHS),
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultApiBase: "https://api.deepseek.com/v1",
    helperText: "Preset uses DeepSeek's official API base (v1).",
    matches: makeHostAndPathMatcher(["api.deepseek.com"], DEEPSEEK_PATHS),
  },
  {
    id: "grok",
    label: "Grok",
    defaultApiBase: "https://api.x.ai/v1/responses",
    helperText: "Preset uses xAI's official Responses endpoint.",
    matches: makeHostAndPathMatcher(["api.x.ai"], GROK_PATHS),
    supportsResponsesEndpoint: true,
  },
  {
    id: "qwen",
    label: "Qwen",
    defaultApiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    helperText:
      "Preset uses DashScope's compatible-mode API base (v1).",
    matches: makeHostAndPathMatcher(
      ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"],
      QWEN_PATHS,
    ),
  },
  {
    id: "kimi",
    label: "Kimi",
    defaultApiBase: "https://api.moonshot.cn/v1",
    helperText:
      "Preset uses Moonshot's official API base (v1).",
    matches: makeHostAndPathMatcher(
      ["api.moonshot.cn", "api.moonshot.ai"],
      KIMI_PATHS,
    ),
  },
];

export function getProviderPreset(
  id: SupportedProviderPresetId,
): ProviderPreset {
  const preset = PROVIDER_PRESETS.find((entry) => entry.id === id);
  if (!preset) {
    throw new Error(`Unknown provider preset: ${id}`);
  }
  return preset;
}

export function detectProviderPreset(apiBase: string): ProviderPresetId {
  const normalized = normalizeApiBase(apiBase);
  if (!normalized) return "customized";
  for (const preset of PROVIDER_PRESETS) {
    if (preset.matches(normalized)) return preset.id;
  }
  return "customized";
}

export function isGrokApiBase(apiBase: string): boolean {
  return getProviderPreset("grok").matches(apiBase);
}

/** True if the given apiBase is for a known provider that supports the /v1/responses endpoint. */
export function providerSupportsResponsesEndpoint(apiBase: string): boolean {
  const id = detectProviderPreset(apiBase);
  if (id === "customized") return false;
  const preset = getProviderPreset(id);
  return Boolean(preset.supportsResponsesEndpoint);
}
