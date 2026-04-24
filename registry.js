// registry.js — Redis tool registry (Redis Cloud via official redis npm client)
// Sponsor: Redis (redis.io/try-free)
// Tracks: seen tools (dedup), pending approvals, installed tools, scan history

import { createClient } from 'redis'

let client

export async function getRedis() {
  if (!client) {
    client = createClient({ url: (process.env.REDIS_URL || '').trim() })
    client.on('error', err => console.error('Redis error:', err.message))
    await client.connect()
  }
  return client
}

export async function closeRedis() {
  if (client) await client.quit()
}

// Key schema
const KEYS = {
  seenTools:      'skillscout:seen_tools',           // SET  — dedup across runs
  pendingTools:   'skillscout:pending_tools',        // ZSET — sorted by score
  installedTools: 'skillscout:installed_tools',      // HASH — name → metadata JSON
  scanHistory:    'skillscout:scan_history',         // LIST — scan run timestamps
  toolData:  (n) => `skillscout:tool:${n.toLowerCase()}`,
}

export async function isNewTool(name) {
  const r = await getRedis()
  return !(await r.sIsMember(KEYS.seenTools, name.toLowerCase()))
}

export async function markSeen(name) {
  const r = await getRedis()
  await r.sAdd(KEYS.seenTools, name.toLowerCase())
}

export async function addPending(tool, score) {
  const r = await getRedis()
  const key = tool.name.toLowerCase()
  await Promise.all([
    r.zAdd(KEYS.pendingTools, { score, value: key }),
    r.set(KEYS.toolData(key), JSON.stringify(tool), { EX: 86400 }),
    markSeen(tool.name),
  ])
}

export async function getTopPending(n = 10) {
  const r = await getRedis()
  // Get top N by score descending
  const members = await r.zRangeWithScores(KEYS.pendingTools, 0, n - 1, { REV: true })
  const tools = []
  for (const { value: name, score } of members) {
    const raw = await r.get(KEYS.toolData(name))
    if (raw) {
      const tool = JSON.parse(raw)
      tools.push({ ...tool, score })
    }
  }
  return tools
}

export async function markInstalled(name, metadata) {
  const r = await getRedis()
  const key = name.toLowerCase()
  await Promise.all([
    r.hSet(KEYS.installedTools, key, JSON.stringify({ ...metadata, installed_at: new Date().toISOString() })),
    r.zRem(KEYS.pendingTools, key),
  ])
}

export async function getInstalled() {
  const r = await getRedis()
  const all = await r.hGetAll(KEYS.installedTools)
  return Object.entries(all || {}).map(([name, data]) => ({ name, ...JSON.parse(data) }))
}

export async function recordScan(stats) {
  const r = await getRedis()
  await r.lPush(KEYS.scanHistory, JSON.stringify({ ...stats, timestamp: new Date().toISOString() }))
  await r.lTrim(KEYS.scanHistory, 0, 49)
}

export async function getStats() {
  const r = await getRedis()
  const [seen, pending, installed] = await Promise.all([
    r.sCard(KEYS.seenTools),
    r.zCard(KEYS.pendingTools),
    r.hLen(KEYS.installedTools),
  ])
  return { seen, pending, installed }
}
