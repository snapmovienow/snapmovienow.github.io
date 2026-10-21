# BoxPanel inside SNAP

The authenticated `admin.html` dashboard has an **Admin. BoxPanel** button.
The owner enables a workspace by selecting an existing reseller account ID,
sets its display name and can suspend its BoxPanel access independently.
The existing reseller portal links to `/boxpanel`. Each request revalidates
the existing HttpOnly reseller cookie with the configured portal gateway.
The server selects the workspace from the verified actor; a browser-supplied
account ID or role cannot grant access to another reseller or to the owner UI.

## Design catalog and app profile

`/apps` on the existing reseller portal is a public catalog of three original
BoxPanel design concepts: Classic, Cinema and Compact TV. Visitors can preview
home, login and player layouts. Choosing a design stores only its allowlisted
identifier in that browser tab, then opens the existing panel login. A new app
profile prefills that choice if the owner still enables it. Existing profiles
keep their saved design. `/api/boxpanel/catalog` is GET-only and returns only
enabled template metadata, with no reseller IDs, revisions, logos or profiles.

Inside the authenticated panel each reseller has one app profile with a
server-generated immutable ID, app name, design, two colors and an optional
uploaded logo. PNG/WebP logos preserve transparency during optimization.
Previews update locally; returning discards unsaved changes. Saving produces a
draft. Submitting moves the exact saved revision to pending review. Only the
owner can approve, return with a reason, suspend or resume a profile. Each
transition checks its revision in the same SQLite transaction.

Approval stores an immutable snapshot separately from the editable proposal.
Editing after approval creates a draft while retaining that snapshot. The
owner can enable or disable each catalog design; disabled designs cannot be
selected for new proposals or approved. All profile and catalog writes remain
server-authorized, independent of hidden controls in the browser.

These are web previews and app-profile approvals, not native Android themes
already implemented in APKs. There is no automatic compilation, signing,
download or app-config delivery endpoint in this change. `apkReady` remains
false and the UI explicitly reports APK generation as pending. Profile
suspension is stored for the future delivery flow; it does not revoke an APK
already installed. No current Android/TV client is changed here.

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
The same storage ceiling includes current logos and approved app snapshots.

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
This includes public selection before login, all three conceptual designs,
live branding under the real reseller CSP, transparent logo optimization,
draft/cancel/review controls, catalog visibility and logout cleanup.
