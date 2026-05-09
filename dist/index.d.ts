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
import type { ReviewConfig, ReviewResult, ResolvedConfig } from "./types.js";
export type { ReviewConfig, ReviewResult, ResolvedConfig };
export type { Finding, ReviewerResult, Verdict, Severity, RiskTier, OutputFormat, DiffFile, DiffResult, } from "./types.js";
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
export declare function review(config?: ReviewConfig): Promise<ReviewResult>;
//# sourceMappingURL=index.d.ts.map