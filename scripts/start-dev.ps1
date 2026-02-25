# scripts/start-dev.ps1
# DEPRECATED: Use .\scripts\dev.ps1 or npm run dev as the single official dev entrypoint.
# This script may start duplicate processes. Kept for reference only.
$ErrorActionPreference = "SilentlyContinue"

Write-Host "[DEPRECATED] start-dev.ps1 is deprecated. Use: .\scripts\dev.ps1 or npm run dev" -ForegroundColor Yellow

$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

function Kill-Port($port) {
  $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  if ($null -ne $conns) {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
      if ($pid -and $pid -ne 0) {
        Write-Host "Killing PID $pid on port $port ..."
        taskkill /PID $pid /F | Out-Null
      }
    }
  }
}

$API_PORT = 3001
$WEB_PORT = 5173

Write-Host "========================================="
Write-Host " PANORAMA INGENIERIA - DEV START"
Write-Host " API  : http://localhost:$API_PORT"
Write-Host " WEB  : http://localhost:$WEB_PORT"
Write-Host "========================================="

Write-Host "Ensuring ports are free..."
Kill-Port $API_PORT
Kill-Port $WEB_PORT

Write-Host "Starting API..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$ROOT`"; `$env:PORT=`"$API_PORT`"; `$env:DEBUG_AFORO=`"1`"; node server.js"

Start-Sleep -Seconds 2

Write-Host "Starting WEB (Vite)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$ROOT`"; npm run dev -- --port $WEB_PORT --strictPort"
