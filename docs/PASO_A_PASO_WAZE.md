# Pasos para ejecutar (Windows PowerShell) — Motor tipo Waze

Ruta base del proyecto: desde la **raíz del repositorio** (donde está `package.json`).

```powershell
# Ejemplo: si clonaste en C:\Users\TuUsuario\Panorama desarrollos\Visualizador de aforos
cd "C:\Users\TuUsuario\Panorama desarrollos\Visualizador de aforos"
# o en general:
# Set-Location "<ruta-donde-esta-el-repo>"
```

---

## 1. Migraciones (una vez)

Aplicar 014 (interval_minutes, node_legs, node_turns) y 015 (has_movement_data):

```powershell
# Con psql (ajusta conexión si usas DATABASE_URL en .env)
$env:PGPASSWORD = "tu_password"
psql -h localhost -U postgres -d aforos -f server/db/migrations/014_grafo_y_interval.sql
psql -h localhost -U postgres -d aforos -f server/db/migrations/015_estudios_has_movement_data.sql
```

O desde tu cliente SQL ejecutar el contenido de cada archivo.

**Revertir (rollback):** primero 015, luego 014:
```powershell
psql -h localhost -U postgres -d aforos -f server/db/migrations/015_estudios_has_movement_data.down.sql
psql -h localhost -U postgres -d aforos -f server/db/migrations/014_grafo_y_interval.down.sql
```

---

## 2. Diagnóstico del análisis (movimiento + clases) — A)

Activar debug y probar el análisis para un estudio DIM (ej. 388):

```powershell
$env:DEBUG_AFORO = "1"
# Reiniciar el servidor API (npm run dev o node server.js), luego:
Invoke-WebRequest -Uri "http://localhost:3001/api/aforos/analisis/388" -UseBasicParsing | Select-Object -ExpandProperty Content
```

**Qué esperar en consola del servidor:**  
`[DEBUG_AFORO] sheetName:`, `headerRowIdx:`, `headers normalizados:`, `classKeys finales:`, `movementKey detectado:` (o `(ninguno)`), `sample classes keys:`, y si existe columna movimiento: `sample movement_raw (3 filas)`; si no hay movement_raw no nulos: `no existen movement_raw no nulos en este Excel`; si no hay columna: `movementKey no detectado; no hay columna movimiento/giro en este Excel`.  
**Respuesta JSON:** incluye `quality`: `{ sheetScore, headerConfidence, classKeysCount, movementDetected, intervalDetected, totalRows, validRows }`.

---

## 3. ETL DIM (estudio de ejemplo) y comprobar clases — B)

Dry-run (no escribe en BD):

```powershell
node server/scripts/etl_conteos_from_dim.js --studyId=4266 --dry-run
```

**Qué esperar:** mensaje `[ETL DIM] --dry-run: no se escribe en BD`, número de filas que se insertarían, muestra 1 fila, `Filas con interval_minutes null: N`, y si N>0 un ejemplo de fila con `interval_minutes` null. En ejecución real: `interval_minutes` válido (1–240 o null), vol_* poblados.
Ejecución real:

```powershell
node server/scripts/etl_conteos_from_dim.js --studyId=4266
```

Comprobar en BD que hay vol_* distintos de cero y no todo en vol_otros:

```sql
SELECT sentido, SUM(vol_autos) AS autos, SUM(vol_motos) AS motos, SUM(vol_buses) AS buses, SUM(vol_pesados) AS pesados, SUM(vol_bicis) AS bicis, SUM(vol_otros) AS otros, SUM(vol_total) AS total
FROM conteos_resumen WHERE estudio_id = 4266 GROUP BY sentido ORDER BY sentido;
```

---

## 4. Baseline node_legs / node_turns — C)

Obtener el `nodo_id` del estudio de ejemplo (ej. 4266): `SELECT nodo_id FROM estudios WHERE id = 4266;`

Dry-run (no escribe en BD):

```powershell
node server/scripts/build_node_turns_baseline.js --dry-run --node-id=<NODO_ID>
```

