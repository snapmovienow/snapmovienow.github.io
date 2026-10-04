# SNAPMOVIENOW account panel

Panel: https://snapmovienow.github.io/admin.html

## First activation

1. In Cloudflare, open `snapmovienow-edge` → Settings → Variables and Secrets.
2. Add an encrypted secret named `ADMIN_SETUP_SECRET`, using a unique random value of at least 32 characters. Keep this secret private; do not commit it.
3. Redeploy the Worker if Cloudflare requests it.
4. Open the panel, enter that activation secret, and choose the administrator username and password (minimum 12 characters).
5. Sign in and connect the authorized CCF service account in the panel. The Worker validates the account and stores its credentials as AES-GCM ciphertext using the existing `TICKET_SECRET`.
6. Create customers. They use the ordinary SNAPMOVIENOW login even though their accounts do not exist in CCF.
7. After setup, remove `ADMIN_SETUP_SECRET` and redeploy. Setup is also permanently closed by the stored administrator record.

Existing CCF customer logins continue working. A username registered in the panel uses panel authentication exclusively, including when suspended; it cannot fall back to CCF authentication.

## Account management and playback

- Create, edit, suspend, reactivate, delete and set an expiration date.
- Passwords are stored as salted PBKDF2-SHA256 hashes with 100,000 iterations. No password/hash is returned in the user list.
- Administrator sessions last at most 2 hours, customer sessions at most 12 hours or their account expiration date.
- Editing accounts increments their version, revoking previous sessions and media tickets. Deletion and expiration also deny future requests. A deleted/recreated username gets a different account ID.
- Active playback checks account access every 25 seconds. Media already buffered may remain playable until that check; this does not remotely erase downloaded bytes.
- The configured service account permits at most 3 managed CCF playback leases, shared across all panel customers. Heartbeats renew leases for 90 seconds; closing/ending/logging out releases them. Abandoned clients expire automatically.
- This cap does not create additional upstream capacity. Other apps using the same CCF account also consume its provider limit. CCF remains responsible for enforcing actual upstream connections.
- The panel currently connects one service account to the existing CCF origin. It does not borrow credentials from customer sessions.
- Gnula playback remains protected by the same independent customer session and account checks.
- The admin token lives only in sessionStorage. Customer persistence stores a bearer token, not the customer's password.

Account records and lease allocation use the existing SQLite-backed `PlaybackSession` namespace, in a separate private singleton object. The existing Wrangler binding/migration is unchanged. Internal account routes are not exposed by the public Worker router.

## Verification

Run `node cloudflare-worker/tests/accounts.test.mjs` from the repository root. The test uses isolated in-memory Durable Object storage and a mock CCF service. It verifies administrator protection, customer authentication, provider credential isolation, movie/series catalogs, three-slot concurrent allocation, revocation on suspension/password change/deletion/expiration, and logout. No production credentials are present in the test.

Production activation and a real panel-created customer's video/audio test require the private administrator setup and service-account connection. Local tests do not constitute a real browser playback or load test.
