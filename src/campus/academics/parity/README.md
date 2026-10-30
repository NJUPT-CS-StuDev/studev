# Academic view parity

[`spec.json`](spec.json) is the shared display contract. [`golden.json`](golden.json)
freezes real packaged inputs and the production web implementation's expected
outputs. Vitest and Kotlin's `ParityTest` read the same file; neither rewrites it.

The fixture contains B240402, B250105 and B230402 at weeks 1, 3, 8, 9, 10 and 16:
211 cells across 18 class/week combinations, 21 exam boundary cases and 76 room
queries comparing exact matching/free room IDs. Supplemental synthetic strings
exercise Unicode identity, invalid times and retaining hidden-building choices.
They are separate from the real campus inputs and never enter the data package.

The frozen release is `local-202610301827-facts`, with its input SHA-256 in
`golden.source.inputsHash`. In this release Linux编程 at B240402, Wednesday
periods 8–9, **does include week 9**. Both clients therefore display it active.
The real suspension example is 计算机通信与网络（混合式）, Thursday periods 8–9,
week 3; B250105 supplies both same-course parallel and different-course overlap
examples. The suspension heuristic is a display hint, not source evidence of a
cancelled or replaced lesson.

Regenerate deliberately, after preparing the package with `npm run digest`, and
review the fixture diff:

```powershell
./node_modules/.bin/esbuild src/campus/academics/parity/generate.ts --bundle --platform=node --format=esm --packages=external --alias:@=./src/campus --outfile=D:/Temp/codex/parity/generate.mjs
node D:/Temp/codex/parity/generate.mjs
npm run test:campus
npm run typecheck
npm run build
$env:JAVA_HOME = 'D:\Dev\java\jdk-21.0.13+9'
$env:ANDROID_HOME = 'D:\Dev\Android\Sdk'
./android/gradlew.bat -p android assembleDebug testDebugUnitTest assembleDebugAndroidTest lint
```

Run digest/build before Android packaging, since digest replaces its generated
data directory. The Android unit test locates the fixture by walking up from the
Gradle working directory; it does not embed a developer-specific absolute path.

For browser interaction, DOM/column checks and phone-width screenshots of the
production build:

```powershell
npm run preview -- --background --host 127.0.0.1 --port 4325
node src/campus/academics/parity/capture.mjs http://127.0.0.1:4325 D:/Temp/claude-wsl/agents/parity/shots
node src/campus/academics/parity/compare.mjs D:/Temp/claude-wsl/agents/parity/shots
```

Puppeteer may need `PUPPETEER_EXECUTABLE_PATH` set for the single process when
the installed browser differs from the package's pinned browser. Captures use
a fresh profile, 412 CSS px, both themes, the same class/week and the same room
date/period/selection. The browser assertions compare all 17 B240402 week-9
cells, both B250105 overlap days, all 14 published exams and all matching/free
room IDs. 教3 + 教4 on 2026-10-30 period 3 yields **25 / 96** in both clients.

`ParityViewsTest` runs the native feature screens against the actual bundled
package in both themes, checks that cards stay within their day/conflict
columns and checks multi-building choice persistence. It uses an empty Compose
test Activity, so it also runs before the independent map shell lifecycle fix.

`ParityScreensTest` captures the complete native product shell. On the task's
6e42ec0 base, ActivityScenario teardown can time out waiting for MainActivity to
be destroyed; this is in the integration-owned map Activity lifecycle. Its
`app-assertions-<theme>.json` marker is written only after all feature assertions
and screenshots complete, before teardown. Keep this distinction when reporting
instrumentation results. For cold per-theme captures on that base, force-stop
only studev, run `ParityThemeTest` with `-e theme light` (or `dark`), then run
`ParityScreensTest` with the same argument. Restore the app's theme by running
`ParityThemeTest` without that argument. Every adb command must use
`-s emulator-5556`; pull the app's external `files/parity-shots/` into the chosen
screenshot directory. No MainActivity, manifest, widget or download changes are
needed by this feature work.

Verified on emulator-5556 with the task's base: 207 web tests, typecheck, the
45-page production build, and `assembleDebug testDebugUnitTest
assembleDebugAndroidTest lint` (44 unit tests) passed. `ParityViewsTest` passed in
both themes in one run. Browser DOM/interaction checks passed with no page
errors, the captured native cell JSON exactly matched all 17 web week-9 cells,
and both full-shell screenshot runs reached their feature-assertions marker.
The latter runs then failed only at the ActivityScenario teardown described
above. Sixteen side-by-side comparison PNGs cover week/day, exams, rooms,
building dropdown, suspension, parallel arrangements and time overlap; original
screenshots and JSON reports are retained in the same output directory.
