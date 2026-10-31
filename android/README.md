# studev Android

The native client provides campus services: 首页 / 课表 / 地图 / 我的.
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
.\gradlew.bat assembleDebug testDebugUnitTest lint assembleDebugAndroidTest
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

From the repository root, `npm run release:apk` builds, signs and packages the
APK into a manifest and parts no larger than the configured part limit, then
uploads the full APK and distribution files to GitHub Releases. Signing keys
and credentials stay in external private storage. A direct `assembleRelease`
without signing properties creates a debug-signed verification build; it is
not a distributable production update. Increase versionCode for each release
and retain the signing certificate. Deployment fetches the archive into the
site. 我的 → 下载新版本 opens `/download/` in the browser. The browser owns the
APK download and installation; the app has no APK downloader, installer hand-off,
or package-install permission.

## Data and feature ownership

Packages under `top.hicancan.studev` name their feature: `campus` owns the product
shell, `activities` owns campus activities, `account` owns account screens,
`data` owns release readers and models, and `map`, `navigation`, `location`,
`search`, `timetable`, `exams`, `rooms`, `me`, `calendar`, `reminders` and `widget`
own their respective service or device integration. `ui/theme` owns shared
Compose styling. `android/tooling` contains test data hosting and GPS replay.

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
The map's current `place` parameter selects a place; `route=true` opens the
planner and is used by reminders and widgets. Class, week, search query,
building, date, period and campus parameters select their corresponding screens.
Sharing and cold/warm launches use the same URLs. Back dismisses overlays and
map selections before returning to the root tab.

`calendar` writes only the dedicated local studev calendar. Stable event IDs
allow resync to update events in place and remove obsolete rows. Disabling sync
removes only that calendar. `reminders` maintains a rolling device schedule and
uses AlarmManager where allowed, with WorkManager when exact access is absent.
Stable notification IDs prevent duplicate delivery. Permissions are requested
at the point of use. No server push or Google services are required.

Widgets show current and upcoming lessons and exams. A selected home dorm and
wayfind provide departure time; there is no straight-line travel estimate.
Boundary work and periodic maintenance refresh the widget without background
GPS. The compact widget declares 4×1; OEM launchers can reserve extra space.

Navigation uses one process session and shared GPS/network source. The planner
supports walking/cycling, endpoint search, swapping and stair avoidance. Route
alternatives, maneuvers, matching, rerouting and arrival come from wayfind.
Live navigation uses a foreground service, notification, wake lock and Chinese
TTS. Exit stops the session; a killed process does not restart a stale trip.

## Device verification

Always use `adb -s`. Change only studev on the owner's phone; never fake its
GPS or alter device-wide settings. The integrated emulator is `njupt-nav`.

```powershell
$adb = 'D:\Dev\Android\Sdk\platform-tools\adb.exe'
$device = 'emulator-5554' # or the explicitly identified owner's phone
& $adb -s $device install -r android/app/build/outputs/apk/debug/app-debug.apk
& $adb -s $device install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
& $adb -s emulator-5554 emu geo fix 118.9255 32.1150 # emulator only
& $adb -s $device shell am instrument -w -e class top.hicancan.studev.IntegrationSmokeTest top.hicancan.studev.test/androidx.test.runner.AndroidJUnitRunner
```

`MapSmokeTest`, `CampusTabsTest` and `NavigationTest` exercise actual native data
and kernels. `IntegrationSmokeTest` checks tab/back behavior, account/activity
overlays, deep links, opening hours and rendered routes. Screenshots are saved
inside the app's external files directory. Tests restore app theme preferences;
they do not change device-wide theme. Keep evidence under `D:\Temp\codex/<task>`.

Debug-only navigation simulation drives the actual Navigator and map layer; it
never registers a mock GPS provider. Export a route from the planner and replay
it through the emulator with `pwsh android/tooling/replay.ps1 -Device emulator-5554`.
The script rejects phone serials. Simulation is not evidence of real GPS accuracy.

For local data tests, run `node android/tooling/data-fixture.mjs`. It serves the
real digested shards and exposes the selected release through a campus page and
constants module, exactly as production discovery does. Build debug with
`'-Pstudev.dataHost=http://127.0.0.1:18764'` and use
`adb -s <serial> reverse tcp:18764 tcp:18764`. Only debug permits HTTP.
`WidgetDataTest` with `-e localData true` verifies activation, cache isolation
and incomplete-release rejection. Remove reverse forwarding after testing.
`-Pstudev.bundleAllData=true` measures the full-data APK size; normal builds use
the minimal bundle. No production release or data is changed by these fixtures.
