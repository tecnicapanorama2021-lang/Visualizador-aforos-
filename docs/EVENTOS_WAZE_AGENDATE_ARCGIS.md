# Eventos Agéndate (ArcGIS) → contexto_eventos → incidentes

Ingesta de eventos culturales desde el servicio ArcGIS **"Agéndate con Bogotá"** (IDECA / Datos Abiertos Bogotá). Se escriben registros `EVENTO_CULTURAL` en `contexto_eventos`; la **fuente** distingue origen directo vs snapshot. Luego `ingest_contexto_eventos_to_incidentes` crea incidentes `tipo = 'EVENTO'` (solo con geom + start + end) para el mapa.

---

## Fuentes: AGENDATE_ARCGIS vs AGENDATE_SNAPSHOT

| Fuente | Cuándo se usa | Descripción |
|--------|----------------|-------------|
| **AGENDATE_ARCGIS** | Conexión directa a `serviciosgis.catastrobogota.gov.co` OK | Eventos descargados en vivo desde el MapServer (lugares + queryRelatedRecords). |
| **AGENDATE_SNAPSHOT** | ArcGIS no accesible (red bloqueada) y existe snapshot válido | Eventos cargados desde `public/data/agendate_eventos_snapshot.json` (export manual desde un entorno con acceso). |
| **AGENDATE_SNAPSHOT_TABLA7** | Red bloqueada; JSON tabla 7 descargado en navegador y subido al servidor | Eventos desde `agendate_eventos_tabla7_raw.json` → normalizado → ingest con venue match contra LUGAR_EVENTO en BD (sin llamadas a ArcGIS). |

No se mezclan: cada registro en `contexto_eventos` tiene una sola `fuente`. Así se puede auditar y depurar por origen. Ambas fuentes producen `EVENTO_CULTURAL`; `ingest:eventos:incidentes` no filtra por fuente y solo exige `geom IS NOT NULL` + fechas para crear incidentes.

---

## URL base del servicio ArcGIS

```
https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/participacioncomunal/MapServer
```

Configuración por ENV (opcional):

| Variable | Default | Descripción |
|----------|--------|-------------|
| `AGENDATE_ARCGIS_BASE` | (URL anterior) | Base del MapServer |
| `AGENDATE_LUGARES_LAYER_ID` | 4 | ID de la capa "Agendate con Bogota" (lugares) |
| `AGENDATE_EVENTOS_RELATION_ID` | 0 | ID de la relación con la tabla Eventos_Agendate |
| `AGENDATE_DIAS_FUTURO` | 60 | Ventana temporal: eventos con inicio en [hoy, hoy + N días] |
| `AGENDATE_DURACION_DEFAULT_HORAS` | 3 | Si no hay fecha fin, se suma esta duración a fecha_inicio |
| `AGENDATE_ARCGIS_PAGE_SIZE` | 1000 | Registros por página en query de lugares |
| `AGENDATE_ARCGIS_TIMEOUT_MS` | 25000 | Timeout de fetch |
| `AGENDATE_ARCGIS_RETRIES` | 2 | Reintentos por request |

---

## Ejemplo de query a lugares (layer 4)

**Endpoint:** `GET /MapServer/4/query`

**Parámetros:**

- `f=json`
- `where=1=1`
- `outFields=OBJECTID,GLOBALID,EVNLUGAR`
- `outSR=4326`
- `returnGeometry=true`
- `resultRecordCount=1000`
- `resultOffset=0` (paginar incrementando)

**Ejemplo URL:**

```
https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/participacioncomunal/MapServer/4/query?f=json&where=1%3D1&outFields=OBJECTID,GLOBALID,EVNLUGAR&outSR=4326&returnGeometry=true&resultRecordCount=1000&resultOffset=0
```

**Respuesta (resumida):** `features[]` con `attributes.{ OBJECTID, GLOBALID, EVNLUGAR }` y `geometry.{ x, y }` (lon/lat en 4326).

---

## Ejemplo de queryRelatedRecords (eventos por lugar)

**Endpoint:** `GET /MapServer/4/queryRelatedRecords`

**Parámetros:**

