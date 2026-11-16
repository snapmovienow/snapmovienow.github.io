# Private server diagnostic report

The production Worker collects a private diagnostic report on the existing
five-minute server Cron (`*/5 * * * *`). Collection does not depend on an open
browser or an administrator login. It is enabled only when `ENVIRONMENT` is
`production` and `PRIVATE_DIAGNOSTIC_REPORTS_ENABLED` is exactly `true`.

The collector runs in the dedicated `__smn_private_diagnostic_v1` Durable Object.
An atomic claim prevents duplicate runs within each UTC five-minute window,
without skipping the next window when Cron delivery has slight jitter. Collection runs
through `waitUntil`, separately from customer playback. Existing tasks on the
same Cron, including inventory refresh and playback canaries, remain separate
features; their provider requests are not requests made by this collector.

## Private access and retention

A successful collection emits the Workers log event
`private_diagnostic_report_v1` with the final sanitized report. Authorized
infrastructure operators can inspect that event through Cloudflare
observability. The existing application administrator can also read the latest
report with `POST /admin`, action `private-diagnostic-report`, using the normal
active administrator session. The action returns `Cache-Control: no-store`.
Customer, reseller, absent and expired sessions cannot read it. The feature
does not issue sessions, replace MFA or publish a public report endpoint.

The dedicated object retains only the latest allowlisted report and bounded
collection-control metadata. It does not retain raw snapshots, provider
credentials or a growing report history. Workers logs have their own platform
retention. Final report JSON is capped at **12,000 UTF-8 bytes**. Lists are
bounded and may be omitted to meet the cap; `truncated`, `omitted` and
`complete` disclose this. A truncated report cannot claim completeness.

Status includes the last attempted collection and marks a missing report, or a
report older than fifteen minutes, stale. A failed collection does not turn the
previous report into fresh evidence. `private_diagnostic_report_failed` records
only a fixed failure reason, never an exception message or a response body.

## Evidence collected

The collector reads existing private projections with bounded deadlines and
response sizes. Component reads default to two seconds, with a five-second
overall collection deadline. No component makes a direct provider or media
request.

The account snapshot aggregates saved source-inventory freshness, physical
accounts, capacity, reported upstream use, active provider reservations,
circuits and completed rotation statistics. It does not enumerate customers or
durable assignment profiles. The snapshot route runs before lease-store
initialization and uses read-only storage operations. It does not create SQL
tables, migrate or prune leases, refresh inventory, change assignments or
alter business data. SQL availability is checked before reservation counts
are read; missing SQL, a missing table, a failed read or more than 1,000 grouped
provider rows yields unknown counts rather than invented zeroes.

Startup timing aggregates cover the existing nominal fifteen-minute window by
content type and player class. They include measured request totals, classified
outcomes, error codes and stage timing histograms. These totals are requests,
not distinct viewers or complaints. Saved canary results are read without
starting another canary. Their age, configuration and missing evidence remain
visible.

At most ten exact mapping references are selected from already observed media
failures. The Xtream registry is a separate object from the account directory;
checks must read its existing forward and reverse keys. The report keeps
bounded query indices, allowed content kinds and numeric public/upstream
content IDs needed to identify a broken reference. It does not scan or rewrite
the registry. A missing registration does not prove a broken map, an outdated
catalog or a missing provider entitlement.

The final privacy projection allowlists fields before persistence and logging.
It excludes credentials, tickets, customer identities, account identifiers,
media titles, URLs, IP addresses, raw storage records and exception text.
Source labels are pseudonyms scoped to one report; they are not stable panel
identifiers for comparisons between reports.

## Controlled byte self-check

Each run also exercises three existing media helpers with **44 synthetic
payload bytes**: sixteen bytes through initial-payload handling, sixteen
through a truncated range and its controlled continuation, and twelve through
the Xtream stream guard and release callback. Range and authorization callbacks
are local stubs. The check uses no network, provider account, customer or real
lease and has a bounded 100 ms control budget.

The check can establish that these particular code paths handle the controlled
bytes correctly. It cannot establish public DNS availability, upstream media
health, full-program continuity, audio/video decoding or playback on a customer
device. The report preserves `playbackValidated: false`; a passing control does
not turn missing live evidence into success.

## Reading classifications

Classification describes the evidence available, rather than assigning blame
from an HTTP status alone.

| Classification | Required evidence and meaning |
| --- | --- |
| `local_fault` | A fresh, specific controlled helper failure, or a validated forward/reverse registry inconsistency with an identifying sample. This identifies a demonstrated local defect within the tested scope. |
| `local_policy` | Existing classified admission outcomes: access/content rejection, superseded or expired playback, or the customer's connection limit. These expected outcomes are separate from playback failures. |
| `upstream_response` | Fresh stored media evidence explicitly records an upstream HTTP 504 response with the matching server-generated origin/code pair. It establishes where a response was observed, not which company or gateway caused it. |
| `unknown` | The cause is not established, evidence is mixed, reads are incomplete, or there is no affirmative fault evidence. This is also the normal classification when no finding supports a stronger conclusion. |

An ordinary 404, a generic 502/`upstream_unavailable`, a circuit opening or a
failed canary does not establish CCF responsibility. `live_startup_timeout`
establishes that our local startup deadline expired while waiting; it does not
establish the underlying cause. A local-fault finding takes priority in the
report summary. Other mixed findings retain an `unknown` summary and their
individual evidence. `complete` means required report inputs passed validation,
not that all content or customer devices were verified.

## Capacity and freshness caveats

Successful source snapshots remain usable for up to twelve hours under the
existing inventory policy. A later failed refresh can retain an earlier
snapshot. The report distinguishes successful timestamps, later attempts,
retained observations, missing sources and stale sources. A recently attempted
refresh does not renew successful-read freshness. Saved inventory is not a new
verification of the provider's current state.

Capacity follows the allocator's conservative arithmetic: upstream reported
use plus local reservations. The upstream number may already include our
connections, so these figures can double-count physical use and understate
available capacity. Duplicate physical credentials count once. Reservations
are not unique viewers, and unmatched saved reservations are advisory evidence,
not proof of a routing defect. Unknown reservation counts keep availability
unknown. Completed rotation counts do not assert that every eligible customer
rotated or that a pending offer committed.

Telemetry is bounded and non-exhaustive. No error rate should be inferred from
raw event counts without the matching request denominator and window.

## Disabling and validation

Set `PRIVATE_DIAGNOSTIC_REPORTS_ENABLED=false` in production and deploy through
the normal Quality gate to disable future runs and report reads. This does not
change DNS, revoke playback, rotate accounts, disable the existing provider
refresh/canary tasks or delete historical Workers logs. Staging does not run
the collector.

Focused tests cover real SQLite read-only aggregation and unknown states,
bounded mapping evidence, privacy projection, report-size limits, classifier
evidence, scheduled deduplication, deadlines, private administrator access and
controlled byte handling. These checks complement live observability; they do
not guarantee that every external media item will remain available.
