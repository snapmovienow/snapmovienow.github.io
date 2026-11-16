# Meridiano through Surfshark Venezuela

Implementation prepared; **not connected to a real Surfshark account or deployed on a Linux server**. Meridiano must remain unpublished until actual media is verified through the normal SNAPTVNOW DNS playback path.

## Budget constraint — November 15, 2026 (America/Chicago)

The owner declined the proposed paid VPS and requires **zero additional spending**. Do not provision a VPS, buy another subscription, activate a billable trial, or increase the current paid resource tiers. No server was purchased. The deployment instructions below are dormant and apply only if an existing suitable host can be reused without additional cost.

A direct Worker-to-Surfshark proxy path was also researched. It is not implemented or verified with the owner's account, a Venezuelan exit, real media or the current Worker CPU allowance. The Surfshark browser extension being included in the existing subscription does not establish that a custom server-side integration will work. Do not describe this research as a working zero-cost solution. The account page remains inaccessible in the task browser, and no authenticated Surfshark connection is available.

The Cloudflare Worker remains the public entry. A dedicated Linux relay shares the network namespace of a Surfshark OpenVPN container configured for Venezuela. Other SNAPTVNOW traffic does not enter that container. The relay checks Gluetun health before every request and checks its country through Cloudflare every 30 seconds. It then resolves only the official Meridiano Dailymotion live ID (`x9sxu9y`). A successful HTTP page or VPN handshake is insufficient: health also requires a valid HLS media segment.

All media, variant playlists and playlist URI attributes travel through the same VPN namespace. Provider query signatures are preserved internally; public playlist URLs use short-lived opaque resource IDs. There is no arbitrary-URL fetch endpoint on the VPN origin. The origin requires a private bearer token from the Worker, uses HTTPS through Caddy and does not publish the Gluetun control or health ports. Gluetun's firewall stays enabled; a failed VPN has no direct-origin fallback. Encrypted streams remain rejected by the existing bridge probe; no DRM or ad removal is implemented.

## Required access

- A Linux host with Docker Compose, `/dev/net/tun`, `NET_ADMIN`, outbound UDP and sufficient bandwidth. No such production host is currently connected to this project.
- Existing Surfshark **manual OpenVPN service credentials**, distinct from the account email/password. Obtain them in Surfshark's VPN > Manual setup > Desktop or mobile > OpenVPN > Credentials. Reuse existing credentials; do not rotate them and disrupt other installations.
- A DNS hostname for the relay, pointing to that host, with ports 80 and 443 reachable for Caddy certificates.

Surfshark's account page was inaccessible in the task browser. No account credential or server credential has been acquired. No server or subscription was purchased.

## Deployment

Run these commands on the Linux host from this directory:

```sh
python3 configure.py
docker compose config --quiet
docker compose up -d --build
```

`configure.py` prompts privately in the terminal, writes local secret files with restrictive permissions, generates a separate 32-byte origin token, and refuses to replace existing configuration. Credentials are excluded from Git and the Docker build context. The bootstrap script loads Surfshark service credentials inside the VPN container without embedding them into the image or command line.

Configure only the **snaptvnow-meridiano-bridge** Worker:

- `VPN_RELAY_ORIGIN`: the relay's HTTPS origin, without a path.
- `VPN_RELAY_TOKEN`: a Worker secret with exactly the value of `secrets/relay_token`. With Wrangler, use `wrangler secret put VPN_RELAY_TOKEN --config ../wrangler.jsonc < secrets/relay_token`. Never print the token or paste it in chat.

Apply both settings before verification. The protected `/vpn-country` endpoint is the relay's outbound country check; it does not accept a caller-supplied country. It uses Cloudflare's request metadata. A `VE` classification is a preliminary check: the broadcaster can independently reject the same IP.

The Worker refuses a malformed or incomplete VPN configuration and never falls back to its legacy public sources while `VPN_RELAY_ORIGIN` is configured. Existing production DNS/catalog code has not been modified by this package.

## Verification before publishing

1. Confirm `/health` reports `ready: true`, `vpnConnected: true`, and `exitCountry: "VE"` through the public Worker.
2. Fetch `/live.m3u8`, follow its resource IDs through the Worker, and decode video/audio with a real player. Test a continuous session, renewed playlists and normal Range/HEAD behavior. The production media URL and official ID may change; their real behavior is still unverified.
3. Stop the VPN in this isolated stack and confirm already-open resource requests fail. Restart and verify recovery with a fresh root playlist. This outage check requires a real deployment; it has not been run here.
4. Check throughput and concurrent viewers on the selected host. This initial relay does not share/cache video segments between viewers; provision bandwidth accordingly.
5. Only then append Meridiano to the Venezuela catalog and verify authenticated playback through the user's normal DNS, including native Xtream clients.

Local tests use synthetic media. They verify authentication, regional checks, query preservation, opaque HLS rewriting, Range transport, VPN failure handling and the Node HTTP adapter. Docker image build, a real Surfshark tunnel, real Meridiano media, sustained playback and catalog publication remain unverified.

Primary references: [Surfshark manual setup](https://support.surfshark.com/hc/en-us/articles/18230943234322-Where-to-find-servers-for-a-manual-connection), [Gluetun Surfshark provider](https://github.com/qdm12/gluetun-wiki/blob/main/setup/providers/surfshark.md), [Gluetun firewall](https://github.com/qdm12/gluetun-wiki/blob/main/setup/options/firewall.md).
