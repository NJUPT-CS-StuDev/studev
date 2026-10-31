# Replay the debug app's exported wayfind route through the emulator's real GPS provider.
[CmdletBinding()]
param(
    [string]$Route,
    [string]$Device = 'emulator-5554',
    [double]$SpeedFactor = 1,
    [double]$JitterMetres = 1.5,
    [double]$DetourAtMetres = -1,
    [double]$DetourMetres = 45,
    [string]$Adb = 'D:\Dev\Android\Sdk\platform-tools\adb.exe'
)
$ErrorActionPreference = 'Stop'
if ($Device -notmatch '^emulator-\d+$') { throw 'Replay only operates on an emulator.' }
if ($SpeedFactor -lt 1 -or $SpeedFactor -gt 10) { throw 'SpeedFactor must be 1–10 so provider fixes stay inside the navigation matching window.' }
if ($JitterMetres -lt 0 -or $JitterMetres -gt 10) { throw 'JitterMetres must be 0–10.' }
$taskDir = 'D:\Temp\codex\app-nav'
if (-not $Route) {
    New-Item -ItemType Directory -Force $taskDir | Out-Null
    $Route = Join-Path $taskDir 'replay-route.json'
    & $Adb -s $Device pull /sdcard/Android/data/top.hicancan.studev/files/route.json $Route
    if ($LASTEXITCODE) { throw 'Export a route from the debug planner first.' }
}
$routeData = Get-Content -LiteralPath $Route -Raw | ConvertFrom-Json
if ($routeData.routes) { $routeData = $routeData.routes[0] }
if ($routeData.geometry.Count -lt 2 -or $routeData.geometry_offsets_m.Count -ne $routeData.geometry.Count) {
    throw 'Expected a wayfind route with geometry and geometry_offsets_m.'
}
$culture = [System.Globalization.CultureInfo]::InvariantCulture
function Send-Fix([double]$Longitude, [double]$Latitude) {
    & $Adb -s $Device emu geo fix $Longitude.ToString('F8', $culture) $Latitude.ToString('F8', $culture) | Out-Null
    if ($LASTEXITCODE) { throw 'Emulator rejected the GPS fix.' }
}
$speed = if ($routeData.mode -eq 'bike') { 4.2 } else { 1.25 }
$offsets = $routeData.geometry_offsets_m
$vertex = 1
$distance = 0.0
$detoured = $false
Write-Host "Replaying $($routeData.mode), $([int]$routeData.distance_m) m, speed ${SpeedFactor}x. Ctrl+C stops."
while ($true) {
    while ($vertex -lt $offsets.Count - 1 -and $offsets[$vertex] -lt $distance) { $vertex++ }
    $a = $routeData.geometry[$vertex - 1]; $b = $routeData.geometry[$vertex]
    $span = $offsets[$vertex] - $offsets[$vertex - 1]
    $fraction = if ($span -gt 0) { [Math]::Clamp(($distance - $offsets[$vertex - 1]) / $span, 0, 1) } else { 1 }
    $longitude = $a[0] + ($b[0] - $a[0]) * $fraction
    $latitude = $a[1] + ($b[1] - $a[1]) * $fraction
    $lonScale = 111195 * [Math]::Cos($latitude * [Math]::PI / 180)
    if (-not $detoured -and $DetourAtMetres -ge 0 -and $distance -ge $DetourAtMetres) {
        $dx = ($b[0] - $a[0]) * $lonScale; $dy = ($b[1] - $a[1]) * 111195
        $length = [Math]::Max(.01, [Math]::Sqrt($dx * $dx + $dy * $dy))
        Write-Host "Intentional detour at $([int]$distance) m"
        1..10 | ForEach-Object {
            Send-Fix ($longitude + $dy / $length * $DetourMetres / $lonScale) ($latitude - $dx / $length * $DetourMetres / 111195)
            Start-Sleep -Seconds 1
        }
        $detoured = $true
    }
    $noiseX = (Get-Random -Minimum -1000 -Maximum 1001) / 1000.0 * $JitterMetres
    $noiseY = (Get-Random -Minimum -1000 -Maximum 1001) / 1000.0 * $JitterMetres
    Send-Fix ($longitude + $noiseX / $lonScale) ($latitude + $noiseY / 111195)
    if ($distance -ge $routeData.distance_m) {
        # Let the platform filter converge to the true endpoint before finishing.
        1..5 | ForEach-Object { Send-Fix $longitude $latitude; Start-Sleep -Seconds 1 }
        break
    }
    Start-Sleep -Seconds 1
    $distance = [Math]::Min($routeData.distance_m, $distance + $speed * $SpeedFactor)
}
Write-Host 'Replay complete.'
