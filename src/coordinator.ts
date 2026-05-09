import { COORDINATOR_PROMPT } from "./prompts/coordinator.js";
import { createReviewerSession, runSession } from "./session.js";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { ReviewerResult, ReviewResult, ResolvedConfig, DiffResult, RiskTier, Verdict } from "./types.js";

function buildCoordinatorPrompt(
  reviewerResults: ReviewerResult[],
  diffResult: DiffResult,
  config: ResolvedConfig,
): string {
  const findingsXml = reviewerResults
    .map((r) => {
      if (r.error) {
        return `<reviewer name="${r.reviewer}" status="error">\n  <error>${r.error}</error>\n</reviewer>`;
      }
      const findings = r.findings
        .map(
          (f) =>
            `  <finding severity="${f.severity}" category="${f.category}">\n` +
            `    <title>${f.title}</title>\n` +
            `    <file>${f.file}${f.line ? `:${f.line}` : ""}</file>\n` +
            `    <description>${f.description}</description>\n` +
            `    <recommendation>${f.recommendation}</recommendation>\n` +
            `  </finding>`,
        )
        .join("\n");

      return `<reviewer name="${r.reviewer}" status="completed" findings="${r.findings.length}">\n${findings || "  <no-findings/>\n"}\n</reviewer>`;
    })
    .join("\n\n");

  const filesSummary = diffResult.files
    .map((f) => `- ${f.path} (+${f.addedLines}/-${f.removedLines})`)
    .join("\n");

  let prompt = `## Coordinate This Review

### Changed Files
${filesSummary}

### Reviewer Findings

${findingsXml}

### Your Task

1. Read through ALL findings from ALL reviewers above.
2. Deduplicate: if the same issue is flagged by multiple reviewers, keep it ONCE in the best category.
3. Filter: drop false positives, nitpicks, and vague suggestions. If unsure about a finding, read the source code to verify.
4. Re-categorize: move misfiled findings to the correct category.
5. Judge overall severity and produce a verdict using the submit_review tool.`;

  if (config.customInstructions) {
    prompt += `\n\n### Custom Instructions\n\n${config.customInstructions}`;
  }

  return prompt;
}

export interface CoordinatorResult extends ReviewResult {
  coordinatorEvents?: AgentEvent[];
}

export async function runCoordinator(
  reviewerResults: ReviewerResult[],
  diffResult: DiffResult,
  riskTier: RiskTier,
  config: ResolvedConfig,
  signal?: AbortSignal,
): Promise<ReviewResult> {
  const startTime = Date.now();

  const totalUsage = reviewerResults.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + r.usage.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + r.usage.cacheWriteTokens,
      cost: acc.cost + r.usage.cost,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
  );

  const systemPrompt = COORDINATOR_PROMPT;
  const prompt = buildCoordinatorPrompt(reviewerResults, diffResult, config);
  const getApiKey = (provider: string) => process.env[`${provider.toUpperCase()}_API_KEY`] || undefined;

  try {
    const { agent, getReview, model } = await createReviewerSession({
      systemPrompt,
      category: "coordinator",
      model: config.model,
      provider: config.provider,
      getApiKey,
      thinkingLevel: config.thinkingLevel,
    });

    const coordinatorTimeout = config.reviewerTimeout * 2;
    const { usage: coordinatorUsage, events: coordinatorEvents } = await runSession(
      agent,
      prompt,
      coordinatorTimeout,
      signal,
    );

    const review = getReview();

    totalUsage.inputTokens += coordinatorUsage.inputTokens;
    totalUsage.outputTokens += coordinatorUsage.outputTokens;
    totalUsage.cacheReadTokens += coordinatorUsage.cacheReadTokens;
    totalUsage.cacheWriteTokens += coordinatorUsage.cacheWriteTokens;
    totalUsage.cost += coordinatorUsage.cost;

    const verdict: Verdict = review?.verdict ?? deriveVerdict(reviewerResults);

    return {
      verdict,
      findings: review?.findings ?? aggregateFindings(reviewerResults),
      summary: review?.summary ?? "Review completed with some automation issues.",
      riskTier,
      reviewers: reviewerResults,
      totalUsage,
      durationMs: Date.now() - startTime,
      config,
      coordinatorEvents,
    };
  } catch (err: any) {
    return {
      verdict: deriveVerdict(reviewerResults),
      findings: aggregateFindings(reviewerResults),
      summary: `Coordinator failed (${err.message}). Results are raw, un-deduplicated findings.`,
      riskTier,
      reviewers: reviewerResults,
      totalUsage,
      durationMs: Date.now() - startTime,
      config,
    };
  }
}

function deriveVerdict(reviewers: ReviewerResult[]): Verdict {
  const allFindings = reviewers.flatMap((r) => r.findings);
  const hasCritical = allFindings.some((f) => f.severity === "critical");
  const warningCount = allFindings.filter((f) => f.severity === "warning").length;

  if (hasCritical) return "significant_concerns";
  if (warningCount >= 3) return "minor_issues";
  if (warningCount > 0) return "approved_with_comments";
  return "approved";
}

function aggregateFindings(reviewers: ReviewerResult[]) {
  return reviewers.flatMap((r) => r.findings);
}
