# Direct HTTPS proxy investigation — local only

The owner requires **zero additional spending**. This experiment tests whether an existing Surfshark HTTPS proxy could replace the paid VPS proposal. It does not connect the owner's account, change a live Worker, add a public endpoint, or publish Meridiano.

Run with Node 24, OpenSSL and npm:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

The check generates a fresh, temporary test CA and certificate, starts an authenticated TLS proxy and a TLS origin on loopback only, and bundles a local substitute for `cloudflare:sockets`. It verifies TLS inside TLS, proxy authentication, Range/query preservation, rejection of incorrect credentials, hostname checking, unknown-root rejection and isolation of proxy credentials from the destination. Temporary keys and the bundle are deleted. No production credential is requested, stored or used.

Local protocol checks passed. This is **not proof of Cloudflare edge interoperability, a Venezuelan exit, Surfshark authentication, broadcaster acceptance, usable media, sustained playback, CPU/bandwidth cost or production suitability**. The TLS dependency (`subtls` 0.5.0 via `workers-fetch-proxy` 1.1.0) expressly describes itself as not intended for production. A synthetic CA initially failed because its key-usage extension did not satisfy the dependency's checks; the passing fixture has explicit signing usages. Real certificate-chain compatibility has not been established. Do not weaken validation to make a real destination pass. The selected proxy package also needs a separate cancellation/deadline assessment before any deployment.

Read-only checks on November 15, 2026 (America/Chicago):

- The existing private SNAPTVNOW Control panel lists Ecuador (`Ecu`) and Colombia VPN locations. No Venezuela location was listed. Its VPN vault key is a masked runtime secret. No credential value or vault key was retrieved.
- Dailymotion's public API for the official embedded video `x9sxu9y` returned `geoblocking: ["allow", "ve"]`, `live_status: "offair"`, title `Streaming Meridiano TV`. This describes that online live ID, not the terrestrial broadcaster's status. The player metadata also returned DM007 without a media quality. A regional exit cannot manufacture a live emission when that ID is off air.
- The normal HTTP client did not establish a useful Surfshark proxy handshake. Real proxy reachability remains unverified.
- Automatic approval review rejected deployment of a diagnostic to the existing public Worker because it added an endpoint with a fixed embedded access key and an outbound Surfshark connection. The diagnostic was not deployed. No retries through another deployment mechanism, embedded production credentials or public open proxy are authorized by this experiment. The isolated Worker and main DNS/catalog remain unchanged by these local checks.

Next step, if authorized and supported: test the real account privately, with proper secret storage, no extra paid resources, and no new public diagnostic surface. Require actual live media and normal authenticated DNS playback before publishing the channel. Meridiano remains unavailable in the catalog.

Primary references: [proxy implementation](https://github.com/Timo972/workers-fetch-proxy), [TLS dependency](https://github.com/jawj/subtls), [official video status](https://api.dailymotion.com/video/x9sxu9y?fields=geoblocking,live_status,title).
