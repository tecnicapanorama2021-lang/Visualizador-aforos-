# Copia archivos de Agéndate (lugares layer 4 + eventos relacionados) desde Descargas al proyecto.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/setup/copy_agendate_related_files.ps1

$ErrorActionPreference = "Stop"
$downloads = [Environment]::GetFolderPath("UserProfile") + "\Downloads"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$destDir = Join-Path $projectRoot "public\data"

$lugaresNames = @("agendate_lugares_layer4.json", "agendate_lugares_layer4.JSON")
$eventosNames = @("agendate_eventos_relacionados.json", "agendate_eventos_raw.json", "agendate_eventos_relacionados.JSON")

function Find-File($names) {
    foreach ($n in $names) {
        $p = Join-Path $downloads $n
        if (Test-Path $p) { return $p }
    }
    return $null
}

$lugaresSrc = Find-File $lugaresNames
$eventosSrc = Find-File $eventosNames

if (-not $lugaresSrc) {
    Write-Host "ERROR: No se encontró archivo de lugares en $downloads" -ForegroundColor Red
    Write-Host "  Buscados: $($lugaresNames -join ', ')" -ForegroundColor Red
    Write-Host "  Descargue la respuesta del query al layer 4 (lugares) y guárdela como agendate_lugares_layer4.json" -ForegroundColor Yellow
    exit 1
}
if (-not $eventosSrc) {
    Write-Host "ERROR: No se encontró archivo de eventos relacionados en $downloads" -ForegroundColor Red
    Write-Host "  Buscados: $($eventosNames -join ', ')" -ForegroundColor Red
    Write-Host "  Descargue la respuesta de queryRelatedRecords y guárdela como agendate_eventos_relacionados.json o agendate_eventos_raw.json" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}

Copy-Item -Path $lugaresSrc -Destination (Join-Path $destDir "agendate_lugares_layer4.json") -Force
$snapshotPath = Join-Path $destDir "agendate_eventos_snapshot.json"
$snapshotRemoved = $false
if (Test-Path $snapshotPath) {
    Remove-Item -Path $snapshotPath -Force
    $snapshotRemoved = $true
}
Copy-Item -Path $eventosSrc -Destination (Join-Path $destDir "agendate_eventos_relacionados.json") -Force

Write-Host ""
Write-Host "OK Lugares copiados" -ForegroundColor Green
Write-Host "OK Eventos relacionados copiados" -ForegroundColor Green
if ($snapshotRemoved) {
    Write-Host "OK Snapshot anterior eliminado (si existia)" -ForegroundColor Green
}
exit 0
