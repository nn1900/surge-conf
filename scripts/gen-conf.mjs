#!/usr/bin/env node
// Render the real profiles from the tracked templates plus your private
// provider list.
//
//   *.base.*         tracked   — structure only; providers appear as loops
//   conf-gen.json    ignored   — your VPSs and subscriptions
//   Shared.ini, Clash.yaml, Surge-*.conf   generated, ignored
//
// The templates know nothing about your providers: not their names, their
// protocol, their parameters, their URLs, nor how many there are. They loop
// over whatever conf-gen.json declares:
//
//   {{#vps}}
//   {{surge}}                     -> Name = snell, host, port, psk=..., ...
//   {{/vps}}
//
//   {{#subscriptions}}
//   {{surgeGroup}}                -> Name = select, policy-path=..., prefix=...
//   {{/subscriptions}}
//
// and interpolate computed lists wherever providers are referenced:
//
//   {{vps.names}}              "A", "B"
//   {{vps.relayNames}}         "A - Relay", "B - Relay"
//   {{subscriptions.include}}  include-other-group="Sub1,Sub2"
//   {{subscriptions.use}}      [sub1, sub2]
//
// The optional macminitw section (a hop-only home exit) adds the loops
// {{#macminitw}} / {{#macminitwClash}} and the macminitw.* tokens; all of them
// render empty when conf-gen.json has no such section.
//
// Adding a third VPS, a second subscription, or switching a node to another
// protocol is an edit to conf-gen.json. Templates and this script do not change.
//
// Usage: node scripts/gen-conf.mjs [--ios|--macos] [--config conf-gen.json] [--check]

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, symlinkSync, lstatSync, unlinkSync, cpSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

const USAGE = `
gen-conf — render the Surge and Clash profiles from templates + your providers

Usage
  npm run gen                    render every *.base.* template
  npm run gen:ios                render the iOS profile only
  npm run gen:macos              render the macOS profile only
  npm run gen:check              verify templates are safe to publish, render nothing
  node scripts/gen-conf.mjs [options]

Options
  --surge           render the Surge profiles              (default)
  --clash           render the Clash profile
  --all             render both
  --ios, --macos    render only that Surge platform, plus the shared includes
                    it needs. Discovered from the Surge-<platform>.base.conf
                    filenames, and implies --surge.
  --out <dir>       where to write them            (default: .conf)
  --standalone      copy Rules/ into the output instead of symlinking it, so
                    the directory works without this repo
  --config <file>   provider definitions to read   (default: conf-gen.json)
  --check           run the publish-safety check only, write nothing
  -h, --help        show this help

  Naming a target replaces the default rather than adding to it, so --clash
  renders only Clash. Combine them (--surge --clash) or use --all for both.
  Targets are taken from the template extension: .ini/.conf are Surge, .yaml/
  .yml are Clash. The safety check always covers every template regardless.

  Platforms narrow the Surge target rather than replacing it. Shared.ini has no
  platform in its name, so it renders with any platform you pick — the profiles
  #!include it, and would be empty without it.

`

if (argv.includes('-h') || argv.includes('--help')) {
  console.log(USAGE.trim())
  process.exit(0)
}

const checkOnly = argv.includes('--check')
const ci = argv.indexOf('--config')
const cfgName = ci === -1 ? 'conf-gen.json' : argv[ci + 1]

if (ci !== -1 && !cfgName) {
  console.error('error: --config needs a file path\n')
  console.error(USAGE.trim())
  process.exit(1)
}

const targetOf = (file) => (/\.ya?ml$/.test(file) ? 'clash' : 'surge')

const standalone = argv.includes('--standalone')
const oi = argv.indexOf('--out')
if (oi !== -1 && !argv[oi + 1]) {
  console.error('error: --out needs a directory\n')
  console.error(USAGE.trim())
  process.exit(1)
}

const fail = (msg, detail = []) => {
  console.error(`error: ${msg}`)
  for (const d of detail) console.error(`  ${d}`)
  process.exit(1)
}

const templates = readdirSync(root)
  .filter((f) => /\.base\.(ini|ya?ml|conf)$/.test(f))
  .sort()
