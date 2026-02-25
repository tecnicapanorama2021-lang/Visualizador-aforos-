# Restore local de panorama_db.dump en BD aforos
# Uso: .\restore_local.ps1
# Requiere: PostgreSQL 18 en 5432, usuario postgres (configurar password abajo o en PGPASSWORD)

$ErrorActionPreference = "Stop"
$pgBin = "C:\Program Files\PostgreSQL\18\bin"
$exportDir = $PSScriptRoot
$dumpPath = Join-Path $exportDir "panorama_db.dump"

if (-not (Test-Path $dumpPath)) {
    Write-Error "No se encuentra $dumpPath"
    exit 1
}

# Contraseña: usar variable de entorno PGPASSWORD o descomentar y rellenar (no commitear)
# $env:PGPASSWORD = "tu_password"
if (-not $env:PGPASSWORD) {
    Write-Host "Configura la contraseña de postgres, por ejemplo:"
    Write-Host '  $env:PGPASSWORD = "tu_password"'
    Write-Host "Luego ejecuta de nuevo este script."
    exit 1
}

$createdb = Join-Path $pgBin "createdb.exe"
$psql = Join-Path $pgBin "psql.exe"
$pgRestore = Join-Path $pgBin "pg_restore.exe"
$host = "localhost"
$port = "5432"
$user = "postgres"
$db = "aforos"

# Comprobar si aforos existe
$exists = & $psql -h $host -p $port -U $user -d postgres -t -A -c "SELECT 1 FROM pg_database WHERE datname='aforos';" 2>$null
if ($exists -eq "1") {
    Write-Host "La base de datos 'aforos' ya existe."
    $r = Read-Host "¿Quieres borrarla y restaurar de nuevo? (escribe si para confirmar)"
    if ($r -ne "si") {
        Write-Host "Cancelado. No se ha borrado ni restaurado nada."
        exit 0
    }
    & $psql -h $host -p $port -U $user -d postgres -c "DROP DATABASE IF EXISTS aforos;"
}

Write-Host "Creando base de datos aforos..."
& $createdb -h $host -p $port -U $user $db
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Restaurando dump..."
& $pgRestore -h $host -p $port -U $user -d $db -Fc $dumpPath
$restoreExit = $LASTEXITCODE

# Warnings de pg_restore (roles, extensions) son frecuentes; si hay error distinto de 0 puede ser solo eso
if ($restoreExit -ne 0) {
    Write-Host "pg_restore terminó con código $restoreExit (pueden ser solo avisos de roles/extensions)."
}

Write-Host "Comprobando PostGIS en aforos..."
& $psql -h $host -p $port -U $user -d $db -c "CREATE EXTENSION IF NOT EXISTS postgis; SELECT PostGIS_Full_Version();" 2>&1

Write-Host "Conteos rápidos:"
& $psql -h $host -p $port -U $user -d $db -c "SELECT 'nodos' AS tabla, COUNT(*) FROM nodos UNION ALL SELECT 'estudios', COUNT(*) FROM estudios UNION ALL SELECT 'incidentes', COUNT(*) FROM incidentes;"

Write-Host "Listo. Configura .env del proyecto con DATABASE_URL o PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD para apuntar a la BD aforos local."
