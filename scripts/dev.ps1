# scripts/dev.ps1 — Regla de puertos: API 3001, Web 5173. Mata procesos en esos puertos y arranca backend + front.
$ErrorActionPreference = "SilentlyContinue"

$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

function Kill-Port($port) {
  $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  if ($null -ne $conns) {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
      if ($pid -and $pid -ne 0) {
        Write-Host "Liberando puerto $port (PID $pid)..."
        taskkill /PID $pid /F 2>$null
      }
    }
  }
}

$API_PORT = 3001
$WEB_PORT = 5173

Write-Host "========================================="
Write-Host " PANORAMA INGENIERIA - DEV (puertos fijos)"
Write-Host " API  : http://localhost:$API_PORT"
Write-Host " WEB  : http://localhost:$WEB_PORT"
Write-Host "========================================="

Write-Host "Liberando puertos $API_PORT y $WEB_PORT..."
Kill-Port $API_PORT
Kill-Port $WEB_PORT
Start-Sleep -Seconds 1

Write-Host "Iniciando API..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$ROOT`"; `$env:PORT=`"$API_PORT`"; `$env:DEBUG_AFORO=`"1`"; node server.js"
Start-Sleep -Seconds 2

Write-Host "Iniciando WEB (Vite)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$ROOT`"; npm run dev:web"

$maxWait = 20
$waited = 0
while ($waited -lt $maxWait) {
  Start-Sleep -Seconds 2
  $waited += 2
  $listeningApi = Get-NetTCPConnection -LocalPort $API_PORT -State Listen -ErrorAction SilentlyContinue
  $listeningWeb = Get-NetTCPConnection -LocalPort $WEB_PORT -State Listen -ErrorAction SilentlyContinue
  if ($listeningApi -and $listeningWeb) {
    Write-Host ""
    Write-Host "Puertos en LISTENING. URLs:"
    Write-Host "  UI:      http://localhost:$WEB_PORT/aforos"
    Write-Host "  Directo: http://localhost:$WEB_PORT/aforos/analisis/388"
    Write-Host "  API:     http://localhost:$API_PORT/api/aforos/analisis/388"
    Write-Host ""
    exit 0
  }
}

Write-Host "Timeout esperando puertos. Comprueba las ventanas (API y Vite)."
Write-Host "  UI:      http://localhost:$WEB_PORT/aforos"
Write-Host "  Directo: http://localhost:$WEB_PORT/aforos/analisis/388"
Write-Host "  API:     http://localhost:$API_PORT/api/aforos/analisis/388"
