# studev Android

The Android client has four destinations: 首页 / 课表 / 地图 / 我的. The campus
home brings together the next lesson, today's remaining lessons and upcoming
exams. Exams live beside the timetable; free rooms and full-text search open
from home. The map keeps its own time-of-day place home sheet, place search,
planning and live navigation. Account and campus activities open from 我的
through the single root ActivityHost. Back closes an account/activity overlay
before changing the campus tab; from the map it dismisses search, routes and
place details before returning to 首页.

## Native campus queries and device features

`campus/` contains the product shell and query screens. `data/AcademicFacts.kt`
reads the same raw teaching, exam and room shards as the web. Teaching weeks and
all displayed dates use Asia/Shanghai, including on phones set to other time zones.
The persisted class is shared by home, timetable, exams, calendar and reminders.
The week grid and day list open the same course detail; a published room opens
the existing planner through `NavigationRuntime.open(Place)`. Home uses the
public wayfind binding for walking minutes; it never estimates straight-line time.

`AcademicRepository` reads an immutable release per reader. The APK includes campus
space (map, places, route graph and place search), small academic indexes, and
`data/release.json`. Class schedules, class exams, room days and content-search
shards are downloaded only when requested, including for the bundled version.
Academic files are opened only when needed: class shards, the selected room day,
and wasm-search's requested posting/content chunks. Remote shards are cached in
`files/campus/<version>/` with atomic file replacement. Remote readers never mix
in a different version's assets. Startup opens local data first, then checks the
web campus island's module and its constants module for the embedded release
contract. There is no published standalone `latest.json` endpoint in this repo.
A release is activated only after its indexes and selected class can be read.
An older deployed schema is rejected; the bundled map and indexes stay usable.
Missing undeployed shards explain that a network download or published version is
needed. Already downloaded shards survive app restarts and APK upgrades. Readers
share a per-version lock, validate JSON and paths, and atomically replace cache
files. A network/battery-constrained 12-hour worker checks for data updates.
The existing map, style and route graph remain the APK's bundled release.

`calendar/` creates a dedicated local **studev 课表与考试** calendar using
CalendarContract. Event IDs contain the published meeting ID, term and week;
re-sync updates rows in place and removes obsolete rows. Disabling sync deletes
only this calendar. Both calendar permissions are requested at the point of use.

`reminders/` schedules a rolling seven-day window, replenished by a persisted
12-hour maintenance worker and after boot, app replacement and exact-alarm grant.
Where allowed, AlarmManager delivers the exact reminder. WorkManager is also
scheduled as a fallback if that access is later revoked; stable IDs prevent double
notification delivery. Notification permission is requested when enabling reminders.
The navigation action carries the room's published canonical ID. Opting out cancels
scheduled work and alarms. No server push or Google Play Services is involved.

`widget/` is a responsive 4×2 / 4×1 Glance widget using the generated design palette,
launcher corner radius and explicit clickable text instead of OEM-sensitive Buttons.
Choose a home dorm in 我的 from the package's dorm buildings. The widget routes
from that dorm to the published room endpoint with wayfind; departure is class
start minus rounded-up walking minutes minus a three-minute buffer. Until a dorm
is selected, it gently explains how to enable departure times. Today, tomorrow,
ongoing lessons, exams and no-lesson states use Shanghai time. It follows the
system theme by default and respects studev's explicit light/dark preference.
One boundary worker refreshes at the next class start/end or midnight; a 12-hour
safety worker and data/settings changes refresh it too. WorkManager may defer
refresh under device battery restrictions. No exact alarms or background GPS.
Add it from 我的 or the launcher's widget picker. The separate 「下一节课 · 紧凑」
entry declares 4×1 and keeps an 80dp visible card even when an OEM launcher
allocates a larger host. The Huawei EMUI pin flow currently reserves two rows
for it despite the 4×1 declaration; other launcher items are never moved.

