# StuDev Android

Standalone Compose client. The map uses bundled campus GeoJSON, local CJK fonts,
and bundled Open Sans glyphs; no remote basemap or Google Play services.
MapLibre 13.7.1 uses the OpenGL ES artifact on every device; the Vulkan build
failed to render labels and the location marker on the tested Huawei ADA-AL00.
Compile platform: `platforms;android-37.0` (Compose BOM 2026.09.00 requires API 37).
Target SDK remains 36; minimum SDK is 26. Build Tools: 36.1.0.

From `android/`, run in **PowerShell 7**. Use a child shell to scope JDK 21 to
the Gradle process:

```powershell
pwsh -NoProfile -Command '$env:JAVA_HOME="D:\Dev\java\jdk-21.0.13+9"; $env:ANDROID_HOME="D:\Dev\Android\Sdk"; .\gradlew.bat assembleDebug'
```

Start `njupt-nav` if `adb devices` has no connected emulator, then install and run:

```powershell
& 'D:\Dev\Android\Sdk\emulator\emulator.exe' -avd njupt-nav -gpu host
# In another PowerShell:
$adb = 'D:\Dev\Android\Sdk\platform-tools\adb.exe'
& $adb -s emulator-5554 install -r .\app\build\outputs\apk\debug\app-debug.apk
& $adb -s emulator-5554 emu geo fix 118.9255 32.1150
& $adb -s emulator-5554 shell am start -n top.hicancan.studev/.MainActivity
```

Tap the location button, read the rationale, and allow foreground location.
Approximate location and denial both leave the map usable. The location button
opens system location settings if providers are disabled. Pan, pinch, or use
the zoom buttons. Camera state survives activity recreation and process restore.

Debug uses the default debug keystore. For release signing pass
`-Pstudev.keystore=<absolute-external-path> -Pstudev.keyAlias=<alias>
-Pstudev.storePassword=<password>` to `assembleRelease`. The key password equals
the store password. Never save credentials or the keystore in this repository.

`campus-sample.geojson` is the supplied development data snapshot, not the final
versioned release contract. Replace it through the shared digest integration
when that is available; do not derive campus facts in the client.

Bundled glyphs: MapLibre demo font assets, Open Sans Semibold (SIL OFL; license
alongside the glyph files). CJK ideographs render from Android's system fonts.
