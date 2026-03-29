$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverUrl = "http://127.0.0.1:3210"

Write-Host "Starting SmartEdu UI in a new PowerShell window..."
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  (Join-Path $projectRoot "start-ui.ps1")
) -WorkingDirectory $projectRoot

Write-Host "Waiting for $serverUrl ..."
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 1
  try {
    Invoke-WebRequest $serverUrl -UseBasicParsing | Out-Null
    Write-Host "Opening browser..."
    Start-Process $serverUrl
    exit 0
  } catch {
    # Keep polling until the server is ready.
  }
}

throw "SmartEdu UI did not become ready within 30 seconds."
