# Updates the customer app from GitHub with one command, then refreshes packages.
# Requires this folder to be a git clone (see README: "Updating without re-downloading").
# Run:  powershell -ExecutionPolicy Bypass -File update.ps1      (ASCII only on purpose)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $MyInvocation.MyCommand.Path)
git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) { Write-Error "This folder is not a git clone. Clone the repository once (see README), then run this script."; exit 1 }
git pull --ff-only
if ($LASTEXITCODE -ne 0) { Write-Error "git pull failed (local changes or sign-in). Run: git status"; exit 1 }
flutter pub get
Write-Host "Done. Now STOP the app in Android Studio and press Run (not Hot restart)."
