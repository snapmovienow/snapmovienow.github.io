# Playback release gate

`npm run test:performance` sends ordinary Xtream requests through the real
worker handler. Its isolated fixtures provide four provider accounts, eleven
synthetic customers and serialized in-memory storage. No external request,
customer account or production connection is used.

Provider delays advance a virtual clock. Account-validation timeout signals
are honored by the fixture, so an exhausted deadline is observable without
sleeping for seconds or relying on a shared CI runner's speed. This measures
retry amplification and routing behavior; it does not certify real first-frame
latency, Cloudflare CPU, network capacity or device decoding performance.

| Scenario | Release requirement |
| --- | --- |
| One slow source before a healthy source | Recover within 4,000 virtual ms; at most three account attempts |
| Twelve rapid TS/HLS channel changes | Preserve healthy viewer affinity; zero repeated fresh validations; at most one viewer reservation |
| Movie and episode resume | Preserve `Range` and `206`; at most one validation for five requests per type |
| Five concurrent viewers | Independent owners, at most three slots per provider, all reservations released on disconnect |
| Three viewers validating the same account concurrently | One upstream validation, three independent lease owners, normal capacity checks |
| Every source times out | At most 5,000 ms in provider validations within the overall 8,000 ms live / 12,000 ms movie and series budget; at most three attempts; no leaked reservation |
| First TS payload | Deliver the small first payload instead of waiting for a full coalescing block |

The ordinary regression suite also tests silent HTTP 200 responses, hedged
episode metadata, initial native byte reads, source recovery and cancellation.
It also checks selected-server permission lookup with ten thousand catalog rows,
nonblocking administrator labels, cold-isolate snapshot reuse and strict
thirty-second detail expiry. Real SQLite safety checks verify that concurrent
customer starts preempt only the configured canary, preserve every customer
lease and reject stale/foreign deferred metadata updates.
The video smoke separately verifies generated H.264/AAC decoding in Chromium.

Quality runs this gate before platform/browser checks. A failed assertion fails
the Quality workflow; the deployment guard requires that exact commit's
successful Quality run before publishing. An optional
`SMN_PERFORMANCE_REPORT=artifacts/playback-performance.json` records only bounded
scenario totals, without provider URLs, credentials or customer identities.
