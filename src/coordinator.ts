import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel, streamSimpleOpenAICompletions } from "@earendil-works/pi-ai";
import type { DomainFindings, ReviewResult, Verdict, Finding } from "./types.js";

const SKILL_DIR = resolve(import.meta.dirname, "..");

export async function runCoordinator(
  allFindings: DomainFindings[],
  sharedContextPath: string,
  diffPath: string,
  outputPath: string,
  customInstructions?: string,
  provider?: string,
  modelId?: string,
): Promise<ReviewResult> {
  const prompt = readFileSync(resolve(SKILL_DIR, "prompts", "coordinator.md"), "utf-8");
  let sharedContext = "";
  try { sharedContext = readFileSync(sharedContextPath, "utf-8"); } catch {}

  const findingsText = allFindings
    .map((d) => `## ${d.domain}\n${d.findings.map((f) => `- [${f.severity}] ${f.file}:${f.line} \u2014 ${f.title}`).join("\n")}`)
    .join("\n\n");

  const p = provider ?? "anthropic";
  const m = modelId ?? "claude-opus-4-5";
  const model = getModel(p as any, m as any);
  if (!model) throw new Error(`Model not found: ${p}/${m}.`);

  const agent = new Agent({
    initialState: {
      systemPrompt: "You are a code review coordinator. Consolidate findings and produce a verdict.",
      model,
      thinkingLevel: "medium",
      tools: [],
    },
    streamFn: streamSimpleOpenAICompletions as any,
    getApiKey: (prov: string) => process.env[`${prov.toUpperCase()}_API_KEY`] || undefined,
  });

  let output = "";
  agent.subscribe((event: any) => {
    if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
      output += event.assistantMessageEvent.delta;
    }
  });

  const instructions = [
    `# Coordinator Instructions`,
    ``,
    prompt,
    ``,
    `# Sub-Reviewer Findings`,
    findingsText,
    ``,
    `# Shared Context`,
    sharedContext,
    ``,
    customInstructions ? `\n# Custom Instructions\n${customInstructions}` : "",
    ``,
    `Produce a single structured review with verdict and all findings.`,
  ].join("\n");

  await agent.prompt(instructions);
  await agent.waitForIdle();

  writeFileSync(outputPath, output);
  return parseReviewResult(output);
}

function parseReviewResult(output: string): ReviewResult {
  // Extract verdict: first line after "## Verdict" heading
  const lines = output.split("\n");
  const verdictIdx = lines.findIndex((l) => l.startsWith("## Verdict"));
  let verdict: Verdict = "minor_issues";
  if (verdictIdx >= 0 && verdictIdx + 2 < lines.length) {
    const v = lines[verdictIdx + 2]?.trim();
    if (v) verdict = v as Verdict;
  }

  // Extract summary: text between "## Summary" and "## Findings"
  const summaryIdx = lines.findIndex((l) => l.startsWith("## Summary"));
  const findingsIdx = lines.findIndex((l) => l.startsWith("## Findings"));
  let summary = "";
  if (summaryIdx >= 0 && findingsIdx > summaryIdx) {
    summary = lines.slice(summaryIdx + 2, findingsIdx).join("\n").trim();
  }

  // Extract domain sections by looking for "### <domain>" headings
  const domainNames = ["code_quality", "security", "performance", "documentation", "compliance", "agents_md", "release"];
  const findings: DomainFindings[] = [];

  for (const domain of domainNames) {
    const domainIdx = lines.findIndex((l) => l.trim() === "### " + domain);
    if (domainIdx < 0) continue;

    // Find next domain heading or next ## heading
    let endIdx = lines.length;
    for (let i = domainIdx + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith("### ") || t.startsWith("## ")) {
        endIdx = i;
        break;
      }
    }

    const bodyLines = lines.slice(domainIdx + 1, endIdx);
    const body = bodyLines.join("\n");

    // Extract findings: lines starting with "#### [severity]"
    const findingList: Finding[] = [];
    let i = 0;
    while (i < bodyLines.length) {
      const findingMatch = bodyLines[i].match(/^#### \[(critical|warning|suggestion)\] (.+)/);
      if (!findingMatch) { i++; continue; }

      const severity = findingMatch[1] as Finding["severity"];
      const title = findingMatch[2].trim();
      i++;

      // Collect detail lines until next #### or ---
      let detail = "";
      while (i < bodyLines.length && !bodyLines[i].match(/^#### \[/) && !bodyLines[i].match(/^---/)) {
        detail += bodyLines[i] + "\n";
        i++;
      }

      const fileMatch = detail.match(/^\*\*File:\*\*\s*`(.+?)`/m);
      const descMatch = detail.match(/^\*\*Description:\*\*\s+(.+)/m);
      const recMatch = detail.match(/^\*\*Recommendation:\*\*\s+(.+)/m);

      const file = fileMatch?.[1]?.trim() ?? "";
      const lineNumMatch = file.match(/:(\d+)$/);
      const line = lineNumMatch ? parseInt(lineNumMatch[1], 10) : 0;

      findingList.push({
        severity,
        file: file.replace(/:\d+$/, ""),
        line,
        title,
        description: descMatch?.[1]?.trim() ?? "",
        recommendation: recMatch?.[1]?.trim() ?? "",
      });
    }

    findings.push({ domain, findings: findingList });
  }

  return { verdict, summary, findings };
}
