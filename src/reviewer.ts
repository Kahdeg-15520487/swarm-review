import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel, streamSimpleOpenAICompletions } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Finding, DomainFindings } from "./types.js";

const SKILL_DIR = resolve(import.meta.dirname, "..");

/** Tool: report_finding — sub-reviewers call this for each issue they find */
function createReportFindingTool(domain: string) {
  const findings: Finding[] = [];

  const tool: AgentTool<typeof reportFindingSchema, { recorded: number }> = {
    name: "report_finding",
    label: "Report Finding",
    description: "Call this tool for each code issue you discover during review. One call per finding.",
    parameters: reportFindingSchema,
    async execute(_id, params) {
      findings.push({
        severity: params.severity as Finding["severity"],
        file: params.file,
        line: params.line ?? 0,
        title: params.title,
        description: params.description,
        recommendation: params.recommendation,
      });
      return {
        content: [{ type: "text" as const, text: `Finding recorded: [${params.severity}] ${params.title}` }],
        details: { recorded: findings.length },
      };
    },
  };

  return { tool, getFindings: () => ({ domain, findings: [...findings] }) };
}

const reportFindingSchema = Type.Object({
  severity: Type.Union([
    Type.Literal("critical"),
    Type.Literal("warning"),
    Type.Literal("suggestion"),
  ], { description: "Severity level of the finding" }),
  title: Type.String({ description: "Short, specific title for the issue" }),
  description: Type.String({ description: "Detailed description of the issue and why it matters" }),
  file: Type.String({ description: "File path where the issue is found" }),
  line: Type.Optional(Type.Number({ description: "Line number (if known)" })),
  recommendation: Type.String({ description: "How to fix the issue" }),
});

/** Extract the domain name from a prompt file path */
function extractDomain(promptFile: string): string {
  const name = promptFile.replace(/^prompts\//, "").replace(/\.md$/, "");
  const map: Record<string, string> = {
    "code-quality": "code_quality",
    security: "security",
    performance: "performance",
    documentation: "documentation",
    codex: "compliance",
    "agents-md": "agents_md",
    release: "release",
  };
  return map[name] ?? name;
}

/** Run a single sub-reviewer as a standalone agent session with tool-based reporting */
export async function runReviewer(
  promptFile: string,
  diffPath: string,
  sharedContextPath: string,
  customInstructions?: string,
  provider?: string,
  modelId?: string,
): Promise<DomainFindings> {
  const promptText = readFileSync(resolve(SKILL_DIR, promptFile), "utf-8");
  const diffSnippet = readFileSync(diffPath, "utf-8").slice(0, 20_000);
  let sharedContext = "";
  try { sharedContext = readFileSync(sharedContextPath, "utf-8"); } catch {}

  const p = provider ?? "anthropic";
  const m = modelId ?? "claude-sonnet-4-20250514";
  const model = getModel(p as any, m as any);
  if (!model) throw new Error(`Model not found: ${p}/${m}.`);

  const domain = extractDomain(promptFile);
  const { tool, getFindings } = createReportFindingTool(domain);

  const agent = new Agent({
    initialState: {
      systemPrompt: [
        `You are a ${domain} code reviewer. Review the provided diff and report findings using the \`report_finding\` tool.`,
        ``,
        `# Instructions`,
        promptText,
        ``,
        `Call \`report_finding\` once per issue. Do NOT include findings in your text response — only use the tool.`,
        `If no issues found, just say "No issues found." and do not call the tool.`,
      ].join("\n"),
      model,
      thinkingLevel: "off",
      tools: [tool],
    },
    streamFn: streamSimpleOpenAICompletions as any,
    getApiKey: (prov: string) => process.env[`${prov.toUpperCase()}_API_KEY`] || undefined,
  });

  const instructions = [
    `## Diff to Review (first 20KB)`,
    "```diff",
    diffSnippet,
    "```",
    ``,
    `# Shared Context`,
    sharedContext,
    ``,
    customInstructions ? `\n# Custom Instructions\n${customInstructions}` : "",
  ].join("\n");

  await agent.prompt(instructions);
  await agent.waitForIdle();

  return getFindings();
}