**Qué esperar:** diagnóstico `interval_minutes` por estudio (total_rows, null_count, distinct_count_non_null, min/max); si hay estudios quality_bad, listado excluidos; `node_legs que se insertarían`, `node_turns que se insertarían`, muestra de 3 turns; y **3 ejemplos de bucket** con hora correcta: `[dry-run] intervalo_ini + timebucket (3 ejemplos, zona America/Bogota):` con líneas `intervalo_ini -> timebucket`.

Ejecución real (todos los nodos o uno solo):

```powershell
node server/scripts/build_node_turns_baseline.js
# o solo un nodo:
node server/scripts/build_node_turns_baseline.js --node-id=<NODO_ID>
```

---

## 5. Llamar a la API grafo y simular cierre — D)

Reemplaza `<nodeId>` por el `node_id_externo` del nodo (ej. `171`) o por el `nodos.id` numérico.

```powershell
# Legs
Invoke-WebRequest -Uri "http://localhost:3001/api/grafo/nodos/<nodeId>/legs" -UseBasicParsing | Select-Object -ExpandProperty Content

# Turns (bucket opcional)
Invoke-WebRequest -Uri "http://localhost:3001/api/grafo/nodos/<nodeId>/turns?bucket=weekday_07:00" -UseBasicParsing | Select-Object -ExpandProperty Content

# Baseline
Invoke-WebRequest -Uri "http://localhost:3001/api/grafo/nodos/<nodeId>/baseline" -UseBasicParsing | Select-Object -ExpandProperty Content

# Simular cierre de giro (POST) — caso con turns reales → before/after
$body = '{"node_id":"<nodeId>","from_leg":"N","to_leg":"N","bucket":"weekday_07:00","closure":true}'
Invoke-WebRequest -Uri "http://localhost:3001/api/simular/cierre-giro" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing | Select-Object -ExpandProperty Content
```

**Caso con turns reales:** respuesta 200 con `before`, `after`, `delta` (closed_flow, redistributed).

**Caso sin turns (solo node_legs o nodo sin datos con movimiento):** respuesta **409** con cuerpo:
```json
{ "code": "NO_TURNS_BASELINE", "message": "No hay turns de baseline...", "node_id": ..., "timebucket": "..." }
```
Para probar el 409, usar un nodo que no tenga filas en `node_turns` para ese bucket (o no haber ejecutado baseline con estudios que tengan `has_movement_data = true`).

---

## Resumen de archivos tocados (blindaje)

| Archivo | Cambio |
|---------|--------|
| `server/utils/aforoAnalisis.js` | movementKey, movement_raw, quality, logs DEBUG_AFORO (movement_raw ejemplos / "no existen en este Excel") |
| `server/scripts/etl_conteos_from_dim.js` | interval_minutes sin NaN (validación 0/negativo/>240), --dry-run con conteo null + ejemplo, has_movement_data |
| `server/db/migrations/014_grafo_y_interval.sql` | interval_minutes, node_legs, node_turns |
| `server/db/migrations/014_grafo_y_interval.down.sql` | Rollback: DROP node_turns, node_legs, DROP COLUMN interval_minutes |
| `server/db/migrations/015_estudios_has_movement_data.sql` | has_movement_data en estudios |
| `server/db/migrations/015_estudios_has_movement_data.down.sql` | Rollback 015 |
| `server/scripts/build_node_turns_baseline.js` | Timebucket America/Bogota, quality_bad con NULL, diagnóstico por estudio, turns solo has_movement_data=true, legs desde todos, dry-run con 3 ejemplos intervalo_ini→bucket |
| `routes/simular.js` | 409 NO_TURNS_BASELINE cuando no hay turns |
| `docs/API_GRAFO.md` | Estándar timebucket + zona; 409 NO_TURNS_BASELINE |
| `docs/PASO_A_PASO_WAZE.md` | Migraciones 014+015, rollback, qué esperar A/B/C/D |
