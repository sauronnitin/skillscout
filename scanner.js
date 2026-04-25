// scanner.js — TinyFish web scanner
//
// Procedure for each source:
//   STEP 1 — Search/Fetch a page that LISTS tools (directory, awesome list, registry)
//   STEP 2 — Extract structured tool records from the page content
//   STEP 3 — For top search results, fetch the actual page to get full description
//   STEP 4 — Normalize into {name, description, url, install_cmd, tags, category}
//
// TinyFish endpoints:
//   Search: GET  https://api.search.tinyfish.ai?query=...
//   Fetch:  POST https://api.fetch.tinyfish.ai  { urls: string[], format: 'markdown' }
//   Agent:  POST https://agent.tinyfish.ai/v1/automation/run  { url, goal }
//   Auth:   X-API-Key header

const KEY = () => (process.env.TINYFISH_API_KEY || '').trim()
const HEADERS = () => ({ 'X-API-Key': KEY(), 'Content-Type': 'application/json' })

// ─── TinyFish wrappers ────────────────────────────────────────────────────────

async function tfSearch(query) {
  const url = `https://api.search.tinyfish.ai?query=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { 'X-API-Key': KEY() } })
  if (!res.ok) throw new Error(`Search ${res.status}: ${await res.text()}`)
  return res.json()
}

async function tfFetch(urls) {
  const batch = (Array.isArray(urls) ? urls : [urls]).slice(0, 10)
  const res = await fetch('https://api.fetch.tinyfish.ai', {
    method: 'POST',
    headers: HEADERS(),
    body: JSON.stringify({ urls: batch, format: 'markdown' }),
  })
  if (!res.ok) throw new Error(`Fetch ${res.status}: ${await res.text()}`)
  return res.json()
}

async function tfAgent(goal, url) {
  const res = await fetch('https://agent.tinyfish.ai/v1/automation/run', {
    method: 'POST',
    headers: HEADERS(),
    body: JSON.stringify({ url, goal }),
  })
  if (!res.ok) throw new Error(`Agent ${res.status}: ${await res.text()}`)
  return res.json()
}

// ─── Page content parsers ─────────────────────────────────────────────────────

// Parse a markdown page for tool entries — works on awesome lists, directories
function parseMarkdownToolList(text, sourceUrl, platform) {
  const tools = []

  // Pattern 1: "- [Name](url) — description" or "- [Name](url): description"
  const linkPattern = /[-*]\s+\[([^\]]{2,60})\]\(([^)]+)\)[:\s—–-]+([^\n]{5,150})/g
  let m
  while ((m = linkPattern.exec(text)) !== null) {
    tools.push(normalizeTool({
      name: m[1].trim(),
      url: m[2],
      description: m[3].trim(),
    }, platform))
  }

  // Pattern 2: "## Tool Name\ndescription paragraph"
  const sectionPattern = /^#{1,3}\s+([^\n]{3,60})\n([^\n#]{10,200})/gm
  while ((m = sectionPattern.exec(text)) !== null && tools.length < 60) {
    const name = m[1].replace(/[`*]/g, '').trim()
    if (!name.match(/^(Table|Contents|Installation|Overview|License|Contributing|Usage|Features|Setup|Getting|How|What|Why|About|Note|Warning)/i)) {
      tools.push(normalizeTool({ name, description: m[2].trim(), url: sourceUrl }, platform))
    }
  }

  // Pattern 3: "**Name** — description" inline bold entries
  const boldPattern = /\*\*([^*]{3,50})\*\*\s*[—–:]\s*([^\n]{5,150})/g
  while ((m = boldPattern.exec(text)) !== null && tools.length < 80) {
    tools.push(normalizeTool({ name: m[1].trim(), description: m[2].trim(), url: sourceUrl }, platform))
  }

  return tools
}

