# Native accounts and activities

The `/api/platform/[[path]]` entry still loads the bundled
`.collection-build/platform.mjs`. Run `npm run build` with the normal data release
configuration; deploy its static output **and** the platform function together.
This change needs no new environment variables, secret, store or OSCA bucket.
It uses the existing strong-consistency `studev-collections` Blob store.

## Native login

`POST /api/platform/auth/token` accepts `studentId`, `password`, optional `totp`
(a code or recovery code), `deviceId` (16–128 URL-safe characters) and
`deviceName` (1–80 characters). Incomplete accounts finish setup on the web.
The response contains `user`, `tokenType: "Bearer"`, `accessToken`, `expiresIn`
(600 seconds), `refreshToken`, `refreshExpiresAt` (epoch milliseconds) and
`deviceSessionId`. It never sets a cookie. Password attempts share the browser's
account/IP rate-limit buckets. No browser authentication endpoint was replaced.

`POST /api/platform/auth/token/refresh` accepts `deviceId` and `refreshToken`.
It spends the old ticket atomically, returning a new access/refresh pair with the
same absolute 30-day device-session expiry. Replay revokes the entire family.
Serialize refreshes and persist the replacement before using it. Never retry an
ambiguous refresh: require sign-in again. Re-login from the same installation
revokes its previous families. Concurrent logins reserve an immutable account
generation; a conflicting login returns 409 and may be retried with a fresh MFA
code if required. The generation also enforces the 20-device account limit.
Native requests send `Authorization: Bearer ...`;
an invalid header never falls back to cookies. Cookie mutations retain Origin
and CSRF validation. Origin-free token bootstrap accepts neither cookies nor
browser fetch metadata. No cross-origin browser access is enabled.

`GET /auth/devices` lists the caller's active native sessions; cookie-authenticated
`POST /auth/devices/<id>/revoke` requires the existing CSRF token. Native
`POST /auth/logout` revokes its own family. Account security-version changes and
disabled/deleted accounts invalidate access and refresh credentials.

New keys below `platform-v1/identity/native/`: `sessions/<id>.json`,
`by-user/<user>/<id>.json`, `access/<sha256>.json`, `refresh/<sha256>.json`,
`spent/<sha256>.json`, `revoked/<id>.json`, immutable `logins/<user>/<generation>.json`
device-family heads, and versioned `state/<id>/` for existing security-setting
operations. No raw token or device ID is stored. Access,
refresh, spent and revoked records include `expiresAt`; maintenance may purge
them **after** expiry. Login generations also carry `expiresAt`; preserve them
until that expiry so an older family can never become current again. Keep
revocation/spent markers until that expiry. Session
and by-user records may be removed together after their 30-day expiry.

## Activities

All paths below are relative to `/api/platform`:

- `GET /activities`: upcoming/in-progress public activities, ordered by start;
  pages of 100, with `next` as the next `?after=<id>` cursor.
- `GET /me/activities`: the caller's upcoming activities, including unlisted.
- `GET /activities/<id>`: public read, including unlisted links.
- `POST /activities`: authenticated create.
- `POST /activities/<id>`: owner update with `revision`.
- `POST /activities/<id>/delete` (or `DELETE /activities/<id>`): owner delete
  with `revision`.

Input: `title` (1–80), `description` (0–2000), `startsAt` and `endsAt` (ISO with
timezone), `visibility` (`public` or `unlisted`) and `place`. Place is either
`{kind:"campus",id:"<packaged place ID>"}` or
`{kind:"point",name:"<1–80 characters>",position:[longitude,latitude]}`.
The server checks campus IDs against the fixed versioned package URL, not a
caller-provided URL. Time range is at most 31 days, ending in the future and
starting within a year. JSON is limited to 12 KiB. Creation is limited to 10 per
account/hour; editing to 60/minute. Organiser identity comes from authentication,
never submitted fields. Unlisted means link-only discoverability, not secrecy.

New Blob prefixes: `platform-v1/activities/records/<id>/` (immutable revisions
and current snapshot), `activities/index/<id>.json`, and
`activities/by-user/<user>/<id>.json`. Delete leaves a tombstone. Existing form
records, file storage and data package shapes are unchanged.

Share URL: `https://studev.hicancan.top/map/?activity=<id>`.
Android registers the host in `MainActivity.kt` only. The map module may call
`ActivityEntryPoints.createAt(place.id)` (or the named-point overload) to open the
editor. Domain-verification behavior uses the existing map intent filter.

## Rollback

Deploy the previous static output and platform function together. Leave the new
namespaced Blob metadata in place; old code ignores it. No existing records or
secrets need reverting. Native clients will need the new backend before sign-in
or activity requests work again. Do not remove shared campus package versions
that are still referenced by deployed functions or clients.
