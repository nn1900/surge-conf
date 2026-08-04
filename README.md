# surge-conf

Surge profiles for macOS and iOS plus a matching Clash/mihomo profile, all
generated from templates so no credential is ever committed. The dler-io rule
sets are vendored for Surge; the Clash profile pulls the same lists remotely.

## Layout

```
*.base.ini / *.base.yaml / *.base.conf   tracked    templates, no secrets
conf-gen.json                            gitignored your providers
.conf/                                   gitignored rendered profiles
Rules/                                   tracked    64 vendored rule sets
scripts/                                 tracked    gen, link, sync
wiki/clash.md                            notes on the Clash ecosystem
```

Templates hold structure only. They do not know your providers' names,
protocol, parameters, URLs, or how many there are — those come from
`conf-gen.json` and are expanded by loops at render time.

## Quick start

```sh
cp conf-gen.example.json conf-gen.json   # then fill in your own providers

pnpm gen --all        # yarn gen --all         | npm run gen -- --all
pnpm link:surge       # yarn link:surge        | npm run link:surge
pnpm sync             # yarn sync              | npm run sync
```

`conf-gen.example.json` documents every option, required and optional.

## Commands

Any package manager works, but they differ on passing flags. **yarn and pnpm
forward them as written; npm needs a `--` separator first:**

```sh
pnpm gen --all
yarn gen --all
npm run gen -- --all
```

With npm the separator is not optional, and forgetting it fails in two
different ways. A flag npm does not recognise makes it print its own usage and
stop, which is obvious. A flag npm *does* recognise — `--all` is one of its own
options — gets swallowed silently: `npm run gen --all` exits 0 having rendered
only the Surge profiles, with no `Clash.yaml` and no warning.

The table lists the script and its flags; prefix them as above.

| script | what it does |
| --- | --- |
| `gen` | render the Surge profiles into `.conf/` |
| `gen --clash` / `gen --all` | render Clash instead / both |
| `gen --out <dir>` | render somewhere else |
| `gen --standalone` | copy `Rules/` into the output instead of symlinking it |
| `gen:check` | verify the templates carry no secrets, render nothing |
| `link:surge [dir]` | symlink the rendered directory into Surge's profiles |
| `sync` / `sync:dry` | publish the iOS profile to iCloud Drive |
| `sync --with-macos` | publish the macOS profile alongside it |

Every script takes `--help`.

## How rendering works

`conf-gen.json` declares `vps[]` and `subscriptions[]`. A node is a name, a
type, a server, a port and an open bag of parameters, so any protocol both
engines support works. Templates loop over whatever is declared:

```ini
{{#vps}}
{{surge}}                       → Name = snell, host, port, psk=…, …
{{/vps}}
{{#subscriptions}}
{{surgeGroup}}                  → Name = select, policy-path=…, prefix=…
{{/subscriptions}}
Proxy = select, …, {{vps.names}}, {{subscriptions.include}}
```

Each VPS also yields a chained variant — `<name> - Relay`, routed through the
`Relay` group via `underlying-proxy` in Surge and `dialer-proxy` in Clash.

Adding a third VPS or a second subscription is an edit to `conf-gen.json`;
neither the templates nor the generator change.

`Rules/` is symlinked into the output rather than copied, because `RULE-SET`
paths are relative to the profile. That keeps one copy on disk and always
current, but it ties the output to this repo. `--standalone` copies instead,
producing a directory that works on its own — use it to hand the config to
someone else, or to keep the generated profiles after deleting the repo:

```sh
pnpm gen --all --standalone --out ~/surge-config
```

### Why the repo is publishable

`pnpm gen` refuses to run if a template contains something that looks like a
real value — a `psk`, a password, a bare IP address, a `policy-path` that is
not a placeholder. The check runs against the **templates**, not the output, so
a provider added to a template but never declared in `conf-gen.json` fails the
build rather than leaking.

## Findings

Things that cost time to work out, most of them undocumented.

### Paths and includes

**`#!include` resolves against the profile's own directory.** Symlinking just
`Surge-Macos.conf` into `Profiles/` fails with *"Failed to load detached
section from: Shared.ini"* — Surge looks for it next to the profile. Symlink
the whole directory instead, so the profile, `Shared.ini` and `Rules/` stay
together. That is what `pnpm link:surge` does, and the same rule is why
`pnpm gen` puts a `Rules` symlink beside the rendered profiles: `RULE-SET`
paths are relative to the profile too, so `Rules/` has to sit in the output
directory rather than at the repo root.

**Surge iOS resolves only one directory level for local `RULE-SET` paths.**
`Rules/AdBlock.list` loads; `Rules/Media/ABC.list` reports *"The file does not
exist"* for all 44 nested lists while every top-level list resolves fine. Surge
Mac handles both depths. This is not in the manual — it was found by loading
the profile on a device and reading External Resources.

