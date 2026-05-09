# Swarm Review

Orchestrated AI code review using specialized agents.

Dispatches security, performance, and code quality reviewers in parallel, then a coordinator deduplicates findings and produces a final verdict. Inspired by [Cloudflare's approach](https://blog.cloudflare.com/ai-code-review) to multi-agent code review.

**[See it in action →](https://github.com/Kahdeg-15520487/swarm-review/pull/1)** — a PR with intentionally buggy code, reviewed automatically by Swarm Review.

## How It Works

1. Extract git diff from your repository
2. Filter noise (lock files, minified assets, vendored deps)
3. Assess risk tier (trivial / lite / full)
4. Dispatch specialized reviewers in parallel:
   - **Security** — injection, auth bypass, secrets
   - **Performance** — N+1 queries, memory leaks, algorithmic issues
   - **Code Quality** — logic errors, dead code, error handling
5. Coordinator deduplicates, re-categorizes, judges severity
6. Output structured review in text, JSON, or markdown

## Install

```bash
npm install swarm-review
```

Or use directly:

```bash
npx swarm-review HEAD~1 --model deepseek-v4-flash --provider deepseek
```

## CLI Usage

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

| Tier | Lines | Reviewers |
|------|-------|-----------|
| **trivial** | ≤10 lines | quality only |
| **lite** | ≤100 lines | quality + security |
| **full** | >100 lines or security-sensitive files | all three |

Override with `--risk-tier` or `--reviewers`.

## Requirements

- Node.js >= 22
- An API key for at least one LLM provider
- A git repository
