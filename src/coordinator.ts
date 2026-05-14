import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel, streamSimpleOpenAICompletions } from "@earendil-works/pi-ai";
import type { DomainFindings, ReviewResult, Verdict } from "./types.js";

const SKILL_DIR = resolve(import.meta.dirname, "..");

/** Run the coordinator judge pass as a standalone agent session */
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
  try { sharedContext = readFileSync(sharedContextPath, "utf-8"); } catch { /* optional */ }

  const findingsText = allFindings
    .map((d) => `## ${d.domain}\n${d.findings.map((f) => `- [${f.severity}] ${f.file}:${f.line} — ${f.title}`).join("\n")}`)
    .join("\n\n");

  const p = provider ?? "anthropic";
  const m = modelId ?? "claude-opus-4-5";
  const model = getModel(p as any, m as any);
  if (!model) throw new Error(`Model not found: ${p}/${m}. Check your API key and model name.`);

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
  const verdictMatch = output.match(/<verdict>(.*?)<\/verdict>/);
  const summaryMatch = output.match(/<summary>([\s\S]*?)<\/summary>/);

  const verdict: Verdict = (verdictMatch?.[1]?.trim() as Verdict) ?? "minor_issues";

  const findings: DomainFindings[] = [];
  const domainRegex = /<domain\s+name="(.*?)">([\s\S]*?)<\/domain>/g;
  let domainMatch;
  while ((domainMatch = domainRegex.exec(output)) !== null) {
    const domain = domainMatch[1];
    const body = domainMatch[2];
    const findingRegex = /<finding\s+severity="(critical|warning|suggestion)">([\s\S]*?)<\/finding>/g;
    const findingsList = [];
    let fm;
    while ((fm = findingRegex.exec(body)) !== null) {
      const fbody = fm[2];
      findingsList.push({
        severity: fm[1] as any,
        file: extractTag(fbody, "file") || "",
        line: Number(extractTag(fbody, "line")) || 0,
        title: extractTag(fbody, "title") || "",
        description: extractTag(fbody, "description") || "",
        recommendation: extractTag(fbody, "recommendation") || "",
      });
    }
    findings.push({ domain, findings: findingsList });
  }

  return {
    verdict,
    summary: summaryMatch?.[1]?.trim() ?? "",
    findings,
  };
}

function extractTag(body: string, tag: string): string {
  const m = body.match(new RegExp(String.raw`<${tag}>([\s\S]*?)<\/${tag}>`));
  return m ? m[1].trim() : "";
}
