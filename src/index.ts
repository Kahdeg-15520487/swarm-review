/**
 * swarm-review — Swarm Review
 *
 * Library API. Import and call review() from any script.
 */

export { runSwarmReview } from "./orchestrator.js";
export { autoDetectConfig, detectGitInfo, parseDiffEntries, assessRiskTier, selectReviewers, filterDiff, isNoiseFile } from "./diff.js";
export { runReviewer } from "./reviewer.js";
export { runCoordinator } from "./coordinator.js";
export type {
  Severity,
  Finding,
  DomainFindings,
  RiskTier,
  Reviewer,
  Verdict,
  ReviewResult,
  ReviewConfig,
  ResolvedConfig,
  DiffEntry,
} from "./types.js";
export type { SwarmReviewOptions } from "./orchestrator.js";

import { runSwarmReview } from "./orchestrator.js";
import type { ReviewConfig } from "./types.js";

/**
 * Run a full swarm review.
 *
 * @example
 * import { review } from "swarm-review";
 * const result = await review({ cwd: "/my/repo" });
 *
 * @param config - Review configuration
 * @returns verdict and path to review-result.md
 */
export async function review(config: ReviewConfig = {}): Promise<{ verdict: string; resultPath: string }> {
  const { config: cfg, resultPath } = await runSwarmReview({
    cwd: config.cwd ?? process.cwd(),
    customInstructions: config.customInstructions,
    keepTemp: config.keepTemp,
    outputPath: config.outputFile,
  });

  const { readFileSync } = await import("node:fs");
  const content = readFileSync(resultPath, "utf-8");
  const verdictMatch = content.match(/<verdict>(.*?)<\/verdict>/);
  const verdict = verdictMatch?.[1]?.trim() ?? "completed";

  return { verdict, resultPath };
}
