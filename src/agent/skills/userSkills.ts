/**
 * Skills — runtime loading from the Zotero data directory.
 *
 * The user's skills directory is the sole source of truth. Built-in skills
 * are copied there on first run (or when new ones are added in updates).
 * Users can create, edit, or delete `.md` skill files freely.
 */
import { parseSkill } from "./skillLoader";
import type { AgentSkill } from "./skillLoader";
import {
  BUILTIN_SKILL_FILES,
  BUILTIN_SKILL_FILENAMES,
  getBuiltinSkillInstruction,
} from "./index";
import { joinLocalPath } from "../../utils/localPath";

const USER_SKILLS_DIR_NAME = "llm-for-zotero/skills";

// ---------------------------------------------------------------------------
// Gecko runtime helpers (mirrors patterns from mineruCache.ts)
// ---------------------------------------------------------------------------

type IOUtilsLike = {
  exists?: (path: string) => Promise<boolean>;
  read?: (path: string) => Promise<Uint8Array | ArrayBuffer>;
  write?: (path: string, data: Uint8Array) => Promise<number>;
  makeDirectory?: (
    path: string,
    options?: { createAncestors?: boolean; ignoreExisting?: boolean },
  ) => Promise<void>;
  getChildren?: (path: string) => Promise<string[]>;
  remove?: (path: string) => Promise<void>;
};

function getIOUtils(): IOUtilsLike | undefined {
  return (globalThis as unknown as { IOUtils?: IOUtilsLike }).IOUtils;
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
  return joinLocalPath(getBaseDir(), "llm-for-zotero", "skills");
}

// ---------------------------------------------------------------------------
// Initialization — copy missing built-in skills to user folder
// ---------------------------------------------------------------------------

const SEEDED_PREF_KEY = "extensions.zotero.llmForZotero.seededBuiltinSkills";

/** Read the set of built-in skill filenames that have already been seeded. */
function getSeededSkills(): Set<string> {
  try {
    const raw = Zotero.Prefs?.get(SEEDED_PREF_KEY, true);
    if (typeof raw === "string" && raw) return new Set(JSON.parse(raw));
  } catch { /* */ }
  return new Set();
}

/** Persist the set of seeded filenames. */
function setSeededSkills(seeded: Set<string>): void {
  try {
    Zotero.Prefs?.set(SEEDED_PREF_KEY, JSON.stringify([...seeded]), true);
  } catch { /* */ }
}

/**
 * Ensure the user skills directory exists and seed built-in skills.
 *
 * Only skills that have **never been seeded** are copied. This means:
 * - New built-in skills from plugin updates auto-appear.
 * - If a user deletes a built-in skill, it stays deleted across restarts.
 *
 * Call this before loadUserSkills().
 */
