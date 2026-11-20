# Headless-server proxy

A local proxy on servers with no route out of China (mihomo on `127.0.0.1:7890`),
exiting through the VPSes over VLESS + Reality (xray on each VPS, port 443).
Separate from the end-user profiles at the repo root: its own config, templates
and output, and nothing here reads or writes theirs.

| File | Tracked | Role |
|---|---|---|
| `conf.example.json` | yes | shape of `conf.json`, with field notes |
| `conf.json` | no | hosts and credentials |
| `mihomo.base.yaml`, `xray.base.json` | yes | templates |
| `mihomo.service`, `xray.service` | yes | systemd units, non-root with sandboxing |
| `gen.mjs` | yes | renders `.out/clients/<client>.yaml` and `.out/exits/<exit>.json` |
| `deploy.mjs` | yes | installs them over SSH |

## Use

```sh
cp server/conf.example.json server/conf.json   # fill in ssh hosts and VPS addresses
npm run server:gen -- --init                   # generate uuid, Reality keys, short ids, controller secret
npm run server:deploy -- all --dry-run         # download and verify binaries, touch no host
npm run server:deploy -- all                   # every exit first, then every client
npm run server:deploy -- exits "DMIT VPS 1"    # or some exits
npm run server:deploy -- clients app db        # or some clients
```

Binaries are downloaded on this machine and checked against the SHA-256 digest
GitHub publishes for each release file. Clients never download anything.
Every config is tested by its own binary before the service restarts.

On the server, a program opts in:

```sh
export http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 no_proxy=localhost,127.0.0.1
```

China, private ranges, Tailscale and Alibaba Cloud go direct; everything else
goes to the `Proxy` group, whose default is the client's `defaultExit`. Switch
exits through the controller on `127.0.0.1:<controllerPort>` (bearer: the
client's `secret`); the choice survives restarts. All clients share the exits'
credentials; each has its own ports and controller secret.

## Compatibility notes

- mihomo has no Snell v4+, which is why the exits get a second inbound instead
  of reusing the Snell ports Surge uses.
- Xray 26.x rejects a REALITY ClientHello without the X25519MLKEM768 key share;
  mihomo omits it unless `support-x25519mlkem768: true`. Without it every
  connection fails with `REALITY authentication failed`.
- `serverName` must serve TLS 1.3 + HTTP/2 from the VPS. Xray warns that
  `www.apple.com` is a commonly used target and raises the chance of the IP
  being blocked; a less popular site hosted near the VPS is safer.
