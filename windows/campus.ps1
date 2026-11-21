param([Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$release = Get-Content -LiteralPath (Join-Path $root 'src/data/campus-release.json') -Raw | ConvertFrom-Json -AsHashtable
$facts = Join-Path $root "public$($release.base)"
$teaching = "teaching/$($release.teaching)"
$paths = @('calendar.json', 'morning-run.json', "$teaching/term.json", "$teaching/periods.json", "$teaching/classes.json")
$slices = @($teaching)
foreach ($kind in @('exams', 'labs')) {
    if ($release[$kind]) {
        $term = "$kind/$($release[$kind])"
        $paths += "$term/index.json"
        $slices += $term
    }
}
foreach ($term in $slices) {
    $paths += Get-ChildItem -LiteralPath (Join-Path $facts "$term/classes") -File -Filter '*.json' |
        ForEach-Object { "$term/classes/$($_.Name)" }
}
$snapshotPresent = $paths | Where-Object { !(Test-Path -LiteralPath (Join-Path $facts $_) -PathType Leaf) }
if ($snapshotPresent) { throw 'The campus snapshot is incomplete. Run npm run data:pull before building Windows.' }
$release.Remove('all')
$release.Remove('offline')
$release.Remove('core')
$searchPaths = @("$($release.search_base)/manifest.json", "$($release.search_base)/pack-000.bin")
if ($release.search_stable_base) { $searchPaths += "$($release.search_stable_base)/pack-000.bin" }
$output = [IO.Path]::GetFullPath($Destination)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output)) | Out-Null
$pending = "$output.$PID.tmp"
try {
    $archive = [IO.Compression.ZipFile]::Open($pending, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $writer = [IO.StreamWriter]::new($archive.CreateEntry('release.json').Open())
        try { $writer.Write(($release | ConvertTo-Json -Depth 12 -Compress)) } finally { $writer.Dispose() }
        foreach ($path in $searchPaths) {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, (Join-Path $root "public$path"), $path.TrimStart('/'),
                [IO.Compression.CompressionLevel]::NoCompression) | Out-Null
        }
        foreach ($path in $paths) {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, (Join-Path $facts $path), $release.base.TrimStart('/') + '/' + $path,
                [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $archive.Dispose() }
    [IO.File]::Move($pending, $output, $true)
} finally {
    if ([IO.File]::Exists($pending)) { [IO.File]::Delete($pending) }
}