- `f=json`
- `relationshipId=0`
- `objectIds=1,2,3` (OBJECTIDs de los lugares; en lotes si hay muchos)
- `outFields=*`
- `returnGeometry=false`

**Ejemplo URL:**

```
https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/participacioncomunal/MapServer/4/queryRelatedRecords?f=json&relationshipId=0&objectIds=1&outFields=*&returnGeometry=false
```

**Respuesta:** `relatedRecordGroups[]` con `objectId` (del lugar) y `relatedRecords[]` con `attributes` de la tabla relacionada Eventos_Agendate.

---

## Campos mapeados

| contexto_eventos / uso | Campo ArcGIS (Eventos_Agendate) | Notas |
|------------------------|----------------------------------|-------|
| **titulo** → `descripcion` | `EVNEVENTO` | Nombre del evento |
| **lugar_nombre** | `EVNLUGAR` del lugar (layer 4) | Se toma del lugar enlazado por OBJECTID / GLOBALID |
| **fecha_inicio** | `EVDINICIAL` | Fecha/hora inicio (epoch ms en JSON) |
| **fecha_fin** | `EVDFINAL` | Fecha/hora cierre; si falta, fecha_inicio + 3h por defecto |
| **GLOBALID (lugar)** | En layer 4: `GLOBALID`; en evento: `GUID_2` | Identificador del lugar; usado para geom y para `origen_id` |

La geometría del evento es la del **lugar** (layer 4): `geometry.x`, `geometry.y` en 4326.

---

## LUGAR_EVENTO y join con tabla 7 (modo red bloqueada)

Para que el ingest de eventos desde la **tabla 7** (snapshot manual) pueda asignar geom por **KEY-match**, los registros `LUGAR_EVENTO` en BD deben tener en `datos_extra` (o en el raw que se persiste):

- **GlobalID** (o **GUID_2** si el servicio lo expone)
- **OBJECTID** (si existe en el layer de lugares)
- **EVNLUGAR** (nombre limpio del venue)

El script que ingesta lugares (`ingest_agendate_bogota_to_contexto_eventos.js`, desde ArcGIS layer 4 o KMZ) debe guardar en `datos_extra` todo el objeto `properties`/attributes que incluya estos campos. **Sin GlobalID/OBJECTID en datos_extra de LUGAR_EVENTO, el join KEY no es posible** y los eventos de tabla 7 quedarán sin geom (regla Waze: no inventar geometrías). En ese caso solo se permite geom por NAME-match (EVNLUGAR / nombre de escenario) si el nombre en el raw de tabla 7 coincide con el titulo del lugar.

---

## origen_id

Idempotencia en `contexto_eventos`: un solo registro por combinación (fuente, origen_id).

```
origen_id = SHA256( globalId_lugar + "|" + fecha_inicio_iso + "|" + titulo ).slice(0, 32)
```

- `globalId_lugar`: GLOBALID del lugar (layer 4).
- `fecha_inicio_iso`: ISO string de la fecha de inicio del evento.
- `titulo`: nombre del evento (EVNEVENTO).

Mismo lugar + misma fecha inicio + mismo título → mismo `origen_id` → UPSERT.

---

## Validez del snapshot

El archivo `public/data/agendate_eventos_snapshot.json` se usa solo si cumple:

1. **Schema:** `{ source, exportedAt, window_dias, events: [] }`.
2. **Conteos:** se exige que al menos **80%** de los eventos tengan fecha válida y al menos **80%** tengan `lon`/`lat` (geom).  
   - Si `con_fecha/total` o `con_lonlat/total` es menor a 0.8 → el snapshot se considera **inválido**.

**Comportamiento:**

- **--apply:** Si ArcGIS falla y no hay snapshot, o el snapshot está vacío o inválido → **exit 1** y mensaje claro (snapshot inválido; regenerar con `npm run export:agendate:arcgis:snapshot`).
- **--dry:** Si ArcGIS falla y no hay snapshot válido → **exit 0** con warning grande (no se inserta nada).

Así el pipeline falla de forma explícita cuando no hay datos usables y se evita insertar datos de baja calidad.

---

## Si falla la ingesta (snapshot inválido o faltante)

