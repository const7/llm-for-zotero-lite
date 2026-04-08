/**
 * Agent Skills — file-driven guidance instructions.
 *
 * Each skill is a `.md` file with frontmatter match patterns and a body
 * instruction. When a user's message matches a skill's patterns, the
 * instruction is injected into the agent system prompt alongside tool
 * guidances.
 *
 * Built-in skills are bundled at compile time and copied to the user's
 * data directory on first run. The user folder is the sole source of
 * truth — the agent reads only from there.
 *
 * Users can create, edit, or delete skills by managing `.md` files in:
 *   {Zotero data directory}/llm-for-zotero/skills/
 */
import { matchesSkill } from "./skillLoader";
import type { AgentSkill } from "./skillLoader";
import libraryAnalysisRaw from "./library-analysis.md";
import comparePapersRaw from "./compare-papers.md";
import analyzeFiguresRaw from "./analyze-figures.md";
import simplePaperQaRaw from "./simple-paper-qa.md";
import evidenceBasedQaRaw from "./evidence-based-qa.md";
import noteFromPaperRaw from "./note-from-paper.md";
import noteEditingRaw from "./note-editing.md";
import literatureReviewRaw from "./literature-review.md";
import writeToObsidianRaw from "./write-to-obsidian.md";

export { matchesSkill } from "./skillLoader";
export type { AgentSkill } from "./skillLoader";

/**
 * Built-in skill files bundled at compile time.
 * Used by initUserSkills() to copy defaults to the user folder.
 */
export const BUILTIN_SKILL_FILES: Record<string, string> = {
  "library-analysis.md": libraryAnalysisRaw,
  "compare-papers.md": comparePapersRaw,
  "analyze-figures.md": analyzeFiguresRaw,
  "simple-paper-qa.md": simplePaperQaRaw,
  "evidence-based-qa.md": evidenceBasedQaRaw,
  "note-from-paper.md": noteFromPaperRaw,
  "note-editing.md": noteEditingRaw,
  "literature-review.md": literatureReviewRaw,
  "write-to-obsidian.md": writeToObsidianRaw,
};

/**
 * Skills loaded from the user's data directory.
 * This is the sole source of truth — the agent reads only from here.
 */
let skills: AgentSkill[] = [];

/**
 * Replace the current set of skills.
 * Called once at plugin startup after scanning the user skills directory.
 */
export function setUserSkills(loaded: AgentSkill[]): void {
  skills = loaded;
}

/**
 * Returns all skills loaded from the user folder.
 * This is the primary accessor used by messageBuilder and trace events.
 */
export function getAllSkills(): AgentSkill[] {
  return skills;
}

/**
 * Returns the IDs of all skills whose patterns match the request.
 * Used by the runtime to emit trace events for matched skills.
 */
export function getMatchedSkillIds(
  request: Pick<import("../types").AgentRuntimeRequest, "userText">,
): string[] {
  return getAllSkills()
    .filter((skill) => matchesSkill(skill, request))
    .map((skill) => skill.id);
}
