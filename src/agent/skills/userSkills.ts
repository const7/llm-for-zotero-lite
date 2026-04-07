/**
 * User-defined skills — runtime loading from the Zotero data directory.
 *
 * Users can place `.md` skill files (same frontmatter format as built-in
 * skills) in `{Zotero data directory}/llm-for-zotero/skills/`. These are
 * loaded once at startup and merged with built-in skills.
 */
import { parseSkill } from "./skillLoader";
import type { AgentSkill } from "./skillLoader";

const USER_SKILLS_DIR_NAME = "llm-for-zotero/skills";

// ---------------------------------------------------------------------------
// Gecko runtime helpers (mirrors patterns from mineruCache.ts)
// ---------------------------------------------------------------------------

type PathUtilsLike = {
  join?: (...parts: string[]) => string;
};

type IOUtilsLike = {
  exists?: (path: string) => Promise<boolean>;
  read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  makeDirectory?: (
    path: string,
    options?: { createAncestors?: boolean; ignoreExisting?: boolean },
  ) => Promise<void>;
  getChildren?: (path: string) => Promise<string[]>;
};

function getPathUtils(): PathUtilsLike | undefined {
  return (globalThis as { PathUtils?: PathUtilsLike }).PathUtils;
}

function getIOUtils(): IOUtilsLike | undefined {
  return (globalThis as unknown as { IOUtils?: IOUtilsLike }).IOUtils;
}

function joinPath(...parts: string[]): string {
  const pathUtils = getPathUtils();
  if (pathUtils?.join) return pathUtils.join(...parts);
  return parts
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.replace(/[\\/]+$/, "")
        : part.replace(/^[\\/]+|[\\/]+$/g, ""),
    )
    .join("/");
}

function getBaseDir(): string {
  const zotero = Zotero as unknown as {
    DataDirectory?: { dir?: string };
    Profile?: { dir?: string };
  };
  const dataDir = zotero.DataDirectory?.dir;
  if (typeof dataDir === "string" && dataDir.trim()) return dataDir.trim();
  const profileDir = zotero.Profile?.dir;
  if (typeof profileDir === "string" && profileDir.trim())
    return profileDir.trim();
  throw new Error("Cannot resolve Zotero data directory for user skills");
}

/** Returns the directory path where user skill files are stored. */
export function getUserSkillsDir(): string {
  return joinPath(getBaseDir(), USER_SKILLS_DIR_NAME);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Scan the user skills directory for `.md` files and parse them.
 * Returns an empty array if the directory does not exist or no valid
 * skill files are found. Never throws.
 */
export async function loadUserSkills(): Promise<AgentSkill[]> {
  const io = getIOUtils();
  if (!io?.exists || !io?.read || !io?.getChildren) return [];

  const dir = getUserSkillsDir();

  // Ensure directory exists (create it on first run so users know where to put files)
  try {
    const exists = await io.exists(dir);
    if (!exists) {
      if (io.makeDirectory) {
        await io.makeDirectory(dir, {
          createAncestors: true,
          ignoreExisting: true,
        });
      }
      return [];
    }
  } catch {
    return [];
  }

  // List .md files
  let entries: string[];
  try {
    entries = await io.getChildren(dir);
  } catch {
    return [];
  }

  const mdFiles = entries.filter((entry) => entry.endsWith(".md"));
  if (mdFiles.length === 0) return [];

  const skills: AgentSkill[] = [];

  for (const filePath of mdFiles) {
    try {
      const data = await io.read(filePath);
      const bytes =
        data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
      const raw = new TextDecoder("utf-8").decode(bytes);

      const skill = parseSkill(raw);

      // Validate: must have a real id and at least one pattern
      if (skill.id === "unknown" || skill.patterns.length === 0) {
        Zotero.debug?.(
          `[llm-for-zotero] Skipping invalid user skill file (missing id or match patterns): ${filePath}`,
        );
        continue;
      }

      // Prefix id to avoid collision with built-in skills
      skill.id = `user:${skill.id}`;
      skills.push(skill);
    } catch (err) {
      Zotero.debug?.(
        `[llm-for-zotero] Error loading user skill file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (skills.length > 0) {
    Zotero.debug?.(
      `[llm-for-zotero] Loaded ${skills.length} user skill(s) from ${dir}`,
    );
  }

  return skills;
}
