import { assert } from "chai";
import {
  detectProviderPreset,
  getProviderPreset,
} from "../src/utils/providerPresets";

describe("providerPresets", function () {
  it("detects official provider presets from saved URLs", function () {
    assert.equal(
      detectProviderPreset("https://api.openai.com/v1/responses"),
      "openai",
    );
    assert.equal(
      detectProviderPreset(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      ),
      "gemini",
    );
    assert.equal(
      detectProviderPreset("https://api.anthropic.com/v1/chat/completions"),
      "anthropic",
    );
    assert.equal(
      detectProviderPreset("https://api.deepseek.com/v1/chat/completions"),
      "deepseek",
    );
    assert.equal(detectProviderPreset("https://api.deepseek.com/v1"), "deepseek");
    assert.equal(detectProviderPreset("https://api.x.ai/v1/responses"), "grok");
    assert.equal(
      detectProviderPreset(
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
      ),
      "qwen",
    );
    assert.equal(
      detectProviderPreset("https://api.moonshot.ai/v1/chat/completions"),
      "kimi",
    );
  });

  it("falls back to customized for unknown URLs", function () {
    assert.equal(
      detectProviderPreset("https://custom.provider.example/v1/chat/completions"),
      "customized",
    );
  });

  it("exposes the official default endpoint for each preset", function () {
    assert.equal(
      getProviderPreset("openai").defaultApiBase,
      "https://api.openai.com/v1/responses",
    );
    assert.equal(
      getProviderPreset("grok").defaultApiBase,
      "https://api.x.ai/v1/responses",
    );
    assert.equal(
      getProviderPreset("kimi").defaultApiBase,
      "https://api.moonshot.cn/v1",
    );
  });
});
