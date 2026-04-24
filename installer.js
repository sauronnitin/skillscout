// installer.js — Writes approved tools to CLAUDE.md and runs install commands
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

// Find the best CLAUDE.md to write to
function findClaudeMd() {
  const candidates = [
    path.join(process.cwd(), 'CLAUDE.md'),
    path.join(process.cwd(), '..', 'CLAUDE.md'),
    path.join('E:\\Claude Projects', 'CLAUDE.md'),
    path.join(os.homedir(), '.claude', 'CLAUDE.md'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  // Create one if none found
  const fallback = path.join(process.cwd(), 'CLAUDE.md')
  fs.writeFileSync(fallback, '# Claude Code Configuration\n\n## Installed Skills\n\n')
  return fallback
}

// Append tool entry to CLAUDE.md under ## Installed Skills section
export function writeToClaudeMd(tool) {
  const claudePath = findClaudeMd()
  let content = fs.readFileSync(claudePath, 'utf8')

  const entry = `- \`/${tool.name}\` — ${tool.description?.slice(0, 80) || 'No description'} *(added by SkillScout ${new Date().toLocaleDateString()})*`

  // Find or create the Installed Skills section
  if (content.includes('## Installed Skills')) {
    const sectionEnd = content.indexOf('\n##', content.indexOf('## Installed Skills') + 1)
    if (sectionEnd === -1) {
      content = content + '\n' + entry
    } else {
      content = content.slice(0, sectionEnd) + '\n' + entry + content.slice(sectionEnd)
    }
  } else {
    content += `\n\n## Installed Skills (Added by SkillScout)\n\n${entry}`
  }

  fs.writeFileSync(claudePath, content, 'utf8')
  return claudePath
}

// Run the actual install command
export function runInstallCommand(tool) {
  if (!tool.install_cmd || tool.install_cmd.startsWith('#')) {
    return { success: false, message: 'No install command available — see source URL' }
  }

  try {
    // Safety check: only allow safe install commands
    const cmd = tool.install_cmd.trim()
    const allowed = ['npx shipables', 'npm install', 'pip install', 'npx @modelcontextprotocol']
    const isSafe = allowed.some(prefix => cmd.startsWith(prefix))

    if (!isSafe) {
      return { success: false, message: `Install command not in allowlist: ${cmd}` }
    }

    execSync(cmd, { stdio: 'inherit', timeout: 30000 })
    return { success: true, message: `Installed: ${cmd}` }
  } catch (e) {
    return { success: false, message: `Install failed: ${e.message}` }
  }
}

// Full install flow for an approved tool
export function installTool(tool) {
  const claudePath = writeToClaudeMd(tool)
  const installResult = runInstallCommand(tool)
  return { claudePath, installResult }
}
