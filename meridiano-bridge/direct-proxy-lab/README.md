# Meridiano: private Surfshark bridge investigation

The owner requires zero additional paid resources and explicitly authorized the private account test after adding Venezuela/Caracas (UDP) in SNAPTVNOW Control. The isolated bridge and existing panel were reused. No subscription, VPS, billing setting, CPU limit, or shared DNS/catalog entry was added or changed.

## Verified result — November 16, 2026, UTC

| Check | Observed result |
| --- | --- |
| Caracas profile | Present, enabled, official `ve-car.prod.surfshark.com`; encrypted credentials read server-side |
| Private operation without owner authorization | HTTP 403; no vault access or outbound probe |
| Native TLS to Surfshark, authenticated CONNECT to Dailymotion | HTTP 200, accepted |
| HTTPS Cloudflare trace through that proxy | HTTP 200, `loc=CO` repeatedly; a Venezuelan exit was not verified |
| Dailymotion metadata through the proxy, with certificate verification | HTTP 200, JSON parsed, zero HLS qualities; `DM007` was not reported by that response |
| Current public live ID `x9sxu9y` | Public API: `live_status=offair`, geoblocking allows `ve` |
| Other public live IDs queried, `x9jav9q` and `x8irn8c` | Both `offair`; no active alternative found in those checks |
| Real media bytes, audio, uninterrupted playback | Not verified; no playable live source received |

A successful CONNECT or metadata response is not proof of a Venezuelan exit, regional availability during a live event, or usable video. `offair` describes the queried online live IDs, not the terrestrial broadcaster. Meridiano remains unpublished in the shared channel catalog. An APK/content update cannot supply an absent online emission.

## Morning follow-up: November 16, 2026 (America/Chicago)

The owner asked to establish whether the online signal is continuous or scheduled before drawing further conclusions. Official Meridiano announcements distinguish TV programming from web programming: the February 25 announcement gives Gaceta Hipica a streaming repeat at 11:00 Venezuela, versus its TV slot at 23:00. An April 29 announcement also promotes a specific streaming-only game. Neither establishes a current 24/7 service or a complete opening/closing timetable, and the February timetable's continued validity is unconfirmed.

Public API checks this morning still reported the original three live IDs off air. The alternate owner's public live listing supplied another ID, `x9jav8k`, also off air. `x9sxu9y` is reported as a published, public live video. No currently emitting alternative was found in those checks.

The authorized private probe now returns a sanitized response classification, public player error code and explicit live status when present. It does not infer an off-air state from missing HLS or regard any HTTP 200 JSON as successful player metadata. HLS candidates can be recognized by MIME type or a `.m3u8` URL path without returning the URL. Seven parser cases and the full local TLS fixture passed; nine panel authorization and output-sanitization cases passed.

Real proxy result: HTTP 200 with `metadataShape=player_error`, `playerErrorCode=DM003`, no HLS and no verified media. Dailymotion documents DM003 as a live event that has ended. The direct-network comparison reported DM007 (regional restriction). These are distinct responses; the current proxy response is not proof of live playback. Cloudflare trace still identified the selected proxy exit as CO, which does not prove that Dailymotion uses the same country classification.

Five finite, read-only public availability checks were scheduled: November 16 at 12:00, 16:00 and 20:00 Chicago, then November 17 at 09:00 and 12:00. They compare current live status and verified publisher IDs; they do not reactivate private credentials or publish channels. The final check must report its findings even if every sample remains off air. Such samples can establish observed availability windows, not an unpublished broadcaster schedule.

The private trial was then closed: the original isolated Worker was restored with authorization disabled, and the temporary Sites settings were removed and environment revision 6 deployed. The improved panel diagnostics remain dormant without a new temporary owner secret. Caracas and the encrypted vault remain intact; no shared DNS/catalog entry or billing setting was changed. Actual app playback remains unverified.

