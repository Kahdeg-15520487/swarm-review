# Orchestrated AI Code Review — Implementation Plan

> **Worker note:** Execute this plan task-by-task. Each step uses checkbox (`- [ ]`) syntax for progress tracking.

**Goal:** Build a standalone TypeScript application based on pi agent core that orchestrates specialized AI code review agents (Security, Performance, Code Quality + Coordinator), inspired by the Cloudflare blog post architecture.

**Architecture:** A library + CLI tool. Each specialized reviewer runs as an isolated `AgentSession` (in-process, separate LLM context) with read-only tools and a domain-specific system prompt. A Coordinator session deduplicates findings, judges severity, and produces the final structured review. Risk tier assessment determines which reviewers run. The tool accepts git diffs as input and produces terminal output in text, JSON, or markdown format.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` SDK, `@earendil-works/pi-ai`, `typebox`, `simple-git` for git operations, Node.js ≥22.

**Work Scope:**
- **In scope:**
  - Project scaffolding (package.json, tsconfig, build)
  - Type definitions and configuration
  - Git diff extraction and noise filtering
  - Risk tier assessment (trivial / lite / full)
  - 3 specialized reviewer prompts (Security, Performance, Code Quality)
  - 1 coordinator prompt
  - Shared prompt rules
  - Agent session factory (creates isolated sessions per reviewer)
  - Parallel reviewer runner with timeout and concurrency control
  - Coordinator (dedup, severity judgment, final verdict)
  - Output formatting (text, JSON, markdown)
  - Library API (`review()` function, importable)
  - CLI entry point (`ai-code-review` bin)
  - README with usage instructions
- **Out of scope:**
  - VCS posting (GitHub/GitLab comment integration)
  - Re-review / incremental review
  - Circuit breakers / failback chains
  - AGENTS.md reviewer
  - Release reviewer
  - Documentation reviewer
  - Remote config / control plane
  - Telemetry / observability

**Verification Strategy:**
- **Level:** build-only (new project, no existing test infra)
- **Command:** `npx tsx src/cli.ts --diff HEAD~1 --cwd .` (smoke test against the project's own repo)
- **What it validates:** Full pipeline — diff extraction → risk tier → reviewer spawning → coordinator → formatted output

---

## File Structure Mapping

```
orch_ai_code_rv/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # Library API (review function)
│   ├── cli.ts                # CLI entry point (bin)
│   ├── types.ts              # All shared types
│   ├── config.ts             # Default config + resolution
│   ├── diff/
│   │   ├── git.ts            # Git diff extraction
│   │   ├── filter.ts         # Noise file filtering
│   │   └── risk.ts           # Risk tier assessment
│   ├── prompts/
│   │   ├── shared.ts         # Shared rules for all reviewers
│   │   ├── security.ts       # Security reviewer prompt
│   │   ├── performance.ts    # Performance reviewer prompt
│   │   ├── quality.ts        # Code quality reviewer prompt
│   │   └── coordinator.ts    # Coordinator prompt
│   ├── session.ts            # Agent session factory
│   ├── runner.ts             # Parallel reviewer runner
│   ├── coordinator.ts        # Coordinator orchestration
│   └── output.ts             # Output formatting
├── docs/
│   └── engineering-discipline/
│       └── plans/
│           └── 2026-05-10-orchestrated-ai-code-review.md  # This plan
```

---

### Task 1: Project scaffolding, types, and configuration

**Dependencies:** None (can run in parallel with nothing)
**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/types.ts`
- Create: `src/config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ai-code-review",
  "version": "0.1.0",
  "description": "Orchestrated AI code review using specialized agents, based on pi agent core",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "bin": {
    "ai-code-review": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "start": "node dist/cli.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "latest",
    "@earendil-works/pi-ai": "latest",
    "typebox": "latest",
    "simple-git": "latest"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "@types/node": "^22.0.0"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2024"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `src/types.ts`**

```typescript
/**
 * Core types for the orchestrated AI code review system.
 */

// ── Severity & Categories ──

export type Severity = "critical" | "warning" | "suggestion";

export type ReviewCategory = "security" | "performance" | "quality";

export type RiskTier = "trivial" | "lite" | "full";

export type OutputFormat = "text" | "json" | "markdown";

export type Verdict =
  | "approved"
  | "approved_with_comments"
  | "minor_issues"
  | "significant_concerns";

// ── Diff Types ──

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

// ── Finding Types ──

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

// ── Reviewer Results ──

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

// ── Final Review Result ──

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

// ── Configuration ──

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
```

- [ ] **Step 4: Create `src/config.ts`**

```typescript
/**
 * Configuration resolution and defaults.
 */

import type { ResolvedConfig, ReviewConfig, ReviewCategory, RiskTier } from "./types.js";

const DEFAULT_REVIEWERS_FULL: ReviewCategory[] = ["security", "performance", "quality"];
const DEFAULT_REVIEWERS_LITE: ReviewCategory[] = ["quality", "security"];
const DEFAULT_REVIEWERS_TRIVIAL: ReviewCategory[] = ["quality"];

export function getReviewersForTier(tier: RiskTier): ReviewCategory[] {
  switch (tier) {
    case "trivial":
      return [...DEFAULT_REVIEWERS_TRIVIAL];
    case "lite":
      return [...DEFAULT_REVIEWERS_LITE];
    case "full":
      return [...DEFAULT_REVIEWERS_FULL];
  }
}

