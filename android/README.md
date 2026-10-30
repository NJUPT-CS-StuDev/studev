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
- `navigation/`: Compose routes, saved place selection, application state. The
  map renderer stays mounted while search is open.
- `map/`: native map lifecycle, camera, 2D/3D controls, feature-state selection,
  persistent Material 3 place sheet with peek, half and expanded detail heights.
- `search/`: native wasm-search session on an IO dispatcher. It loads the packaged
  manifest, documents and lexicon, then follows `begin → posting chunks → prepare
  → content chunks → hydrate`. Native ranking is preserved. Quick categories
  filter the package's places; they do not add facts or ranking.
- `location/`: foreground GPS + network LocationManager engine, rejecting stale
  or significantly less accurate fixes. MapLibre's rotation-vector compass drives
  heading. Locate cycles browse → follow → heading → browse; panning stops follow.

Tapping a result or campus feature opens a sheet and highlights its building,
including a room's parent. Favorites persist in DataStore. Sharing uses the Android
share sheet with `https://studev.hicancan.top/map/?place=<id>`. The same HTTPS URL is
handled on cold and warm launches; domain verification is deliberately deferred
(`autoVerify=false`). Back dismisses search, steps down expanded details, then
closes the selected place. Camera, selection and map mode survive recreation.
Routes are visibly disabled until the routing task; both native kernels are packaged.

Location is optional. The app explains its use before asking, supports approximate
location and denial, and offers system location settings when providers are off.
Only the current Activity's foreground lifecycle subscribes to locations/heading.

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
