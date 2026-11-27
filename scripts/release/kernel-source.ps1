# The source of a kernel release: a detached worktree of its tag inside the kernel repository's ignored target
# directory. Builds read the tag itself, so work in progress in the developer checkout neither blocks nor leaks in.
function Get-KernelSource([string]$Repo, [string]$Tag) {
    $commit = (& git -C $Repo rev-parse "$Tag^{commit}").Trim()
    if ($LASTEXITCODE -ne 0) { throw "Missing kernel release $Tag in $Repo" }
    $source = Join-Path $Repo "target\release-source\$Tag"
    & git -C $Repo worktree prune
    if (-not (Test-Path -LiteralPath (Join-Path $source '.git'))) {
        & git -C $Repo worktree add --detach --force $source $commit | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not check out $Tag of $Repo" }
    }
    $head = (& git -C $source rev-parse HEAD).Trim()
    if ($head -ne $commit -or (& git -C $source status --porcelain --untracked-files=no)) { throw "Kernel source is not $Tag as released: $source" }
    return $source
}
