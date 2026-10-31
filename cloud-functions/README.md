# Shared community accounts

Web and Android use the same `/api/platform` identity endpoints and errors:

- `POST /auth/register`: `studentId`, `realName`, `nickname`, `qq`, `password`.
  Registration is open to every student as `user`. No invitation or email
  verification. Student IDs normalize NFKC and case, and have one atomic claim.
  Pre-recorded staff accounts require administrator activation; public
  registration cannot claim administrator privileges by knowing a student ID.
- `POST /auth/login`: `studentId`, `password`, optional `totp` (TOTP or recovery
  code), `deviceId` (16–128 URL-safe characters), `deviceName` (1–80 characters).
  Missing/invalid factors return `MFA_REQUIRED`/`MFA_INVALID`; used factors return
  `MFA_REPLAYED`, identically for both clients. Temporary-password and owner TOTP
  setup use the same restricted session and endpoints on either client.
- `POST /auth/refresh`: `deviceId`, plus a bearer client's `refreshToken`.
- `GET /auth/session`, `POST /auth/logout`, `/auth/profile`, `/auth/password`,
  `/auth/totp/setup`, `/auth/totp/confirm`, `/auth/totp/disable` are shared.
- `GET /auth/devices` lists both carriers with `kind`, `current`, `id`,
  `deviceName`, `createdAt`, `expiresAt`. `POST /auth/devices/<id>/revoke` revokes
  either kind, including the current session, from either client.

A request without Origin, cookies or browser fetch metadata bootstraps bearer
credentials. Browser requests require exact same Origin; credential-bearing
browser mutations also require the session CSRF token. Any Authorization header
is validated and never falls back to cookies. Browser responses deliver access
and refresh credentials only as HttpOnly, SameSite=Strict, Secure host cookies
(Secure is omitted for loopback HTTP development). Native clients store tokens
in Android Keystore-encrypted storage. Refresh cookies never appear in JSON.

All devices share `platform-v1/identity/devices/`: immutable sessions, per-user
indices, hashed access/refresh tickets, spent/revoked markers, login generations,
and versioned security state. Access expires in 600 seconds; the session expires
absolutely after 30 days. Rotation spends one atomic ticket; replay revokes the
family. A device re-login replaces its old session; at most 20 active devices
exist across both carriers. Logout, role/status changes, password changes and
account deletion invalidate both carriers. TOTP enrollment elevates only its own
session. Never retry an ambiguous refresh; sign in again. Browser tabs serialize
refreshes with Web Locks and persists a non-secret pending marker before spending
the refresh ticket, requiring sign-in after an interrupted rotation. No credentials
enter browser localStorage. All navigation/session checks use that same client.

Roles are one axis: `owner` > `admin` > `user`. Admins and the owner appear in the
public term roster, manage forms and may list/look up users through `/admin/users`
and `/admin/users/<id>`. Ordinary users cannot access any account-management
endpoint. Admins can resolve ordinary-user identity disputes; only the owner
manages roles or other administrators. Public roster snapshots exclude `user`
even when their records have department/title/term fields. Public roster reads
are not cached in the browser or CDN, so an old projection is never used after
a role change. Ordinary students'
identity and contact details are available only to themselves and staff. Other
students see only their explicitly chosen nickname. Form receipts never expose
an authenticated submitter's identity or contact details to their holder.

Build `.server-build/platform.mjs` with `npm run build` and deploy the static
output and function together. This contract replaces `/auth/token`,
`/auth/token/refresh`, `/auth/legacy-profile-login` and `/members`; no redirects or
compatibility readers remain.

## Deployment migration

Before deploying, quiesce identity writes and run
`scripts/platform/migrate-accounts.mjs` with process-scoped `ACCOUNTS_PROJECT_ID`,
`ACCOUNTS_BLOB_TOKEN`, and `STUDEV_PRIVATE_DIR` pointing outside the repository.
Default invocation is read-only; inspect its counts, then run with `--apply`.
It appends `member` → `admin` revisions, preserves UID/student/password/TOTP,
validates student claims, fills a missing owner identity from the private owner
profile if necessary, rebuilds roster snapshots, and removes the superseded
cookie/native session keys. Existing devices must sign in again. Re-running is
safe after a partial migration. Resolve any incomplete identities or conflicting
claims before applying. Do not deploy the new reader until this step succeeds.
The new initialization configuration additionally supplies
`PLATFORM_OWNER_STUDENT_ID` and `PLATFORM_OWNER_REAL_NAME`; already initialized
owners keep their stored identity.

Read-only production preflight on 2026-10-31: 34 accounts, 32 `member` records to
promote, 0 incomplete active profiles, 0 conflicting claims, 321 obsolete session
**keys**. The migration was not applied by the accounts task.

The removed campus activity service was inventoried read-only at
2026-10-31T15:30:02Z in project `makers-xubgsi8n79pp`, store
`studev-collections`, exact prefix `platform-v1/activities/`. It contained 0 Blob
keys and 0 activities (0 non-test activities). No production data was deleted.
