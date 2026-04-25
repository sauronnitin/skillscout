// server.js — SkillScout web UI server
// IBM Carbon Design System frontend + SSE for real-time scan progress
// Run: node server.js   →   open http://localhost:3000

import 'dotenv/config'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { buildProfile }   from './profile.js'
import { scanWeb }        from './scanner.js'
import { scoreTools }     from './scorer.js'
import { addPending, getTopPending, getStats, recordScan, closeRedis } from './registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000

// ─── In-memory state ─────────────────────────────────────────────────────────
let cachedProfile = null
let scanState = 'idle'        // idle | running | done
let scanSseClients = []       // active SSE connections

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serveFile(res, filePath, ct) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return }
    res.writeHead(200, { 'Content-Type': ct })
    res.end(data)
  })
}

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(JSON.stringify(data))
}

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  scanSseClients = scanSseClients.filter(c => !c.destroyed)
  scanSseClients.forEach(c => c.write(msg))
}

async function parseBody(req) {
  return new Promise(resolve => {
    let body = ''
    req.on('data', d => { body += d })
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')) } catch { resolve({}) } })
  })
}

// ─── Scan pipeline ────────────────────────────────────────────────────────────

async function runScan() {
  if (scanState === 'running') return
  scanState = 'running'
  broadcastSSE('status', { state: 'running', message: 'Building profile...' })

  try {
    // Step 1 — Profile
    cachedProfile = buildProfile()
    broadcastSSE('profile', cachedProfile)
    broadcastSSE('status', { state: 'running', message: 'Scanning web sources...' })

    // Step 2 — Scan with per-source progress
    const rawTools = await scanWeb(cachedProfile, ({ source, status, count }) => {
      if (source === '__done__') return
      broadcastSSE('source', { source, status, count })
    })

    broadcastSSE('status', { state: 'running', message: `Scoring ${rawTools.length} tools...` })

    // Step 3 — Score
    const scored = scoreTools(rawTools, cachedProfile)

    // Step 4 — Store in Redis
    for (const tool of scored) await addPending(tool, tool.score)
    await recordScan({ tools_found: rawTools.length, tools_scored: scored.length, keywords: cachedProfile.search_keywords })

    const stats = await getStats()

    broadcastSSE('results', { tools: scored, stats })
    broadcastSSE('status', { state: 'done', message: `Found ${scored.length} recommendations` })
    scanState = 'done'
  } catch (err) {
    broadcastSSE('status', { state: 'error', message: err.message })
    scanState = 'idle'
  }
}

// ─── HTTP router ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const { pathname } = url

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' })
    res.end(); return
  }

  // ── Static ──────────────────────────────────────────────────────────────────
  if (pathname === '/' || pathname === '/index.html') {
    serveFile(res, path.join(__dirname, 'public', 'index.html'), 'text/html; charset=utf-8')
    return
  }

  // ── SSE — real-time scan progress ──────────────────────────────────────────
  if (pathname === '/api/scan/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })
    res.write('retry: 3000\n\n')
    scanSseClients.push(res)
    req.on('close', () => { scanSseClients = scanSseClients.filter(c => c !== res) })

    // Send current state immediately on connect
    if (cachedProfile) res.write(`event: profile\ndata: ${JSON.stringify(cachedProfile)}\n\n`)
    res.write(`event: status\ndata: ${JSON.stringify({ state: scanState, message: scanState === 'running' ? 'Scan in progress...' : 'Ready' })}\n\n`)
    return
  }

  // ── POST /api/scan — trigger a new scan ─────────────────────────────────────
  if (pathname === '/api/scan' && req.method === 'POST') {
    json(res, { ok: true, message: 'Scan started' })
    runScan()   // fire-and-forget; progress via SSE
    return
  }

  // ── GET /api/profile ────────────────────────────────────────────────────────
  if (pathname === '/api/profile') {
    if (!cachedProfile) cachedProfile = buildProfile()
    json(res, cachedProfile)
    return
  }

  // ── GET /api/results — cached results from Redis ────────────────────────────
  if (pathname === '/api/results') {
    try {
      const tools = await getTopPending(25)
      const stats = await getStats()
      json(res, { tools, stats })
    } catch (e) {
      json(res, { tools: [], stats: {}, error: e.message })
    }
    return
  }

  // ── POST /api/install ───────────────────────────────────────────────────────
  if (pathname === '/api/install' && req.method === 'POST') {
    const body = await parseBody(req)
    const { tool } = body
    if (!tool?.install_cmd) { json(res, { ok: false, error: 'Missing tool.install_cmd' }, 400); return }
    json(res, { ok: true, install_cmd: tool.install_cmd, message: `Run: ${tool.install_cmd}` })
    return
  }

  res.writeHead(404); res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`\n  SkillScout UI  →  http://localhost:${PORT}\n`)
})

process.on('SIGINT', async () => {
  await closeRedis()
  process.exit(0)
})
