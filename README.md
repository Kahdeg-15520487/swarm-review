# Swarm Review

Orchestrated AI code review using specialized agents.

Dispatches specialized reviewers in parallel, then a coordinator deduplicates findings and produces a final verdict. Inspired by [Cloudflare's approach](https://blog.cloudflare.com/ai-code-review) to multi-agent code review.

**[See it in action →](https://github.com/Kahdeg-15520487/swarm-review/pull/1)** — a PR with intentionally buggy code, reviewed automatically by Swarm Review.

## Installation

There are two ways to use Swarm Review: as a **standalone CLI** (npm package) or as an **agentic skill** loaded into your AI coding assistant.

### npm CLI

```bash
npm install -g swarm-review
```

Then run it against any git ref:

```bash
swarm-review HEAD~1 --model deepseek-v4-flash --provider deepseek
```

### Agentic Skill

The skill is a **single file: [`SKILL.md`](./SKILL.md)**. Copy it to the right location for your harness:

| Harness | Where to put `SKILL.md` | How to invoke |
|---------|------------------------|---------------|
| **pi coding agent** | `~/.pi/agent/skills/swarm-review/SKILL.md` | *"swarm review"* or `/skill:swarm-review` |
| **Claude Code** | Rename to `AGENTS.md` in your repo root | *"run a swarm review"* |
| **opencode** | Rename to `AGENTS.md` in your repo root | *"swarm review"* |
| **Copilot CLI** | `~/.agents/skills/swarm-review/SKILL.md` | *"swarm review"* |

#### One-liner installs

```bash
# pi coding agent
mkdir -p ~/.pi/agent/skills/swarm-review
curl -o ~/.pi/agent/skills/swarm-review/SKILL.md \
  https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/SKILL.md

# Claude Code / opencode (add to your project)
curl -o AGENTS.md \
  https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/SKILL.md

# Copilot CLI
mkdir -p ~/.agents/skills/swarm-review
curl -o ~/.agents/skills/swarm-review/SKILL.md \
  https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/SKILL.md
```

## Two Components

| Component | What it is | Reviewers | Prompt source |
|-----------|-----------|-----------|--------------|
| **npm package** | Standalone CLI + TypeScript library | 3 (security, performance, quality) | `src/` — tool-calling format (`report_finding` tool) |
| **`SKILL.md` skill** | Single-file skill for agentic coding assistants | 7 (all of the above + documentation, codex, AGENTS.md, release) | `SKILL.md` — all reviewer prompts embedded inline |

Both implement the same reviewing philosophy. They differ in output mechanism: the CLI uses a structured tool-calling API (`report_finding`) fed by the pi-agent-core framework; the agentic skill writes plain markdown findings that the coordinator reads as text. The reviewer prompts are **not shared** between the two — changes to reviewer logic need to be applied to both.

## How It Works

1. Extract git diff from your repository
2. Filter noise (lock files, minified assets, vendored deps)
3. Assess risk tier (trivial / lite / full)
4. Dispatch specialized reviewers in parallel:
   - **Security** — injection, auth bypass, secrets
   - **Performance** — N+1 queries, memory leaks, algorithmic issues
   - **Code Quality** — logic errors, dead code, error handling
   - **Documentation** — missing/outdated docs, incorrect API docs *(skill only)*
   - **Engineering Codex** — internal compliance and standards *(skill only)*
   - **AGENTS.md** — checks AI context file currency *(skill only)*
   - **Release** — changelogs, version bumps, breaking changes *(skill only)*
5. Coordinator deduplicates, re-categorizes, judges severity
6. Output structured review in text, JSON, or markdown

## npm CLI Usage

```bash
# Install globally
npm install -g swarm-review
# or use directly
npx swarm-review HEAD~1 --model deepseek-v4-flash --provider deepseek
```

```bash
# Set your API key
export DEEPSEEK_API_KEY=sk-...

# Review last commit
npx swarm-review HEAD~1 --model deepseek-v4-flash --provider deepseek

# Review staged changes
npx swarm-review --diff staged --model deepseek-v4-flash --provider deepseek

# Review branch vs main, output JSON
npx swarm-review --diff main...HEAD --format json --model deepseek-v4-flash --provider deepseek

# Only security + quality reviewers
npx swarm-review --diff HEAD~3 --reviewers security,quality --model deepseek-v4-flash --provider deepseek

# Custom instructions
npx swarm-review --diff HEAD~1 --instructions "Focus on authentication logic" --model deepseek-v4-flash --provider deepseek
```

**Supported providers:** Any provider supported by `@earendil-works/pi-ai`. Set the corresponding `*_API_KEY` environment variable (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`).

## Library Usage

```typescript
import { review } from "swarm-review";

const result = await review({
  diff: "main...HEAD",
  model: "deepseek-v4-flash",
  provider: "deepseek",
});

console.log(result.verdict);    // "approved" | "approved_with_comments" | "minor_issues" | "significant_concerns"
console.log(result.findings);   // Finding[]
console.log(result.summary);    // string
console.log(result.totalUsage); // { inputTokens, outputTokens, cost }
```

## CI/CD Integration

### Quick setup

1. Add `DEEPSEEK_API_KEY` to your repo secrets (**Settings → Secrets and variables → Actions**)
2. Copy `.github/workflows/ci.yml` into your repo
3. (Optional) Enable branch protection: require the `review` job to pass before merging

### What the workflow does

- On every PR to `master`: builds, typechecks, then runs swarm-review
- Posts the review as a PR comment with verdict
- Fails the check if verdict is `significant_concerns` (exit code 2)

### Minimal workflow

```yaml
on:
  pull_request:
    branches: [master]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g swarm-review
      - run: |
          swarm-review \
            --diff ${{ github.event.pull_request.base.sha }}...${{ github.event.pull_request.head.sha }} \
            --format markdown \
            --model deepseek-v4-flash \
            --provider deepseek \
            --no-color \
            > review.md
        env:
          DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

Exit codes: `0` = approved, `1` = minor issues, `2` = significant concerns.

## Agentic Skill

The skill runs the swarm entirely inside your agentic coding assistant — no npm install required. Everything is in a **single file: [`SKILL.md`](./SKILL.md)**.

`SKILL.md` contains:
- Harness-agnostic orchestration phases (detect target → risk tier → filter → parallel sub-reviewers → coordinator → report)
- Per-harness subsections for Copilot CLI, pi coding agent, Claude Code, and opencode
- All 7 reviewer prompts embedded inline (Security, Performance, Code Quality, Documentation, Engineering Codex, AGENTS.md, Release)
- The Coordinator prompt with verdict rubric and output format

### Usage by harness

#### pi coding agent

```bash
mkdir -p ~/.pi/agent/skills/swarm-review
cp SKILL.md ~/.pi/agent/skills/swarm-review/SKILL.md
```

Then: *"swarm review"* or `/skill:swarm-review`

#### Claude Code

```bash
# Copy to your project root (Claude Code reads AGENTS.md automatically)
cp SKILL.md /path/to/your/project/AGENTS.md

# Or append to an existing AGENTS.md
cat SKILL.md >> /path/to/your/project/AGENTS.md
```

Then: *"run a swarm review"*

Claude Code's `Task` tool spawns sub-agents for parallel reviewer execution. Each sub-agent is directed to follow the relevant **Reviewer Prompt** section of the file.

#### opencode

```bash
cp SKILL.md /path/to/your/project/AGENTS.md
```

Then: *"swarm review"*

#### Copilot CLI

```bash
mkdir -p ~/.agents/skills/swarm-review
cp SKILL.md ~/.agents/skills/swarm-review/SKILL.md
```

Then: *"swarm review"* or *"review this PR"*

## Configuration

| Option | CLI Flag | Default | Description |
|--------|----------|---------|-------------|
| `diff` | `--diff` | `HEAD~1` | Git ref range, "staged", or "unstaged" |
| `cwd` | `--cwd` | `process.cwd()` | Repository root |
| `model` | `--model` | required | Model ID (e.g. `deepseek-v4-flash`) |
| `provider` | `--provider` | required | Model provider (e.g. `deepseek`) |
| `reviewers` | `--reviewers` | auto (by risk tier) | Comma-separated: security,performance,quality |
| `riskTier` | `--risk-tier` | auto-assessed | trivial, lite, or full |
| `format` | `--format` | text | Output: text, json, markdown |
| `output` | `--output` | stdout | Write output to file |
| `timeout` | `--timeout` | 300000 | Per-reviewer timeout (ms) |
| `concurrency` | `--concurrency` | 3 | Max concurrent reviewers |
| `instructions` | `--instructions` | none | Custom instructions for all reviewers |
| `thinkingLevel` | `--thinking-level` | medium | LLM thinking: off, low, medium, high |

## Risk Tiers

The tool automatically assesses the diff and selects reviewers:

| Tier | Lines | Files | Reviewers (npm package) | Reviewers (skill) |
|------|-------|-------|------------------------|-------------------|
| **trivial** | ≤10 | ≤20 | quality only | coordinator + code-quality |
| **lite** | ≤100 | ≤20 | quality + security | + documentation + AGENTS.md |
| **full** | >100 or security-sensitive | any | all three | all 7 specialists |

> Security-sensitive files (`auth/`, `crypto/`, `jwt/`, `oauth/`, etc.) always trigger a **full** review regardless of diff size.

Override with `--risk-tier` or `--reviewers`.

## Requirements

- Node.js >= 22
- An API key for at least one LLM provider
- A git repository