1. **Snapshot no encontrado:** Ejecutar el export en un entorno con acceso a ArcGIS (VM, otra red, CI) y copiar `public/data/agendate_eventos_snapshot.json` al repo/servidor donde corre la ingesta.
2. **Snapshot inválido (porcentaje &lt; 80% con fecha o con lon/lat):** Regenerar el snapshot en el entorno con acceso:
   ```bash
   npm run export:agendate:arcgis:snapshot
   ```
   y volver a copiar el archivo. Comprobar que el export escriba eventos con `fecha_inicio` y `lon`/`lat` correctos.
3. **ArcGIS responde pero quieres usar snapshot igualmente:** No se puede forzar snapshot si ArcGIS está disponible; la ingesta siempre intenta ArcGIS primero.

---

## Comandos de uso

```bash
# 0) Diagnóstico de red (Windows): proxy/PAC si el navegador abre pero curl/Node fallan
npm run net:diag:agendate:arcgis

# 1) Dry-run: solo resumen (lugares, eventos raw, eventos con lugar+fecha, skipped)
npm run ingest:agendate:arcgis:dry

# 2) Aplicar: UPSERT en contexto_eventos (EVENTO_CULTURAL, fuente AGENDATE_WEB)
npm run ingest:agendate:arcgis:apply

# 3) Pasar contexto_eventos → incidentes (EVENTO) para el mapa
npm run ingest:eventos:incidentes -- --apply
```

**Fuente alternativa cuando la red bloquea ArcGIS:** si `ingest:agendate:arcgis` no puede conectar, usa automáticamente `public/data/agendate_eventos_snapshot.json` si existe (ver sección "Red bloqueada"). Para generar el snapshot en un entorno con acceso:

```bash
npm run export:agendate:arcgis:snapshot
```

**Otra fuente de eventos (sin ArcGIS):** `npm run ingest:eventos:web:apply` (scraper bogota.gov.co / idartes) es independiente; se puede ejecutar además para poblar más EVENTO_CULTURAL.

---

## Problemas de red

### Caso: el navegador abre la URL pero curl / Node dan timeout

**Síntoma:** En el navegador, `https://serviciosgis.catastrobogota.gov.co/...` abre bien; en cambio `curl.exe` o el script de ingesta Node fallan con:

- `curl: (28) Failed to connect to serviciosgis.catastrobogota.gov.co port 443 after ... ms: Could not connect to server`
- O en Node: `fetch failed`, `ECONNREFUSED`, `ETIMEDOUT`.

**Causa:** El navegador usa **proxy** o **PAC** (Proxy Auto-Configuration) configurado en el sistema; **curl y Node no usan por defecto el proxy del sistema** en Windows, por lo que intentan conexión directa y fallan (timeout o bloqueo).

**Qué hacer:**

1. **Diagnóstico oficial (Windows):** ejecute el script que revisa proxy/PAC y sugiere pasos:
   ```bash
   npm run net:diag:agendate:arcgis
   ```
   (Ejecuta `server/scripts/net/diagnose_agendate_arcgis_proxy.ps1`: `netsh winhttp show proxy`, registro ProxyEnable/ProxyServer/AutoConfigURL, Test-NetConnection, curl sin proxy, y sugerencias según lo detectado.)

2. **Solución A — Usar proxy manualmente con Node/curl**  
   Si tiene la URL del proxy (ej. la misma que usa el navegador o la que indica TI):
   ```bash
   set HTTPS_PROXY=http://proxy.ejemplo.gov.co:8080
   set HTTP_PROXY=http://proxy.ejemplo.gov.co:8080
   npm run ingest:agendate:arcgis:dry
   ```
   En PowerShell:
   ```powershell
   $env:HTTPS_PROXY = "http://proxy.ejemplo.gov.co:8080"
   $env:HTTP_PROXY = "http://proxy.ejemplo.gov.co:8080"
   npm run ingest:agendate:arcgis:dry
   ```
   Node y curl respetan `HTTPS_PROXY` / `HTTP_PROXY`. No interpretan PAC; si solo tiene PAC, necesita la URL real del proxy (abriendo la PAC en el navegador o pidiéndola a TI).

3. **Solución B — Ejecutar la ingesta en un entorno con salida directa**  
   Ejecutar `ingest:agendate:arcgis:dry` / `apply` en un servidor, VM o CI que tenga salida directa a Internet (sin proxy corporativo).

