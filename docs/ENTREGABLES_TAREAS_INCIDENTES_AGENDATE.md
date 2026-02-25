# Entregables – Tareas incidentes, fallback, verify, Agéndate y estados

## 1. Cambios ejecutados y resultados

### Re-ingesta (Tarea 1)

**Dry-run (solo clasificación):**
```
[ingest-contexto-incidentes] contexto_eventos con geom: 94
[ingest-contexto-incidentes] Clasificación → incidentes tipo: { OBRA: 93, MANIFESTACION: 1 }
[ingest-contexto-incidentes] Clasificación → layer (OBRAS/EVENTOS/MANIFESTACIONES): { OBRAS: 93, MANIFESTACIONES: 1 }
```

**Apply:** ejecutado; Insertados: 0, Actualizados: 94.

**Motivo de 0 EVENTO:** En la BD actual, las 94 filas de `contexto_eventos` con geom son 93 con `tipo = 'OBRA'` y 1 con `tipo = 'MANIFESTACION'` (origen: ETL desde `calendario_obras_eventos.json`). No hay filas con `tipo = 'EVENTO_CULTURAL'` y geom, por tanto la taxonomía no puede generar EVENTO hasta que existan esas filas (p. ej. tras `ingest:agendate:contexto:apply`).

**SQL de verificación (ejecutar en BD o con `node server/scripts/query_incidentes_post_ingest.js`):**

```sql
-- Conteo por tipo (EVENTO será > 0 cuando haya contexto_eventos EVENTO_CULTURAL con geom)
SELECT tipo, COUNT(*)
FROM incidentes
GROUP BY tipo
ORDER BY COUNT(*) DESC;

-- Eventos, manifestaciones, obras
SELECT
  SUM(CASE WHEN tipo='EVENTO'        THEN 1 ELSE 0 END) AS eventos,
  SUM(CASE WHEN tipo='MANIFESTACION' THEN 1 ELSE 0 END) AS manifestaciones,
  SUM(CASE WHEN tipo='OBRA'          THEN 1 ELSE 0 END) AS obras
FROM incidentes;

-- Geometría por tipo
SELECT tipo,
       COUNT(*) FILTER (WHERE geom IS NULL) AS sin_geom,
       COUNT(*) AS total
FROM incidentes
GROUP BY tipo
ORDER BY total DESC;
```

**Tabla esperada post-ingesta (estado actual):**

| tipo          | BD count | sin_geom | API features (sin ?active=1) |
|---------------|----------|----------|------------------------------|
| OBRA          | 186      | 0        | 186                          |
| EVENTO        | 0        | 0        | 93 (fallback)                |
| MANIFESTACION | 1        | 0        | 1                            |

---

## 2. Diff routes/capas.js (Tarea 2 – Fallback EVENTOS/MANIFESTACIONES)

- Se añade `incidentesCountByTipo(tipo)` para obtener el conteo canónico.
- **GET /api/eventos/nodos:** Se usa `countCanonicos = await incidentesCountByTipo('EVENTO')`. Si `countCanonicos === 0` se usa fallback desde `getEventosFromContexto` y se responde con `meta: { source: 'fallback_contexto_eventos', fallback: true }`. Si hay canónicos, solo se sirve desde `getIncidentesAsGeoJSON` (sin mezclar).
- **GET /api/manifestaciones/nodos:** Misma lógica con `MANIFESTACION`.
- Comentarios de política añadidos: cuando hay canónicos no se usa fallback; para poblar canónicos: `npm run ingest:eventos:incidentes -- --apply`.

*(Código aplicado en el repo.)*

---

## 3. Diff verify_debug_endpoints.js (Tarea 3 – Smoke test consistencia)

