# Playback reliability

Production keeps a viewer's healthy CCF account across channel changes. Account authorization, permissions and connection capacity are always checked independently of advisory performance data.

## Detection

Startup requests record allowlisted `Server-Timing` stages: authentication, catalog, allocation, provider validation, origin headers and first payload. Slow/error logs contain route classes and random request IDs, never playback paths, credentials or query strings. Recent aggregate timings are available to the owner through `playback-diagnostics`. Timing persistence runs after the response and excludes signed `/stream` refreshes/segments to avoid a per-segment storage bottleneck.

The existing Android 1.0.26 telemetry measures the actual rendered first frame from player preparation. This excludes earlier catalog loading. Server first-payload timing and the synthetic test do not establish decoder/first-frame success.

Five-minute operational checks evaluate recent real playback, server timings, provider metadata and the own-account playback test. Missing/sparse samples are unknown, not recovery. New server-start incidents need at least five requests; their p95 limits are 8 seconds for TV and 12 seconds for movies/series. Existing rendered-frame warnings remain independent.

## Containment and recovery

Three distinct failures within two minutes open a circuit for either account validation or one media item on one account. Initial cooldown is 30 seconds; failed recovery doubles it up to five minutes. Only one atomic recovery trial per affected scope runs after cooldown. A success resets the corresponding circuit. Busy capacity, invalid client ranges, stale requests and client cancellations are not provider failures. Healthy active viewers retain their assignment; another viewer's failure does not disconnect them.

The private `provider-health` endpoint returns aggregate circuit state without account identifiers. When all eligible candidates are recovering, requests fail promptly with a bounded retry interval rather than scanning blocked accounts. No new accounts or origins are added automatically.

## Own-account playback test

Production explicitly configures `PLAYBACK_CANARY_USERNAME=dieguito2026`, the owner's authorised test account. `PLAYBACK_CANARY_ENABLED=true` enables one low-volume test every five minutes, alternating TV and series. The owner can pause/resume or request a test from the existing alerts section. Staging never runs production tests.

The private test obtains an identity only for that configured existing active account. It creates a unique signed session lasting at most one minute, then uses normal session, permission, catalog, allocation and signed-media routes. It cannot select a different customer, reuse customer session IDs or bypass capacity. It follows bounded same-site signed HLS links, validates a binary media prefix, cancels bodies and releases only its own session. The shared test deadline is 15 seconds and retained media is capped at 64 KiB. A full account returns a visible busy result; an absent/expired test account remains a visible failure requiring account administration.

Two distinct failed tests confirm a synthetic incident; two successful tests recover it. Reading status never initiates a test. `/health` exposes only redacted deployment/test status; controls and detailed diagnostics require the existing authenticated owner session.

## Release protection

`npm test`, `npm run test:performance`, SQLite invariants, browser integration and real local video smoke must pass in the exact-head Quality workflow before the existing Cloudflare deploy guard publishes. The performance gate uses controlled sources and a virtual clock; its numbers are regression limits, not measurements of production CCF or client networks. See [playback-performance-gate.md](playback-performance-gate.md).
