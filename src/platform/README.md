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
  Send `foreground: true` during active use to renew the idle deadline.
  Background refreshes rotate credentials without extending it.
- `GET /auth/session`, `POST /auth/logout`, `/auth/profile`, `/auth/password`,
  `/auth/totp/setup`, `/auth/totp/confirm`, `/auth/totp/disable` are shared.
  Clients renew credentials only for `TOKEN_INVALID` or `AUTH_REQUIRED`, never
  for a rejected password, verification code or recovery code.
- Changing a password after enabling an authenticator requires a fresh factor.
  Owners and administrators must use their own fresh factor for administrator
  provisioning, role changes and resets of member passwords or authenticators.
- `GET /auth/devices` lists both carriers with `kind`, `current`, `id`,
  `deviceName`, `createdAt`, `expiresAt`. `POST /auth/devices/<id>/revoke` revokes
  either kind, including the current session, from either client.

A request without Origin, cookies or browser fetch metadata bootstraps bearer
credentials. Browser requests require exact same Origin; credential-bearing
browser mutations also require the session CSRF token. Any Authorization header
is validated and never falls back to cookies. Browser responses deliver access
and refresh credentials only as HttpOnly, SameSite=Strict, Secure host cookies
(Secure is omitted for loopback HTTP development). Native clients protect tokens
using Android Keystore or Windows DPAPI. Refresh cookies never appear in JSON.

All devices share `platform-v1/identity/devices/`: immutable sessions, per-user
indices, hashed refresh tickets, spent/revoked markers, login generations,
versioned security state and the current deadline used by device inventory.
An access credential is not stored: it is an HMAC-sealed claim of its session,
owner, deadline and the revisions of the session state, login head and account it
was issued against. Each request reads those authoritative records in one round of
simple reads: a revision n is proven latest by n + 1 being absent (revisions are
reserved densely), and only a newer revision falls back to a listing. Revocation
stays immediate. An app's access token expires in at most 600 seconds; a web
credential lasts its session's idle window, since its cookie carries the refresh
credential beside it anyway, and the first request of a page in use renews that
window at most once a day. Foreground use renews the 30-day idle
window on credential rotation, up to 180 days from the sign-in for ordinary
accounts and 90 days for administrators and owners. Existing valid sessions
adopt this policy on their next foreground refresh. Rotation spends one atomic
ticket; replay revokes the family. A device re-login replaces its old session;
at most 20 active devices exist across both carriers. Logout, role/status
changes, password changes and account deletion invalidate both carriers. TOTP
enrollment elevates only its own session. Never retry an ambiguous refresh; sign in again. Browser tabs serialize
refreshes with Web Locks and persists a non-secret pending marker before spending
the refresh ticket, requiring sign-in after an interrupted rotation. No credentials
enter browser localStorage. All navigation/session checks use that same client.
Reads cost no round trip on screen: the web client keeps an IndexedDB copy of each
GET answer per account (`client/replica.ts`), shows it at once and then the server's
answer when it differs. Any write, sign-in or sign-out drops the whole copy; an
answer that began before a write is never kept; a 401/403/404 in the background drops
the copy and reloads the page; a session copy whose access fields differ from the
server's reloads the page through the gate. The copy never authorizes anything:
writes and the AI stream confirm the session with the server first.

Platform roles descend from `owner` through `admin` to `user`. The owner manages
roles and other administrators. Owners and admins may list or look up users
through `/admin/users` and `/admin/users/<id>`. Admins may edit ordinary users.
Account responses carry currently effective `memberships`. Authorized account
management additionally reads the subject's appointment history. A membership
records an organization, title, roster order and optional direct-child assignment.
A student development center appointment has a China civil `startsOn` date and
exclusive `endsBefore` date. The normal dates cover both terms of one academic
year. Separate periods in the same organization may follow each other. Class
affiliations can be undated. Each admin update applies to the current account
revision. Class preferences are synchronized separately.

