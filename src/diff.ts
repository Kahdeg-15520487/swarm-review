import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import type { DiffEntry, RiskTier, ResolvedConfig } from "./types.js";

// Use bash shell for execSync on Windows (Git Bash) to support Unix syntax

const SECURITY_SENSITIVE_PATTERNS = [
  "auth/", "crypto/", "oauth", "jwt", "session",
  "password", "credential", "token", "secret",
  "certificate", "ssl", "tls", "encrypt", "decrypt",
  "permission", "rbac", "acl", "authentication",
  "authorization", "saml", "oidc", "csrf", "cors",
  "xss", "sanitize",
];

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

export function detectGitInfo(cwd?: string): GitInfo {
  const dir = cwd ?? process.cwd();
  const repoRoot = execSync("git rev-parse --show-toplevel", { cwd: dir }).toString().trim();
  const branch = execSync("git branch --show-current", { cwd: repoRoot }).toString().trim();
  const status = execSync("git status --porcelain", { cwd: repoRoot }).toString().trim();
  return { repoRoot, branch, hasUncommitted: status.length > 0 };
}

export function detectDiff(config: {
  repoRoot: string;
  branch: string;
  hasUncommitted: boolean;
  swarmDir: string;
}): { diffPath: string; description: string } {
  const { repoRoot, branch, hasUncommitted, swarmDir } = config;
  const diffPath = resolve(swarmDir, "diff.patch");

  if (hasUncommitted) {
    execSync("git diff > \"" + diffPath + "\"", { cwd: repoRoot });
    return { diffPath, description: "Uncommitted changes (working tree diff)" };
  }

  if (branch !== "master" && branch !== "main") {
    try {
      const base = execSync("git merge-base HEAD master", { cwd: repoRoot }).toString().trim();
      execSync("git diff \"" + base + "\" HEAD > \"" + diffPath + "\"", { cwd: repoRoot });
      return { diffPath, description: "Commits since diverging from master" };
    } catch {
      try {
        const base = execSync("git merge-base HEAD main", { cwd: repoRoot }).toString().trim();
        execSync("git diff \"" + base + "\" HEAD > \"" + diffPath + "\"", { cwd: repoRoot });
        return { diffPath, description: "Commits since diverging from main" };
      } catch {
        execSync("git diff HEAD~1 HEAD > \"" + diffPath + "\"", { cwd: repoRoot });
        return { diffPath, description: "Last commit (fallback)" };
      }
    }
  }

  execSync("git diff HEAD~1 HEAD > \"" + diffPath + "\"", { cwd: repoRoot });
  return { diffPath, description: "Last commit" };
}

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
            currentFile.replace(/\\\\/g, "/").includes(p)
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

  if (currentFile) {
    entries.push({
      path: currentFile,
      addedLines: added,
      removedLines: removed,
      isSecuritySensitive: SECURITY_SENSITIVE_PATTERNS.some((p) =>
        currentFile.replace(/\\\\/g, "/").includes(p)
      ),
    });
  }

  return entries;
}

export function isNoiseFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\\\/g, "/");
  const name = normalized.split("/").pop() ?? "";
  if (NOISE_FILES.has(name)) return true;
  if (NOISE_DIRS.some((d) => normalized.includes("/" + d + "/") || normalized.startsWith(d + "/"))) return true;
  for (const ext of NOISE_EXTENSIONS) {
    if (name.endsWith(ext)) return true;
  }
  return false;
}

export function assessRiskTier(entries: DiffEntry[]): RiskTier {
  const totalLines = entries.reduce((s, e) => s + e.addedLines + e.removedLines, 0);
  const fileCount = entries.length;
  const hasSecurityFiles = entries.some((e) => e.isSecuritySensitive);
  if (fileCount > 50 || hasSecurityFiles) return "full";
  if (totalLines <= 10 && fileCount <= 20) return "trivial";
  if (totalLines <= 100 && fileCount <= 20) return "lite";
  return "full";
}

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
  return tierMap[tier].map((name) => ({ name, ...all[name] }));
}

export function createSwarmDir(repoRoot: string): string {
  const swarmDir = resolve(repoRoot, ".swarm-review", "reports");
  mkdirSync(swarmDir, { recursive: true });
  return resolve(repoRoot, ".swarm-review");
}

export function filterDiff(diffText: string): string {
  const lines = diffText.split("\n");
  const filtered: string[] = [];
  let skipBlock = false;
  for (const line of lines) {
    const headerMatch = line.match(/^diff --git a\/(.+?) b\//);
    if (headerMatch) skipBlock = isNoiseFile(headerMatch[1]);
    if (!skipBlock) filtered.push(line);
  }
  return filtered.join("\n");
}

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
