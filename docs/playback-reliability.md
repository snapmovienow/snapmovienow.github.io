# Playback reliability

Production keeps a viewer's healthy CCF account across channel changes. Account authorization, permissions and connection capacity are always checked independently of advisory performance data.

## Detection

Startup requests record allowlisted `Server-Timing` stages: authentication, catalog, allocation, provider validation, origin headers and first payload. Slow/error logs contain route classes and random request IDs, never playback paths, credentials or query strings. Recent aggregate timings are available to the owner through `playback-diagnostics`. Timing persistence runs after the response and excludes signed `/stream` refreshes/segments to avoid a per-segment storage bottleneck.

Overlapping calls within a stage count their elapsed wall time once. Serial calls still accumulate; the call count retains every operation. This prevents parallel catalog lookups from inflating the reported wait.

The existing Android 1.0.26 telemetry measures the actual rendered first frame from player preparation. This excludes earlier catalog loading. Server first-payload timing and the synthetic test do not establish decoder/first-frame success.

Five-minute operational checks evaluate recent real playback, server timings, provider metadata and the own-account playback test. Missing/sparse samples are unknown, not recovery. New server-start incidents need at least five requests; their p95 limits are 8 seconds for TV and 12 seconds for movies/series. Existing rendered-frame warnings remain independent.

## Containment and recovery

Channel access checks request only their selected server and reuse provider-scoped full snapshots when available. Immutable row/category arrays have weakly held indexes, so changing a channel checks its row rather than reclassifying the whole catalog. Provider configuration changes invalidate snapshot reuse; account and adult permissions are still checked on every opening.

Series/movie details use a separate durable cache with the same strict thirty-second freshness limit as the in-memory detail cache. Their original fetch timestamp survives background writes; expired details fail closed. A separate 32-entry/four-MiB quota prevents episode browsing from evicting the main catalogs. Optional activity-label reads start only after successful preparation, use verified cached metadata without provider traffic and attach with exact session/user/version/lease/request/media ownership, updating current history without delaying playback.

Uncached full catalogs and item details share an eight-second provider lookup budget per incoming request, including sequential policy/detail lookups and credential discovery. Each server has at most two concurrent source reads, hedged after 750 ms; a source gets at most six seconds and later candidates use only the remaining budget. Fast healthy sources do not trigger a second read. Existing valid scoped snapshots remain available on failure, and durable cache writes run after the response when the execution context supports it.

Provider account validation gets at most 2.5 seconds per read and five seconds accumulated within the existing overall startup deadline. Concurrent checks of the same encrypted credential share only their in-flight upstream operation. Each viewer retains its own capacity reservation, timeout and cancellation; aborting one viewer cannot cancel a check still needed by another. The originating invocation registers the operation with `waitUntil` so its lifetime survives that viewer leaving; only parsed data crosses invocations. Results are not globally cached after completion, and the existing viewer-specific recent validation proof remains unchanged. A real workerd regression checks this cancellation sequence.

Three distinct failures within two minutes open a circuit for either account validation or one media item on one account. Initial cooldown is 30 seconds; failed recovery doubles it up to five minutes. Only one atomic recovery trial per affected scope runs after cooldown. A success resets the corresponding circuit. Busy capacity, invalid client ranges, stale requests and client cancellations are not provider failures. Healthy active viewers retain their assignment; another viewer's failure does not disconnect them.

The private `provider-health` endpoint returns aggregate circuit state without account identifiers. When all eligible candidates are recovering, requests fail promptly with a bounded retry interval rather than scanning blocked accounts. No new accounts or origins are added automatically.

## Own-account playback test

Production explicitly configures `PLAYBACK_CANARY_USERNAME=dieguito2026`, the owner's authorised test account. `PLAYBACK_CANARY_ENABLED=true` enables one low-volume test every five minutes, alternating TV and series. The owner can pause/resume or request a test from the existing alerts section. Staging never runs production tests.

The private test obtains an identity only for that configured existing active account. It creates a unique signed session lasting at most one minute, then uses normal session, permission, catalog, allocation and signed-media routes. It cannot select a different customer, reuse customer session IDs or bypass capacity. It follows bounded same-site signed HLS links, validates a binary media prefix, cancels bodies and releases only its own session. The shared test deadline is 15 seconds and retained media is capped at 64 KiB. A full account returns a visible busy result; an absent/expired test account remains a visible failure requiring account administration.

Only the private adapter issues the signed canary claim, and allocation independently checks the configured owner's username. A capacity check before authentication defers tests before catalog traffic when fewer than two slots are free. A canary leaves one provider slot free and keeps a single indexed lease pointer. Customer allocation atomically releases that background lease before counting capacity; customer leases are never preempted. Late probe cleanup cannot remove the replacement. A preempted 410 is a busy/deferred result, not a source-failure incident.

Two distinct failed tests confirm a synthetic incident; two successful tests recover it. Reading status never initiates a test. `/health` exposes only redacted deployment/test status; controls and detailed diagnostics require the existing authenticated owner session.

## Release protection

The finite `owner-comparison-20261023-v1` investigation runs only through the private configured-owner adapter after ordinary scheduled probes. It attempts at most three times and stops after two matched origin/relay pairs. Each independent TS prefix read is capped at eight seconds/64 KiB; the full owned session has a thirty-second deadline and normal capacity/preemption checks. It compares the same signed prepared target and selected account sequentially, with independent minimal raw-IP/native-fetch control transport rather than the relay parser. Diagnostic samples/cursors are separate; comparisons do not write provider failure circuits. Status reads never initiate a run.

When an origin control fails, the next comparison tries another eligible pooled account for the same cached sample. The exclusion is accepted only from the signed private comparison session; ordinary customer bodies cannot steer it. If no alternate slot is available, normal allocation may be retried and the result explicitly records whether the account actually changed. Provider IDs used to control that experiment stay private and never enter its public result.

Only timestamps, bounded durations/byte counts, HTTP statuses and allowlisted outcome codes enter `/health` comparison status. No URL, media ID, username, credential, arbitrary error or body is retained. A valid direct control with a failed relay identifies our relay path; direct upstream HTTP errors identify the failed upstream response. Two connection timeouts remain explicitly inconclusive because they cannot distinguish the network path from the origin. This is not a full-traffic capture and never opens a customer account.

`npm test`, `npm run test:performance`, SQLite invariants, browser integration and real local video smoke must pass in the exact-head Quality workflow before the existing Cloudflare deploy guard publishes. The performance gate uses controlled sources and a virtual clock; its numbers are regression limits, not measurements of production CCF or client networks. See [playback-performance-gate.md](playback-performance-gate.md).