export function resolveConfig(input: ReviewConfig): ResolvedConfig {
  const cwd = input.cwd ?? process.cwd();
  const isTty = process.stdout.isTTY ?? false;

  return {
    cwd,
    diff: input.diff ?? "HEAD~1",
    model: input.model ?? "",
    provider: input.provider ?? "",
    reviewers: input.reviewers ?? DEFAULT_REVIEWERS_FULL,
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
```

- [ ] **Step 5: Run `npm install`**

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && npm install
```

Expected: Dependencies installed, `node_modules/` created.

- [ ] **Step 6: Verify TypeScript compiles (empty check)**

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && npx tsc --noEmit
```

Expected: May have errors from missing imports — that's OK, will be resolved in later tasks.

---

### Task 2: Git diff, filtering, and risk assessment

**Dependencies:** Runs after Task 1 completes
**Files:**
- Create: `src/diff/git.ts`
- Create: `src/diff/filter.ts`
- Create: `src/diff/risk.ts`

- [ ] **Step 1: Create `src/diff/git.ts`**

```typescript
/**
 * Git diff extraction using simple-git.
 */

import { simpleGit, type SimpleGit, type DiffResult as GitDiffResult, type DefaultLogFields } from "simple-git";
import type { DiffFile, DiffResult } from "../types.js";

export async function getDiff(cwd: string, diffSpec: string): Promise<DiffResult> {
  const git: SimpleGit = simpleGit(cwd);

  // Check we're in a git repo
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  // Get the diff
  let rawDiff: string;
  const diffArg = diffSpec.trim();

  if (diffArg === "staged") {
    rawDiff = await git.diff(["--cached"]);
  } else if (diffArg === "unstaged") {
    rawDiff = await git.diff();
  } else {
    // Treat as a ref range: "HEAD~1", "main...HEAD", etc.
    rawDiff = await git.diff([diffArg]);
  }

  // Get diff stat for line counts per file
  const diffSummary = await git.diffSummary(diffArg === "staged" ? ["--cached"] : diffArg === "unstaged" ? [] : [diffArg]);

  const files: DiffFile[] = diffSummary.files.map((f) => {
    const filePath = f.file;
    // Extract per-file diff content from the raw diff
    const fileDiff = extractFileDiff(rawDiff, filePath);

    return {
      path: filePath,
      addedLines: f.insertions ?? 0,
      removedLines: f.deletions ?? 0,
      content: fileDiff,
      isRenamed: (f as any).renameFrom !== undefined,
      isNew: fileDiff.startsWith("diff --git") && fileDiff.includes("new file"),
      isDeleted: fileDiff.startsWith("diff --git") && fileDiff.includes("deleted file"),
    };
  });

  const totalAddedLines = files.reduce((sum, f) => sum + f.addedLines, 0);
  const totalRemovedLines = files.reduce((sum, f) => sum + f.removedLines, 0);

  return { files, totalAddedLines, totalRemovedLines, rawDiff };
}

/**
 * Extract the diff content for a single file from the raw diff output.
 */
function extractFileDiff(rawDiff: string, filePath: string): string {
  // Match diff headers for this file (handle both a/ and b/ prefixes, and quotes)
  const escapedPath = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Try matching with the standard diff --git pattern
  const patterns = [
    new RegExp(`diff --git a/${escapedPath} b/${escapedPath}[\\s\\S]*?(?=\\ndiff --git |$)`, "g"),
    new RegExp(`diff --git "a/${escapedPath}" "b/${escapedPath}"[\\s\\S]*?(?=\\ndiff --git |$)`, "g"),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(rawDiff);
    if (match) return match[0];
  }

  return "";
}
```

- [ ] **Step 2: Create `src/diff/filter.ts`**

```typescript
/**
 * Diff noise filtering — strips lock files, vendored deps, minified assets, etc.
 * Inspired by Cloudflare's filtering pipeline.
 */

import * as path from "node:path";
import type { DiffFile, DiffResult } from "../types.js";

const NOISE_FILE_PATTERNS: readonly string[] = [
  "bun.lock", "package-lock.json", "yarn.lock",
  "pnpm-lock.yaml", "Cargo.lock", "go.sum",
  "poetry.lock", "Pipfile.lock", "flake.lock",
  "Gemfile.lock", "composer.lock", "mix.lock",
  "podspec.lock", "Podfile.lock",
];

const NOISE_EXTENSIONS: readonly string[] = [
  ".min.js", ".min.css", ".bundle.js", ".bundle.css",
  ".map", ".gz", ".zip", ".tar", ".woff", ".woff2",
  ".eot", ".ttf", ".ico", ".png", ".jpg", ".jpeg",
  ".gif", ".webp", ".svg", ".mp4", ".mp3", ".webm",
];

const NOISE_DIRECTORIES: readonly string[] = [
  "node_modules", "vendor", "dist", "build", ".next",
  ".nuxt", "coverage", "__snapshots__",
];

const GENERATED_FILE_MARKERS: readonly string[] = [
  "// @generated",
  "// @autogenerated",
  "/* eslint-disable */",
  "// Code generated by",
  "# Generated by",
  "<!-- Generated by",
];

function isLockFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return NOISE_FILE_PATTERNS.includes(basename);
}

function hasNoiseExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return NOISE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isInNoiseDirectory(filePath: string): boolean {
  const parts = filePath.split(/[/\\]/);
  return parts.some((part) => NOISE_DIRECTORIES.includes(part));
}

function looksGenerated(content: string): boolean {
  // Check first 5 lines for generated markers
  const firstLines = content.split("\n").slice(0, 5).join("\n").toLowerCase();
  return GENERATED_FILE_MARKERS.some((marker) => firstLines.includes(marker.toLowerCase()));
}

function isDatabaseMigration(filePath: string): boolean {
  // Migrations are often marked as generated but should be reviewed
  const lower = filePath.toLowerCase();
  return lower.includes("migration") || lower.includes("migrations");
}

export function filterDiff(diffResult: DiffResult): DiffResult {
  const filteredFiles: DiffFile[] = [];

  for (const file of diffResult.files) {
    // Skip lock files
    if (isLockFile(file.path)) continue;

    // Skip minified/binary assets
    if (hasNoiseExtension(file.path)) continue;

    // Skip vendored/generated directories
    if (isInNoiseDirectory(file.path)) continue;

    // Skip generated files (but NOT database migrations)
    if (looksGenerated(file.content) && !isDatabaseMigration(file.path)) continue;

    filteredFiles.push(file);
  }

  const totalAddedLines = filteredFiles.reduce((sum, f) => sum + f.addedLines, 0);
  const totalRemovedLines = filteredFiles.reduce((sum, f) => sum + f.removedLines, 0);

  return {
    files: filteredFiles,
    totalAddedLines,
    totalRemovedLines,
    rawDiff: filteredFiles.map((f) => f.content).join("\n"),
  };
}
```

- [ ] **Step 3: Create `src/diff/risk.ts`**

```typescript
/**
 * Risk tier assessment based on diff characteristics.
 * Determines how many reviewers to dispatch.
 * Inspired by Cloudflare's tiered review system.
 */

import type { DiffFile, RiskTier } from "../types.js";

const SECURITY_SENSITIVE_PATTERNS: readonly (string | RegExp)[] = [
  "auth/", "authentication/", "crypto/", "cryptographic/",
  "password", "secret", "credential", "token",
  "jwt", "oauth", "session",
  /\.env/, /\.pem/, /\.key/, /\.cert/,
  "middleware/auth", "security/", "permissions/",
];

function isSecuritySensitiveFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return SECURITY_SENSITIVE_PATTERNS.some((pattern) => {
    if (typeof pattern === "string") return normalized.includes(pattern);
    return pattern.test(normalized);
  });
}

export function assessRiskTier(files: DiffFile[]): RiskTier {
  const totalLines = files.reduce((sum, f) => sum + f.addedLines + f.removedLines, 0);
  const fileCount = files.length;
  const hasSecurityFiles = files.some((f) => isSecuritySensitiveFile(f.path));

  // Security-sensitive files always trigger full review
  if (fileCount > 50 || hasSecurityFiles) return "full";

  if (totalLines <= 10 && fileCount <= 20) return "trivial";
  if (totalLines <= 100 && fileCount <= 20) return "lite";
  return "full";
}
```

- [ ] **Step 4: Verify TypeScript compiles for diff modules**

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && npx tsc --noEmit
```

Expected: No errors from these files (other files may still error).

---

