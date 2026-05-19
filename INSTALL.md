# Installing Swarm Review

Swarm Review is distributed as a single file — [`SKILL.md`](./SKILL.md). It contains the orchestration logic and all reviewer prompts inline. Installation is just copying that file to the location your agentic coding assistant reads skills or context from.

- [pi coding agent](#pi-coding-agent)
- [Claude Code](#claude-code)
- [opencode](#opencode)
- [Copilot CLI](#copilot-cli)

---

## pi coding agent

pi loads skills from `~/.pi/agent/skills/`. Each skill lives in its own subdirectory containing a `SKILL.md` file.

### Install

```bash
mkdir -p ~/.pi/agent/skills/swarm-review
curl -o ~/.pi/agent/skills/swarm-review/SKILL.md \
  https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/SKILL.md
```

Or if you have the repo cloned locally:

```bash
mkdir -p ~/.pi/agent/skills/swarm-review
cp /path/to/swarm-review/SKILL.md ~/.pi/agent/skills/swarm-review/SKILL.md
```

### Verify

```bash
ls ~/.pi/agent/skills/swarm-review/
# SKILL.md
```

### Invoke

In any pi session, navigate to the repository you want to review, then say:

```
swarm review
```

or

```
review this PR
```

pi detects the available skills at startup. If you added the skill while a session was already open, restart pi to pick it up.

### How it works in pi

pi reads `SKILL.md` and uses the frontmatter `triggers` list to match natural-language requests. When triggered, the skill runs as the lead agent: it detects the review target via `git` commands, asks you to confirm, then dispatches the specialist reviewer sub-agents in parallel using pi's `subagent` tool. The coordinator agent runs last and writes `review-result.md` to your repository root.

### Uninstall

```bash
rm -rf ~/.pi/agent/skills/swarm-review
```

---

## Claude Code

Claude Code automatically reads `AGENTS.md` from your repository root and injects its contents into every agent context in that project. Installing Swarm Review means copying `SKILL.md` into your repo as `AGENTS.md`.

### Install — per project

```bash
cd /path/to/your/project

# Fresh install
curl -o AGENTS.md \
  https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/SKILL.md

# Or from a local clone
cp /path/to/swarm-review/SKILL.md AGENTS.md
```

If your project already has an `AGENTS.md` with project-specific instructions, append instead of overwriting:

```bash
curl https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/SKILL.md \
  >> AGENTS.md
```

### Verify

Open Claude Code in your project. The skill is active if Claude can answer questions about the swarm review workflow or if it responds to the invoke phrases below.

### Invoke

Inside a Claude Code session in your project:

```
run a swarm review
```

```
review this PR
```

Claude Code uses its `Task` tool to spawn sub-agents for each specialist reviewer. Each sub-agent is directed to follow the relevant reviewer section in `AGENTS.md`. The coordinator runs last and writes `review-result.md` to your project root.

### Notes

- **Scope:** The skill only applies to the project whose `AGENTS.md` you modified. It is not global.
- **Committing `AGENTS.md`:** You can commit the file so all contributors using Claude Code get the skill automatically. If your project has its own `AGENTS.md`, keep both sections separated by a horizontal rule.
- **Updates:** To update, re-run the `curl` command above to overwrite, or pull the latest from the repo.

### Uninstall

```bash
# If the entire file is swarm-review
rm AGENTS.md

# If you appended to an existing AGENTS.md, manually remove the swarm-review section
```

---

## opencode

opencode reads context rules from `AGENTS.md` in the project root, following the same convention as Claude Code.

### Install — per project

```bash
cd /path/to/your/project

curl -o AGENTS.md \
  https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/SKILL.md
```

Or from a local clone:

```bash
cp /path/to/swarm-review/SKILL.md /path/to/your/project/AGENTS.md
```

To append to an existing file:

```bash
cat /path/to/swarm-review/SKILL.md >> /path/to/your/project/AGENTS.md
```

### Invoke

Inside an opencode session in your project:

```
swarm review
```

```
review this PR
```

opencode reads `AGENTS.md` as a rules/context file. The orchestration agent follows the phase sequence defined in the file and uses the embedded reviewer prompts for sub-tasks.

### Notes

- **Scope:** Per-project, same as Claude Code. Not a global install.
- **Updates:** Re-run the `curl` command to refresh.

### Uninstall

```bash
rm AGENTS.md
# or remove the swarm-review section if you appended
```

---

## Copilot CLI

Copilot CLI loads skills from `~/.agents/skills/`. Each skill lives in its own subdirectory.

### Install

```bash
mkdir -p ~/.agents/skills/swarm-review
curl -o ~/.agents/skills/swarm-review/SKILL.md \
  https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/SKILL.md
```

Or from a local clone:

```bash
mkdir -p ~/.agents/skills/swarm-review
cp /path/to/swarm-review/SKILL.md ~/.agents/skills/swarm-review/SKILL.md
```

### Verify

```bash
ls ~/.agents/skills/swarm-review/
# SKILL.md
```

### Invoke

In any Copilot CLI session, navigate to the repository you want to review:

```
swarm review
```

```
review this PR
```

Copilot CLI uses `subagent()` for parallel task spawning. The orchestration agent reads `SKILL.md` and dispatches specialist reviewer sub-agents concurrently, each writing findings to `.swarm-review/reports/`. The coordinator consolidates and writes `review-result.md`.

### Uninstall

```bash
rm -rf ~/.agents/skills/swarm-review
```

---

## After Installation

Regardless of harness, a review session follows the same steps:

1. **Navigate** to the repository you want to review in your coding assistant
2. **Invoke** with one of the trigger phrases above
3. **Confirm** the detected review target (the skill will show you the git context and ask before proceeding)
4. **Wait** — specialist agents run in parallel; the coordinator synthesises their findings
5. **Read** the verdict — presented inline and saved to `review-result.md` in your repo root

The `.swarm-review/` working directory is cleaned up automatically. Only `review-result.md` is kept.

## Updates

To update to the latest version, re-run the install command for your harness. The skill is a single file, so updating is just overwriting it.

```bash
# pi
curl -o ~/.pi/agent/skills/swarm-review/SKILL.md \
  https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/SKILL.md

# Copilot CLI
curl -o ~/.agents/skills/swarm-review/SKILL.md \
  https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/SKILL.md

# Claude Code / opencode (from your project root)
curl -o AGENTS.md \
  https://raw.githubusercontent.com/Kahdeg-15520487/swarm-review/master/SKILL.md
```
