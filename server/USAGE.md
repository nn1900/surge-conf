# Using the proxy on the zhichetech servers

These servers can't reach GitHub, Google, Docker Hub or most of the internet
outside China directly. Each one runs **mihomo** as a local proxy that exits
through overseas VPSes. Nothing goes through it unless a program is told to use
it. How it's built and deployed: `README.md` in this folder.

| Server | SSH | Proxy | Control API |
|---|---|---|---|
| olap | `ssh olap.zhichetech.com` | `127.0.0.1:7890` | `127.0.0.1:9090` |
| app | `ssh app.zhichetech.com` | `127.0.0.1:7890` | `127.0.0.1:9091` (Prometheus has 9090) |
| db | `ssh db.zhichetech.com` | `127.0.0.1:7890` | `127.0.0.1:9090` |

Port 7890 speaks both HTTP and SOCKS5, on loopback only. China, private
networks, Tailscale and Alibaba Cloud go direct even when the proxy is used.
Everything else exits through **DMIT VPS 1** by default.

## Recipes

**One command:**
```sh
https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 curl -sI https://github.com
```

**A whole shell session:**
```sh
export http_proxy=http://127.0.0.1:7890 https_proxy=http://127.0.0.1:7890 \
       HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 \
       no_proxy=localhost,127.0.0.1,::1 NO_PROXY=localhost,127.0.0.1,::1
```
`pip3`, `npm`, `git` over HTTPS, `curl` and `wget` all honor these. Undo with
`unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY`.

**git only:** `git config --global http.proxy http://127.0.0.1:7890`.
Undo with `git config --global --unset http.proxy`. For SSH remotes such as
`git@github.com`, add `ProxyCommand nc -X 5 -x 127.0.0.1:7890 %h %p` under
`Host github.com` in `~/.ssh/config`. This needs nmap's `nc`; check that `nc -X` works first.

**A systemd service:** add a drop-in rather than editing the unit:
```sh
systemctl edit <service>     # then add:
# [Service]
# Environment="HTTPS_PROXY=http://127.0.0.1:7890" "HTTP_PROXY=http://127.0.0.1:7890" "NO_PROXY=localhost,127.0.0.1"
systemctl restart <service>
```

**yum/dnf:** usually not needed, because the Alibaba Cloud mirrors are domestic
and fast. For an overseas repo only, add `proxy=http://127.0.0.1:7890` to that
repo's section in `/etc/yum.repos.d/*.repo`, never globally in `yum.conf`.

**Docker (app only):** image pulls already go through mihomo, set in
`/etc/systemd/system/docker.service.d/override.conf`. This replaced an older
proxy on the user's Mac (`10.8.0.33:6152`). Live restore is off, so
`systemctl restart docker` restarts all of app's containers; ask before doing it.
The yum repo for OpenVPN Access Server (`/etc/yum.repos.d/openvpn-as-centos7.repo`)
also goes through mihomo.

## Don't

- Don't set the proxy globally (`/etc/environment`, `/etc/profile.d`) without asking.
  Database clients, replication and internal APIs should never go through it.
- Don't proxy anything that only talks to `10.x`, `172.16–31.x`, `192.168.x` or `100.x`
  addresses. Those go direct anyway, so it gains nothing and adds a moving part.
- Don't edit `/etc/mihomo/config.yaml` on a server. It is generated, and the next
  deploy overwrites it. Change `server/` in the surge-conf repo and redeploy.

## Check and troubleshoot

```sh
systemctl status mihomo --no-pager           # running?
curl -s -m 10 -x http://127.0.0.1:7890 https://api.ipify.org; echo   # expect the selected VPS's IP
journalctl -u mihomo -n 30 --no-pager        # each connection, its matching rule and its exit
```

**Switch exits.** The bearer secret is the `secret:` line in `/etc/mihomo/config.yaml`.
Replace `$CP` with the server's control API port.
```sh
S=$(grep '^secret' /etc/mihomo/config.yaml | cut -d'"' -f2); CP=9090
curl -s -H "Authorization: Bearer $S" http://127.0.0.1:$CP/proxies/Proxy | python3 -m json.tool | grep -E '"now"|"all"' -A5
curl -s -X PUT -H "Authorization: Bearer $S" -d '{"name":"DediRock VPS 1"}' http://127.0.0.1:$CP/proxies/Proxy
```
The choices are `DMIT VPS 1`, `DediRock VPS 1`, `DediRock VPS 2`, `Auto` (the fastest)
and `DIRECT`. The choice survives restarts.

**Test every exit's latency:**
```sh
for n in DMIT%20VPS%201 DediRock%20VPS%201 DediRock%20VPS%202; do
  curl -s -H "Authorization: Bearer $S" "http://127.0.0.1:$CP/proxies/$n/delay?timeout=8000&url=http://cp.cloudflare.com/generate_204"; echo; done
```

**`REALITY authentication failed` in the log** means the client and xray on the
VPS disagree. Usually one side was redeployed without the other. Redeploy from
the repo, not by hand.
