# studev Android

The Android client has four destinations: 首页 / 课表 / 地图 / 我的. The campus
home brings together the next lesson, today's remaining lessons and upcoming
exams. Exams live beside the timetable; free rooms and full-text search open
from home. The map keeps its own time-of-day place home sheet, place search, planning and live navigation. Account and campus activities open from 我的 through the single root ActivityHost.

## Native campus queries and device features

`campus/` contains the product shell and query screens. `data/AcademicFacts.kt`
reads the same raw teaching, exam and room shards as the web. Teaching weeks and
all displayed dates use Asia/Shanghai, including on phones set to other time zones.
The persisted class is shared by home, timetable, exams, calendar and reminders.
The week grid and day list open the same course detail; a published room opens
the existing planner through `NavigationRuntime.open(Place)`. Home uses the
public wayfind binding for walking minutes; it never estimates straight-line time.

`AcademicRepository` reads an immutable release per reader. The APK includes the
digested release, including content-search shards, plus `data/release.json`.
Academic files are opened only when needed: class shards, the selected room day,
and wasm-search's requested posting/content chunks. Remote shards are cached in
`files/campus/<version>/` with atomic file replacement. Remote readers never mix
in a different version's assets. Startup opens local data first, then checks the
web campus island's module and its constants module for the embedded release
contract. There is no published standalone `latest.json` endpoint in this repo.
A release is activated only after its indexes and selected class can be read.
An older deployed schema is rejected; the packaged current schema stays usable.
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

`widget/` is a Glance next-lesson widget using the same generated design palette.
It displays the next class and room, with walking time explicitly labelled as
coming from the last known position; that value expires after 30 minutes. Without
a recent position it asks the user to open the app. It never starts background GPS.
Add it from 我的 or the launcher's widget picker.

`me/AppUpdates.kt` finds the latest stable GitHub release containing an APK, downloads
through DownloadManager, reads the APK manifest, and compares its actual versionCode
and package name before handing it to the system installer. Signing is verified
by Android. Unknown-source access is requested only from the explicit continue
button. An empty release list and unavailable checks produce no startup prompts.

Deep links cover `/map/`, `/search/`, `/search/timetable/`, `/search/exam/`,
`/search/classrooms/` and `/search/web/` (including community/materials search).
Class, timetable week, search query, room building/date/period and campus parameters
open the corresponding native screen. The map's existing `place` link still works;
`route=true` also opens its planner, used by reminders and widgets.

Campus validation uses **studev-2**, serial **emulator-5556**; do not operate on
another agent's emulator. After preparing inputs and building, from the repository root:

```powershell
$adb = 'D:\Dev\Android\Sdk\platform-tools\adb.exe'
& $adb -s emulator-5556 install -r android/app/build/outputs/apk/debug/app-debug.apk
& $adb -s emulator-5556 install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
& $adb -s emulator-5556 emu geo fix 118.9255 32.1150
& $adb -s emulator-5556 shell am instrument -w -e class top.hicancan.studev.CampusTabsTest top.hicancan.studev.test/androidx.test.runner.AndroidJUnitRunner
& $adb -s emulator-5556 pull /sdcard/Android/data/top.hicancan.studev/files/campus-shots D:\Temp\claude-wsl\agents\app-campus\shots\
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

The live site currently exposes an older release schema, so a live current-format
data upgrade cannot yet be exercised. APK upgrade installation also awaits the
first release with an APK asset. Neither condition blocks the bundled offline
query features, local calendar, reminders or widget.

## Build

Use PowerShell 7, JDK 21 and the Windows SDK. All environment overrides below
apply only to this process. Compile platform is `android-37.0`, target SDK 36,
minimum SDK 26. MapLibre is `android-sdk-opengl:13.7.1` on every device.
The native kernels currently ship `arm64-v8a` and `x86_64`.

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

Release signing stays outside the repository. Pass
`-Pstudev.keystore=<external-path> -Pstudev.keyAlias=<alias>
-Pstudev.storePassword=<password>` to `assembleRelease`; debug uses Android's
default debug signing. Never put signing material or credentials here.

`PresentationTest#homeAndFacts` captures morning/lunch home, canteen category,
search, teaching/library details, the full week, 3D and dark mode.
`PresentationTest#phoneHomeAndPlanner` keeps the phone's real provider position
and captures the same home states plus walk/bike planning. Only the app's theme
override changes, and tests restore its system-theme behavior in `finally`.
`PresentationTest#continuousDemo` is opt-in (`-e demo true`); it runs one
continuous home/search/planner/simulated-walk/detour/reroute/arrival flow and
writes `demo-ready.txt`, `demo-timeline.txt`, `demo-done.txt` for external recording.
Simulation is labelled in the app and is not evidence of real GPS accuracy.
