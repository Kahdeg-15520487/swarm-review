/**
 * swarm-review — Swarm Review
 *
 * Library API. Import and call review() from any script.
 */

import { resolveConfig } from "./config.js";
import { getDiff } from "./diff/git.js";
import { filterDiff } from "./diff/filter.js";
import { assessRiskTier } from "./diff/risk.js";
import { runReviewers, type ReviewerResultWithEvents } from "./runner.js";
import { runCoordinator, type CoordinatorResult } from "./coordinator.js";
import { formatOutput } from "./output.js";
import { writeFileSync } from "node:fs";
import type { ReviewConfig, ReviewResult, ResolvedConfig, ReviewCategory } from "./types.js";
import type { AgentEvent } from "@earendil-works/pi-agent-core";

export type { ReviewConfig, ReviewResult, ResolvedConfig, ReviewEventCallback } from "./types.js";
export type {
  Finding, ReviewerResult, Verdict, Severity,
  RiskTier, OutputFormat, DiffFile, DiffResult, ReviewCategory,
} from "./types.js";
export { formatOutput } from "./output.js";
export { resolveConfig } from "./config.js";

// Exported building blocks — use these for custom integration
export { getDiff } from "./diff/git.js";
export { filterDiff } from "./diff/filter.js";
export { assessRiskTier } from "./diff/risk.js";
export { createReviewerSession, runSession } from "./session.js";
export type { SessionOptions } from "./session.js";
export { runReviewers, buildReviewerPrompt, getSystemPrompt } from "./runner.js";
export type { ReviewerResultWithEvents } from "./runner.js";
export { runCoordinator, buildCoordinatorPrompt } from "./coordinator.js";
export type { CoordinatorResult } from "./coordinator.js";

export async function review(config: ReviewConfig = {}): Promise<ReviewResult> {
  const resolved = resolveConfig(config);
  const abortController = new AbortController();

  const rawDiff = await getDiff(resolved.cwd, resolved.diff);
  const filteredDiff = filterDiff(rawDiff);

  if (filteredDiff.files.length === 0) {
    return {
      verdict: "approved",
      findings: [],
      summary: "No reviewable changes found after filtering (empty diff or all files filtered as noise).",
      riskTier: "trivial",
      reviewers: [],
      totalUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
      durationMs: 0,
      config: resolved,
    };
  }

  const userOverride = config.riskTier !== undefined;
  const riskTier = userOverride ? resolved.riskTier : assessRiskTier(filteredDiff.files);

  let reviewers: ReviewCategory[] = resolved.reviewers;
  if (!config.reviewers) {
    if (riskTier === "trivial") reviewers = ["quality"];
    else if (riskTier === "lite") reviewers = ["quality", "security"];
    else reviewers = ["security", "performance", "quality"];
  }

  const finalConfig: ResolvedConfig = { ...resolved, riskTier, reviewers };

  const reviewerResults = await runReviewers(
    reviewers,
    filteredDiff,
    finalConfig,
    abortController.signal,
    resolved.onEvent,
  );

  const result = await runCoordinator(
    reviewerResults,
    filteredDiff,
    riskTier,
    finalConfig,
    abortController.signal,
    resolved.onEvent,
  );

  if (resolved.sessionLog) {
    writeSessionLog(resolved.sessionLog, reviewerResults, result);
  }

  return result;
}

function writeSessionLog(
  path: string,
  reviewerResults: ReviewerResultWithEvents[],
  coordinatorResult: CoordinatorResult,
) {
  const lines: string[] = [];

  for (const r of reviewerResults) {
    if (r.events) {
      for (const entry of consolidateEvents(r.events)) {
        try { lines.push(JSON.stringify({ source: r.reviewer, ...entry })); } catch {}
      }
    }
  }

  if (coordinatorResult.coordinatorEvents) {
    for (const entry of consolidateEvents(coordinatorResult.coordinatorEvents)) {
      try { lines.push(JSON.stringify({ source: "coordinator", ...entry })); } catch {}
    }
  }

  try {
    writeFileSync(path, lines.join("\n"), "utf-8");
  } catch (err) {
    process.stderr?.write(`Failed to write session log: ${err}\n`);
  }
}

/**
 * Consolidate raw AgentEvent stream into concise, loggable entries.
 *
 * Instead of logging every message_update delta individually (thousands per turn),
 * we buffer thinking/text deltas within each turn and emit a single consolidated
 * entry when the turn ends.
 */
function consolidateEvents(events: AgentEvent[]): object[] {
  const out: object[] = [];
  let thinking = "";
  let text = "";
  let hasDeltas = false;

  for (const event of events) {
    switch (event.type) {
      case "agent_start":
      case "agent_end":
      case "message_start":
      case "message_end":
        // Silently skip — no substance for the trace log
        break;

      case "turn_start":
        thinking = "";
        text = "";
        hasDeltas = false;
        out.push({ type: "turn_start" });
        break;

      case "message_update": {
        const ame = (event as any).assistantMessageEvent;
        if (ame?.type === "thinking_delta" && ame.delta) {
          thinking += ame.delta;
          hasDeltas = true;
        } else if (ame?.type === "text_delta" && ame.delta) {
          text += ame.delta;
          hasDeltas = true;
        }
        break;
      }

      case "turn_end": {
        if (hasDeltas) {
          const entry: any = { type: "turn_output" };
          if (thinking) entry.thinking = thinking;
          if (text) entry.text = text;
          out.push(entry);
        }

        const msg = (event as any).message;
        if (msg?.usage) {
          out.push({
            type: "usage",
            input: msg.usage.input ?? 0,
            output: msg.usage.output ?? 0,
            cacheRead: msg.usage.cacheRead ?? 0,
            cacheWrite: msg.usage.cacheWrite ?? 0,
          });
        }

        const toolResults = (event as any).toolResults;
        if (toolResults?.length) {
          out.push({ type: "tool_results", count: toolResults.length });
        }
        break;
      }

      case "tool_execution_start":
        out.push({
          type: "tool_call",
          tool: (event as any).toolName,
          args: truncate((event as any).args, 2000),
        });
        break;

      case "tool_execution_end":
        out.push({
          type: "tool_result",
          tool: (event as any).toolName,
          isError: (event as any).isError,
          result: truncate((event as any).result, 2000),
        });
        break;

      default:
        out.push({ type: event.type, raw: true });
        break;
    }
  }

  return out;
}

function truncate(value: any, maxChars: number): any {
  if (value === undefined || value === null) return value;
  try {
    const json = JSON.stringify(value);
    if (json.length <= maxChars) return value;
    return json.slice(0, maxChars) + `... [truncated ${json.length} chars]`;
  } catch {
    return String(value);
  }
}
