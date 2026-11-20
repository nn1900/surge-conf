#!/usr/bin/env node
// Install what server/gen.mjs renders, over SSH.
//
//   node server/deploy.mjs exits [name...]     xray + VLESS+Reality inbound on each VPS
//   node server/deploy.mjs clients [name...]   mihomo on each headless server
//   node server/deploy.mjs all                 every exit first, then every client
//   --dry-run                                  render and download, but touch no host
//
// With no names, exits and clients mean all of them.
//
// Binaries are downloaded on this machine, checked against the SHA-256 digest
// GitHub publishes for each release file, and copied over with scp. The client
// is assumed to have no route to GitHub, so it never downloads anything itself.
// Re-running is safe: every step overwrites, and a service restarts only after
// its config passes the binary's own test.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { generate, paths, slug } from './gen.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const cache = join(here, '.cache')
const SSH = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'LogLevel=ERROR']

const fail = (msg) => { console.error(`error: ${msg}`); process.exit(1) }
const step = (msg) => console.log(`\n==> ${msg}`)

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const [rawTarget, ...names] = args.filter((a) => a !== '--dry-run')
const target = rawTarget === 'client' ? 'clients' : rawTarget
if (!['exits', 'clients', 'all'].includes(target) || (target === 'all' && names.length)) {
  fail('usage: node server/deploy.mjs <exits [name...] | clients [name...] | all> [--dry-run]')
}

// Names match exactly or by slug ("DMIT VPS 1" or dmit-vps-1).
function pick(items, kind) {
  if (!names.length) return items
  const picked = items.filter((x) => names.includes(x.name) || names.includes(slug(x.name)))
  if (picked.length !== names.length) {
    fail(`unknown ${kind} in: ${names.join(', ')} (have: ${items.map((x) => x.name).join(', ')})`)
  }
  return picked
}

// ---------------------------------------------------------------- downloads

async function asset(repo, tag, name) {
  mkdirSync(cache, { recursive: true })
  const file = join(cache, `${tag}-${name}`)
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) fail(`${repo} ${tag}: GitHub API returned ${res.status}`)
  const meta = (await res.json()).assets.find((a) => a.name === name)
  if (!meta) fail(`${repo} ${tag} has no file named ${name}`)
  const want = meta.digest?.replace(/^sha256:/, '')
  if (!want) fail(`${repo} ${tag} ${name}: GitHub published no digest to verify against`)

  if (!existsSync(file) || sha256(readFileSync(file)) !== want) {
    console.log(`  downloading ${repo} ${tag} ${name}`)
    const dl = await fetch(meta.browser_download_url)
    if (!dl.ok) fail(`download of ${name} failed: ${dl.status}`)
    const body = Buffer.from(await dl.arrayBuffer())
    if (sha256(body) !== want) fail(`${name}: SHA-256 mismatch, refusing to use it`)
    writeFileSync(file, body)
  }
  console.log(`  ${name}: sha256 ${want.slice(0, 16)}… verified`)
  return file
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// --------------------------------------------------------------------- ssh

function ssh(host, script) {
  if (dryRun) { console.log(`  [dry-run] would run a ${script.split('\n').length}-line script on ${host}`); return }
  execFileSync('ssh', [...SSH, host, 'bash -s'], { input: `set -euo pipefail\n${script}`, stdio: ['pipe', 'inherit', 'inherit'] })
}

function upload(host, dir, files) {
  if (dryRun) { console.log(`  [dry-run] would copy ${files.length} files to ${host}:${dir}`); return }
  execFileSync('ssh', [...SSH, host, `rm -rf ${dir} && mkdir -m 700 ${dir}`], { stdio: 'inherit' })
  execFileSync('scp', [...SSH, '-q', ...files, `${host}:${dir}/`], { stdio: 'inherit' })
}

// ------------------------------------------------------------------- exits

