# SNAPMOVIENOW Edge

Cloudflare Worker backend for authentication/catalog requests and temporary playback URLs. The public frontend runs on GitHub Pages at https://app.snaptvnow.com with enforced HTTPS.

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
cron runs. The owner confirmed SNAP administrator MFA enrollment and a new login on 2026-10-09. Recovery renewal remains a private owner action: it requires the password and a fresh authenticator code, invalidates old recovery codes and sessions, preserves the factor, and shows eight new codes once. Keep server secrets unchanged.

Workers Builds dependency installation now waits for GitHub Quality to approve
the exact checked-out commit and branch before the existing `npx wrangler deploy`
command can proceed. Failure, cancellation, timeout or unverifiable approval
blocks deployment. Local and GitHub CI installs skip this wait; manual `npm run
deploy` and `npm run deploy:staging` require it explicitly. Keep npm lifecycle
scripts enabled. See the engineering guide for the remaining Pages/branch settings.

## Deploy

Use Cloudflare's Deploy to Cloudflare flow for this directory. Set TICKET_SECRET to a long random value when prompted.

## Compatible exclusive pages: Pelisflix / VOE (2026-10-25)

Owner publication request (2026-10-25): `yaga-import.mjs` performs one narrowly
scoped import through the existing private catalog-maintenance tick. It checks
both YAGA (2026) episodes before saving anything through normal exclusive-catalog
validation and auditing. It has no public write route, credentials, browser
dependency, new schedule, or permission changes. Existing matching identities,
covers, metadata and healthy sources are preserved; concurrent manual changes
and duplicate identities stop publication. Three failed source checks end the
attempt, and a completed import never republishes a later manually hidden title.
The sanitized result is `catalog_maintenance.exclusiveImport` in `/health`, with
request ID `yaga-2026-owner-publish-20261025-v1`. Only `state: completed` confirms
publication. The data seed is limited to season 1 episodes 1 and 2; it does not
discover future episodes or reactivate the cancelled Beerus task.

The existing APK protocol and `gnula` page mode also accept reviewed HTTPS pages
on `pelisflix200.city` under `/serie/`, `/episodio/` and `/pelicula/`. The editor
labels this option **Página compatible · Gnula / Pelisflix**. Store the stable
episode page, set the source label to PELISFLIX, and keep existing series and
episode IDs when repairing a title. Each playback resolves a fresh media URL;
signed CDN addresses must never be saved in catalog data or this repository.

The adapter reads advertised player choices without executing page JavaScript,
prefers Latino, then Castellano, then subtitles among supported VOE choices,
and parses the reviewed `nupload.my/iframe/` wrapper without fetching it.
VOE's reviewed `jamespatterncamera.com` redirect must preserve the exact episode
path. Unknown providers/redirects, nonpublic destinations and 403 responses fail
closed. Existing Gnula/Uqload handling and the narrower maintenance-feed Gnula
allowlist are unchanged. No new APK, secrets or catalog migrations are required.

`pelisflix-voe-v1` in `/health` identifies the deployed integration. Automated
regressions cover page validation, wrapper handling, language selection, fresh
signatures, redirects, backup validation and the existing native authenticated
episode route through signed HLS segments and AES keys. These tests do not
establish playback on a physical Android/Fire TV device or a provider uptime SLA.

## Rotating live media destinations (2026-10-11)

Authenticated production probes found ESPN 720 delivering H.264/AAC while
ESPN 1080 COL, CHI and ARG preparation failed with `media_origin_unapproved`.
The bridge previously allowed only three fixed upstream media IPv4 addresses.
It now follows public IPv4 destinations and HTTP ports returned by the configured
CCF provider, preserving that provider's provenance in encrypted HLS tickets,
nested playlists, segments, keys and Range recovery. Other providers do not gain
this permission. Private, loopback, metadata, shared, reserved and multicast
addresses, embedded credentials and SMTP port 25 remain blocked at every hop.
Account expiry, revocation and playback reservations are unchanged.

The `rotating-media-origins` health capability identifies this correction after
deployment. Regressions simulate destination rotation at 0, 12 and 24 hours and
verify transport, HLS resources, Range headers and rejected destinations. These
controlled-clock tests do not establish a real 24-hour soak or guarantee that an
upstream channel is available. The provider's 1080 label also does not guarantee
1920×1080 video: the sampled ESPN 2 MEX stream advertised 1280×720.

After the production deployment, FFmpeg decoded real video and audio for ESPN 1
COL/CHI/ARG, ESPN 2 ARG, HBO and Discovery, preserving the 720 control channel.
The native Xtream entry points were also checked through both TS and HLS for
ESPN 1 COL/CHI. Samples ran for about 20 seconds, not on a physical Android or
Smarters device. Some initial attempts returned transient upstream 503 errors;
retries succeeded. CHI–ESPN 1 (PM) remained unavailable and returned upstream
404 through native TS. That provider signal needs restoration independently of
the IP policy fix. Bounded, credential-free evidence is in
`verification/2026-10-11-rotating-live-media.json`.


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


