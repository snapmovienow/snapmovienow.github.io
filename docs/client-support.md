# Owner client support

In **Panel admin reseller**, open **Líneas** and select **Soporte** below
**Editar cliente** in the first column. **Consultar soporte** is also in the
line's actions menu and detail view. These entries appear only for the owner
using the protected `/owner-panel/` session, including when managing a reseller.
The main application administrator also retains **Usuarios → Soporte**.
The private dialog loads only after selection. Its three sections are saved
catalogue requests, an account check, and a thirty-day incident history. The
controls also work on a phone.

The owner portal revalidates its existing HttpOnly session for every support
request. A dedicated authorization call reads only the current Site line ID,
account ID and username, without snapshot enrichment, queue synchronization,
credential decryption or provider checks. The Worker then resolves the exact
account/line pair through its bridge registry inside the support transaction,
and requires the current customer's bridge ownership and username to match.
The browser cannot select an arbitrary username or supply an actor. Both entry
points use the same UUID-scoped history; no records are copied between panels.

## Evidence and scope

This feature observes authenticated managed customers using our server, through
Xtream or the native/web API. It records requests for TV, film and series title
lists, not category-list lookups or HEAD requests. A category/source selection
is identified as a subset. A successful response means the server generated
the returned list; it does not prove that the player downloaded and imported it.
Empty responses, access restrictions and failures remain distinct.

Recording starts with this feature. Earlier request history is not invented or
backfilled. An unobserved section says **Sin registro**. The customer account is
the scope: multiple devices can contribute, and this feature does not claim to
identify a particular TV. Service verification and canary requests are excluded.

**Comprobar ahora** reads the current account's status, expiry and permissions,
plus indexed active reservations if their schema is available. It also displays
the age of the saved general source inventory. Missing observations are
**Sin comprobar**; inventory older than five minutes is explicitly old. Reading
this view does not authenticate against the provider, play media, reserve a
slot, initialize/migrate business leases, alter the account, or force a player
to refresh. Reservation counts are activity records, not a verified device count.
`playbackValidated` stays false.

## Incident history

Observed catalogue and playback-startup error responses can create cases with
allowlisted HTTP/error metadata and a numeric public content reference when one
is known. Expected cancellations, access/permission outcomes, connection limits,
capacity outcomes and range boundaries are not automatically treated as faults.
The observation is not a claim about which company caused a failure. Midstream
device errors and events outside these monitored routes are not exhaustive.

The owner may register a manual case, change its status and save an optional
note. Allowed states are **En revisión**, **Investigando**, **Corregido · pendiente
de validar**, and **Resuelto**. A successful request does not automatically close
an earlier incident. Notes can stay blank. Follow-up edits use an expected
revision so another session's change cannot be silently overwritten. A separate
safe audit entry records an owner follow-up without copying the note or title.

## Isolation, storage and performance

Owner read/check/save actions use the existing active administrator session,
origin protections and `Cache-Control: no-store`. Customer/reseller tokens cannot
read another account's support data. Internal observations validate the current
account UUID and version; deleting and recreating a username starts a distinct
history. Final projections omit passwords, tickets, media URLs, headers, IP
addresses and raw provider identities. User-entered text is displayed as text.

The account object keeps three latest list records and at most one hundred
incidents per account for thirty days, with bounded recent request receipts.
Own indexed SQLite tables are used when available; the bounded KV adapter is
for compatible stores. No customer account, source assignment or lease is
modified by a support check. The UI clears private fields on close/logout and
rejects late replies from an earlier account selection.

Observation writes run after response preparation through `waitUntil`. They
retain only bounded metadata and never copy, clone or read a media body. A
recording failure cannot replace or delay a customer's response. The support
dialog has no automatic per-customer polling or background playback probes.

## Verification

Focused tests cover real SQLite/KV scope, current identities, unknown data,
observation deduplication, optimistic edits, bounded retention and unchanged
business records. Full workerd tests cover authenticated routes and actual
GET/POST catalogue paths using synthetic upstreams. Browser tests cover mobile
and desktop rendering, optional empty notes, text safety, conflicts and late
responses after switching account or logging out. Quality and the normal
deployment guard remain required before production publication.
