#!/usr/bin/env node

/**
 * swarm-review — CLI entry point
 *
 * Usage:
 *   swarm-review --diff HEAD~1 --cwd . --format text
 *   swarm-review --diff main...HEAD --format json --output results.json
 *   swarm-review --diff staged --reviewers security,quality
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
      case "--session-log":
        config.sessionLog = next();
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
    if (!config.diff) config.diff = arg;
        break;
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
swarm-review — 

USAGE:
  swarm-review [OPTIONS] [DIFF_SPEC]

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
  --session-log <file>   Write full session trace as JSONL
  --no-color             Disable colored output

EXAMPLES:
  # Review last commit
  swarm-review HEAD~1

  # Review staged changes
  swarm-review --diff staged

  # Review branch vs main, output as JSON
  swarm-review --diff main...HEAD --format json

  # Review with specific reviewers and custom instructions
  swarm-review --diff HEAD~3 --reviewers security,quality --instructions "Focus on auth"

  # Use as library in a script:
  # import { review } from "swarm-review";
  # const result = await review({ diff: "HEAD~1" });
`);
}

async function main(): Promise<void> {
  const config = parseCliArgs();

  if (config.help) {
    printHelp();
    process.exit(0);
  }

  console.error("Starting swarm review...");
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