## Official Kansas local TV (2026-10-29)

The owner requested KWCH news, Storm Team 12 weather, WIBW news and KAKE news
in Exclusivo. `official-live.mjs` accepts only their four exact HTTPS station
pages. It resolves the public players afresh, uses anonymous Quickplay device
authorization and its required heartbeat for Gray, and retains the same Google
SSAI advertisements as the official web player. KAKE uses its reviewed embedded
TownNews player. No subscriber account, location override or DRM bypass exists.
HTTP failures, blackouts, unknown sources and DRM fail closed.

Catalog entries retain stable pages and IDs. Anonymous playback tokens stay in
encrypted, session-bound media tickets or bounded process memory, never public
feeds, logs or persistent catalog records. Cross-origin HLS resources and
redirects are limited to reviewed station-specific media paths, Google SSAI and its Googlevideo ad CDN;
other exclusive content retains the original same-origin policy. Existing
session, lease, revocation and movie permissions remain enforced; local TV also
requires TV permission. The installed native API still sees movie-shaped cards
marked EN VIVO under Exclusivo / Películas. A dedicated native channels tab
would require an APK change; this integration does not distribute an APK.

`local-tv-import.mjs` is a finite one-time owner-authorized publication through
the existing private maintenance tick. Each station is published only after the
production server checks its playlist, required initial resources and sampled
video bytes. Failed stations have at most three attempts. Existing/manual
records and later hides are preserved; no public mutation route, new cron,
credentials or unrelated catalog changes are introduced. Confirm the matching
`catalog_maintenance.localTvImport.requestId` and completed results in `/health`
before claiming publication. Request: `kansas-local-tv-owner-20261029-v2`.

FOX Kansas is held because its observed current live choices were national
event streams, not confirmed local KSAS video. PBS Kansas is held because its
player requires geographic/DRM handling outside this reviewed adapter. Neither
is represented by a different station or a national feed under a local label.
KSN's public page returned 403 during review and is not published.

Automated tests cover the unchanged native exclusive route, authorization,
SSAI preservation, required heartbeats, denied redirects/resources, blackouts,
DRM, private import concurrency, manual edits and encrypted backup validation.
Short real upstream samples decoded H.264 1280x720 and AAC for all four channels.
They do not establish physical-device playback or continuous provider uptime.


The local TV adapter uses `redirect: manual` for page and anonymous API requests
and rejects 3xx responses rather than following them. Workers does not implement
`redirect: error`; Node-only mocks did not catch that difference. The real
workerd regression performs all four adapter flows with synthetic public-player
responses. The v2 import retries the previously unvalidated channels through the
same media gate; stable IDs and manual/hidden records are preserved.

### External Xtream apps: LOCAL KANSAS

The owner requested these four stations in their own LOCAL KANSAS folder directly
after CANALES-NOVELAS in an independent Xtream app configured with
`https://api.snaptvnow.com:443`. `local-tv-xtream.mjs`
projects only the four already-published official records into the standard
`get_live_categories` / `get_live_streams` responses. It exposes one dedicated
category, inserted immediately after CANALES-NOVELAS in server order (appended
if that anchor is absent). Only the four local stations move out of NOVELAS;
upstream category/channel records and their relative order remain unchanged. Stable
numeric stream IDs use their own registry namespace, preserving provider IDs,
favorites and existing exclusive records. This changes the DNS server's output,
not the external app's panel or APK.

Authenticated `/live/user/password/id.m3u8` requests resolve the official player
afresh and use the same signed HLS media proxy, reviewed source restrictions,
anonymous upstream heartbeat and three-connection account limit as Exclusivo.
TS requests redirect to the supported HLS route; the server does not advertise
an invented MPEG-TS rendition or fabricated EPG. The TV path requires TV
permission, current source identity and saved visibility; it does not require
movie access or grant access to any other exclusive title. Revoked accounts and
manual source/visibility changes remain enforced. The four channels remain in
the original Exclusivo view as well. `catalog_maintenance.localTvXtream` in
`/health` reports this adapter's version, folder and eligible saved station IDs,
not a claim of physical-device playback or a new upstream health check.

The full-Worker regression covers category filtering and fallback, stable IDs,
GET/POST, signed playlists and video bytes for all four fixtures, existing
provider channels, TV-only accounts, hidden/changed sources, authentication,
lease limits and revocation. No customer data, credentials or temporary HLS URLs
are added to the repository.

