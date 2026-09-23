#!/usr/bin/env node
// Serve the rendered Clash profile over HTTP so a client can import it by URL.
//
//   HOST  interface to bind (default 0.0.0.0, every interface; 127.0.0.1 for this Mac only)
//   PORT  port to listen on (default 8890)
//
// The file is read on every request, so re-running `gen --clash` is picked up
// without a restart. It carries your real credentials: only expose it on a
// network you trust.

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let outDir = '.conf'
try { outDir = JSON.parse(readFileSync(join(root, 'conf-gen.json'), 'utf8')).outDir ?? outDir } catch {}
const file = resolve(root, outDir, 'Clash.yaml')

const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 8890)

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  if (path !== '/' && path !== '/Clash.yaml') {
    res.writeHead(404).end('not found\n')
    return
  }
  let body
  try {
    body = readFileSync(file)
  } catch {
    res.writeHead(503).end(`${file} not found; run \`npm run gen -- --clash\` first\n`)
    return
  }
  res.writeHead(200, {
    'Content-Type': 'text/yaml; charset=utf-8',
    'Content-Disposition': 'inline; filename="Clash.yaml"',
    'Cache-Control': 'no-store',
  })
  res.end(body)
  console.log(`${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${req.url}`)
}).listen(port, host, () => {
  const hosts = host === '0.0.0.0'
    ? Object.values(networkInterfaces()).flat().filter((i) => i.family === 'IPv4').map((i) => i.address)
    : [host]
  console.log(`serving ${file}`)
  for (const h of hosts) console.log(`  http://${h}:${port}/Clash.yaml`)
})
