# scripts/regresion-post-limpieza.ps1
# Checklist ejecutable de regresión tras mover .md/.py a docs/referencia y scripts/python.
# Uso (desde la raíz del proyecto):
#   .\scripts\regresion-post-limpieza.ps1
#   .\scripts\regresion-post-limpieza.ps1 -StartApi   # Mata puertos, arranca solo API en background y ejecuta todo
# Criterio: exit 0 = PASS, exit 1 = FAIL (primer fallo).

param(
    [switch]$StartApi  # Si se indica, mata puertos 3001/5173 y arranca solo la API (node server.js) en background para las pruebas
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

$API_BASE = "http://localhost:3001"
$FAILED = $false

function Step { param($Name, $Block)
    Write-Host ""
    Write-Host "========== $Name ==========" -ForegroundColor Cyan
    try {
        & $Block
        if (-not $?) { $script:FAILED = $true; return $false }
        Write-Host "PASS: $Name" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "FAIL: $Name - $_" -ForegroundColor Red
        $script:FAILED = $true
        return $false
    }
}

# --- 1) npm run check:root ---
Step "check:root" {
    npm run check:root
    if ($LASTEXITCODE -ne 0) { throw "check:root falló (raíz no limpia)" }
}

# --- 2) Arranque canónico (opcional) ---
if ($StartApi) {
    Step "kill-ports + API en background" {
        node scripts/kill-ports.js 2>$null
        Start-Sleep -Seconds 1
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "node"
        $psi.Arguments = "server.js"
        $psi.WorkingDirectory = $ROOT
        $psi.UseShellExecute = $false
        $psi.Environment["PORT"] = "3001"
        $p = [System.Diagnostics.Process]::Start($psi)
        $max = 30
        $n = 0
        while ($n -lt $max) {
            Start-Sleep -Seconds 1
            try {
                $r = Invoke-WebRequest -Uri "$API_BASE/api/debug/ping" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
                if ($r.StatusCode -eq 200) { break }
            } catch {}
            $n++
        }
        if ($n -ge $max) {
            if ($p -and -not $p.HasExited) { $p.Kill() }
            throw "Timeout esperando API en 3001"
        }
        Write-Host "API respondiendo en $API_BASE"
    }
}

# --- 3) npm run verify:debug ---
Step "verify:debug" {
    npm run verify:debug
    if ($LASTEXITCODE -ne 0) { throw "verify:debug falló (revisar backend y docs/REGRESION_POST_LIMPIEZA.md)" }
}

# --- 4) Conteos GeoJSON (features) para 7 capas ---
$capas = @("aforos","obras","eventos","manifestaciones","conciertos","semaforos","base")
Step "Conteos GeoJSON 7 capas" {
    foreach ($capa in $capas) {
        $url = "$API_BASE/api/$capa/nodos"
        try {
            $resp = Invoke-RestMethod -Uri $url -Method Get -ErrorAction Stop
            $count = 0
            if ($resp.features) { $count = $resp.features.Count }
            if ($null -eq $resp.features) { throw "Respuesta sin .features" }
            Write-Host "  $capa : $count features"
        } catch {
            throw "Capa $capa ($url): $_"
        }
    }
}

# --- 5) npm run build ---
Step "build" {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "build falló" }
}

Write-Host ""
if ($FAILED) {
    Write-Host "REGRESION: FALLOS DETECTADOS. Ver docs/REGRESION_POST_LIMPIEZA.md para diagnóstico." -ForegroundColor Red
    exit 1
}
Write-Host "REGRESION: TODOS LOS PASOS OK." -ForegroundColor Green
exit 0
