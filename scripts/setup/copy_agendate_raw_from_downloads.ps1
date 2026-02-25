# Copia el JSON raw de la tabla 7 (Agéndate) desde Descargas al path canónico del proyecto.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/setup/copy_agendate_raw_from_downloads.ps1

$ErrorActionPreference = "Stop"
$downloads = [Environment]::GetFolderPath("UserProfile") + "\Downloads"
$patterns = @(
    "*agendate*7*.json",
    "*Agendate*7*.json",
    "*agendate*raw*.json",
    "*agendate*eventos*.json",
    "*query*.json",
    "*tabla*7*.json",
    "*eventos*agendate*.json"
)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$destDir = Join-Path $projectRoot "public\data"
$destFile = Join-Path $destDir "agendate_eventos_tabla7_raw.json"

$candidates = @()
foreach ($p in $patterns) {
    $candidates += Get-ChildItem -Path $downloads -Filter $p -File -ErrorAction SilentlyContinue
}
$candidates = $candidates | Sort-Object -Property LastWriteTime -Descending | Select-Object -Unique

if ($candidates.Count -eq 0) {
    Write-Host "ERROR: No se encontró ningún archivo en $downloads que coincida con:" -ForegroundColor Red
    foreach ($p in $patterns) { Write-Host "  - $p" }
    Write-Host ""
    Write-Host "Instrucciones:"
    Write-Host "  1. En el navegador, abra el servicio ArcGIS de la tabla 7 de Agéndate."
    Write-Host "  2. Descargue la respuesta JSON (query o export) y guárdela en Descargas."
    Write-Host "  3. Nombre sugerido: agendate_eventos_tabla7.json"
    Write-Host "  4. Vuelva a ejecutar este script."
    exit 1
}

$source = $candidates[0]
if ($candidates.Count -gt 1) {
    Write-Host "Varios archivos encontrados; se usa el más reciente por LastWriteTime:"
    $candidates | ForEach-Object { Write-Host "  $($_.LastWriteTime)  $($_.FullName)" }
    Write-Host ""
}
Write-Host "Origen: $($source.FullName)"
Write-Host "Tamaño: $($source.Length) bytes"

if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
}
Copy-Item -Path $source.FullName -Destination $destFile -Force
Write-Host "Destino: $destFile"
$destInfo = Get-Item $destFile
Write-Host "Tamaño final: $($destInfo.Length) bytes"
exit 0