`GET /public/roster` shows appointments effective today in China.
`GET /public/roster?year=YYYY-YYYY` shows appointments that intersect the selected
academic year, retaining the date range of each appointment. Both queries read
the same public per-person projection of the account's dated appointments. The
projection includes eligible pending appointments, excludes disabled accounts
and returns published organizational fields and opaque avatar addresses.
Signed-in member browsing remains limited
to active accounts. Ordinary students'
identity and contact details, including staff identities, are available only to
themselves and authorized staff. Other
students see only the avatar, nickname and signature. An unset nickname uses the
final character of the real name; the raw empty nickname stays unset in storage.
`GET /members?query=&offset=0&limit=50` and `GET /members/<id>` require sign-in
and return only `id`, `nickname`, `signature`, and an opaque `avatarUrl` that
does not disclose QQ. Search matches nicknames only; pages contain at most 100.
On `/members/`, the signed-in role determines whether the list shows member
profiles or administrative tools. A shared `/members/?id=<id>` link opens the
same limited profile for any signed-in role.
The public image proxy admits fixed image types and reads at most 2 MiB.
Member reads use `members/<id>/<account-revision>.json`, never private account
history; account changes publish the minimal public projection at that revision.
An inactive projection hides disabled/deleted accounts, and an older delayed
publisher cannot replace a newer revision. Unchanged public fields need no new
projection.

The API runs as an edge function: `npm run build` bundles `.server-build/edge.mjs`
(Web APIs only) for `edge-functions/api/platform/`, and the one Node function,
`/node/scrypt`, computes password hashes for it. Deploy the static output and
both functions together.

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

## Collections

Collections live at `/forms/` on desktop and mobile Web. Android and Windows
open a collection in the browser and share the account service with Web.
The product configuration identifies the campus feedback, location photos and
data contributions. Links use `/forms/?id=<collection>&round=<round>` and may
prefill public answer fields with `a.<field>=<value>`.

A collection has an issuing organization, audience, academic semester, status,
tags and one or more rounds. A collection with a specified audience keeps one
shared roster for all rounds. Its audience organization determines the grouping
scope in the organization tree. Changes to the roster affect the progress counts
of all rounds and retain any submissions already made. The public campus entries
stay at the top of the catalog. Other collections are grouped by semester and ordered by publication
within each semester. Search matches tags and courses. The optional course
reference copies the stable campus course ID, code and display name, and remains
usable across search index updates.

Managers may set `attachmentNamePattern` on the collection, shared by all rounds.
The authenticated submission view and staff export return an `archiveName`
generated from the same rule, with the original `name` retained for individual
downloads. An empty rule leaves names to the manager's export settings.

- Visitors browse published public collections. Submission requires a logged-in
  eligible account. Stopping a collection closes submissions and leaves its
  published detail visible to the same audience. Unpublishing returns the
  collection to draft. Prior participants retain their own receipts.
- A draft may be permanently deleted if it has no submissions or outstanding
  upload authorizations. A student with verified identity can retrieve earlier
  submissions filed against their student ID before they had an account.
- Owners can manage every collection. Admins manage collections whose issuing
  organizations fall within their current assignments. Admins publish
  within those assignments. The people picker exposes only the authorized
  directory scope.
- Collection reads and writes use the signed-in account's role. The same
  role checks apply to every record, progress report and download.
- Participant progress is disabled by default and can be enabled for all rounds
  in a collection. A participant with a verified student ID on the roster sees
  counts for the round and each group, plus their own status. Open collections
  show submitter and submission counts to signed-in accounts that can submit.
  Other participants' names, student identifiers, answers and attachment metadata
  remain staff-only.
- Round fields cover text, long text, single choice, multiple choice, number,
  date and attachments. Each round defines its deadline, late policy, edit and
  review rules, and quotas. A published round with `strict` automatically
  stops accepting submissions at its deadline. Managers can set `allow-late`
  after the deadline to reopen it while retaining the original cutoff, or use
  `closed` to stop it manually. Rounds without a deadline remain open until
  stopped. Catalog and detail responses include the server time used for
  their round statuses. Replacement rounds keep a single submission per
  student. Each successful submission counts toward the round limit and, in
  multiple-submission rounds, toward the student limit. Pending uploads hold
  their place temporarily. Cancellation or expiry releases the reservation.

