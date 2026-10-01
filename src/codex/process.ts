import { config } from "../../package.json";
import { getPluginDataDir } from "../utils/pluginDataDir";
import { joinLocalPath } from "../utils/localPath";
import type { CodexProcess } from "./rpc";

export const CODEX_ARGUMENTS = [
  "app-server",
  "--listen",
  "stdio://",
  "-c",
  'web_search="disabled"',
  "-c",
  "project_doc_max_bytes=0",
  ...[
    "shell_tool",
    "multi_agent",
    "apps",
    "plugins",
    "remote_plugin",
    "browser_use",
    "computer_use",
    "code_mode_host",
    "hooks",
    "shell_snapshot",
    "memories",
  ].flatMap((feature) => ["-c", `features.${feature}=false`]),
];

// Use Gecko's asynchronous pipes; no shell and no subprocess on the UI thread.
export async function spawnCodex(): Promise<CodexProcess> {
  const chrome = ztoolkit.getGlobal("ChromeUtils") as any;
  const { Subprocess } = chrome.importESModule(
    "resource://gre/modules/Subprocess.sys.mjs",
  );
  const services = ztoolkit.getGlobal("Services") as any;
  const io = ztoolkit.getGlobal("IOUtils") as any;
  const paths = ztoolkit.getGlobal("PathUtils") as any;
  const home =
    services.env.get(Zotero.isWin ? "USERPROFILE" : "HOME") ||
    paths?.homeDir ||
    "";
  const configured = Zotero.Prefs.get(
    `${config.prefsPrefix}.codexBinaryPath`,
    true,
  );
  let binary = typeof configured === "string" ? configured.trim() : "";
  if (!binary) {
    try {
      binary = await Subprocess.pathSearch("codex");
    } catch {
      /* GUI PATH often omits Homebrew. */
    }
    if (!binary) {
      for (const candidate of [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        ...(home ? [joinLocalPath(home, ".local", "bin", "codex")] : []),
      ]) {
        if (await io.exists(candidate)) {
          binary = candidate;
          break;
        }
      }
    }
  }
  if (!binary)
    throw new Error(
      "Codex was not found. Install the Codex CLI and set its executable path in Settings.",
    );
  const cwd = getPluginDataDir("codex");
  await io.makeDirectory(cwd, { createAncestors: true, ignoreExisting: true });
  const inheritedPath = services.env.get("PATH") || "";
  const directory = binary.slice(
    0,
    Math.max(binary.lastIndexOf("/"), binary.lastIndexOf("\\")),
  );
  const separator = Zotero.isWin ? ";" : ":";
  return Subprocess.call({
    command: binary,
    arguments: CODEX_ARGUMENTS,
    workdir: cwd,
    stderr: "pipe",
    environmentAppend: true,
    environment: { PATH: `${directory}${separator}${inheritedPath}` },
  });
}
