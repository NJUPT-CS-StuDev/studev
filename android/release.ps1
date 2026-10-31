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
Push-Location $PSScriptRoot
try { & $gradle assembleRelease @GradleArgs; $gradleExitCode = $LASTEXITCODE } finally { Pop-Location }
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
Write-Output "release APK: $apk"
