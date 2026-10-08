# Worker v36: streaming and lifecycle fixes

Published and verified in production on 2026-10-08.

## Changes

- Finite HTTP video resources now complete at Content-Length instead of waiting for TCP EOF. A regression reproduces the old hang against a socket that remains open after the complete body. Native reads retain bounded blocks and an idle timeout; client cancellation closes the socket.
- Web live playback tries up to three authorised provider accounts, releasing each failed lease before the next allocation. Every attempt has the same request owner. Cancellation and blocked media destinations are never retried.
- Web playback and catalogs use the same bounded inventory snapshot as Xtream while refreshing in the background. The allocator rejects snapshots older than twelve hours; new allocations still validate provider credentials, activity and capacity. This removes the conflicting one-minute web expiry that could reject playback while refresh was pending.

## Validation

All 15 automated test files passed, including capacity, additive sources, exact account expiry, suspension, logout, cancellation races, inventory bounds, finite-body completion and live account fallback. Wrangler deploy dry-run succeeded. Production health reports version 36. GitHub build, deploy, report-build-status and Cloudflare Workers Builds checks succeeded.

Real `nito` Xtream login and all six catalog endpoints returned HTTP 200 with non-empty catalogs: 2,395 channels, 14,540 films, 1,351 series at verification time. No APK binary was changed or physical device tested.

## Video and audio samples

The channels below were decoded with FFmpeg through the production backend. Each successful sample completed approximately 20 seconds of video and audio.

| Requested signal | Delivery | Actual decoded resolution | Frames | First frame after opening stream |
| --- | --- | --- | --- | --- |
| ESPN 1 CHI labelled 1080 | Web HLS | 1280 × 720 | 1190 | 8.95 s |
| ESPN 1 ARG labelled 1080 | Web HLS | 720 × 480 | 595 | 8.50 s |
| ESPN 1 COL 720 alternative | Web HLS | 1280 × 720 | 598 | 8.01 s |
| ESPN 1 CHI labelled 1080 | Native Xtream TS | 1280 × 720 | 1190 | 6.70 s |

The native TS sample ran at approximately realtime speed and completed normally. A separate native disconnect test received 65,536 video bytes, closed the stream and observed customer reservations return from the zero baseline to zero in 4.18 seconds. All web test cancellations and logouts returned HTTP 200.

## Confirmed upstream limitations

ESPN 1 COL labelled 1080 failed preparation. A read-only direct provider comparison with two active accounts under Didier10 returned HTTP 200 text/html, not an HLS playlist, for that source. The 720 alternative returned a valid playlist with one account and completed the production playback sample. The web already has same-channel/country quality fallback; this change adds provider-account fallback.

The CHI and ARG sources labelled 1080 actually delivered 720p and 480p during these tests. No upscale or invented 1080p was applied. Providing true 1080p for these sources requires an authorised provider feed carrying that resolution.

These are short functional samples, not a sustained-load, uptime or physical-device performance guarantee. Network timings include this test environment. The fixes resolve confirmed application transport and allocation bugs; they cannot manufacture an absent upstream signal.

Detailed sanitized measurements: `cloudflare-worker/verification/2026-10-08-streaming.json`.
