# One release of StuDev: the Android APK and the Windows app, both of the version in product.json, put on the download
# store and on a GitHub release; publishing the release deploys the site that links to them.
param(
    [string]$Notes = '',
    [string[]]$GradleArgs = @()
)
$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = 'D:\Dev\java\jdk-21.0.13+9'
$env:ANDROID_HOME = 'D:\Dev\Android\Sdk'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$android = Join-Path $repo 'android'
$gradle = Join-Path $android 'gradlew.bat'
$privateModule = 'D:\personal-config\secrets\secrets.psm1'
Import-Module $privateModule
$keystore = 'D:\personal-config\secrets\projects\studev\android-release.p12'
$alias = 'studev'
$storePassword = [string](Get-Secret local.studev_android.store_password)
if (-not (Test-Path $keystore)) { throw "release keystore is missing: $keystore" }
$signingArgs = @("-Pstudev.keystore=$keystore", "-Pstudev.keyAlias=$alias", "-Pstudev.storePassword=$storePassword")
Push-Location $android
try { & $gradle assembleRelease @signingArgs @GradleArgs; $gradleExitCode = $LASTEXITCODE } finally { Pop-Location }
if ($gradleExitCode -ne 0) { throw "assembleRelease failed" }
$apk = Join-Path $android 'app\build\outputs\apk\release\app-release.apk'
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
$apksigner = Join-Path $env:ANDROID_HOME 'build-tools\36.1.0\apksigner.bat'
if (-not (Test-Path $apksigner)) { throw "apksigner is missing: $apksigner" }
$certificateOutput = (& $apksigner verify --print-certs $apk 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed' }
$sha1Match = [regex]::Match($certificateOutput, '(?im)SHA-1 digest:\s*([0-9A-F:]+)')
if (-not $sha1Match.Success) { throw 'APK signature SHA-1 was not reported' }
$sha1 = ($sha1Match.Groups[1].Value -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
if ($sha1.Length -eq 40) { $sha1 = ($sha1 -split '(?<=\G..)(?=.)') -join ':' }
if (-not $sha1.StartsWith('C1:02:6E:54')) { throw "unexpected release certificate SHA-1 prefix: $sha1" }

$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([char[]]'\/')
$tempRoot = Join-Path $tempBase ("studev-apk-release-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$fullApk = Join-Path $tempRoot "studev-$versionName.apk"
Copy-Item $apk $fullApk
$env:OSCA_DOWNLOAD_ENDPOINT = Get-Secret local.osca_download.endpoint
$env:OSCA_DOWNLOAD_BUCKET = Get-Secret local.osca_download.bucket
$env:OSCA_DOWNLOAD_ACCESS_KEY = Get-Secret local.osca_download.access_key
$env:OSCA_DOWNLOAD_SECRET_KEY = Get-Secret local.osca_download.secret_key
& node (Join-Path $repo 'scripts/release/put.mjs') $fullApk "studev-$versionName.apk"
if ($LASTEXITCODE -ne 0) { throw 'APK upload failed' }

# The Windows app: the kernels from their pinned tags, the parity checks, a NativeAOT build, and a Velopack release whose
# portable zip, packages and feed go to windows/ on the download store, where /download/windows/ serves them and unzipped
# copies update themselves. Only the portable zip is offered: unzip and run, nothing to install.
$env:DOTNET_ROOT = 'D:\Dev\dotnet'
$env:Path = "D:\Dev\dotnet;$env:USERPROFILE\.dotnet\tools;$env:Path"
$windows = Join-Path $repo 'windows'
& pwsh -NoProfile -File (Join-Path $windows 'kernels.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Windows kernels failed' }
& dotnet run --project (Join-Path $windows 'Tests') -c Release
if ($LASTEXITCODE -ne 0) { throw 'Windows parity checks failed' }
$publish = Join-Path $tempRoot 'windows-publish'
& dotnet publish (Join-Path $windows 'StuDev') -c Release -r win-x64 -p:DebugType=none -p:Version=$versionName -o $publish
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' }
$velopack = Join-Path $tempRoot 'windows-releases'
New-Item -ItemType Directory -Path $velopack -Force | Out-Null
$feed = "$($product.origin)/download/windows"
# The releases already out, so the new one carries a delta from the last; none yet before the first.
$known = try { Invoke-WebRequest "$feed/releases.win.json" -Method Head -MaximumRedirection 5 -ErrorAction Stop; $true } catch { if ($_.Exception.Response.StatusCode.value__ -eq 404) { $false } else { throw } }
if ($known) { & vpk download http --url $feed --outputDir $velopack; if ($LASTEXITCODE -ne 0) { throw 'Earlier Windows releases could not be read' } }
& vpk pack --packId top.hicancan.studev --packVersion $versionName --packDir $publish --mainExe StuDev.exe --packTitle StuDev --packAuthors 'NJUPT StuDev' `
    --icon (Join-Path $windows 'StuDev\Assets\StuDev.ico') --shortcuts 'Desktop,StartMenuRoot' --outputDir $velopack
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed' }
$portable = Join-Path $velopack 'top.hicancan.studev-win-Portable.zip'
if (-not (Test-Path -LiteralPath $portable)) { throw "Windows portable zip is missing: $portable" }
# Packages first, the feed last: an installed copy never reads a feed naming a package not yet there.
$made = Get-ChildItem $velopack -File | Where-Object { $_.Extension -in '.nupkg', '.zip' -and $_.LastWriteTime -gt (Get-Item $publish).LastWriteTime.AddMinutes(-1) }
foreach ($file in $made) { & node (Join-Path $repo 'scripts/release/put.mjs') $file.FullName "windows/$($file.Name)"; if ($LASTEXITCODE -ne 0) { throw "Windows upload failed: $($file.Name)" } }
& node (Join-Path $repo 'scripts/release/put.mjs') (Join-Path $velopack 'releases.win.json') 'windows/releases.win.json'
if ($LASTEXITCODE -ne 0) { throw 'Windows feed upload failed' }
$fullPortable = Join-Path $tempRoot "studev-$versionName-windows.zip"
Copy-Item $portable $fullPortable

$releaseNotes = if ($Notes) { $Notes } else { "studev $versionName" }
$assetPaths = @($fullApk, $fullPortable)
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
# Publish only once the asset exists; the published event deploys the website.
& gh release edit $tag --repo $repoName --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'GitHub release publication failed' }
$releaseUrl = (& gh release view $tag --repo $repoName --json url --jq .url).Trim()
Write-Output "release APK: $apk"
Write-Output "release size: $((Get-Item $apk).Length) bytes"
Write-Output "release signature SHA-1: $sha1"
Write-Output "Windows portable: $feed/top.hicancan.studev-win-Portable.zip"
Write-Output "GitHub release: $releaseUrl"
$resolvedTemp = (Resolve-Path -LiteralPath $tempRoot).Path
if (-not $resolvedTemp.StartsWith($tempBase + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe temporary directory: $resolvedTemp" }
Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
