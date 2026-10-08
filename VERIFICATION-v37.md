# Provider accounts and customer assignments — v37

Published implementation: `8caf413a983e1541fe68c425b5962a045f199349`.

The administrator panel now uses a desktop table and mobile account cards, backed by an authenticated, read-only projection of configured provider inventories and current customer reservations. The view includes inactive subscriptions, search by provider account/customer/source, status and source filters, 25-account pagination, aggregate capacity and customer-to-provider-account assignments. Opening the view revalidates saved sources; visible panels refresh the view every 30 seconds. Failures retain the previous view with an explicit stale-data warning.

Capacity is labelled **assignable**, using the allocator's existing conservative calculation: limit minus provider-reported use minus SNAP reservations, clamped to zero. Provider reports can include SNAP streams; the dashboard deliberately does not describe these two counters as separate physical connections or promise an exact external-use count.

Passwords, encrypted credentials, customer session identifiers and playback request identifiers are excluded from the response. Customer tokens and unauthenticated requests cannot access the view. Rendering uses text nodes for provider-controlled names. Read-only inventory requests do not allocate or release playback reservations. Stored sources retain their credentials and configuration.

## Validation on 2026-10-08

- All **16** Worker/frontend test files passed on the final source.
- Additional DOM integration passed using jsdom 30.1.2: full administrator page, desktop/mobile content agreement, pagination, case-insensitive search for nito, inactive and empty-result filters, unsafe-name escaping, transient failure retention, concurrent refresh coalescing and a pending-response/logout race.
- Provider tests passed: complete inventory including suspended/expired accounts, active-only capacity, duplicate sources counted once, customer-to-account mapping, release/expiry/revocation cleanup, retained inventory warnings, and no credential disclosure.
- Wrangler 4.149.0 production dry run succeeded: 128.22 KiB, gzip 30.90 KiB, existing PlaybackSession binding.
- GitHub build/deploy/report-build-status and **Workers Builds: snapmovienow-edge** all completed successfully.
- Public `admin.html`, `admin-provider-view.js` and `admin-provider-view.css` returned HTTP 200 and matched local SHA-256 hashes.
- The production administrator sign-in page and provider section/styles were inspected through the browser. Desktop styles use the table and hide the card presentation.

## Verification limits

No administrator session was available in the verification browser, so the real provider inventory and a live customer assignment were not inspected inside the published administrator dashboard. Assignment and cleanup tests used isolated users/provider fixtures. Direct Worker requests from this execution environment returned HTTP 403 with `error code: 1010`; browser navigation to its health endpoint returned `net::ERR_BLOCKED_BY_CLIENT`. Those observations do not establish how the user's own browser is handled. No security checks were disabled or bypassed. The authenticated live inventory remains to be checked in the owner's administrator session.

This release does not change provider stream quality, upstream availability, the existing conservative account allocator or playback retry policy.
