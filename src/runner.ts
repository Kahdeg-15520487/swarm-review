/**
 * Spawns specialized reviewer sessions concurrently and collects findings.
 */

import { SECURITY_PROMPT } from "./prompts/security.js";
import { PERFORMANCE_PROMPT } from "./prompts/performance.js";
import { QUALITY_PROMPT } from "./prompts/quality.js";
import { createReviewerSession, runSession } from "./session.js";
import type {
  DiffResult,
  Finding,
  ReviewCategory,
  ReviewerResult,
  ResolvedConfig,
  Severity,
} from "./types.js";

function buildReviewerPrompt(
  category: ReviewCategory,
  diffResult: DiffResult,
  config: ResolvedConfig,
): string {
  const diffContent = diffResult.files
    .map((f) => `--- ${f.path} (+${f.addedLines}/-${f.removedLines}) ---\n${f.content}`)
    .join("\n\n");

  let prompt = `## Code Review Request

Review the following diff for **${category}** issues.

### Changed Files (${diffResult.files.length} files, +${diffResult.totalAddedLines}/-${diffResult.totalRemovedLines} lines)

${diffResult.files.map((f) => `- ${f.path} (+${f.addedLines}/-${f.removedLines})`).join("\n")}

### Diff Content

${diffContent}`;

  if (config.customInstructions) {
    prompt += `\n\n### Custom Instructions\n\n${config.customInstructions}`;
  }

  return prompt;
}

function getSystemPrompt(category: ReviewCategory): string {
  switch (category) {
    case "security":
      return SECURITY_PROMPT;
    case "performance":
      return PERFORMANCE_PROMPT;
    case "quality":
      return QUALITY_PROMPT;
  }
}

async function mapWithConcurrency<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function runReviewers(
  categories: ReviewCategory[],
  diffResult: DiffResult,
  config: ResolvedConfig,
  signal?: AbortSignal,
): Promise<ReviewerResult[]> {
  const results = await mapWithConcurrency(
    categories,
    config.maxConcurrency,
    async (category): Promise<ReviewerResult> => {
      const startTime = Date.now();
      const systemPrompt = getSystemPrompt(category);
      const prompt = buildReviewerPrompt(category, diffResult, config);

      try {
        const { session, getFindings, model } = await createReviewerSession({
          systemPrompt,
          category,
          cwd: config.cwd,
          model: config.model || undefined,
          provider: config.provider || undefined,
          thinkingLevel: config.thinkingLevel,
        });

        const { output, usage } = await runSession(session, prompt, config.reviewerTimeout, signal);

        let findings = getFindings();

        // Fallback: parse text output for XML findings when model doesn't use the tool
        if (findings.length === 0) {
          findings = parseTextFindings(output, category);
        }

        session.dispose();

        return {
          reviewer: category,
          findings,
          model: `${model.provider}/${model.id}`,
          usage,
          durationMs: Date.now() - startTime,
        };
      } catch (err: any) {
        return {
          reviewer: category,
          findings: [],
          model: config.model || "unknown",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
          durationMs: Date.now() - startTime,
          error: err.message || String(err),
        };
      }
    },
  );

  return results;
}

function parseTextFindings(text: string, category: ReviewCategory): Finding[] {
  const findings: Finding[] = [];
  const findingRegex = /<finding\s+severity="(critical|warning|suggestion)"\s+category="(?:security|performance|quality)">([\s\S]*?)<\/finding>/gi;
  let match;

  while ((match = findingRegex.exec(text)) !== null) {
    const severity = match[1] as Severity;
    const body = match[2];

    const titleMatch = body.match(/<title>([\s\S]*?)<\/title>/i);
    const fileMatch = body.match(/<file>([\s\S]*?)<\/file>/i);
    const descMatch = body.match(/<description>([\s\S]*?)<\/description>/i);
    const recMatch = body.match(/<recommendation>([\s\S]*?)<\/recommendation>/i);
    const snippetMatch = body.match(/<codeSnippet>([\s\S]*?)<\/codeSnippet>/i);

    if (titleMatch && descMatch && fileMatch) {
      const filePart = fileMatch[1].trim();
      const colonIdx = filePart.lastIndexOf(":");
      const file = colonIdx > 0 ? filePart.slice(0, colonIdx) : filePart;
      const line = colonIdx > 0 ? parseInt(filePart.slice(colonIdx + 1), 10) : undefined;

      findings.push({
        severity,
        category,
        title: titleMatch[1].trim(),
        description: descMatch[1].trim(),
        file,
        line: line && !isNaN(line) ? line : undefined,
        codeSnippet: snippetMatch?.[1]?.trim(),
        recommendation: recMatch?.[1]?.trim() ?? "",
      });
    }
  }

  return findings;
}