`me/AppUpdates.kt` reads `/download/latest.json`, follows its manifest URL and
downloads every part with resume, retries and SHA-256 verification. If the site
is unavailable it reads the same manifest contract from the GitHub mirror. Parts
are assembled only after the whole APK hash matches, then the package installer
receives the file. Unknown-source access is requested only from the explicit
continue button. Checks run only from 我的; an unreachable release says so.

Deep links cover `/map/`, `/search/`, `/search/timetable/`, `/search/exam/`,
`/search/classrooms/` and `/search/web/` (including community/materials search).
Class, timetable week, search query, room building/date/period and campus parameters
open the corresponding native screen. The map's existing `place` link still works;
`route=true` also opens its planner, used by reminders and widgets.

The original app-campus validation used **studev-2**, serial **emulator-5556**.
Integrated validation uses **njupt-nav**, serial **emulator-5554**. After
preparing inputs and building, from the repository root:

```powershell
$adb = 'D:\Dev\Android\Sdk\platform-tools\adb.exe'
& $adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
& $adb -s emulator-5554 install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
& $adb -s emulator-5554 emu geo fix 118.9255 32.1150
& $adb -s emulator-5554 shell am instrument -w -e class top.hicancan.studev.CampusTabsTest top.hicancan.studev.test/androidx.test.runner.AndroidJUnitRunner
& $adb -s emulator-5554 pull /sdcard/Android/data/top.hicancan.studev/files/campus-shots D:\Temp\claude-wsl\agents\integrate\shots\
```

The tests cover both themes and all tabs, actual content-search and routing
bindings, idempotent provider writes and removal, a scheduled reminder with a real
navigation PendingIntent, class persistence, one-tap departure, offline shard
cache isolation, and widget placement on the actual launcher. The room
availability unit tests port the web's `campusDay.test.ts`, including authoritative
checked free lists, class/exam occupancy and unknown borrowed-room status. The
notification scheduling test uses a short-lived test event; production data has
no injected lessons or exams.

Verified on 2026-10-30: `assembleDebug testDebugUnitTest assembleDebugAndroidTest lint`
passes, including 20 unit tests; `CampusTabsTest` passes all 8 instrumented cases
(96.719 seconds), and `MapSmokeTest` passes all 3 original map cases (54.049 seconds).
Run the map suite before the widget placement case when capturing a fresh test
device. The campus suite orders widget placement last and reuses an existing
instance, so repeated runs do not fill the launcher with duplicate widgets.

