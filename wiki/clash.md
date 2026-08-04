# Clash

Notes on the Clash ecosystem, written from the perspective of this Surge repo:
what Clash is, where it went, what the config looks like, and how the concepts
map onto Surge.

Repo metadata and star counts verified 2026-07-30.

## What it is

Clash is a rule-based proxy tunnel written in Go. Traffic enters through a
local HTTP/SOCKS port or a TUN interface, gets matched against an ordered rule
list, and is dispatched to an outbound proxy ("proxy") or policy group. The
model is nearly identical to Surge's: rules select a policy, policies select a
server. The differences are in packaging, licensing and platform reach, not in
the routing concept.

## History

**2018–2023 — original Clash.** Created by Dreamacro. The core was open source
(GPLv3); a closed-source **Clash Premium** build added TUN, rule providers and
a scripting hook. An ecosystem grew around the core: ClashX on macOS, Clash for
Windows, Clash for Android, OpenClash on OpenWrt.

**November 2023 — the takedown.** Clash for Windows was deleted by its author
on 2 November 2023, and over the following day a wave of Chinese-developed
censorship-circumvention repositories were deleted or archived, including the
Clash core itself. The stated motivation was developers reducing personal legal
risk in mainland China. These repos are still gone — verified today:

| Repo | Status |
| --- | --- |
| `Dreamacro/clash` | **404** — deleted |
| `Fndroid/clash_for_windows_pkg` | **404** — deleted |
| `yichengchen/clashX` | **404** — deleted |
| [`zzzgydi/clash-verge`](https://github.com/zzzgydi/clash-verge) | **archived** 2023-11-03 |

**2023–present — mihomo.** The community fork *Clash.Meta* had already been
adding protocols the original lacked; after the takedown it became the de facto
core and was renamed **mihomo**. Nearly every maintained "Clash" client today
is a GUI over mihomo. Archived clients were re-forked: `clash-verge` →
[Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev).

## The core: mihomo

[**MetaCubeX/mihomo**](https://github.com/MetaCubeX/mihomo/tree/Meta) — GPL-3.0,
Go, latest `v1.19.29` (2026-07-18).

> **Gotcha:** the repo's default branch `main` holds an unrelated Python library
> (a Honkai: Star Rail API model that shares the name). GitHub's repo
> description, language and topics all describe *that*. The proxy core lives on
> the **`Meta`** branch — `module github.com/metacubex/mihomo`. Link to
> `/tree/Meta`, not the repo root.

Docs: [wiki.metacubex.one](https://wiki.metacubex.one/).

### Protocols

Verified against the Meta README and the official example config:

- **Core:** Shadowsocks, ShadowsocksR, VMess, VLESS, Trojan, Snell, HTTP,
  SOCKS5, Direct
- **QUIC-based:** Hysteria, Hysteria2, TUIC
- **Others:** WireGuard, SSH, AnyTLS, mieru, GOST relay, Tailscale, MASQUE

For context, Surge supports Shadowsocks, VMess, Trojan, Snell, HTTP(S),
SOCKS5, WireGuard and Hysteria2 — so the overlap is large, but mihomo covers
VLESS/Reality and TUIC, which Surge does not.

## Clients

All are GUIs over the mihomo core unless noted.

| Client | Platforms | Repo | Stars | Notes |
| --- | --- | --- | --- | --- |
| Clash Verge Rev | Win/macOS/Linux | [`clash-verge-rev/clash-verge-rev`](https://github.com/clash-verge-rev/clash-verge-rev) | 134k | Tauri; the mainstream desktop client |
| FlClash | Multi-platform | [`chen08209/FlClash`](https://github.com/chen08209/FlClash) | 47k | Flutter, ad-free |
| Clash Meta for Android | Android | [`MetaCubeX/ClashMetaForAndroid`](https://github.com/MetaCubeX/ClashMetaForAndroid) | 44k | Official Android GUI |
| Clash Party | Win/macOS/Linux | [`mihomo-party-org/clash-party`](https://github.com/mihomo-party-org/clash-party) | 26k | Electron; **renamed** from Mihomo Party |
| OpenClash | OpenWrt | [`vernesong/OpenClash`](https://github.com/vernesong/OpenClash) | 27k | Router-level |
| Karing | Multi-platform | [`KaringX/karing`](https://github.com/KaringX/karing) | 14k | Clash + sing-box rules |
| ClashX.Meta | macOS | [`MetaCubeX/ClashX.Meta`](https://github.com/MetaCubeX/ClashX.Meta) | 6k | Successor to the deleted ClashX |
| metacubexd | Web | [`MetaCubeX/metacubexd`](https://github.com/MetaCubeX/metacubexd) | 4k | Official dashboard, talks to the REST API |
| ShellCrash | Linux/shell | [`juewuy/ShellCrash`](https://github.com/juewuy/ShellCrash) | 13k | Runs mihomo/sing-box headless |

**iOS has no free Clash client.** The practical option is
[Stash](https://apps.apple.com/us/app/stash-rule-based-proxy/id1596063349)
(paid, closed source), which runs a Clash-family core and consumes Clash YAML
including proxy groups and rule providers. So on iPhone the choice is Stash vs
Surge vs Shadowrocket/Loon/Quantumult X — the free desktop story does not carry
over.

**Adjacent, not Clash:** [sing-box](https://github.com/SagerNet/sing-box) (37k)
is a separate universal proxy platform with its own JSON config, often offered
as an alternative core; [Hiddify](https://github.com/hiddify/hiddify-app) (32k)
and [v2rayN](https://github.com/2dust/v2rayN) (113k) are sing-box/Xray clients.

## Linux

Linux is where Clash is strongest relative to Surge, which has no Linux build
at all. Three distinct usage patterns:

### 1. Headless core + web dashboard

The most common server setup. The core ships prebuilt for a remarkably wide
range of targets — `v1.19.29` publishes **64 Linux assets** as `.deb`, `.rpm`,
`.gz` and `.zst` across:

```
386 386-softfloat amd64 amd64-v1 amd64-v2 amd64-v3 amd64-compatible arm64
armv5 armv6 armv7 loong64-abi1 loong64-abi2 mips-hardfloat mips-softfloat
mips64 mips64le mipsle-hardfloat mipsle-softfloat ppc64le riscv64 s390x
```

The `amd64-v1/v2/v3` split targets CPU microarchitecture levels, and separate
`go120` builds exist for older kernels/glibc. Run it as a systemd unit, set
`external-controller`, then point a browser at
[metacubexd](https://github.com/MetaCubeX/metacubexd) or serve it locally via
`external-ui`. The core also has a `Dockerfile` and iptables/TPROXY support
(`tproxy-port`, `iptables.enable`) for gateway boxes.

### 2. Managed by a shell wrapper

[**`nelvko/clash-for-linux-install`**](https://github.com/nelvko/clash-for-linux-install)
— 14.3k stars, MIT, Shell. What clash.guide calls "Clash for Linux", and
despite the name it is a CLI manager, not a GUI. It installs a mihomo (or
Clash) core, wires up systemd, and gives you shell commands:

```sh
clashon                 # enable
clashsub add "<url>"    # add subscription
clashui                 # open the dashboard
```

Detects architecture and pulls the matching kernel. Good fit for a headless box
where you want subscriptions managed without writing YAML by hand.

[**`juewuy/ShellCrash`**](https://github.com/juewuy/ShellCrash) (13k) is the
comparable option and can run either mihomo or sing-box; it's aimed at routers
and embedded Linux as much as desktops.

### 3. Desktop GUIs

All of these ship real Linux packages — verified from their latest releases:

| Client | Repo | Stars | Stack | Linux artifacts |
| --- | --- | --- | --- | --- |
| Clash Verge Rev | [`clash-verge-rev/clash-verge-rev`](https://github.com/clash-verge-rev/clash-verge-rev) | 134k | Tauri/Rust | `.deb` + `.rpm`, amd64/arm64/armhf |
| FlClash | [`chen08209/FlClash`](https://github.com/chen08209/FlClash) | 47k | Flutter/Dart | `.deb`, `.rpm`, `.AppImage`, amd64/arm64 |
| Clash Nyanpasu | [`libnyanpasu/clash-nyanpasu`](https://github.com/libnyanpasu/clash-nyanpasu) | 13k | Tauri/Rust | `.rpm`, `.AppImage` |
| Clash Party | [`mihomo-party-org/clash-party`](https://github.com/mihomo-party-org/clash-party) | 26k | Electron | `.deb` + `.rpm`, amd64/arm64 |
| Clash Mi | [`KaringX/clashmi`](https://github.com/KaringX/clashmi) | 8.5k | Flutter/Dart | Linux amd64 |

Clash Verge Rev is the default recommendation — largest project by a wide
margin, and the widest architecture coverage. Nyanpasu is a sibling Tauri GUI
with a different UI philosophy; Party is Electron, so heavier.

### 4. Terminal

[**`JohanChane/clashtui`**](https://github.com/JohanChane/clashtui) — 622
stars, MIT, Rust. A TUI for mihomo/sing-box. Niche, but the only real option if
you want profile and group switching over SSH without a browser.

### Distro packaging

`clash-meta` exists in Fedora, and AUR carries mihomo packages, so on some
distros the core is a package-manager install rather than a release download.

### Not mihomo-based

[`v2rayA/v2rayA`](https://github.com/v2rayA/v2rayA) (15k, AGPL-3.0) is a
popular Linux web GUI but runs Xray/V2Ray, not the Clash core — it will not
take a Clash YAML. [`MatsuriDayo/nekoray`](https://github.com/MatsuriDayo/nekoray)
(15k) is **archived** as of December 2024 with the author advising people to
find alternatives; it was sing-box-backed anyway.

## OpenSurge for Mac

[`YTwsy/OpenSurge-for-Mac`](https://github.com/YTwsy/OpenSurge-for-Mac) —
GPL-3.0, Go, 1.6k stars, `v0.1.23` (2026-07-28).

> **The name is misleading in the way that matters.** OpenSurge is *Surge-style*,
> not Surge-compatible. It does not read Surge `.conf` profiles — nothing here
> would consume `Shared.ini`. It imports **mihomo YAML**, and mihomo is the
> proxy engine underneath.

What it actually is: a control plane that turns a Mac into a whole-home
gateway. dnsmasq provides DHCP/DNS, mihomo does the proxying, and macOS `pf`
plus IPv4 forwarding provide the native gateway path. Other devices on the LAN
— phones, consoles, TVs, VMs — get DHCP from the Mac and inherit
policy-controlled egress with nothing installed on them, and **each device can
be assigned its own policy** (phone through a proxy, PS5 direct).

That is the interesting overlap with Surge: it targets the same role as Surge's
gateway/Enhanced-Mode setup, openly and on top of mihomo. It adds per-device
attribution Surge does not really offer — live per-device connection counts,
rates, cumulative bytes, and which mihomo egress chain each device is using —
plus a Web GUI and menu bar app.

Config is its own YAML that *renders* a mihomo config. In `imported` mode your
profile contributes `proxies`, `proxy-providers`, `proxy-groups`,
`rule-providers` and `rules`, while OpenSurge retains ownership of the
gateway-critical fields (`allow-lan`, LAN binding, DNS listener and fake-IP
range, TUN, `external-controller`):

```yaml
mihomo:
  profile_mode: "imported"
  profile: "./profiles/home.yaml"
```

`omg render-mihomo` previews the generated config and `omg validate-mihomo`
runs mihomo's own `-t` check before any gateway service starts.

**Caveats worth weighing.** The repo was created 2026-06-29 and is on `v0.1.x`
— roughly a month old and pre-1.0. It takes over DHCP, DNS, NAT and IP
forwarding on the host, which is disruptive if it goes wrong; the project does
advertise a recovery state machine and rollback, but this is not a low-stakes
thing to try on a machine other people's devices depend on. It also markets
itself as an "AI-agent-friendly engineering workspace" (versioned agent wiki,
executable proof gates), which is unusual framing but orthogonal to whether it
routes packets well.

**Relevance here:** it would not replace this repo's Surge setup, and it cannot
consume these profiles. It is worth a look only if the goal is turning the Mac
into a LAN-wide gateway with per-device policies on an open-source stack.

## Configuration

A single YAML file. Top-level keys, taken from the
[official example config](https://github.com/MetaCubeX/mihomo/blob/Alpha/docs/config.yaml):

```yaml
mixed-port: 10801          # combined HTTP + SOCKS inbound
allow-lan: true
mode: rule                 # rule | global | direct
log-level: info
external-controller: 0.0.0.0:9093   # RESTful API for dashboards

tun:      { ... }          # TUN inbound
dns:      { ... }          # built-in resolver, DoH/DoT, fake-ip
sniffer:  { ... }          # infer hostname from TLS SNI / HTTP host
hosts:    { ... }
profile:  { ... }          # persists select-group choices

proxies:         [ ... ]   # servers
proxy-groups:    [ ... ]   # policy groups
proxy-providers: { ... }   # remote subscriptions
rule-providers:  { ... }   # remote/local rule sets
rules:           [ ... ]   # ordered match list
sub-rules:       { ... }   # named branches, entered via SUB-RULE
listeners:       [ ... ]   # additional inbounds
```

### Rules

```yaml
rules:
  - RULE-SET,rule1,REJECT
  - DOMAIN-SUFFIX,baidu.com,DIRECT
  - DOMAIN-KEYWORD,google,ss1
  - DOMAIN-REGEX,^abc,DIRECT
  - DOMAIN-WILDCARD,test.*.mihomo.com,ss1
  - IP-CIDR,1.1.1.1/32,ss1,no-resolve
  - IP-ASN,1,PROXY
  - SUB-RULE,(OR,((NETWORK,TCP),(NETWORK,UDP))),sub-rule-name1
  - MATCH,Others          # the FINAL equivalent
```

Beyond Surge's set, mihomo adds `DOMAIN-REGEX`, `DOMAIN-WILDCARD`, `NETWORK`,
logical `AND`/`OR`/`NOT` combinators, and `SUB-RULE` for branching into a named
sub-list rather than a flat ordered scan.

### Rule providers

The equivalent of Surge's `RULE-SET,<path or url>`, but declared separately and
then referenced by name:

```yaml
rule-providers:
  rule1:
    type: http            # or file
    behavior: classical   # or domain | ipcidr
    format: yaml          # or text | mrs
    url: "https://..."
    path: ./rules/rule1.yaml
    interval: 259200
```

`behavior` must match the file's content type, and `mrs` is a compiled binary
format (`mihomo convert-ruleset …`) that only supports `domain` and `ipcidr`.

Common sources: [`Loyalsoldier/clash-rules`](https://github.com/Loyalsoldier/clash-rules)
(28k) and [`MetaCubeX/meta-rules-dat`](https://github.com/MetaCubeX/meta-rules-dat).

### Proxy groups

Types in the example config: `select`, `url-test`, `fallback`, `load-balance` —
the same four as Surge, minus Surge's `smart` and `subnet`.

```yaml
proxy-groups:
  - name: Proxy
    type: select
    proxies: [Auto, HK-01, DIRECT]
  - name: Auto
    type: url-test
    use: [my-subscription]        # nodes from a proxy-provider
    url: http://cp.cloudflare.com/generate_204
    interval: 300
```

## Clash vs Surge

### Concept mapping

| Surge | mihomo |
| --- | --- |
| `[Proxy]` | `proxies:` |
| `[Proxy Group]` | `proxy-groups:` |
| `[Rule]` | `rules:` |
| `RULE-SET,<file>,<policy>` | `rule-providers:` + `RULE-SET,<name>,<policy>` |
| `policy-path=` (subscription) | `proxy-providers:` |
| `FINAL,<policy>` | `MATCH,<policy>` |
| `underlying-proxy=` | `dialer-proxy:` |
| `#!include Shared.ini` | *no core equivalent* — clients add merge/override layers |
| `external-controller-access` | `external-controller` |
| `DIRECT` / `REJECT` | `DIRECT` / `REJECT` |

Proxy chaining is the closest parallel: mihomo's `dialer-proxy` on a proxy
definition works like Surge's `underlying-proxy` — the outer proxy's transport
is obtained from another proxy rather than a raw socket.

### Where they differ

**Surge only:**

- MITM with a local CA, and therefore working `URL-REGEX` matching, request
  rewriting and HTTP debugging — mihomo has no MITM at all
- JavaScript scripting and Modules
- Deep macOS/iOS integration (Enhanced Mode, per-app rules, `PROCESS-NAME`)
- A polished request inspector; troubleshooting is genuinely better

**mihomo only:**

- Open source (GPL-3.0) and free; Windows, Linux, Android, routers
- VLESS/Reality, TUIC, mieru, Tailscale, MASQUE
- `sub-rules` branching and logical rule combinators
- `sniffer` to recover hostnames when only an IP is available
- Multiple simultaneous inbounds (`listeners`), TPROXY, iptables integration
- REST API with swappable web dashboards
- Compiled `mrs` rule sets for large lists

**Practical differences:**

- **Cost/licensing:** Surge is a paid closed-source app licensed per platform;
  mihomo is free and GPLv3, though the good iOS client (Stash) is paid.
- **Config ergonomics:** Surge's INI-ish format with `#!include` splits cleanly
  across profiles — the mechanism this repo is built on. YAML has no include;
  Clash clients bolt on their own merge/override layers, so multi-profile
  sharing is client-specific rather than a core feature.
- **Stability of the ecosystem:** Surge is one vendor with a manual. Clash is a
  fork of a deleted project with several competing GUIs, and documentation is
  scattered across the wiki, client docs and community guides.

### If you migrated this repo

The routing intent would port almost directly — the policy groups and rule
ordering in `Shared.ini` have one-to-one equivalents. The friction:

1. **The 64 vendored lists are Surge-format.** They would become
   `rule-providers` with `behavior: classical, format: text`. Surge-specific
   entries would not survive: `USER-AGENT` (50 rules across the lists) has no
   mihomo equivalent, and `extended-matching` is a Surge-only flag.
2. **42 `URL-REGEX` rules would be dead weight** — they already are here
   without a `[MITM]` section, and mihomo cannot do MITM at all.
3. **`#!include` has no equivalent**, so the macOS/iOS split would be handled by
   whatever merge feature the chosen client offers.
4. **`Snell` is supported**, so the Snell nodes port unchanged; the AgentNeo
   subscription would become a `proxy-provider` — and `policy-regex-filter`
   becomes the provider's `filter:` field.

## Repositories

**Core**
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo/tree/Meta) — the core (use the `Meta` branch)
- [MetaCubeX/Meta-Docs](https://github.com/MetaCubeX/Meta-Docs) — documentation source
- [MetaCubeX/metacubexd](https://github.com/MetaCubeX/metacubexd) — official dashboard

**Clients**
- [clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev)
- [chen08209/FlClash](https://github.com/chen08209/FlClash)
- [MetaCubeX/ClashMetaForAndroid](https://github.com/MetaCubeX/ClashMetaForAndroid)
- [MetaCubeX/ClashX.Meta](https://github.com/MetaCubeX/ClashX.Meta)
- [mihomo-party-org/clash-party](https://github.com/mihomo-party-org/clash-party)
- [vernesong/OpenClash](https://github.com/vernesong/OpenClash)
- [KaringX/karing](https://github.com/KaringX/karing)
- [juewuy/ShellCrash](https://github.com/juewuy/ShellCrash)

- [libnyanpasu/clash-nyanpasu](https://github.com/libnyanpasu/clash-nyanpasu)
- [KaringX/clashmi](https://github.com/KaringX/clashmi)

**Linux-specific**
- [nelvko/clash-for-linux-install](https://github.com/nelvko/clash-for-linux-install) — CLI/systemd manager
- [JohanChane/clashtui](https://github.com/JohanChane/clashtui) — TUI client

**Gateway / control plane**
- [YTwsy/OpenSurge-for-Mac](https://github.com/YTwsy/OpenSurge-for-Mac) — Surge-style whole-home gateway over mihomo (not Surge-config compatible)

**Rules**
- [Loyalsoldier/clash-rules](https://github.com/Loyalsoldier/clash-rules)
- [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat)

**Adjacent**
- [SagerNet/sing-box](https://github.com/SagerNet/sing-box)
- [hiddify/hiddify-app](https://github.com/hiddify/hiddify-app)
- [2dust/v2rayN](https://github.com/2dust/v2rayN)

**Archived / deleted** (kept for the historical record)
- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge) — archived
- `Dreamacro/clash`, `Fndroid/clash_for_windows_pkg`, `yichengchen/clashX` — deleted

## Sources

- [mihomo wiki](https://wiki.metacubex.one/)
- [mihomo example config](https://github.com/MetaCubeX/mihomo/blob/Alpha/docs/config.yaml)
- [gfw.report — repos deleted since 2 Nov 2023](https://gfw.report/blog/developers_deleted_repos/en/)
- [net4people/bbs#303 — deletion tracking](https://github.com/net4people/bbs/issues/303)
- [Clash Guide](https://clash.guide/en/guide.html)
- [Stash wiki](https://stash.wiki/en/get-started)
