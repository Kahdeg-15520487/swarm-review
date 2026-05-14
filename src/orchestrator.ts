import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { autoDetectConfig, selectReviewers } from "./diff.js";
import { runReviewer } from "./reviewer.js";
import { runCoordinator } from "./coordinator.js";
import type { DomainFindings, ResolvedConfig } from "./types.js";

export interface SwarmReviewOptions {
  /** Working directory (defaults to process.cwd()) */
  cwd?: string;
  /** Explicit config — skips auto-detection */
  config?: ResolvedConfig;
  /** Custom instructions injected into all reviewer prompts */
  customInstructions?: string;
  /** Skip cleanup of .swarm-review dir after completion */
  keepTemp?: boolean;
  /** Path to write the final review result */
  outputPath?: string;
  /** Callback for progress updates */
  onProgress?: (msg: string) => void;
  /** Model provider (default: anthropic) */
  provider?: string;
  /** Model ID for sub-reviewers (default: claude-sonnet-4) */
  model?: string;
}

const log = (msg: string, cb?: (s: string) => void) => {
  if (cb) cb(msg);
  else console.error(`[swarm-review] ${msg}`);
};

/**
 * Run a full swarm review.
 * Auto-detects git context, spawns reviewers in parallel,
 * runs the coordinator judge pass, and produces review-result.md.
 */
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
  const reportsDir = resolve(swarmDir, "reports");
  const sharedContextPath = resolve(swarmDir, "shared-mr-context.txt");
  const finalOutputPath = outputPath ?? resolve(config.repoRoot, "review-result.md");

  // Determine which reviewers to run
  const reviewers = selectReviewers(config.tier);
  log(`Selected ${reviewers.length} reviewers: ${reviewers.map((r) => r.name).join(", ")}`, onProgress);

  // Run all sub-reviewers in parallel
  log("Launching sub-reviewers...", onProgress);
  const reviewerTasks = reviewers.map((r) =>
    runReviewer(
      r.promptFile,
      config.diffPath,
      sharedContextPath,
      resolve(reportsDir, `${r.name}-findings.md`),
      customInstructions,
      provider,
      model,
    ).then(
      (findings) => ({ name: r.name, findings }),
      (err) => {
        log(`  ⚠ ${r.name} failed: ${err}`, onProgress);
        return { name: r.name, findings: { domain: r.name, findings: [] } as DomainFindings };
      },
    )
  );

  const reviewerResults = await Promise.all(reviewerTasks);
  const allFindings = reviewerResults.map((r) => r.findings);

  const totalFindings = allFindings.reduce((s, d) => s + d.findings.length, 0);
  log(`Sub-reviewers complete. Total findings: ${totalFindings}`, onProgress);

  // Coordinator judge pass (uses a higher-tier model if model wasn't explicitly set)
  log("Running coordinator judge pass...", onProgress);
  const result = await runCoordinator(
    allFindings,
    sharedContextPath,
    config.diffPath,
    finalOutputPath,
    customInstructions,
    provider,
    model, // if explicit model given, use it; otherwise coordinator uses its own default
  );

  // Also write a human-readable summary
  const summaryPath = resolve(reportsDir, "all-findings.md");
  const summary = allFindings
    .map(
      (d) => `## ${d.domain}\n${d.findings.length > 0
        ? d.findings.map((f) => `- **[${f.severity}]** ${f.file}:${f.line} — ${f.title}\n  ${f.description}`).join("\n\n")
        : "_No findings._"
      }`,
    )
    .join("\n\n");
  writeFileSync(summaryPath, summary);

  log(`Verdict: ${result.verdict}`, onProgress);
  log(`Final review: ${finalOutputPath}`, onProgress);

  // Cleanup intermediary files
  if (!keepTemp && existsSync(swarmDir)) {
    rmSync(swarmDir, { recursive: true, force: true });
    log("Cleaned up .swarm-review/ intermediary files", onProgress);
  }

  return { config, resultPath: finalOutputPath };
}