Shared integration files changed by `app-campus` are `MainActivity.kt` (product
shell and full URL delivery), `AndroidManifest.xml` (device integrations and
search deep links), the app build/version catalog (the full shared package,
WorkManager and Glance), `data/CampusPackage.kt` (the current space contract),
`ui/theme/Theme.kt` (share the generated schemes with Glance), and
`navigation/Wayfind.kt` (decode the kernel's `via` field). The existing map and
navigation smoke-test entry helpers select the map tab before running their
original assertions. Map package internals and navigation runtime logic are
unchanged; cross-feature actions use the existing public planner/session methods.

Release 1.0.1 (versionCode 2) uses the current shared campus-space contract. From
the repository root, one command builds the arm64 release, signs it with the
private keystore, packages the manifest and parts (each no larger than 24 MiB),
and uploads `latest.json`, `manifest.json`, every part, and the full APK to the
matching GitHub Release:

```powershell
npm run release:apk
```

The command reads signing values from the local secrets store and never writes
them to the repository. Deployment fetches the latest two GitHub releases that
carry this manifest contract into `public/download/`, verifies every part and
the whole APK, and then builds the site. Future APK updates must increase
versionCode and use the same signing certificate.

`IntegrationSmokeTest` checks the combined shell on both the phone and emulator:
tab/back behavior, account and activities across recreation, campus deep links
while an account overlay is open, published/unknown hours, and real native route
rendering. It captures home, timetable, map home, hours, planning and the account/
activity entry screens in the app's external `files/integration-shots/`. Run it
with the same instrumentation command above, replacing `CampusTabsTest` with
`IntegrationSmokeTest`; it never supplies fake GPS to the phone.

## Build

Use PowerShell 7, JDK 21 and the Windows SDK. All environment overrides below
apply only to this process. Compile platform is `android-37.0`, target SDK 36,
minimum SDK 26. MapLibre is `android-sdk-opengl:13.7.1` on every device.
Both devices use SurfaceView. Theme changes update Compose, the map style and
system bars in place; they do not recreate the Activity or its native surface.
For headless validation, cold boot without changing AVD data or snapshots:

```powershell
& 'D:\Dev\Android\Sdk\emulator\emulator.exe' -avd njupt-nav -port 5554 -no-window -no-snapshot-load -no-snapshot-save -gpu swiftshader
```

Release APKs ship `arm64-v8a` only; debug APKs also keep `x86_64` for emulators.

Prepare the shared inputs from the repository root:

```powershell
node design/map/generate.mjs
npm run digest
pwsh ./android/kernels.ps1
```

`kernels.ps1` runs each checkout's `android/build.ps1`, copies the native libraries,
and generates the matching Kotlin bindings into ignored `android/kernels/`.
Override checkouts with `-SearchPath <path> -WayfindPath <path>`. Defaults are
`D:\code\github\hicancan\wasm-search` and `D:\code\github\hicancan\wayfind`.
The binding generation uses UniFFI's JNA cleaner for API 26 compatibility;
it never changes either checkout's configuration. JNA is pinned to 5.19.1 AAR.

From `android/`:

```powershell
$env:JAVA_HOME = 'D:\Dev\java\jdk-21.0.13+9'
$env:ANDROID_HOME = 'D:\Dev\Android\Sdk'
.\gradlew.bat assembleDebug lint testDebugUnitTest assembleDebugAndroidTest
```

Gradle generates Kotlin tokens and Android launch colors from `design/tokens.json`.
The Compose theme uses the generated palette, system typography, shapes and motion
values; dynamic color is disabled. It also copies the release named in
`src/data/campus-release.json` from `public/data/<version>/` into generated APK
assets at `data/`, with the release name in `data/version.txt`. No generated data,
map assets or native binaries belong in Git. Missing fonts/sprites or kernels
produce actionable build errors.

The package's own light/dark styles resolve `{data}` to `asset://data/space/仙林`
and `{assets}` to `asset://map`. Basemap archives use
`pmtiles://asset://data/space/仙林/basemap.pmtiles` and remain uncompressed in the APK
for native byte-range reads. Glyph `{fontstack}` / `{range}` placeholders remain
intact; CJK labels use the system font. No tile server or Google services are needed.

## Structure and behavior

- `data/`: strict kotlinx.serialization models for the actual shared package,
  including sourced `use`, structured weekday `hours`, categories, featured
  candidates and precomputed routing endpoints; release loading and DataStore
  recent places / favorites.
- `home/`: draggable map home, data-backed category shortcuts and time-of-day
  recommendations. A small pure Kotlin policy tests distance, diversity and
  opening state (including closing boundaries, overnight hours and 24-hour
  service). Missing hours remain unknown. Only debug builds expose the demo
  time menu; it changes presentation time, never GPS or the system clock.
- `ui/theme/`: Material 3 light/dark schemes and system-font typography, generated
  tokens, shared shapes. Status/navigation bars and overlays respect insets.
- `navigation/`: Compose routes, place selection, typed wayfind protocol,
  planner, process navigation session, foreground service, Chinese voice guidance
  and debug route simulator. Native routing/matching runs on a serialized IO
  dispatcher; the map stays mounted while search is open.
- `map/`: native map lifecycle, camera, 2D/3D controls, feature-state selection,
  persistent Material 3 place sheet with peek, half and expanded detail heights.
- `search/`: native wasm-search session on an IO dispatcher. It loads the packaged
  manifest, documents and lexicon, then follows `begin → posting chunks → prepare
  → content chunks → hydrate`. Native ranking is preserved. Quick categories
  filter the package's places; they do not add facts or ranking.
- `location/`: a shared GPS + network LocationManager subscription on a handler
  thread. Fresh accurate GPS takes precedence over network, stale/inaccurate fixes
  are rejected, and a bounded weighted filter smooths position. Course is used
  while moving; a display-remapped rotation vector plus geomagnetic declination
  supplies true-north heading while still. Compass frames do not count as new GPS
  evidence for off-route. Locate cycles browse → follow → heading → browse.

Tapping a result or campus feature opens a sheet and highlights its building,
including a room's parent. Favorites persist in DataStore. Sharing uses the Android
share sheet with `https://studev.hicancan.top/map/?place=<id>`. The same HTTPS URL is
handled on cold and warm launches; domain verification is deliberately deferred
(`autoVerify=false`). Back dismisses search, steps down expanded details, then
closes the selected place. Camera, selection and map mode survive recreation.
The place sheet's 路线 opens route planning on the same map.

Location is optional. The app explains its use before asking, supports approximate
location and denial, and offers system location settings when providers are off.
The map subscribes while visible. A location foreground service retains the same
source during live navigation, including with the display off; no background
location permission or Google services are needed.

## Route planning and navigation

The planner defaults to 我的位置, supports searching either endpoint, swapping
including 我的位置, 步行 / 骑行 and 避开楼梯 for walking. A position destination
is fixed at planning time and stays fixed through reroutes. It requests up to three
locally optimal alternatives from wayfind; the kernel may legitimately return
fewer. Kotlin explicitly serializes request defaults because Rust defaults to one
alternative. The UI does not manufacture or rank alternatives. Cards and map
lines select the same route; details render the native Chinese maneuvers.
The via label comes directly from wayfind, including the dominant unnamed
stretch's landmark. The data graph names park paths from actual OSM park
boundaries. Camera bounds use the measured header/sheet insets.
Rooms use their packaged parent building target and retain their room name/floor
in the arrival card. Position endpoints use a 100 m snap limit; a failed snap
explains the limit and offers choosing a campus origin.

开始导航 requests notification permission on Android 13+, then starts a location
foreground service from the visible Activity. The service owns the Navigator,
GPS updates, partial wake lock, ongoing maneuver notification and zh-CN TTS.
The banner, map matching, remaining metrics, prompts, off-route and arrival all
come from wayfind. The camera follows at 50° pitch with smoothed heading; panning
reveals a recenter action. Missing Chinese TTS produces one notice per process,
and visual guidance remains usable. Muting stops current speech. Confirmed
off-route fixes trigger a new route from the raw current fix with the same mode
and stair preference. The arrival card includes the kernel's entrance side and
the packaged floor for rooms. Arrival stops updates immediately and allows the
final announcement to finish (up to 12 seconds) before removing the service.
退出, the notification's exit action, and confirmed Back all stop navigation.

The session survives Activity recreation and notification return. It deliberately
uses `START_NOT_STICKY`: a killed process does not restart a stale trip without
the user. Huawei battery restrictions and sensor accuracy remain device-dependent.

### Debug simulation and emulator GPS replay

Only debug builds expose the planner's ⋯ menu: 模拟走一遍 at walking/cycling
speed, an accelerated 20× variant, and 导出路线供 adb 回放. Simulation samples the
chosen route's declared offsets with ±2 m positional jitter and feeds the same
Navigator and map location layer. During simulation, ⋯ also pauses/resumes,
injects sustained 45 m lateral drift to exercise real rerouting, or advances to
arrival. None of these commands register a system mock provider or alter a phone's
GPS. Do not use them as evidence of real-world GPS accuracy.

For platform GPS testing, export a route, start normal navigation, and run from
the repository root (only emulator serials are accepted):

```powershell
pwsh android/tools/replay.ps1 -Device emulator-5554
# Accelerated replay, with a deliberate detour:
pwsh android/tools/replay.ps1 -Route D:\Temp\codex\app-nav\route-walk.json -SpeedFactor 10 -DetourAtMetres 90
```

The script pulls the debug export when `-Route` is omitted. It interpolates
`geometry_offsets_m`, uses walk/bike speeds from the protocol, adds optional
jitter, and sends every fix with `adb -s <emulator> emu geo fix`. An external
route file must be a wayfind route or route response. Temporary exports live in
`D:\Temp\codex\app-nav`; no generated route coordinates are committed.

Unit tests cover serialized request defaults, protocol round trips, fake
Navigator updates into banner/off-route/arrival state, and simulator interpolation.
`NavigationTest` instrumentation exercises the actual native package, both
requested journeys, alternative selection, sixth-floor room arrival, rerouting,
screen-off service/notification, and real GPS replay. To run the main emulator
suite after installing the app and test APK:

```powershell
& $adb -s emulator-5554 emu geo fix 118.9255 32.1150
& $adb -s emulator-5554 shell am instrument -w -e class 'top.hicancan.studev.NavigationTest#nativeWrapperRoutesActualPackage,top.hicancan.studev.NavigationTest#alternativesAndRoomArrival,top.hicancan.studev.NavigationTest#myPositionSwapAndOptions,top.hicancan.studev.NavigationTest#walkingPlannerAndSimulator,top.hicancan.studev.NavigationTest#cyclingPlannerAndSimulator,top.hicancan.studev.MapSmokeTest' top.hicancan.studev.test/androidx.test.runner.AndroidJUnitRunner
```

For scripted GPS verification, run `NavigationTest#verifyEmulatorReplay` with
`-e replay true -e mode walk` (or `bike`). Without the opt-in it is skipped, so
ordinary instrumented test runs do not wait for an external driver. While that
test waits, pull its `route-replay.json`
from the app's external files directory and pass it to `replay.ps1`. The test
waits for actual provider-driven progress and arrival; it does not inject fixes.
`phonePlannerFromRealPosition` only opens the planner from the phone's real fix.
Both tests grant permissions only to studev.

Navigation screenshots use `planner-walk-alternatives`, `planner-bike-alternatives`,
`planner-alternatives`, `planner-alternative-selected`, `steps-walk`, `steps-bike`,
`navigation-walk-mid-route`, `navigation-bike-mid-route`, `navigation-reroute`,
`arrival-walk`, `arrival-bike`, `arrival-room`, `foreground-notification`, and
`phone-planner-real-position`. Pull requested shots to
`D:\Temp\claude-wsl\agents\app-nav\shots\`. Screen-off service/power dumps and
`StudevTTS` `request → onStart → onDone` logs distinguish real speech and service
execution from UI state alone.

## Device verification

Always identify the device. Change only studev on the owner's phone.

```powershell
$adb = 'D:\Dev\Android\Sdk\platform-tools\adb.exe'
$device = 'emulator-5554' # or '26QUT24227005105'
& $adb -s $device install -r .\app\build\outputs\apk\debug\app-debug.apk
& $adb -s $device install -r .\app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk
# Emulator only, before the tests:
& $adb -s emulator-5554 emu geo fix 118.9255 32.1150
& $adb -s $device shell am instrument -w -e class top.hicancan.studev.MapSmokeTest top.hicancan.studev.test/androidx.test.runner.AndroidJUnitRunner
```

The smoke tests exercise the real native search bundle, result selection, feature
state, favorite toggling, sheet heights, light/dark configuration changes, deep-link
handling/restoration and location follow/heading. They write screenshots to the
app's external `files/shots/`. Theme tests restore the app's system-theme behavior
in `finally`, using `MODE_NIGHT_AUTO` (Android maps this to an undefined package
night override). They do not change the device-wide theme. Foreground location
permissions are granted only to studev.

```powershell
& $adb -s $device pull /sdcard/Android/data/top.hicancan.studev/files/shots D:\Temp\claude-wsl\agents\app-map\shots\$device
```

Screenshots: `map-light`, `map-dark`, `map-3d`, `search-jiao3`, `search-library`,
`place-jiao3`, `place-jiao3-half`, `place-jiao3-expanded`, `deep-link-restored`,
`location-heading` (PNG). Unit tests decode the actual bundled release and verify
strict field handling, field round trips and native style URL binding.

The source build rejects duplicate place IDs. Parking and amenity names are
stable curated campus identities shared by search, map features and share URLs.
Place sheets show purpose, today's opening state and an expandable full week;
unpublished hours are hidden. Internal release IDs are not shown.
Rooms navigate to the packaged building endpoint, and standalone services use
their packaged position endpoint with the same native 100 m snap limit.
The native search currently returns the exact building for `教3`; a room is found
by its room name, for example `教3-101`. Both result groups are rendered when the
kernel returns both kinds.

Release signing stays outside the repository. `npm run release:apk` supplies the
keystore path, alias and password from `D:\personal-config\secrets`; debug uses
Android's default debug signing. A direct `assembleRelease` without the signing
properties produces only a debug-signed, R8-minified verification APK. Never
publish that verification build as a signed production update. Never put signing
material or credentials here.

For local data testing, run `node android/tools/data-fixture.mjs` from the root.
It serves the digested `public/data/<version>/` plus the
unchanged `src/data/campus-release.json` at `/data/release.json`. Build debug with
`'-Pstudev.dataHost=http://127.0.0.1:18764'` and use
`adb -s <serial> reverse tcp:18764 tcp:18764`. Only the debug manifest permits HTTP;
release always uses `https://studev.hicancan.top`. The standalone manifest is
optional; production discovery still reads the site's embedded release contract.
Remove the reverse forwarding after testing. `-Pstudev.bundleAllData=true` is a
diagnostic size baseline; normal builds always use the minimal bundle.

`WidgetDataTest` checks current-version missing-asset downloads, cross-reader
offline use, release isolation, unsafe paths, invalid download rejection, the
dorm picker, real native walking time and the existing launcher widget in both
themes. Add `-e localData true` for actual HTTP/activation against the fixture server,
including an update with separate caches and a rejected incomplete release.
The launcher case requires an existing widget, uses published events with a fixed
display clock for state screenshots, and restores preferences.
It never changes the phone's system theme or GPS. Shots go to the app's external
`files/widget-shots/`. The compact case pins one instance when missing and reuses
it thereafter. It captures `launcher-4x1-light` and `launcher-4x1-dark`; the EMUI
host can reserve two rows around the compact card, as noted above.

Verified for widget/APK work on 2026-10-30: `testDebugUnitTest` passes 43 tests;
`WidgetDataTest` passes all 7 cases on Huawei `26QUT24227005105`, including local
HTTP update/rollback checks. The compact pin/render case also passes on
`emulator-5554`, where the launcher allocates one row. `lint` and
`assembleRelease` pass. The debug-signed release cold-launches on the Huawei,
reads the cached class, renders the native map and routes, and refreshes both
widgets through WorkManager after a theme change. The phone returns to the
system theme; no device theme or GPS settings are changed.

With the rebuilt space data, the full-data debug baseline is 160,845,182 bytes
(153.39 MiB), the minimal debug APK 56,830,109 bytes (54.20 MiB), and the minified
the arm64-only minified release is expected below 24 MiB (the previous dual-ABI
release was 35,203,943 bytes / 33.57 MiB). The APK contains 19 data entries, about
3.5 MiB compressed, rather than class, room-day or content-search shards.
The selected published route from 荷苑48栋 to 教4-208 is 1,318.6 m / 1,054.88 s,
displayed as 18 minutes; an 08:00 lesson therefore gives 07:39 departure with
the three-minute buffer.

`PresentationTest#homeAndFacts` captures morning/lunch home, canteen category,
search, teaching/library details, the full week, 3D and dark mode.
`PresentationTest#phoneHomeAndPlanner` keeps the phone's real provider position
and captures the same home states plus walk/bike planning. Only the app's theme
override changes, and tests restore its system-theme behavior in `finally`.
`PresentationTest#continuousDemo` is opt-in (`-e demo true`); it runs one
continuous home/search/planner/simulated-walk/detour/reroute/arrival flow and
writes `demo-ready.txt`, `demo-timeline.txt`, `demo-done.txt` for external recording.
Simulation is labelled in the app and is not evidence of real GPS accuracy.
