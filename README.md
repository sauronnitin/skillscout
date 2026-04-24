# SkillScout

> Autonomous agent that learns your workflow and keeps your AI assistant futureproof.

Every minute, new tools, skills, plugins and MCP servers launch globally. SkillScout watches the live web, learns who you are from your Claude Code setup, and tells you exactly what to install next — and why.

## How it works

1. **Learns you** — reads your `CLAUDE.md` and memory files to build your profile
2. **Scans the web** — searches Shipables.dev, GitHub, npm, and HN via TinyFish
3. **Scores tools** — matches each tool against your actual tech stack and workflows
4. **Reports** — generates `cited.md` with ranked recommendations + reasons
5. **You decide** — run `node install.js <tool-name>` to install what you want

## Setup

### 1. Clone and install

```bash
git clone https://github.com/sauronnitin/skillscout
cd skillscout
npm install
```

### 2. Get API keys (both free)

| Service | Where | Time |
|---|---|---|
| **TinyFish** | [agent.tinyfish.ai/api-keys](https://agent.tinyfish.ai/api-keys) | 1 min |
| **Redis Cloud** | [redis.io/try-free](https://redis.io/try-free) | 2 min |

### 3. Configure

```bash
cp .env.example .env
# Fill in TINYFISH_API_KEY and REDIS_URL
```

### 4. Run

```bash
node index.js
```

Opens `cited.md` with your personalised tool recommendations.

### 5. Install a recommended tool

```bash
node install.js <tool-name>    # install one
node install.js all            # install everything recommended
```

## Commands

```bash
node index.js                  # full run — profile + scan + report
node index.js --profile-only   # just show your profile
node index.js --scan-only      # scan + store to Redis, no report
node index.js --report-only    # show cached results from Redis
node install.js <tool-name>    # install a specific tool
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TINYFISH_API_KEY` | required | TinyFish web scanning |
| `REDIS_URL` | required | Redis Cloud connection string |
| `AUTO_INSTALL_THRESHOLD` | 75 | Min score for `install all` (0-100) |

## Sponsors

Built with:
- **[TinyFish](https://tinyfish.ai)** — web scanning, fetching, agent extraction
- **[Redis](https://redis.io)** — tool registry and caching
- **[WunderGraph](https://wundergraph.com)** — unified API federation
- **[Chainguard](https://chainguard.dev)** — secure container base image

Built at **Ship to Prod Hackathon** — Context Engineering Challenge.
