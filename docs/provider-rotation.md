# Daily provider assignment rotation

The production Worker enables `PROVIDER_ROTATION_ENABLED=true`. Only the
infrastructure operator can change this setting; no reseller/customer API
accepts rotation rules. The DNS names, customer passwords, subscription dates,
catalog identifiers and existing media tickets are unchanged.

## Schedule and continuity

Each customer and compatible catalog server group has one durable preferred
provider. It becomes eligible for rotation after 24 elapsed hours. The preferred
local midnight is computed using the customer's trusted Cloudflare IANA zone,
frozen for that assignment; a newly observed zone can start the next cycle.
Unknown zones use UTC. During an already active session, channel/title changes
wait for an eligible midnight within the target window. A real idle/restart
opportunity after 24 hours may rotate earlier than that midnight.
The target is 24–36 hours; 48 hours marks an overdue assignment, not a forced
disconnect. DST does not shorten the 24-hour minimum.

Allocation changes only when a customer begins a new playback request. An
existing device's channel change may replace its old lease in the usual way;
another active device, an in-flight request and the same logical movie/episode
prevent scheduled rotation. Movie/episode continuation ignores container format
and remains pinned across buffered/paused gaps. A new title or an explicitly
closed session provides a later opportunity. There is no midnight logout,
heartbeat revocation, forced stream cancellation or extra upstream connection
to prewarm an idle customer.

A customer watching continuously can remain on an old account beyond 48 hours.
An absolute cutoff would contradict uninterrupted playback. Existing session
lifetimes and upstream outages remain separate constraints; this feature cannot
guarantee uninterrupted playback or eliminate all channel-start latency.

## Capacity and selection

Selection, pending offers and commit comparisons run inside the existing
serialized directory transaction. Local leases, upstream reported usage,
circuits, account validity and fresh inventory are rechecked. The conservative
capacity calculation stays `external + local leases`; the provider must also
enforce its own limit against clients outside SNAPTVNOW.

Only candidates in the same catalog server group are interchangeable. Source
panel membership comes from successful source inventories, never a guessed
panel name. Duplicate physical credentials count once, with conservative
capacity and the union of source memberships.

For a new home or due rotation, accounts with at least two calendar months of
remaining service form the normal tier. Shorter or unknown expiry is an
emergency tier used when no normal available account exists. A healthy normal
home is retained if it is the only normal candidate. A different physical
account and a different known source panel are preferred where possible. Health
bands favor proven accounts and avoid recent failures before balancing
source utilization. Capacity and later expiry (including three months when
other conditions are equal) then break ties. Unknown source membership gains
no artificial empty-panel advantage. A healthy shorter-lived account can serve
as emergency fallback when the longer-lived alternatives recently failed.

Existing active assignments are not evicted merely for having fewer than two
months left. Background canaries keep their separate preferences and cannot
rotate customer homes.

## Validation and visibility

A selected replacement is a pending offer on its lease. Other devices can use
that pending target subject to capacity. Commit requires both positive account
validation (or an already fresh credential-bound proof) and the existing
positive media report for that requested content. Either report may arrive
first. A compare-and-swap against the old provider, key and selection timestamp
prevents late callbacks from undoing a newer home. Failed or busy validation,
or a failed media response, leaves the old home and its rotation age intact.
A scheduled move gets only the first offer of a playback request; after a
failed offer the remaining startup retries prefer the healthy old home and
normal failover. No new inventory/network request is added to the playback
allocation path.

The administrator's provider dashboard exposes the global policy, each active
customer's scheduling dates and overdue state, and a cumulative successful
rotation counter. Public health exposes policy activation and the capability
`safe-daily-provider-rotation-v1`, without customer or provider credentials.
These are configuration/assignment observations, not proof that every media
item plays successfully.

## Rollback and validation

Set `PROVIDER_ROTATION_ENABLED=false` in the production configuration and deploy
through the normal exact-commit Quality gate. This stops future scheduled
rotations without releasing playback leases. The most recently committed
healthy home remains a preference. Source memberships and existing homes need
no data migration or destructive rollback.

Focused tests cover schedule/DST, two-calendar-month thresholds, source
deduplication, load ranking, active devices, paused movies, pending offers,
validation failure, commit races, stale hints and capacity. The existing
playback performance, real SQLite and browser Quality gates remain required.
Production source names, counts, subscription eligibility and actual completed
rotations must be read from the authenticated administrator dashboard; a public
health response alone does not establish them.
