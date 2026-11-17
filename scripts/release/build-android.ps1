# Build and verify the signed APK locally. Publication is a separate action.
param([Parameter(Mandatory)][string]$OutputDir, [string[]]$GradleArgs = @())
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$output = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$product = Get-Content (Join-Path $repo 'product.json') -Raw | ConvertFrom-Json
$android = Join-Path $repo 'android'
$java = 'D:\Dev\java\jdk-21.0.13+9'
$sdk = 'D:\Dev\Android\Sdk'
Import-Module D:\personal-config\secrets\secrets.psm1
$password = [string](Get-Secret local.studev_android.store_password)
if (-not $password) { throw 'Android signing password is missing' }
$keystore = 'D:\personal-config\secrets\projects\studev\android-release.p12'
if (-not (Test-Path -LiteralPath $keystore)) { throw 'Android signing keystore is missing' }
$start = [Diagnostics.ProcessStartInfo]::new((Join-Path $java 'bin/java.exe'))
$start.WorkingDirectory = $android
$start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
$start.Environment.Clear()
foreach ($name in @('PATH','Path','SystemRoot','ComSpec','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','GRADLE_USER_HOME','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','ALL_PROXY')) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $start.Environment[$name] = $value }
}
$start.Environment['JAVA_HOME'] = $java; $start.Environment['ANDROID_HOME'] = $sdk
$start.Environment['ORG_GRADLE_PROJECT_studev.keystore'] = $keystore
$start.Environment['ORG_GRADLE_PROJECT_studev.keyAlias'] = 'studev'
$start.Environment['ORG_GRADLE_PROJECT_studev.storePassword'] = $password
foreach ($value in @('-Xmx64m','-Xms64m','-classpath',(Join-Path $android 'gradle/wrapper/gradle-wrapper.jar'),'org.gradle.wrapper.GradleWrapperMain',
    'assembleRelease','testDebugUnitTest','lint','--no-daemon','--no-configuration-cache','--console=plain') + $GradleArgs) { $start.ArgumentList.Add($value) }
$process = [Diagnostics.Process]::Start($start)
Write-Output "Android signed build started (PID $($process.Id))"
$stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
$process.WaitForExit()
$log = ($stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()).Replace($password, '[redacted]')
Set-Content -LiteralPath (Join-Path $output 'android-build.log') -Value $log -Encoding utf8NoBOM
$start.Environment.Remove('ORG_GRADLE_PROJECT_studev.storePassword') | Out-Null
$password = $null
if ($process.ExitCode -ne 0) { throw "Android build or checks failed ($($process.ExitCode)); see android-build.log" }
$apk = Join-Path $output "studev-$($product.android.versionName).apk"
Copy-Item -LiteralPath (Join-Path $android 'app/build/outputs/apk/release/app-release.apk') -Destination $apk -Force
$badging = (& (Join-Path $sdk 'build-tools/36.1.0/aapt.exe') dump badging $apk 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $badging -notmatch "package: name='top.hicancan.studev' versionCode='$($product.android.versionCode)' versionName='$([regex]::Escape($product.android.versionName))'") { throw 'Signed APK product metadata is incorrect' }
$certificate = (& (Join-Path $sdk 'build-tools/36.1.0/apksigner.bat') verify --print-certs $apk 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0 -or $certificate -notmatch '(?im)SHA-1 digest:\s*c1026e54') { throw 'Signed APK certificate is incorrect' }
$archive = [IO.Compression.ZipFile]::OpenRead($apk)
try {
    $reader = [IO.StreamReader]::new($archive.GetEntry('assets/data/release.json').Open())
    try { $release = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    $reader = [IO.StreamReader]::new($archive.GetEntry('assets/data/version.txt').Open())
    try { $bundledVersion = $reader.ReadToEnd().Trim() } finally { $reader.Dispose() }
    if ($release.version -cne $bundledVersion) { throw 'APK bundled manifest and campus files disagree' }
} finally { $archive.Dispose() }
$receipt = @{ apk = $apk; version = $product.android.versionName; versionCode = $product.android.versionCode; campus = $release.version; knowledge = $release.knowledge_version; bytes = (Get-Item $apk).Length; sha256 = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash }
$receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'android-build.json') -Encoding utf8NoBOM
$receipt | ConvertTo-Json -Compress | Write-Output
