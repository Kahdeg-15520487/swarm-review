/**
 * Spawns specialized reviewer sessions concurrently and collects findings.
 */
import { SECURITY_PROMPT } from "./prompts/security.js";
import { PERFORMANCE_PROMPT } from "./prompts/performance.js";
import { QUALITY_PROMPT } from "./prompts/quality.js";
import { createReviewerSession, runSession } from "./session.js";
function buildReviewerPrompt(category, diffResult, config) {
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
function getSystemPrompt(category) {
    switch (category) {
        case "security":
            return SECURITY_PROMPT;
        case "performance":
            return PERFORMANCE_PROMPT;
        case "quality":
            return QUALITY_PROMPT;
    }
}
async function mapWithConcurrency(items, concurrency, fn) {
    if (items.length === 0)
        return [];
    const limit = Math.max(1, Math.min(concurrency, items.length));
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: limit }, async () => {
        while (true) {
            const current = nextIndex++;
            if (current >= items.length)
                return;
            results[current] = await fn(items[current], current);
        }
    });
    await Promise.all(workers);
    return results;
}
export async function runReviewers(categories, diffResult, config, signal) {
    const results = await mapWithConcurrency(categories, config.maxConcurrency, async (category) => {
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
            const { usage } = await runSession(session, prompt, config.reviewerTimeout, signal);
            const findings = getFindings();
            session.dispose();
            return {
                reviewer: category,
                findings,
                model: `${model.provider}/${model.id}`,
                usage,
                durationMs: Date.now() - startTime,
            };
        }
        catch (err) {
            return {
                reviewer: category,
                findings: [],
                model: config.model || "unknown",
                usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
                durationMs: Date.now() - startTime,
                error: err.message || String(err),
            };
        }
    });
    return results;
}
//# sourceMappingURL=runner.js.map