# Indexed playback reservations — v38

Validated on 2026-10-08 against baseline commit
`b0e79098a2ce01238e113fa15982264eae59746c` (v37).

## Result

Playback reservations are individual rows in the existing SQLite-backed account
directory Durable Object. Heartbeats update one indexed expiry column; checks and
releases look up one primary key. Session closure deletes only that session's
reservations. Allocation computes provider occupancy once instead of scanning and
deserializing the entire lease collection for every candidate account.

The first request migrates all unexpired legacy reservations in one transaction.
Lease IDs, customer/session ownership and playback request IDs are preserved, so
existing signed tickets retain their identity. The schema marker, copied rows and
legacy deletion commit together. Failed initialization can retry. A restart after
renewal retains both the reservation and its current owner. No new service,
binding, secret or manual administrator action is required.

The public HTTP API, authentication checks, three-connection provider limit,
retry ownership, protected media relay and additive source configuration remain
compatible. Background inventory refresh remains separate from media transfer.

## Measured local load

These are **reservation controller tests**, using synthetic customers/provider
accounts and real local workerd SQLite storage. They do not open provider videos.
Each scenario allocates every playback, executes ten heartbeat rounds with 50
requests in flight, challenges the remaining capacity and closes every session.

| Active reservations | Heartbeats checked | Errors | v38 heartbeat p95 | v37 heartbeat p95 | Reservations left after close |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 1,000 | 0 | 74.342 ms | — | 0 |
| 250 | 2,500 | 0 | 63.887 ms | — | 0 |
| 500 | 5,000 | 0 | 70.932 ms | 106.843 ms | 0 |
| 1,000 | 10,000 | 0 | 73.184 ms | 153.167 ms | 0 |

At 500 reservations, heartbeat throughput was 1.91 times the baseline. At 1,000
it was 2.89 times the baseline, with p95 latency reduced by 52%. At 1,000,
allocation p95 fell from 599.101 ms to 188.644 ms. These local burst measurements
are comparisons on the same machine, not a production throughput guarantee or a
Cloudflare request-rate allowance.

Raw metrics:

- `cloudflare-worker/verification/2026-10-08-lease-load-v38.json`
- `cloudflare-worker/verification/2026-10-08-lease-load-v37-baseline.json`

Runtime: Node 24.19.0, Wrangler 4.149.0, Miniflare 5.20261006.1-alpha,
workerd 1.20261006.1, esbuild 0.28.2. Baseline and v38 used the same fixture,
50-request concurrency and ten rounds; they ran sequentially.

## Correctness and packaging

- All **17** Worker/frontend regression test files passed on the final source.
- Actual workerd SQLite checks passed: live legacy lease migration, expired lease
  removal, primary-key/session index use, atomic SQL/KV rollback, renewed lease
  persistence across Durable Object eviction/restart, foreign-owner rejection,
  old heartbeat/cleanup isolation and no resurrection of expired leases.
- Thirty concurrent duplicate starts allocated exactly one reservation. Four
  competing customers could occupy only the two remaining slots on that account;
  excess requests were rejected. Closing one session released exactly its slot.
- Heartbeat isolation tests with 1,000 unrelated reservations found no collection
  enumeration and only one small reservation write.
- The full regression suite covers web/Xtream authentication and catalogs,
  encrypted media tickets/keys, Range handling, stream cancellation/recovery,
  logout/revocation/expiry, pool refresh and client teardown/retry races.
- Wrangler production dry run succeeded: **133.52 KiB**, gzip **32.31 KiB**,
  existing `PLAYBACK_SESSIONS (PlaybackSession)` binding. The local QA entry is
  excluded from the production bundle.

## Capacity interpretation and production limits

The highest validated local reservation count is **1,000**; 500 is a reasonable
initial operating target for this controller, subject to real provider slots and
production quotas. It is not a measured maximum number of simultaneous videos.
Production capacity is constrained by the smallest of authorized provider slots,
healthy upstream signals, media delivery capacity and Cloudflare plan limits.
Provider-reported use and local reservations retain the existing conservative
accounting; their overlap is not treated as independent physical connections.

Continuous 500-client service needs an appropriate Cloudflare plan and a real
media soak/load test before being advertised as validated. HLS segment requests,
authentication and media checks consume resources beyond periodic heartbeats.
This change reduces reservation contention; it cannot create provider bandwidth,
restore an unavailable channel or establish an exclusive upstream connection.

Direct Worker checks from this execution environment have returned HTTP 403
(`error code: 1010`), and no owner administrator session was available. Therefore
real inventory, production playback latency and 500 real simultaneous streams
are **not certified** by this report. No access protection was bypassed. Release
deployment uses the existing GitHub-to-Cloudflare Workers Builds flow; its commit
checks are verified after publication.
