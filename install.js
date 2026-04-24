// install.js — Run after reviewing cited.md to install a specific tool
// Usage: node install.js <tool-name>
//        node install.js all        ← installs everything in pending queue

import 'dotenv/config'
import chalk from 'chalk'
import { getTopPending, markInstalled, closeRedis } from './registry.js'
import { installTool } from './installer.js'

const target = process.argv[2]

if (!target) {
  console.log(chalk.yellow('\nUsage:'))
  console.log('  node install.js <tool-name>   — install one tool')
  console.log('  node install.js all           — install all pending tools\n')
  process.exit(0)
}

async function main() {
  const pending = await getTopPending(50)

  if (pending.length === 0) {
    console.log(chalk.yellow('\n  No pending tools. Run `node index.js` first.\n'))
    await closeRedis()
    return
  }

  const toInstall = target === 'all'
    ? pending
    : pending.filter(t => t.name.toLowerCase() === target.toLowerCase())

  if (toInstall.length === 0) {
    console.log(chalk.red(`\n  Tool "${target}" not found in pending list.`))
    console.log(chalk.gray('  Available: ' + pending.map(t => t.name).join(', ') + '\n'))
    await closeRedis()
    return
  }

  for (const tool of toInstall) {
    process.stdout.write(chalk.cyan(`\n  Installing ${tool.name} [${tool.score}%]... `))
    const { claudePath, installResult } = installTool(tool)
    await markInstalled(tool.name, tool)

    if (installResult.success) {
      console.log(chalk.green('✓'))
      console.log(chalk.gray(`  CLAUDE.md updated: ${claudePath}`))
    } else {
      console.log(chalk.yellow('✓ added to CLAUDE.md'))
      console.log(chalk.gray(`  Note: ${installResult.message}`))
    }
  }

  console.log(chalk.green(`\n  Done. ${toInstall.length} tool(s) installed.\n`))
  await closeRedis()
}

main().catch(err => {
  console.error(chalk.red('\n  Error:'), err.message)
  process.exit(1)
})
