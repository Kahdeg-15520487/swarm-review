/**
 * Output formatting — text, JSON, and markdown renderers.
 */

import type { ReviewResult, Finding, Verdict, Severity } from "./types.js";

// ── Color helpers ──

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

function color(text: string, ...codes: string[]): string {
  return `${codes.join("")}${text}${COLORS.reset}`;
}

function severityIcon(severity: Severity): string {
  switch (severity) {
    case "critical": return "🔴";
    case "warning": return "🟡";
    case "suggestion": return "🔵";
  }
}

function severityColor(severity: Severity, text: string, useColor: boolean): string {
  if (!useColor) return `[${severity.toUpperCase()}] ${text}`;
  const c = severity === "critical" ? COLORS.red : severity === "warning" ? COLORS.yellow : COLORS.blue;
  return color(`[${severity.toUpperCase()}]`, COLORS.bold, c) + " " + text;
}

function verdictIcon(verdict: Verdict): string {
  switch (verdict) {
    case "approved": return "✅";
    case "approved_with_comments": return "✅ (with comments)";
    case "minor_issues": return "⚠️";
    case "significant_concerns": return "🚫";
  }
}

function verdictColor(verdict: Verdict, useColor: boolean): string {
  const icon = verdictIcon(verdict);
  if (!useColor) return icon;
  const c = verdict === "approved" || verdict === "approved_with_comments"
    ? COLORS.green
    : verdict === "minor_issues"
      ? COLORS.yellow
      : COLORS.red;
  return color(icon, COLORS.bold, c);
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// ── Text Output ──

export function formatText(result: ReviewResult, useColor: boolean): string {
  const lines: string[] = [];

  lines.push(useColor ? color("─".repeat(60), COLORS.dim) : "─".repeat(60));
  lines.push(useColor
    ? color("  Swarm Review", COLORS.bold, COLORS.cyan) + " " + verdictColor(result.verdict, useColor)
    : `  Swarm Review ${verdictIcon(result.verdict)}`);
  lines.push(useColor ? color("─".repeat(60), COLORS.dim) : "─".repeat(60));

  lines.push("");
  lines.push(useColor ? color("  Summary:", COLORS.bold) : "  Summary:");
  lines.push(`  ${result.summary}`);
  lines.push("");

  lines.push(useColor
    ? `  Risk Tier: ${color(result.riskTier, COLORS.bold)}`
    : `  Risk Tier: ${result.riskTier}`);
  lines.push("");

  if (result.findings.length > 0) {
    lines.push(useColor ? color("  Findings:", COLORS.bold) : "  Findings:");
    lines.push("");

    for (const finding of result.findings) {
      const icon = severityIcon(finding.severity);
      const title = severityColor(finding.severity, finding.title, useColor);
      lines.push(`  ${icon} ${title}`);
      lines.push(`     ${useColor ? color(finding.category, COLORS.magenta) : finding.category} ─ ${finding.file}${finding.line ? `:${finding.line}` : ""}`);
      lines.push(`     ${finding.description}`);
      if (finding.codeSnippet) {
        const snippet = finding.codeSnippet.split("\n").map((l) => `     │ ${l}`).join("\n");
        lines.push(snippet);
      }
      lines.push(useColor ? color(`     → ${finding.recommendation}`, COLORS.green) : `     → ${finding.recommendation}`);
      lines.push("");
    }
  } else {
    lines.push(useColor ? color("  No issues found. ✨", COLORS.green) : "  No issues found.");
    lines.push("");
  }

  lines.push(useColor ? color("  Reviewers:", COLORS.bold) : "  Reviewers:");
  for (const r of result.reviewers) {
    const status = r.error
      ? (useColor ? color(`ERROR: ${r.error}`, COLORS.red) : `ERROR: ${r.error}`)
      : `${r.findings.length} findings`;
    lines.push(
      `    ${useColor ? color(r.reviewer, COLORS.cyan) : r.reviewer}: ${status} (${formatMs(r.durationMs)}, ${r.model})`,
    );
  }
  lines.push("");

  lines.push(useColor ? color("  Totals:", COLORS.bold) : "  Totals:");
  lines.push(
    `    Duration: ${formatMs(result.durationMs)} | ` +
    `Tokens: ↑${formatTokens(result.totalUsage.inputTokens)} ↓${formatTokens(result.totalUsage.outputTokens)} | ` +
    `Cost: ${formatCost(result.totalUsage.cost)}`,
  );
  lines.push(useColor ? color("─".repeat(60), COLORS.dim) : "─".repeat(60));

  return lines.join("\n");
}

export function formatJson(result: ReviewResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatMarkdown(result: ReviewResult): string {
  const lines: string[] = [];

  lines.push(`# Swarm Review ${verdictIcon(result.verdict)}`);
  lines.push("");
  lines.push(`**Verdict:** ${result.verdict.replace(/_/g, " ")} | **Risk Tier:** ${result.riskTier}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(result.summary);
  lines.push("");

  if (result.findings.length > 0) {
    lines.push("## Findings");
    lines.push("");
    for (const f of result.findings) {
      const sevBadge = f.severity === "critical"
        ? "🔴 **CRITICAL**"
        : f.severity === "warning"
          ? "🟡 **WARNING**"
          : "🔵 **SUGGESTION**";
      lines.push(`### ${sevBadge}: ${f.title}`);
      lines.push("");
      lines.push(`- **Category:** ${f.category}`);
      lines.push(`- **File:** \`${f.file}${f.line ? `:${f.line}` : ""}\``);
      lines.push("");
      lines.push(f.description);
      lines.push("");
      if (f.codeSnippet) {
        lines.push("```");
        lines.push(f.codeSnippet);
        lines.push("```");
        lines.push("");
      }
      lines.push(`**Recommendation:** ${f.recommendation}`);
      lines.push("");
    }
  } else {
    lines.push("## Findings");
    lines.push("");
    lines.push("No issues found. ✨");
    lines.push("");
  }

  lines.push("## Reviewer Stats");
  lines.push("");
  lines.push("| Reviewer | Findings | Duration | Model |");
  lines.push("|----------|---------|----------|--------|");
  for (const r of result.reviewers) {
    lines.push(`| ${r.reviewer} | ${r.error ? `❌ ${r.error}` : r.findings.length} | ${formatMs(r.durationMs)} | ${r.model} |`);
  }
  lines.push("");
  lines.push(`**Total:** ${formatMs(result.durationMs)} | Cost: ${formatCost(result.totalUsage.cost)}`);
  lines.push("");

  return lines.join("\n");
}

export function formatOutput(result: ReviewResult, format: "text" | "json" | "markdown", useColor: boolean): string {
  switch (format) {
    case "text":
      return formatText(result, useColor);
    case "json":
      return formatJson(result);
    case "markdown":
      return formatMarkdown(result);
  }
}