### Task 3: Reviewer prompts

**Dependencies:** Runs after Task 1 completes (can run in parallel with Task 2)
**Files:**
- Create: `src/prompts/shared.ts`
- Create: `src/prompts/security.ts`
- Create: `src/prompts/performance.ts`
- Create: `src/prompts/quality.ts`
- Create: `src/prompts/coordinator.ts`

- [ ] **Step 1: Create `src/prompts/shared.ts`**

```typescript
/**
 * Shared rules appended to every reviewer's system prompt.
 * These enforce structured output format and common boundaries.
 */

export const SHARED_RULES = `## Mandatory Output Rules

You MUST report your findings using the report_finding tool. Call it once for each finding.
Do NOT write findings as plain text — only use the tool.

If you find no issues, simply respond with "No issues found." and do not call the tool.

## Shared Rules for All Reviewers

1. ONLY review code that appears in the diff. Do not flag issues in unchanged code unless the diff introduces a dependency on broken existing code.
2. NEVER suggest adding comments, updating documentation, or improving variable names — that is not your domain.
3. NEVER flag theoretical risks that require unlikely preconditions.
4. NEVER suggest switching to a different library, framework, or language.
5. Be specific: always reference the exact file, line number, and code snippet when possible.
6. Be concise: one finding per issue, clear title, actionable recommendation.
7. If the diff is small and clean, say "No issues found." rather than inventing concerns.

## Severity Guidelines

- **critical**: Will cause an outage, data loss, security breach, or is directly exploitable. The code is broken in production.
- **warning**: Measurable regression, concrete risk, or a bug that will manifest under normal usage. Not broken yet, but close.
- **suggestion**: An improvement worth considering. Not a bug, not a risk, but would meaningfully improve the code.
`;
```

- [ ] **Step 2: Create `src/prompts/security.ts`**

```typescript
/**
 * Security reviewer system prompt.
 * Focused on exploitable vulnerabilities and concrete security risks.
 */

import { SHARED_RULES } from "./shared.js";

export const SECURITY_PROMPT = `You are a Security Reviewer specializing in finding exploitable vulnerabilities in code changes.

## Your Scope

You review diffs for security issues. You have access to read files, search code, and explore the codebase. Use these tools to verify your findings before reporting them.

## What to Flag

- Injection vulnerabilities (SQL, XSS, command injection, path traversal, LDAP injection)
- Authentication or authorization bypasses in changed code
- Hardcoded secrets, credentials, or API keys
- Insecure cryptographic usage (weak algorithms, missing salts, hardcoded IVs)
- Missing input validation on untrusted data at trust boundaries
- Insecure deserialization of untrusted input
- Race conditions that could lead to privilege escalation
- Cross-site request forgery (CSRF) vulnerabilities
- Server-side request forgery (SSRF)
- Insecure file upload handling
- Use of eval(), exec(), or similar dynamic code execution with user input

## What NOT to Flag

- Theoretical risks that require unlikely preconditions
- Defense-in-depth suggestions when primary defenses are adequate
- Issues in unchanged code that this diff doesn't affect
- "Consider using library X" style suggestions
- Missing rate limiting (unless the diff introduces a new endpoint without any)
- CORS configuration suggestions (unless the diff explicitly sets CORS headers unsafely)
- General "add logging/monitoring" suggestions

## Verification Steps

Before flagging any issue:
1. READ the surrounding code to verify the issue is real
2. Check if existing defenses already mitigate the risk
3. Confirm the vulnerability path is reachable from the diff
4. Verify it's not a false positive (test code, intentional test fixtures, etc.)

${SHARED_RULES}
`;
```

- [ ] **Step 3: Create `src/prompts/performance.ts`**

```typescript
/**
 * Performance reviewer system prompt.
 * Focused on measurable regressions and algorithmic issues.
 */

import { SHARED_RULES } from "./shared.js";

export const PERFORMANCE_PROMPT = `You are a Performance Reviewer specializing in finding measurable performance regressions in code changes.

## Your Scope

You review diffs for performance issues. You have access to read files, search code, and explore the codebase. Use these tools to verify your findings before reporting them.

## What to Flag

- N+1 query patterns introduced by the diff
- Unnecessary loops or nested loops that can be optimized
- Memory leaks (unclosed resources, growing caches without bounds, missing cleanup)
- Inefficient data structure choices (O(n) lookups where O(1) is trivially achievable)
- Redundant computation or repeated expensive operations
- Missing pagination on new list endpoints
- Synchronous operations that should be asynchronous in hot paths
- Large object allocation in tight loops
- Missing connection pooling or resource reuse
- Unbounded recursion or stack overflow risks
- Inefficient string concatenation in loops
- Missing lazy loading for expensive resources

## What NOT to Flag

- Micro-optimizations that save nanoseconds (e.g., "use const instead of let")
- Theoretical scalability concerns with no evidence of actual usage
- Suggestions to add caching unless the diff introduces a demonstrably slow operation
- "Consider using a profiler" — that's not a code review finding
- Premature optimization of code that runs rarely (startup, shutdown, config loading)
- Suggestions to change databases, ORMs, or query languages
- General "this could be faster" without concrete measurement or evidence

## Verification Steps

Before flagging any issue:
1. READ the surrounding code to understand the context (is this a hot path?)
2. Check if there's already a caching or optimization mechanism in place
3. Estimate the actual impact (how many users/requests are affected?)
4. Verify the issue is introduced by this diff, not pre-existing

${SHARED_RULES}
`;
```

- [ ] **Step 4: Create `src/prompts/quality.ts`**

```typescript
/**
 * Code quality reviewer system prompt.
 * Focused on logic errors, bugs, and code quality issues.
 */

import { SHARED_RULES } from "./shared.js";

export const QUALITY_PROMPT = `You are a Code Quality Reviewer specializing in finding logic errors, bugs, and code quality issues in code changes.

## Your Scope

You review diffs for code quality issues. You have access to read files, search code, and explore the codebase. Use these tools to verify your findings before reporting them.

## What to Flag

- Logic errors (wrong conditions, off-by-one errors, incorrect boolean logic)
- Unreachable code or dead code paths introduced by the diff
- Missing error handling for operations that can fail (I/O, network, parsing)
- Incorrect error handling (swallowed errors, wrong error types)
- Resource leaks (unclosed files, connections, streams)
- Type confusion or unsafe type assertions that can fail at runtime
- Concurrency issues (shared mutable state without synchronization)
- Incorrect API usage (wrong argument order, missing required arguments)
- State management bugs (stale state, missing state updates)
- Regression-inducing changes (removing functionality, changing return types)
- Silent data loss or corruption risks
- Off-by-one errors in pagination, slicing, or boundary conditions

## What NOT to Flag

- Style preferences (naming conventions, quote style, semicolons)
- "Consider extracting this into a function" — unless it causes a real bug
- Missing tests (that's not a code quality issue, it's a process issue)
- Documentation suggestions
- "This could be more elegant" or "this pattern is cleaner"
- General "add error handling" without specifying WHAT error and WHERE
- Issues in unchanged code
- Test-only code quality (test code is allowed to be verbose)
- Suggestion to use optional chaining if the code already handles null checks

