param(
    [string]$PartSize = '',
    [string]$Notes = '',
    [string[]]$GradleArgs = @()
)
$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = 'D:\Dev\java\jdk-21.0.13+9'
$env:ANDROID_HOME = 'D:\Dev\Android\Sdk'
$gradle = Join-Path $PSScriptRoot 'gradlew.bat'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$privateModule = 'D:\personal-config\secrets\secrets.psm1'
Import-Module $privateModule
$keystore = 'D:\personal-config\secrets\projects\studev\android-release.p12'
$alias = 'studev'
$storePassword = [string](Get-Secret local.studev_android.store_password)
if (-not (Test-Path $keystore)) { throw "release keystore is missing: $keystore" }
$signingArgs = @("-Pstudev.keystore=$keystore", "-Pstudev.keyAlias=$alias", "-Pstudev.storePassword=$storePassword")
Push-Location $PSScriptRoot
try { & $gradle assembleRelease @signingArgs @GradleArgs; $gradleExitCode = $LASTEXITCODE } finally { Pop-Location }
if ($gradleExitCode -ne 0) { throw "assembleRelease failed" }
$apk = Join-Path $PSScriptRoot 'app\build\outputs\apk\release\app-release.apk'
$product = Get-Content (Join-Path $repo 'product.json') -Raw | ConvertFrom-Json
$versionName = $product.android.versionName
$versionCode = [int]$product.android.versionCode
if (-not $versionName -or -not (Test-Path $apk)) { throw 'release APK or version metadata is missing' }
$aapt = Join-Path $env:ANDROID_HOME 'build-tools/36.1.0/aapt.exe'
if (-not (Test-Path -LiteralPath $aapt)) { throw "aapt is missing: $aapt" }
$badging = (& $aapt dump badging $apk 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Could not read release APK metadata' }
$package = [regex]::Match($badging, "package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'")
$sdk = [regex]::Match($badging, "(?m)^sdkVersion:'(\d+)'")
if (-not $package.Success -or $package.Groups[1].Value -ne 'top.hicancan.studev' -or
    [int]$package.Groups[2].Value -ne $versionCode -or $package.Groups[3].Value -ne $versionName -or
    -not $sdk.Success -or [int]$sdk.Groups[1].Value -ne [int]$product.android.minSdk) {
    throw "Release APK metadata disagrees with product.json; refusing to package or publish: $($package.Value), $($sdk.Value)"
}
$releaseNotes = if ($Notes) { $Notes } else { "studev $versionName" }
$args = @((Join-Path $repo 'scripts/apk/package.mjs'), '--apk', $apk, '--output', (Join-Path $repo 'public/download'), '--version-name', $versionName, '--version-code', $versionCode, '--min-sdk', [string]$product.android.minSdk, '--notes', $releaseNotes)
if ($PartSize) { $args += @('--part-size', $PartSize) }
node @args
if ($LASTEXITCODE -ne 0) { throw 'APK distribution packaging failed' }

$apksigner = Join-Path $env:ANDROID_HOME 'build-tools\36.1.0\apksigner.bat'
if (-not (Test-Path $apksigner)) { throw "apksigner is missing: $apksigner" }
$certificateOutput = (& $apksigner verify --print-certs $apk 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
$sha1Match = [regex]::Match($certificateOutput, '(?im)SHA-1 digest:\s*([0-9A-F:]+)')
if (-not $sha1Match.Success) { throw 'APK signature SHA-1 was not reported' }
$sha1 = ($sha1Match.Groups[1].Value -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
if ($sha1.Length -eq 40) { $sha1 = ($sha1 -split '(?<=\G..)(?=.)') -join ':' }
if (-not $sha1.StartsWith('C1:02:6E:54')) { throw "unexpected release certificate SHA-1 prefix: $sha1" }

$outputRoot = Join-Path $repo 'public\download'
$manifestPath = Join-Path $outputRoot "$versionCode\manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$tempBase = [System.IO.Path]::GetFullPath('D:\Temp\codex')
$tempRoot = Join-Path $tempBase ("studev-apk-release-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$mirrorLatest = Join-Path $tempRoot 'latest.json'
Set-Content -Path $mirrorLatest -Value (([ordered]@{ format = 1; versionCode = $versionCode; manifestUrl = 'manifest.json' } | ConvertTo-Json) + "`n") -NoNewline
$mirrorManifest = Join-Path $tempRoot 'manifest.json'
Copy-Item $manifestPath $mirrorManifest
$fullApk = Join-Path $tempRoot "studev-$versionName.apk"
Copy-Item $apk $fullApk
$assetPaths = @($mirrorLatest, $mirrorManifest) + @($manifest.parts | ForEach-Object { Join-Path $outputRoot "$versionCode\$($_.name)" }) + $fullApk
$tag = "v$versionName"
$repoName = $product.repository
$releaseCommit = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the release commit' }
$existingRelease = & gh release view $tag --repo $repoName --json isDraft 2>$null
if ($LASTEXITCODE -eq 0) {
    if (-not ($existingRelease | ConvertFrom-Json).isDraft) { throw "$tag is already published; increment the Android version before releasing" }
} else {
    $notesPath = Join-Path $tempRoot 'release-notes.md'
    Set-Content -Path $notesPath -Value $releaseNotes -NoNewline
    & gh release create $tag --repo $repoName --target $releaseCommit --draft --title "studev $versionName" --notes-file $notesPath
    if ($LASTEXITCODE -ne 0) { throw "GitHub release creation failed" }
}
& gh release upload $tag @assetPaths --repo $repoName --clobber
if ($LASTEXITCODE -ne 0) { throw "GitHub release asset upload failed" }
# Publish only once every asset exists. The published event deploys the website
# with this release's download manifest and APK parts.
& gh release edit $tag --repo $repoName --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'GitHub release publication failed' }
$releaseUrl = (& gh release view $tag --repo $repoName --json url --jq .url).Trim()
Write-Output "release APK: $apk"
Write-Output "release size: $((Get-Item $apk).Length) bytes"
Write-Output "release signature SHA-1: $sha1"
Write-Output "GitHub release: $releaseUrl"
$resolvedTemp = (Resolve-Path -LiteralPath $tempRoot).Path
if (-not $resolvedTemp.StartsWith($tempBase + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe temporary directory: $resolvedTemp" }
Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
