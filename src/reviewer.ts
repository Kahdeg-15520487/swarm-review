import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel, streamSimpleOpenAICompletions } from "@earendil-works/pi-ai";
import type { Finding, DomainFindings } from "./types.js";

const SKILL_DIR = resolve(import.meta.dirname, "..");

/** Run a single sub-reviewer as a standalone agent session */
export async function runReviewer(
  promptFile: string,
  diffPath: string,
  sharedContextPath: string,
  outputPath: string,
  customInstructions?: string,
  provider?: string,
  modelId?: string,
): Promise<DomainFindings> {
  const promptText = readFileSync(resolve(SKILL_DIR, promptFile), "utf-8");
  const diffSnippet = readFileSync(diffPath, "utf-8").slice(0, 20_000);
  let sharedContext = "";
  try { sharedContext = readFileSync(sharedContextPath, "utf-8"); } catch { /* optional */ }

  const p = provider ?? "anthropic";
  const m = modelId ?? "claude-sonnet-4-20250514";
  const model = getModel(p as any, m as any);
  if (!model) throw new Error(`Model not found: ${p}/${m}. Check your API key and model name.`);

  const domain = extractDomain(promptFile);

  const agent = new Agent({
    initialState: {
      systemPrompt: `You are a ${domain} code reviewer. Be thorough but concise.`,
      model,
      thinkingLevel: "off",
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
    `# Instructions`,
    ``,
    promptText,
    ``,
    `# Shared Context`,
    sharedContext,
    ``,
    `# Diff (first 20KB)`,
    "```diff",
    diffSnippet,
    "```",
    customInstructions ? `\n# Custom Instructions\n${customInstructions}` : "",
    ``,
    `# Output Format`,
    `Return your findings as structured XML. Each finding must use this format:`,
    ``,
    `<finding severity="critical|warning|suggestion">
  <file>path/to/file.ts</file>
  <line>42</line>
  <title>Short title</title>
  <description>Clear explanation.</description>
  <recommendation>How to fix.</recommendation>
</finding>`,
    ``,
    `If no issues found, return: <finding severity="none"><description>No issues found.</description></finding>`,
  ].join("\n");

  await agent.prompt(instructions);
  await agent.waitForIdle();

  const parsed = parseFindings(output, domain);
  writeFileSync(outputPath, output);
  return parsed;
}

function parseFindings(output: string, domain: string): DomainFindings {
  const findings: Finding[] = [];
  // Use String.raw to preserve \s and \S escape sequences in the regex
  const regex = new RegExp(
    String.raw`<finding\s+severity="(critical|warning|suggestion|none)">([\s\S]*?)<\/finding>`,
    "g",
  );
  let match;
  while ((match = regex.exec(output)) !== null) {
    if (match[1] === "none") continue;
    const body = match[2];
    findings.push({
      severity: match[1] as Finding["severity"],
      file: extractTag(body, "file") || "",
      line: Number(extractTag(body, "line")) || 0,
      title: extractTag(body, "title") || "",
      description: extractTag(body, "description") || "",
      recommendation: extractTag(body, "recommendation") || "",
    });
  }
  return { domain, findings };
}

function extractTag(body: string, tag: string): string {
  const m = body.match(new RegExp(String.raw`<${tag}>([\s\S]*?)<\/${tag}>`));
  return m ? m[1].trim() : "";
}

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