All API paths below are relative to `/api/platform/collections`.

| Request | Result |
| --- | --- |
| `GET /` | Scoped catalog with account role, organization list, summary rounds and the person's own statuses |
| `GET /items/<id>` | Collection definition and own submissions. Authorized managers can also see recipient names and IDs, and include one round's report with `?board=1&round=<round>` |
| `GET /people` | Scoped staff directory for recipient selection |
| `POST /items` | New draft or published collection with issuing identity, rounds and audience |
| `POST /items/<id>` | Collection metadata, audience or lifecycle update using the current revision |
| `POST /items/<id>/unpublish` | Return a collection to draft at its current revision, retaining receipts |
| `DELETE /items/<id>` | Permanently delete an eligible draft at its current revision |
| `POST /items/<id>/duplicate` | New draft with copied collection fields and cleared deadlines |
| `POST /items/<id>/rounds`, `POST /items/<id>/rounds/<round>` | Add or revise a round using the collection revision |
| `POST /items/<id>/rounds/<round>/submissions` | Validate answers and attachment descriptors, then either finalize or issue the upload receipt |
| `GET /items/<id>/rounds/<round>/submissions` | Staff report with compact records, or the aggregate progress allowed for the participant |
| `GET /items/<id>/rounds/<round>/csv` | Staff CSV |
| `POST /items/<id>/rounds/<round>/files` | Staff attachment manifest for selected submissions and naming fields, or download authorization for exactly the requested file revisions |
| `GET /mine`, `GET /submissions/<id>` | Own history or one authorized record |
| `POST /submissions/<receiptId>/complete`, `POST /submissions/<receiptId>/cancel` | Confirm an upload or return its unused place |
| `POST /submissions/<id>/edit`, `POST /submissions/<id>/review` | Edit answers or record a staff review at the current submission revision |
| `POST /submissions/<id>/files/<file>/download` | Authorize one private immutable attachment download |

Submit with `{ answers, files, keepFiles?, attemptId? }`. Reuse the same UUID
for the same attempt if the connection drops. Each new file supplies
`{ fieldId, name, size, type }`. A submission with no new files commits within
that request. When new files are present, PUT them to the returned signed URLs
in order, then send `{ receiptToken }` to `POST /submissions/<receiptId>/complete`.
A valid receipt can confirm its upload after the login session or collection
deadline passes. Timeliness uses the server time when the submission request
arrives. Reopened submissions at or after the cutoff are late, including saved
changes to answers. A submission's deadline snapshot keeps its late flag
stable through review and later changes to round settings. The receipt response
contains the submission ID, status, late flag and timestamps. Answers,
identity and attachment names require account authorization. File uploads and
downloads go directly to OSCA. The backend verifies and freezes uploaded
content and binds signed downloads to the saved ETag. A replacement commits
its latest files before the superseded objects are cleaned up. Files that the
participant kept and imported objects with unproven ownership stay available.

Metadata uses one canonical EdgeOne Blob collection model. Immutable definition
and submission revisions support concurrent editors, review, and retained
schema snapshots. The catalog reads definition heads and the caller's history.
Staff reports read only the requested round. Course search reads the public
campus release locally. Attachments stay in the existing private 1 TB OSCA
bucket. The browser builds ZIPs from the authorized files. Its preview uses the
same paths and counts as the archive. Folder order, filename fields and root
summary files can be saved as a personal scheme in the browser.

The private data pipeline consumes approved campus contributions. Run the export
with `STUDEV_PRIVATE_DIR` pointing to the existing private storage.

```powershell
node scripts/platform/export-contributions.mjs --output <the private evidence directory for contributions>
```

The export carries public answers, original files and review provenance.
Account identity and signed download credentials stay private. The evidence
parser and release pipeline handle reviewed materials and stop on undecided cells.
