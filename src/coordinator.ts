/**
 * Coordinator — runs after all reviewers, deduplicates findings,
 * judges severity, and produces the final review verdict.
 */

import { COORDINATOR_PROMPT } from "./prompts/coordinator.js";
import { createReviewerSession, runSession } from "./session.js";
import type { CoordinatorReview } from "./session.js";
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

  try {
    const { session, getReview, model } = await createReviewerSession({
      systemPrompt,
      category: "coordinator",
      cwd: config.cwd,
      model: config.model || undefined,
      provider: config.provider || undefined,
      thinkingLevel: config.thinkingLevel,
    });

    const coordinatorTimeout = config.reviewerTimeout * 2;
    const { output: coordinatorOutput, usage: coordinatorUsage } = await runSession(
      session,
      prompt,
      coordinatorTimeout,
      signal,
    );

    let review = getReview();

    // Fallback: parse text output when model doesn't use submit_review tool
    if (!review) {
      review = parseCoordinatorOutput(coordinatorOutput);
    }

    session.dispose();

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
    };
  } catch (err: any) {
    // If coordinator fails, fall back to raw aggregated results
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

function parseCoordinatorOutput(text: string): CoordinatorReview | null {
  const verdictMatch = text.match(/<verdict>\s*(approved|approved_with_comments|minor_issues|significant_concerns)\s*<\/verdict>/i);
  const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i);

  if (!verdictMatch) return null;

  const findings = parseCoordinatorFindings(text);

  return {
    verdict: verdictMatch[1].trim() as CoordinatorReview["verdict"],
    summary: summaryMatch?.[1]?.trim() ?? "Review completed.",
    findings,
  };
}

function parseCoordinatorFindings(text: string): import("./types.js").Finding[] {
  const findings: import("./types.js").Finding[] = [];
  const findingRegex = /<finding\s+severity="(critical|warning|suggestion)"\s+category="(security|performance|quality)">([\s\S]*?)<\/finding>/gi;
  let match;

  while ((match = findingRegex.exec(text)) !== null) {
    const body = match[3];
    const titleMatch = body.match(/<title>([\s\S]*?)<\/title>/i);
    const fileMatch = body.match(/<file>([\s\S]*?)<\/file>/i);
    const descMatch = body.match(/<description>([\s\S]*?)<\/description>/i);
    const recMatch = body.match(/<recommendation>([\s\S]*?)<\/recommendation>/i);
    const snippetMatch = body.match(/<codeSnippet>([\s\S]*?)<\/codeSnippet>/i);

    if (titleMatch) {
      const filePart = (fileMatch?.[1] ?? "unknown").trim();
      const colonIdx = filePart.lastIndexOf(":");
      const file = colonIdx > 0 ? filePart.slice(0, colonIdx) : filePart;
      const line = colonIdx > 0 ? parseInt(filePart.slice(colonIdx + 1), 10) : undefined;

      findings.push({
        severity: match[1] as import("./types.js").Severity,
        category: match[2] as import("./types.js").ReviewCategory,
        title: titleMatch[1].trim(),
        description: descMatch?.[1]?.trim() ?? "",
        file,
        line: line && !isNaN(line) ? line : undefined,
        codeSnippet: snippetMatch?.[1]?.trim(),
        recommendation: recMatch?.[1]?.trim() ?? "",
      });
    }
  }

  return findings;
}
