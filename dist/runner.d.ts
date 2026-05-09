/**
 * Spawns specialized reviewer sessions concurrently and collects findings.
 */
import type { DiffResult, ReviewCategory, ReviewerResult, ResolvedConfig } from "./types.js";
export declare function runReviewers(categories: ReviewCategory[], diffResult: DiffResult, config: ResolvedConfig, signal?: AbortSignal): Promise<ReviewerResult[]>;
//# sourceMappingURL=runner.d.ts.map