// Extract tool cards from a rendered HTML page (via markdown conversion)
function parseToolCards(text, sourceUrl, platform) {
  const tools = []
  const lines = text.split('\n').filter(l => l.trim())

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim()
    const next = lines[i + 1]?.trim() || ''

    // A tool card: short title line followed by description
    if (
      line.length >= 3 && line.length <= 60 &&
      !line.startsWith('http') &&
      !line.match(/^[#|>]/) &&
      next.length > 15 && next.length < 200 &&
      !next.startsWith('#')
    ) {
      tools.push(normalizeTool({
        name: line.replace(/[*`#]/g, '').trim(),
        description: next.replace(/[*`]/g, '').trim(),
        url: sourceUrl,
      }, platform))
      i++ // skip description line
    }
  }

  return tools.slice(0, 30)
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

function normalizeTool(raw, sourcePlatform) {
  const name = (raw.name || raw.title || 'Unknown').replace(/[#*`[\]]/g, '').trim()
  if (!name || name.length < 2) return null
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    description: (raw.description || raw.snippet || raw.summary || '').slice(0, 300),
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
  const name = (raw.name || '').toLowerCase().replace(/\s+/g, '-')
  const url = raw.url || ''
  if (url.includes('npmjs.com') || url.includes('npm')) return `npm install ${name}`
  if (url.includes('github.com')) {
    const slug = url.match(/github\.com\/([^/]+\/[^/]+)/)?.[1]
    return slug ? `# git clone https://github.com/${slug}` : `# See ${url}`
  }
  if (name.includes('mcp')) return `npx @modelcontextprotocol/cli install ${name}`
  return `npx shipables install ${name}`
}

function detectCategory(raw) {
  const text = `${raw.name || ''} ${raw.description || ''} ${(raw.tags || []).join(' ')}`.toLowerCase()
  if (text.includes('mcp') || text.includes('model context protocol')) return 'MCP Server'
  if (text.includes('skill') || text.includes('slash command')) return 'Claude Skill'
  if (text.includes('plugin')) return 'Plugin'
  if (text.includes('extension')) return 'Extension'
  if (text.includes('cli') || text.includes('tool')) return 'CLI Tool'
  return 'Tool / Repo'
}

// ─── Source scrapers ──────────────────────────────────────────────────────────

// SOURCE 1: Shipables.dev — Claude skill registry
// Procedure: TinyFish Agent → extract structured JSON list of all skills
async function scanShipables() {
  console.log('  [Agent] shipables.dev — extracting skill list...')
  try {
    const result = await tfAgent(
      'List all Claude Code skills and tools available on this page. For each return a JSON object with: name, description, install_cmd, tags. Respond ONLY with a JSON array, no other text.',
      'https://shipables.dev'
    )
    const raw = result.result
    const arr = Array.isArray(raw) ? raw
      : typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return [] } })()
      : (raw?.tools || raw?.skills || raw?.items || [])
    return arr.map(t => normalizeTool(t, 'shipables.dev')).filter(Boolean)
  } catch (e) {
    console.log(`  [!] shipables agent failed: ${e.message} — fetching page directly...`)
    try {
      // Fallback: fetch the page and parse it
      const result = await tfFetch(['https://shipables.dev'])
      const text = result.results?.[0]?.text || ''
      return parseMarkdownToolList(text, 'https://shipables.dev', 'shipables.dev')
    } catch { return [] }
  }
}

// SOURCE 2: awesome-mcp-servers (punkpeye/awesome-mcp-servers)
// Procedure: tfFetch raw README → parse all markdown link entries
async function scanAwesomeMcpServers() {
  console.log('  [Fetch] awesome-mcp-servers README → parse link list...')
  const urls = [
    'https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md',
    'https://raw.githubusercontent.com/wong2/awesome-mcp-servers/main/README.md',
  ]
  try {
    const result = await tfFetch(urls)
    const tools = []
    for (const page of (result.results || [])) {
      if (page?.text) {
        tools.push(...parseMarkdownToolList(page.text, page.url || urls[0], 'awesome-mcp-servers'))
      }
    }
    return tools
  } catch (e) {
    console.log(`  [!] awesome-mcp-servers fetch failed: ${e.message}`)
    return []
  }
}

// SOURCE 3: mcp.so — MCP server directory
// Procedure: tfFetch page → parse tool cards, fallback to search
async function scanMcpSo() {
  console.log('  [Fetch] mcp.so — MCP server directory...')
  try {
    const result = await tfFetch(['https://mcp.so/servers', 'https://mcp.so'])
    const tools = []
    for (const page of (result.results || [])) {
      if (page?.text) {
        tools.push(...parseMarkdownToolList(page.text, 'https://mcp.so', 'mcp.so'))
        tools.push(...parseToolCards(page.text, 'https://mcp.so', 'mcp.so'))
      }
    }
    if (tools.length < 3) {
      // Fallback: search
      const r = await tfSearch('site:mcp.so MCP server list 2025')
      tools.push(...(r.results || []).map(t => normalizeTool(t, 'mcp.so')).filter(Boolean))
    }
    return tools
  } catch (e) {
    console.log(`  [!] mcp.so failed: ${e.message}`)
    return []
  }
}

// SOURCE 4: glama.ai/mcp/servers — curated MCP registry
// Procedure: tfFetch page → parse tool cards + links
async function scanGlamaAI() {
  console.log('  [Fetch] glama.ai/mcp/servers — curated MCP registry...')
  try {
    const result = await tfFetch(['https://glama.ai/mcp/servers'])
    const tools = []
    for (const page of (result.results || [])) {
      if (page?.text) {
        tools.push(...parseMarkdownToolList(page.text, 'https://glama.ai/mcp/servers', 'glama.ai'))
        tools.push(...parseToolCards(page.text, 'https://glama.ai/mcp/servers', 'glama.ai'))
      }
    }
    if (tools.length < 3) {
      const r = await tfSearch('site:glama.ai MCP server')
      tools.push(...(r.results || []).map(t => normalizeTool(t, 'glama.ai')).filter(Boolean))
    }
    return tools
  } catch (e) {
    console.log(`  [!] glama.ai failed: ${e.message}`)
    return []
  }
}

// SOURCE 5: npm registry — search for @modelcontextprotocol + mcp + claude packages
// Procedure: tfFetch npm search JSON → parse package names + descriptions
async function scanNpm() {
  console.log('  [Fetch] npm registry — MCP + Claude packages...')
  const queries = [
    'https://registry.npmjs.org/-/v1/search?text=%40modelcontextprotocol&size=25',
    'https://registry.npmjs.org/-/v1/search?text=mcp+server&size=25',
    'https://registry.npmjs.org/-/v1/search?text=claude+skill&size=15',
    'https://registry.npmjs.org/-/v1/search?text=claude+code+mcp&size=15',
  ]
  const tools = []
  try {
    const result = await tfFetch(queries)
    for (const page of (result.results || [])) {
      if (!page?.text) continue
      // npm JSON in markdown — extract "name":"...", "description":"..."
      const nameMatches = [...page.text.matchAll(/"name"\s*:\s*"([^"]{2,80})"/g)]
      const descMatches = [...page.text.matchAll(/"description"\s*:\s*"([^"]{3,200})"/g)]
      for (let i = 0; i < Math.min(nameMatches.length, 20); i++) {
        const name = nameMatches[i]?.[1]
        const desc = descMatches[i]?.[1] || ''
        if (name) {
          tools.push(normalizeTool({
            name,
            description: desc,
            url: `https://npmjs.com/package/${name}`,
            install_cmd: `npm install ${name}`,
          }, 'npmjs.com'))
        }
      }
    }
  } catch (e) {
    console.log(`  [!] npm scan failed: ${e.message}`)
  }
  return tools.filter(Boolean)
}

// SOURCE 6: GitHub search — developer tools, claude repos, skills (not just MCP)
// Procedure: tfSearch → collect URLs → tfFetch top repo READMEs for descriptions
async function scanGitHubMCP(keywords) {
  console.log('  [Search→Fetch] GitHub — developer tools + claude repos...')
  const queries = [
    'site:github.com topic:mcp-server claude 2025',
    'site:github.com claude-code skill SKILL.md stars:>10',
    `site:github.com "${keywords[0] || 'developer'}" AI tool 2025`,
    'site:github.com awesome developer tools AI 2025 stars:>100',
    'site:github.com VS Code extension AI productivity 2025',
  ]
  const searchResults = []
  for (const q of queries) {
    try {
      const r = await tfSearch(q)
      searchResults.push(...(r.results || []))
    } catch { /* continue */ }
  }

  // STEP 2: fetch top repo pages to get real descriptions
  const repoUrls = [...new Set(
    searchResults
      .map(r => r.url)
      .filter(u => u && u.includes('github.com'))
      .slice(0, 8)
  )]

  let repoTools = searchResults.map(r => normalizeTool(r, 'github.com')).filter(Boolean)

  if (repoUrls.length > 0) {
    try {
      const fetchResult = await tfFetch(repoUrls)
      for (const page of (fetchResult.results || [])) {
        if (page?.text) {
          repoTools.push(...parseMarkdownToolList(page.text, page.url, 'github.com'))
        }
      }
    } catch { /* use search results as-is */ }
  }

  return repoTools
}

// SOURCE 7: awesome-claude-skills — travisvn + VoltAgent indexes
// Procedure: tfFetch raw README → parse all skill entries
async function scanAwesomeClaudeSkills() {
  console.log('  [Fetch] awesome-claude-skills — skill directories...')
  const urls = [
    'https://raw.githubusercontent.com/travisvn/awesome-claude-skills/main/README.md',
    'https://raw.githubusercontent.com/VoltAgent/awesome-agent-skills/main/README.md',
  ]
  const tools = []
  try {
    const result = await tfFetch(urls)
    for (const page of (result.results || [])) {
      if (page?.text) {
        tools.push(...parseMarkdownToolList(page.text, page.url || urls[0], 'awesome-claude-skills'))
      }
    }
  } catch (e) {
    console.log(`  [!] awesome-claude-skills fetch failed: ${e.message}`)
    try {
      const r = await tfSearch('awesome claude code skills list github 2025')
      tools.push(...(r.results || []).map(t => normalizeTool(t, 'github.com')).filter(Boolean))
    } catch { /* ignore */ }
  }
  return tools
}

// SOURCE 8: Hacker News — Show HN posts for new AI tools
// Procedure: tfSearch HN → collect titles/snippets as tools
async function scanHackerNews(keywords) {
  console.log('  [Search] Hacker News — Show HN AI tools + MCP...')
  const queries = [
    'Show HN MCP server claude 2025 site:news.ycombinator.com',
    'Show HN AI developer tool 2025 site:news.ycombinator.com',
    `"Show HN" "${keywords[0] || 'claude'}" site:news.ycombinator.com`,
  ]
  const tools = []
  for (const q of queries) {
    try {
      const r = await tfSearch(q)
      const relevant = (r.results || []).filter(t => {
        const text = `${t.title} ${t.snippet}`.toLowerCase()
        return text.includes('mcp') || text.includes('claude') || text.includes('ai tool') || text.includes('developer')
      })
      tools.push(...relevant.map(t => normalizeTool(t, 'hackernews')).filter(Boolean))
    } catch { /* continue */ }
  }
  return tools
}

// SOURCE 9: Broad developer tool discovery — VS Code marketplace, dev blogs, tooling lists
// Procedure: tfFetch curated non-MCP tool lists + tfSearch for stack-specific tools
async function scanDevTools(keywords) {
  console.log('  [Fetch+Search] Developer tools — VS Code, CLI, productivity...')
  const tools = []
  // Fetch curated non-MCP awesome lists
  const listUrls = [
    'https://raw.githubusercontent.com/viatsko/awesome-vscode/master/README.md',
    'https://raw.githubusercontent.com/stevemao/awesome-git-addons/master/README.md',
  ]
  try {
    const result = await tfFetch(listUrls)
    for (const page of (result.results || [])) {
      if (page?.text) {
        tools.push(...parseMarkdownToolList(page.text, page.url, 'awesome-devtools'))
      }
    }
  } catch { /* continue to search */ }

  // Stack-specific tool searches (not MCP)
  const stackQueries = keywords
    .filter(kw => !kw.toLowerCase().includes('mcp'))
    .slice(0, 3)
  for (const q of stackQueries) {
    try {
      const r = await tfSearch(q)
      tools.push(...(r.results || []).map(t => normalizeTool(t, 'web')).filter(Boolean))
    } catch { /* continue */ }
  }
  return tools
}

// SOURCE 10: ProductHunt — AI developer tools
// Procedure: tfSearch ProductHunt → collect product descriptions
async function scanProductHunt(keywords) {
  console.log('  [Search] ProductHunt — AI developer tools...')
  const q = `site:producthunt.com AI developer tool MCP claude 2025`
  try {
    const r = await tfSearch(q)
    return (r.results || [])
      .filter(t => {
        const text = `${t.title} ${t.snippet}`.toLowerCase()
        return text.includes('ai') || text.includes('developer') || text.includes('mcp') || text.includes('code')
      })
      .map(t => normalizeTool(t, 'producthunt.com')).filter(Boolean)
  } catch { return [] }
}

// SOURCE 11: Profile-keyword searches — targeted to user's actual stack
// Procedure: build queries from profile tech_stack + gaps → tfSearch → tfFetch top results
async function scanProfileKeywords(keywords, profile) {
  console.log('  [Search→Fetch] Targeted searches for your tech stack...')
  const stack = (profile.tech_stack || []).slice(0, 4)
  const gaps = (profile.gaps || []).slice(0, 3)

  const queries = [
    ...stack.map(t => `${t} MCP server claude integration 2025`),
    ...gaps.map(g => `${g} AI tool developer 2025`),
    ...keywords.slice(0, 4).map(kw => `new ${kw} 2025`),
    'best MCP servers for developers 2025',
    'claude code extensions plugins 2025',
  ]

  const allResults = []
  for (const q of queries.slice(0, 8)) {
    try {
      const r = await tfSearch(q)
      allResults.push(...(r.results || []))
    } catch { /* continue */ }
  }

  // Fetch the top unique URLs to get full descriptions
  const topUrls = [...new Set(
    allResults
      .filter(r => r.url && !r.url.includes('youtube') && !r.url.includes('reddit'))
      .map(r => r.url)
      .slice(0, 6)
  )]

  const tools = allResults.map(r => normalizeTool(r, 'web')).filter(Boolean)

  if (topUrls.length > 0) {
    try {
      const fetchResult = await tfFetch(topUrls)
      for (const page of (fetchResult.results || [])) {
        if (page?.text) {
          tools.push(...parseMarkdownToolList(page.text, page.url, 'web'))
        }
      }
    } catch { /* use search results only */ }
  }

  return tools
}

// ─── Dedup ────────────────────────────────────────────────────────────────────

function dedup(tools) {
  const seen = new Map()
  for (const t of tools) {
    if (!t) continue
    const key = t.name.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
    if (key.length > 2 && key !== 'unknown' && !seen.has(key)) seen.set(key, t)
  }
  return Array.from(seen.values())
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function scanWeb(profile, onProgress) {
  const keywords = profile.search_keywords || ['claude code', 'MCP server', 'AI tools']
  const emit = (source, status, count = 0) => {
    console.log(status === 'done' ? `  ✓ ${source}: ${count} tools` : `  ✗ ${source}: ${count}`)
    if (onProgress) onProgress({ source, status, count })
  }

  console.log('\n  Scanning 11 sources in parallel...')

  // Wrap each scanner so it emits progress when done
  const wrap = (name, fn) => fn.then(r => { emit(name, 'done', r.length); return r })
                                .catch(e => { emit(name, 'error', e.message); return [] })

  const results = await Promise.all([
    wrap('shipables',     scanShipables()),
    wrap('awesome-mcp',   scanAwesomeMcpServers()),
    wrap('mcp.so',        scanMcpSo()),
    wrap('glama.ai',      scanGlamaAI()),
    wrap('npm',           scanNpm()),
    wrap('github',        scanGitHubMCP(keywords)),
    wrap('claude-skills', scanAwesomeClaudeSkills()),
    wrap('hackernews',    scanHackerNews(keywords)),
    wrap('devtools',      scanDevTools(keywords)),
    wrap('producthunt',   scanProductHunt(keywords)),
    wrap('keywords',      scanProfileKeywords(keywords, profile)),
  ])

  const all = results.flat()
  const unique = dedup(all)
  console.log(`\n  Raw: ${all.length} → Deduped: ${unique.length} unique tools`)
  if (onProgress) onProgress({ source: '__done__', status: 'done', count: unique.length })
  return unique
}
