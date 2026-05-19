# Swarm Review

Orchestrated AI code review using specialized agents.

Dispatches specialized reviewers in parallel, then a coordinator deduplicates findings and produces a final verdict. Inspired by [Cloudflare's approach](https://blog.cloudflare.com/ai-code-review) to multi-agent code review.

**[See it in action →](https://github.com/Kahdeg-15520487/swarm-review/pull/1)** — a PR with intentionally buggy code, reviewed automatically by Swarm Review.

## Quick Install

| How | Harness | Steps |
|-----|---------|-------|
| **npm CLI** | Any (CI/CD, scripts) | `npm install -g swarm-review` |
| **Agentic skill** | Copilot CLI | Copy `AGENTS.md` + `SKILL.md` + `prompts/` to `~/.agents/skills/swarm-review/` |
| **Agentic skill** | pi coding agent | Copy `AGENTS.md` to `~/.pi/agent/skills/swarm-review.md` |
| **Agentic skill** | Claude Code | Copy `AGENTS.md` to your repo root |
| **Agentic skill** | opencode | Copy `AGENTS.md` to your repo root |

### Skill install (one command)

```bash
# Clone just the skill into the global skills directory (all harnesses)
git clone --depth=1 https://github.com/Kahdeg-15520487/swarm-review ~/.agents/skills/swarm-review

# Or for pi (single-file, no directory needed)
curl -o ~/.pi/agent/skills/swarm-review.md \
  https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/AGENTS.md
```

## Two Components

| Component | What it is | Reviewers | Prompt source |
|-----------|-----------|-----------|--------------|
| **npm package** | Standalone CLI + TypeScript library | 3 (security, performance, quality) | `src/prompts/*.ts` — tool-calling format (`report_finding` tool) |
| **`AGENTS.md` skill** | Single-file skill for agentic coding assistants | 7 (all of the above + documentation, codex, AGENTS.md, release) | `AGENTS.md` — plain markdown output format |

Both implement the same reviewing philosophy. They differ in output mechanism: the CLI uses a structured tool-calling API (`report_finding`) fed by the pi-agent-core framework; the agentic skill writes plain markdown findings that the coordinator reads as text. The prompts are **not shared** — changes to reviewer logic need to be applied to both.

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

The skill runs the swarm entirely inside your agentic coding assistant — no npm install required. Everything is in a **single file: [`AGENTS.md`](./AGENTS.md)**.

`AGENTS.md` contains:
- Harness-agnostic orchestration phases (detect target → risk tier → filter → parallel sub-reviewers → coordinator → report)
- Per-harness subsections for Copilot CLI, pi coding agent, Claude Code, and opencode
- All 7 reviewer prompts embedded inline (Security, Performance, Code Quality, Documentation, Engineering Codex, AGENTS.md, Release)
- The Coordinator prompt with verdict rubric and output format

### Usage by harness

#### Copilot CLI

```bash
# Install
cp -r . ~/.agents/skills/swarm-review

# Invoke (in any session)
# "swarm review" or "review this PR"
```

Copilot CLI uses `subagent()` for parallel task spawning. The full orchestration wiring is in `SKILL.md`; reviewer prompts are in `prompts/`.

#### pi coding agent

```bash
# Single-file install (recommended)
cp AGENTS.md ~/.pi/agent/skills/swarm-review.md

# Or directory install (uses separate prompt files)
cp -r . ~/.pi/agent/skills/swarm-review

# Invoke
pi                  # then: "swarm review"
# or
pi /skill:swarm-review
```

pi supports both single `.md` file skills (`~/.pi/agent/skills/`) and directory skills. The single-file install uses inline prompts from `AGENTS.md`; the directory install references `prompts/*.md` files.

#### Claude Code

```bash
# Add to your project (Claude Code reads AGENTS.md automatically)
cp AGENTS.md /path/to/your/project/AGENTS.md
# or append to existing AGENTS.md
cat AGENTS.md >> /path/to/your/project/AGENTS.md
```

Then in Claude Code: *"run a swarm review"*

Claude Code's `Task` tool spawns sub-agents for parallel reviewer execution. Each sub-agent is directed to follow the relevant **Reviewer Prompt** section of `AGENTS.md`.

#### opencode

```bash
# Add to your project
cp AGENTS.md /path/to/your/project/AGENTS.md
```

Then: *"swarm review"*

opencode reads `AGENTS.md` as a context/rules file. The orchestration agent follows the phase sequence and uses the embedded reviewer prompts for sub-tasks.

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
