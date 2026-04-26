import { assert } from "chai";
import {
  describeProviderCapabilityClass,
  getProviderCapabilityClass,
  normalizeProviderProtocolForAuthMode,
} from "../src/utils/providerProtocol";

describe("providerProtocol", function () {
  it("forces codex auth onto codex_responses", function () {
    assert.equal(
      normalizeProviderProtocolForAuthMode({
        protocol: "gemini_native",
        authMode: "codex_auth",
        apiBase: "https://chatgpt.com/backend-api/codex/responses",
      }),
      "codex_responses",
    );
  });

  it("infers responses endpoints without upgrading chat URLs", function () {
    assert.equal(
      normalizeProviderProtocolForAuthMode({
        authMode: "api_key",
        apiBase: "https://api.openai.com/v1/responses",
      }),
      "responses_api",
    );
    assert.equal(
      normalizeProviderProtocolForAuthMode({
        authMode: "api_key",
        apiBase: "https://api.openai.com/v1",
      }),
      "openai_chat_compat",
    );
  });

  it("formats provider capability labels", function () {
    assert.equal(
      describeProviderCapabilityClass(
        getProviderCapabilityClass({ toolCalls: true, fileInputs: true }),
      ),
      "file input + tools",
    );
    assert.equal(
      describeProviderCapabilityClass(
        getProviderCapabilityClass({ toolCalls: true, fileInputs: false }),
      ),
      "tools only",
    );
    assert.equal(
      describeProviderCapabilityClass(
        getProviderCapabilityClass({ toolCalls: false, fileInputs: false }),
      ),
      "chat-only",
    );
  });
});
