# Willax TV alternative in Peru

Owner request: add a tested Willax feed after the existing three Willax entries
in Peru, and expose the same saved channel in the own-content usage panel.

The saved identity is `public-willax-peru`, Xtream upstream identity `2000023`,
display name **Willax TV · señal alternativa**. Its saved HTTPS address is a
station identity anchor, not a claim that the alternative relay is Willax's CDN.
No expiring media URL or subscriber credential is saved in this definition.

The reviewed public relay is `http://190.93.224.42/WILLAX/index.m3u8`, listed in
the public `iptv-org/iptv` Peru playlist. On 16 November 2026 at 19:02–19:05 Lima
(18:02–18:05 Chicago), downloaded TS samples decoded as H.264 1440×1080 and
AAC stereo. Frames showed Noticias Central with the clock advancing through
the matching published Willax schedule. Several samples succeeded; the initial
acquisition was slow and one older segment was unavailable. This is evidence
for those samples, not complete-day schedule or uninterrupted playback.

The official page's Dailymotion player and its API disagreed about on-air
status during the same investigation. The YouTube listing was live but media
was not verified. Neither unverified source is a playback fallback.

## Scope and transport

The app receives HTTPS URLs under its existing DNS. The one upstream relay
uses HTTP; its HTTPS certificate is invalid for the IP, and TLS validation is
never disabled. A pure channel policy accepts only the reviewed IP, implicit
port 80, master, variant and dated TS paths. Credentials, query strings,
fragments, escaped or dot paths, other channels, hosts and ports are denied.

The existing HTTP parser is shared by a separate Willax entry point. CCF's
approved destinations and provenance rules are unchanged. Redirects and HLS
references are validated before every next connection. The general catalog,
poster and exclusive-media URL policy continues to reject HTTP and IP URLs.
The media-only exception requires the signed Willax channel context.

Existing TV permissions, session checks, playback revisions, connection limits,
leases, encrypted resource tickets and usage observations remain in force.

## Publication and placement

The existing private maintenance Cron runs one finite import, at most three
attempts, only in production with catalog maintenance enabled. A live manifest
and media bytes must be available from Cloudflare before adding the row. A
saved or hidden row is preserved. No new public write endpoint, schedule,
service, DNS record or paid account is introduced.

The Peru folder merges with the provider's existing Peru category by its normal
aliases. The new row is inserted immediately after the last Willax in that
category, without changing existing stream identities or relative order. A
foreign-category Willax does not affect placement. The app consumes array
order; a third-party client that sorts provider ordinals may order differently.

`usageKind: channel` exposes the saved channel in the existing own-content
panel and its channel-usage view, including its initial zero-use state. Real
sessions and duration are recorded through the normal authorized playback
flow; test fixtures must not be represented as customer usage.

## Validation and device check

Focused tests cover publication, source scoping, transport cancellation,
catalog/poster isolation, signed HTTPS HLS, resource delivery, redirect denial,
session revocation, hidden rows, TV permissions, Peru placement and monitoring.
The production import status records whether Cloudflare reached real upstream
media. This does not itself verify decoding on a customer's Fire TV or Android.

In the installed app, refresh content, open Peru and select the new alternative
after the existing Willax entries. Check picture, sound, the program against
Willax's schedule and continued playback. The owner can then see the session
in the existing own-content channel-usage panel.
