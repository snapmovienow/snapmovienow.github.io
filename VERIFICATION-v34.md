# Worker v34: complete reseller inventory and restored customer catalogs

Verified in production on 2026-10-08.

## Cause and correction

The reseller connector requested `filter=1` from the provider table. In the observed XUI R6 UI this option is labelled **Active**, but its response omitted usable idle active subscriptions. The connector now requests the complete authenticated inventory (`filter=`), then locally excludes disabled/expired lines and retains each line’s connection limit and existing external usage. Playback continues to validate the selected provider account. No credentials, customer permissions, or expiry dates were changed.

Read-only comparison using the already authorised general reseller: filtered response 58 rows; unfiltered response 828 rows; local validation accepted 742 active, unexpired lines. These counts are point-in-time evidence, not a capacity promise.

The existing Didier10 connection was revalidated with its stored credentials after the deployment. Production admin overview changed from 0 accounts / 0 capacity to **12 active accounts / 36 total slots / 0 SNAPMOVIENOW reservations**. Other connections are preserved when added or refreshed. Slots are shared with provider-side usage and are not exclusive hardware capacity.

## Real customer API checks

Customer `nito`, unchanged existing account, HTTPS production Worker:

| Action | HTTP | Items | Seconds |
| --- | --- | --- | --- |
| auth | 200 | auth=1 | 6.23 |
| get_live_categories | 200 | 64 | 6.89 |
| get_live_streams | 200 | 2395 | 7.51 |
| get_vod_categories | 200 | 61 | 6.85 |
| get_vod_streams | 200 | 14536 | 7.12 |
| get_series_categories | 200 | 40 | 2.65 |
| get_series | 200 | 1351 | 3.32 |

All six catalog endpoints returned non-empty JSON arrays with HTTP 200; authentication returned auth=1. The previous HTTP 502 catalog failure was reproduced before the fix and is resolved in these production requests. Physical APK/UI testing was not performed.

## Playback limit of this verification

A web HLS attempt for ESPN 1 COL 1080 successfully authenticated and prepared its playback ticket (both HTTP 200), but fetching the manifest/media timed out. This verifies catalog restoration, **not** continuous 1080p playback. Explicit cancellation and logout both returned HTTP 200, releasing the test session. Provider signal reliability / 1080p startup remains unresolved by this inventory change.

## Automated validation

- All 14 Worker test files passed before deployment.
- Reseller regression test passed again after refining the explanatory comments.
- Regression covers 12 idle active lines, disabled and expired exclusions, 3-slot limits, external usage, additive sources, deduplication, lease ownership and release.
- Wrangler deploy dry-run succeeded.
- Production `/health` returned version `34`.

The fix removes the inventory loss. It does not remove provider outages, transcode unsupported codecs, or guarantee every upstream channel is available.
