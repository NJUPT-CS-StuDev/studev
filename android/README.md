# studev Android

The native client provides campus services: 课表 / 地图 / 搜索 / 我的.
The web client also contains the student-development-center portal. Both read
one campus data contract and use the same generic search and routing kernels.

## Build and release

Use PowerShell 7. Set JDK and SDK only in the build process:

```powershell
$env:JAVA_HOME = 'D:\Dev\java\jdk-21.0.13+9'
$env:ANDROID_HOME = 'D:\Dev\Android\Sdk'
npm ci
npm run digest
pwsh android/kernels.ps1
cd android
.\gradlew.bat assembleDebug testDebugUnitTest lint
```

`product.json` supplies versionName, versionCode, minimum SDK, site origin,
campus time zone and initial map presentation to Gradle, the web and release
scripts. `design/tokens.json` generates Compose colors and launch resources.
Map styles, fonts, sprites, data and native binaries are generated and ignored.
Missing inputs produce build errors. `kernels.ps1` uses the wasm-search and
wayfind checkouts' Android builds and copies their libraries and bindings into
`android/kernels/`; `-SearchPath` and `-WayfindPath` select other checkouts.

Debug supports arm64 and x86_64; release is arm64 only. MapLibre uses the same
OpenGL renderer and SurfaceView on all devices. Theme changes restyle Compose,
the map and system bars without recreating the native surface.

From the repository root, `npm run release:apk` builds and signs the APK, puts it
on object storage and publishes it on GitHub Releases. Signing keys and credentials
stay in external private storage. A direct `assembleRelease` without signing
properties creates a debug-signed build, not an update. Increase versionCode for
each release and retain the signing certificate. 我的 → 下载新版本 opens `/download/`
in the browser; the browser owns the download and installation.

## Data and feature ownership

Packages under `top.hicancan.studev` say what they are. `world` is what every entry
shares: the person's line along time (`CampusLine`), names, rooms and the campus
clock. `timetable`, `map`, `search` and `me` are the entries. `navigation`,
`device` (calendar, reminders, background refresh), `widget` and `location` are what
only a phone has. `account` is the club platform's client, `data` reads releases,
`app` is the shell and its styling.

The APK bundles campus space, small academic indexes and the release contract.
Class schedules, exams, room days and content-search shards load on demand into
`files/campus/<version>/`. Each reader owns one immutable release; it never
mixes shards from another release. Writes validate paths and JSON and replace
files atomically. Startup uses local data first. Release discovery reads the
site's embedded contract; activation checks indexes and the selected class
before replacing the saved release. A constrained worker checks for updates.
The bundled map, style and route graph remain available offline.

All campus dates and opening hours use the product time zone. The saved class
is shared by timetable, exams, calendar, reminders, home and widgets. Every
published room links to its packaged map target. Search ranking and route
answers come from the kernels; clients do not manufacture or rank answers.
Provider maps are comparison layers; the base map is the released campus space.

Deep links use the current public web URLs under `/map/` and `/search/`.
`/map/?nav=` opens the route to a place and is used by reminders and widgets. Class, week, search query,
building, date, period and campus parameters select their corresponding screens.
Sharing and cold/warm launches use the same URLs. Back dismisses overlays and
map selections before returning to the root tab.

`device` writes only studev's own local calendars. Stable event IDs let a resync
update events in place and remove obsolete rows; switching one off removes only
that calendar. Reminders keep a rolling seven-day schedule with AlarmManager where
allowed and WorkManager otherwise. Calendar, reminders and widgets all read
`CampusLine`, the same line the timetable draws. Permissions are requested at the
point of use. No server push or Google services are required.

Widgets show the rest of today, or tomorrow once today is done. Boundary work and
periodic maintenance refresh them without background GPS.

Navigation uses one process session and shared GPS/network source. The planner
supports walking/cycling, endpoint search, swapping and stair avoidance. Route
alternatives, maneuvers, matching, rerouting and arrival come from wayfind.
Live navigation uses a foreground service, notification, wake lock and Chinese
TTS. Exit stops the session; a killed process does not restart a stale trip.

## Accounts

The account surface supports student registration, login, profile editing,
password changes, TOTP enrollment/recovery and a shared web/Android device list.
Both clients call the same identity endpoints; see src/platform/README.md.
Only credentials differ: HttpOnly cookies on web, Keystore-encrypted bearer
credentials on Android. Registration creates role user; roles admin/owner
control staff visibility and management on the server.

For local account work, run `node android/tooling/platform-fixture.mjs`, build debug
with `'-Pstudev.platformHost=http://127.0.0.1:4319'` and reverse port 4319. The
fixture serves the real platform handler over memory and never touches production.

## Device verification

Always use `adb -s`, and prefer a connected phone. Change only studev on the
owner's phone; never fake its GPS or alter device-wide settings. Unit tests in
`app/src/test` run against the real digested package.

Debug-only navigation simulation drives the actual Navigator and map layer; it
never registers a mock GPS provider. Export a route from the planner and replay
it through the emulator with `pwsh android/tooling/replay.ps1 -Device emulator-5554`.
The script rejects phone serials. Simulation is not evidence of real GPS accuracy.

For local data tests, run `node android/tooling/data-fixture.mjs`. It serves the
real digested shards and exposes the selected release through a campus page and
constants module, exactly as production discovery does. Build debug with
`'-Pstudev.dataHost=http://127.0.0.1:18764'` and use
`adb -s <serial> reverse tcp:18764 tcp:18764`. Only debug permits HTTP.
Remove reverse forwarding after testing.
`-Pstudev.bundleAllData=true` measures the full-data APK size; normal builds use
the minimal bundle. No production release or data is changed by these fixtures.
