/**
 * Configuration resolution and defaults.
 */
export function resolveConfig(input) {
    const cwd = input.cwd ?? process.cwd();
    const isTty = process.stdout.isTTY ?? false;
    return {
        cwd,
        diff: input.diff ?? "HEAD~1",
        model: input.model ?? "",
        provider: input.provider ?? "",
        reviewers: input.reviewers ?? ["security", "performance", "quality"],
        riskTier: input.riskTier ?? "full",
        format: input.format ?? (isTty ? "text" : "json"),
        outputFile: input.outputFile,
        reviewerTimeout: input.reviewerTimeout ?? 300_000, // 5 minutes
        maxConcurrency: input.maxConcurrency ?? 3,
        customInstructions: input.customInstructions ?? "",
        thinkingLevel: input.thinkingLevel ?? "medium",
        color: input.color ?? isTty,
    };
}
//# sourceMappingURL=config.js.map