4. **Solución C — Allowlist en TI**  
   Pedir a TI permitir tráfico saliente a `serviciosgis.catastrobogota.gov.co:443` (HTTPS) para la red o para los procesos Node/script que ejecutan la ingesta.

---

## Red bloqueada (sin proxy: Test-NetConnection y curl fallan)

Cuando **no hay proxy ni PAC** pero la red bloquea el host (firewall, política, allowlist): `Test-NetConnection` a `serviciosgis.catastrobogota.gov.co:443` falla y `curl` da timeout (28). El pipeline de eventos no debe quedar “muerto”: se usa **fuente alternativa por snapshot** o allowlist.

### Cómo detectar bloqueo real

1. Ejecutar diagnóstico:
   ```bash
   npm run net:diag:agendate:arcgis
   ```
2. Si en la salida:
   - **WinHTTP:** Direct access (no proxy).
   - **Registro:** ProxyEnable=0, sin ProxyServer ni AutoConfigURL.
   - **Test-NetConnection:** FALLO (TcpTestSucceeded: False).
   - **curl:** exit 28 (Connection timed out).

   → Es **bloqueo de red** (no proxy). Node y la ingesta directa a ArcGIS fallarán.

### Solución A — Allowlist en TI

Pedir a TI que permita tráfico saliente a:

- **Host:** `serviciosgis.catastrobogota.gov.co`
- **Puerto:** 443 (HTTPS)

Para la red del equipo o del servidor donde corre la ingesta. Tras el cambio, en ese entorno:

```bash
npm run ingest:agendate:arcgis:dry
npm run ingest:agendate:arcgis:apply
npm run ingest:eventos:incidentes -- --apply
```

### Modo red bloqueada: tabla 7 manual (sin ArcGIS ni snapshot export)

Cuando la red no puede acceder a `serviciosgis.catastrobogota.gov.co` y **no** se dispone de un snapshot exportado por `export:agendate:arcgis:snapshot`, se puede usar el flujo **tabla 7 manual**: el JSON de la tabla de eventos (tabla 7) se descarga desde el navegador (con acceso) y se sube al servidor; luego se normaliza, se ingesta a `contexto_eventos` con **venue matching** contra los LUGAR_EVENTO ya existentes en BD (sin traer lugares de ArcGIS).

**Rutas canónicas:**

- Raw (descargado): `public/data/agendate_eventos_tabla7_raw.json`
- Normalizado: `public/data/agendate_eventos_snapshot.json`

**Flujo en el servidor (orden):**

