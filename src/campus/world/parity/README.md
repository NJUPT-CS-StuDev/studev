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
./node_modules/.bin/esbuild src/campus/world/parity/generate.ts --bundle --platform=node --format=esm --packages=external --alias:@=./src/campus --outfile=D:/Temp/codex/parity/generate.mjs
node D:/Temp/claude-wsl/parity/generate.mjs
npm run test:campus
npm run typecheck
npm run build
$env:JAVA_HOME = 'D:\Dev\java\jdk-21.0.13+9'
$env:ANDROID_HOME = 'D:\Dev\Android\Sdk'
./android/gradlew.bat -p android testDebugUnitTest
```
