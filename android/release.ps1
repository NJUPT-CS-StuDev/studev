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
$gradleText = Get-Content (Join-Path $PSScriptRoot 'app\build.gradle.kts') -Raw
$versionName = [regex]::Match($gradleText, 'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$versionCode = [int][regex]::Match($gradleText, 'versionCode\s*=\s*(\d+)').Groups[1].Value
if (-not $versionName -or -not (Test-Path $apk)) { throw 'release APK or version metadata is missing' }
$args = @((Join-Path $repo 'scripts/package-apk.mjs'), '--apk', $apk, '--output', (Join-Path $repo 'public/download'), '--version-name', $versionName, '--version-code', $versionCode, '--min-sdk', '26', '--notes', $Notes)
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
$tempRoot = 'D:\Temp\codex\apk-dist-release'
if (Test-Path $tempRoot) { Remove-Item $tempRoot -Recurse -Force }
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$mirrorLatest = Join-Path $tempRoot 'latest.json'
Set-Content -Path $mirrorLatest -Value (([ordered]@{ format = 1; versionCode = $versionCode; manifestUrl = 'manifest.json' } | ConvertTo-Json) + "`n") -NoNewline
$mirrorManifest = Join-Path $tempRoot 'manifest.json'
Copy-Item $manifestPath $mirrorManifest
$fullApk = Join-Path $tempRoot "studev-$versionName.apk"
Copy-Item $apk $fullApk
$assetPaths = @($mirrorLatest, $mirrorManifest) + @($manifest.parts | ForEach-Object { Join-Path $outputRoot "$versionCode\$($_.name)" }) + $fullApk
$tag = "v$versionName"
$repoName = 'NJUPT-CS-StuDev/studev'
$releaseExists = $true
& gh release view $tag --repo $repoName *> $null
if ($LASTEXITCODE -ne 0) { $releaseExists = $false }
if (-not $releaseExists) {
    $releaseNotes = if ($Notes) { $Notes } else { "studev $versionName" }
    $notesPath = Join-Path $tempRoot 'release-notes.md'
    Set-Content -Path $notesPath -Value $releaseNotes -NoNewline
    & gh release create $tag --repo $repoName --title "studev $versionName" --notes-file $notesPath
    if ($LASTEXITCODE -ne 0) { throw "GitHub release creation failed" }
}
& gh release upload $tag @assetPaths --repo $repoName --clobber
if ($LASTEXITCODE -ne 0) { throw "GitHub release asset upload failed" }
$releaseUrl = (& gh release view $tag --repo $repoName --json url --jq .url).Trim()
Write-Output "release APK: $apk"
Write-Output "release size: $((Get-Item $apk).Length) bytes"
Write-Output "release signature SHA-1: $sha1"
Write-Output "GitHub release: $releaseUrl"
Remove-Item $tempRoot -Recurse -Force
