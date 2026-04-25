// profile.js — Comprehensive user profile builder
// Sources: CLAUDE.md, memory files, git config, VS Code extensions,
//          npm globals, Claude projects history, settings.json

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

// ─── File readers ─────────────────────────────────────────────────────────────

function safeRead(filePath) {
  try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null }
  catch { return null }
}

function safeExec(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', timeout: 3000, stdio: ['pipe','pipe','pipe'] }).trim() }
  catch { return null }
}

function safeReadJson(filePath) {
  const raw = safeRead(filePath)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// ─── Source 1: CLAUDE.md files ────────────────────────────────────────────────

function readClaudeMdFiles() {
  const sources = []
  const candidates = [
    path.join(os.homedir(), '.claude', 'CLAUDE.md'),
    path.join(process.cwd(), 'CLAUDE.md'),
    path.join(process.cwd(), '..', 'CLAUDE.md'),
    path.join(process.cwd(), '..', '..', 'CLAUDE.md'),
    path.join(os.homedir(), 'Claude Projects', 'CLAUDE.md'),
    path.join(os.homedir(), 'Documents', 'Claude', 'CLAUDE.md'),
  ]
  for (const p of [...new Set(candidates)]) {
    const content = safeRead(p)
    if (content) sources.push({ label: path.basename(path.dirname(p)) + '/CLAUDE.md', content })
  }
  return sources
}

// ─── Source 2: Memory files ────────────────────────────────────────────────────

function readMemoryFiles() {
  const sources = []
  const dirs = [
    path.join(os.homedir(), '.claude', 'memory'),
    path.join(process.cwd(), 'memory'),
    path.join(process.cwd(), '..', 'memory'),
  ]
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    for (const file of files) {
      const content = safeRead(path.join(dir, file))
      if (content) sources.push({ label: `memory/${file}`, content })
    }
    break
  }
  return sources
}

// ─── Source 3: Claude Code conversation history ───────────────────────────────

function readClaudeProjectHistory() {
  const sources = []
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  if (!fs.existsSync(projectsDir)) return sources

  const projects = fs.readdirSync(projectsDir)
  // Read the most recent 5 project STATE.md or CONTEXT.md files
  let found = 0
  for (const proj of projects) {
    if (found >= 5) break
    const projDir = path.join(projectsDir, proj)
    for (const contextFile of ['STATE.md', 'CONTEXT.md', '.planning/STATE.md']) {
      const content = safeRead(path.join(projDir, contextFile))
      if (content) {
        sources.push({ label: `project/${proj.slice(-20)}/${contextFile}`, content: content.slice(0, 800) })
        found++
        break
      }
    }
  }
  return sources
}

// ─── Source 4: Git config ─────────────────────────────────────────────────────

function readGitConfig() {
  const info = []
  const name = safeExec('git config --global user.name')
  const email = safeExec('git config --global user.email')
  if (name) info.push(`Git user: ${name}`)
  if (email) info.push(`Git email: ${email}`)

  // Recent repos from git log across home directory
  const recentRepos = safeExec('git -C ~ log --format="%H" -1 2>/dev/null') // just a test
  const recentDirs = safeExec('ls -t ~/') // recent home dirs

  if (info.length === 0) return null
  return { label: 'git config', content: info.join('\n') }
}

// ─── Source 5: VS Code extensions ─────────────────────────────────────────────

function readVSCodeExtensions() {
  const extensions = safeExec('code --list-extensions 2>/dev/null') ||
                     safeExec('code-insiders --list-extensions 2>/dev/null')
  if (!extensions) return null
  const list = extensions.split('\n').filter(Boolean)
  return {
    label: 'VS Code extensions',
    content: `Installed VS Code extensions (${list.length}):\n${list.slice(0, 30).join('\n')}`,
  }
}

// ─── Source 6: Global npm packages ───────────────────────────────────────────

function readNpmGlobals() {
  const raw = safeExec('npm list -g --depth=0 2>/dev/null')
  if (!raw) return null
  const packages = raw.split('\n')
    .filter(l => l.includes('@'))
    .map(l => l.trim().replace(/[├└─]+\s*/, ''))
    .filter(Boolean)
  if (packages.length === 0) return null
  return {
    label: 'npm global packages',
    content: `Globally installed npm packages:\n${packages.slice(0, 20).join('\n')}`,
  }
}

// ─── Source 7: Recent project package.json files ──────────────────────────────

function readRecentPackageJsons() {
  const sources = []
  const searchDirs = [
    path.join(os.homedir(), 'projects'),
    path.join(os.homedir(), 'dev'),
    path.join(os.homedir(), 'code'),
    path.join(os.homedir(), 'workspace'),
    path.join(os.homedir(), 'Documents'),
    process.cwd(),
    path.join(process.cwd(), '..'),
  ]

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue
    try {
      const entries = fs.readdirSync(dir)
      for (const entry of entries.slice(0, 10)) {
        const pkgPath = path.join(dir, entry, 'package.json')
        const pkg = safeReadJson(pkgPath)
        if (pkg && pkg.dependencies) {
          const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) })
          if (deps.length > 0) {
            sources.push({
              label: `package.json (${entry})`,
              content: `Project: ${pkg.name || entry}\nDependencies: ${deps.slice(0, 20).join(', ')}`,
            })
            if (sources.length >= 3) break
          }
        }
      }
    } catch { /* skip unreadable dirs */ }
    if (sources.length >= 3) break
  }
  return sources
}

