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

## Adult access and live recovery (v40)

The administrator can change **Contenido para adultos (+18)** per user in the
editor or user table. Existing and newly created accounts retain enabled access
until it is explicitly disabled. Saving revokes prior sessions and playback
reservations; clients must sign in again and refresh their catalogs.

Restricted users receive filtered live, movie and series catalogs/categories.
The server also checks details, EPG, playback tokens and direct Xtream media URLs.
Adult flags and adult category/title labels identify content, with nested category
inheritance and provider-scoped IDs. Unlabelled content cannot be classified from
video itself. Episodes inherit their series restriction and are verified against
its details. Cached favorites and continue entries only display titles still in
an allowed catalog. Earlier API clients can obtain episode parentage by loading
series details without adding a new request parameter.

The web live player gives larger fragments a separate load deadline, recovers
ended playlists despite the browser's paused state, reloads stale sources without
allocating another connection, and only seeks into buffered segment boundaries.
VOD seeking and native media transport are preserved. Regression tests include
simulated providers and an ended live timeline; they do not establish the behavior
of a real authenticated 1080p channel on a customer's device.

## Web live diagnostics (frontend v41; Worker remains v40)

**Copiar diagnóstico del corte** appears below the live player. The local trace
records fatal/nonfatal HLS errors, HTTP status codes, playlist sequence movement,
fragment timing and byte counts, parsed codecs, audio/video buffered ranges and
decoded/dropped frame counts. It retains the first stalled timeline before the
watchdog reconnects, plus the two most recent playback attempts. The clipboard
fallback displays selectable text for browsers that deny clipboard access.

Only allowlisted fields are recorded. URLs, signed tickets, credentials, channel
titles, IP addresses, raw errors and media payloads are excluded. Nothing is sent
automatically or stored on disk; changing titles or signing out clears the trace.
The observer neither changes playback settings nor opens provider connections.
This release supplies evidence for the reported browser-only 1080p stalls; it
does not establish their cause or claim that the real signal is fixed. Prior
30-second FFmpeg checks reported H.264 reference-frame warnings on ARG/CHI and
slow response headers, so neither decoding nor delivery can yet be ruled out.