export async function initUserSkills(): Promise<void> {
  const io = getIOUtils();
  if (!io?.exists || !io?.write || !io?.makeDirectory) return;

  const dir = getUserSkillsDir();

  try {
    const exists = await io.exists(dir);
    if (!exists) {
      await io.makeDirectory(dir, {
        createAncestors: true,
        ignoreExisting: true,
      });
    }
  } catch {
    return;
  }

  const seeded = getSeededSkills();
  const encoder = new TextEncoder();

  // ── Migration: write-to-obsidian.md → note-to-file.md ──────────────
  if (io.read && io.remove) {
    try {
      const oldPath = joinLocalPath(dir, "write-to-obsidian.md");
      const newPath = joinLocalPath(dir, "note-to-file.md");
      const oldExists = await io.exists(oldPath);
      const newExists = await io.exists(newPath);

      if (oldExists && !newExists) {
        const oldData = await io.read(oldPath);
        const oldBytes =
          oldData instanceof Uint8Array
            ? oldData
            : new Uint8Array(oldData as ArrayBuffer);
        const oldContent = new TextDecoder("utf-8").decode(oldBytes);

        // Only remove if user hasn't customized it (original id AND body)
        if (/^id:\s*write-to-obsidian\s*$/m.test(oldContent)) {
          const isOriginalBody =
            oldContent.includes("Writing Notes to Obsidian") &&
            oldContent.includes("file_io(write, filePath, noteContent)");
          if (isOriginalBody) {
            await io.remove(oldPath);
            Zotero.debug?.(
              "[llm-for-zotero] Removed old write-to-obsidian.md (migrated to note-to-file.md)",
            );
          } else {
            Zotero.debug?.(
              "[llm-for-zotero] Kept customized write-to-obsidian.md as personal skill",
            );
          }
        }
      }

      // Clean up seeded tracking for old filename
      if (seeded.has("write-to-obsidian.md")) {
        seeded.delete("write-to-obsidian.md");
      }
    } catch (err) {
      Zotero.debug?.(
        `[llm-for-zotero] Skill migration warning: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  for (const [filename, content] of Object.entries(BUILTIN_SKILL_FILES)) {
    if (seeded.has(filename)) continue; // already seeded once — respect user deletions
    const filePath = joinLocalPath(dir, filename);
    try {
      const exists = await io.exists(filePath);
      if (!exists) {
        await io.write(filePath, encoder.encode(content));
        Zotero.debug?.(
          `[llm-for-zotero] Copied built-in skill to user folder: ${filename}`,
        );
      }
      seeded.add(filename);
    } catch (err) {
      Zotero.debug?.(
        `[llm-for-zotero] Failed to copy built-in skill ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  setSeededSkills(seeded);

  // ── Metadata patching: inject name/description/version into old files ────
  // Existing users have on-disk skill files from previous versions that lack
  // the new frontmatter fields. Patch them without touching instruction body.
  if (io.read) {
    const decoder = new TextDecoder("utf-8");
    for (const [filename, shippedContent] of Object.entries(
      BUILTIN_SKILL_FILES,
    )) {
      const filePath = joinLocalPath(dir, filename);
      try {
        const fileExists = await io.exists(filePath);
        if (!fileExists) continue;
        const data = await io.read(filePath);
        const bytes =
          data instanceof Uint8Array
            ? data
            : new Uint8Array(data as ArrayBuffer);
        const onDiskRaw = decoder.decode(bytes);
        const patched = patchSkillFrontmatter(onDiskRaw, shippedContent);
        if (patched) {
          await io.write(filePath, encoder.encode(patched));
          Zotero.debug?.(
            `[llm-for-zotero] Patched skill metadata: ${filename}`,
          );
        }
      } catch (err) {
        Zotero.debug?.(
          `[llm-for-zotero] Skill metadata patch warning for ${filename}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Frontmatter metadata patching
// ---------------------------------------------------------------------------

/**
 * Patch an on-disk skill file's frontmatter with metadata (name, description,
 * version) from the shipped version, without touching the instruction body or
 * user-customized match patterns.
 *
 * Returns the patched string, or `null` if no patch is needed.
 */
export function patchSkillFrontmatter(
  onDiskRaw: string,
  shippedRaw: string,
): string | null {
  const onDisk = parseSkill(onDiskRaw);
  const shipped = parseSkill(shippedRaw);

  // Already up-to-date
  if (onDisk.version >= shipped.version) return null;

  // Rebuild frontmatter: use shipped name/description/version,
  // but keep on-disk id and match patterns (user may have customized those).
  const onDiskLines = onDiskRaw.split("\n");
  let inFm = false;
  let fmStart = -1;
  let fmEnd = -1;

  for (let i = 0; i < onDiskLines.length; i++) {
    if (onDiskLines[i].trim() === "---") {
      if (!inFm) {
        inFm = true;
        fmStart = i;
      } else {
        fmEnd = i;
        break;
      }
    }
  }

  if (fmStart < 0 || fmEnd < 0) return null;

  // Extract on-disk match lines (preserve user customizations)
  const onDiskMatchLines = onDiskLines
    .slice(fmStart + 1, fmEnd)
    .filter((l) => l.trim().startsWith("match:"));

  // Also preserve on-disk id (user may have renamed it)
  const idLine = `id: ${onDisk.id}`;

  // Build patched frontmatter
  const patchedFm = [
    "---",
    idLine,
    `description: ${shipped.description}`,
    `version: ${shipped.version}`,
    ...onDiskMatchLines,
    "---",
  ];

  // Instruction body is everything after the closing ---
  const instructionBody = onDiskLines.slice(fmEnd + 1).join("\n");

  return patchedFm.join("\n") + "\n" + instructionBody;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Scan the user skills directory for `.md` files and parse them.
 * This is the sole source of skills — all skills come from the user folder.
 * Returns an empty array if the directory does not exist or no valid
 * skill files are found. Never throws.
 */
export async function loadUserSkills(): Promise<AgentSkill[]> {
  const io = getIOUtils();
  if (!io?.exists || !io?.read || !io?.getChildren) return [];

  const dir = getUserSkillsDir();

  try {
    const exists = await io.exists(dir);
    if (!exists) return [];
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
          `[llm-for-zotero] Skipping invalid skill file (missing id or match patterns): ${filePath}`,
        );
        continue;
      }

      // Determine source badge: system / customized / personal
      const filename = filePath.split(/[/\\]/).pop() || "";
      if (BUILTIN_SKILL_FILENAMES.has(filename)) {
        const shippedInstruction = getBuiltinSkillInstruction(filename);
        skill.source =
          shippedInstruction !== undefined &&
          skill.instruction === shippedInstruction
            ? "system"
            : "customized";
      } else {
        skill.source = "personal";
      }

      skills.push(skill);
    } catch (err) {
      Zotero.debug?.(
        `[llm-for-zotero] Error loading skill file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (skills.length > 0) {
    Zotero.debug?.(
      `[llm-for-zotero] Loaded ${skills.length} skill(s) from ${dir}`,
    );
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Skill file management (used by the skills popup UI)
// ---------------------------------------------------------------------------

/** List all .md file paths (full absolute paths) in the user skills directory. */
export async function listSkillFiles(): Promise<string[]> {
  const io = getIOUtils();
  if (!io?.exists || !io?.getChildren) return [];

  const dir = getUserSkillsDir();
  try {
    const exists = await io.exists(dir);
    if (!exists) return [];
    const entries = await io.getChildren(dir);
    return entries.filter((entry) => entry.endsWith(".md"));
  } catch {
    return [];
  }
}

/** Delete a skill file by its full path. */
export async function deleteSkillFile(filePath: string): Promise<boolean> {
  const io = getIOUtils();
  if (!io?.remove) return false;

  try {
    await io.remove(filePath);
    return true;
  } catch (err) {
    Zotero.debug?.(
      `[llm-for-zotero] Failed to delete skill file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Create a new skill template file and return its full path.
 * Auto-generates a unique filename (custom-skill-1.md, custom-skill-2.md, ...).
 */
export async function createSkillTemplate(): Promise<string | null> {
  const io = getIOUtils();
  if (!io?.exists || !io?.write || !io?.makeDirectory) return null;

  const dir = getUserSkillsDir();

  // Ensure directory exists (user may have deleted it after startup)
  try {
    await io.makeDirectory(dir, {
      createAncestors: true,
      ignoreExisting: true,
    });
  } catch { /* */ }
  const encoder = new TextEncoder();
  const template = `---
id: my-custom-skill
description: Describe what this skill does
version: 1
match: /your regex pattern here/i
---

<!--
  Custom skill template.

  - name/description: shown in the "/" slash menu
  - match: regex patterns that trigger this skill (OR semantics)
  - version: increment when you make significant changes

  The text below is injected into the agent's system prompt when
  the skill activates. Edit it to define how the agent should behave.
-->

Describe when and how the agent should behave when this skill matches.
`;

  let index = 1;
  let filePath: string;
  // Find the next available filename
  // eslint-disable-next-line no-constant-condition
  while (true) {
    filePath = joinLocalPath(dir, `custom-skill-${index}.md`);
    try {
      const exists = await io.exists(filePath);
      if (!exists) break;
    } catch {
      break;
    }
    index++;
    if (index > 999) return null; // safety limit
  }

  try {
    await io.write(filePath, encoder.encode(template));
    return filePath;
  } catch (err) {
    Zotero.debug?.(
      `[llm-for-zotero] Failed to create skill template: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
