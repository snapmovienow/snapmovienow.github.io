# Playback release gate

`npm run test:performance` sends ordinary Xtream requests through the real
worker handler. Its isolated fixtures provide four provider accounts, eight
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
| Every source times out | One total budget: 8,000 ms live / 12,000 ms movie and series; at most three validation attempts; no leaked reservation |
| First TS payload | Deliver the small first payload instead of waiting for a full coalescing block |

The ordinary regression suite also tests silent HTTP 200 responses, hedged
episode metadata, initial native byte reads, source recovery and cancellation.
The video smoke separately verifies generated H.264/AAC decoding in Chromium.

Quality runs this gate before platform/browser checks. A failed assertion fails
the Quality workflow; the deployment guard requires that exact commit's
successful Quality run before publishing. An optional
`SMN_PERFORMANCE_REPORT=artifacts/playback-performance.json` records only bounded
scenario totals, without provider URLs, credentials or customer identities.
