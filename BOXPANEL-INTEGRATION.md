# BoxPanel inside SNAP

The authenticated `admin.html` dashboard has an **Admin. BoxPanel** button.
The owner enables a workspace by selecting an existing reseller account ID,
sets its display name and can suspend its BoxPanel access independently.
The existing reseller portal links to `/boxpanel`. Each request revalidates
the existing HttpOnly reseller cookie with the configured portal gateway.
The server selects the workspace from the verified actor; a browser-supplied
account ID or role cannot grant access to another reseller or to the owner UI.

## Reseller web and access

The existing reseller host serves a complete public `/apps` landing page with
navigation, features, onboarding steps and interactive design previews.
Choosing a design opens `/boxpanel`. An expired or missing session redirects
to `/boxpanel/login`; that dedicated form reuses `/api/portal/login` and the
existing reseller account, gateway and HttpOnly cookie. No second credential
store or account provisioning service is introduced. The fixed Juanito realm
continues to use only a password; the unified realm uses username/password.

The login form never writes credentials or tokens to browser storage or URLs,
preserves leading zeros in passwords, clears passwords after failed attempts
and on navigation, and redirects only to a fixed same-origin BoxPanel path.
Private web navigation links directly to the app, DNS and images sections.
Logout clears the rendered profile immediately, calls the existing session
revocation route and checks success before navigating back to login. A failed
logout shows a retry message instead of claiming the session ended. Page-hide
cleanup and fresh checks after browser back/forward prevent stale private UI.
The existing reseller account-management portal remains available separately.

## Design catalog and app profile

`/apps` on the existing reseller portal is a public catalog of three original
BoxPanel design concepts: Classic, Cinema and Compact TV. Visitors can preview
home, login and player layouts. Choosing a design stores only its allowlisted
identifier in that browser tab, then opens the private BoxPanel web page. A new app
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
Approval also closes the reseller customization section and its private
navigation link. Only the authenticated owner can reopen it with **Habilitar
cambios al reseller**, or close it again. The server rejects reseller saves
and submissions while closed, including forged visibility fields. Returning
a pending proposal for changes reopens the editor; resuming a suspended app
does not. DNS and advertisement management remain available independently.
The visibility control persists in `bp_app_editors`; existing approved profiles
default to closed. All changes share the app's optimistic revision check.

Editing a reopened profile creates a draft while retaining the approved
snapshot. The owner can enable or disable each catalog design; disabled designs cannot be
selected for new proposals or approved. All profile and catalog writes remain
server-authorized, independent of hidden controls in the browser.

The Android base in `juancanta89-tech/SnapTvNow` implements these three layouts
and one stable package identity per app. Approval queues an immutable build;
`apkReady` remains false until the protected signing workflow publishes and
verifies its APK. The latest installed release stays available while another
proposal is edited or built. The download section remains outside the hidden
customization editor.

The build queue uses one row per workspace and one published release, reusing
the existing SQLite binding. The queue's public endpoint reveals only a boolean.
Claims and publication require GitHub-signed OIDC, exact repository/owner IDs,
main, the BoxPanel workflow, production environment, short expiry and audience.
The existing production signing approval is preserved. APKs use versioned
GitHub Releases; the Worker checks GitHub's asset digest/size and source SHA
before activating a matching leased build. Published certificate continuity,
package ID and increasing version checks prevent cross-app updates. Superseded,
expired, failed, suspended and wrong-run callbacks cannot publish. Failed or
expired work requires an owner retry, with no automatic build retry loop.

The fixed native client routes expose only that app's published branding, DNS,
image playlist and update metadata; no reseller actor IDs or credentials.
An official branded app cannot use SNAP fallback DNS. It checks its enablement
at launch and every five foreground minutes; a positive verification expires
after ten minutes without renewal. App/workspace suspension blocks config,
images and updates. Existing installed SNAP APKs are not modified by deploying
the web panel. Physical Fire TV/Android playback/update checks still require
connected devices; emulator and source checks do not replace them.

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
The same storage ceiling includes current logos, approved snapshots, queued
build snapshots and the published release configuration.

This change adds management to the web panels. It does not change Android/TV
clients or redirect their current provider connections. The existing SNAP
account backup/restore covers its original directory, not this separate
BoxPanel instance; BoxPanel rows persist in SQLite and are not erased by a
SNAP account restoration.

Keep the existing Quality and deployment guards for activation. Deploy the Worker and Pages from the same reviewed
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

Workers Builds installs dependencies from `cloudflare-worker/package-lock.json`
only. The BoxPanel regression therefore resolves esbuild and Miniflare from
`cloudflare-worker/package.json`, so the deployment verification does not rely
on an additional repository-root installation. Verify releases with that same
installation layout as well as the full GitHub Quality workflow.

The Worker sets `keep_names: false`: its browser scripts serialize self-contained
UI functions, and Wrangler's name-preservation helper would otherwise become an
unresolved browser dependency. Browser coverage serves HTML/JS/CSS from the
actual production Wrangler artifact at `.wrangler/quality-release`, while
authentication and writes use isolated fixtures. This checks the same packaging
used for release, including public catalog, login and private workspace scripts.


## Eight original layouts (catalog v2)
Stable IDs `classic`, `cinema`, `compact` now present Órbita TV, Prisma Cine,
Mosaico TV. New IDs: `aura`, `panorama`, `stadium`, `noir`, `horizon`. Existing
proposals, owner availability switches, and package identities remain valid.
All previews use original inline vector art and explicitly illustrative titles;
no third-party player code or media assets are copied. Each has home, access,
and player previews; native Android/Fire TV renders its corresponding layout
with artwork from the reseller's actual content source.

The new optional `style` contains validated `wallpaper` (aurora/midnight/sunset/ocean),
`density` (comfortable/compact), and `welcome` (up to 80 characters). It is stored
in `bp_app_styles` inside the existing SQLite transaction and participates in
storage accounting. It is copied into immutable approval/build/release snapshots.
An unpublished draft cannot change the installed app. Old proposals and builds
without `style` retain safe defaults. Personalization still closes on approval;
only the owner reopens it. Existing DNS/image quotas and tenant isolation apply.


## Image placement in approved designs
The reseller can assign saved workspace images to background, hero, login,
TV/movie/series portals and up to five brand cards, according to the selected
layout. Cover/contain and per-zone restoration are part of the app draft.
Advertising upload remains independent; placement changes require app approval.

`bp_app_artwork` stores validated workspace image snapshots. Assignments resolve
only the authenticated workspace's image ID/revision; forged image bytes are
ignored. All snapshot copies count toward the existing storage cap. Approval,
build and release keep immutable copies, so library edits/deletions cannot
change published artwork. Native config exposes only versioned app-scoped URLs;
`/api/boxpanel/client/{appId}/artwork/{slot}` serves published pixels and honors
suspension. No new storage service or public asset bucket is introduced.
