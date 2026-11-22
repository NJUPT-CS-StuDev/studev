# One release of StuDev: the Android APK and the Windows app, both of the version in product.json, put on the download
# store and on a GitHub release. Pushing main deploys the site that links to them.
param(
    [string]$Notes = '',
    [string[]]$GradleArgs = @(),
    [switch]$Conversations
)
$ErrorActionPreference = 'Stop'

function Wait-PublishedApp([string]$Origin, [string]$Version, [int]$VersionCode) {
    $deadline = [DateTime]::UtcNow.AddMinutes(15)
    $originUrl = $Origin.TrimEnd('/')
    $http = [System.Net.Http.HttpClient]::new()
    $http.Timeout = [TimeSpan]::FromSeconds(15)
    $http.DefaultRequestHeaders.CacheControl = [System.Net.Http.Headers.CacheControlHeaderValue]::Parse('no-cache')
    function Read-Status([string]$Url) {
        $remaining = ($deadline - [DateTime]::UtcNow).TotalSeconds
        if ($remaining -le 0) { return @{ Status = 'timeout'; Content = '' } }
        $cancellation = [System.Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds([Math]::Min(15, $remaining)))
        $response = $null
        try {
            # ResponseContentRead completes after the whole body, so the same
            # cancellation bounds slow bodies as well as connection setup.
            $response = $http.GetAsync($Url, $cancellation.Token).GetAwaiter().GetResult()
            return @{ Status = [int]$response.StatusCode; Content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() }
        } catch {
            return @{ Status = 'unreachable'; Content = '' }
        } finally {
            if ($response) { $response.Dispose() }
            $cancellation.Dispose()
        }
    }
    try {
        do {
            $manifest = Read-Status "$originUrl/app-release.json"
            $publishedVersion = '-'
            $runtime = $null
            if ($manifest.Status -eq 200) {
                try { $runtime = $manifest.Content | ConvertFrom-Json; $publishedVersion = [string]$runtime.android.versionName } catch { $publishedVersion = 'invalid' }
            }
            $roomsStatus = $knowledgeStatus = 'waiting'
            if ($publishedVersion -ceq $Version -and [int]$runtime.android.versionCode -eq $VersionCode) {
                try {
                    $entry = [Uri]$runtime.campus_entry
                    if ($entry.Scheme -ne 'https') { throw 'invalid campus entry' }
                    $snapshot = Read-Status $entry.AbsoluteUri
                    if ($snapshot.Status -eq 200) {
                        $current = $snapshot.Content | ConvertFrom-Json
                        $roomsUrl = [Uri]::new($entry, "$($current.base.TrimEnd('/'))/rooms/index.json")
                        $roomsStatus = (Read-Status $roomsUrl.AbsoluteUri).Status
                        $knowledgeUrl = [Uri]::new($entry, "$($current.knowledge_base.TrimEnd('/'))/knowledge.json")
                        $knowledgeStatus = (Read-Status $knowledgeUrl.AbsoluteUri).Status
                    }
                } catch { $roomsStatus = 'unavailable' }
            }
            Write-Output "site version=$publishedVersion manifest=$($manifest.Status) rooms=$roomsStatus knowledge=$knowledgeStatus"
            if ($publishedVersion -ceq $Version -and [int]$runtime.android.versionCode -eq $VersionCode -and $roomsStatus -eq 200 -and $knowledgeStatus -eq 200) { return }
            $remaining = ($deadline - [DateTime]::UtcNow).TotalSeconds
            if ($remaining -gt 0) { Start-Sleep -Seconds ([Math]::Min(15, $remaining)) }
        } while ([DateTime]::UtcNow -lt $deadline)
        throw "The site did not serve app $Version and a readable campus entry within 15 minutes; the Windows update feed was not published."
    } finally { $http.Dispose() }
}

