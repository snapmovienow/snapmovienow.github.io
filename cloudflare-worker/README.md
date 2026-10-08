# SNAPMOVIENOW Edge

Cloudflare Worker backend for authentication/catalog requests and temporary playback URLs. The public frontend remains on GitHub Pages.

## Deploy

Use Cloudflare's Deploy to Cloudflare flow for this directory. Set TICKET_SECRET to a long random value when prompted.


Deployment refresh: Cloudflare root directory configured as `cloudflare-worker` (2026-10-03).

## Reservation storage (v38)

The existing SQLite-backed `PlaybackSession` Durable Object stores each playback
reservation as a row in `smn_playback_leases`. The first directory request migrates
unexpired legacy `leases` entries atomically, preserving their IDs and ownership.
No new binding, secret or manual data conversion is needed. Session, customer,
provider and expiry indexes keep heartbeats and releases scoped to one playback.

Run the Worker/frontend regression tests from the repository root:

```sh
for t in cloudflare-worker/tests/*.test.mjs tests/*.test.mjs; do node "$t" || exit; done
```

The optional local workerd load harness uses the installed Wrangler dependencies
(`miniflare` and `esbuild`). If they are in a separate directory, supply
`SMN_QA_MODULES=/absolute/path/node_modules`:

```sh
node cloudflare-worker/tests/lease-runtime.mjs
```

`SMN_SAFETY_ONLY=1` runs the migration, restart and concurrency checks without the
load scenarios. `SMN_LOAD_REPORT=/absolute/path/report.json` saves the metrics.
The test entry is never deployed; production uses `src/index.js`. The measured
reservation capacity and its streaming limits are documented in `VERIFICATION-v38.md`
in the repository root.