Additional primary references: [official TV/web timetable](https://meridiano.net/virales/estos-programas-de-meridiano-television-tendran-nuevo-horario-enterate-cuales-y-a-partir-de-cuando-202622515560), [official streaming-only event](https://meridiano.net/beisbol/beisbol-venezolano/proximo-juego-de-venezuela-en-el-mundial-de-softbol-sub-23-2026-en-vivo-y-gratis-202642911220/amp), [Dailymotion player error definitions](https://developers.dailymotion.com/reference/api-errors).

## Protected private trial

The existing panel is public. Its audience was preserved; the test did not rely on public Site access or the Sites service-access token for owner authorization. A temporary cryptographically random owner bearer key was stored as a native Sites secret. The Worker stored only its SHA-256 fingerprint and a deadline capped at one hour. No fixed access key was embedded in source.

The private operation used existing POST `/api/vpn-connect` and POST `/health`; no new public diagnostic URL was created. Normal subscriber-line authentication was preserved. After owner authorization and fixed Caracas profile checks, the panel decrypted its existing vault server-side and sent credentials ephemerally over HTTPS to the fixed isolated bridge. The Worker accepted only the fixed profile, Surfshark hostname and public probe destinations. It never returned credentials, profile contents, raw traces, exit IP addresses, signed media URLs or raw error messages. Proxy-library authentication errors can name an account, so they are converted to fixed classifications.

The first Site-to-bridge trial failed before sending a request because Workers does not support Fetch's `redirect: "error"`. This was corrected to `manual`, rejecting every redirect. Native workerd verified that `manual` is accepted and `error` throws `TypeError`.

## Transport and checks

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
node build-private-pilot.mjs /absolute/private-pilot.mjs --verified
```

Fixtures generate temporary certificates, use loopback sockets and delete generated keys/bundles. Checks cover nested TLS, authentication, signed-query/Range preservation, credential isolation, rejected hostnames/issuers, owner authorization and expiry, fixed destinations, country/metadata parsing and closure of stalled sockets on deadline. Panel tests cover authorization before vault access, profile matching, redirect rejection, native-fetch invocation and output sanitization.

The initial experiment uses `workers-fetch-proxy` 1.1.0 and `subtls` 0.5.0. It completed Cloudflare HTTPS trace requests but rejected Dailymotion's certificate chain, including after adding the checked-in public Mozilla roots. Validation was not disabled. `subtls` explicitly says it is not intended for production.

The second private transport uses pinned `tunnelfetch` 1.13.1, normal bundled CCADB trust, HTTPS-only proxy and destinations, manual redirects, 128 KiB response limits, deadlines and explicit socket cleanup. It passed positive/negative local certificate and authentication checks and reached Dailymotion metadata on the real edge. Its author describes it as a new implementation without an external security audit. These experiments do not establish production suitability or playback capacity.

## Cleanup and retained state

Temporary Sites owner settings were removed and environment revision 4 was deployed. The retained private operation fails closed without them. The isolated Worker was restored to `meridiano-bridge/worker.mjs`, CPU 10 ms and logs disabled. Its former owner fingerprint was overwritten with `disabled` and its deadline with `0`; the connector preserves bindings when given an empty replacement list and does not accept binding-only settings patches. Caracas and the existing encrypted Surfshark vault were preserved. The main DNS Worker and channel catalog were not modified.

Source remains on the draft integration branch for review. Actual live media, authenticated shared-DNS playback, sustained playback and resource usage still need to pass before publication. Do not reactivate a former fixed-key diagnostic or turn this into an arbitrary-destination proxy.

Primary references: [Workers Request behavior](https://developers.cloudflare.com/workers/runtime-apis/request/), [proxy implementation](https://github.com/Timo972/workers-fetch-proxy), [initial TLS dependency](https://github.com/jawj/subtls), [second transport](https://github.com/latentharbor/tunnelfetch), [official live page](https://meridiano.net/meridianotv), [current public live status](https://api.dailymotion.com/video/x9sxu9y?fields=geoblocking,live_status,title).
