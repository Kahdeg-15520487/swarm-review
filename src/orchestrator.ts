import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { autoDetectConfig, selectReviewers } from "./diff.js";
import { runReviewer } from "./reviewer.js";
import { runCoordinator } from "./coordinator.js";
import type { DomainFindings, ResolvedConfig, ReviewResult } from "./types.js";

export interface SwarmReviewOptions {
  cwd?: string;
  config?: ResolvedConfig;
  customInstructions?: string;
  keepTemp?: boolean;
  outputPath?: string;
  onProgress?: (msg: string) => void;
  provider?: string;
  model?: string;
}

const log = (msg: string, cb?: (s: string) => void) => {
  if (cb) cb(msg);
  else console.error(`[swarm-review] ${msg}`);
};

/** Render a structured ReviewResult to Markdown */
function renderMarkdown(result: ReviewResult): string {
  const lines: string[] = [];
  lines.push("# Swarm Review Result");
  lines.push("");
  lines.push(`- Verdict: \`${result.verdict.replace(/_/g, " ")}\``);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(result.summary);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Findings");
  lines.push("");

  for (const domain of result.findings) {
    if (domain.findings.length === 0) continue;

    const domainTitle = domainNameToTitle(domain.domain);
    lines.push(`### ${domainTitle}`);
    lines.push("");

    for (const f of domain.findings) {
      const sevLabel = f.severity.charAt(0).toUpperCase() + f.severity.slice(1);
      lines.push(`#### ${sevLabel} \u2014 ${f.title}`);
      lines.push(`- File: \`${f.file}${f.line ? ":" + f.line : ""}\``);
      lines.push(`- ${f.description}`);
      if (f.recommendation) {
        lines.push(`- Recommendation: ${f.recommendation}`);
      }
      lines.push("");
    }
  }

  lines.push("## Domains reviewed");
  lines.push("");
  const allDomains = ["Code Quality", "Security", "Performance", "Documentation", "Compliance / codex", "AGENTS.md", "Release"];
  for (const d of allDomains) {
    lines.push(`- ${d}`);
  }

  return lines.join("\n");
}

function domainNameToTitle(domain: string): string {
  const map: Record<string, string> = {
    code_quality: "Code Quality",
    security: "Security",
    performance: "Performance",
    documentation: "Documentation",
    compliance: "Compliance / codex",
    agents_md: "AGENTS.md",
    release: "Release",
  };
  return map[domain] ?? domain;
}

export async function runSwarmReview(options: SwarmReviewOptions = {}): Promise<{
  config: ResolvedConfig;
  resultPath: string;
}> {
  const { cwd, customInstructions, keepTemp, outputPath, onProgress, provider, model } = options;
  const config = options.config ?? (await autoDetectConfig(cwd));

  const modelInfo = model ? `${provider ?? "anthropic"}/${model}` : "default";
  log(`Repository: ${config.repoRoot}`, onProgress);
  log(`Branch: ${config.branch}`, onProgress);
  log(`Risk tier: ${config.tier}`, onProgress);
  log(`Model: ${modelInfo}`, onProgress);
  log(`Diff: ${config.diffPath}`, onProgress);

  const swarmDir = resolve(config.repoRoot, ".swarm-review");
  const sharedContextPath = resolve(swarmDir, "shared-mr-context.txt");
  const finalOutputPath = outputPath ?? resolve(config.repoRoot, "review-result.md");

  // Determine which reviewers to run
  const reviewers = selectReviewers(config.tier);
  log(`Selected ${reviewers.length} reviewers: ${reviewers.map((r) => r.name).join(", ")}`, onProgress);

  // Run all sub-reviewers in parallel — they return findings directly via tools
  log("Launching sub-reviewers...", onProgress);
  const reviewerTasks = reviewers.map((r) =>
    runReviewer(
      r.promptFile,
      config.diffPath,
      sharedContextPath,
      customInstructions,
      provider,
      model,
    ).then(
      (findings) => ({ name: r.name, findings }),
      (err) => {
        log(`  \u26a0 ${r.name} failed: ${err}`, onProgress);
        return { name: r.name, findings: { domain: r.name, findings: [] } as DomainFindings };
      },
    )
  );

  const reviewerResults = await Promise.all(reviewerTasks);
  const allFindings = reviewerResults.map((r) => r.findings);
  const totalFindings = allFindings.reduce((s, d) => s + d.findings.length, 0);
  log(`Sub-reviewers complete. Total findings: ${totalFindings}`, onProgress);

  // Coordinator judge pass
  log("Running coordinator judge pass...", onProgress);
  const result = await runCoordinator(
    allFindings,
    sharedContextPath,
    config.diffPath,
    customInstructions,
    provider,
    model,
  );
  log(`Verdict: ${result.verdict}`, onProgress);
  log(`Final review: ${finalOutputPath}`, onProgress);

  // Render structured result to Markdown and write to file
  const markdown = renderMarkdown(result);
  writeFileSync(finalOutputPath, markdown, "utf-8");

  // Cleanup intermediary files
  if (!keepTemp && existsSync(swarmDir)) {
    rmSync(swarmDir, { recursive: true, force: true });
    log("Cleaned up .swarm-review/ intermediary files", onProgress);
  }

  return { config, resultPath: finalOutputPath };
}
