import { config } from "../package.json";
import { assert } from "chai";
import {
  detectReasoningProvider,
  getReasoningOptions,
  getSelectedReasoningForItem,
} from "../src/modules/contextPanel/chat";
import { selectedReasoningCache } from "../src/modules/contextPanel/state";
import {
  getLastUsedReasoningLevel,
  setLastUsedReasoningLevel,
} from "../src/modules/contextPanel/prefHelpers";

describe("current Codex model reasoning", function () {
  const originalZotero = globalThis.Zotero;
  beforeEach(function () {
    const prefs = new Map<string, unknown>();
    prefs.set(
      `${config.prefsPrefix}.codexModelCatalog`,
      JSON.stringify({
        binaryPath: "",
        models: [
          "gpt-6-sol",
          "gpt-6.1-sol",
          "gpt-6-astra",
          "gpt-5.6-sol",
          "gpt-5.6-terra",
          "gpt-6-luna",
          "gpt-5.6-luna",
          "new-codex-model",
        ].map((model) => ({
          model,
          displayName: model,
          hidden: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high", "max"].map(
            (reasoningEffort) => ({ reasoningEffort, description: "" }),
          ),
        })),
      }),
    );
    globalThis.Zotero = {
      Prefs: {
        get: (key: string) => prefs.get(key),
        set: (key: string, value: unknown) => prefs.set(key, value),
      },
    } as unknown as typeof Zotero;
  });
  afterEach(function () {
    globalThis.Zotero = originalZotero;
    selectedReasoningCache.delete(987654);
  });

  for (const model of [
    "gpt-6-sol",
    "gpt-6.1-sol",
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "new-codex-model",
  ]) {
    it(`offers and resolves all supported levels for ${model}`, function () {
      const provider = detectReasoningProvider(model, "codex_app_server");
      assert.equal(provider, "openai");
      const levels = ["low", "medium", "high"] as const;
      assert.deepEqual(
        getReasoningOptions(provider, model, undefined, "codex_app_server").map(
          (option) => option.level,
        ),
        [...levels],
      );
      for (const level of levels) {
        selectedReasoningCache.set(987654, level);
        assert.deepEqual(
          getSelectedReasoningForItem(
            987654,
            model,
            undefined,
            "codex_app_server",
          ),
          {
            provider: "openai",
            level,
          },
        );
        setLastUsedReasoningLevel(level);
        assert.equal(getLastUsedReasoningLevel(), level);
      }
    });
  }

  it("limits luna to three levels and keeps non-reasoning models unsupported", function () {
    for (const model of ["gpt-6-luna", "gpt-5.6-luna"]) {
      assert.deepEqual(
        getReasoningOptions(
          detectReasoningProvider(model, "codex_app_server"),
          model,
          undefined,
          "codex_app_server",
        ).map((option) => option.level),
        ["low", "medium", "high"],
      );
    }
    for (const model of ["gpt-4o", "unknown"]) {
      assert.equal(detectReasoningProvider(model), "unsupported");
    }
  });

  for (const level of ["xhigh", "max", "ultra"] as const) {
    it(`resets saved ${level} to an available panel level`, function () {
      selectedReasoningCache.set(987654, level);
      assert.deepEqual(
        getSelectedReasoningForItem(
          987654,
          "gpt-6-sol",
          undefined,
          "codex_app_server",
        ),
        {
          provider: "openai",
          level: "low",
        },
      );
    });
  }

  it("recovers from the off selection left by the old detector", function () {
    selectedReasoningCache.set(987654, "none");
    assert.deepEqual(
      getSelectedReasoningForItem(
        987654,
        "gpt-6-sol",
        undefined,
        "codex_app_server",
      ),
      {
        provider: "openai",
        level: "low",
      },
    );
  });
});
