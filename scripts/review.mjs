#!/usr/bin/env node

/**
 * swarm-review — CI-friendly wrapper with real-time progress streaming
 *
 * Uses the library API directly with an onEvent callback to stream progress
 * to stderr, so CI pipelines see visible output during the review.
 *
 * Usage:
 *   node scripts/review.mjs --diff HEAD~1 --format markdown
 *   node scripts/review.mjs --diff main...HEAD --format json --output results.json
 *   node scripts/review.mjs --diff staged --session-log trace.jsonl
 */

import { writeFileSync } from "node:fs";

// Local import — resolves to the repo's built dist/
// The CI workflow builds before running this script.
import { review, formatOutput } from "../dist/index.js";

// ── Progress formatting ──

function timestamp() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
}

function progress(msg) {
  process.stderr.write(`[${timestamp()}] [swarm-review] ${msg}\n`);
}

// ── CLI args ──

function parseArgs() {
  const args = process.argv.slice(2);
  const config = { help: false };

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
        config.reviewers = next().split(",").map((s) => s.trim());
        break;
      case "--risk-tier":
        config.riskTier = next();
        break;
      case "--format":
      case "-f":
        config.format = next();
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
        config.thinkingLevel = next();
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

function printHelp() {
  console.log(`
swarm-review — CI-friendly review runner with streaming progress

USAGE:
  node scripts/review.mjs [OPTIONS] [DIFF_SPEC]

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
  --session-log <file>   Write full session trace as JSONL
  --timeout <ms>         Per-reviewer timeout in ms (default: 300000)
  --concurrency <n>      Max concurrent reviewers (default: 3)
  --instructions <text>  Custom instructions for all reviewers
  --thinking-level <lvl> LLM thinking level: off, low, medium, high
  --no-color             Disable colored output
`);
}

// ── Main ──

async function main() {
  const config = parseArgs();

  if (config.help) {
    printHelp();
    process.exit(0);
  }

  const diffSpec = config.diff ?? "HEAD~1";
  progress(`Starting review (diff: ${diffSpec})`);
  progress(`Reviewers: ${(config.reviewers ?? ["security", "performance", "quality"]).join(", ")}`);

  // Wire up onEvent for real-time progress streaming
  let activeReviewer = null;
  let reviewerFindings = 0;
  let coordinatorStarted = false;

  config.onEvent = (source, event) => {
    switch (event.type) {
      case "agent_start":
        if (source === "coordinator") {
          progress(`🔄 Coordinator is working...`);
          coordinatorStarted = true;
        } else {
          activeReviewer = source;
          reviewerFindings = 0;
          progress(`▶️  ${source} reviewer started`);
        }
        break;

      case "agent_end":
        if (source === "coordinator") {
          progress(`✅ Coordinator finished`);
        } else {
          // findings count will be known from tool results, but we report on agent_end
        }
        break;

      case "tool_execution_start":
        if (event.toolName === "report_finding" && !coordinatorStarted) {
          reviewerFindings++;
        }
        break;

      case "tool_execution_end":
        if (event.toolName === "submit_review" && source === "coordinator") {
          // Coordinator submitted — nearly done
        }
        if (event.toolName === "report_finding" && event.isError) {
          progress(`  ⚠️  ${source}: finding tool error`);
        }
        break;
    }
  };

  try {
    const result = await review(config);

    const findingsCount = result.findings.length;
    progress(`✅ Review complete — verdict: ${result.verdict} (${findingsCount} findings, ${(result.durationMs / 1000).toFixed(1)}s)`);

    const useColor = config.color ?? process.stdout.isTTY ?? false;
    const format = config.format ?? "text";
    const output = formatOutput(result, format, useColor);

    if (config.outputFile) {
      writeFileSync(config.outputFile, output, "utf-8");
      progress(`Output written to ${config.outputFile}`);
    } else {
      console.log(output);
    }

    // Exit codes matching swarm-review CLI convention
    if (result.verdict === "significant_concerns") {
      process.exit(2);
    }
    if (result.verdict === "minor_issues") {
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    progress(`❌ Review failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
