# ai-code-review

Orchestrated AI code review using specialized agents, built on [pi agent core](https://github.com/earendil-works/pi-mono).

Inspired by [Cloudflare's approach](https://blog.cloudflare.com/ai-code-review) to multi-agent code review orchestration.

## How It Works

1. **Extract** git diff from your repository
2. **Filter** noise (lock files, minified assets, vendored deps)
3. **Assess** risk tier (trivial / lite / full)
4. **Dispatch** specialized reviewers in parallel:
   - 🔒 **Security** — injection, auth bypass, secrets
   - ⚡ **Performance** — N+1 queries, memory leaks, algorithmic issues
   - 🔍 **Code Quality** — logic errors, dead code, error handling
5. **Coordinate** — deduplicate, re-categorize, judge severity
6. **Output** — structured review in text, JSON, or markdown

## Install

```bash
npm install
npm run build
```

## CLI Usage

```bash
# Review last commit
npx ai-code-review HEAD~1

# Review staged changes
npx ai-code-review --diff staged

# Review branch vs main, output JSON
npx ai-code-review --diff main...HEAD --format json

# Only security + quality reviewers
npx ai-code-review --diff HEAD~3 --reviewers security,quality

# Custom instructions
npx ai-code-review --diff HEAD~1 --instructions "Focus on authentication logic"
```

## Library Usage

```typescript
import { review } from "ai-code-review";

const result = await review({
  cwd: "/path/to/repo",
  diff: "main...HEAD",
  format: "json",
});

console.log(result.verdict);    // "approved" | "approved_with_comments" | "minor_issues" | "significant_concerns"
console.log(result.findings);   // Array<Finding>
console.log(result.summary);    // string
console.log(result.totalUsage); // { inputTokens, outputTokens, cost, ... }
```

## CI/CD Integration

```yaml
# GitHub Actions example
- name: AI Code Review
  run: npx ai-code-review --diff ${{ github.event.pull_request.base.sha }}...${{ github.sha }} --format json --output review.json
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Exit codes:
- `0` — approved or approved with comments
- `1` — minor issues (warnings suggesting a risk pattern)
- `2` — significant concerns (critical findings, blocks merge)

## Configuration

| Option | CLI Flag | Default | Description |
|--------|----------|---------|-------------|
| `diff` | `--diff` | `HEAD~1` | Git ref range, "staged", or "unstaged" |
| `cwd` | `--cwd` | `process.cwd()` | Repository root |
| `model` | `--model` | auto | Model ID |
| `provider` | `--provider` | auto | Model provider |
| `reviewers` | `--reviewers` | auto (by risk tier) | Comma-separated: security,performance,quality |
| `riskTier` | `--risk-tier` | auto-assessed | trivial, lite, or full |
| `format` | `--format` | text | Output: text, json, markdown |
| `timeout` | `--timeout` | 300000 | Per-reviewer timeout (ms) |
| `concurrency` | `--concurrency` | 3 | Max concurrent reviewers |
| `instructions` | `--instructions` | none | Custom instructions for all reviewers |
| `thinkingLevel` | `--thinking-level` | medium | LLM thinking: off, low, medium, high |

## Requirements

- Node.js ≥ 22
- At least one LLM API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
- Git repository

## Architecture

Based on the [Cloudflare blog post](https://blog.cloudflare.com/ai-code-review) architecture:

- **Specialized agents** instead of one big prompt
- **Risk tiers** to avoid over-spending on trivial changes
- **Coordinator** for deduplication and severity judgment
- **Structured tools** (`report_finding`, `submit_review`) for clean output
- **Diff filtering** to remove noise before review
