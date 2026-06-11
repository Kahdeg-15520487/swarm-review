/**
 * Loads reviewer and coordinator prompts from the canonical SKILL.md.
 *
 * Each section's "**Output:**" block is stripped and replaced by the
 * standalone-specific tool-calling affix passed in by the caller.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// SKILL.md sits at the package root; this file compiles to dist/prompts/loader.js
const SKILL_MD_PATH = resolve(__dirname, "../../SKILL.md");

const SECTION_NAMES: Record<string, string> = {
  security:      "Security Reviewer",
  performance:   "Performance Reviewer",
  quality:       "Code Quality Reviewer",
  documentation: "Documentation Reviewer",
  codex:         "Engineering Codex Reviewer",
  "agents-md":   "AGENTS.md Reviewer",
  release:       "Release Reviewer",
  coordinator:   "Coordinator",
};

// Cached after first read
let _skillMd: string | undefined;

function loadSkillMd(): string {
  if (_skillMd) return _skillMd;
  try {
    _skillMd = readFileSync(SKILL_MD_PATH, "utf-8");
    return _skillMd;
  } catch {
    throw new Error(
      `swarm-review: SKILL.md not found at ${SKILL_MD_PATH}. ` +
      `Ensure it is bundled with the package (see "files" in package.json).`,
    );
  }
}

function extractSection(skillMd: string, sectionName: string): string {
  const lines = skillMd.split("\n");
  let inSection = false;
  const collected: string[] = [];

  for (const line of lines) {
    if (line.trim() === `### ${sectionName}`) {
      inSection = true;
      continue; // skip the heading itself
    }
    if (inSection) {
      // Stop at the next ## or ### heading
      if (/^#{2,3} /.test(line)) break;
      collected.push(line);
    }
  }

  if (collected.length === 0) {
    throw new Error(
      `swarm-review: Section "### ${sectionName}" not found in SKILL.md`,
    );
  }

  return collected.join("\n").trim();
}

/**
 * Strip the **Output:** block — everything from that line to the end
 * of the section. The standalone replaces it with its own tool-calling affix.
 */
function stripOutputBlock(content: string): string {
  const idx = content.indexOf("\n**Output:**");
  return idx !== -1 ? content.slice(0, idx).trim() : content;
}

/**
 * Build the system prompt for a specialist reviewer.
 * Core content comes from SKILL.md; `affix` supplies the tool-calling rules.
 */
export function buildReviewerSystemPrompt(
  category: string,
  affix: string,
): string {
  const name = SECTION_NAMES[category];
  if (!name) throw new Error(`Unknown reviewer category: ${category}`);

  const core = stripOutputBlock(extractSection(loadSkillMd(), name));
  return `${core}\n\n${affix}`;
}

/**
 * Build the coordinator system prompt.
 * Core content comes from SKILL.md; `affix` supplies the submit_review instructions.
 */
export function buildCoordinatorSystemPrompt(affix: string): string {
  const core = stripOutputBlock(
    extractSection(loadSkillMd(), SECTION_NAMES.coordinator),
  );
  return `${core}\n\n${affix}`;
}
