// scanner.js — TinyFish web scanner (real API endpoints from docs.tinyfish.ai)
//
// TinyFish endpoints:
//   Search: GET  https://api.search.tinyfish.ai?query=...
//   Fetch:  POST https://api.fetch.tinyfish.ai       { urls: string[] }
//   Agent:  POST https://agent.tinyfish.ai/v1/automation/run  { url, goal }
//   Auth:   X-API-Key header (NOT Authorization: Bearer)

const KEY = () => (process.env.TINYFISH_API_KEY || '').trim()
const HEADERS = () => ({ 'X-API-Key': KEY(), 'Content-Type': 'application/json' })

// ─── TinyFish API wrappers ────────────────────────────────────────────────────

async function tfSearch(query) {
  const url = `https://api.search.tinyfish.ai?query=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { 'X-API-Key': KEY() } })
  if (!res.ok) throw new Error(`Search failed ${res.status}: ${await res.text()}`)
  return res.json() // { query, results: [{position, site_name, snippet, title, url}], total_results }
}

async function tfFetch(urls) {
  // Accepts up to 10 URLs per request
  const batch = Array.isArray(urls) ? urls.slice(0, 10) : [urls]
  const res = await fetch('https://api.fetch.tinyfish.ai', {
    method: 'POST',
    headers: HEADERS(),
    body: JSON.stringify({ urls: batch, format: 'markdown' }),
  })
  if (!res.ok) throw new Error(`Fetch failed ${res.status}: ${await res.text()}`)
  return res.json() // { results: [{url, title, description, text, ...}], errors: [] }
}

async function tfAgent(goal, url) {
  const res = await fetch('https://agent.tinyfish.ai/v1/automation/run', {
    method: 'POST',
    headers: HEADERS(),
    body: JSON.stringify({ url, goal }),
  })
  if (!res.ok) throw new Error(`Agent failed ${res.status}: ${await res.text()}`)
  return res.json() // { run_id, status, result }
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

function normalizeTool(raw, sourcePlatform) {
  const name = raw.name || raw.title || 'Unknown'
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    description: raw.description || raw.snippet || raw.summary || '',
    source_url: raw.url || raw.html_url || raw.link || '',
    install_cmd: raw.install_cmd || raw.install || guessInstallCmd(raw),
    tags: raw.tags || raw.topics || [],
    stars: raw.stars || raw.stargazers_count || 0,
    published_at: raw.published_at || raw.created_at || raw.date || new Date().toISOString(),
    category: detectCategory(raw),
    source_platform: sourcePlatform,
  }
}

function guessInstallCmd(raw) {
  const name = (raw.name || '').toLowerCase()
  if (raw.shipables_slug) return `npx shipables install ${raw.shipables_slug}`
  if (name.includes('mcp')) return `npx @modelcontextprotocol/cli install ${name}`
  if (raw.npm_package || raw.url?.includes('npmjs.com')) return `npm install ${raw.npm_package || name}`
  if (raw.url?.includes('github.com')) return `# See ${raw.url}`
  return `npx shipables install ${name}`
}

function detectCategory(raw) {
  const text = `${raw.name || ''} ${raw.description || ''} ${(raw.tags || []).join(' ')}`.toLowerCase()
  if (text.includes('mcp')) return 'MCP Server'
  if (text.includes('skill')) return 'Claude Skill'
  if (text.includes('plugin')) return 'Plugin'
  if (text.includes('extension')) return 'Extension'
  return 'Tool / Repo'
}

// ─── Scan sources ─────────────────────────────────────────────────────────────

async function scanShipables() {
  console.log('  [TinyFish Agent] Extracting skills from shipables.dev...')
  try {
    const result = await tfAgent(
      'List all Claude Code skills available on this page. For each skill return: name, description, install_cmd, tags. Return as a JSON array.',
      'https://shipables.dev'
    )
    const items = result.result
    const arr = Array.isArray(items) ? items : (items?.tools || items?.skills || items?.items || [])
    return arr.map(t => normalizeTool(t, 'shipables.dev'))
  } catch (e) {
    console.log(`  [TinyFish] shipables agent failed (${e.message}), falling back to search...`)
    try {
      const result = await tfSearch('claude code skills site:shipables.dev')
      return (result.results || []).map(t => normalizeTool(t, 'shipables.dev'))
    } catch { return [] }
  }
}

async function scanGitHubMCP(keywords) {
  console.log('  [TinyFish Search] Finding GitHub MCP servers...')
  const queries = [
    'new MCP server for claude code 2025 github',
    `${keywords.slice(0, 2).join(' ')} MCP server github open source`,
    'awesome MCP servers list github 2025',
    'model context protocol server github',
  ]
  const all = []
  for (const q of queries) {
    try {
      const result = await tfSearch(q)
      all.push(...(result.results || []).map(t => normalizeTool(t, 'github.com')))
    } catch { /* continue */ }
  }
  return all
}

