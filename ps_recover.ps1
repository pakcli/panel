<#
.SYNOPSIS
    Interactive Git Lost / Detached Commit Recovery Tool
.DESCRIPTION
    Lists recent commits from git reflog (including orphaned/detached commits),
    lets you pick one (0 = latest, 1 = prior to latest, etc.),
    and selectively or completely restore/overwrite files into your working tree.
#>

[CmdletBinding()]
param()

function ReadHostDefault {
    param(
        [string]$Prompt,
        [string]$Default
    )
    $inputVal = Read-Host $Prompt
    if ([string]::IsNullOrWhiteSpace($inputVal)) {
        return $Default
    }
    return $inputVal.Trim()
}

$Host.UI.RawUI.WindowTitle = "Git Detached / Lost Commit Recovery"

Write-Host "`n=== [Git Detached / Lost Commit Recovery] ===" -ForegroundColor Cyan
Write-Host "Scanning recent commits from git reflog...`n" -ForegroundColor Gray

# 1. Fetch commits from git reflog (up to 40 recent entries)
$rawReflog = git reflog -n 40 --format="%h|%cr|%s" 2>$null
if (-not $rawReflog) {
    Write-Host "Error: Failed to read git reflog or repository is empty." -ForegroundColor Red
    return
}

# Deduplicate commit hashes to keep list concise
$seen = [System.Collections.Generic.HashSet[string]]::new()
$commitList = [System.Collections.Generic.List[PSCustomObject]]::new()

foreach ($line in $rawReflog) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line.Split('|', 3)
    if ($parts.Length -lt 3) { continue }
    
    $hash = $parts[0].Trim()
    $time = $parts[1].Trim()
    $msg  = $parts[2].Trim()

    if ($seen.Add($hash)) {
        # Check whether commit is orphaned (not reachable from any branch)
        $inBranch = git branch --all --contains $hash 2>$null
        $isLost = [string]::IsNullOrWhiteSpace($inBranch)

        $commitList.Add([PSCustomObject]@{
            Hash   = $hash
            Time   = $time
            Msg    = $msg
            IsLost = $isLost
        })
    }
}

if ($commitList.Count -eq 0) {
    Write-Host "No commits found in reflog." -ForegroundColor Yellow
    return
}

# 2. Display commit choices
Write-Host "Recent commit history (0 = latest):" -ForegroundColor Green
Write-Host "--------------------------------------------------------------------------------"
for ($i = 0; $i -lt [Math]::Min(15, $commitList.Count); $i++) {
    $c = $commitList[$i]
    $tag = if ($c.IsLost) { "[DETACHED/LOST]" } else { "[BRANCHED]     " }
    $color = if ($c.IsLost) { "Yellow" } else { "DarkGray" }
    
    $idxStr = "[$i]".PadRight(5)
    $hashStr = $c.Hash.PadRight(8)
    $timeStr = $c.Time.PadRight(15)
    
    Write-Host "$idxStr $hashStr $timeStr " -NoNewline -ForegroundColor White
    Write-Host "$tag " -NoNewline -ForegroundColor $color
    Write-Host $c.Msg -ForegroundColor Gray
}
Write-Host "--------------------------------------------------------------------------------"

# Prompt for commit index
$selectedIdx = ReadHostDefault -Prompt "`nSelect commit index (0 = latest, 1 = prior to latest, etc.) [Default: 0]" -Default "0"

if (-not ($selectedIdx -match '^\d+$') -or [int]$selectedIdx -ge $commitList.Count) {
    Write-Host "Invalid index selected!" -ForegroundColor Red
    return
}

$target = $commitList[[int]$selectedIdx]
Write-Host "`nSelected commit: $($target.Hash) ($($target.Msg))" -ForegroundColor Cyan

# 3. Retrieve changed files in the selected commit
$changedFiles = git diff-tree --no-commit-id --name-status -r $target.Hash 2>$null
if (-not $changedFiles) {
    Write-Host "No file changes in this commit (could be empty or a root commit)." -ForegroundColor Yellow
    return
}

Write-Host "`nFiles in this commit:" -ForegroundColor Green
$fileList = @()
foreach ($f in $changedFiles) {
    $fParts = $f -split "`t", 2
    $status = $fParts[0].Trim()
    $filePath = $fParts[1].Trim()
    $fileList += $filePath
    Write-Host "  [$status] $filePath" -ForegroundColor Yellow
}

# 4. Action Menu
Write-Host "`nApplication Options:" -ForegroundColor Cyan
Write-Host "  1. Simple overwrite all (restore all files from this commit into working directory)"
Write-Host "  2. Per-file overwrite (prompt for each file individually)"
Write-Host "  3. Cancel"

$action = ReadHostDefault -Prompt "`nSelect option [1/2/3] [Default: 3]" -Default "3"

switch ($action) {
    "1" {
        Write-Host "`nRestoring all files from commit $($target.Hash)..." -ForegroundColor Green
        foreach ($filePath in $fileList) {
            git checkout $target.Hash -- $filePath 2>$null
            Write-Host "  -> Overwritten: $filePath" -ForegroundColor Green
        }
        Write-Host "`nDone! All files restored successfully." -ForegroundColor Cyan
    }

    "2" {
        Write-Host "`nPer-File Overwrite Mode:" -ForegroundColor Magenta
        Write-Host "Rule: 0 = Skip [Default: press Enter], 1 = Overwrite`n" -ForegroundColor Gray

        $appliedCount = 0
        foreach ($filePath in $fileList) {
            $ans = ReadHostDefault -Prompt "Overwrite '$filePath'? (0 = skip [default], 1 = overwrite)" -Default "0"
            if ($ans -eq "1") {
                git checkout $target.Hash -- $filePath 2>$null
                Write-Host "  -> [OK] '$filePath' restored/overwritten!" -ForegroundColor Green
                $appliedCount++
            } else {
                Write-Host "  -> [SKIP] '$filePath' skipped." -ForegroundColor DarkGray
            }
        }
        Write-Host "`nDone! $appliedCount file(s) restored." -ForegroundColor Cyan
    }

    default {
        Write-Host "`nCancelled. No files were modified." -ForegroundColor Yellow
    }
}
