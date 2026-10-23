# Owner reseller service monitor

The existing owner portal exposes **Dashboard → Monitor de servicio**, below
**Conexiones en vivo**. Its read-only filters select an authorised connected
reseller, one hour / 24 hours / seven days, a provider group and content type.
The signed `presence.monitor` bridge fixes the account scope to its verified
signer. General monitor access in the reseller Site additionally requires the
owner overview; a reseller cannot request the combined monitor.

An existing five-minute cron samples valid playback reservations, excluding
expired customers and obsolete account versions. Users are counted distinctly
within each selected scope. Hourly bounded records retain seven days. Collection
continues while the UI is closed. There is no historical backfill: missing
observations stay missing and a single unavailable reseller makes the combined
totals unknown. The UI refreshes only while visible and rejects stale results.

Compatible player metrics reuse the authenticated, lease-bound quality path and
the existing ingestion receipt/rate limit. No provider requests, media-body
inspection, new per-chunk calls, customer login or extra paid service is added.
Metrics record counters and a bounded startup histogram, never credentials, IPs,
titles or customer identifiers in the historical groups. Histograms are merged
before calculating percentile upper bounds; percentile values are not averaged.

Player-reported bytes give an interval average of **reported output**, not total
server bandwidth. Upstream input is explicitly unavailable. Third-party players
such as Smarters contribute live connection counts but may send no quality or
byte reports. Missing reports do not establish that playback is healthy or broken.
These coverage limits are visible in the interface and must not be replaced by
estimated or fabricated measurements.