1. **Copiar raw desde Descargas** (en el equipo donde se descargó el JSON):
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/setup/copy_agendate_raw_from_downloads.ps1
   ```
   Busca en `%USERPROFILE%\Downloads` archivos como `*agendate*7*.json`, `*query*.json`, etc., y copia el más reciente a `public/data/agendate_eventos_tabla7_raw.json`.

2. **Normalizar a snapshot** (ventana por defecto 60 días):
   ```bash
   npm run import:agendate:tabla7:snapshot:dry
   npm run import:agendate:tabla7:snapshot:apply
   ```

3. **Ingestar a contexto_eventos con venue match** (LUGAR_EVENTO en BD):
   ```bash
   npm run ingest:agendate:tabla7:contexto:dry
   npm run ingest:agendate:tabla7:contexto:apply
   ```

4. **Convertir a incidentes (canónico):**
   ```bash
   npm run ingest:eventos:incidentes -- --apply
   ```

5. **Verificación:**
   ```bash
   npm run verify:agendate:eventos
   ```

**Criterios esperados:**

- `contexto_eventos` (fuente `AGENDATE_SNAPSHOT_TABLA7`, tipo `EVENTO_CULTURAL`): total > 0.
- Listos (geom + fecha_inicio + fecha_fin) > 0 (según venue match).
- `incidentes` tipo EVENTO: se espera que suba (p. ej. > 3); si hay 0 activos/próximos en 7 días, el verify lo indica como **info**, no error.

**Scripts implicados:**

- `server/scripts/import/import_agendate_tabla7_raw_to_snapshot.js`: lee raw, detecta `features`/`records`/`results`, extrae EVNEVENTO, EVDINICIAL, EVDFINAL, GUID_2, genera `origen_id` y escribe snapshot.
- `server/scripts/ingest/ingest_agendate_snapshot_tabla7_to_contexto_eventos.js`: lee snapshot, hace venue match contra LUGAR_EVENTO (por `lugar_key` y por nombre normalizado), UPSERT en `contexto_eventos` por `(origen_id, fuente)`.

Todo es idempotente; LUGAR_EVENTO no se convierte en incidente; los eventos sin geom quedan en contexto_eventos y no generan incidentes.

---

### Solución B — Export snapshot en VM + ingest snapshot local

Si no hay allowlist y no pueden dar salida directa al host, usar un entorno con acceso (otra red, VM, CI) para generar el snapshot y luego ingestar desde archivo en el repo/servidor interno.

**Paso 1 — En un entorno con acceso a ArcGIS** (VM, otro equipo, CI):

```bash
git clone <repo>   # o ya tener el repo
cd "<ruta-raiz-del-repo>"   # carpeta que contiene package.json
npm ci
npm run export:agendate:arcgis:snapshot
```

Esto escribe `public/data/agendate_eventos_snapshot.json` (eventos de los próximos N días, mismo formato que la ingesta).

**Paso 2 — Copiar el archivo al repo/servidor interno:**

- Copiar `public/data/agendate_eventos_snapshot.json` al mismo path en el clone/servidor donde corre la ingesta (por ejemplo vía SCP, USB, o commit en rama y pull en interno).

**Paso 3 — En el entorno interno (red bloqueada):**

```bash
npm run ingest:agendate:arcgis:dry    # usa snapshot si ArcGIS falla
npm run ingest:agendate:arcgis:apply # escribe contexto_eventos desde snapshot
npm run ingest:eventos:incidentes -- --apply
```

La ingesta detecta que ArcGIS no es accesible y carga automáticamente `public/data/agendate_eventos_snapshot.json` si existe. Los eventos con geom en el snapshot generan incidentes (regla canónica: geom + start + end); los sin geom solo quedan en contexto_eventos y no contaminan incidentes.

**Comandos exactos resumidos:**

| Dónde | Comando |
|-------|--------|
| Entorno con acceso | `npm run export:agendate:arcgis:snapshot` |
| Copiar | `public/data/agendate_eventos_snapshot.json` → mismo path en interno |
| Entorno bloqueado | `npm run ingest:agendate:arcgis:apply` luego `npm run ingest:eventos:incidentes -- --apply` |

---

## Validación rápida

1. `npm run ingest:agendate:arcgis:dry` → revisar resumen (eventos_con_lugar_y_fecha, skipped_sin_lugar, skipped_sin_fecha).
2. `npm run ingest:agendate:arcgis:apply`
3. `npm run ingest:eventos:incidentes -- --apply`
4. **Prueba de oro (evidencia SQL):** `npm run verify:agendate:eventos`  
   Ejecuta los tres chequeos (contexto_eventos listos, incidentes.EVENTO, activos/próximos 7d) e interpretación. Si *listos* > 0 y *eventos_canonicos* = 0 → falla (revisar ingest:eventos:incidentes).
5. `npm run verify:debug` → conteos EVENTO deben reflejar los nuevos (y los de AGENDA_MANUAL u otras fuentes).
6. En el mapa: vigencia **Activos**, subfiltro **Activos ahora** o **Próximos 7 días**; capa **Eventos** debe mostrar más puntos; popup con título, lugar, fechas y fuente derivada de contexto_eventos/incidentes.

### Validación en UI (sin mismatch)

En DevTools → Network, al poner **Vigencia = Activos** y **Eventos = Próximos 7 días**:

- La petición a `/api/eventos/nodos?vigencia=activos&eventos_filter=upcoming` debe devolver un GeoJSON con `features`.
- `response.features.length` debe coincidir con el número que muestra el chip de Eventos (salvo lo que se oculte por el filtro de búsqueda). Es decir: *received* = `features.length`; *visible* = lo que muestra el chip tras búsqueda. No debe haber mismatch por reglas de negocio (el panel "Front vs API stats" usa esa misma lógica).
