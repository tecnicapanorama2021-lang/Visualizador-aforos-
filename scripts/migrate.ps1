<#
.SYNOPSIS
  LEGACY-PARCIAL: Aplica solo migraciones 014, 016, 017, 018, 019, 020 (psql).
  NO usar para migración completa. Para aplicar TODAS las migraciones (001-023) use: npm run db:migrate
  Uso en Windows sin psql en PATH: -PsqlPath "C:\Program Files\PostgreSQL\16\bin\psql.exe"
#>
param(
  [string] $DbUrl,
  [string] $PsqlPath,
  [string] $DbName,
  [string] $DbUser,
  [string] $DbHost = "localhost",
  [string] $DbPort = "5432",
  [string] $Password
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$MigrationsDir = Join-Path $ProjectRoot "server\db\migrations"
$Mig014 = Join-Path $MigrationsDir "014_grafo_y_interval.sql"
$Mig016 = Join-Path $MigrationsDir "016_conteos_resumen_unique_ini_fin.sql"
$Mig017 = Join-Path $MigrationsDir "017_add_tipo_nodo_to_nodos.sql"
$Mig018 = Join-Path $MigrationsDir "018_nodos_categoria_rules.sql"
$Mig019 = Join-Path $MigrationsDir "019_rules_aforo_by_estudios.sql"
$Mig020 = Join-Path $MigrationsDir "020_multicapas.sql"

# Guardar PGPASSWORD previo para restaurar al final
$SavedPgpPassword = $env:PGPASSWORD

foreach ($f in @($Mig014, $Mig016, $Mig017, $Mig018, $Mig019, $Mig020)) {
  if (-not (Test-Path -LiteralPath $f)) {
    Write-Error "[MIGRATE] No se encuentra el archivo de migración: $f"
    exit 1
  }
}

# PGPASSWORD: preferir variable de entorno para no exponer en argumentos
if ($Password) {
  $env:PGPASSWORD = $Password
}

# Resolver psql.exe
$PsqlExe = $null
if ($PsqlPath) {
  if (Test-Path -LiteralPath $PsqlPath) { $PsqlExe = $PsqlPath }
  else {
    Write-Error "[MIGRATE] psql no encontrado en la ruta indicada: $PsqlPath"
    exit 1
  }
} else {
  $tryPaths = @(
    "C:\Program Files\PostgreSQL\16\bin\psql.exe",
    "C:\Program Files\PostgreSQL\15\bin\psql.exe",
    "C:\Program Files\PostgreSQL\14\bin\psql.exe"
  )
  foreach ($p in $tryPaths) {
    if (Test-Path -LiteralPath $p) { $PsqlExe = $p; break }
  }
  if (-not $PsqlExe) {
    Write-Error "[MIGRATE] No se encontró psql.exe. Indica -PsqlPath ""C:\Program Files\PostgreSQL\16\bin\psql.exe"" o añade PostgreSQL al PATH."
    exit 1
  }
}

Write-Host "[MIGRATE] usando psql: $PsqlExe"

# Construir argumentos de conexión (array; nunca concatenar como string)
$connArgs = @()
if (-not [string]::IsNullOrWhiteSpace($DbUrl)) {
  $connArgs = @($DbUrl.Trim())
} elseif ($DbName -and $DbUser) {
  $connArgs = @("-h", $DbHost, "-p", $DbPort, "-U", $DbUser, "-d", $DbName)
} else {
  $envUrl = $env:DATABASE_URL
  if ([string]::IsNullOrWhiteSpace($envUrl)) {
    Write-Error "[MIGRATE] DATABASE_URL no está definido. Ejemplo en PowerShell:`n  `$env:DATABASE_URL = 'postgresql://postgres:tu_password@localhost:5432/aforos'`nO usa: -DbName aforos -DbUser postgres -Password 'tu_password'"
    exit 1
  }
  $connArgs = @($envUrl.Trim())
  Write-Host "[MIGRATE] usando DATABASE_URL del entorno"
}

# Sanitizar para mostrar (ocultar password en URL)
function Get-SanitizedArgs($argsArray) {
  return $argsArray | ForEach-Object {
    if ($_ -match '^postgresql://') {
      $_ -replace '^postgresql://([^:]+):([^@]+)@', 'postgresql://$1:***@'
    } else {
      $_
    }
  }
}

function Get-ShortPath($literalPath) {
  if (-not (Test-Path -LiteralPath $literalPath)) { return $literalPath }
  try {
    $fso = New-Object -ComObject Scripting.FileSystemObject
    $item = $fso.GetFile($literalPath)
    return $item.ShortPath
  } catch {
    return $literalPath
  }
}

function Run-Migration($label, $sqlFile) {
  # Ruta 8.3 sin espacios para que psql reciba un solo argumento (Arguments es un solo string en Windows)
  $pathForPsql = Get-ShortPath $sqlFile
  Write-Host "[MIGRATE] aplicando $label ... archivo: $sqlFile"
  $safeDisplay = (Get-SanitizedArgs $connArgs) -join ' '
  Write-Host "[MIGRATE] comando (sanitizado): $PsqlExe $safeDisplay -f $pathForPsql -v ON_ERROR_STOP=1"

  # Opciones -f y -v primero; luego conexión (algunos entornos parsean solo el primer token como conexión)
  $parts = @("-f", $pathForPsql, "-v", "ON_ERROR_STOP=1")
  foreach ($a in $connArgs) {
    if ($a -match '^postgresql://' -or $a -match '\s') { $parts += "`"$a`"" } else { $parts += $a }
  }
  $argsStr = $parts -join ' '
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $PsqlExe
  $psi.Arguments = $argsStr
  $psi.UseShellExecute = $false
  $proc = [System.Diagnostics.Process]::Start($psi)
  $proc.WaitForExit()
  $exitCode = $proc.ExitCode
  if ($exitCode -ne 0) {
    Write-Error "[MIGRATE] aplicando $label falló (exit $exitCode)"
    if ($SavedPgpPassword -ne $null) { $env:PGPASSWORD = $SavedPgpPassword }
    exit 1
  }
  Write-Host "[MIGRATE] aplicando $label ... OK"
}

try {
  Run-Migration "014" $Mig014
  Run-Migration "016" $Mig016
  Run-Migration "017" $Mig017
  Run-Migration "018" $Mig018
  Run-Migration "019" $Mig019
  Run-Migration "020" $Mig020
  Write-Host "[MIGRATE] listo (014 + 016 + 017 + 018 + 019 + 020)."
} finally {
  if ($SavedPgpPassword -ne $null) { $env:PGPASSWORD = $SavedPgpPassword }
}