async function deployExits(cfg, exits) {
  const picked = pick(exits, 'exit')
  const zip = await asset('XTLS/Xray-core', cfg.xray.version, 'Xray-linux-64.zip')
  const unit = join(here, 'xray.service')

  for (const e of picked) {
    step(`exit ${e.name} (${e.ssh}): xray ${cfg.xray.version}, VLESS+Reality on :${e.port}`)
    const dir = '/tmp/xray-deploy'
    const conf = paths.exit(e)
    upload(e.ssh, dir, [zip, conf, unit])
    ssh(e.ssh, `
D=${dir}
id xray >/dev/null 2>&1 || useradd --system --user-group --no-create-home --shell /usr/sbin/nologin xray
install -d -m 755 /usr/local/lib/xray /usr/local/etc/xray
command -v unzip >/dev/null || { apt-get update -qq && apt-get install -y -qq unzip; }
unzip -o -q "$D/${basename(zip)}" xray geoip.dat geosite.dat -d /usr/local/lib/xray
chmod 755 /usr/local/lib/xray/xray
install -m 640 -o root -g xray "$D/${basename(conf)}" /usr/local/etc/xray/config.json
XRAY_LOCATION_ASSET=/usr/local/lib/xray /usr/local/lib/xray/xray run -test -c /usr/local/etc/xray/config.json >/dev/null
install -m 644 "$D/xray.service" /etc/systemd/system/xray.service
systemctl daemon-reload
systemctl enable --quiet xray
systemctl restart xray
sleep 2
systemctl is-active --quiet xray || { journalctl -u xray -n 30 --no-pager; exit 1; }
echo "  xray $(/usr/local/lib/xray/xray version | head -1 | cut -d' ' -f2) active, listening: $(ss -Hltn 'sport = :${e.port}' | awk '{print $4}' | tr '\\n' ' ')"
rm -rf "$D"`)
  }
}

// ------------------------------------------------------------------ client

async function deployClients(cfg) {
  const picked = pick(cfg.clients, 'client')
  const gz = await asset('MetaCubeX/mihomo', cfg.mihomo.version, `${cfg.mihomo.asset}-${cfg.mihomo.version}.gz`)
  const bin = join(cache, `mihomo-${cfg.mihomo.version}`)
  writeFileSync(bin, gunzipSync(readFileSync(gz)), { mode: 0o755 })
  const mmdb = await asset('MetaCubeX/meta-rules-dat', 'latest', 'country.mmdb')
  for (const c of picked) {
    step(`client ${c.name} (${c.ssh}): mihomo ${cfg.mihomo.version} on 127.0.0.1:${c.port}, controller :${c.controllerPort}`)
    await deployClient(c, bin, mmdb)
  }
}

async function deployClient(c, bin, mmdb) {
  const conf = paths.client(c)
  const dir = '/tmp/mihomo-deploy'
  upload(c.ssh, dir, [bin, mmdb, conf, join(here, 'mihomo.service')])
  ssh(c.ssh, `
D=${dir}
id mihomo >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/mihomo --no-create-home --shell /usr/sbin/nologin mihomo
install -d -m 750 -o mihomo -g mihomo /var/lib/mihomo
install -d -m 755 /etc/mihomo
install -m 755 "$D/${basename(bin)}" /usr/local/bin/mihomo
install -m 644 -o mihomo -g mihomo "$D/${basename(mmdb)}" /var/lib/mihomo/Country.mmdb
install -m 640 -o root -g mihomo "$D/${basename(conf)}" /etc/mihomo/config.yaml
runuser -u mihomo -- /usr/local/bin/mihomo -t -d /var/lib/mihomo -f /etc/mihomo/config.yaml >/dev/null
install -m 644 "$D/mihomo.service" /etc/systemd/system/mihomo.service
systemctl daemon-reload
systemctl enable --quiet mihomo
systemctl restart mihomo
sleep 3
systemctl is-active --quiet mihomo || { journalctl -u mihomo -n 30 --no-pager; exit 1; }
echo "  mihomo $(/usr/local/bin/mihomo -v | head -1 | awk '{print $3}') active, listening: $(ss -Hltn 'sport = :${c.port}' | awk '{print $4}' | tr '\\n' ' ')"
rm -rf "$D"`)
}

// -------------------------------------------------------------------- main

try {
  const { cfg, exits } = generate()
  if (target === 'exits' || target === 'all') await deployExits(cfg, exits)
  if (target === 'clients' || target === 'all') await deployClients(cfg)
} catch (err) {
  // A failed ssh/scp throws; say so plainly instead of a bare stack trace.
  fail(err.message.split('\n')[0])
}
console.log('\ndone')