Rather than flatten the repo, `scripts/sync-icloud.sh` stages a copy and
rewrites `Rules/<group>/X.list` → `Rules/<group>_X.list`, along with the
references inside the profiles. The source tree keeps its structure for Mac.

**Profiles may live in a subdirectory** — *"Supports choosing profiles in a
subdirectory"* (Surge iOS 4.0.2). That only ever covered locating a profile,
which is why it says nothing about the rule-set path behavior above.

**iCloud Drive can't carry a symlink to the repo.** It doesn't follow symlinks
the way Dropbox does, and more fundamentally a symlink stores a path —
`/Users/…` means nothing on iOS. The real bytes have to live in the synced
folder, hence the publish step.

**`.<profile>.conf.iosinterface`** files hold per-profile UI state next to the
profile. The sync excludes dotfiles, which also protects them from `--delete`;
wiping them loses your policy selections.

### Policies

**`underlying-proxy` is a `[Proxy]` policy parameter, not a policy-group one.**
Its *value* may name a group, which is easy to misread as meaning it can be
declared on a group. Chains are built by defining a proxy policy that carries
the parameter:

```ini
My VPS 1 - Relay = snell, …, underlying-proxy=Relay
```

**`external-policy-name-prefix` renames, it does not filter.** Two groups
pointing at one `policy-path` with different prefixes contain the same nodes
under different labels — and download the feed twice. Use
`policy-regex-filter` to actually narrow a subscription, or
`include-other-group="…"` to reuse an already-loaded group's nodes.

**A `select` group defaults to its first member**, but a manual selection is
persisted per-profile and wins over the config afterward. Reordering a group
you have already touched on a device changes nothing until you re-select.

**`url-test` over a single policy group** tests that group as one unit rather
than latency-testing the nodes inside it. `include-other-group` expands them
into real candidates.

### Rules

**`FINAL` is required** — *"The FINAL rule must be written after all other
rules."* Without it, unmatched traffic falls through to DIRECT. Note that
`FINAL,Others,…` is only as useful as `Others`' first member.

**`skip-proxy` does not skip rule matching.** It *"forces connection to these
domain/IP ranges to be handled by Surge VIF instead of Surge proxy"* — in
Enhanced Mode those connections still hit `[Rule]`. LAN traffic needs explicit
rules, which is why `[Rule]` opens with the builtins:

```ini
RULE-SET,SYSTEM,DIRECT
RULE-SET,LAN,DIRECT
```

**Some vendored rules can't fire.** The lists carry 42 `URL-REGEX` rules, which
only match HTTPS when MITM is enabled for the host (there is no `[MITM]`
section here), and 20 `PROCESS-NAME` rules, which are macOS-only.

### QUIC

**Proxy policies block QUIC by default** — *"If this parameter is omitted,
proxy policies block QUIC by default."* The log line *"QUIC traffic detected,
blocked based on policy settings"* is this default, not a rule in this repo;
`block-quic` is set nowhere. The client falls back to HTTPS/TCP, and the
following *"[UDP] Closed for inactivity"* is just the abandoned session timing
out. `DIRECT` does not block QUIC, so seeing this means the request was
proxied. Override with `block-quic=off` on a policy, or
`external-policy-modifier="block-quic=off"` for a whole subscription.

## Known issues

- **`conf-gen.json` is the only irreplaceable file here.** It is gitignored, so
  it is not on GitHub, and nothing else holds your PSKs, subscription URLs or
  secrets. Losing the working copy means recovering them from your providers by
  hand. Back it up somewhere encrypted before deleting or moving the repo.
- **Edits made in Surge's UI are lost on the next render.** Surge rewrites the
  profile when you change a policy, but the profile is generated and
  gitignored, so `pnpm gen` overwrites it. Change the template or
  `conf-gen.json`, not the rendered file.
- **The `[General]` templates disable the LAN restrictions**
  (`proxy-restricted-to-lan`, `gateway-restricted-to-lan`) while listening on
  `0.0.0.0`, and expose `external-controller-access` on every interface. That
  is an unauthenticated proxy plus a remote-control API for anyone who can
  reach the machine. Tighten these before using the profile on a network you
  do not trust.
- **Vendored rule sets are pinned** to whatever upstream served when they were
  downloaded; nothing refreshes them. The Clash profile does not share this
  problem — it fetches the same lists as `rule-providers`.

## Sources

- [Profile / detached sections](https://manual.nssurge.com/overview/configuration.html)
- [Common policy parameters](https://manual.nssurge.com/policy/parameters.html)
- [Policy including](https://manual.nssurge.com/policy-group/policy-including.html)
- [FINAL rule](https://manual.nssurge.com/rule/final.html)
- [Ruleset](https://manual.nssurge.com/rule/ruleset.html)
- [Misc options](https://manual.nssurge.com/others/misc-options.html)
- [Surge iOS release notes](https://kb.nssurge.com/surge-knowledge-base/release-notes/surge-ios)
