# studev Android

The Android client currently ships the map destination. Search is a full-screen
route above the same live map; a bottom bar will appear when another product
destination exists. No sample data or placeholder destinations ship.

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
values; dynamic color is disabled. It also copies the latest shared campus release
from `public/data/<version>/space/仙林/` into generated APK assets at
`data/space/仙林/`, with the release name in `data/version.txt`. No generated data,
map assets or native binaries belong in Git. Missing fonts/sprites or kernels
produce actionable build errors.

The package's own light/dark styles resolve `{data}` to `asset://data/space/仙林`
and `{assets}` to `asset://map`. Basemap archives use
`pmtiles://asset://data/space/仙林/basemap.pmtiles` and remain uncompressed in the APK
for native byte-range reads. Glyph `{fontstack}` / `{range}` placeholders remain
intact; CJK labels use the system font. No tile server or Google services are needed.

## Structure and behavior

- `data/`: strict kotlinx.serialization models for the actual shared package,
  including optional source identifier `amap`; release loading and DataStore
  recent places / favorites.
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
The via label is the longest named road by accumulated segment length, falling
back to a supplied landmark. Camera bounds use the measured header/sheet insets.
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

The current data release contains repeated IDs for some parking/amenity places.
Those IDs are also used by the web contract, search and share URLs. Unique stable
IDs must be fixed in njupt-data; the Android client does not invent replacements.
The native search currently returns the exact building for `教3`; a room is found
by its room name, for example `教3-101`. Both result groups are rendered when the
kernel returns both kinds.

Release signing stays outside the repository. Pass
`-Pstudev.keystore=<external-path> -Pstudev.keyAlias=<alias>
-Pstudev.storePassword=<password>` to `assembleRelease`; debug uses Android's
default debug signing. Never put signing material or credentials here.
