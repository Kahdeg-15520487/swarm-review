/**
 * ai-code-review — Orchestrated AI Code Review
 *
 * Library API. Import and call review() from any script.
 *
 * Usage:
 *   import { review } from "ai-code-review";
 *   const result = await review({ cwd: "./my-project", diff: "main...HEAD" });
 *   console.log(result.verdict);
 */
import { resolveConfig } from "./config.js";
import { getDiff } from "./diff/git.js";
import { filterDiff } from "./diff/filter.js";
import { assessRiskTier } from "./diff/risk.js";
import { runReviewers } from "./runner.js";
import { runCoordinator } from "./coordinator.js";
export { formatOutput } from "./output.js";
export { resolveConfig } from "./config.js";
/**
 * Run an orchestrated AI code review.
 *
 * @param config - Review configuration
 * @returns Structured review result
 *
 * @example
 * ```ts
 * import { review } from "ai-code-review";
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
export async function review(config = {}) {
    const resolved = resolveConfig(config);
    const abortController = new AbortController();
    // 1. Extract git diff
    const rawDiff = await getDiff(resolved.cwd, resolved.diff);
    // 2. Filter noise
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
    // 3. Assess risk tier (use user override if provided, otherwise auto-assess)
    const userOverride = config.riskTier !== undefined;
    const riskTier = userOverride ? resolved.riskTier : assessRiskTier(filteredDiff.files);
    // 4. Determine which reviewers to run
    let reviewers = resolved.reviewers;
    if (!config.reviewers) {
        // Auto-select based on risk tier
        if (riskTier === "trivial")
            reviewers = ["quality"];
        else if (riskTier === "lite")
            reviewers = ["quality", "security"];
        else
            reviewers = ["security", "performance", "quality"];
    }
    // Update config with actual resolved values
    const finalConfig = {
        ...resolved,
        riskTier,
        reviewers,
    };
    // 5. Run specialized reviewers
    const reviewerResults = await runReviewers(reviewers, filteredDiff, finalConfig, abortController.signal);
    // 6. Run coordinator
    const result = await runCoordinator(reviewerResults, filteredDiff, riskTier, finalConfig, abortController.signal);
    return result;
}
//# sourceMappingURL=index.js.map