- El script pasa a ESM; se cargan `dotenv` y el cliente de BD.
- Nueva función `checkCapaConsistency(queryFn, tipo, endpoint)`: cuenta en `incidentes` por tipo, llama al endpoint, compara. OK si `bdCount === 0` (fallback permitido) o `apiCount >= bdCount`.
- Tras los checks de /api/debug/* se ejecuta la tabla de consistencia para OBRA, EVENTO, MANIFESTACION.
- Salida ejemplo:
  ```
  TIPO          | BD count | API features | fallback? | OK?
  --------------+----------+--------------+-----------+-----
  OBRA          |    186   |     186      | no       | ✅
  EVENTO        |      0   |      93      | sí       | ✅
  MANIFESTACION |      1   |       1      | no       | ✅
  ```
- Si no hay BD configurada, se muestra la tabla con BD count "n/a" y no se falla.

*(Código aplicado en el repo.)*

---

## 4. Nuevo archivo ingest_agendate_bogota_to_contexto_eventos.js (Tarea 4)

**Ubicación:** `server/scripts/ingest/ingest_agendate_bogota_to_contexto_eventos.js`

- **Fuente:** ArcGIS REST capa 4 (Agendate con Bogota). URL base de query con paginación `resultOffset` + `resultRecordCount` (1000 por página).
- **Campos:** Del metadata del servicio: `EVNLUGAR`, `GLOBALID`, geometría punto. Se mapea a `contexto_eventos`: `tipo = 'EVENTO_CULTURAL'`, `fuente = 'AGENDATE_BOGOTA'`, `origen_id = GLOBALID` o hash(titulo+lugar+coords), `descripcion` desde EVNLUGAR, `datos_extra` = properties completo, `geom` desde GeoJSON Point (SRID 4326).
- **Upsert:** `ON CONFLICT (origen_id, fuente) WHERE origen_id IS NOT NULL DO UPDATE SET descripcion, datos_extra, geom`.
- **CLI:** Sin `--apply` = dry-run (descarga y muestra total, sin escribir). Con `--apply` = escribe en BD y muestra resumen (procesados, total con fuente AGENDATE_BOGOTA, errores, sin geometría).

**GET de prueba al servicio:** El layer metadata (f=json) confirma: campos OBJECTID, EVNLUGAR, GLOBALID, SHAPE; maxRecordCount 2000; soporta GeoJSON. La query con f=geojson devolvió 500 en el entorno de prueba; el script está preparado para paginación y reintentos; si el servicio falla, conviene probar en red local o con proxy.

**package.json:**  
`ingest:agendate:contexto:dry` y `ingest:agendate:contexto:apply`.

---

## 5. Flujo completo Agéndate → incidentes (Tarea 5)

- **ingest_contexto_eventos_to_incidentes.js** no filtra por fuente: hace `SELECT ... FROM contexto_eventos WHERE geom IS NOT NULL`. Cualquier fila con `fuente = 'AGENDATE_BOGOTA'` y geom se incluye. No hay `WHERE fuente IN (...)` que excluya Agéndate.
- **capasTaxonomy.js** ya derivaba CONCIERTO (concierto, festival, show, gira). Se añadieron subtipos:
  - **TEATRO:** keywords `teatro`, `obra de teatro`, `danza`.
  - **FERIA:** keywords `feria`, `feria artesanal`, `exposicion`, `exposición`.
- Flujo completo:
  1. `npm run ingest:agendate:contexto:dry` → revisar features descargados.
  2. `npm run ingest:agendate:contexto:apply` → poblar contexto_eventos (AGENDATE_BOGOTA).
  3. `npm run ingest:eventos:incidentes:dry` → ver clasificación EVENTO/CONCIERTO/TEATRO/FERIA.
  4. `npm run ingest:eventos:incidentes -- --apply` → poblar incidentes.
  5. `npm run verify:debug` → smoke test.
  6. UI: chips EVENTOS / MANIFESTACIONES; vigencia Activos/Histórico según corresponda.

---

## 6. Estados temporales PROGRAMADO / ACTIVO / FINALIZADO (Tarea 6)

### a) Columnas en incidentes (022)

- **Ya existen:** `estado` (ACTIVO, PROGRAMADO, FINALIZADO), `start_at`, `end_at`.
- **No existe:** `active_now` (no es necesaria si se calcula en consulta/API).
- **Conclusión:** No hace falta migración 024 para soportar estados básicos.

### b) Lógica propuesta para EVENTOS

- **PROGRAMADO:** `NOW() < start_at - buffer_pre` (ej. 2 h antes).
- **ACTIVO:** `NOW() BETWEEN (start_at - buffer_pre) AND (end_at + buffer_post)`.
- **FINALIZADO:** `NOW() > end_at + buffer_post`.
- **DESCONOCIDO:** si `start_at` o `end_at` es NULL (el CHECK actual solo permite ACTIVO/PROGRAMADO/FINALIZADO; para DESCONOCIDO haría falta ampliar el dominio en una migración futura o mapear NULL a ACTIVO).

Buffers sugeridos: `buffer_pre = 2 * 60` (minutos), `buffer_post = 30` (minutos). Se pueden aplicar en la ingesta al calcular `estado` o en una vista/función.

### c) Lógica para MANIFESTACIONES (ventana corta)

- **ACTIVO:** ventana corta desde `start_at` (ej. 4–12 h).
- **FINALIZADO:** fuera de esa ventana.

Implementación posible: en ingesta, `estado = ACTIVO` si `end_at` es NULL o está dentro de las próximas 12 h; pasado ese tiempo, actualizar a FINALIZADO (job periódico o actualización bajo demanda).

### d) Filtro "Activos" vs "Histórico" en el endpoint

- **Activos:** ya se hace en `getIncidentesAsGeoJSON`: cuando `temporal.active === true` se filtra en memoria con `isActiveTemporal(props.start_at, props.end_at, now)` (capasAdapter: ventana activa = start ≤ now ≤ end, o start en [now-30d, now+7d] si end es null).
- **Histórico:** cuando no se envía `?active=1`, no se aplica ese filtro y se devuelven todos los incidentes del tipo (o se puede usar `?from=&to=` para rango).
- No es obligatorio filtrar por columna `estado` en SQL; el comportamiento actual (filtrar por start_at/end_at en memoria) es válido. Opcionalmente se puede añadir `AND estado = 'ACTIVO'` cuando `active=1` para alinear con un `estado` mantenido en ingesta/job.

---

## 7. Diagnóstico de conectividad y flujo resiliente Agéndate

### 7.1 Cómo ejecutar el diagnóstico

```bash
npm run net:diag:agendate
```

El script **nuevo** `server/scripts/net/diagnose_agendate_connectivity.js` ejecuta en orden:

1. **DNS:** resolución de `serviciosgis.catastrobogota.gov.co` (IPv4 e IPv6 si aplica).
2. **TCP:** conexión al puerto 443 (timeout configurable con `AGENDATE_TIMEOUT_MS`, por defecto 15000 ms).
3. **TLS:** handshake; reporta errores (CERT_*, handshake failure, protocol) y datos del certificado (CN/SAN, fechas, sin secretos).
4. **HTTP GET:** a `{AGENDATE_ARCGIS_LAYER_URL}?f=pjson` con timeout y reintentos.
5. **Proxy:** detecta y muestra (solo valores, sin tokens) `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`; recomienda usar `NO_PROXY` para el host ArcGIS si hay proxy.

- **Exit 0:** conectividad OK en todas las capas.
- **Exit distinto de 0:** fallo en alguna capa; el output indica en cuál (DNS / TCP / TLS / HTTP).

**Ejemplo de salida OK:**

```
[DIAG] 1) DNS lookup: serviciosgis.catastrobogota.gov.co
  IPv4: 190.xxx.xxx.xxx
[DIAG] 2) TCP conexión a serviciosgis.catastrobogota.gov.co:443
[DIAG] 3) TLS handshake
  ...
[DIAG] 4) HTTP GET ...
[DIAG] 5) Proxy (solo presencia, sin tokens)
  ...

[DIAG] Conectividad OK.
```

**Ejemplo de salida con fallo (conectividad):**

```
[DIAG] 1) DNS lookup: ...
  IPv4: ...
[DIAG] 2) TCP conexión a ...:443
[DIAG] FALLO en capa: TCP
[DIAG] TCP timeout 15000 ms
```

**Evidencia típica cuando el host no es accesible (p. ej. red corporativa/firewall):**

```text
curl.exe "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/participacioncomunal/MapServer/4?f=pjson"
curl: (28) Failed to connect to serviciosgis.catastrobogota.gov.co port 443: Timed out
# o
curl: (7) Failed to connect to ... Could not connect to server
```

En ese caso el diagnóstico debe marcar fallo en TCP o TLS y el flujo de ingesta puede usar fallback a KMZ (ver abajo).

---

### 7.2 Variables de entorno (Agéndate)

| Variable | Descripción | Default |
|----------|-------------|--------|
| `AGENDATE_SOURCE_MODE` | `arcgis` \| `kmz` \| `auto` | `auto` |
| `AGENDATE_ARCGIS_LAYER_URL` | URL del layer ArcGIS (metadata/query) | `https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/participacioncomunal/MapServer/4` |
| `AGENDATE_ARCGIS_QUERY_URL` | URL de query (si no se define, se usa `{layer_url}/query`) | (derivado) |
| `AGENDATE_KMZ_URL` | URL del recurso KMZ (Datos Abiertos Bogotá) | URL del dataset lugar_evento_agendate.kmz |
| `AGENDATE_TIMEOUT_MS` | Timeout en ms (descarga ArcGIS y KMZ) | `20000` |
| `AGENDATE_RETRIES` | Reintentos para peticiones ArcGIS | `2` |
| `AGENDATE_PAGE_SIZE` | Registros por página en query ArcGIS | `1000` |

- **arcgis:** solo fuente ArcGIS; si no conecta, el script falla con mensaje claro.
- **kmz:** solo fuente KMZ.
- **auto:** intenta ArcGIS; si falla por conectividad (timeout, DNS, TLS, HTTP ≥ 500), usa KMZ si `AGENDATE_KMZ_URL` está configurada; si no, falla con mensaje claro.

---

### 7.3 Flujo recomendado (en tu PC / cuando ArcGIS no es accesible)

1. **Diagnóstico:**  
   `npm run net:diag:agendate`  
   Si falla, usar la sección 7.4 para identificar causa raíz.

2. **Ingesta contexto (dry luego apply):**  
   `npm run ingest:agendate:contexto:dry`  
   `npm run ingest:agendate:contexto:apply`  
   Con `AGENDATE_SOURCE_MODE=auto` y `AGENDATE_KMZ_URL` configurada, si ArcGIS no conecta se usará KMZ automáticamente.

3. **Ingesta a incidentes:**  
   `npm run ingest:eventos:incidentes -- --apply`  
   Así se generan EVENTO canónicos en `incidentes` cuando existan filas en `contexto_eventos` con geom y tipo EVENTO_CULTURAL (incl. Agéndate).

4. **Verificación:**  
   `npm run verify:debug`  
   Comprueba endpoints y consistencia BD vs API. Si ArcGIS no es accesible y `AGENDATE_SOURCE_MODE=auto`, se imprime advertencia y no se hace fallar el verify por eso.

---

### 7.4 Checklist "Could not connect to server" (puerto 443)

Cuando `curl` o el diagnóstico fallan con *Failed to connect … port 443 … Could not connect to server* (o timeout), revisar en este orden:

| Causa | Qué comprobar |
|-------|----------------|
| **DNS** | `nslookup serviciosgis.catastrobogota.gov.co`; si no resuelve, DNS corporativo o ISP. |
| **Firewall corporativo / ISP** | Acceso a otros HTTPS:443; reglas de salida para ese host. |
| **Proxy** | Variables `HTTPS_PROXY`, `HTTP_PROXY`. Probar con `NO_PROXY=*.catastrobogota.gov.co` (o el host exacto) si el proxy bloquea. |
| **Antivirus / TLS inspection** | Inspección SSL que rompe el handshake; excepción para el dominio. |
| **IPv6 vs IPv4** | Si la red prefiere IPv6 y el host solo responde en IPv4 (o al revés), puede haber timeout; forzar IPv4 en pruebas si aplica. |

El script de diagnóstico indica en qué capa falló (DNS / TCP / TLS / HTTP) para orientar la causa raíz.

---

## 8. Ingesta offline cuando la red está bloqueada

### Caso: Ambos hosts bloqueados (TCP timeout)

**Diagnóstico:**

```bash
npm run net:diag:agendate
```

Salida esperada cuando ambos hosts fallan pero existe archivo local:

```
  TARGET                      | DNS | TCP:443   | TLS | HTTP   | RESULT
  serviciosgis.catastro...    | ✅  | ❌ TO      | -   | -      | ❌ bloqueado
  datosabiertos.bogota...     | ✅  | ❌ TO      | -   | -      | ❌ bloqueado
  AGENDATE_KMZ_FILE (local)   | ✅  | (no red)  | -   | -      | ✅ disponible
```

Si no hay `AGENDATE_KMZ_FILE` configurado y existente, el diagnóstico termina con exit 1 e indica: *"Descarga el KMZ manualmente y configura AGENDATE_KMZ_FILE"*.

### Solución: descargar KMZ manualmente

1. Abrir en navegador:  
   https://datosabiertos.bogota.gov.co/dataset/agendate-con-bogota  
   (o el recurso del dataset que publique el archivo .kmz)
2. En la sección de recursos, descargar el archivo .kmz (ej. *lugar_evento_agendate.kmz*).
3. Guardarlo en disco, por ejemplo:  
   `C:\data\agendate\lugar_evento_agendate.kmz`  
   (o cualquier ruta local; luego se indica con la variable de entorno.)

### Setear ENVs en PowerShell (sesión actual)

```powershell
$env:AGENDATE_SOURCE_MODE="kmz"
$env:AGENDATE_KMZ_FILE="C:\data\agendate\lugar_evento_agendate.kmz"
```

### Flujo offline completo

```powershell
npm run ingest:agendate:contexto:dry    # verificar que lee el archivo y clasifica
npm run ingest:agendate:contexto:apply # escribir en contexto_eventos
npm run ingest:eventos:incidentes -- --apply  # poblar incidentes con EVENTO canónico
npm run verify:debug                   # confirmar EVENTO > 0 y fallback=false
```

Con `AGENDATE_KMZ_FILE` configurado y el archivo en disco, la ingesta **no hace ningún fetch de red** y procesa solo el archivo local.

### Verificación BD post-ingesta (pgAdmin o psql)

```sql
SELECT tipo, COUNT(*) FROM incidentes GROUP BY tipo ORDER BY COUNT(*) DESC;
-- EVENTO debe subir de 0
```

### Tabla de variables de entorno Agéndate

| Variable                  | Valores             | Default                  | Descripción                                  |
|---------------------------|---------------------|--------------------------|----------------------------------------------|
| AGENDATE_SOURCE_MODE      | arcgis, kmz, auto  | auto                     | Fuente a usar                                |
| AGENDATE_ARCGIS_LAYER_URL | URL                | serviciosgis.../layer/4  | URL del MapServer layer                      |
| AGENDATE_KMZ_URL          | URL                | recurso datosabiertos    | URL para descargar KMZ por HTTPS             |
| AGENDATE_KMZ_FILE         | ruta absoluta      | (vacío)                  | Archivo KMZ local para modo offline          |
| AGENDATE_TIMEOUT_MS       | número             | 20000                    | Timeout fetch en ms                          |
| AGENDATE_RETRIES          | número             | 2                        | Reintentos en caso de error                  |
| AGENDATE_PAGE_SIZE        | número             | 1000                     | Features por página (ArcGIS)                 |

### Checklist "Could not connect to server / fetch failed"

- [ ] DNS OK pero TCP timeout → bloqueo de firewall/ISP/proxy
- [ ] Proxy corporativo activo → revisar HTTPS_PROXY + NO_PROXY
- [ ] Antivirus / TLS inspection → desactivar temporalmente para el host
- [ ] IPv6 vs IPv4 → forzar IPv4 con --network-family=ipv4 si aplica
- [ ] VPN activa que bloquee hosts colombianos → desactivar o excluir hosts
- [ ] Red WiFi con portal cautivo → autenticar y reintentar

### Evidencia de tu entorno

- DNS: ✅ serviciosgis → 13.92.62.227  
- TCP:443: ❌ timeout (15000 ms)  
- `curl: (28) Failed to connect ... port 443 ... Could not connect to server`

---

*Documento generado a partir de las tareas 1–6 ejecutadas en el repo; secciones 7 y 8 para diagnóstico, variables ENV, flujo resiliente, ingesta offline y checklist de conectividad.*
