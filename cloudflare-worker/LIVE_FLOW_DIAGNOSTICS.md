# Temporary live TS flow diagnostics

This is passive server instrumentation. It does not open a channel, reconnect a
viewer, change a format, retry an authorization decision, or change media bytes.
No client update is required for the server observations.

Configure these **private production variables**, outside the repository:

- `LIVE_FLOW_DIAGNOSTIC_USERNAME`: exact authenticated, lowercase subscriber name.
- `LIVE_FLOW_DIAGNOSTIC_CASE`: a new random UUID for this investigation.
- `LIVE_FLOW_DIAGNOSTIC_FROM` and `LIVE_FLOW_DIAGNOSTIC_UNTIL`: Unix milliseconds.
  The interval must be positive and no longer than 24 hours.

The selector accepts only that authenticated subscriber's live `GET` requests
with TS output. It adds bounded case metadata to an encrypted internal ticket.
The media Durable Object validates that metadata against its current case and
window. Request headers and query parameters cannot enable observations. Other
subscribers, movies, series, HLS and HEAD requests remain unobserved.

Search Workers Observability for the literal case UUID. Events are
`live_flow_start`, `live_flow_progress` and `live_flow_end`. Each startup attempt
has a separate `flow_id` and an `attempt` number. Progress uses the existing
authorization interval, at most once per minute and 60 times per flow. There is
one terminal event per monitor. Expiring the diagnostic window stops observation
and does not stop the viewer's video. Existing invocations on old versions are
not retroactively instrumented; do not close client sessions to force a sample.

## Interpretation

- `origin_bytes` counts HTTP body bytes observed in the existing TCP pump, without
  HTTP headers or chunk framing. `origin_observed: false` explicitly means this
  origin was not measured (for example a hostname fetch), rather than zero bytes
  proven. Only 2xx bodies are counted.
- `origin_read_wait_ms` and its maximum describe blocked origin reads;
  `origin_write_wait_ms` describes writes into the native relay. These totals
  include ordinary waiting and are not a packet-loss measurement.
- `relay_bytes` and `relay_chunks` count bytes enqueued by the existing stream
  guard. `relay_read_wait_ms` measures its source reads. `consumer_pause_ms`
  measures pauses between guard demand. These are **not** acknowledgement of
  receipt or decoding by a Firestick. A paused decoder and a congested connection
  can both stop downstream demand.
- A terminal `reason` describes the relay's observed end. `origin_reason` retains
  its separate first origin termination: EOF, finite body complete, silence,
  truncation, or an allowlisted generic origin error. Client cancel/abort is not
  reclassified as an origin failure.
- Session denial, lease denial, superseded/expired playback, and exceptions in
  our authorization checks are distinct diagnostic outcomes. Permission checks
  keep their existing behavior.
- A process killed by the runtime can lack an end record. Correlate its case,
  flow, invocation metadata and deployed version with Workers exceptions,
  including the literal `Durable Object exceeded`. A missing terminal event
  alone is not proof of CPU exhaustion, a device failure or ISP responsibility.

Records contain UUIDs, public channel ID, bounded numeric aggregates, status and
allowlisted reasons. They do not contain subscriber names, IPs, user agents,
credentials, signed URLs, arbitrary error messages or video payloads. The log
scope is explicitly `server_relay_not_client`.

Keep existing Worker bindings, CPU limits and logging settings when deploying.
Use successful Quality checks for the actual merged main commit, and verify
the active deployment and temporary variables afterward. No additional resource
or logging-sampling expansion is needed.
