#!/usr/bin/env node
// Render the headless-server proxy setup from server/conf.json:
//
//   xray.base.json    -> .out/exits/<exit>.json   VLESS+Reality inbound per VPS
//   mihomo.base.yaml  -> .out/clients/<name>.yaml mihomo on each server, using those exits
//
// This is deliberately separate from the end-user profiles (../scripts/gen-conf.mjs):
// its own config file, its own templates, its own output, no shared state.
//
//   node server/gen.mjs           render
//   node server/gen.mjs --init    first fill missing credentials into conf.json
//                                 (uuid, Reality key pair, short id, each client's
//                                 controller secret), then render
//
// Templates use {{path}} for values and {{#exits}}...{{/exits}} to repeat a block
// per exit. An unknown {{token}} is an error, never an empty string.

import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const paths = {
  conf: join(here, 'conf.json'),
  example: join(here, 'conf.example.json'),
  out: join(here, '.out'),
  client: (c) => join(here, '.out', 'clients', `${slug(c.name)}.yaml`),
  exit: (e) => join(here, '.out', 'exits', `${slug(e.name)}.json`),
}

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const fail = (msg, details = []) => {
  console.error(`error: ${msg}`)
  for (const d of details) console.error(`  ${d}`)
  process.exit(1)
}

// ------------------------------------------------------------- credentials

// Xray writes X25519 keys as unpadded base64url of the raw 32 bytes.
const b64url = (buf) => buf.toString('base64url')

function newKeyPair() {
  const { privateKey } = generateKeyPairSync('x25519')
  return b64url(Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url'))
}

// The public key is always derived, never stored, so the two can't disagree.
function publicKeyOf(priv) {
  const raw = Buffer.from(priv, 'base64url')
  if (raw.length !== 32) throw new Error('privateKey must be 32 bytes of base64url')
  // PKCS#8 wrapper for a raw X25519 private key.
  const der = Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), raw])
  const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  return createPublicKey(key).export({ format: 'jwk' }).x
}

function init(cfg) {
  const filled = []
  for (const e of cfg.exits ?? []) {
    if (!e.uuid) { e.uuid = randomUUID(); filled.push(`${e.name}: uuid`) }
    if (!e.privateKey) { e.privateKey = newKeyPair(); filled.push(`${e.name}: privateKey`) }
    if (!e.shortId) { e.shortId = randomBytes(8).toString('hex'); filled.push(`${e.name}: shortId`) }
  }
  for (const c of cfg.clients ?? []) {
    if (!c.secret) { c.secret = randomBytes(16).toString('hex'); filled.push(`${c.name}: secret`) }
  }
  return filled
}

// ---------------------------------------------------------------- template

function lookup(ctx, path, where) {
  const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx)
  if (v === undefined || v === null || typeof v === 'object') fail(`${where}: no value for {{${path}}}`)
  return String(v)
}

