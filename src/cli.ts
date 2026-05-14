#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runSwarmReview } from "./orchestrator.js";

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      "custom-instructions": { type: "string", short: "c" },
      "keep-temp": { type: "boolean", short: "k", default: false },
      output: { type: "string", short: "o" },
      tier: { type: "string", short: "t" },
      diff: { type: "string", short: "d" },
      repo: { type: "string", short: "r" },
      ci: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
swarm-review — AI code review swarm

USAGE:
  swarm-review                      Auto-detect context and review
  swarm-review --diff path.patch    Review a specific diff file
  swarm-review --ci                 CI mode (JSON output, no prompts)

OPTIONS:
  -h, --help                 Show this help
  -c, --custom-instructions  Custom instructions for all reviewers
  -k, --keep-temp            Keep .swarm-review/ temp files after run
  -o, --output <path>        Write final review to <path> (default: review-result.md)
  -t, --tier <tier>          Override risk tier (trivial | lite | full)
  -d, --diff <path>          Path to a diff file (skips auto-detection)
  -r, --repo <path>          Repository root (default: auto-detected from cwd)
  --ci                        CI mode — JSON output to stdout

EXAMPLES:
  swarm-review                                # Auto-detect & review
  swarm-review --diff my.patch                # Review a specific patch
  swarm-review --custom-instructions "focus on auth"  # Custom focus
  swarm-review --ci                           # JSON output for CI

AUTO-DETECTION:
  • Uncommitted changes → review working tree diff
  • On a feature branch → review commits since diverging from master/main
  • On master/main       → review last commit
`);
    process.exit(0);
  }

  const cwd = process.cwd();

  // If --diff provided, read it explicitly
  const config = values.diff
    ? {
        repoRoot: values.repo ?? cwd,
        diffPath: values.diff,
        branch: "unknown",
        tier: (values.tier as any) ?? "full",
      }
    : undefined;

  try {
    const { resultPath } = await runSwarmReview({
      cwd,
      config: config as any,
      customInstructions: values["custom-instructions"],
      keepTemp: values["keep-temp"],
      outputPath: values.output,
      onProgress: values.ci ? undefined : (msg) => console.error(msg),
    });

    if (values.ci) {
      const content = readFileSync(resultPath, "utf-8");
      const result = {
        status: "completed",
        resultPath,
        summary: content.slice(0, 500),
      };
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n✅ Review complete → ${resultPath}`);
    }

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Review failed: ${err}`);
    process.exit(1);
  }
}

main();
