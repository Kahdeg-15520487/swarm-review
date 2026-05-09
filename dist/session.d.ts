/**
 * Agent session factory for isolated reviewer sessions.
 */
import type { Finding, ReviewCategory, TokenUsage } from "./types.js";
export interface CoordinatorReview {
    verdict: "approved" | "approved_with_comments" | "minor_issues" | "significant_concerns";
    findings: Finding[];
    summary: string;
}
export interface SessionOptions {
    systemPrompt: string;
    category: ReviewCategory | "coordinator";
    cwd: string;
    model?: string;
    provider?: string;
    thinkingLevel?: string;
}
/** Create an isolated agent session for a reviewer or coordinator. */
export declare function createReviewerSession(options: SessionOptions): Promise<{
    session: import("@earendil-works/pi-coding-agent").AgentSession;
    getFindings: () => Finding[];
    getReview: () => CoordinatorReview | null;
    model: import("@earendil-works/pi-ai").Model<import("@earendil-works/pi-ai").Api>;
}>;
/** Run a session with a prompt, collecting output and usage stats. */
export declare function runSession(session: Awaited<ReturnType<typeof createReviewerSession>>["session"], prompt: string, timeoutMs: number, signal?: AbortSignal): Promise<{
    output: string;
    usage: TokenUsage;
}>;
//# sourceMappingURL=session.d.ts.map