if (!templates.length) fail('no *.base.* templates found')

// Within Surge, "Surge-<platform>.base.conf" belongs to that platform and every
// other Surge template is shared. Platforms are read off the filenames the same
// way targets are read off the extensions, so adding Surge-Foo.base.conf gives
// you --foo without editing this script.
const platformOf = (file) => {
  const m = /^Surge-([A-Za-z0-9]+)\.base\./.exec(file)
  return m ? m[1].toLowerCase() : null
}
const platforms = [...new Set(templates.map(platformOf).filter(Boolean))].sort()
const wantPlatforms = platforms.filter((p) => argv.includes(`--${p}`))

// A typo'd platform would otherwise render every platform instead of the one
// asked for, which is the mistake these flags exist to prevent.
const known = new Set(['--all', '--surge', '--clash', '--standalone', '--check',
                       '--out', '--config', '-h', '--help', ...platforms.map((p) => `--${p}`)])
const unknown = argv.filter((a, i) => a.startsWith('-') && !known.has(a) && argv[i - 1] !== '--out' && argv[i - 1] !== '--config')
if (unknown.length) {
  fail(`unknown option${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`, [
    `platforms available: ${platforms.map((p) => `--${p}`).join(', ') || 'none'}`,
    'run with --help for the full list',
  ])
}

// Naming a target replaces the default rather than adding to it. Naming a
// platform implies --surge, since platforms only exist within Surge.
const wantAll = argv.includes('--all')
const asked = {
  surge: argv.includes('--surge') || wantPlatforms.length > 0,
  clash: argv.includes('--clash'),
}
const targets = wantAll
  ? { surge: true, clash: true }
  : asked.surge || asked.clash
    ? asked
    : { surge: true, clash: false }

const cfgPath = join(root, cfgName)
const examplePath = join(root, 'conf-gen.example.json')
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : null
const rules = cfg ?? (existsSync(examplePath) ? JSON.parse(readFileSync(examplePath, 'utf8')) : {})

// ------------------------------------------------------------ publish safety
// Runs against the TEMPLATES, so a real value typed into one instead of a loop
// field fails here. This is what makes the repository safe to make public.

const allow = rules.forbidAllow ?? []
const forbid = (rules.forbid ?? []).map((p) => [p, new RegExp(p, 'gm')])
const violations = []
for (const t of templates) {
  const body = readFileSync(join(root, t), 'utf8')
  for (const [src, re] of forbid) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(body)) !== null) {
      const hit = m[0].trim()
      if (allow.some((a) => hit.includes(a))) continue
      violations.push(`${t}:${body.slice(0, m.index).split('\n').length}: /${src}/ -> ${hit.slice(0, 70)}`)
    }
  }
}
if (violations.length) fail('templates contain values that must not be published', violations)
console.log(`templates clean: ${templates.length} checked, no publishable secrets`)
if (checkOnly) process.exit(0)

if (!cfg) {
  fail(`${cfgName} not found`, ['cp conf-gen.example.json conf-gen.json, fill it in, then re-run.'])
}

// ------------------------------------------------------- provider rendering
// Nothing below assumes a protocol. A node is name + type + server + port plus
// an open bag of parameters, emitted in each engine's own syntax.

const relayGroup = cfg.relayGroup ?? 'Relay'
const relaySuffix = cfg.relaySuffix ?? ' - Relay'

const need = (obj, field, what) => {
  if (obj[field] === undefined || obj[field] === '') fail(`${what} is missing "${field}"`, [JSON.stringify(obj)])
  return obj[field]
}

const surgeParams = (params) =>
  Object.entries(params ?? {}).map(([k, v]) => `${k}=${v}`)

const yamlScalar = (v) => (typeof v === 'string' && !/^[\w.@/:+-]+$/.test(v) ? JSON.stringify(v) : String(v))

