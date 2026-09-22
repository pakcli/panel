<#
.SYNOPSIS
    Interactive Git Lost / Detached Commit Recovery Tool
.DESCRIPTION
    Lists recent commits from git reflog (including orphaned/detached commits),
    lets you pick one (0 = latest, 1 = sebelum latest, dst),
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
Write-Host "Mencari commit terakhir dari reflog...`n" -ForegroundColor Gray

# 1. Ambil commit dari git reflog (maks 40 entri terbaru)
$rawReflog = git reflog -n 40 --format="%h|%cr|%s" 2>$null
if (-not $rawReflog) {
    Write-Host "Error: Gagal membaca git reflog atau repositori kosong." -ForegroundColor Red
    return
}

# Deduplikasi commit hash agar list rapi
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
        # Cek apakah commit ini orphaned (tidak berada di branch mana pun)
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
    Write-Host "Tidak ada commit yang ditemukan di reflog." -ForegroundColor Yellow
    return
}

# 2. Tampilkan pilihan commit
Write-Host "Daftar commit terakhir (0 = paling baru):" -ForegroundColor Green
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

# Input nomor commit
$selectedIdx = ReadHostDefault -Prompt "`nPilih commit index (0 = latest, 1 = sebelum latest, dst) [Default: 0]" -Default "0"

if (-not ($selectedIdx -match '^\d+$') -or [int]$selectedIdx -ge $commitList.Count) {
    Write-Host "Pilihan index tidak valid!" -ForegroundColor Red
    return
}

$target = $commitList[[int]$selectedIdx]
Write-Host "`nTarget commit terpilih: $($target.Hash) ($($target.Msg))" -ForegroundColor Cyan

# 3. Dapatkan daftar file yang berubah di commit tersebut
$changedFiles = git diff-tree --no-commit-id --name-status -r $target.Hash 2>$null
if (-not $changedFiles) {
    Write-Host "Tidak ada perubahan file pada commit ini (kemungkinan root commit atau merge kosong)." -ForegroundColor Yellow
    return
}

Write-Host "`nDaftar file di commit ini:" -ForegroundColor Green
$fileList = @()
foreach ($f in $changedFiles) {
    $fParts = $f -split "`t", 2
    $status = $fParts[0].Trim()
    $filePath = $fParts[1].Trim()
    $fileList += $filePath
    Write-Host "  [$status] $filePath" -ForegroundColor Yellow
}

# 4. Menu Aksi
Write-Host "`nOpsi Penerapan:" -ForegroundColor Cyan
Write-Host "  1. Simple overwrite whole (timpa semua file dari commit ini ke working directory)"
Write-Host "  2. Per-file overwrite (tanya satu per satu untuk tiap file)"
Write-Host "  3. Cancel (batal)"

$action = ReadHostDefault -Prompt "`nPilih opsi [1/2/3] [Default: 3]" -Default "3"

switch ($action) {
    "1" {
        Write-Host "`nMemulihkan semua file dari commit $($target.Hash)..." -ForegroundColor Green
        foreach ($filePath in $fileList) {
            git checkout $target.Hash -- $filePath 2>$null
            Write-Host "  -> Overwritten: $filePath" -ForegroundColor Green
        }
        Write-Host "`nSelesai! Semua file berhasil dipulihkan." -ForegroundColor Cyan
    }

    "2" {
        Write-Host "`nMode Per-File Overwrite (Ketik 1 lalu Enter untuk Overwrite, atau langsung Enter / 0 untuk Skip):" -ForegroundColor Magenta
        Write-Host "Aturan: 0 = Gak overwrite (Default), 1 = Overwrite`n" -ForegroundColor Gray

        $appliedCount = 0
        foreach ($filePath in $fileList) {
            $ans = ReadHostDefault -Prompt "Overwrite '$filePath'? (0 = skip [default], 1 = overwrite)" -Default "0"
            if ($ans -eq "1") {
                git checkout $target.Hash -- $filePath 2>$null
                Write-Host "  -> [OK] '$filePath' dipulihkan/overwrite!" -ForegroundColor Green
                $appliedCount++
            } else {
                Write-Host "  -> [SKIP] '$filePath' dilewati." -ForegroundColor DarkGray
            }
        }
        Write-Host "`nSelesai! Sebanyak $appliedCount file dipulihkan." -ForegroundColor Cyan
    }

    default {
        Write-Host "`nDibatalkan. Tidak ada file yang diubah." -ForegroundColor Yellow
    }
}
