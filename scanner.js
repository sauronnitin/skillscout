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
    const result = await tfSearch('claude code skills site:shipables.dev')
    return (result.results || []).map(t => normalizeTool(t, 'shipables.dev'))
  }
}

async function scanGitHubMCP(keywords) {
  console.log('  [TinyFish Search] Finding GitHub MCP servers...')
  const queries = [
    'new MCP server for claude code 2025 github',
    `${keywords.slice(0, 2).join(' ')} MCP server github open source`,
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
  try {
    const result = await tfFetch(['https://registry.npmjs.org/-/v1/search?text=mcp+claude&size=20'])
    const page = result.results?.[0]
    if (!page?.text) return []
    // npm returns JSON as text — parse objects from markdown
    const objects = page.text.match(/"name":"([^"]+)"/g) || []
    return objects.slice(0, 10).map(m => {
      const name = m.match(/"name":"([^"]+)"/)?.[1] || ''
      return normalizeTool({ name, install_cmd: `npm install ${name}`, url: `https://npmjs.com/package/${name}` }, 'npmjs.com')
    })
  } catch (e) {
    console.log(`  [TinyFish] npm scan failed: ${e.message}`)
    return []
  }
}

async function scanHackerNews(keywords) {
  console.log('  [TinyFish Search] Scanning Hacker News for new AI tools...')
  try {
    const q = `${keywords.slice(0, 2).join(' ')} AI agent tool MCP released site:news.ycombinator.com`
    const result = await tfSearch(q)
    return (result.results || [])
      .filter(t => {
        const text = `${t.title} ${t.snippet}`.toLowerCase()
        return text.includes('mcp') || text.includes('claude') || text.includes('agent')
      })
      .map(t => normalizeTool(t, 'hackernews'))
  } catch { return [] }
}

async function scanKeywords(keywords) {
  console.log('  [TinyFish Search] Running keyword searches...')
  const all = []
  for (const kw of keywords.slice(0, 3)) {
    try {
      const result = await tfSearch(`new ${kw} tool 2025`)
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
    if (key !== 'unknown' && !seen.has(key)) seen.set(key, t)
  }
  return Array.from(seen.values())
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function scanWeb(profile) {
  const keywords = profile.search_keywords || ['claude code', 'MCP server', 'AI tools']
  console.log('\n  TinyFish parallel scans starting...')

  const [shipables, github, npm, hn, kw] = await Promise.allSettled([
    scanShipables(),
    scanGitHubMCP(keywords),
    scanNpm(keywords),
    scanHackerNews(keywords),
    scanKeywords(keywords),
  ])

  // Log any failures so they're visible
  const results = { shipables, github, npm, hn, kw }
  for (const [name, r] of Object.entries(results)) {
    if (r.status === 'rejected') {
      console.log(`  [!] ${name} scan failed: ${r.reason?.message || r.reason}`)
    }
  }

  const all = [
    ...(shipables.status === 'fulfilled' ? shipables.value : []),
    ...(github.status  === 'fulfilled' ? github.value  : []),
    ...(npm.status     === 'fulfilled' ? npm.value     : []),
    ...(hn.status      === 'fulfilled' ? hn.value      : []),
    ...(kw.status      === 'fulfilled' ? kw.value      : []),
  ]

  const unique = dedup(all)
  console.log(`  Found ${unique.length} unique tools across all sources`)
  return unique
}
