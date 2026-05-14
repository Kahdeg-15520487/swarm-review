import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel, streamSimpleOpenAICompletions } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { DomainFindings, ReviewResult, Verdict, Finding } from "./types.js";

const SKILL_DIR = resolve(import.meta.dirname, "..");

/** Map Title Case domain names → internal keys */
const DOMAIN_MAP: Record<string, string> = {
  "Code Quality": "code_quality",
  Security: "security",
  Performance: "performance",
  Documentation: "documentation",
  "Compliance / codex": "compliance",
  "AGENTS.md": "agents_md",
  Release: "release",
};

/** Tool: submit_review — coordinator calls this once to submit the final verdict */
function createSubmitReviewTool() {
  let result: ReviewResult | null = null;

  const tool: AgentTool<typeof submitReviewSchema, { submitted: boolean }> = {
    name: "submit_review",
    label: "Submit Review",
    description: "Submit the final consolidated review. Call this ONCE after analyzing all sub-reviewer findings.",
    parameters: submitReviewSchema,
    async execute(_id, params) {
      // Map Title Case domains back to internal keys
      const findings: DomainFindings[] = [];
      const domainGroup = new Map<string, Finding[]>();
      for (const f of params.findings ?? []) {
        const key = DOMAIN_MAP[f.domain] ?? f.domain;
        if (!domainGroup.has(key)) domainGroup.set(key, []);
        domainGroup.get(key)!.push({
          severity: f.severity as Finding["severity"],
          file: f.file,
          line: f.line ?? 0,
          title: f.title,
          description: f.description,
          recommendation: f.recommendation,
        });
      }
      for (const [domain, findingsList] of domainGroup) {
        findings.push({ domain, findings: findingsList });
      }

      result = {
        verdict: params.verdict as Verdict,
        summary: params.summary,
        findings,
      };

      return {
        content: [{ type: "text" as const, text: `Review submitted: ${params.verdict}` }],
        details: { submitted: true },
        terminate: true,
      };
    },
  };

  return { tool, getResult: () => result };
}

const findingSchema = Type.Object({
  severity: Type.Union([
    Type.Literal("critical"),
    Type.Literal("warning"),
    Type.Literal("suggestion"),
  ], { description: "Severity of the finding" }),
  domain: Type.String({ description: "Domain: one of: Code Quality, Security, Performance, Documentation, Compliance / codex, AGENTS.md, Release" }),
  title: Type.String({ description: "Short title for the issue" }),
  description: Type.String({ description: "Detailed description" }),
  file: Type.String({ description: "File path" }),
  line: Type.Optional(Type.Number({ description: "Line number" })),
  recommendation: Type.String({ description: "How to fix" }),
});

const submitReviewSchema = Type.Object({
  verdict: Type.Union([
    Type.Literal("approved"),
    Type.Literal("approved_with_comments"),
    Type.Literal("minor_issues"),
    Type.Literal("significant_concerns"),
  ], { description: "Overall review verdict" }),
  summary: Type.String({ description: "Brief 1-3 sentence summary of the review" }),
  findings: Type.Array(findingSchema, { description: "Deduplicated, consolidated findings" }),
});

export async function runCoordinator(
  allFindings: DomainFindings[],
  sharedContextPath: string,
  diffPath: string,
  customInstructions?: string,
  provider?: string,
  modelId?: string,
): Promise<ReviewResult> {
  const prompt = readFileSync(resolve(SKILL_DIR, "prompts", "coordinator.md"), "utf-8");
  let sharedContext = "";
  try { sharedContext = readFileSync(sharedContextPath, "utf-8"); } catch {}

  // Build a summary of sub-reviewer findings for the coordinator's context
  const domainSummary = allFindings
    .map((d) => {
      const lines = d.findings.map((f) => `  [${f.severity}] ${f.file}:${f.line} \u2014 ${f.title}\n    ${f.description}`);
      return `### ${d.domain}\n${lines.join("\n")}`;
    })
    .join("\n\n");

  const p = provider ?? "anthropic";
  const m = modelId ?? "claude-opus-4-5";
  const model = getModel(p as any, m as any);
  if (!model) throw new Error(`Model not found: ${p}/${m}.`);

  const { tool, getResult } = createSubmitReviewTool();

  const agent = new Agent({
    initialState: {
      systemPrompt: [
        `You are a code review coordinator. Your job is to consolidate findings from multiple specialized reviewers, deduplicate them, re-categorize as needed, filter false positives, and call \`submit_review\` with the final verdict and findings.`,
        ``,
        `Call \`submit_review\` EXACTLY ONCE when you are done. Include ALL findings from the sub-reviewers that are valid, removing only duplicates and false positives.`,
        ``,
        `Use the rubric: approved (clean), approved_with_comments (suggestions/warnings, no risk), minor_issues (risk patterns), significant_concerns (critical items).`,
      ].join("\n"),
      model,
      thinkingLevel: "medium",
      tools: [tool],
    },
    streamFn: streamSimpleOpenAICompletions as any,
    getApiKey: (prov: string) => process.env[`${prov.toUpperCase()}_API_KEY`] || undefined,
  });

  const instructions = [
    `# Coordinator Instructions`,
    prompt,
    ``,
    `# Sub-Reviewer Findings (${allFindings.reduce((s, d) => s + d.findings.length, 0)} total)`,
    domainSummary,
    ``,
    `# Shared Context`,
    sharedContext,
    ``,
    customInstructions ?? "",
    ``,
    `Call \`submit_review\` with the consolidated verdict and findings.`,
  ].join("\n");

  await agent.prompt(instructions);
  await agent.waitForIdle();

  return getResult() ?? {
    verdict: "minor_issues",
    summary: "Coordinator did not produce a result.",
    findings: [],
  };
}
