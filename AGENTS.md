# studev

studev is one product with two clients. The web client (`src/`) is the
student-development-center portal and the complete campus-services site. The
Android client (`android/`) is a native app for the same campus services.

## Model and architecture

The shared campus model has five kinds: **space**, **time**, **event**,
**agent**, and **information**. It has six relations: **contains**,
**connects**, **occurs-in**, **participates**, **prescribes**, and **refers-to**.
Validity describes when an entity, relation, or fact applies, including the
difference between unknown and absent. `njupt-data` computes campus facts; clients
render and interact with them. Generic search and routing belong in `wasm-search`
and `wayfind`.

The logical model is complete while physical encoding stays minimal: encode
rules rather than enumerations, fields rather than edge tables, and defaults
rather than repetition. The system is read-heavy and write-light. Devices and
the edge handle reads and writes; there is no resident application server.
Each concern has one mechanism. There are no compatibility readers, redirects,
legacy routes, or duplicate paths: delete obsolete code and let Git preserve
history. Migrate stored data before deleting its reader. Branches contain code;
tests exercise real released data through the same mechanisms used in production.
Do not create application branches or alternate implementations for test fixtures.
Clients read one current contract; contract changes update both clients together.
Shared answers belong in data or generic kernels, never in two client implementations.

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
  groups tooling by data, APK, server, platform, collection, and private storage.
  `product.json` owns product and release metadata for both clients and tooling.
  `src/download/` owns the browser's manifest and streaming APK download.
  `android/tooling/` contains Android-only
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
npm run audit:unused
npm run build
cd android
.\gradlew.bat assembleDebug testDebugUnitTest lint
```

`main` is production and deploys the web site. Work on a branch and merge only
after review. Release signing material and private configuration live outside
the repository. `npm run release:apk` builds and signs the Android release and
uploads its archive to GitHub Releases; deployment materializes that archive
on the site. Android opens `/download/` in a browser for application updates.
Use `astro dev --background` for development (`astro dev stop|status|logs`).
