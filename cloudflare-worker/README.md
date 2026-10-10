# SNAPMOVIENOW Edge

Cloudflare Worker backend for authentication/catalog requests and temporary playback URLs. The public frontend remains on GitHub Pages.

## Administration, recovery and operations (v43)

See [ENGINEERING_V43.md](ENGINEERING_V43.md) for MFA enrollment, encrypted backups,
per-customer synchronization, playback health, isolated staging and validation.
The frontend handles an older backend: local favorites/progress and the existing
user editor remain usable; unsupported synchronization/metrics are not retried
repeatedly, and security/recovery shows a pending-server-update message.

The v43 code passes GitHub Quality, including real workerd/SQLite and Chromium.
The 2026-10-09 Cloudflare installation failure was traced to a missing lockfile
in its configured root, `cloudflare-worker`. That directory now has its own
`package-lock.json`, retaining the existing pinned Wrangler dependencies.
Quality also runs the clean installation and production dry build from that root.
After publication, require a successful Cloudflare build and v43 from `/health`
before relying on the new server features. Check the first daily backup after its
cron runs; MFA enrollment remains a deliberate owner action. Keep server secrets unchanged.

Workers Builds dependency installation now waits for GitHub Quality to approve
the exact checked-out commit and branch before the existing `npx wrangler deploy`
command can proceed. Failure, cancellation, timeout or unverifiable approval
blocks deployment. Local and GitHub CI installs skip this wait; manual `npm run
deploy` and `npm run deploy:staging` require it explicitly. Keep npm lifecycle
scripts enabled. See the engineering guide for the remaining Pages/branch settings.

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
The trace separates delivery, decoding and audio-buffer failures without
requiring playback URLs or customer credentials.

## Complete live audio segments (frontend v42; Worker remains v40)

The customer trace shows complete 1.96–2.40 MB fragments arriving in 0.54–0.61
seconds, continuous video buffers and no dropped frames, but only 0.3–1.0 seconds
of audio per 9–12 second fragment. HLS repeatedly seeks over those audio holes.
The web player now disables progressive parsing and feeds complete segments to
the pinned HLS.js 1.6.15 engine. Its Chromium raw MPEG-audio path handles later
progressive chunks with a different timestamp offset from the first chunk,
which reproduces this buffer pattern. The diagnostics also record an allowlisted
container and identify raw `audio/mpeg` rather than reporting an empty codec as
unknown. Download deadlines and the existing live recovery remain in place.

An actual Chromium/MSE A/B test with generated H.264 and MPEG Layer III audio
produced only 0.67 seconds of buffered audio and seven stall/seek errors with
progressive parsing; complete segments produced 30 seconds of audio, continuous
playback and zero HLS errors. Both AAC cases also played without errors. Results
are in `verification/2026-10-09-live-audio-v42.json`. The test uses synthetic
signals; the authenticated customer channel and physical Android device still
require confirmation.

To repeat the optional browser regression, install `hls.js@1.6.15` and
`playwright`, provide FFmpeg and Chromium, then run from the repository root:

```sh
SMN_BROWSER_EXECUTABLE=/absolute/path/chromium node tests/live-audio-runtime.mjs
```

`SMN_QA_MODULES` can point to a separate `node_modules` directory and
`SMN_LIVE_AUDIO_REPORT` saves the four case results. Fixtures are generated and
deleted locally; no provider content or credentials are needed.
