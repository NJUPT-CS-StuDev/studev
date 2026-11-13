#requires -Version 7.0
# The three Rust kernels (search, routing, documents) built for Windows from the same release tags package.json pins
# for the web and Android, with their C# bindings, into kernels/: the same code the other clients run.
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
    @{ Path = $SearchPath; Name = 'wasm-search'; Package = 'wasm-search-native'; Library = 'wasm_search_native'; Namespace = 'StuDev.Kernels.Search' },
    @{ Path = $WayfindPath; Name = 'wayfind'; Package = 'wayfind-native'; Library = 'wayfind_native'; Namespace = 'StuDev.Kernels.Wayfind' },
    @{ Path = $DocstreamPath; Name = 'docstream'; Package = 'docstream-native'; Library = 'docstream_native'; Namespace = 'StuDev.Kernels.Docstream' }
)
& 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\Launch-VsDevShell.ps1' -Arch amd64 -HostArch amd64 -SkipAutomaticLocation | Out-Null
# Built afresh: nothing from an earlier kernel stays to be packaged.
Remove-Item -LiteralPath $destination -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $destination 'bindings') | Out-Null
foreach ($kernel in $kernels) {
    $repo = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($kernel.Path)
    $release = [regex]::Match($dependencies.($kernel.Name), '/releases/download/(v[^/]+)/')
    if (-not $release.Success) { throw "Kernel must use an immutable release: $($kernel.Name)" }
    $tag = $release.Groups[1].Value
    $expected = (& git -C $repo rev-parse "$tag^{commit}").Trim()
    if ($LASTEXITCODE -ne 0) { throw "Missing kernel release $tag in $repo" }
    $actual = (& git -C $repo rev-parse HEAD).Trim()
    if ($actual -ne $expected -or (& git -C $repo status --porcelain --untracked-files=no)) { throw "Kernel checkout must be clean at $tag before building: $repo" }
    Push-Location $repo
    try {
        & cargo build --locked --release --package $kernel.Package --target x86_64-pc-windows-msvc
        if ($LASTEXITCODE -ne 0) { throw "Windows kernel build failed: $repo" }
        $dll = Join-Path $repo "target\x86_64-pc-windows-msvc\release\$($kernel.Library).dll"
        $config = Join-Path $destination "$($kernel.Library).toml"
        Set-Content -LiteralPath $config -Value "[bindings.csharp]`nnamespace = `"$($kernel.Namespace)`"`ncdylib_name = `"$($kernel.Library)`"`n"
        & uniffi-bindgen-cs --library $dll --config $config --out-dir (Join-Path $destination 'bindings') --no-format
        if ($LASTEXITCODE -ne 0) { throw "C# binding generation failed: $repo" }
        Copy-Item -LiteralPath $dll -Destination $destination -Force
    } finally { Pop-Location }
}
Write-Host "The Windows kernels and their C# bindings are ready in $destination"
