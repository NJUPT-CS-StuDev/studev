#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="${RUNNER_TEMP:-/tmp}/studev-kernels"
rm -rf "$work"
mkdir -p "$work" "$root/android/kernels/jniLibs/arm64-v8a" "$root/android/kernels/jniLibs/x86_64" "$root/android/kernels/kotlin"

if ! command -v cargo-ndk >/dev/null 2>&1; then
  cargo install cargo-ndk --locked
fi

build_kernel() {
  local repo="$1" package="$2" library="$3"
  local release repository tag
  release=$(node -e 'const p=require("./package.json"); const u=new URL(p.dependencies[process.argv[1]]); const m=u.pathname.match(/^\/([^/]+\/[^/]+)\/releases\/download\/(v[^/]+)\//); if(u.hostname!=="github.com"||!m) throw new Error("kernel must use an immutable GitHub release"); process.stdout.write(m[1]+" "+m[2]);' "$repo")
  read -r repository tag <<< "$release"
  git clone --depth 1 --branch "$tag" "https://github.com/${repository}.git" "$work/$repo"
  pushd "$work/$repo" >/dev/null
  cargo ndk -t arm64-v8a -t x86_64 -P 21 -o android/build/jniLibs build \
    --locked --release --package "$package" --lib
  # The same API 26-compatible Android cleaner settings as kernels.ps1.
  sed 's/^\[bindings.kotlin\]/[defaults.bindings.kotlin]/' android/uniffi.toml > "$work/$repo-android.toml"
  printf '\nandroid = true\nandroid_cleaner = false\ndisable_java_cleaner = true\n' >> "$work/$repo-android.toml"
  cargo run --locked --release --package "$package" --features bindgen \
    --bin uniffi-bindgen -- generate "android/build/jniLibs/arm64-v8a/lib${library}.so" \
    --language kotlin --config "$work/$repo-android.toml" --out-dir android/build/kotlin --no-format
  popd >/dev/null

  for abi in arm64-v8a x86_64; do
    cp "$work/$repo/android/build/jniLibs/$abi/lib${library}.so" \
      "$root/android/kernels/jniLibs/$abi/"
  done
  cp -R "$work/$repo/android/build/kotlin/"* "$root/android/kernels/kotlin/"
}

build_kernel wasm-search wasm-search-android wasm_search_android
build_kernel wayfind wayfind-android wayfind_android
build_kernel docstream docstream-android docstream_android