const vps = (cfg.vps ?? []).map((v, i) => {
  const name = need(v, 'name', `vps[${i}]`)
  const type = need(v, 'type', `vps "${name}"`)
  const server = need(v, 'server', `vps "${name}"`)
  const port = need(v, 'port', `vps "${name}"`)
  const base = v.params ?? {}
  const clashParams = { ...base, ...(v.clashParams ?? {}) }
  const relayName = `${name}${relaySuffix}`

  const surgeLine = (nm, extra = []) =>
    `${nm} = ${[type, server, port, ...surgeParams(base), ...extra].join(', ')}`

  const clashBlock = (nm, extra = {}) =>
    [
      `  - name: "${nm}"`,
      `    type: ${type}`,
      `    server: ${server}`,
      `    port: ${port}`,
      ...Object.entries({ ...clashParams, ...extra }).map(([k, val]) => `    ${k}: ${yamlScalar(val)}`),
    ].join('\n')

  return {
    ...v,
    name,
    relayName,
    surge: surgeLine(name),
    surgeRelay: surgeLine(relayName, [`underlying-proxy=${relayGroup}`]),
    clash: clashBlock(name),
    clashRelay: clashBlock(relayName, { 'dialer-proxy': relayGroup }),
  }
})

const subs = (cfg.subscriptions ?? []).map((s, i) => {
  const name = need(s, 'name', `subscriptions[${i}]`)
  const key = s.key ?? (name.toLowerCase().replace(/[^a-z0-9]+/g, '') || `sub${i}`)
  const prefix = s.prefix ?? ''

  // `filter` selects which of a feed's nodes to keep. Both engines apply it
  // against the name they hold at that moment, and in both cases the prefix is
  // already on it:
  //
  //   Surge   policy-regex-filter, after external-policy-name-prefix
  //   mihomo  a group's filter:, against p.Name() — the provider's
  //           override.additional-prefix has already renamed it
  //
  // Only mihomo's *provider*-level filter sees the raw name, and that is not
  // where it is emitted any more. So a pattern anchored to the raw name, like
  // "^x1\.0", selects nothing once a prefix is set. Loosening it — dropping the
  // anchors and wrapping in .* — matches with or without a prefix, and works
  // whether the engine searches or requires a full match. surgeFilter and
  // clashFilter bypass this when a feed needs something exact.
  const loosen = (p) => `.*${p.replace(/^\^/, '').replace(/\$$/, '')}.*`
  const surgeFilter = s.surgeFilter ?? (s.filter ? loosen(s.filter) : undefined)
  const clashFilter = s.clashFilter ?? (s.filter ? loosen(s.filter) : undefined)
  if (clashFilter && clashFilter.includes('`')) {
    fail(`subscription "${name}": clash filter cannot contain a backtick`, [
      'mihomo splits a group filter on backticks to allow several patterns.',
    ])
  }
  if (surgeFilter && surgeFilter.includes(',')) {
    fail(`subscription "${name}": policy-regex-filter cannot contain a comma`, [
      'Surge separates policy parameters by comma. Use surgeFilter to give the',
      'Surge side a comma-free equivalent of the Clash filter.',
    ])
  }
  const hasExplicit = Object.prototype.hasOwnProperty.call(s.surgeParams ?? {}, 'policy-regex-filter')

  // The subscription's own group stays unfiltered, so the entries a feed uses
  // to report balance and expiry remain visible there. Filtering happens in a
  // derived group that the routing groups include instead — it reuses the
  // already-loaded policies, so there is no second download.
  const nodesName = `${name}${cfg.nodesSuffix ?? ' Nodes'}`
  const hasFilter = Boolean(surgeFilter) && !hasExplicit

  const surgeGroup = [
    `${name} = select`,
    `policy-path=${need(s, 'surge', `subscription "${name}"`)}`,
    ...(hasExplicit ? [] : []),
    ...(prefix ? [`external-policy-name-prefix=${prefix}`] : []),
    ...surgeParams(s.surgeParams),
  ].join(', ')

  // Emitted raw: Surge's format is not JSON, so escaping the backslashes would
  // make the regex look for a literal one.
  const surgeNodesGroup = hasFilter
    ? [`${nodesName} = select`, `include-other-group="${name}"`,
       `policy-regex-filter=${surgeFilter}`, 'hidden=true'].join(', ')
    : ''

  // What the routing groups should pull from: the filtered variant when there
  // is one, otherwise the subscription group itself.
  const includeName = hasFilter ? nodesName : name

  const clashProvider = [
    `  ${key}:`,
    `    type: http`,
    `    url: "${need(s, 'clash', `subscription "${name}"`)}"`,
    `    path: ./providers/${key}.yaml`,
    `    interval: ${s.interval ?? 3600}`,
    `    proxy: ${s.downloadVia ?? 'DIRECT'}`,
    ...(prefix || s.clashOverride
      ? [
          `    override:`,
          ...(prefix ? [`      additional-prefix: "${prefix}"`] : []),
          ...Object.entries(s.clashOverride ?? {}).map(([k, v]) => `      ${k}: ${yamlScalar(v)}`),
        ]
      : []),
    `    health-check:`,
    `      enable: true`,
    `      url: ${s.testUrl ?? 'http://cp.cloudflare.com/generate_204'}`,
    `      interval: 300`,
    `      lazy: true`,
    `      expected-status: 204`,
  ].join('\n')

  const clashGroup = [`  - name: "${name}"`, `    type: select`, `    use: [${key}]`].join('\n')

  return { ...s, name, key, prefix, clashFilter, surgeGroup, surgeNodesGroup,
           includeName, clashProvider, clashGroup }
})