async function scanNpm(keywords) {
  console.log('  [TinyFish Fetch] Scanning npm for MCP/Claude packages...')
  const queries = [
    'https://registry.npmjs.org/-/v1/search?text=mcp+claude&size=20',
    'https://registry.npmjs.org/-/v1/search?text=%40modelcontextprotocol&size=20',
    'https://registry.npmjs.org/-/v1/search?text=claude+skill&size=10',
  ]
  const all = []
  try {
    const result = await tfFetch(queries)
    for (const page of (result.results || [])) {
      if (!page?.text) continue
      const objects = page.text.match(/"name":"([^"]+)"/g) || []
      objects.slice(0, 15).forEach(m => {
        const name = m.match(/"name":"([^"]+)"/)?.[1] || ''
        if (name) all.push(normalizeTool({ name, install_cmd: `npm install ${name}`, url: `https://npmjs.com/package/${name}` }, 'npmjs.com'))
      })
    }
  } catch (e) {
    console.log(`  [TinyFish] npm scan failed: ${e.message}`)
  }
  return all
}

async function scanHackerNews(keywords) {
  console.log('  [TinyFish Search] Scanning Hacker News for new AI tools...')
  const queries = [
    `${keywords.slice(0, 2).join(' ')} AI agent tool MCP released site:news.ycombinator.com`,
    'Show HN MCP server claude code 2025',
    'Show HN AI developer tools 2025 site:news.ycombinator.com',
  ]
  const all = []
  for (const q of queries) {
    try {
      const result = await tfSearch(q)
      const filtered = (result.results || []).filter(t => {
        const text = `${t.title} ${t.snippet}`.toLowerCase()
        return text.includes('mcp') || text.includes('claude') || text.includes('agent') || text.includes('ai tool')
      })
      all.push(...filtered.map(t => normalizeTool(t, 'hackernews')))
    } catch { /* continue */ }
  }
  return all
}

