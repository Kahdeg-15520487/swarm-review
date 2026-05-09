/**
 * Coordinator — runs after all reviewers, deduplicates findings,
 * judges severity, and produces the final review verdict.
 */
import type { ReviewerResult, ReviewResult, ResolvedConfig, DiffResult, RiskTier } from "./types.js";
export declare function runCoordinator(reviewerResults: ReviewerResult[], diffResult: DiffResult, riskTier: RiskTier, config: ResolvedConfig, signal?: AbortSignal): Promise<ReviewResult>;
//# sourceMappingURL=coordinator.d.ts.map