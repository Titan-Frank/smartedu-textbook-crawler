$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

Write-Host "Installing dependencies if needed..."
npm --prefix scripts install

Write-Host "Starting SmartEdu UI at http://127.0.0.1:3210"
npm --prefix scripts run crawl-ui
