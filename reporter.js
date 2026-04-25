// reporter.js — Terminal metrics table + cited.md generator
import fs from 'fs'
import chalk from 'chalk'

// Priority color mapping
const priorityColor = {
  high: chalk.red.bold,
  medium: chalk.yellow,
  low: chalk.gray,
}

const scoreColor = (score) => {
  if (score >= 90) return chalk.green.bold
  if (score >= 75) return chalk.cyan
  if (score >= 60) return chalk.yellow
  return chalk.gray
}

// Print the user profile in a readable format
export function printProfile(profile) {
  console.log('\n' + chalk.bgBlue.white.bold(' SkillScout — User Profile '))
  console.log(chalk.blue('─'.repeat(60)))
  console.log(chalk.bold('Name:    ') + profile.name)
  console.log(chalk.bold('Role:    ') + profile.role)
  console.log(chalk.bold('Domains: ') + chalk.cyan(profile.domains?.join(' · ')))
  console.log(chalk.bold('Stack:   ') + chalk.cyan(profile.tech_stack?.join(' · ')))
  console.log('\n' + chalk.bold('Installed Tools:'))
  for (const t of (profile.tools_installed || [])) {
    console.log('  ' + chalk.green('✓') + ' ' + t)
  }
  console.log('\n' + chalk.bold('Daily Workflows:'))
  for (const w of (profile.daily_workflows || [])) {
    console.log('  ' + chalk.yellow('→') + ' ' + w)
  }
  console.log('\n' + chalk.bold('Identified Gaps:'))
  for (const g of (profile.gaps || [])) {
    console.log('  ' + chalk.red('◦') + ' ' + g)
  }
  console.log('\n' + chalk.italic.gray(profile.summary))
  console.log(chalk.blue('─'.repeat(60)))
}

// Print the full metrics table of scored tools
export function printMetricsTable(tools) {
  console.log('\n' + chalk.bgGreen.black.bold(' SkillScout — Recommended Tools '))
  console.log(chalk.green(`  ${tools.length} tools found · ranked by relevance\n`))

  for (let i = 0; i < tools.length; i++) {
    const t = tools[i]
    const rank = chalk.gray(`#${i + 1}`)
    const score = scoreColor(t.score)(`${t.score}%`)
    const priority = (priorityColor[t.priority] || chalk.gray)(t.priority?.toUpperCase() || 'LOW')

    console.log(chalk.white('┌' + '─'.repeat(62) + '┐'))
    console.log(chalk.white('│ ') + chalk.bold.white(`${rank} ${t.name.padEnd(35)} `) + `Score: ${score}  ${priority}` + chalk.white(' │'))
    console.log(chalk.white('│ ') + chalk.gray(`${t.category.padEnd(20)} Source: ${t.source_platform.padEnd(15)}`) + chalk.white('      │'))
    console.log(chalk.white('│─'.padEnd(63) + '│'))
    console.log(chalk.white('│ ') + chalk.yellow('Why: ') + wrapText(t.why || '', 55, '│      '))
    console.log(chalk.white('│ ') + chalk.cyan('Helps: ') + wrapText(t.how_it_helps || '', 53, '│        '))
    console.log(chalk.white('│ ') + chalk.magenta('Future: ') + wrapText(t.futureproof_reason || '', 52, '│         '))
    console.log(chalk.white('│ ') + chalk.green('Install: ') + chalk.bold(t.install_cmd || 'See source URL'))
    if (t.stars > 0) {
      console.log(chalk.white('│ ') + chalk.gray(`★ ${t.stars} stars  ·  ${t.source_url || ''}`))
    }
    console.log(chalk.white('└' + '─'.repeat(62) + '┘'))
    console.log()
  }
}

function wrapText(text, maxLen, indent = '') {
  if (!text) return ''
  if (text.length <= maxLen) return text
  const words = text.split(' ')
  let line = ''
  const lines = []
  for (const word of words) {
    if ((line + word).length > maxLen) {
      lines.push(line.trim())
      line = word + ' '
    } else {
      line += word + ' '
    }
  }
  if (line.trim()) lines.push(line.trim())
  return lines.join('\n' + indent)
}

// Print registry stats from Redis
export function printStats(stats) {
  console.log(
    chalk.gray(`\n  Redis Registry — `) +
    chalk.cyan(`${stats.seen} seen`) + chalk.gray(' · ') +
    chalk.yellow(`${stats.pending} pending`) + chalk.gray(' · ') +
    chalk.green(`${stats.installed} installed`)
  )
}

// Generate the cited.md report (required by hackathon)
export function generateCitedMd(profile, tools, approvedTools, stats) {
  const date = new Date().toISOString()

  const toolSection = tools.map((t, i) => `
### ${i + 1}. ${t.name} — Score: ${t.score}%
- **Category:** ${t.category}
- **Priority:** ${t.priority}
- **Source:** [${t.source_platform}](${t.source_url})
- **Why relevant:** ${t.why}
- **How it helps:** ${t.how_it_helps}
- **Futureproof reason:** ${t.futureproof_reason}
- **Install:** \`${t.install_cmd}\`
- **Stars:** ${t.stars || 0}
`).join('')

  const approvedSection = approvedTools.length > 0
    ? approvedTools.map(t => `- \`${t.name}\` — installed via \`${t.install_cmd}\``).join('\n')
    : '- None approved in this session'

  const content = `# SkillScout Report
> Generated: ${date}
> Agent: SkillScout v1.0 — Autonomous AI Tool Discovery Agent

---

## User Profile

| Field | Value |
|---|---|
| **Name** | ${profile.name} |
| **Role** | ${profile.role} |
| **Domains** | ${profile.domains?.join(', ')} |
| **Tech Stack** | ${profile.tech_stack?.join(', ')} |
| **Gaps Identified** | ${profile.gaps?.join(', ')} |

**Summary:** ${profile.summary}

---

## Scan Summary

| Metric | Count |
|---|---|
| Tools scanned (all-time) | ${stats.seen} |
| Tools pending approval | ${stats.pending} |
| Tools installed | ${stats.installed} |
| Tools recommended (top 25) | ${tools.length} |
| Scan timestamp | ${date} |

---

## Sources Scanned

- [Shipables.dev](https://shipables.dev) — Claude Code skill registry
- [GitHub Topics: mcp-server](https://github.com/topics/mcp-server) — Open source MCP servers
- [npm Registry](https://npmjs.com) — MCP and Claude packages
- [Hacker News](https://news.ycombinator.com) — New AI tool releases
- Open web search via TinyFish

**Data orchestration:** WunderGraph Cosmo federation layer
**Deduplication & caching:** Redis Cloud (redis.io)
**Relevance scoring:** Keyword matching against user profile

---

## Recommended Tools

${toolSection}

---

## Approved & Installed This Session

${approvedSection}

---

## Infrastructure

| Component | Sponsor |
|---|---|
| Web scanning, fetching & agent intelligence | TinyFish |
| Tool registry, dedup & caching | Redis Cloud (redis.io) |
| Unified API federation layer | WunderGraph Cosmo |
| Secure container base image | Chainguard |
| Skill registry & publishing | Shipables.dev |
| Database & persistent storage | Ghost DB |

---

*SkillScout is available on [Shipables.dev](https://shipables.dev) — install it to keep your AI assistant futureproof.*
`

  fs.writeFileSync('cited.md', content, 'utf8')
  console.log(chalk.green('\n  cited.md written ✓'))
  return content
}