Fresh KAKE playback also referenced the TownNews/G-Mana public gap slate on
`evrideo.g-mana.online`. Only the exact observed `/gmana-assets/slates/` asset
directory `8a1b14d7-36b9-4901-b333-e62abebbb973` is accepted for KAKE; other
directories, lookalike hosts and use by a Gray station are rejected. The official
player's slate and advertising remain part of the feed.


### LOCAL KANSAS expansion (2026-10-30)

The owner requested Univision Kansas and additional local stations. The reviewed
expansion candidates are WIBW Weather, KCTV5+ news, First Warn 5 Weather and KOAM
News Now (Pittsburg/Joplin/Four States). They are the stations' official web news
and weather feeds, not full network affiliate signals. Stable official weather
landing pages distinguish weather from each station's news feed; the exact
weather channel ID is confirmed in that station's official livestream catalog.
KCTV uses its published `kctv` property and `www.kctv5.com` web origin. Only its
observed, station-scoped `-v4.isml` rendition path is additionally permitted.
KOAM's public source is resolved afresh from its official watch page. Its Amagi
playlist and beacon/media routes remain confined to the one reviewed host and
KOAM channel path, retaining the player source parameters and ad-stitched feed.
No geographic/DRM bypass, Facebook login, stored cookies or temporary HLS URLs
are introduced.

`EXTRA_OFFICIAL_CHANNELS` appends to `LOCAL_TV_CHANNELS`; never reorder the list,
as its positions retain the stable Xtream identities of existing channels.
`runLocalTvExpansion` uses the original private import's media-byte gate,
concurrency protection and finite three-attempt budget with a separate request
and storage key. It preserves completed original jobs, existing/manual records,
hidden entries, favorites and playback revisions. The public sanitized report is
`catalog_maintenance.localTvExpansion`, request
`kansas-local-tv-expansion-owner-20261030-v1`. Publication requires matching
request ID, `state=completed` and the individual added/media-check results.
The original four stay in LOCAL KANSAS directly below CANALES-NOVELAS. No APK
change is needed.

Univision Kansas' owner advertises local Facebook broadcasts. At review, no
continuous public compatible station stream was verified; the old domain did
not provide a station player. Telemundo Kansas City's official Veo Telemundo
page supplied reception guidance, not a verified local HLS feed. KSN/KSNT public
live pages returned HTTP 403, PBS supplied geographic/DRM-aware players, and
FOX Kansas' available choices were not verified as the local linear station.
Those stations are not replaced by unrelated national feeds or blank cards.

### New York, New Jersey and California web news (2026-10-30)

The owner requested three additional folders below LOCAL KANSAS. The Xtream
adapter now presents LOCAL KANSAS, LOCAL NEW YORK, LOCAL NEW JERSEY and LOCAL
CALIFORNIA, in that order directly below CANALES-NOVELAS. Existing provider
records and original Kansas numeric IDs remain unchanged. New York/New Jersey
share Telemundo Noticias Noreste: one saved source, with separate stable numeric
folder entries for external apps that group by scalar category_id. Hiding or
editing that one source affects both entries. Philadelphia news is identified
as Philadelphia/South Jersey, rather than as a New Jersey-licensed station.

`regional-live.mjs` resolves the approved free news streams from the actual
NBC/Telemundo and CBS official players. NBC's station-specific public FAST
source and advertising parameters are retained; CBS uses its published Google
DAI ad-stitched stream, not the raw preview URL. Only reviewed per-station media
hosts, manifest routes, init segments and ad resource paths are permitted.
Canonical Telemundo `/ver/` pages avoid unnecessary page redirects. No subscriber
login, geography override, DRM or advertisement bypass is introduced. Regional
Telemundo news is distinct from the full Telemundo affiliate programming.

The separate finite owner request is `regional-local-tv-owner-20261030-v1`,
reported at `catalog_maintenance.regionalTvImport`. The existing private cron
uses the playlist, initial-resource and video-byte gate before saving each
candidate, preserves existing/manual/hidden entries and stops after at most
three attempts. ONNJ was also researched through its official home-page player,
but its Amagi source returned 403 and is not included among published candidates.
The eight Kansas records and earlier completed jobs are not reset. No new
schedule, public write endpoint, customer record or APK is created or changed.

Univision NOW's public FAQ requires participating television-service access and
limits local station availability by location. It is not a freely reusable
local stream for these folders. The current official Noticias Kansas site was
also checked: its public player status returned `is_local:false` and a national
news fallback, not a confirmed local Univision broadcast. The official Telemundo
Kansas City site still supplies reception guidance. News 12 New Jersey's live
page requires TV-provider authentication. These are not replaced by unrelated
national feeds or represented by unverified cards.

