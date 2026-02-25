# Diagnóstico de red: Agéndate ArcGIS (serviciosgis.catastrobogota.gov.co)
# Caso típico: el navegador abre la URL pero curl/Node fallan con timeout (28).
# Causa: navegador usa proxy/PAC; curl y Node no usan el proxy del sistema por defecto.
# Uso: powershell -ExecutionPolicy Bypass -File server/scripts/net/diagnose_agendate_arcgis_proxy.ps1

$HostArcGis = "serviciosgis.catastrobogota.gov.co"
$Port = 443
$UrlLayer = "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/participacioncomunal/MapServer/4?f=json"

Write-Host ""
Write-Host "=== 1) netsh winhttp show proxy ===" -ForegroundColor Cyan
try {
    netsh winhttp show proxy
} catch {
    Write-Host "Error: $_"
}

Write-Host ""
Write-Host "=== 2) Registro - Proxy (Internet Settings) ===" -ForegroundColor Cyan
$regPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$lmPath = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
foreach ($p in @($regPath, $lmPath)) {
    if (Test-Path $p) {
        Write-Host "  [$p]"
        try {
            $proxyEnable = Get-ItemProperty -Path $p -Name ProxyEnable -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProxyEnable
            $proxyServer = Get-ItemProperty -Path $p -Name ProxyServer -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProxyServer
            $autoConfigURL = Get-ItemProperty -Path $p -Name AutoConfigURL -ErrorAction SilentlyContinue | Select-Object -ExpandProperty AutoConfigURL
            Write-Host "    ProxyEnable  = $proxyEnable"
            Write-Host "    ProxyServer  = $proxyServer"
            Write-Host "    AutoConfigURL = $autoConfigURL"
        } catch {
            Write-Host "    (no se pudo leer: $_)"
        }
    }
}

Write-Host ""
Write-Host "=== 3) Test-NetConnection (TCP directo a $HostArcGis`:$Port) ===" -ForegroundColor Cyan
try {
    $tcp = Test-NetConnection -ComputerName $HostArcGis -Port $Port -WarningAction SilentlyContinue
    if ($tcp.TcpTestSucceeded) {
        Write-Host "  OK - TcpTestSucceeded: True" -ForegroundColor Green
    } else {
        Write-Host "  FALLO - TcpTestSucceeded: False (timeout o bloqueo sin proxy)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Error: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== 4) curl.exe -I a la URL (sin proxy explícito; curl usa env HTTP_PROXY/HTTPS_PROXY si están definidos) ===" -ForegroundColor Cyan
# Sin --noproxy: curl respeta HTTPS_PROXY/HTTP_PROXY. Con --noproxy '*' forzamos bypass.
$curlNoProxy = "curl.exe -I --connect-timeout 15 `"$UrlLayer`" 2>&1"
Write-Host "  Comando: $curlNoProxy"
try {
    $curlOut = Invoke-Expression $curlNoProxy 2>&1 | Out-String
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  OK - curl devolvió HTTP (exit 0)" -ForegroundColor Green
        Write-Host $curlOut
    } else {
        Write-Host "  FALLO - curl exit $LASTEXITCODE" -ForegroundColor Yellow
        Write-Host $curlOut
    }
} catch {
    Write-Host "  Error: $_" -ForegroundColor Red
}

# Detección y sugerencias
$suggestProxy = $false
$suggestPAC = $false
foreach ($p in @($regPath, $lmPath)) {
    if (-not (Test-Path $p)) { continue }
    try {
        $proxyServer = Get-ItemProperty -Path $p -Name ProxyServer -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProxyServer
        $autoConfigURL = Get-ItemProperty -Path $p -Name AutoConfigURL -ErrorAction SilentlyContinue | Select-Object -ExpandProperty AutoConfigURL
        if ($proxyServer) { $suggestProxy = $true }
        if ($autoConfigURL) { $suggestPAC = $true }
    } catch { }
}

Write-Host ""
Write-Host "=== Sugerencias ===" -ForegroundColor Cyan
if ($suggestProxy) {
    Write-Host ""
    Write-Host "  Se detectó ProxyServer en el sistema. Para que Node/curl usen el mismo proxy:" -ForegroundColor Yellow
    Write-Host "  - En PowerShell (esta sesión):" -ForegroundColor White
    Write-Host "      `$env:HTTPS_PROXY = 'http://proxy.ejemplo.gov.co:8080'" -ForegroundColor Gray
    Write-Host "      `$env:HTTP_PROXY = 'http://proxy.ejemplo.gov.co:8080'" -ForegroundColor Gray
    Write-Host "  - Luego ejecute: npm run ingest:agendate:arcgis:dry" -ForegroundColor Gray
    Write-Host "  - Sustituya la URL por la de su proxy (y usuario/contraseña si aplica)." -ForegroundColor Gray
}
if ($suggestPAC) {
    Write-Host ""
    Write-Host "  Se detectó AutoConfigURL (PAC). curl y Node NO interpretan PAC." -ForegroundColor Yellow
    Write-Host "  Opciones:" -ForegroundColor White
    Write-Host "  A) Configurar proxy manual: exporte HTTPS_PROXY/HTTP_PROXY con la URL real del proxy (puede obtenerla abriendo la URL PAC en el navegador o pidiendo a TI)." -ForegroundColor Gray
    Write-Host "  B) Ejecutar la ingesta en un servidor/CI con salida directa a Internet (sin proxy corporativo)." -ForegroundColor Gray
    Write-Host "  C) Pedir a TI allowlist/whitelist para serviciosgis.catastrobogota.gov.co:443 para su red o para Node/scripts." -ForegroundColor Gray
}
if (-not $suggestProxy -and -not $suggestPAC) {
    Write-Host "  No se detectó proxy ni PAC en el registro. Si aun así curl/Node fallan, compruebe firewall o red (allowlist del host)." -ForegroundColor Gray
}
Write-Host ""
