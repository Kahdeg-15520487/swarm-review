# Swarm Review

Orchestrated AI code review using a coordinated swarm of specialized agents.

Dispatches up to **7 domain-specific reviewers** (security, performance, code quality, documentation, compliance, release, AGENTS.md) in parallel based on risk tier, then a coordinator agent deduplicates findings and produces a single structured verdict. Inspired by [Cloudflare's approach](https://blog.cloudflare.com/ai-code-review) to multi-agent code review.

## How It Works

```
                    ┌─────────────────────┐
                    │   Risk Assessment   │
                    │  (diff → trivial /  │
                    │   lite / full)      │
                    └──────┬─────────────┘
                           │
                    ┌──────▼─────────────┐
                    │   Coordinator      │
                    │   (spawn + judge)  │
                    └──────┬─────────────┘
                           │
              ┌────────────┼────────────┬──────────────┐
              ▼             ▼            ▼              ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐  ┌──────────┐
        │ Security │ │ Perf     │ │ Code     │  │ Doc      │
        │ Reviewer │ │ Reviewer │ │ Quality  │  │ Reviewer │
        └──────────┘ └──────────┘ └──────────┘  └──────────┘
              │             │            │              │
              └─────────────┼────────────┼──────────────┘
                            ▼            ▼
                     ┌──────────────────────┐
                     │  Coordinator Judge   │
                     │  (dedup, filter,     │
                     │   verdict)           │
                     └──────────────────────┘
```

1. **Auto-detect** git context — uncommitted changes, branch diff, or last commit
2. **Filter noise** — lock files, minified assets, vendored deps, generated files
3. **Assess risk tier** — trivial (2 agents), lite (4 agents), full (7+ agents)
4. **Spawn specialized reviewers in parallel** — each with a scoped prompt
5. **Coordinator judge pass** — deduplicates, re-categorizes, filters false positives, produces verdict
6. **Output** — `review-result.md` in the project root

### Sub-Reviewers

| Reviewer | Domain | Runs On |
|----------|--------|---------|
| **Code Quality** | Logic errors, null safety, error handling, test quality | Always |
| **Security** | Injection, auth bypass, secrets, crypto, input validation | Full + security-sensitive files |
| **Performance** | Algorithmic complexity, N+1 queries, allocations, sync I/O | Full |
| **Documentation** | Missing/outdated docs, changelogs, migration guides | Lite / Full |
| **Engineering Codex** | Internal compliance, observability, standards | Full |
| **AGENTS.md** | AI context freshness, materiality assessment | Lite / Full |
| **Release** | Versioning, changelogs, breaking changes | Full |

## Install

```bash
npm install swarm-review
```

Or use directly:

```bash
npx swarm-review
```

## CLI Usage

```bash
# Auto-detect: review uncommitted changes, branch diff, or last commit
swarm-review

# Explicit git ref range
swarm-review --diff HEAD~3

# Review a specific diff file
swarm-review --diff my.patch

# CI mode — JSON output
swarm-review --ci

# Custom instructions
swarm-review --custom-instructions "Focus on authentication logic only"

# Override risk tier
swarm-review --tier full

# Custom output path
swarm-review --output review-output.md

# Keep temp files for debugging
swarm-review --keep-temp
```

**API keys:** Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or configure via `~/.pi/agent/auth.json`.

## Library Usage

```typescript
import { review } from "swarm-review";

const { verdict, resultPath } = await review({
  customInstructions: "Focus on auth changes",
});

console.log(verdict);   // "approved" | "approved_with_comments" | "minor_issues" | "significant_concerns"
console.log(resultPath); // path to review-result.md
```

Programmatic API with full control:

```typescript
import { runSwarmReview } from "swarm-review";

const { config, resultPath } = await runSwarmReview({
  cwd: process.cwd(),
  customInstructions: "Skip docs reviewer",
  keepTemp: false,
  onProgress: (msg) => console.log(`[review] ${msg}`),
});
```

## CI/CD Integration

```yaml
on:
  pull_request:
    branches: [master]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g swarm-review
      - run: swarm-review --ci
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Risk Tiers

| Tier | Lines Changed | Files Changed | Agents |
|------|--------------|---------------|--------|
| **trivial** | ≤10 | ≤20 | Code Quality + coordinator |
| **lite** | ≤100 | ≤20 | + Documentation, AGENTS.md |
| **full** | >100 or >50 files or security-sensitive | Any | All 7 specialists |

## Auto-Detection

| State | What Gets Reviewed |
|-------|-------------------|
| Uncommitted changes exist | Working tree diff |
| On a feature branch | Commits since diverging from master/main |
| On master/main | Last commit |

## Requirements

- Node.js >= 22
- An API key for at least one LLM provider (Anthropic, OpenAI, etc.)
- A git repository

## License

MIT
