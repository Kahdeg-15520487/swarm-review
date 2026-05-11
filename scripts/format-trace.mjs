#!/usr/bin/env node

/**
 * format-trace — Format a session trace JSONL into readable per-agent Markdown
 *
 * Reads the JSONL file produced by --session-log and outputs formatted Markdown
 * with sections for each agent (security, performance, quality, coordinator)
 * showing their thinking, findings, tool calls, and usage.
 *
 * Usage:
 *   node scripts/format-trace.mjs review-trace.jsonl
 *   node scripts/format-trace.mjs review-trace.jsonl --min-level warning
 *   node scripts/format-trace.mjs review-trace.jsonl --max-thinking 500
 */

import { readFileSync } from "node:fs";

// ── CLI ──

const args = process.argv.slice(2);
let traceFile = null;
let maxThinkingChars = 2000;
let minLevel = null; // "turn_output" | "tool_call" | "tool_result" — null shows all

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const next = () => {
    const val = args[++i];
    if (!val) {
      console.error(`Missing value for ${arg}`);
      process.exit(1);
    }
    return val;
  };

  if (arg === "--help" || arg === "-h") {
    console.log(`
format-trace — Format session trace JSONL into per-agent Markdown

USAGE:
  node scripts/format-trace.mjs <trace-file> [options]

OPTIONS:
  --max-thinking <n>    Truncate thinking content to N chars (default: 2000)
  --min-level <type>    Minimum event type to show: turn_output, tool_call, tool_result
  -h, --help            Show this help message
`);
    process.exit(0);
  } else if (arg === "--max-thinking") {
    maxThinkingChars = parseInt(next(), 10);
  } else if (arg === "--min-level") {
    minLevel = next();
  } else if (!traceFile) {
    traceFile = arg;
  }
}

if (!traceFile) {
  console.error("Usage: node scripts/format-trace.mjs <trace-file>");
  process.exit(1);
}

// ── Read & parse ──

const raw = readFileSync(traceFile, "utf-8").trim();
if (!raw) {
  console.log("_(empty trace — no session data)_");
  process.exit(0);
}

const lines = raw.split("\n").map((l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
}).filter(Boolean);

// ── Group by source ──

const sources = new Map(); // source -> entry[]

for (const entry of lines) {
  const source = entry.source || "unknown";
  if (!sources.has(source)) sources.set(source, []);
  sources.get(source).push(entry);
}

const sourceLabels = {
  security: "Security Reviewer",
  performance: "Performance Reviewer",
  quality: "Quality Reviewer",
  coordinator: "Coordinator",
};

// ── Helpers ──

function truncate(str, max) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + `\n\n_(${str.length - max} more characters truncated)_`;
}

function escapeMd(str) {
  if (!str) return "";
  return str.replace(/([\\`*_{}[\]()#+\-.!|])/g, "\\$1");
}

function codeBlock(lang, content) {
  if (!content) return "";
  return `\`\`\`${lang}\n${content}\n\`\`\``;
}

function formatThinking(text) {
  if (!text) return "";
  const truncated = truncate(text, maxThinkingChars);
  return `<details>\n<summary>💭 Thinking</summary>\n\n${codeBlock("", truncated)}\n\n</details>`;
}

function formatText(text) {
  if (!text) return "";
  return codeBlock("", text);
}

function formatToolCall(entry) {
  let out = `**Tool:** \`${entry.tool}\``;
  if (entry.args) {
    const argsStr = typeof entry.args === "string" ? entry.args : JSON.stringify(entry.args, null, 2);
    out += `\n\nArgs:\n${codeBlock("json", truncate(argsStr, 1000))}`;
  }
  return out;
}

function formatToolResult(entry) {
  let out = `**Tool:** \`${entry.tool}\``;
  if (entry.isError) out += " ❌";
  out += "\n\n";
  const resultStr = typeof entry.result === "string" ? entry.result : JSON.stringify(entry.result, null, 2);
  out += codeBlock("json", truncate(resultStr, 2000));
  return out;
}

function formatUsage(entry) {
  return [
    `- **Input tokens:** ${entry.input ?? "?"}`,
    `- **Output tokens:** ${entry.output ?? "?"}`,
    `- **Cache read:** ${entry.cacheRead ?? "?"}`,
    `- **Cache write:** ${entry.cacheWrite ?? "?"}`,
  ].join("\n");
}

// ── Should show? ──

function shouldShow(entry) {
  if (!minLevel) return true;
  const order = ["turn_output", "tool_call", "tool_result"];
  const idx = order.indexOf(entry.type);
  const minIdx = order.indexOf(minLevel);
  if (idx === -1 || minIdx === -1) return true;
  return idx >= minIdx;
}

// ── Build markdown ──

const sections = [];

for (const [source, entries] of sources) {
  const label = sourceLabels[source] || source;
  const lines_out = [];

  lines_out.push(`## ${label}`);
  lines_out.push("");

  let findingsCount = 0;
  let turnCount = 0;
  let usageEntries = [];

  for (const entry of entries) {
    if (!shouldShow(entry)) continue;

    switch (entry.type) {
      case "agent_start":
        break;

      case "agent_end":
        break;

      case "turn_start":
        turnCount++;
        break;

      case "turn_output":
        if (entry.text) {
          lines_out.push(`### Turn ${turnCount} — Output`);
          lines_out.push("");
          lines_out.push(formatText(entry.text));
          lines_out.push("");
        }
        if (entry.thinking) {
          lines_out.push(formatThinking(entry.thinking));
          lines_out.push("");
        }
        break;

      case "tool_call":
        if (entry.tool === "report_finding") findingsCount++;
        lines_out.push(`### Tool Call: \`${entry.tool}\``);
        lines_out.push("");
        lines_out.push(formatToolCall(entry));
        lines_out.push("");
        break;

      case "tool_result":
        lines_out.push(`### Tool Result: \`${entry.tool}\``);
        lines_out.push("");
        lines_out.push(formatToolResult(entry));
        lines_out.push("");
        break;

      case "tool_results":
        lines_out.push(`*${entry.count} tool result(s)*`);
        lines_out.push("");
        break;

      case "usage":
        usageEntries.push(entry);
        break;

      default:
        if (!["turn_end"].includes(entry.type)) {
          lines_out.push(`*Event: \`${entry.type}\`*`);
          lines_out.push("");
        }
        break;
    }
  }

  // Usage summary at the end of each agent section
  if (usageEntries.length > 0) {
    const total = usageEntries.reduce(
      (acc, u) => ({
        input: acc.input + (u.input ?? 0),
        output: acc.output + (u.output ?? 0),
        cacheRead: acc.cacheRead + (u.cacheRead ?? 0),
        cacheWrite: acc.cacheWrite + (u.cacheWrite ?? 0),
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    );
    lines_out.push(`### Token Usage`);
    lines_out.push("");
    lines_out.push(formatUsage(total));
    lines_out.push("");
  }

  // Summary badge
  const summaryParts = [];
  summaryParts.push(`${turnCount} turn(s)`);
  if (findingsCount > 0) summaryParts.push(`${findingsCount} finding(s)`);
  summaryParts.push(`${usageEntries.length} usage record(s)`);
  lines_out.push(`<sub>${summaryParts.join(" · ")}</sub>`);
  lines_out.push("");

  sections.push(lines_out.join("\n"));
}

// ── Output ──

if (sections.length === 0) {
  console.log("_(no formatted events to display)_");
} else {
  console.log("# Session Trace");
  console.log("");
  console.log(`_Trace file: \`${traceFile}\`_`);
  console.log("");
  console.log(sections.join("\n---\n\n"));
}
