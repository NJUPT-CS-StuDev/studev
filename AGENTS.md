# studev

studev is one product with two clients. The web client (`src/`) is the
student-development-center portal and the complete campus-services site. The
Android client (`android/`) is a native app for the same campus services.

## Model and architecture

The shared campus model has five kinds: **space**, **time**, **event**,
**agent**, and **information**. It has six relations: **contains**,
**connects**, **occurs-in**, **participates**, **prescribes**, and **refers-to**.
Every fact carries validity: its source, effective interval, and publication
state are part of the contract. `njupt-data` computes campus facts; clients
render and interact with them. Generic search and routing belong in `wasm-search`
and `wayfind`.

The logical model is complete while physical encoding stays minimal: encode
rules rather than enumerations, fields rather than edge tables, and defaults
rather than repetition. The system is read-heavy and write-light. Devices and
the edge handle reads and writes; there is no resident application server.
Each concern has one mechanism. There are no compatibility readers, redirects,
legacy routes, or duplicate paths: delete obsolete code and let Git preserve
history. Code branches contain code changes; real data is migrated separately.

## Directories

- `src/campus/` is the web campus client. Campus services live under their
  service directory, including `src/campus/activities/`.
- `src/client/` contains browser code grouped by owner: `site/`, `platform/`,
  and the legacy `collection/` surface.
- `src/markdown/` contains Markdown/HTML transforms; `src/astro/` contains
  Astro integrations and build-time browser helpers.
- `android/app/src/main/java/top/hicancan/studev/` is grouped by feature;
  package names are plural feature names where the feature is a collection.
- `design/` is the shared visual language. `scripts/` at the repository root
  contains build and release tooling. `android/tooling/` contains Android-only
  test and replay tools. Generated data, assets, and native binaries stay
  outside version control.

## Release and verification

Use PowerShell 7 with JDK 21 at `D:\Dev\java\jdk-21.0.13+9` and
`ANDROID_HOME=D:\Dev\Android\Sdk` for Android commands.

```powershell
npm ci
npm run digest
pwsh android/kernels.ps1
npm run typecheck
npm run test:campus
npm run test:platform
npm run test:collection
npm run test:apk
npm run build
cd android
.\gradlew.bat assembleDebug testDebugUnitTest lint
```

`main` is production and deploys the web site. Work on a branch and merge only
after review. Release signing material and private configuration live outside
the repository.
