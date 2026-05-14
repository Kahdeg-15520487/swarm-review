import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, basename, sep } from "node:path";
import type { DiffEntry, RiskTier, ResolvedConfig } from "./types.js";

/** Security-sensitive patterns from config/risk-tiers.json */
const SECURITY_SENSITIVE_PATTERNS = [
  "auth/", "crypto/", "oauth", "jwt", "session",
  "password", "credential", "token", "secret",
  "certificate", "ssl", "tls", "encrypt", "decrypt",
  "permission", "rbac", "acl", "authentication",
  "authorization", "saml", "oidc", "csrf", "cors",
  "xss", "sanitize",
];

/** Noise file patterns from config/diff-filters.json */
const NOISE_FILES = new Set([
  "bun.lock", "package-lock.json", "yarn.lock",
  "pnpm-lock.yaml", "Cargo.lock", "go.sum",
  "poetry.lock", "Pipfile.lock", "flake.lock",
  "composer.lock", "Gemfile.lock", "mix.lock",
]);

const NOISE_EXTENSIONS = [".min.js", ".min.css", ".bundle.js", ".map"];

const NOISE_DIRS = ["node_modules", ".git", "dist", "build", ".next", "target", "vendor", "__pycache__"];

interface GitInfo {
  repoRoot: string;
  branch: string;
  hasUncommitted: boolean;
}

/** Detect git repository info from cwd */
export function detectGitInfo(cwd?: string): GitInfo {
  const dir = cwd ?? process.cwd();
  const repoRoot = execSync("git rev-parse --show-toplevel", { cwd: dir }).toString().trim();
  const branch = execSync("git branch --show-current", { cwd: repoRoot }).toString().trim();
  const status = execSync("git status --porcelain", { cwd: repoRoot }).toString().trim();
  return { repoRoot, branch, hasUncommitted: status.length > 0 };
}

/**
 * Auto-detect review target and produce a diff patch.
 * Returns the path to the generated diff.patch inside swarmDir.
 */
export function detectDiff(config: {
  repoRoot: string;
  branch: string;
  hasUncommitted: boolean;
  swarmDir: string;
}): { diffPath: string; description: string } {
  const { repoRoot, branch, hasUncommitted, swarmDir } = config;
  const diffPath = resolve(swarmDir, "diff.patch");

  if (hasUncommitted) {
    execSync(`git diff > "${diffPath}"`, { cwd: repoRoot });
    return { diffPath, description: "Uncommitted changes (working tree diff)" };
  }

  if (branch !== "master" && branch !== "main") {
    // Diff against merge-base with master or main
    try {
      const base = execSync(
        `git merge-base HEAD master 2>/dev/null || git merge-base HEAD main`,
        { cwd: repoRoot }
      ).toString().trim();
      execSync(`git diff "${base}" HEAD > "${diffPath}"`, { cwd: repoRoot });
      return { diffPath, description: `Commits since diverging from ${basename(base)}` };
    } catch {
      // Fallback: diff against parent
      execSync(`git diff HEAD~1 HEAD > "${diffPath}"`, { cwd: repoRoot });
      return { diffPath, description: "Last commit (fallback)" };
    }
  }

  // On master/main: review last commit
  execSync(`git diff HEAD~1 HEAD > "${diffPath}"`, { cwd: repoRoot });
  return { diffPath, description: "Last commit" };
}

