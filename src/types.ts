/**
 * Core types for the orchestrated AI code review system.
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
}
export interface ReviewConfig {
  /** Working directory (git repo root). Default: process.cwd() */
  cwd?: string;

  /** Diff source. Can be a git ref range ("HEAD~1", "main...HEAD"), "staged", "unstaged", or raw diff string */
  diff?: string;

  /** Model for reviewers. Default: auto-select first available */
  model?: string;

  /** Model provider. Default: auto-detect */
  provider?: string;

  /** Override which reviewers to run. Default: based on risk tier */
  reviewers?: ReviewCategory[];

  /** Override risk tier. Default: auto-assess from diff */
  riskTier?: RiskTier;

  /** Output format. Default: "text" */
  format?: OutputFormat;

  /** Write output to file instead of stdout */
  outputFile?: string;

  /** Per-reviewer timeout in milliseconds. Default: 300000 (5 min) */
  reviewerTimeout?: number;

  /** Maximum concurrent reviewers. Default: 3 */
  maxConcurrency?: number;

  /** Custom instructions appended to all reviewer prompts */
  customInstructions?: string;

  /** Thinker level for LLM. Default: "medium" */
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";

  /** Whether to use color in text output. Default: true if tty */
  color?: boolean;
}

export interface ResolvedConfig extends Required<Omit<ReviewConfig, 'outputFile'>> {
  outputFile?: string;
}
