// SkillScout — Autonomous AI tool discovery agent
// Learns your workflow · scans the live web · keeps your AI assistant futureproof
//
// Sponsors: TinyFish · Redis · WunderGraph · Chainguard
// Hackathon: Ship to Prod — Context Engineering Challenge
//
// Usage:
//   node index.js              — full run (profile + scan + score + approve + install)
//   node index.js --profile-only  — just build and show profile
//   node index.js --scan-only     — scan web, score, store in Redis (no approval)
//   node index.js --report-only   — show pending tools from Redis + approval flow

import 'dotenv/config'
import chalk from 'chalk'

import { buildProfile } from './profile.js'
import { scanWeb } from './scanner.js'
import { createFederatedResult, buildFederationQuery, DATA_SOURCES } from './wundergraph.js'
import { addPending, getTopPending, recordScan, getStats, closeRedis } from './registry.js'
import { scoreTools } from './scorer.js'
import { printProfile, printMetricsTable, printStats, generateCitedMd } from './reporter.js'

const args = process.argv.slice(2)
const MODE = {
  profileOnly: args.includes('--profile-only'),
  scanOnly: args.includes('--scan-only'),
  reportOnly: args.includes('--report-only'),
}

function validateEnv() {
  const required = [
    'TINYFISH_API_KEY',
    'REDIS_URL',
  ]
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    console.error(chalk.red('\n  Missing required env vars:'))
    missing.forEach(k => console.error(chalk.red(`    - ${k}`)))
    console.error(chalk.yellow('\n  Copy .env.example → .env and fill in your keys\n'))
    process.exit(1)
  }
}


async function main() {
  console.log(chalk.bgWhite.black.bold('\n  SkillScout  ') + chalk.gray(' Autonomous AI Tool Discovery Agent\n'))

  validateEnv()

  // ─── ACT 1: PROFILE ───────────────────────────────────────────────────────
  console.log(chalk.bold.blue('\n[1/4] Building user profile...'))
  const profile = await buildProfile()
  printProfile(profile)

  if (MODE.profileOnly) return

  // ─── ACT 2: SCAN ──────────────────────────────────────────────────────────
  if (!MODE.reportOnly) {
    console.log(chalk.bold.blue('\n[2/4] Scanning the web for new tools...'))
    console.log(chalk.gray(`  Sources: ${Object.values(DATA_SOURCES).map(s => s.name).join(' · ')}`))
    console.log(chalk.gray(`  Federation: WunderGraph Cosmo unified query layer`))
    console.log(chalk.gray(`  GraphQL query:\n`) + chalk.gray(buildFederationQuery(profile.search_keywords).split('\n').map(l => '    ' + l).join('\n')))

    const rawTools = await scanWeb(profile)

    // WunderGraph federated result wrapper
    const federated = createFederatedResult(rawTools, profile)
    console.log(chalk.gray(`\n  WunderGraph federation: ${federated.total_count} tools from ${federated.query_context.sources_queried.length} subgraphs`))

    // ─── ACT 3: SCORE ─────────────────────────────────────────────────────
    console.log(chalk.bold.blue('\n[3/4] Scoring tools against your profile...'))
    const scoredTools = scoreTools(rawTools, profile)
    console.log(chalk.green(`  ${scoredTools.length} tools matched your profile`))

    // Store in Redis
    console.log(chalk.gray('  Storing to Redis registry...'))
    for (const tool of scoredTools) {
      await addPending(tool, tool.score)
    }

    await recordScan({
      tools_found: rawTools.length,
      tools_scored: scoredTools.length,
      keywords: profile.search_keywords,
    })

    if (MODE.scanOnly) {
      const stats = await getStats()
      printStats(stats)
      console.log(chalk.green('\n  Scan complete. Run `node index.js --report-only` to review.\n'))
      return
    }
  }

  // ─── ACT 4: APPROVE + INSTALL ─────────────────────────────────────────────
  console.log(chalk.bold.blue('\n[4/4] Loading recommendations from Redis...'))
  const stats = await getStats()
  printStats(stats)

  const pendingTools = await getTopPending(10)
  printMetricsTable(pendingTools)

  // Generate cited.md report — no installs, user verifies first
  const finalStats = await getStats()
  generateCitedMd(profile, pendingTools, [], finalStats)

  console.log(chalk.bgCyan.black.bold('\n  Report ready → cited.md '))
  console.log(chalk.cyan('  Review the report, then run: node install.js <tool-name>\n'))
  await closeRedis()
}

main().catch(err => {
  console.error(chalk.red('\n  Fatal error:'), err.message)
  process.exit(1)
})