// ─── Source 8: Claude Code settings ──────────────────────────────────────────

function readClaudeSettings() {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  const settings = safeReadJson(settingsPath)
  if (!settings) return null
  // Extract useful signals without exposing API keys
  const signals = []
  if (settings.model) signals.push(`Preferred model: ${settings.model}`)
  if (settings.theme) signals.push(`Theme: ${settings.theme}`)
  if (Array.isArray(settings.mcpServers)) signals.push(`MCP servers installed: ${settings.mcpServers.length}`)
  if (signals.length === 0) return null
  return { label: 'Claude settings', content: signals.join('\n') }
}

// ─── Source 9: Installed Claude skills ───────────────────────────────────────

function readInstalledSkills() {
  const skillsDirs = [
    path.join(os.homedir(), '.claude', 'skills'),
    path.join(os.homedir(), '.claude', 'plugins'),
    path.join(os.homedir(), '.claude', 'commands'),
  ]
  const skills = []
  for (const dir of skillsDirs) {
    if (!fs.existsSync(dir)) continue
    try {
      const entries = fs.readdirSync(dir)
      skills.push(...entries.filter(e => !e.startsWith('.')))
    } catch { /* skip */ }
  }
  if (skills.length === 0) return null
  return {
    label: 'installed Claude skills/commands',
    content: `Installed skills and commands (${skills.length}):\n${skills.join(', ')}`,
  }
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function extractSection(content, heading) {
  const pattern = new RegExp(`##\\s+${heading}[\\s\\S]*?(?=\\n##\\s|$)`, 'i')
  const match = content.match(pattern)
  return match ? match[0] : ''
}

function extractBullets(section) {
  return section.split('\n')
    .filter(l => /^\s*[-*]/.test(l))
    .map(l => l.replace(/^\s*[-*]+\s*/, '').replace(/`/g, '').trim())
    .filter(Boolean)
}

function extractInlineList(content, label) {
  const pattern = new RegExp(`${label}[:\\s]+([^\\n]+)`, 'i')
  const match = content.match(pattern)
  if (!match) return []
  return match[1].split(/[,·\/]/).map(s => s.trim()).filter(s => s.length > 1)
}

function extractInstalledSkills(content) {
  const skills = []
  const matches = content.matchAll(/[-*]\s+`?\/([a-z][a-z0-9\-]+)`?/g)
  for (const m of matches) skills.push(m[1])
  return [...new Set(skills)]
}

// ─── Main profile builder ─────────────────────────────────────────────────────

export function buildProfile() {
  // Gather all sources
  const claudeMds = readClaudeMdFiles()
  const memoryFiles = readMemoryFiles()
  const projectHistory = readClaudeProjectHistory()
  const gitConfig = readGitConfig()
  const vscodeExts = readVSCodeExtensions()
  const npmGlobals = readNpmGlobals()
  const packageJsons = readRecentPackageJsons()
  const claudeSettings = readClaudeSettings()
  const installedSkills = readInstalledSkills()

  const allSources = [
    ...claudeMds,
    ...memoryFiles,
    ...projectHistory,
    ...(gitConfig ? [gitConfig] : []),
    ...(vscodeExts ? [vscodeExts] : []),
    ...(npmGlobals ? [npmGlobals] : []),
    ...packageJsons,
    ...(claudeSettings ? [claudeSettings] : []),
    ...(installedSkills ? [installedSkills] : []),
  ]

  if (allSources.length === 0) {
    console.log('\n  No profile sources found. Using generic profile.')
    console.log('  Tip: Create ~/.claude/CLAUDE.md with your role and tech stack.\n')
    return genericProfile()
  }

  console.log(`  Read ${allSources.length} profile sources: ${allSources.map(s => s.label).join(', ')}`)

  // Combine all content for parsing
  const combined = allSources.map(s => s.content).join('\n\n')

  // Extract name
  const nameMatch = combined.match(/## About (\w+)/i) ||
                    combined.match(/name[:\s]+([A-Z][a-z]+)/i) ||
                    combined.match(/git user[:\s]+([^\n]+)/i)
  const name = nameMatch ? nameMatch[1].trim() : 'User'

  // Extract role
  const aboutSection = extractSection(combined, `About ${name}`) ||
                       extractSection(combined, 'About') ||
                       extractSection(combined, 'Role')
  const aboutBullets = extractBullets(aboutSection)
  const role = aboutBullets.find(b => b.length > 10 && b.length < 80) || 'AI Developer'

  // Extract tech stack from multiple signals
  const techFromExpertise = extractInlineList(combined, 'Expertise')
  const techFromStack     = extractInlineList(combined, 'Tech Stack')
  const techFromTools     = extractInlineList(combined, 'Tools')
  const techFromUsing     = extractInlineList(combined, 'Using')

  // Also extract from package.json deps
  const pkgTech = packageJsons.flatMap(p => {
    const deps = p.content.match(/Dependencies: ([^\n]+)/)?.[1] || ''
    return deps.split(',').map(s => s.trim()).filter(s => s.length > 1 && s.length < 20)
  })

  const techStack = [...new Set([
    ...techFromExpertise,
    ...techFromStack,
    ...techFromTools,
    ...techFromUsing,
    ...pkgTech.slice(0, 10),
  ])].filter(Boolean).slice(0, 20)

  // Extract domains
  const domains = [
    ...extractInlineList(combined, 'Current focus'),
    ...extractInlineList(combined, 'Domains'),
    ...extractInlineList(combined, 'Working on'),
    ...extractBullets(extractSection(combined, 'Focus')),
  ].filter(Boolean).slice(0, 8)

  // Extract installed skills
  const toolsInstalled = extractInstalledSkills(combined)

  // Extract VS Code extensions as tech signals
  const vscodeSignals = vscodeExts
    ? vscodeExts.content.split('\n').slice(1)
        .map(e => e.split('.').pop()?.replace(/-/g, ' '))
        .filter(Boolean).slice(0, 10)
    : []

  // Extract workflows
  const workflowSection = extractSection(combined, 'Workflow') ||
                          extractSection(combined, 'Daily') ||
                          extractSection(combined, 'Process')
  const dailyWorkflows = extractBullets(workflowSection).slice(0, 6)

  // Infer gaps based on what they have vs common needs
  const allKnownTools = [...techStack, ...toolsInstalled, ...vscodeSignals].map(t => t.toLowerCase())
  const commonNeeds = [
    { name: 'testing', keywords: ['test', 'jest', 'vitest', 'playwright', 'cypress'] },
    { name: 'deployment', keywords: ['deploy', 'vercel', 'netlify', 'docker', 'ci-cd'] },
    { name: 'monitoring', keywords: ['monitor', 'sentry', 'datadog', 'logging'] },
    { name: 'database', keywords: ['sql', 'postgres', 'mongo', 'prisma', 'supabase'] },
    { name: 'voice/audio', keywords: ['voice', 'audio', 'speech', 'vapi'] },
    { name: 'mobile', keywords: ['react-native', 'expo', 'flutter', 'mobile'] },
    { name: 'AI/ML pipeline', keywords: ['langchain', 'llamaindex', 'rag', 'embedding'] },
    { name: 'real-time', keywords: ['websocket', 'socket.io', 'realtime', 'streaming'] },
  ]
  const gaps = commonNeeds
    .filter(need => !need.keywords.some(kw => allKnownTools.some(t => t.includes(kw))))
    .map(n => n.name)
    .slice(0, 5)

  // Build targeted search keywords — mix of MCP, skills, tools, and domain-specific
  const searchKeywords = [
    // One MCP query for the top stack item only
    techStack[0] ? `${techStack[0]} MCP server` : null,
    // Skill/plugin queries for the rest of the stack
    ...techStack.slice(1, 3).map(t => `${t} developer tool 2025`),
    // Domain-specific tools (not MCP-only)
    ...domains.slice(0, 2).map(d => `${d} AI tools 2025`),
    // Gap-filling tools
    ...gaps.slice(0, 2).map(g => `${g} AI tool developer`),
    // Generic discovery — not MCP-specific
    'new claude code skills 2025',
    'developer productivity AI tool 2025',
    'VS Code extension AI 2025',
  ].filter(Boolean).slice(0, 10)

  return {
    name,
    role,
    domains: domains.length ? domains : ['software development'],
    tools_installed: toolsInstalled,
    daily_workflows: dailyWorkflows.length ? dailyWorkflows : ['coding', 'development'],
    tech_stack: techStack.length ? techStack : ['JavaScript', 'Python'],
    vscode_extensions: vscodeSignals,
    gaps,
    search_keywords: searchKeywords,
    summary: `${role}. Stack: ${techStack.slice(0, 4).join(', ')}. ${toolsInstalled.length} skills installed. Needs: ${gaps.slice(0, 3).join(', ')}.`,
    sources_read: allSources.map(s => s.label),
  }
}

function genericProfile() {
  return {
    name: 'User',
    role: 'AI Developer',
    domains: ['software development', 'AI tooling'],
    tools_installed: [],
    daily_workflows: ['coding', 'AI agent building'],
    tech_stack: ['JavaScript', 'Python', 'TypeScript'],
    vscode_extensions: [],
    gaps: ['testing', 'deployment', 'monitoring', 'database'],
    search_keywords: ['claude code skills', 'MCP server 2025', 'AI tools developer', 'coding assistant MCP', 'developer productivity AI'],
    summary: 'AI developer. No profile found — create ~/.claude/CLAUDE.md for personalized results.',
    sources_read: [],
  }
}