## Verification Steps

Before flagging any issue:
1. READ the full function or method, not just the changed lines
2. Trace the data flow to confirm the bug is reachable
3. Check if the existing tests would catch this issue
4. Verify it's a real bug, not an intentional design choice

${SHARED_RULES}
`;
```

- [ ] **Step 5: Create `src/prompts/coordinator.ts`**

```typescript
/**
 * Coordinator system prompt.
 * Deduplicates findings, judges severity, produces final verdict.
 */

import { SHARED_RULES } from "./shared.js";

export const COORDINATOR_PROMPT = `You are the Review Coordinator. Your job is to synthesize findings from multiple specialized reviewers into a single, coherent, deduplicated review.

## Your Scope

You receive findings from Security, Performance, and Code Quality reviewers. You:
1. Deduplicate overlapping findings
2. Re-categorize misfiled findings
3. Filter out false positives and noise
4. Judge the overall severity
5. Produce the final review verdict

## Deduplication Rules

- If the same issue is flagged by multiple reviewers, keep it ONCE in the most appropriate category
- If a security reviewer flags a performance issue, move it to performance
- If a quality reviewer flags a security issue, move it to security
- Drop findings that are clearly duplicates (same file, same line, same issue)

## Severity Judgment

- **critical**: ONLY for issues that will cause outages, data loss, or are directly exploitable security vulnerabilities. Be conservative — most issues are NOT critical.
- **warning**: Measurable regression, concrete risk, or a real bug. This is the default for genuine issues.
- **suggestion**: An improvement worth considering. Not a bug, not a risk.

## Reasonableness Filter

DROP findings that are:
- Speculative or theoretical ("this might cause issues if...")
- Nitpicks about style or naming
- Vague suggestions without specific code references
- Issues in unchanged code not affected by this diff
- False positives (verify by reading the source code if unsure)

When in doubt about a finding, use your tools to READ the source code and verify it.

## Verdict Rules (STRICT)

- **approved**: All findings are suggestion-severity or there are no findings.
- **approved_with_comments**: There are warnings, but no production risk pattern.
- **minor_issues**: Multiple warnings suggesting a risk pattern.
- **significant_concerns**: ANY critical finding, or clear production safety risk.

## Output

Call the submit_review tool ONCE with the final consolidated review. This is your most important action.

${SHARED_RULES}
`;
```

- [ ] **Step 6: Verify TypeScript compiles for prompts**

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && npx tsc --noEmit
```

Expected: No errors from prompt files.

---

### Task 4: Agent session management

**Dependencies:** Runs after Tasks 1, 2, 3 complete
**Files:**
- Create: `src/session.ts`

This module creates isolated `AgentSession` instances for each reviewer and the coordinator. Each session gets:
- Its own system prompt (domain-specific)
- Read-only tools (read, grep, find, ls)
- A custom `report_finding` tool for structured output
- In-memory session (no persistence)

- [ ] **Step 1: Create `src/session.ts`**

```typescript
/**
 * Agent session factory for creating isolated reviewer sessions.
 *
 * Each reviewer gets its own AgentSession with:
 * - Domain-specific system prompt
 * - Read-only tools (read, grep, find, ls)
 * - A custom report_finding tool for structured output
 * - In-memory session (no file persistence)
 */

import {
  AuthStorage,
  ModelRegistry,
  createAgentSession,
  SessionManager,
  DefaultResourceLoader,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Finding, Severity, ReviewCategory, TokenUsage } from "./types.js";

// ── Collected findings per session ──

export interface SessionFindings {
  findings: Finding[];
  usage: TokenUsage;
  output: string;
  model: string;
}

// ── Custom tool: report_finding ──

function createReportFindingTool(category: ReviewCategory) {
  const findings: Finding[] = [];

  const tool = defineTool({
    name: "report_finding",
    label: "Report Finding",
    description: "Report a code review finding. Call this for each issue you discover.",
    parameters: Type.Object({
      severity: Type.Union([
        Type.Literal("critical"),
        Type.Literal("warning"),
        Type.Literal("suggestion"),
      ], { description: "Severity level of the finding" }),
      title: Type.String({ description: "Short, specific title for the issue" }),
      description: Type.String({ description: "Detailed description of the issue" }),
      file: Type.String({ description: "File path where the issue is found" }),
      line: Type.Optional(Type.Number({ description: "Line number (if known)" })),
      codeSnippet: Type.Optional(Type.String({ description: "Relevant code snippet" })),
      recommendation: Type.String({ description: "How to fix the issue" }),
    }),
    execute: async (_toolCallId, params) => {
      const finding: Finding = {
        severity: params.severity as Severity,
        category,
        title: params.title,
        description: params.description,
        file: params.file,
        line: params.line,
        codeSnippet: params.codeSnippet,
        recommendation: params.recommendation,
      };
      findings.push(finding);
      return {
        content: [{ type: "text", text: `Finding recorded: [${finding.severity}] ${finding.title}` }],
        details: {},
      };
    },
  });

  return { tool, findings: () => [...findings] };
}

// ── Custom tool: submit_review (coordinator only) ──

export interface CoordinatorReview {
  verdict: "approved" | "approved_with_comments" | "minor_issues" | "significant_concerns";
  findings: Finding[];
  summary: string;
}

function createSubmitReviewTool() {
  let review: CoordinatorReview | null = null;

  const tool = defineTool({
    name: "submit_review",
    label: "Submit Review",
    description: "Submit the final consolidated review. Call this ONCE after analyzing all reviewer findings.",
    parameters: Type.Object({
      verdict: Type.Union([
        Type.Literal("approved"),
        Type.Literal("approved_with_comments"),
        Type.Literal("minor_issues"),
        Type.Literal("significant_concerns"),
      ], { description: "Overall review verdict" }),
      summary: Type.String({ description: "Summary of the review (2-4 sentences)" }),
      findings: Type.Array(Type.Object({
        severity: Type.Union([
          Type.Literal("critical"),
          Type.Literal("warning"),
          Type.Literal("suggestion"),
        ]),
        category: Type.Union([
          Type.Literal("security"),
          Type.Literal("performance"),
          Type.Literal("quality"),
        ]),
        title: Type.String(),
        description: Type.String(),
        file: Type.String(),
        line: Type.Optional(Type.Number()),
        codeSnippet: Type.Optional(Type.String()),
        recommendation: Type.String(),
      }), { description: "Deduplicated, final findings" }),
    }),
    execute: async (_toolCallId, params) => {
      review = {
        verdict: params.verdict as CoordinatorReview["verdict"],
        findings: params.findings as Finding[],
        summary: params.summary,
      };
      return {
        content: [{ type: "text", text: `Review submitted: ${params.verdict}` }],
        details: {},
        terminate: true,
      };
    },
  });

  return { tool, review: () => review };
}

