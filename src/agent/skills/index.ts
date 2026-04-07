/**
 * Agent Skills — file-driven guidance instructions.
 *
 * Each skill is a `.md` file with frontmatter match patterns and a body
 * instruction. When a user's message matches a skill's patterns, the
 * instruction is injected into the agent system prompt alongside tool
 * guidances.
 *
 * To add a new skill:
 * 1. Create a `.md` file in this directory (use existing skills as templates).
 * 2. Import it below and add it to the BUILTIN_SKILLS array.
 *
 * Users can also add custom skills by placing `.md` files in:
 *   {Zotero data directory}/llm-for-zotero/skills/
 * These are loaded at runtime via loadUserSkills().
 */
import { parseSkill, matchesSkill } from "./skillLoader";
import type { AgentSkill } from "./skillLoader";
import libraryAnalysisRaw from "./library-analysis.md";
import comparePapersRaw from "./compare-papers.md";
import analyzeFiguresRaw from "./analyze-figures.md";
import simplePaperQaRaw from "./simple-paper-qa.md";
import evidenceBasedQaRaw from "./evidence-based-qa.md";
import noteFromPaperRaw from "./note-from-paper.md";
import noteEditingRaw from "./note-editing.md";
import literatureReviewRaw from "./literature-review.md";

export { matchesSkill } from "./skillLoader";
export type { AgentSkill } from "./skillLoader";

/** Built-in skills bundled at compile time. */
const BUILTIN_SKILLS: AgentSkill[] = [
  parseSkill(libraryAnalysisRaw),
  parseSkill(comparePapersRaw),
  parseSkill(analyzeFiguresRaw),
  parseSkill(simplePaperQaRaw),
  parseSkill(evidenceBasedQaRaw),
  parseSkill(noteFromPaperRaw),
  parseSkill(noteEditingRaw),
  parseSkill(literatureReviewRaw),
];

/** User-defined skills loaded at runtime from the data directory. */
let userSkills: AgentSkill[] = [];

/**
 * Replace the current set of user-defined skills.
 * Called once at plugin startup after scanning the user skills directory.
 */
export function setUserSkills(skills: AgentSkill[]): void {
  userSkills = skills;
}

/**
 * Returns all skills (built-in + user-defined).
 * This is the primary accessor used by messageBuilder and trace events.
 */
export function getAllSkills(): AgentSkill[] {
  return [...BUILTIN_SKILLS, ...userSkills];
}

/**
 * @deprecated Use {@link getAllSkills} instead. Kept for backward compatibility.
 */
export const AGENT_SKILLS = BUILTIN_SKILLS;

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