function render(tpl, ctx, where) {
  const withSections = tpl.replace(/\{\{#(\w+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/g, (_, name, body) => {
    const items = ctx[name]
    if (!Array.isArray(items)) fail(`${where}: {{#${name}}} is not a list`)
    return items.map((item) => render(body, { ...ctx, ...item }, where)).join('')
  })
  return withSections.replace(/\{\{([\w.]+)\}\}/g, (_, p) => lookup(ctx, p, where))
}

// ------------------------------------------------------------------ config

export function load() {
  if (!existsSync(paths.conf)) {
    fail('server/conf.json not found', [`Copy ${paths.example} to conf.json, fill in hosts, then run with --init.`])
  }
  return JSON.parse(readFileSync(paths.conf, 'utf8'))
}

function validate(cfg) {
  const problems = []
  const need = (obj, key, where) => {
    if (obj?.[key] === undefined || obj[key] === '') problems.push(`${where}.${key} is missing`)
  }
  if (cfg.client) problems.push('"client" is now "clients", a list; move it inside one and give it a name')
  if (!cfg.clients?.length) problems.push('clients is empty')
  const clientNames = new Set()
  for (const [i, c] of (cfg.clients ?? []).entries()) {
    const at = `clients[${i}]${c.name ? ` (${c.name})` : ''}`
    for (const k of ['name', 'ssh', 'port', 'controllerPort', 'secret']) need(c, k, at)
    if (c.name && clientNames.has(slug(c.name))) problems.push(`${at}: name collides with another client`)
    clientNames.add(slug(c.name ?? ''))
    const d = c.defaultExit
    if (d !== undefined && d !== 'Auto' && !cfg.exits?.some((e) => e.name === d)) {
      problems.push(`${at}.defaultExit "${d}" is not an exit name (or "Auto")`)
    }
  }
  for (const k of ['version', 'asset']) need(cfg.mihomo, k, 'mihomo')
  need(cfg.xray, 'version', 'xray')
  if (!cfg.exits?.length) problems.push('exits is empty')
  const names = new Set()
  for (const [i, e] of (cfg.exits ?? []).entries()) {
    const at = `exits[${i}]${e.name ? ` (${e.name})` : ''}`
    for (const k of ['name', 'ssh', 'server', 'port', 'serverName', 'uuid', 'privateKey', 'shortId']) need(e, k, at)
    if (e.name && names.has(slug(e.name))) problems.push(`${at}: name collides with another exit`)
    names.add(slug(e.name ?? ''))
    if (e.shortId && (!/^[0-9a-f]{2,16}$/.test(e.shortId) || e.shortId.length % 2)) {
      problems.push(`${at}.shortId must be an even number (max 16) of hex digits`)
    }
  }
  if (problems.length) fail('server/conf.json is incomplete (run with --init to fill credentials)', problems)
}

// -------------------------------------------------------------------- main

export function generate({ initFirst = false } = {}) {
  const cfg = load()
  if (initFirst) {
    const filled = init(cfg)
    if (filled.length) {
      writeFileSync(paths.conf, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 })
      console.log(`filled in server/conf.json:\n  ${filled.join('\n  ')}`)
    }
  }
  validate(cfg)

  const exits = cfg.exits.map((e) => ({ ...e, publicKey: publicKeyOf(e.privateKey) }))
  const quote = (names) => names.map((n) => JSON.stringify(n)).join(', ')
  const ctx = { ...cfg, exits, exitNames: quote(exits.map((e) => e.name)) }

  rmSync(paths.out, { recursive: true, force: true })
  mkdirSync(join(paths.out, 'exits'), { recursive: true, mode: 0o700 })
  mkdirSync(join(paths.out, 'clients'), { recursive: true, mode: 0o700 })

  const xrayTpl = readFileSync(join(here, 'xray.base.json'), 'utf8')
  for (const e of exits) {
    const out = render(xrayTpl, { ...ctx, ...e }, `xray.base.json (${e.name})`)
    JSON.parse(out) // a template edit that breaks JSON should fail here, not on the VPS
    writeFileSync(paths.exit(e), out, { mode: 0o600 })
  }
  const mihomoTpl = readFileSync(join(here, 'mihomo.base.yaml'), 'utf8')
  for (const c of cfg.clients) {
    // Proxy's first entry is its default: defaultExit if set, else Auto.
    const lead = c.defaultExit ?? 'Auto'
    const choices = [lead, ...['Auto', ...exits.map((e) => e.name)].filter((n) => n !== lead), 'DIRECT']
    const out = render(mihomoTpl, { ...ctx, client: c, proxyChoices: quote(choices) }, `mihomo.base.yaml (${c.name})`)
    writeFileSync(paths.client(c), out, { mode: 0o600 })
  }

  const list = (xs, ext) => `{${xs.map((x) => slug(x.name)).join(',')}}.${ext}`
  console.log(`rendered server/.out/: clients/${list(cfg.clients, 'yaml')}, exits/${list(exits, 'json')}`)
  return { cfg, exits }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => a !== '--init')
  if (unknown.length) fail(`unknown option ${unknown.join(' ')}`, ['usage: node server/gen.mjs [--init]'])
  generate({ initFirst: args.includes('--init') })
}
