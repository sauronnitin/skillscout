# SkillScout

Autonomous agent that learns your workflow and keeps your AI assistant futureproof.

## What it does

SkillScout watches the live web for new AI tools, skills, MCP servers, and plugins — then tells you exactly which ones to install based on your actual workflow. It reads your `CLAUDE.md` and memory files to understand who you are, scans multiple sources in parallel, and generates a cited report with relevance scores and reasoning tailored to you.

## Install

```bash
git clone https://github.com/sauronnitin/skillscout ~/.claude/skills/skillscout
cd ~/.claude/skills/skillscout && npm install
```

Set up your `.env` (copy from `.env.example`, add TinyFish + Redis keys), then:

```bash
node index.js
```

## Usage in Claude Code

After running, open `cited.md` for your personalized recommendations. Install any tool with:

```bash
node install.js <tool-name>
```

## Requirements

- Node.js 18+
- [TinyFish API key](https://agent.tinyfish.ai/api-keys) — free
- [Redis Cloud](https://redis.io/try-free) — free 30MB tier

## Source

[github.com/sauronnitin/skillscout](https://github.com/sauronnitin/skillscout)
