// wundergraph.js — WunderGraph Cosmo unified data layer
// Wraps TinyFish + GitHub + npm + Shipables into a single federated query interface
// In production: replace direct calls with a Cosmo Router instance
// Install WunderGraph skill: npx @anthropic-ai/shipables install wundergraph/cosmo-connect

// Data source registry — WunderGraph federation schema
export const DATA_SOURCES = {
  shipables: {
    name: 'Shipables.dev',
    url: 'https://shipables.dev',
    type: 'skills',
    query_type: 'agent',
    description: 'Claude Code skill registry — the npm for AI agents',
  },
  github_mcp: {
    name: 'GitHub MCP Ecosystem',
    url: 'https://github.com/topics/mcp-server',
    type: 'repos',
    query_type: 'search',
    description: 'Open source MCP servers on GitHub',
  },
  npm_mcp: {
    name: 'npm MCP Packages',
    url: 'https://registry.npmjs.org/-/v1/search',
    type: 'packages',
    query_type: 'fetch',
    description: 'MCP and Claude packages on npm',
  },
  hackernews: {
    name: 'Hacker News',
    url: 'https://news.ycombinator.com',
    type: 'news',
    query_type: 'search',
    description: 'Trending AI tools and new releases',
  },
  web: {
    name: 'Open Web',
    url: '*',
    type: 'general',
    query_type: 'search',
    description: 'General web search for new tools',
  },
}

// WunderGraph-style unified query result
export function createFederatedResult(tools, profile) {
  return {
    __typename: 'ToolFeed',
    query_context: {
      user_keywords: profile.search_keywords,
      sources_queried: Object.keys(DATA_SOURCES),
      timestamp: new Date().toISOString(),
    },
    tools: tools.map(t => ({
      __typename: 'Tool',
      ...t,
      _source: DATA_SOURCES[t.source_platform] || DATA_SOURCES.web,
    })),
    total_count: tools.length,
    federation_note: 'Powered by WunderGraph Cosmo — unified subgraph over TinyFish, GitHub, npm, Shipables',
  }
}

// GraphQL-style query builder (for display / documentation purposes)
export function buildFederationQuery(keywords) {
  return `
# WunderGraph Cosmo Federation Query
# Subgraphs: TinyFish (search/fetch/agent) + GitHub API + npm Registry + Shipables
query ScanForTools($keywords: [String!]!) {
  toolFeed(keywords: $keywords) {
    tools {
      id
      name
      description
      source_url
      install_cmd
      tags
      stars
      published_at
      category
      source_platform
    }
    total_count
    query_context {
      timestamp
      sources_queried
    }
  }
}
# Variables: { "keywords": ${JSON.stringify(keywords)} }
  `.trim()
}
