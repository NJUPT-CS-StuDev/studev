#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$SearchPath = 'D:\code\github\hicancan\wasm-search',
    [string]$WayfindPath = 'D:\code\github\hicancan\wayfind',
    [string]$DocstreamPath = 'D:\code\github\hicancan\docstream'
)
$ErrorActionPreference = 'Stop'
$destination = Join-Path $PSScriptRoot 'kernels'
$dependencies = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '../package.json') -Raw | ConvertFrom-Json).dependencies
$kernels = @(
    @{ Path = $SearchPath; Name = 'wasm-search'; Package = 'wasm-search-android'; Library = 'wasm_search_android' },
    @{ Path = $WayfindPath; Name = 'wayfind'; Package = 'wayfind-android'; Library = 'wayfind_android' },
    @{ Path = $DocstreamPath; Name = 'docstream'; Package = 'docstream-android'; Library = 'docstream_android' }
)
foreach ($kernel in $kernels) {
    $repo = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($kernel.Path)
    $release = [regex]::Match($dependencies.($kernel.Name), '/releases/download/(v[^/]+)/')
    if (-not $release.Success) { throw "Kernel must use an immutable release: $($kernel.Name)" }
    $tag = $release.Groups[1].Value
    $expected = (& git -C $repo rev-parse "$tag^{commit}").Trim()
    if ($LASTEXITCODE -ne 0) { throw "Missing kernel release $tag in $repo" }
    $actual = (& git -C $repo rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $actual -ne $expected -or (& git -C $repo status --porcelain --untracked-files=no)) {
        throw "Kernel checkout must be clean at $tag before building: $repo"
    }
    $script = Join-Path $repo 'android/build.ps1'
    if (-not (Test-Path -LiteralPath $script)) { throw "Native kernel checkout missing: $script" }
    & $script
    if ($LASTEXITCODE -ne 0) { throw "Kernel build failed: $repo ($LASTEXITCODE)" }

    # The repositories also support JVM consumers. Generate Android bindings with
    # the JNA cleaner at our API 26 floor, without modifying either checkout.
    New-Item -ItemType Directory -Force $destination | Out-Null
    $config = Join-Path $destination "$($kernel.Library).toml"
    $baseConfig = (Get-Content -LiteralPath (Join-Path $repo 'android/uniffi.toml') -Raw).Replace('[bindings.kotlin]', '[defaults.bindings.kotlin]')
    Set-Content -LiteralPath $config -Value ($baseConfig + "`nandroid = true`nandroid_cleaner = false`ndisable_java_cleaner = true`n")
    Push-Location $repo
    try {
        & cargo run --locked --release --package $kernel.Package --features bindgen --bin uniffi-bindgen -- generate `
            (Join-Path $repo "android/build/jniLibs/arm64-v8a/lib$($kernel.Library).so") `
            --language kotlin --config $config --out-dir (Join-Path $destination 'kotlin') --no-format
        if ($LASTEXITCODE -ne 0) { throw "Android Kotlin binding generation failed: $repo" }
    } finally { Pop-Location }
    foreach ($abi in @('arm64-v8a', 'x86_64')) {
        $target = Join-Path $destination "jniLibs/$abi"
        New-Item -ItemType Directory -Force $target | Out-Null
        Copy-Item -LiteralPath (Join-Path $repo "android/build/jniLibs/$abi/lib$($kernel.Library).so") -Destination $target -Force
    }
}
Write-Host "The native kernels and their Kotlin bindings are ready in $destination"
