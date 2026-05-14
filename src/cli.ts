#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runSwarmReview } from "./orchestrator.js";

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h", default: false },
      "custom-instructions": { type: "string", short: "c" },
      "keep-temp": { type: "boolean", short: "k", default: false },
      output: { type: "string", short: "o" },
      tier: { type: "string", short: "t" },
      diff: { type: "string", short: "d" },
      "cwd": { type: "string", short: "C" },
      ci: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
swarm-review — AI code review swarm

USAGE:
  swarm-review                      Auto-detect context and review (current dir)
  swarm-review -C /path/to/repo     Auto-detect in another directory
  swarm-review --diff path.patch    Review a specific diff file
  swarm-review --ci                 CI mode (JSON output)

OPTIONS:
  -h, --help                 Show this help
  -C, --cwd <path>           Working directory (default: current dir)
  -c, --custom-instructions  Custom instructions for all reviewers
  -k, --keep-temp            Keep .swarm-review/ temp files
  -o, --output <path>        Write final review to <path> (default: review-result.md)
  -t, --tier <tier>          Override risk tier (trivial | lite | full)
  -d, --diff <path>          Path to a diff file (skips auto-detection)
  --ci                        CI mode — JSON output

EXAMPLES:
  swarm-review                                # Current directory
  swarm-review -C ~/projects/my-app           # Another repo
  swarm-review -C ~/projects/my-app --diff HEAD~3
  swarm-review --diff my.patch                # Specific patch file
  swarm-review --ci                           # JSON for pipelines
`);
    process.exit(0);
  }

  const cwd = values.cwd ?? process.cwd();

  try {
    const { resultPath } = await runSwarmReview({
      cwd,
      customInstructions: values["custom-instructions"],
      keepTemp: values["keep-temp"],
      outputPath: values.output,
      onProgress: values.ci ? undefined : (msg) => console.error(msg),
    });

    if (values.ci) {
      const content = readFileSync(resultPath, "utf-8");
      const result = { status: "completed", resultPath, summary: content.slice(0, 500) };
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
