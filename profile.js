// profile.js — Parses CLAUDE.md + memory files into structured user profile
// No external API needed — CLAUDE.md already has rich, structured user info

import fs from 'fs'
import path from 'path'
import os from 'os'

// Extract a section's content from markdown
function extractSection(content, heading) {
  const pattern = new RegExp(`## ${heading}[\\s\\S]*?(?=\\n## |$)`, 'i')
  const match = content.match(pattern)
  return match ? match[0] : ''
}

// Extract bullet list items from a section
function extractBullets(section) {
  return section
    .split('\n')
    .filter(l => l.trim().startsWith('-') || l.trim().startsWith('*'))
    .map(l => l.replace(/^[\s\-\*]+/, '').trim())
    .filter(Boolean)
}

// Extract inline values like "Expertise: Figma, React, Three.js"
function extractInlineList(content, label) {
  const pattern = new RegExp(`${label}[:\\s]+([^\\n]+)`, 'i')
  const match = content.match(pattern)
  if (!match) return []
  return match[1].split(/[,·]/).map(s => s.trim()).filter(Boolean)
}

// Pull all skill names from the installed skills sections
function extractInstalledSkills(content) {
  const skills = []
  // Match patterns like: - `/skill-name` or - /skill-name
  const matches = content.matchAll(/[-*]\s+`?\/([a-z][a-z0-9\-]+)`?/g)
  for (const m of matches) skills.push(m[1])
  return [...new Set(skills)]
}

// Read all available context files — works for any user on any machine
function gatherFiles() {
  const sources = []

  const candidates = [
    // Global Claude Code config (~/.claude/CLAUDE.md)
    { label: 'Global CLAUDE.md', path: path.join(os.homedir(), '.claude', 'CLAUDE.md') },
    // Current working directory
    { label: 'Local CLAUDE.md', path: path.join(process.cwd(), 'CLAUDE.md') },
    // One level up (if running from a subdirectory)
    { label: 'Parent CLAUDE.md', path: path.join(process.cwd(), '..', 'CLAUDE.md') },
    // Claude projects root (checks common locations)
    { label: 'Projects CLAUDE.md', path: path.join(os.homedir(), 'Claude Projects', 'CLAUDE.md') },
    { label: 'Projects CLAUDE.md', path: path.join(os.homedir(), 'Documents', 'Claude', 'CLAUDE.md') },
  ]

  for (const c of candidates) {
    if (fs.existsSync(c.path)) {
      sources.push({ label: c.label, content: fs.readFileSync(c.path, 'utf8') })
    }
  }

  // Memory files — look in standard locations
  const memoryDirs = [
    path.join(process.cwd(), 'memory'),
    path.join(process.cwd(), '..', 'memory'),
    path.join(os.homedir(), '.claude', 'memory'),
  ]
  for (const memoryDir of memoryDirs) {
    if (fs.existsSync(memoryDir)) {
      for (const file of fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'))) {
        sources.push({
          label: `Memory: ${file}`,
          content: fs.readFileSync(path.join(memoryDir, file), 'utf8'),
        })
      }
      break // use first memory dir found
    }
  }

  return sources
}

export function buildProfile() {
  const sources = gatherFiles()

  if (sources.length === 0) {
    // No CLAUDE.md found — return a minimal generic profile
    // User can create ~/.claude/CLAUDE.md to get personalized results
    console.log('\n  No CLAUDE.md found. Using generic profile.')
    console.log('  Tip: Create ~/.claude/CLAUDE.md with your role and tech stack for personalized results.\n')
    return {
      name: 'User',
      role: 'AI Developer',
      domains: ['software development', 'AI tooling'],
      tools_installed: [],
      daily_workflows: ['coding', 'AI agent building'],
      tech_stack: ['JavaScript', 'Python', 'TypeScript'],
      gaps: ['testing', 'deployment', 'monitoring', 'database'],
      search_keywords: ['claude code skills', 'MCP server', 'AI tools 2025', 'developer tools', 'coding assistant'],
      summary: 'AI developer looking for tools to enhance their workflow. No profile found — create ~/.claude/CLAUDE.md for personalized recommendations.',
      sources_read: [],
    }
  }

  // Merge all content for parsing
  const combined = sources.map(s => s.content).join('\n\n')

  // Extract name from "About [Name]" heading
  const nameMatch = combined.match(/## About (\w+)/i)
  const name = nameMatch ? nameMatch[1] : 'User'

  // Extract role from first bullet under About section
  const aboutSection = extractSection(combined, `About ${name}`)
  const aboutBullets = extractBullets(aboutSection)
  const role = aboutBullets[0] || 'AI Power User'

  // Extract tech stack from Expertise line
  const techStack = extractInlineList(combined, 'Expertise')

  // Extract domains from Current focus line
  const domains = extractInlineList(combined, 'Current focus')

  // Extract installed skills from skills sections
  const toolsInstalled = extractInstalledSkills(combined)

  // Extract daily workflows from any workflow-related sections
  const workflowSection = extractSection(combined, 'Workflow') ||
                          extractSection(combined, 'GSD') ||
                          extractSection(combined, 'Task Management')
  const dailyWorkflows = extractBullets(workflowSection).slice(0, 6)

  // Infer gaps: what's commonly needed but not installed
  const commonTools = ['playwright', 'testing', 'deployment', 'ci-cd', 'monitoring', 'analytics', 'voice', 'database']
  const gaps = commonTools.filter(t => !toolsInstalled.some(i => i.includes(t)))

  // Build search keywords from tech stack + domains
  const searchKeywords = [
    ...techStack.slice(0, 3).map(t => `${t} MCP server`),
    ...domains.slice(0, 2).map(d => `${d} AI tools`),
    'claude code skills new',
    'MCP server 2025',
  ].slice(0, 8)

  return {
    name,
    role,
    domains: domains.length ? domains : ['design', 'development', 'AI tooling'],
    tools_installed: toolsInstalled,
    daily_workflows: dailyWorkflows.length ? dailyWorkflows : ['design work', 'development', 'AI tooling'],
    tech_stack: techStack.length ? techStack : ['React', 'Figma', 'TypeScript'],
    gaps,
    search_keywords: searchKeywords,
    summary: `${role}. Works with ${techStack.slice(0, 3).join(', ')}. Has ${toolsInstalled.length} skills installed. Needs tools for: ${gaps.slice(0, 3).join(', ')}.`,
    sources_read: sources.map(s => s.label),
  }
}