if (!vps.length && !subs.length) fail(`${cfgName} declares no vps and no subscriptions`)

// ------------------------------------------------------- macminitw (optional)
// A home exit reachable only through a hop: its nodes listen on a tailnet
// address that the client can't dial itself, so each one is chained through a
// select group of existing VPSes (underlying-proxy / dialer-proxy). The VPSes
// reach it over their own Tailscale. An optional Surge Tailscale policy with
// an exit node sits beside the nodes in the hand-picked exit group.
//
// Kept out of vps[] on purpose: those land in Proxy and AI Suite as directly
// usable nodes and get a Relay twin, none of which fits a hop-only server.
// Without a macminitw section every token below renders empty.

const q = (s) => `"${s}"`
const list = (a) => a.join(', ')

// Surge's parameter values are comma-separated; quote names with spaces.
const sv = (s) => (/[\s"]/.test(s) ? `"${s}"` : s)

const mm = (() => {
  const m = cfg.macminitw
  if (!m) return null
  const via = need(m.via ?? {}, 'name', 'macminitw.via')
  const hops = m.via?.hops ?? []
  if (!hops.length) fail('macminitw.via.hops is empty', ['List the vps names that may carry traffic to macminitw.'])
  const vpsNames = new Set(vps.map((v) => v.name))
  // DIRECT is allowed as a hop: dial the tailnet address straight, which works
  // wherever the client itself is on the tailnet (e.g. the Tailscale app).
  const unknownHops = hops.filter((h) => h !== 'DIRECT' && !vpsNames.has(h))
  if (unknownHops.length) fail('macminitw.via.hops names no such vps', [...unknownHops, `vps: ${[...vpsNames].join(', ')}, or DIRECT`])
  // Built-in policy names stay unquoted in Surge.
  const hopRef = (h) => (h === 'DIRECT' ? h : q(h))
  const group = need(m, 'group', 'macminitw')

  const nodes = (m.nodes ?? []).map((n, i) => {
    const name = need(n, 'name', `macminitw.nodes[${i}]`)
    const type = need(n, 'type', `macminitw node "${name}"`)
    const server = need(n, 'server', `macminitw node "${name}"`)
    const port = need(n, 'port', `macminitw node "${name}"`)
    const engines = n.engines ?? ['surge', 'clash']
    const clashParams = { ...(n.params ?? {}), ...(n.clashParams ?? {}), 'dialer-proxy': via }
    return {
      ...n, name, engines,
      surge: `${name} = ${[type, server, port, ...surgeParams(n.params), `underlying-proxy=${sv(via)}`].join(', ')}`,
      clash: [
        `  - name: "${name}"`,
        `    type: ${type}`,
        `    server: ${server}`,
        `    port: ${port}`,
        ...Object.entries(clashParams).map(([k, val]) => `    ${k}: ${yamlScalar(val)}`),
      ].join('\n'),
    }
  })

  const ts = m.tailscale
  const tsName = ts ? need(ts, 'name', 'macminitw.tailscale') : null
  const tsSection = ts ? need(ts, 'section', 'macminitw.tailscale') : null

  const surgeNodes = nodes.filter((n) => n.engines.includes('surge'))
  const clashNodes = nodes.filter((n) => n.engines.includes('clash'))
  const surgeMembers = [...surgeNodes.map((n) => q(n.name)), ...(ts ? [q(tsName)] : [])]
  if (!surgeMembers.length) fail(`macminitw group "${group}" would be empty`, ['Add a node or a tailscale policy.'])

  return {
    surgeNodes, clashNodes,
    surgeTailnet: ts ? `${tsName} = tailscale, section-name=${tsSection}` : '',
    surgeTailscaleSection: ts
      ? [`[Tailscale ${tsSection}]`, 'interactive-login = true',
         `exit-node = ${ts.exitNode ?? 'none'}`,
         `auto-add-magic-dns-rule = ${ts.autoAddMagicDnsRule ?? true}`,
         // Without it the policy uses the tailnet's DNS servers; a tailnet with
         // none fails every lookup through the exit node ("No available
         // upstream DNS server"). Queries are routed through the exit node.
         ...(ts.dnsServer ? [`dns-server = ${[].concat(ts.dnsServer).join(', ')}`] : [])].join('\n')
      : '',
    surgeGroups: [
      `${via} = select, ${list(hops.map(hopRef))}`,
      `${group} = select, ${list(surgeMembers)}`,
    ].join('\n'),
    surgeProxyMember: `, ${q(group)}`,
    // Clash: no Tailscale policy, and only the nodes that declare it.
    clashGroups: clashNodes.length
      ? [
          `  - name: "${via}"`, `    type: select`, `    proxies: [${list(hops.map(q))}]`, '',
          `  - name: "${group}"`, `    type: select`, `    proxies: [${list(clashNodes.map((n) => q(n.name)))}]`, '',
        ].join('\n')
      : '',
    clashProxyMember: clashNodes.length ? `, ${q(group)}` : '',
  }
})()

// ------------------------------------------------------------------- context


const computed = {
  'vps.names': list(vps.map((v) => q(v.name))),
  'vps.relayNames': list(vps.map((v) => q(v.relayName))),
  'vps.allNames': list([...vps.map((v) => q(v.name)), ...vps.map((v) => q(v.relayName))]),
  'subscriptions.names': list(subs.map((s) => q(s.name))),
  'subscriptions.include': subs.length
    ? `include-other-group="${subs.map((s) => s.includeName).join(',')}"`
    : '',
  // Clash has no include-other-group, so the routing groups filter their own
  // use: list instead. One filter covers every provider in the group.
  'subscriptions.clashFilter': (() => {
    const fs = subs.map((s) => s.clashFilter).filter(Boolean)
    if (!fs.length) return ''
    if (fs.length < subs.length) return ''  // mixed: filtering would drop the unfiltered feed
    const uniq = [...new Set(fs)]
    return `\n    filter: ${JSON.stringify(uniq.length === 1 ? uniq[0] : uniq.map((f) => `(?:${f})`).join('|'))}`
  })(),
  'subscriptions.use': `[${subs.map((s) => s.key).join(', ')}]`,
  relayGroup,
  'macminitw.surgeTailnet': mm?.surgeTailnet ?? '',
  'macminitw.surgeTailscaleSection': mm?.surgeTailscaleSection ?? '',
  'macminitw.surgeGroups': mm?.surgeGroups ?? '',
  'macminitw.surgeProxyMember': mm?.surgeProxyMember ?? '',
  'macminitw.clashGroups': mm?.clashGroups ?? '',
  'macminitw.clashProxyMember': mm?.clashProxyMember ?? '',
  ...Object.fromEntries(Object.entries(cfg.vars ?? {}).map(([k, v]) => [k, String(v)])),
}

const lists = {
  vps,
  subscriptions: subs,
  macminitw: mm?.surgeNodes ?? [],
  macminitwClash: mm?.clashNodes ?? [],
}

// -------------------------------------------------------------------- render

const missing = new Set()
const lookup = (key, scope) => {
  if (scope && Object.prototype.hasOwnProperty.call(scope, key)) return String(scope[key])
  if (Object.prototype.hasOwnProperty.call(computed, key)) return computed[key]
  missing.add(key)
  return `{{${key}}}`
}

const TOKEN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g
const interpolate = (text, scope) => text.replace(TOKEN, (_, k) => lookup(k, scope))

// {{#list}} / {{/list}} on their own lines; body repeated once per item.
const expandLoops = (text) =>
  text.replace(/^[ \t]*\{\{#([A-Za-z0-9_]+)\}\}[ \t]*\n([\s\S]*?)^[ \t]*\{\{\/\1\}\}[ \t]*\n/gm, (whole, name, body) => {
    const items = lists[name]
    if (!items) {
      missing.add(`#${name}`)
      return whole
    }
    return items.map((item) => interpolate(body, item)).join('')
  })

// A shared template (no platform in its name) renders whenever its engine is on;
// Shared.ini is included by both Surge profiles, so --ios still needs it.
const inTarget = (t) => {
  if (!targets[targetOf(t)]) return false
  const p = platformOf(t)
  return !p || !wantPlatforms.length || wantPlatforms.includes(p)
}
const selected = templates.filter(inTarget)
const skipped = templates.filter((t) => !inTarget(t))

if (!selected.length) {
  fail('no templates match the requested target', [
    `targets: ${Object.entries(targets).filter(([, on]) => on).map(([k]) => k).join(', ') || 'none'}`,
    `templates: ${templates.join(', ')}`,
  ])
}

const rendered = []
for (const t of selected) {
  let body = readFileSync(join(root, t), 'utf8')
  body = expandLoops(body)
  body = interpolate(body, null)
  rendered.push([t.replace(/\.base\.(ini|ya?ml|conf)$/, '.$1'), body])
}

if (missing.size) fail(`${cfgName} has no value for these`, [...missing].sort())

const outDir = resolve(process.cwd(), oi !== -1 ? argv[oi + 1] : (cfg.outDir ?? '.conf'))
mkdirSync(outDir, { recursive: true })
for (const [name, body] of rendered) writeFileSync(join(outDir, name), body)

// The profiles reference Rules/ with paths relative to their own directory, so
// the output needs it alongside them. By default that is a relative symlink —
// one copy on disk, and it survives the repo being moved. --standalone copies
// instead, making the output directory portable and independent of this repo.
const rulesSrc = join(root, 'Rules')
const rulesDst = join(outDir, 'Rules')
let rulesMode = 'none'
if (existsSync(rulesSrc) && resolve(rulesDst) !== resolve(rulesSrc)) {
  let existing = null
  try {
    existing = lstatSync(rulesDst).isSymbolicLink() ? 'link' : 'dir'
  } catch {}

  if (standalone) {
    if (existing === 'link') unlinkSync(rulesDst)
    cpSync(rulesSrc, rulesDst, { recursive: true, dereference: true })
    rulesMode = 'copied'
  } else if (existing === 'dir') {
    // A previous --standalone run left a real directory here; leave it alone
    // rather than silently swapping it for a link.
    rulesMode = 'existing copy'
  } else if (existing !== 'link') {
    symlinkSync(relative(outDir, rulesSrc), rulesDst)
    rulesMode = 'linked'
  } else {
    rulesMode = 'linked'
  }
}

const on = Object.entries(targets).filter(([, v]) => v).map(([k]) => k).join(' + ') +
  (wantPlatforms.length ? ` (${wantPlatforms.join(', ')})` : '')
const shown = relative(process.cwd(), outDir) || '.'
console.log(
  `\n${vps.length} VPS (${vps.map((v) => v.type).join(', ') || 'none'}), ` +
    `${subs.length} subscription(s) -> ${rendered.length} ${on} file(s) in ${shown}/:`,
)
for (const [name] of rendered) console.log(`  ${name}`)
if (rulesMode !== 'none') console.log(`  Rules/ (${rulesMode})`)
if (skipped.length) {
  console.log(`\nskipped (not in target): ${skipped.map((t) => t.replace(/\.base\.(ini|ya?ml|conf)$/, '.$1')).join(', ')}`)
}
