import type { AgentEvent } from "@earendil-works/pi-agent-core";

/** Callback for real-time agent events during review */
export type ReviewEventCallback = (source: string, event: AgentEvent) => void;

/**
 * Core types for the orchestrated swarm review system.
 */

export type Severity = "critical" | "warning" | "suggestion";

export type ReviewCategory = "security" | "performance" | "quality";

export type RiskTier = "trivial" | "lite" | "full";

export type OutputFormat = "text" | "json" | "markdown";

export type Verdict =
  | "approved"
  | "approved_with_comments"
  | "minor_issues"
  | "significant_concerns";
export interface DiffFile {
  path: string;
  addedLines: number;
  removedLines: number;
  content: string;
  isRenamed?: boolean;
  isNew?: boolean;
  isDeleted?: boolean;
}

export interface DiffResult {
  files: DiffFile[];
  totalAddedLines: number;
  totalRemovedLines: number;
  rawDiff: string;
}
export interface Finding {
  severity: Severity;
  category: ReviewCategory;
  title: string;
  description: string;
  file: string;
  line?: number;
  codeSnippet?: string;
  recommendation: string;
}
export interface ReviewerResult {
  reviewer: string;
  findings: Finding[];
  model: string;
  usage: TokenUsage;
  durationMs: number;
  error?: string;
  events?: any[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}
export interface ReviewResult {
  verdict: Verdict;
  findings: Finding[];
  summary: string;
  riskTier: RiskTier;
  reviewers: ReviewerResult[];
  totalUsage: TokenUsage;
  durationMs: number;
  config: ResolvedConfig;
  coordinatorEvents?: any[];
}
export interface ReviewConfig {
  cwd?: string;
  diff?: string;
  model?: string;
  provider?: string;
  reviewers?: ReviewCategory[];
  riskTier?: RiskTier;
  format?: OutputFormat;
  outputFile?: string;
  reviewerTimeout?: number;
  maxConcurrency?: number;
  customInstructions?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
  color?: boolean;

  /** Write full session trace (events, tool calls, thinking, tokens) as JSONL */
  sessionLog?: string;

  /** Optional callback for real-time agent events during review */
  onEvent?: ReviewEventCallback;
}

export interface ResolvedConfig extends Required<Omit<ReviewConfig, 'outputFile' | 'sessionLog' | 'onEvent'>> {
  outputFile?: string;
  sessionLog?: string;
  onEvent?: ReviewEventCallback;
}