async function scanMcpSo() {
  console.log('  [TinyFish Fetch] Scanning mcp.so registry...')
  try {
    const result = await tfFetch(['https://mcp.so'])
    const page = result.results?.[0]
    if (!page?.text) return []
    // Parse tool names from the page text
    const lines = page.text.split('\n').filter(l => l.trim().length > 5 && l.trim().length < 120)
    const tools = []
    for (const line of lines.slice(0, 40)) {
      const trimmed = line.replace(/[#*\[\]|]/g, '').trim()
      if (trimmed && !trimmed.startsWith('http') && trimmed.split(' ').length <= 8) {
        tools.push(normalizeTool({
          name: trimmed.split(' ').slice(0, 4).join(' '),
          description: trimmed,
          url: 'https://mcp.so',
        }, 'mcp.so'))
      }
    }
    return tools.slice(0, 15)
  } catch (e) {
    console.log(`  [TinyFish] mcp.so scan failed: ${e.message}`)
    // Fallback: search for mcp.so tools
    try {
      const result = await tfSearch('MCP server tools site:mcp.so')
      return (result.results || []).map(t => normalizeTool(t, 'mcp.so'))
    } catch { return [] }
  }
}

async function scanGlamaAI() {
  console.log('  [TinyFish Fetch] Scanning glama.ai MCP servers...')
  try {
    const result = await tfFetch(['https://glama.ai/mcp/servers'])
    const page = result.results?.[0]
    if (!page?.text) return []
    const lines = page.text.split('\n').filter(l => l.trim())
    const tools = []
    for (const line of lines.slice(0, 50)) {
      const nameMatch = line.match(/##\s+(.+)/) || line.match(/\*\*([^*]{5,60})\*\*/)
      if (nameMatch) {
        tools.push(normalizeTool({
          name: nameMatch[1].trim(),
          description: line,
          url: 'https://glama.ai/mcp/servers',
        }, 'glama.ai'))
      }
    }
    return tools.slice(0, 15)
  } catch (e) {
    console.log(`  [TinyFish] glama.ai scan failed: ${e.message}`)
    try {
      const result = await tfSearch('MCP server site:glama.ai')
      return (result.results || []).map(t => normalizeTool(t, 'glama.ai'))
    } catch { return [] }
  }
}

async function scanProductHunt(keywords) {
  console.log('  [TinyFish Search] Scanning Product Hunt for AI tools...')
  const q = `${keywords.slice(0, 2).join(' ')} AI tool site:producthunt.com 2025`
  try {
    const result = await tfSearch(q)
    return (result.results || [])
      .filter(t => {
        const text = `${t.title} ${t.snippet}`.toLowerCase()
        return text.includes('ai') || text.includes('developer') || text.includes('mcp') || text.includes('assistant')
      })
      .map(t => normalizeTool(t, 'producthunt.com'))
  } catch { return [] }
}

async function scanAnthropicBlog() {
  console.log('  [TinyFish Fetch] Scanning Anthropic announcements...')
  try {
    const result = await tfFetch(['https://www.anthropic.com/news'])
    const page = result.results?.[0]
    if (!page?.text) return []
    const lines = page.text.split('\n').filter(l => l.trim().length > 10)
    const tools = []
    for (const line of lines.slice(0, 30)) {
      if (line.toLowerCase().includes('mcp') || line.toLowerCase().includes('claude code') || line.toLowerCase().includes('tool')) {
        tools.push(normalizeTool({
          name: line.replace(/[#*\[\]]/g, '').trim().slice(0, 60),
          description: line,
          url: 'https://www.anthropic.com/news',
        }, 'anthropic.com'))
      }
    }
    return tools.slice(0, 8)
  } catch (e) {
    console.log(`  [TinyFish] Anthropic blog scan failed: ${e.message}`)
    return []
  }
}

async function scanAwesomeMCPList() {
  console.log('  [TinyFish Fetch] Scanning awesome-mcp-servers list...')
  try {
    const result = await tfFetch([
      'https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md',
    ])
    const page = result.results?.[0]
    if (!page?.text) return []
    // Parse markdown list entries: "- [name](url) — description"
    const pattern = /[-*]\s+\[([^\]]+)\]\(([^)]+)\)[^\n]*/g
    const tools = []
    let m
    while ((m = pattern.exec(page.text)) !== null && tools.length < 30) {
      tools.push(normalizeTool({
        name: m[1],
        url: m[2],
        description: m[0].replace(/[-*\[\]()]/g, ' ').trim(),
      }, 'awesome-mcp-servers'))
    }
    return tools
  } catch (e) {
    console.log(`  [TinyFish] awesome-mcp-servers scan failed: ${e.message}`)
    try {
      const result = await tfSearch('awesome MCP servers list github punkpeye')
      return (result.results || []).map(t => normalizeTool(t, 'awesome-mcp-servers'))
    } catch { return [] }
  }
}

async function scanClaudeCodeSkills() {
  console.log('  [TinyFish Search] Finding Claude Code skills...')
  const queries = [
    'claude code skills list github awesome 2025',
    'site:github.com "claude code" skill SKILL.md',
    'travisvn awesome-claude-skills',
    'claude code slash commands plugins',
  ]
  const all = []
  for (const q of queries) {
    try {
      const result = await tfSearch(q)
      all.push(...(result.results || []).map(t => normalizeTool(t, 'github.com')))
    } catch { /* continue */ }
  }
  return all
}

async function scanKeywords(keywords) {
  console.log('  [TinyFish Search] Running targeted keyword searches...')
  const all = []
  // Build queries from profile keywords — tech stack + domains + gaps
  const queries = keywords.slice(0, 6).map(kw => `new ${kw} 2025`)
  // Also add generic high-value queries
  queries.push(
    'best MCP servers claude developer 2025',
    'new AI coding tools 2025 developer productivity',
    'model context protocol tools list',
  )
  for (const q of queries) {
    try {
      const result = await tfSearch(q)
      all.push(...(result.results || []).map(t => normalizeTool(t, 'web')))
    } catch { /* continue */ }
  }
  return all
}

// ─── Dedup ────────────────────────────────────────────────────────────────────

function dedup(tools) {
  const seen = new Map()
  for (const t of tools) {
    const key = t.name.toLowerCase().trim()
    if (key !== 'unknown' && key.length > 2 && !seen.has(key)) seen.set(key, t)
  }
  return Array.from(seen.values())
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function scanWeb(profile) {
  const keywords = profile.search_keywords || ['claude code', 'MCP server', 'AI tools']
  console.log('\n  TinyFish parallel scans starting (9 sources)...')

  const [
    shipables, github, npm, hn, mcpSo, glama,
    productHunt, anthropic, awesomeMcp, claudeSkills, kw
  ] = await Promise.allSettled([
    scanShipables(),
    scanGitHubMCP(keywords),
    scanNpm(keywords),
    scanHackerNews(keywords),
    scanMcpSo(),
    scanGlamaAI(),
    scanProductHunt(keywords),
    scanAnthropicBlog(),
    scanAwesomeMCPList(),
    scanClaudeCodeSkills(),
    scanKeywords(keywords),
  ])

  // Log any failures so they're visible
  const resultMap = { shipables, github, npm, hn, mcpSo, glama, productHunt, anthropic, awesomeMcp, claudeSkills, kw }
  for (const [name, r] of Object.entries(resultMap)) {
    if (r.status === 'rejected') {
      console.log(`  [!] ${name} scan failed: ${r.reason?.message || r.reason}`)
    }
  }

  const all = [
    ...(shipables.status     === 'fulfilled' ? shipables.value     : []),
    ...(github.status        === 'fulfilled' ? github.value        : []),
    ...(npm.status           === 'fulfilled' ? npm.value           : []),
    ...(hn.status            === 'fulfilled' ? hn.value            : []),
    ...(mcpSo.status         === 'fulfilled' ? mcpSo.value         : []),
    ...(glama.status         === 'fulfilled' ? glama.value         : []),
    ...(productHunt.status   === 'fulfilled' ? productHunt.value   : []),
    ...(anthropic.status     === 'fulfilled' ? anthropic.value     : []),
    ...(awesomeMcp.status    === 'fulfilled' ? awesomeMcp.value    : []),
    ...(claudeSkills.status  === 'fulfilled' ? claudeSkills.value  : []),
    ...(kw.status            === 'fulfilled' ? kw.value            : []),
  ]

  const unique = dedup(all)
  console.log(`  Found ${unique.length} unique tools across 11 sources`)
  return unique
}
