/**
 * swarm-review — Swarm Review
 *
 * Library API. Import and call review() from any script.
 *
 * Usage:
 *   import { review } from "swarm-review";
 *   const result = await review({ cwd: "./my-project", diff: "main...HEAD" });
 *   console.log(result.verdict);
 */

import { resolveConfig } from "./config.js";
import { getDiff } from "./diff/git.js";
import { filterDiff } from "./diff/filter.js";
import { assessRiskTier } from "./diff/risk.js";
import { runReviewers } from "./runner.js";
import { runCoordinator } from "./coordinator.js";
import { formatOutput } from "./output.js";
import type { ReviewConfig, ReviewResult, ResolvedConfig, ReviewCategory } from "./types.js";

export type { ReviewConfig, ReviewResult, ResolvedConfig };
export type {
  Finding, ReviewerResult, Verdict, Severity,
  RiskTier, OutputFormat, DiffFile, DiffResult,
} from "./types.js";
export { formatOutput } from "./output.js";
export { resolveConfig } from "./config.js";

/**
 * Run an orchestrated swarm review.
 *
 * @param config - Review configuration
 * @returns Structured review result
 *
 * @example
 * ```ts
 * import { review } from "swarm-review";
 *
 * const result = await review({
 *   cwd: "/path/to/repo",
 *   diff: "main...HEAD",
 *   format: "json",
 * });
 *
 * console.log(result.verdict);      // "approved" | "approved_with_comments" | ...
 * console.log(result.findings);     // Array of Finding objects
 * console.log(result.summary);      // Human-readable summary
 * ```
 */
export async function review(config: ReviewConfig = {}): Promise<ReviewResult> {
  const resolved = resolveConfig(config);
  const abortController = new AbortController();

  const rawDiff = await getDiff(resolved.cwd, resolved.diff);
  const filteredDiff = filterDiff(rawDiff);

  if (filteredDiff.files.length === 0) {
    return {
      verdict: "approved",
      findings: [],
      summary: "No reviewable changes found after filtering (empty diff or all files filtered as noise).",
      riskTier: "trivial",
      reviewers: [],
      totalUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
      durationMs: 0,
      config: resolved,
    };
  }

  const userOverride = config.riskTier !== undefined;
  const riskTier = userOverride ? resolved.riskTier : assessRiskTier(filteredDiff.files);

  let reviewers: ReviewCategory[] = resolved.reviewers;
  if (!config.reviewers) {
    if (riskTier === "trivial") reviewers = ["quality"];
    else if (riskTier === "lite") reviewers = ["quality", "security"];
    else reviewers = ["security", "performance", "quality"];
  }

  const finalConfig: ResolvedConfig = {
    ...resolved,
    riskTier,
    reviewers,
  };

  const reviewerResults = await runReviewers(
    reviewers,
    filteredDiff,
    finalConfig,
    abortController.signal,
  );

  const result = await runCoordinator(
    reviewerResults,
    filteredDiff,
    riskTier,
    finalConfig,
    abortController.signal,
  );

  return result;
}
