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
      "model": { type: "string", short: "m" },
      "provider": { type: "string", short: "p" },
      ci: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
swarm-review — AI code review swarm

USAGE:
  swarm-review                            Auto-detect context and review
  swarm-review -C /path/to/repo           Review another directory
  swarm-review -m deepseek-v4-flash -p deepseek   Custom model
  swarm-review --ci                       CI mode (JSON output)

OPTIONS:
  -h, --help                 Show this help
  -C, --cwd <path>           Working directory (default: current dir)
  -c, --custom-instructions  Custom instructions for all reviewers
  -k, --keep-temp            Keep .swarm-review/ temp files
  -o, --output <path>        Write final review to <path> (default: review-result.md)
  -t, --tier <tier>          Override risk tier (trivial | lite | full)
  -d, --diff <path>          Path to a diff file (skips auto-detection)
  -m, --model <id>           Model ID (default: claude-sonnet-4)
  -p, --provider <name>      Model provider (default: anthropic)
  --ci                        CI mode — JSON output

EXAMPLES:
  swarm-review                                # Current dir, auto-detect
  swarm-review -C ~/projects/my-app           # Another repo
  swarm-review -p deepseek -m deepseek-v4-flash  # Custom model
  swarm-review --ci                           # JSON for pipelines

Set <PROVIDER>_API_KEY env var (e.g. ANTHROPIC_API_KEY, DEEPSEEK_API_KEY).
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
      provider: values.provider,
      model: values.model,
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
