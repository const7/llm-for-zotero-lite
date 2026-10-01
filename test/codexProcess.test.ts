import { assert } from "chai";
import { CODEX_ARGUMENTS, spawnCodex } from "../src/codex/process";
import { config } from "../package.json";

describe("Codex process launch", function () {
  const originalToolkit = globalThis.ztoolkit;
  const originalZotero = globalThis.Zotero;
  afterEach(function () {
    globalThis.ztoolkit = originalToolkit;
    globalThis.Zotero = originalZotero;
  });

  it("launches the configured executable with asynchronous pipes in a dedicated directory", async function () {
    let invocation: any;
    const created: string[] = [];
    const child = {};
    globalThis.Zotero = {
      Prefs: {
        get: (key: string) =>
          key === `${config.prefsPrefix}.codexBinaryPath`
            ? "/opt/custom bin/codex"
            : "",
      },
      DataDirectory: { dir: "/data/zotero" },
      isWin: false,
    } as any;
    globalThis.ztoolkit = {
      getGlobal: (name: string) =>
        ({
          ChromeUtils: {
            importESModule: () => ({
              Subprocess: {
                call: async (value: any) => {
                  invocation = value;
                  return child;
                },
              },
            }),
          },
          Services: {
            env: {
              get: (key: string) =>
                key === "PATH" ? "/usr/bin:/bin" : "/home/test",
            },
          },
          IOUtils: {
            makeDirectory: async (path: string) => {
              created.push(path);
            },
          },
        })[name],
    } as any;
    assert.strictEqual(await spawnCodex(), child);
    assert.equal(invocation.command, "/opt/custom bin/codex");
    assert.deepEqual(invocation.arguments, CODEX_ARGUMENTS);
    assert.equal(invocation.stderr, "pipe");
    assert.equal(invocation.workdir, "/data/zotero/llm-for-zotero-lite/codex");
    assert.deepEqual(created, [invocation.workdir]);
    assert.equal(invocation.environment.PATH, "/opt/custom bin:/usr/bin:/bin");
  });
});