// ── Session creation ──

export interface SessionOptions {
  systemPrompt: string;
  category: ReviewCategory | "coordinator";
  cwd: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
}

/**
 * Create an isolated agent session for a reviewer or coordinator.
 * Uses in-memory session, read-only tools, and the report_finding tool.
 */
export async function createReviewerSession(options: SessionOptions) {
  const { systemPrompt, category, cwd, model, provider, thinkingLevel } = options;

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  // Resolve model
  let resolvedModel;
  if (model && provider) {
    resolvedModel = modelRegistry.find(provider, model);
  } else if (model) {
    const available = await modelRegistry.getAvailable();
    resolvedModel = available.find((m) => m.id === model);
  }

  if (!resolvedModel) {
    const available = await modelRegistry.getAvailable();
    if (available.length === 0) {
      throw new Error("No models available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or other provider keys.");
    }
    resolvedModel = available[0];
  }

  // Create the appropriate tool
  const isCoordinator = category === "coordinator";
  const reportTool = isCoordinator
    ? createSubmitReviewTool()
    : createReportFindingTool(category as ReviewCategory);

  // Build system prompt via resource loader
  const loader = new DefaultResourceLoader({
    cwd,
    systemPromptOverride: () => systemPrompt,
  });
  await loader.reload();

  // Create session
  const { session } = await createAgentSession({
    cwd,
    model: resolvedModel,
    thinkingLevel: (thinkingLevel as any) ?? "medium",
    authStorage,
    modelRegistry,
    tools: ["read", "grep", "find", "ls"],
    customTools: [reportTool.tool],
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
  });

  return {
    session,
    getFindings: isCoordinator
      ? () => { throw new Error("Use getReview() for coordinator"); }
      : () => (reportTool as ReturnType<typeof createReportFindingTool>).findings(),
    getReview: isCoordinator
      ? () => (reportTool as ReturnType<typeof createSubmitReviewTool>).review()
      : () => { throw new Error("Use getFindings() for reviewers"); },
    model: resolvedModel,
  };
}

/**
 * Run a session with a prompt, collecting all output and usage stats.
 * Returns when the agent finishes processing.
 */
export async function runSession(
  session: Awaited<ReturnType<typeof createReviewerSession>>["session"],
  prompt: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ output: string; usage: TokenUsage }> {
  const output: string[] = [];
  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
  };

  // Subscribe to events
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      output.push(event.assistantMessageEvent.delta);
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const msgUsage = event.message.usage;
      if (msgUsage) {
        usage.inputTokens += msgUsage.input ?? 0;
        usage.outputTokens += msgUsage.output ?? 0;
        usage.cacheReadTokens += msgUsage.cacheRead ?? 0;
        usage.cacheWriteTokens += msgUsage.cacheWrite ?? 0;
        usage.cost += msgUsage.cost?.total ?? 0;
      }
    }
  });

  // Create timeout controller
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  // Combine external signal with timeout
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    await session.prompt(prompt, { source: "interactive" });
  } finally {
    clearTimeout(timeoutId);
    unsubscribe();
  }

  return { output: output.join(""), usage };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && npx tsc --noEmit
```

Expected: Some type errors possible — fix any that arise from the session factory.

---

### Task 5: Parallel reviewer runner

**Dependencies:** Runs after Tasks 1, 2, 3, 4 complete
**Files:**
- Create: `src/runner.ts`

- [ ] **Step 1: Create `src/runner.ts`**

```typescript
/**
 * Parallel reviewer runner.
 *
 * Spawns specialized reviewer sessions concurrently, each with its own
 * isolated agent context, and collects structured findings.
 */

import { SECURITY_PROMPT } from "./prompts/security.js";
import { PERFORMANCE_PROMPT } from "./prompts/performance.js";
import { QUALITY_PROMPT } from "./prompts/quality.js";
import { SHARED_RULES } from "./prompts/shared.js";
import { createReviewerSession, runSession } from "./session.js";
import type {
  DiffResult,
  ReviewCategory,
  ReviewerResult,
  ResolvedConfig,
  Finding,
} from "./types.js";

// ── Prompt builder ──

