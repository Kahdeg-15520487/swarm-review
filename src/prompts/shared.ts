/**
 * Standalone-specific affixes appended to prompts loaded from SKILL.md.
 *
 * These replace the "**Output:**" section that SKILL.md carries for agentic harnesses.
 * The standalone uses structured tool calls instead of plain markdown output.
 */

/** Appended to every specialist reviewer prompt. */
export const REVIEWER_AFFIX = `\
## Standalone Rules

1. Only review code that appears in the diff. Do not flag issues in unchanged code.
2. Before flagging any issue, read the surrounding code to confirm it is real — not a false positive.
3. Be specific: reference the exact file, line number, and a short code snippet.
4. One finding per issue. Clear title. Actionable recommendation.
5. If the diff is small and clean, respond with "No issues found." and do not call any tool.

## Severity

- **critical** — Directly exploitable, causes data loss or an outage, or is a confirmed security vulnerability.
- **warning** — Measurable regression, concrete risk, or a bug that manifests under normal usage.
- **suggestion** — An improvement worth considering. Not a bug, not a risk.

## Output

Call the \`report_finding\` tool once per finding. Do NOT write findings as plain text.
If you find no issues, respond with "No issues found." and do not call any tool.`;

/** Appended to the coordinator prompt. */
export const COORDINATOR_AFFIX = `\
## Output

Call the \`submit_review\` tool ONCE with the final consolidated review object.
Do NOT write a markdown file or produce plain text findings — the tool is always available.`;
