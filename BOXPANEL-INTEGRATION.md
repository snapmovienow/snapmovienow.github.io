# BoxPanel inside SNAP

The authenticated `admin.html` dashboard has an **Admin. BoxPanel** button.
The owner enables a workspace by selecting an existing reseller account ID,
sets its display name and can suspend its BoxPanel access independently.
The existing reseller portal links to `/boxpanel`. Each request revalidates
the existing HttpOnly reseller cookie with the configured portal gateway.
The server selects the workspace from the verified actor; a browser-supplied
account ID or role cannot grant access to another reseller or to the owner UI.

Each workspace supports three DNS URLs and eight advertisement images, with
editable titles and a display duration of 3–120 seconds. JPG/PNG/WebP files up
to 5 MiB are optimized in the browser to at most 256 KiB. Server validation,
transactional quotas and revision checks apply to direct API requests too.
Images are private and fetched on demand; there is no polling for BoxPanel.
Returning or cancelling discards the current form without writing it.

State uses the dedicated `__smn_boxpanel_v1` instance of the existing
`PLAYBACK_SESSIONS` SQLite Durable Object binding. No new binding, migration,
domain, D1 database, bucket, Access application or subscription is required.
Images have a fixed global encoded storage ceiling of 16 MiB. The current four
trusted reseller IDs also bound the number of workspaces. Production and
staging use separate instances as configured by their existing bindings.

This change adds management to the web panels. It does not change Android/TV
clients or redirect their current provider connections. The existing SNAP
account backup/restore covers its original directory, not this separate
BoxPanel instance; BoxPanel rows persist in SQLite and are not erased by a
SNAP account restoration.

This is prepared code, not a production activation. Keep the existing Quality
and deployment guards. Deploy the Worker and Pages from the same reviewed
commit through the existing release process. The current Workers Paid account
can bill for additional usage under its existing terms; reusing infrastructure
does not guarantee a zero-dollar incremental bill.

Validation: `npm test` includes actual workerd/SQLite tenant, auth, quota,
restart and staging checks in `tests/boxpanel.test.mjs`. The Quality workflow
also runs `tests/admin-boxpanel-runtime.mjs` in Chromium at mobile and desktop
sizes and saves UI screenshots in its `quality-evidence` artifact.