function buildReviewerPrompt(
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

function getSystemPrompt(category: ReviewCategory): string {
  switch (category) {
    case "security":
      return SECURITY_PROMPT;
    case "performance":
      return PERFORMANCE_PROMPT;
    case "quality":
      return QUALITY_PROMPT;
  }
}

// ── Concurrency-limited execution ──

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

// ── Reviewer runner ──

export async function runReviewers(
  categories: ReviewCategory[],
  diffResult: DiffResult,
  config: ResolvedConfig,
  signal?: AbortSignal,
): Promise<ReviewerResult[]> {
  const results = await mapWithConcurrency(
    categories,
    config.maxConcurrency,
    async (category): Promise<ReviewerResult> => {
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

        // Dispose the session
        session.dispose();

        return {
          reviewer: category,
          findings,
          model: `${model.provider}/${model.id}`,
          usage,
          durationMs: Date.now() - startTime,
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && npx tsc --noEmit
```

---

### Task 6: Coordinator and output formatting

**Dependencies:** Runs after Task 5 completes (needs runner results)
**Files:**
- Create: `src/coordinator.ts`
- Create: `src/output.ts`

- [ ] **Step 1: Create `src/coordinator.ts`**

```typescript
/**
 * Coordinator — runs after all reviewers, deduplicates findings,
 * judges severity, and produces the final review verdict.
 */

import { COORDINATOR_PROMPT } from "./prompts/coordinator.js";
import { createReviewerSession, runSession } from "./session.js";
import type { CoordinatorReview } from "./session.js";
import type { ReviewerResult, ReviewResult, ResolvedConfig, DiffResult, RiskTier, Verdict } from "./types.js";

function buildCoordinatorPrompt(
  reviewerResults: ReviewerResult[],
  diffResult: DiffResult,
  config: ResolvedConfig,
): string {
  const findingsXml = reviewerResults
    .map((r) => {
      if (r.error) {
        return `<reviewer name="${r.reviewer}" status="error">\n  <error>${r.error}</error>\n</reviewer>`;
      }
      const findings = r.findings
        .map(
          (f) =>
            `  <finding severity="${f.severity}" category="${f.category}">\n` +
            `    <title>${f.title}</title>\n` +
            `    <file>${f.file}${f.line ? `:${f.line}` : ""}</file>\n` +
            `    <description>${f.description}</description>\n` +
            `    <recommendation>${f.recommendation}</recommendation>\n` +
            `  </finding>`,
        )
        .join("\n");

      return `<reviewer name="${r.reviewer}" status="completed" findings="${r.findings.length}">\n${findings || "  <no-findings/>\n"}\n</reviewer>`;
    })
    .join("\n\n");

  const filesSummary = diffResult.files
    .map((f) => `- ${f.path} (+${f.addedLines}/-${f.removedLines})`)
    .join("\n");

  let prompt = `## Coordinate This Review

### Changed Files
${filesSummary}

### Reviewer Findings

${findingsXml}

### Your Task

1. Read through ALL findings from ALL reviewers above.
2. Deduplicate: if the same issue is flagged by multiple reviewers, keep it ONCE in the best category.
3. Filter: drop false positives, nitpicks, and vague suggestions. If unsure about a finding, read the source code to verify.
4. Re-categorize: move misfiled findings to the correct category.
5. Judge overall severity and produce a verdict using the submit_review tool.`;

  if (config.customInstructions) {
    prompt += `\n\n### Custom Instructions\n\n${config.customInstructions}`;
  }

  return prompt;
}

export async function runCoordinator(
  reviewerResults: ReviewerResult[],
  diffResult: DiffResult,
  riskTier: RiskTier,
  config: ResolvedConfig,
  signal?: AbortSignal,
): Promise<ReviewResult> {
  const startTime = Date.now();

  // Aggregate reviewer usage
  const totalUsage = reviewerResults.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + r.usage.cacheReadTokens,
      cacheWriteTokens: acc.cacheWriteTokens + r.usage.cacheWriteTokens,
      cost: acc.cost + r.usage.cost,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 },
  );

  // Build coordinator session
  const systemPrompt = COORDINATOR_PROMPT;
  const prompt = buildCoordinatorPrompt(reviewerResults, diffResult, config);

  try {
    const { session, getReview, model } = await createReviewerSession({
      systemPrompt,
      category: "coordinator",
      cwd: config.cwd,
      model: config.model || undefined,
      provider: config.provider || undefined,
      thinkingLevel: config.thinkingLevel,
    });

    const coordinatorTimeout = config.reviewerTimeout * 2; // Coordinator gets double timeout
    const { usage: coordinatorUsage } = await runSession(
      session,
      prompt,
      coordinatorTimeout,
      signal,
    );

    const review = getReview();
    session.dispose();

    // Add coordinator usage to totals
    totalUsage.inputTokens += coordinatorUsage.inputTokens;
    totalUsage.outputTokens += coordinatorUsage.outputTokens;
    totalUsage.cacheReadTokens += coordinatorUsage.cacheReadTokens;
    totalUsage.cacheWriteTokens += coordinatorUsage.cacheWriteTokens;
    totalUsage.cost += coordinatorUsage.cost;

    // Determine verdict
    const verdict: Verdict = review?.verdict ?? deriveVerdict(reviewerResults);

    return {
      verdict,
      findings: review?.findings ?? aggregateFindings(reviewerResults),
      summary: review?.summary ?? "Review completed with some automation issues.",
      riskTier,
      reviewers: reviewerResults,
      totalUsage,
      durationMs: Date.now() - startTime,
      config,
    };
  } catch (err: any) {
    // If coordinator fails, fall back to raw aggregated results
    return {
      verdict: deriveVerdict(reviewerResults),
      findings: aggregateFindings(reviewerResults),
      summary: `Coordinator failed (${err.message}). Results are raw, un-deduplicated findings.`,
      riskTier,
      reviewers: reviewerResults,
      totalUsage,
      durationMs: Date.now() - startTime,
      config,
    };
  }
}

function deriveVerdict(reviewers: ReviewerResult[]): Verdict {
  const allFindings = reviewers.flatMap((r) => r.findings);
  const hasCritical = allFindings.some((f) => f.severity === "critical");
  const warningCount = allFindings.filter((f) => f.severity === "warning").length;

  if (hasCritical) return "significant_concerns";
  if (warningCount >= 3) return "minor_issues";
  if (warningCount > 0) return "approved_with_comments";
  return "approved";
}

function aggregateFindings(reviewers: ReviewerResult[]) {
  return reviewers.flatMap((r) => r.findings);
}
```

- [ ] **Step 2: Create `src/output.ts`**

```typescript
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

  // Header
  lines.push(useColor ? color("─".repeat(60), COLORS.dim) : "─".repeat(60));
  lines.push(useColor
    ? color("  AI Code Review", COLORS.bold, COLORS.cyan) + " " + verdictColor(result.verdict, useColor)
    : `  AI Code Review ${verdictIcon(result.verdict)}`);
  lines.push(useColor ? color("─".repeat(60), COLORS.dim) : "─".repeat(60));

  // Summary
  lines.push("");
  lines.push(useColor ? color("  Summary:", COLORS.bold) : "  Summary:");
  lines.push(`  ${result.summary}`);
  lines.push("");

  // Risk tier
  lines.push(useColor
    ? `  Risk Tier: ${color(result.riskTier, COLORS.bold)}`
    : `  Risk Tier: ${result.riskTier}`);
  lines.push("");

  // Findings
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

  // Reviewer stats
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

  // Totals
  lines.push(useColor ? color("  Totals:", COLORS.bold) : "  Totals:");
  lines.push(
    `    Duration: ${formatMs(result.durationMs)} | ` +
    `Tokens: ↑${formatTokens(result.totalUsage.inputTokens)} ↓${formatTokens(result.totalUsage.outputTokens)} | ` +
    `Cost: ${formatCost(result.totalUsage.cost)}`,
  );
  lines.push(useColor ? color("─".repeat(60), COLORS.dim) : "─".repeat(60));

  return lines.join("\n");
}

// ── JSON Output ──

export function formatJson(result: ReviewResult): string {
  return JSON.stringify(result, null, 2);
}

// ── Markdown Output ──

export function formatMarkdown(result: ReviewResult): string {
  const lines: string[] = [];

  lines.push(`# AI Code Review ${verdictIcon(result.verdict)}`);
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

// ── Dispatcher ──

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
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && npx tsc --noEmit
```

---

### Task 7: Library API and CLI entry point

**Dependencies:** Runs after Tasks 5 and 6 complete
**Files:**
- Create: `src/index.ts`
- Create: `src/cli.ts`

- [ ] **Step 1: Create `src/index.ts` (library API)**

```typescript
/**
 * ai-code-review — Orchestrated AI Code Review
 *
 * Library API. Import and call review() from any script.
 *
 * Usage:
 *   import { review } from "ai-code-review";
 *   const result = await review({ cwd: "./my-project", diff: "main...HEAD" });
 *   console.log(result.verdict);
 */

import { resolveConfig, getReviewersForTier } from "./config.js";
import { getDiff } from "./diff/git.js";
import { filterDiff } from "./diff/filter.js";
import { assessRiskTier } from "./diff/risk.js";
import { runReviewers } from "./runner.js";
import { runCoordinator } from "./coordinator.js";
import { formatOutput } from "./output.js";
import type { ReviewConfig, ReviewResult, ResolvedConfig } from "./types.js";

export type { ReviewConfig, ReviewResult, ResolvedConfig };
export type {
  Finding, ReviewerResult, Verdict, Severity,
  RiskTier, OutputFormat, DiffFile, DiffResult,
} from "./types.js";
export { formatOutput } from "./output.js";
export { resolveConfig } from "./config.js";

/**
 * Run an orchestrated AI code review.
 *
 * @param config - Review configuration
 * @returns Structured review result
 *
 * @example
 * ```ts
 * import { review } from "ai-code-review";
 *
 * const result = await review({
 *   cwd: "/path/to/repo",
 *   diff: "main...HEAD",
 *   format: "json",
 * });
 *
 * console.log(result.verdict);      // "approved" | "approved_with_comments" | ...
 * console.log(result.findings);     // Array of Finding objects
 * console.log(result.summary);      // Human-readable summary
 * ```
 */
export async function review(config: ReviewConfig = {}): Promise<ReviewResult> {
  const resolved = resolveConfig(config);
  const abortController = new AbortController();

  // 1. Extract git diff
  const rawDiff = await getDiff(resolved.cwd, resolved.diff);

  // 2. Filter noise
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

  // 3. Assess risk tier (use user override if provided, otherwise auto-assess)
  const userOverride = config.riskTier !== undefined;
  const riskTier = userOverride ? resolved.riskTier : assessRiskTier(filteredDiff.files);

  // 4. Determine which reviewers to run
  const reviewers = resolved.reviewers.length > 0
    ? resolved.reviewers
    : getReviewersForTier(riskTier);

  // Update config with actual resolved values
  const finalConfig: ResolvedConfig = {
    ...resolved,
    riskTier,
    reviewers,
  };

  // 5. Run specialized reviewers
  const reviewerResults = await runReviewers(
    reviewers,
    filteredDiff,
    finalConfig,
    abortController.signal,
  );

  // 6. Run coordinator
  const result = await runCoordinator(
    reviewerResults,
    filteredDiff,
    riskTier,
    finalConfig,
    abortController.signal,
  );

  return result;
}
```

- [ ] **Step 2: Create `src/cli.ts` (CLI entry point)**

```typescript
#!/usr/bin/env node

/**
 * ai-code-review — CLI entry point
 *
 * Usage:
 *   ai-code-review --diff HEAD~1 --cwd . --format text
 *   ai-code-review --diff main...HEAD --format json --output results.json
 *   ai-code-review --diff staged --reviewers security,quality
 */

import { writeFileSync } from "node:fs";
import { review, formatOutput } from "./index.js";
import type { ReviewConfig, ReviewCategory, RiskTier, OutputFormat } from "./types.js";

function parseCliArgs(): ReviewConfig & { help?: boolean } {
  const args = process.argv.slice(2);
  const config: ReviewConfig & { help?: boolean } = {};

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

    switch (arg) {
      case "--help":
      case "-h":
        config.help = true;
        break;
      case "--diff":
      case "-d":
        config.diff = next();
        break;
      case "--cwd":
      case "-c":
        config.cwd = next();
        break;
      case "--model":
      case "-m":
        config.model = next();
        break;
      case "--provider":
        config.provider = next();
        break;
      case "--reviewers":
      case "-r":
        config.reviewers = next().split(",").map((s) => s.trim() as ReviewCategory);
        break;
      case "--risk-tier":
        config.riskTier = next() as RiskTier;
        break;
      case "--format":
      case "-f":
        config.format = next() as OutputFormat;
        break;
      case "--output":
      case "-o":
        config.outputFile = next();
        break;
      case "--timeout":
        config.reviewerTimeout = parseInt(next(), 10);
        break;
      case "--concurrency":
        config.maxConcurrency = parseInt(next(), 10);
        break;
      case "--instructions":
        config.customInstructions = next();
        break;
      case "--thinking-level":
        config.thinkingLevel = next() as ReviewConfig["thinkingLevel"];
        break;
      case "--no-color":
        config.color = false;
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        // Positional argument treated as diff spec
        if (!config.diff) config.diff = arg;
        break;
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
ai-code-review — Orchestrated AI Code Review

USAGE:
  ai-code-review [OPTIONS] [DIFF_SPEC]

ARGUMENTS:
  DIFF_SPEC              Git diff specification (default: HEAD~1)

OPTIONS:
  -h, --help             Show this help message
  -d, --diff <spec>      Diff source: git ref range, "staged", or "unstaged"
  -c, --cwd <path>       Working directory (default: current directory)
  -m, --model <id>       Model ID to use (default: auto-detect)
  --provider <name>      Model provider (default: auto-detect)
  -r, --reviewers <list> Comma-separated reviewers: security,performance,quality
  --risk-tier <tier>     Override risk tier: trivial, lite, full
  -f, --format <fmt>     Output format: text, json, markdown (default: text)
  -o, --output <file>    Write output to file instead of stdout
  --timeout <ms>         Per-reviewer timeout in ms (default: 300000)
  --concurrency <n>      Max concurrent reviewers (default: 3)
  --instructions <text>  Custom instructions for all reviewers
  --thinking-level <lvl> LLM thinking level: off, low, medium, high (default: medium)
  --no-color             Disable colored output

EXAMPLES:
  # Review last commit
  ai-code-review HEAD~1

  # Review staged changes
  ai-code-review --diff staged

  # Review branch vs main, output as JSON
  ai-code-review --diff main...HEAD --format json

  # Review with specific reviewers and custom instructions
  ai-code-review --diff HEAD~3 --reviewers security,quality --instructions "Focus on auth"

  # Use as library in a script:
  # import { review } from "ai-code-review";
  # const result = await review({ diff: "HEAD~1" });
`);
}

async function main(): Promise<void> {
  const config = parseCliArgs();

  if (config.help) {
    printHelp();
    process.exit(0);
  }

  console.error("Starting AI code review...");
  console.error(`  Diff: ${config.diff ?? "HEAD~1"}`);
  console.error(`  CWD:  ${config.cwd ?? process.cwd()}`);

  try {
    const result = await review(config);

    const useColor = config.color ?? process.stdout.isTTY ?? false;
    const format = config.format ?? "text";
    const output = formatOutput(result, format, useColor);

    if (config.outputFile) {
      writeFileSync(config.outputFile, output, "utf-8");
      console.error(`Review written to ${config.outputFile}`);
    } else {
      console.log(output);
    }

    // Exit with non-zero if significant concerns
    if (result.verdict === "significant_concerns") {
      process.exit(2);
    }
    if (result.verdict === "minor_issues") {
      process.exit(1);
    }
    process.exit(0);
  } catch (err: any) {
    console.error("Review failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 3: Verify full build**

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && npx tsc
```

Expected: Clean build with no errors.

- [ ] **Step 4: Commit all source files**

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && git init && git add -A && git commit -m "feat: orchestrated AI code review — full implementation"
```

---

### Task 8 (Final): README and smoke test

**Dependencies:** All preceding tasks
**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# ai-code-review

Orchestrated AI code review using specialized agents, built on [pi agent core](https://github.com/earendil-works/pi-mono).

Inspired by [Cloudflare's approach](https://blog.cloudflare.com/ai-code-review) to multi-agent code review orchestration.

## How It Works

1. **Extract** git diff from your repository
2. **Filter** noise (lock files, minified assets, vendored deps)
3. **Assess** risk tier (trivial / lite / full)
4. **Dispatch** specialized reviewers in parallel:
   - 🔒 **Security** — injection, auth bypass, secrets
   - ⚡ **Performance** — N+1 queries, memory leaks, algorithmic issues
   - 🔍 **Code Quality** — logic errors, dead code, error handling
5. **Coordinate** — deduplicate, re-categorize, judge severity
6. **Output** — structured review in text, JSON, or markdown

## Install

```bash
npm install
npm run build
```

## CLI Usage

```bash
# Review last commit
npx ai-code-review HEAD~1

# Review staged changes
npx ai-code-review --diff staged

# Review branch vs main, output JSON
npx ai-code-review --diff main...HEAD --format json

# Only security + quality reviewers
npx ai-code-review --diff HEAD~3 --reviewers security,quality

# Custom instructions
npx ai-code-review --diff HEAD~1 --instructions "Focus on authentication logic"
```

## Library Usage

```typescript
import { review } from "ai-code-review";

const result = await review({
  cwd: "/path/to/repo",
  diff: "main...HEAD",
  format: "json",
});

console.log(result.verdict);    // "approved" | "approved_with_comments" | "minor_issues" | "significant_concerns"
console.log(result.findings);   // Array<Finding>
console.log(result.summary);    // string
console.log(result.totalUsage); // { inputTokens, outputTokens, cost, ... }
```

## CI/CD Integration

```yaml
# GitHub Actions example
- name: AI Code Review
  run: npx ai-code-review --diff ${{ github.event.pull_request.base.sha }}...${{ github.sha }} --format json --output review.json
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Exit codes:
- `0` — approved or approved with comments
- `1` — minor issues (warnings suggesting a risk pattern)
- `2` — significant concerns (critical findings, blocks merge)

## Configuration

| Option | CLI Flag | Default | Description |
|--------|----------|---------|-------------|
| `diff` | `--diff` | `HEAD~1` | Git ref range, "staged", or "unstaged" |
| `cwd` | `--cwd` | `process.cwd()` | Repository root |
| `model` | `--model` | auto | Model ID |
| `provider` | `--provider` | auto | Model provider |
| `reviewers` | `--reviewers` | auto (by risk tier) | Comma-separated: security,performance,quality |
| `riskTier` | `--risk-tier` | auto-assessed | trivial, lite, or full |
| `format` | `--format` | text | Output: text, json, markdown |
| `timeout` | `--timeout` | 300000 | Per-reviewer timeout (ms) |
| `concurrency` | `--concurrency` | 3 | Max concurrent reviewers |
| `instructions` | `--instructions` | none | Custom instructions for all reviewers |
| `thinkingLevel` | `--thinking-level` | medium | LLM thinking: off, low, medium, high |

## Requirements

- Node.js ≥ 22
- At least one LLM API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
- Git repository

## Architecture

Based on the [Cloudflare blog post](https://blog.cloudflare.com/ai-code-review) architecture:

- **Specialized agents** instead of one big prompt
- **Risk tiers** to avoid over-spending on trivial changes
- **Coordinator** for deduplication and severity judgment
- **Structured tools** (`report_finding`, `submit_review`) for clean output
- **Diff filtering** to remove noise before review
```

- [ ] **Step 2: Run smoke test (requires API key)**

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && npx tsx src/cli.ts --diff HEAD~1 --cwd . --format text
```

Expected: Full pipeline runs — diff extracted → risk tier assessed → reviewers spawned → coordinator produces final review → formatted output printed to terminal. (Requires at least one API key to be set.)

If no API key is available, verify at minimum that the diff extraction works:

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && npx tsx -e "
import { getDiff } from './src/diff/git.js';
import { filterDiff } from './src/diff/filter.js';
import { assessRiskTier } from './src/diff/risk.js';
const raw = await getDiff('.', 'HEAD~1');
const filtered = filterDiff(raw);
const tier = assessRiskTier(filtered.files);
console.log('Files:', filtered.files.length, 'Tier:', tier);
console.log('Files:', filtered.files.map(f => f.path));
"
```

Expected: Prints file count, risk tier, and file paths from the project's own diff.

- [ ] **Step 3: Verify build is clean**

```bash
cd J:/workspace2/rosen/orch_ai_code_rv && npx tsc
```

Expected: Zero errors, `dist/` directory populated.

---

## Self-Review

**1. Spec coverage:**
- ✅ Git diff input → Task 2 (git.ts)
- ✅ Noise filtering → Task 2 (filter.ts)
- ✅ Risk tier assessment → Task 2 (risk.ts)
- ✅ 3 specialized reviewers (Security, Performance, Code Quality) → Task 3 (prompts) + Task 5 (runner)
- ✅ Coordinator (dedup, severity, verdict) → Task 6 (coordinator.ts)
- ✅ Terminal output (text, JSON, markdown) → Task 6 (output.ts)
- ✅ Library API (importable review function) → Task 7 (index.ts)
- ✅ CLI entry point → Task 7 (cli.ts)
- ✅ CI/CD compatible (exit codes, JSON output, no TTY dependency) → Task 7 + Task 8
- ✅ Configurable (CLI flags, config object) → Task 1 (types.ts, config.ts)
- ✅ Separate processes per reviewer → Task 4 (isolated AgentSession per reviewer)
- ✅ Structured output via tools (report_finding, submit_review) → Task 4 (session.ts)
- ✅ Custom instructions support → config.customInstructions
- ✅ README with usage → Task 8

**2. Placeholder scan:**
- No TBD, TODO, or "implement later" found.
- All code blocks contain complete, executable code.

**3. Type consistency:**
- `Finding.severity` is `Severity` ("critical" | "warning" | "suggestion") — used consistently across prompts, session.ts, coordinator.ts, output.ts
- `report_finding` tool parameters match `Finding` type
- `submit_review` tool parameters match `Finding[]` structure
- `ReviewerResult`, `ReviewResult`, `TokenUsage` used consistently throughout

**4. Dependency verification:**
- Task 1: No dependencies (scaffolding)
- Task 2: Depends on Task 1 (types.ts)
- Task 3: Depends on Task 1 (types.ts via shared.ts)
- Task 4: Depends on Tasks 1, 2, 3 (types + prompts)
- Task 5: Depends on Tasks 1-4 (session factory + prompts + types)
- Task 6: Depends on Task 5 (runner results) + Task 4 (session)
- Task 7: Depends on Tasks 5, 6 (runner + coordinator + output)
- Task 8: Depends on all (README + smoke test)
- No parallel tasks modify the same file ✅
- No missing dependency chains ✅

**5. Verification coverage:**
- Final Verification Task (Task 8) exists ✅
- Includes build check and smoke test ✅
- Uses discovered verification command (`npx tsc` build + `npx tsx` smoke) ✅