/** Parse a unified diff into per-file entries */
export function parseDiffEntries(diffText: string): DiffEntry[] {
  const entries: DiffEntry[] = [];
  let currentFile = "";
  let added = 0;
  let removed = 0;

  for (const line of diffText.split("\n")) {
    const headerMatch = line.match(/^diff --git a\/(.+?) b\//);
    if (headerMatch) {
      if (currentFile) {
        entries.push({
          path: currentFile,
          addedLines: added,
          removedLines: removed,
          isSecuritySensitive: SECURITY_SENSITIVE_PATTERNS.some((p) =>
            currentFile.replace(/\\/g, "/").includes(p)
          ),
        });
      }
      currentFile = headerMatch[1];
      added = 0;
      removed = 0;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }

  // Push last entry
  if (currentFile) {
    entries.push({
      path: currentFile,
      addedLines: added,
      removedLines: removed,
      isSecuritySensitive: SECURITY_SENSITIVE_PATTERNS.some((p) =>
        currentFile.replace(/\\/g, "/").includes(p)
      ),
    });
  }

  return entries;
}

/** Check if a file path is noise and should be filtered out */
export function isNoiseFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const name = normalized.split("/").pop() ?? "";

  if (NOISE_FILES.has(name)) return true;
  if (NOISE_DIRS.some((d) => normalized.includes(`/${d}/`) || normalized.startsWith(`${d}/`))) return true;

  for (const ext of NOISE_EXTENSIONS) {
    if (name.endsWith(ext)) return true;
  }

  // Check for generated file markers (first 5 lines)
  try {
    const content = readFileSync(filePath, "utf-8").split("\n").slice(0, 5).join("\n");
    if (
      content.includes("@generated") ||
      content.includes("DO NOT EDIT") ||
      content.includes("auto-generated") ||
      content.includes("This file is generated")
    ) {
      // Exception: database migrations
      if (normalized.includes("migration") || normalized.includes("migrations")) {
        return false;
      }
      return true;
    }
  } catch {
    // File doesn't exist or can't be read — not noise
  }

  return false;
}

/** Assess risk tier from diff entries */
export function assessRiskTier(entries: DiffEntry[]): RiskTier {
  const totalLines = entries.reduce((s, e) => s + e.addedLines + e.removedLines, 0);
  const fileCount = entries.length;
  const hasSecurityFiles = entries.some((e) => e.isSecuritySensitive);

  if (fileCount > 50 || hasSecurityFiles) return "full";
  if (totalLines <= 10 && fileCount <= 20) return "trivial";
  if (totalLines <= 100 && fileCount <= 20) return "lite";
  return "full";
}

/** Select reviewers based on risk tier */
export function selectReviewers(tier: RiskTier): Array<{
  name: string;
  promptFile: string;
  domain: string;
}> {
  const all: Record<string, { promptFile: string; domain: string }> = {
    "code-quality": { promptFile: "prompts/code-quality.md", domain: "code_quality" },
    security: { promptFile: "prompts/security.md", domain: "security" },
    performance: { promptFile: "prompts/performance.md", domain: "performance" },
    documentation: { promptFile: "prompts/documentation.md", domain: "documentation" },
    codex: { promptFile: "prompts/codex.md", domain: "compliance" },
    "agents-md": { promptFile: "prompts/agents-md.md", domain: "agents_md" },
    release: { promptFile: "prompts/release.md", domain: "release" },
  };

  const tierMap: Record<RiskTier, string[]> = {
    trivial: ["code-quality"],
    lite: ["code-quality", "documentation", "agents-md"],
    full: ["code-quality", "security", "performance", "documentation", "codex", "agents-md", "release"],
  };

  return tierMap[tier].map((name) => ({
    name,
    ...all[name],
  }));
}

/** Create the .swarm-review directory structure */
export function createSwarmDir(repoRoot: string): string {
  const swarmDir = resolve(repoRoot, ".swarm-review", "reports");
  mkdirSync(swarmDir, { recursive: true });
  return resolve(repoRoot, ".swarm-review");
}

/** Filter diff to remove noise files */
export function filterDiff(diffText: string): string {
  const lines = diffText.split("\n");
  const filtered: string[] = [];
  let skipBlock = false;

  for (const line of lines) {
    const headerMatch = line.match(/^diff --git a\/(.+?) b\//);
    if (headerMatch) {
      skipBlock = isNoiseFile(headerMatch[1]);
    }
    if (!skipBlock) {
      filtered.push(line);
    }
  }

  return filtered.join("\n");
}

/**
 * Full auto-detection flow: detect git context, create swarm dir,
 * produce diff, assess risk, return ResolvedConfig.
 */
export async function autoDetectConfig(cwd?: string): Promise<ResolvedConfig> {
  const git = detectGitInfo(cwd);
  const swarmDir = createSwarmDir(git.repoRoot);
  const { diffPath, description } = detectDiff({ ...git, swarmDir });

  const diffText = readFileSync(diffPath, "utf-8");
  const filteredDiff = filterDiff(diffText);
  writeFileSync(diffPath, filteredDiff);

  const entries = parseDiffEntries(filteredDiff);
  const tier = assessRiskTier(entries);

  return {
    repoRoot: git.repoRoot,
    diffPath,
    branch: git.branch,
    tier,
  };
}
