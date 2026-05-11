import { SECURITY_PROMPT } from "./prompts/security.js";
import { PERFORMANCE_PROMPT } from "./prompts/performance.js";
import { QUALITY_PROMPT } from "./prompts/quality.js";
import { createReviewerSession, runSession } from "./session.js";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type {
  DiffResult,
  ReviewCategory,
  ReviewerResult,
  ResolvedConfig,
} from "./types.js";

export function buildReviewerPrompt(
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

export function getSystemPrompt(category: ReviewCategory): string {
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

export interface ReviewerResultWithEvents extends ReviewerResult {
  events?: AgentEvent[];
}

export async function runReviewers(
  categories: ReviewCategory[],
  diffResult: DiffResult,
  config: ResolvedConfig,
  signal?: AbortSignal,
  onEvent?: import("./types.js").ReviewEventCallback,
): Promise<ReviewerResultWithEvents[]> {
  const getApiKey = (provider: string) => process.env[`${provider.toUpperCase()}_API_KEY`] || undefined;

  const results = await mapWithConcurrency(
    categories,
    config.maxConcurrency,
    async (category): Promise<ReviewerResult> => {
      const startTime = Date.now();
      const systemPrompt = getSystemPrompt(category);
      const prompt = buildReviewerPrompt(category, diffResult, config);

      try {
        const { agent, getFindings, model } = await createReviewerSession({
          systemPrompt,
          category,
          model: config.model,
          provider: config.provider,
          getApiKey,
          thinkingLevel: config.thinkingLevel,
        });

        const { usage, events } = await runSession(agent, prompt, config.reviewerTimeout, signal, onEvent, category);

        const findings = getFindings();

        return {
          reviewer: category,
          findings,
          model: `${model.provider}/${model.id}`,
          usage,
          durationMs: Date.now() - startTime,
          events,
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
