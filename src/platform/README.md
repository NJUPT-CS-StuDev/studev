# Shared community accounts

Web, Android and Windows use the same `/api/platform` identity endpoints and errors:

- `POST /auth/register`: `studentId`, `realName`, optional `nickname`, `qq`, `password`.
  Registration is open to every student as `user`. No invitation or email
  verification. Student IDs normalize NFKC and case, and have one atomic claim.
  Pre-recorded staff accounts require administrator activation; public
  registration cannot claim administrator privileges by knowing a student ID.
- `POST /auth/login`: `studentId`, `password`, optional `totp` (TOTP or recovery
  code), `deviceId` (16–128 URL-safe characters), `deviceName` (1–80 characters).
  Missing/invalid factors return `MFA_REQUIRED`/`MFA_INVALID`; used factors return
  `MFA_REPLAYED`, identically for all clients. Temporary-password and owner TOTP
  setup use the same restricted session and endpoints on every client.
- `POST /auth/password/forgot`: `studentId`. Mails a reset link to the account's
  QQ mailbox and answers `{ ok }` whether or not the student ID has an account.
  One mail per account per five minutes.
- `POST /auth/password/reset`: `token` (from the link `/login/?reset=<token>`),
  `password`. Sets the password, marks the mailbox verified and signs every device
  out. A link lasts 30 minutes, works once, and dies with any password change.
- `POST /auth/account/delete` (signed in, CSRF): `password`. Mails a confirmation
  link `/login/?delete=<token>`; `POST /auth/account/delete/confirm` with that
  `token` deletes the account, its student-ID claim and every device. The owner
  cannot be deleted.
- Mail is Resend's free plan (`RESEND_API_KEY`), capped at 90 a day so it is
  refused here before Resend refuses it. Every password change or reset also mails
  the account a note.
  All three clients manage profiles, passwords, authenticators and login devices
  in their own interface. Password-reset and account-deletion links confirm
  mailbox access on the website; native clients request these mails in the app.
- `POST /auth/refresh`: `deviceId`, plus a bearer client's `refreshToken`.
- `GET /auth/session`, `POST /auth/logout`, `/auth/profile`, `/auth/password`,
  `/auth/totp/setup`, `/auth/totp/confirm`, `/auth/totp/disable` are shared.
  Clients renew credentials only for `TOKEN_INVALID` or `AUTH_REQUIRED`, never
  for a rejected password, verification code or recovery code.
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

Roles are platform-wide: `owner` > `admin` > `user`. The owner manages roles
and other administrators. Owners and admins manage forms and may list or look up
users through `/admin/users` and `/admin/users/<id>`; admins may edit ordinary
users. Account responses carry `memberships` for the subject of that account
response. A current membership has one organization ID with independent
department and title fields, plus an optional assigned department for leadership
and an order for roster display. A staff edit sends `revision` and only the
fields being edited. Membership changes submit the account's current array
under the same revision. Class preferences are synchronized separately.

`GET /public/roster?term=YYYY-YYYY` reads the student center's current roster or
an archived roster. The current roster is derived from appointments independently
of platform role. It includes eligible pending appointments and excludes disabled
accounts. `POST /admin/roster/archive` freezes the current term for the owner.
Repeating the action returns the same archive. Older terms are read from archives
without rebuilding them. Both projections expose only published organizational
details and opaque avatar addresses. Signed-in member browsing remains limited
to active accounts. Ordinary students'
identity and contact details, including staff identities, are available only to
themselves and authorized staff. Other
students see only the avatar, nickname and signature. An unset nickname uses the
final character of the real name; the raw empty nickname stays unset in storage.
`GET /members?query=&offset=0&limit=50` and `GET /members/<id>` require sign-in
and return only `id`, `nickname`, `signature`, and an opaque `avatarUrl` that
does not disclose QQ. Search matches nicknames only; pages contain at most 100.
The public image proxy admits fixed image types and reads at most 2 MiB.
Member reads use `members/<id>/<account-revision>.json`, never private account
history; account changes publish the minimal public projection at that revision.
An inactive projection hides disabled/deleted accounts, and an older delayed
publisher cannot replace a newer revision. Unchanged public fields need no new
projection. Existing accounts are populated once before the new application is
published. Form receipts never expose
an authenticated submitter's identity or contact details to their holder.

Build `.server-build/platform.mjs` with `npm run build` and deploy the static
output and function together.

Before the organization model is deployed, run
`node scripts/server/migrate-organizations.mjs` with the scoped migration token
in `STUDEV_MIGRATION_TOKEN` for a read-only report. Once the report has no
unmatched rows, run with `--apply` to save the new account revisions and seal
previous terms. Run the report again to confirm that no revisions remain.

`POST /sync` takes `{ tasks, settings }` and returns both merged. Tasks are merged
by id and modification time, including deletion markers. Settings contain only
the sections named in `src/campus/world/merge.mjs`, each `{ value, modified }`;
`null` clears a section. The later modification wins for each section. Existing
local preferences without timestamps migrate with an epoch timestamp so that
they can be uploaded without replacing a newer explicit choice. These records
are private to the authenticated account. AI conversations and provider keys
are never part of this contract.

`POST /ai` relays the shared assistant contract as a stream without persisting
message bodies. Free inference is bounded per account, including continuation
requests after tool calls. A device using its own provider key calls that
provider directly; neither its key nor its conversation goes through this API.

Every form is answered by someone signed in; `access` says only who can see it
(`public`: anyone, who signs in when they submit; `members`: signed-in people).
The campus's own three forms are named in `product.json` under `forms`: feedback,
photos of places and data the teaching office does not publish. The web and
native Android entries read them, and fill fields they know (`a.<field>=` in the
link). The data form's approved material goes to the private data pipeline. Review does not directly change
public campus facts. Export approved material with `STUDEV_PRIVATE_DIR` pointing
to the existing external private storage:

```powershell
node scripts/platform/export-contributions.mjs --output <the private evidence directory for contributions>
```

The export includes public answers, original files and review provenance; account
identity and signed download credentials stay out of the acquisition evidence.
The private pipeline places a reviewed lab sheet with its other lab evidence. The normal evidence parser and
release pipeline then apply, including stopping on undecided cells.