Regression coverage includes real workerd parsing and HLS byte probes, signed
regional playback, four ordered folders, original IDs and provider order,
shared NY/NJ membership, manual visibility, scoped station/ad resources,
forbidden destinations and finite partial imports. Upstream decode evidence is
recorded separately; short server-side samples do not establish continuous
uptime, every rendition or playback on a customer's physical device.

### Local TV startup optimization (2026-10-30)

Local channel starts previously downloaded the full official page each time,
recreated the Gray anonymous device, read the catalog twice and repeated a large
master URL plus root-only state in every signed HLS resource URL. These costs
are reduced without changing channel IDs, folders, media renditions, the APK or
the upstream account path.

`public-live-descriptor.mjs` stops reading a public page when the exact approved
player descriptor is found. Only small anonymous public descriptors are cached
for sixty seconds: bounded per-adapter memory and, for the default production
adapter, a separate named Cache API namespace in the current data center.
It never caches customer permission, a playback grant, media playlists/segments,
a Quickplay device or a viewer's ad session. Expired/missing/failed entries are
refetched; media HTTP failures invalidate the relevant public descriptor. Source
maintenance probes still perform their default fresh-page checks.

Gray public-page confirmation and anonymous device setup run independently.
Anonymous device setup may be reused in private bounded memory for at most sixty
seconds, only for the same signed viewer session and station, capped by known
token/viewer expiry. An in-use device is not shared by overlapping starts.
Content authorization always runs for each new start, including blackout/DRM
checks. An HTTP 401/403 from a reused device causes one fresh setup attempt.
Every playback keeps a separate heartbeat identity/token even when its anonymous
device is reused. No device credentials enter the public metadata cache or repo.

The internal live adapter reuses its just-read row; authoritative acquisition
still rechecks the current saved identity, permissions and playback revision.
Every signed resource retains its own session, user/version,
parent/item/revision, lease, request, expiry and official-page scope. Only
redundant source/root fields are removed; binary resources omit the playlist-only
anonymous heartbeat. Non-official media retains its original same-origin source
contract. Advertisements, captions, audio and all adaptive variants remain.

`localTvXtream.startup.version=2` in public health reports the active configuration;
root official playlists also carry `X-SNAP-Local-Startup: 2`. These are deployment
markers, not claims of physical-device latency. Credential-free short upstream
measurements, including the failed baseline sample and limits of the comparison,
are in `verification/2026-10-30-local-tv-startup.json`. Native buffering, network
conditions and upstream response time can still affect time to image.

The follow-up groups local-media catalog scope checks and lease renewal in the
same authoritative transaction. That RPC runs alongside the uncached session
check, replacing a separate item-read RPC and a serial renewal step on every HLS
resource. It still checks the current account/version, session, request binding,
item/parent/revision, visibility, TV permission and lease before fetching media.
A rejected session releases the matching lease, so parallel renewal cannot keep
an expired session's slot alive. VOD and other providers retain their paths.
The directory explicitly acknowledges the atomic scope check. During rolling
deployments, a response from an older instance without that acknowledgement
requires the original item read before any source request.

`startup.observations` contains bounded one-hour aggregates by the twenty fixed
station IDs: playlist delivery and first video-resource bytes. Collection runs
off the streaming path via `waitUntil`; each stage is recorded at most once per
lease. Audio, keys and initialization maps do not count as video. Summaries keep
counts and timings, never viewer identities, credentials, IPs, source addresses
or tickets. These are server/request sequencing measurements, not rendered-frame
timings, and remain empty until real playback requests reach this version.

### /health: reachability versus retained diagnostics

HTTP 200 and ok:true mean this API handler is reachable, preserving the existing
connection-check contract; they do NOT assert working playback or complete
operational diagnostic evidence. apiStatus:"reachable" makes that scope explicit.
Check status (diagnostics_complete or degraded), diagnosticsComplete, and
components.catalog/canary/comparison before interpreting saved diagnostics.
Unavailable reads have state:"unknown" and reason timeout, read_error, or
invalid_response; never recovered/healthy playback. Disabled components are
not_configured. Complete reads can still contain failed or old playback samples:
their original timestamps and outcomes remain unchanged. playbackValidated:false
means this request ran no new playback test.

The three existing retained-state reads run concurrently, each with a 1000 ms
budget inside a 1500 ms overall deadline and a 256 KiB response limit. Timers,
HTTP transport and body readers are cancelled when complete/expired; late bodies
are discarded. These are event-loop deadlines, not CPU preemption, and aborting
a Durable Object request cannot guarantee cancellation of storage work already
executing there. No retries, provider calls, new jobs or waitUntil continuations.
Failure of one read preserves other valid results without refreshing timestamps.

Consumers checking only HTTP or ok measure reachability, not diagnostic
completeness. The shipped browser connection diagnostic propagates completeness
and its administrator UI warns about partial data. External consumers must apply
the same distinction; their behavior is not controlled by this endpoint.
