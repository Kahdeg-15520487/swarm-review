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

export type { ReviewConfig, ReviewResult, ResolvedConfig };
export type {
  Finding, ReviewerResult, Verdict, Severity,
  RiskTier, OutputFormat, DiffFile, DiffResult,
} from "./types.js";
export { formatOutput } from "./output.js";
export { resolveConfig } from "./config.js";

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
  );

  const result = await runCoordinator(
    reviewerResults,
    filteredDiff,
    riskTier,
    finalConfig,
    abortController.signal,
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
      for (const event of r.events) {
        try { lines.push(JSON.stringify({ source: r.reviewer, ...serializeEvent(event) })); } catch {}
      }
    }
  }

  if (coordinatorResult.coordinatorEvents) {
    for (const event of coordinatorResult.coordinatorEvents) {
      try { lines.push(JSON.stringify({ source: "coordinator", ...serializeEvent(event) })); } catch {}
    }
  }

  try {
    writeFileSync(path, lines.join("\n"), "utf-8");
  } catch (err) {
    process.stderr?.write(`Failed to write session log: ${err}\n`);
  }
}

function serializeEvent(event: AgentEvent): object {
  const safe: any = { type: event.type };

  for (const [key, value] of Object.entries(event)) {
    if (key === "type") continue;
    if (typeof value === "function") continue;

    // Strip full message objects from high-frequency events — they're redundant
    // and can be megabytes per event. Keep only the event metadata.
    if (key === "message" && (event.type === "message_start" || event.type === "message_end" || event.type === "message_update")) {
      const msg = value as any;
      safe[key] = msg.role ? { role: msg.role } : {};
      continue;
    }
    if (key === "assistantMessageEvent") {
      const ame = value as any;
      safe[key] = ame.type ? { type: ame.type } : {};
      continue;
    }

    if (value instanceof Uint8Array) { safe[key] = `[Buffer ${value.length}b]`; continue; }
    try {
      const json = JSON.stringify(value);
      if (json.length > 10000) {
        safe[key] = json.slice(0, 10000) + `... [truncated ${json.length} chars]`;
      } else {
        safe[key] = value;
      }
    } catch {
      safe[key] = String(value);
    }
  }

  return safe;
}