$env:JAVA_HOME = 'D:\Dev\java\jdk-21.0.13+9'
$env:ANDROID_HOME = 'D:\Dev\Android\Sdk'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$product = Get-Content (Join-Path $repo 'product.json') -Raw | ConvertFrom-Json
$versionName = $product.android.versionName
$versionCode = [int]$product.android.versionCode
if (-not $versionName) { throw 'release version metadata is missing' }
$tag = "v$versionName"
$repoName = $product.repository
$existingRelease = & gh release view $tag --repo $repoName --json isDraft 2>&1
$hasDraft = $LASTEXITCODE -eq 0
if ($hasDraft -and -not ($existingRelease | ConvertFrom-Json).isDraft) { throw "$tag is already published; increment the Android version before releasing" }
if (!$hasDraft -and ($existingRelease | Out-String) -notmatch 'release not found') { throw "Could not check whether $tag is already published" }
Push-Location $repo
try { & npm run data:pull; if ($LASTEXITCODE -ne 0) { throw 'reading the published campus snapshot failed' } } finally { Pop-Location }
$android = Join-Path $repo 'android'
$gradle = Join-Path $android 'gradlew.bat'
$privateModule = 'D:\personal-config\secrets\secrets.psm1'
Import-Module $privateModule
$tempBase = 'D:\Temp\codex\studev-release'
$tempRoot = Join-Path $tempBase ([guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
& (Join-Path $PSScriptRoot 'build-android.ps1') -OutputDir $tempRoot -GradleArgs $GradleArgs
if ($LASTEXITCODE -ne 0) { throw 'signed Android build failed' }
$apk = Join-Path $android 'app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apk)) { throw 'release APK is missing' }
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
# The APK as it ships, used on an emulator before anything is uploaded: it must open, search, route and not crash.
$androidScope = if ($Conversations) { @('--conversations') } else { @() }
& node (Join-Path $repo 'scripts/smoke/android.mjs') $apk @androidScope
if ($LASTEXITCODE -ne 0) { throw 'Android smoke test failed' }

$fullApk = Join-Path $tempRoot "studev-$versionName.apk"
Copy-Item $apk $fullApk

# The Windows app: the kernels from their pinned tags, the parity checks, a NativeAOT build, and a Velopack release whose
# portable zip, packages and feed go to windows/ on Cloudflare R2 (public at dl.hicancan.top, no egress fee), where the
# site's /download/windows/ redirects and unzipped copies update themselves. Only the portable zip is offered.
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
# The Windows app as it ships, used in a home of its own before it is packaged: the same, and a desktop widget opened.
$windowsScope = if ($Conversations) { @('-Conversations') } else { @() }
& pwsh -NoProfile -File (Join-Path $repo 'scripts/smoke/windows.ps1') -Exe (Join-Path $publish 'StuDev.exe') @windowsScope
if ($LASTEXITCODE -ne 0) { throw 'Windows smoke test failed' }
$velopack = Join-Path $tempRoot 'windows-releases'
New-Item -ItemType Directory -Path $velopack -Force | Out-Null
$feed = "$($product.origin)/download/windows"
# The releases already out, so the new one carries a delta from the last; none yet before the first.
$known = try { Invoke-WebRequest "$feed/releases.win.json" -MaximumRedirection 5 -ErrorAction Stop | Out-Null; $true } catch { if ($_.Exception.Response.StatusCode.value__ -eq 404) { $false } else { throw } }
if ($known) { & vpk download http --url $feed --outputDir $velopack; if ($LASTEXITCODE -ne 0) { throw 'Earlier Windows releases could not be read' } }
& vpk pack --runtime win-x64 --packId top.hicancan.studev --packVersion $versionName --packDir $publish --mainExe StuDev.exe --packTitle StuDev --packAuthors 'NJUPT StuDev' `
    --icon (Join-Path $windows 'StuDev\Assets\StuDev.ico') --shortcuts 'Desktop,StartMenuRoot' --outputDir $velopack
if ($LASTEXITCODE -ne 0) { throw 'Windows packaging failed' }
$portable = Join-Path $velopack 'top.hicancan.studev-win-Portable.zip'
if (-not (Test-Path -LiteralPath $portable)) { throw "Windows portable zip is missing: $portable" }
# Both native builds passed. Verify public downloads before GitHub publication
# lets the site advertise the release. The updater feed still waits for the site.
$fullPortable = Join-Path $tempRoot "studev-$versionName-windows.zip"
Copy-Item $portable $fullPortable
$made = Get-ChildItem $velopack -File -Filter "*-$versionName-*.nupkg"
if (!($made | Where-Object Name -Like "*-$versionName-full.nupkg")) { throw 'Windows full update package is missing' }
$env:OSCA_DOWNLOAD_ENDPOINT = "https://$(Get-Secret local.cloudflare.account_id).r2.cloudflarestorage.com"
$env:OSCA_DOWNLOAD_BUCKET = 'studev-download'
$env:OSCA_DOWNLOAD_ACCESS_KEY = Get-Secret local.cloudflare.r2_access_key
$env:OSCA_DOWNLOAD_SECRET_KEY = Get-Secret local.cloudflare.r2_secret_key
& node (Join-Path $repo 'scripts/release/put.mjs') $fullApk "studev-$versionName.apk"
if ($LASTEXITCODE -ne 0) { throw 'APK upload or public download check failed' }
foreach ($file in $made) { & node (Join-Path $repo 'scripts/release/put.mjs') $file.FullName "windows/$($file.Name)"; if ($LASTEXITCODE -ne 0) { throw "Windows upload failed: $($file.Name)" } }
& node (Join-Path $repo 'scripts/release/put.mjs') $fullPortable "windows/studev-$versionName-windows.zip"
if ($LASTEXITCODE -ne 0) { throw 'Windows portable upload failed' }
$releaseNotes = if ($Notes) { $Notes } else { "studev $versionName" }
$assetPaths = @($fullApk, $fullPortable)
$releaseCommit = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the release commit' }
if (!$hasDraft) {
    $notesPath = Join-Path $tempRoot 'release-notes.md'
    Set-Content -Path $notesPath -Value $releaseNotes -NoNewline
    & gh release create $tag --repo $repoName --target $releaseCommit --draft --title "studev $versionName" --notes-file $notesPath
    if ($LASTEXITCODE -ne 0) { throw "GitHub release creation failed" }
}
& gh release upload $tag @assetPaths --repo $repoName --clobber
if ($LASTEXITCODE -ne 0) { throw "GitHub release asset upload failed" }
# This event triggers the Web deploy, whose gate independently checks both downloads.
& gh release edit $tag --repo $repoName --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'GitHub release publication failed' }
try {
    Wait-PublishedApp $product.origin $versionName $versionCode
    & node (Join-Path $repo 'scripts/release/put.mjs') (Join-Path $velopack 'releases.win.json') 'windows/releases.win.json'
    if ($LASTEXITCODE -ne 0) { throw 'Windows feed upload failed' }
} catch {
    Write-Warning "$tag is already published. Keep the release and resume only the site check and Windows feed upload; do not publish the tag again. Artifacts retained at $tempRoot"
    throw
}
$releaseUrl = (& gh release view $tag --repo $repoName --json url --jq .url).Trim()
Write-Output "release APK: $apk"
Write-Output "release size: $((Get-Item $apk).Length) bytes"
Write-Output "release signature SHA-1: $sha1"
Write-Output "Windows portable: $feed/studev-$versionName-windows.zip"
Write-Output "GitHub release: $releaseUrl"
$resolvedTemp = (Resolve-Path -LiteralPath $tempRoot).Path
if (-not $resolvedTemp.StartsWith($tempBase + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe temporary directory: $resolvedTemp" }
Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
