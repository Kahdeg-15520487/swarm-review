/** Severity of a finding from a sub-reviewer */
export type Severity = "critical" | "warning" | "suggestion";

/** A single finding from a reviewer */
export interface Finding {
  severity: Severity;
  file: string;
  line: number;
  title: string;
  description: string;
  recommendation: string;
}

/** Findings grouped by domain */
export interface DomainFindings {
  domain: string;
  findings: Finding[];
}

/** Risk tier classification */
export type RiskTier = "trivial" | "lite" | "full";

/** A sub-reviewer in the swarm */
export interface Reviewer {
  name: string;
  promptFile: string;
  domain: string;
  runsOn: RiskTier[];
}

/** Coordinator verdict */
export type Verdict = "approved" | "approved_with_comments" | "minor_issues" | "significant_concerns";

/** Final review result */
export interface ReviewResult {
  verdict: Verdict;
  summary: string;
  findings: DomainFindings[];
}

/**
 * User-facing configuration for a review run.
 * Passed to review() or runSwarmReview().
 */
export interface ReviewConfig {
  /** Working directory (defaults to process.cwd()) */
  cwd?: string;
  /** Custom instructions injected into all reviewer prompts */
  customInstructions?: string;
  /** Skip cleanup of .swarm-review temp directory */
  keepTemp?: boolean;
  /** Path to write the final review result (default: review-result.md) */
  outputFile?: string;
  /** Path to a specific diff file (skips auto-detection) */
  diff?: string;
  /** Override risk tier */
  tier?: RiskTier;
  /** Repository root (default: auto-detected) */
  repo?: string;
}

/** Internal resolved configuration after auto-detection */
export interface ResolvedConfig {
  repoRoot: string;
  diffPath: string;
  branch: string;
  tier: RiskTier;
  customInstructions?: string;
  skipCleanup?: boolean;
}

/** A parsed diff entry (one file) */
export interface DiffEntry {
  path: string;
  addedLines: number;
  removedLines: number;
  isSecuritySensitive: boolean;
}
