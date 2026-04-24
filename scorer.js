// scorer.js — Rule-based relevance scoring against user profile
// No external API — fast, deterministic, transparent
// TinyFish handles web intelligence; this scores what it finds

// Score a single tool against a user profile
function scoreTool(tool, profile) {
  const toolText = [
    tool.name,
    tool.description,
    ...(tool.tags || []),
    tool.category,
  ].join(' ').toLowerCase()

  let score = 0
  const matches = { stack: [], domains: [], gaps: [] }

  // Tech stack overlap (+15 each, capped)
  for (const tech of (profile.tech_stack || [])) {
    if (toolText.includes(tech.toLowerCase())) {
      score += 15
      matches.stack.push(tech)
    }
  }

  // Domain overlap (+10 each)
  for (const domain of (profile.domains || [])) {
    const words = domain.toLowerCase().split(/\s+/)
    if (words.some(w => w.length > 3 && toolText.includes(w))) {
      score += 10
      matches.domains.push(domain)
    }
  }

  // Gap match — highest weight (+20 each)
  for (const gap of (profile.gaps || [])) {
    const words = gap.toLowerCase().split(/\s+/)
    if (words.some(w => w.length > 3 && toolText.includes(w))) {
      score += 20
      matches.gaps.push(gap)
    }
  }

  // Category bonuses
  if (tool.category === 'MCP Server') score += 12   // MCP is hot right now
  if (tool.category === 'Claude Skill') score += 10  // directly installable
  if (tool.source_platform === 'shipables.dev') score += 8  // verified skill source

  // Popularity signal
  if (tool.stars > 500) score += 8
  else if (tool.stars > 100) score += 4

  // Already installed — skip
  if ((profile.tools_installed || []).some(t => t.toLowerCase() === tool.name.toLowerCase())) {
    return null // signals "already have it"
  }

  return { score: Math.min(score, 100), matches }
}

// Generate human-readable reasoning from match data
function generateReasoning(tool, profile, score, matches) {
  const stackMatches = matches.stack
  const domainMatches = matches.domains
  const gapMatches = matches.gaps

  let why = ''
  if (stackMatches.length > 0) {
    why = `Matches your ${stackMatches.slice(0, 2).join(' and ')} workflow`
  } else if (domainMatches.length > 0) {
    why = `Relevant to your ${domainMatches[0]} work`
  } else {
    why = `Useful for ${profile.domains?.[0] || 'your'} workflow`
  }

  let howItHelps = ''
  if (tool.category === 'MCP Server') {
    howItHelps = `Adds ${tool.name} awareness directly inside Claude Code`
  } else if (tool.category === 'Claude Skill') {
    howItHelps = `Extends Claude with ${tool.description?.split('.')[0] || tool.name} capabilities`
  } else {
    howItHelps = `Integrates ${tool.name} into your AI-assisted workflow`
  }

  let futureproofReason = ''
  if (gapMatches.length > 0) {
    futureproofReason = `Fills your identified gap in ${gapMatches[0]}`
  } else if (stackMatches.length > 0) {
    futureproofReason = `${stackMatches[0]} tooling is evolving fast — early adoption pays off`
  } else {
    futureproofReason = `${tool.category} adoption is accelerating across dev teams`
  }

  const priority = score >= 80 ? 'high' : score >= 65 ? 'medium' : 'low'

  return { why, how_it_helps: howItHelps, futureproof_reason: futureproofReason, priority }
}

// Main export — score all tools, return ranked list
export function scoreTools(tools, profile) {
  const scored = []

  for (const tool of tools) {
    const result = scoreTool(tool, profile)
    if (!result) continue // already installed

    const { score, matches } = result
    if (score < 40) continue // not relevant enough

    const reasoning = generateReasoning(tool, profile, score, matches)

    scored.push({
      ...tool,
      score,
      ...reasoning,
    })
  }

  // Sort by score descending
  return scored.sort((a, b) => b.score - a.score)
}
