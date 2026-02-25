# Desarrollo Local — Panorama Ingeniería

Documentación canónica de dev/ops. **README único** en la raíz del proyecto; el resto de documentación en **docs/** y **docs/referencia/** (docs de referencia movidos desde la raíz). Ver también: **ARCHITECTURE.md** (visión Waze/incidentes), **RUNBOOK_INGEST.md** (ingestas y verificación), **LEGACY.md** (deprecados).

## Puertos oficiales

**API:**  
http://localhost:3001

**Frontend:**  
http://localhost:5173

Estos puertos **son fijos**. No deben cambiar.

---

## Arranque oficial

**Único arranque recomendado** (API + front):

```powershell
.\scripts\dev.ps1
```

O desde cualquier shell:

```bash
npm run dev
```

(Alternativa: `npm run dev:all` hace lo mismo que dev.ps1.)

(Alternativa: `.\scripts\start-dev.ps1` hace lo mismo.)

---

## Qué hace el script

1. Libera el puerto **3001** si está ocupado.
2. Libera el puerto **5173** si está ocupado.
3. Inicia el backend en **3001**.
4. Inicia el frontend en **5173** con `strictPort`.
5. Espera a que 3001 y 5173 estén en LISTENING e imprime las URLs.
6. **Liberar puertos a mano:** `npm run kill:ports` (Windows: PowerShell/netstat; otros: aviso).

---

## Probar 388

Tras arrancar con `.\scripts\dev.ps1` o `npm run dev:all`:

- **UI:** http://localhost:5173/aforos  
- **Directo:** http://localhost:5173/aforos/analisis/388  
- **API:** http://localhost:3001/api/aforos/analisis/388  

Debe renderizar el resumen. Si hay warnings de calidad (suma/gaps/clases), se muestran en el bloque “Calidad / validaciones” sin romper la UI.

---

## Migraciones (orden: 001 → … → 023)

**Único comando oficial para aplicar todas las migraciones (001–023):**

```powershell
npm run db:migrate
```

Requiere `DATABASE_URL` o `PGHOST`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` en `.env` (raíz o server). El script carga `.env` desde la raíz.

**Legacy (solo si no puede usar Node):** `scripts/migrate.ps1` aplica **solo** 014, 016, 017, 018, 019, 020. **No** aplica 001–013 ni 021–023 (incidentes). Para migración completa use siempre `npm run db:migrate`.

```powershell
$env:DATABASE_URL = "postgresql://postgres:TU_PASSWORD@localhost:5432/aforos"
npm run db:migrate
```

**Idempotencia:** Las migraciones son idempotentes donde corresponde (016, 017, 018, 019, 020, 021, 022, 023). Ejecutar dos veces no debe fallar.

**Verificación (schema-check):**  
`node server/scripts/check_db_schema.js` debe dar **exit 0** y mostrar “interval_minutes: OK” y “unique ini_fin (columns match): OK”. Si da **exit 1**, el mensaje indica qué falta (aplica 014 o 016).

**Criterios esperados:**  
- **Migraciones 2 veces:** ambas sin error (016, 017, 018 y 019 idempotentes).  
- **schema-check:** exit 0 y "Esquema listo para ETL --write"; si exit 1, indica qué falta.  
- **ETL dry-run:** "Conteos upsert total: N", no toca BD.  
- **ETL write 2 veces:** idempotente; 2ª vez Actualizados > 0, Insertados 0, sin duplicados.

---

## Migración 017 — tipo_nodo en nodos (clasificación en mapa)

La migración **017_add_tipo_nodo_to_nodos.sql** añade la columna `tipo_nodo` a la tabla `nodos`, crea el índice y hace un backfill según `nodos.fuente`. Valores: `AFORO_MANUAL`, `OBRA`, `EVENTO`, `CONCIERTO`, `MANIFESTACION`, `SEMAFORO`, `OTROS`. **EXTERNO** queda `OTROS` hasta que existan reglas o fuentes adicionales.

### A) Aplicar migración

Desde la carpeta del proyecto (raíz del repo, donde está `package.json`):

```powershell
cd "<ruta-del-proyecto>"
$env:DATABASE_URL = "postgresql://postgres:TU_PASSWORD@localhost:5432/aforos"
.\scripts\migrate.ps1 -DbUrl $env:DATABASE_URL
```

(La 017 se ejecuta junto con 014 y 016.)

### B) Verificar BD

Distribución por tipo:

```sql
SELECT tipo_nodo, COUNT(*) FROM nodos GROUP BY 1 ORDER BY 2 DESC;
```

Sanity (no debe haber nulos):

```sql
SELECT COUNT(*) FROM nodos WHERE tipo_nodo IS NULL;
```

Debe devolver **0**.

### C) Verificar API

Con el backend en marcha (http://localhost:3001), en PowerShell:

```powershell
$resp = Invoke-RestMethod "http://localhost:3001/api/aforos/nodos"
$resp.features[0].properties | ConvertTo-Json -Depth 5
```

Debe incluir la clave **tipo_nodo** (por ejemplo `"tipo_nodo": "AFORO_MANUAL"` o `"OTROS"`).

### D) Verificar UI

1. Abrir http://localhost:5173/aforos  
2. Confirmar que el panel izquierdo muestra **grupos colapsables** (Movilidad, Eventos, Infraestructura, Otros) y **chips con contador** por categoría.  
3. Desactivar "Otros": los nodos de tipo Otros deben desaparecer del mapa.  
4. Pulsar **Solo Aforos**: solo deben verse nodos AFORO_MANUAL.  
5. Usar la **búsqueda** (nombre, dirección o id): los contadores y los puntos visibles deben reflejar el filtrado.

---

## Migración 018 — Reglas de clasificación de nodos

La migración **018_nodos_categoria_rules.sql** crea la tabla **nodos_categoria_rules** y las columnas de trazabilidad en **nodos**. La **019** deshabilita la regla ckan-⇒OTROS y añade reglas virtuales por estudios (AFORO_MANUAL si tiene estudios, INFRAESTRUCTURA si no).

### Aplicar migraciones

La 018 y 019 se ejecutan con el resto al correr `.\scripts\migrate.ps1 -DbUrl $env:DATABASE_URL`.

### Aplicar reglas a nodos (clasificación por semántica)

Tras las migraciones, ejecutar (recomendado con reset para reflejar reglas virtuales):

```powershell
# Desde la raíz del proyecto
node server/scripts/apply_nodos_rules.js --reset-defaults --apply
```

Sin reset (solo reaplica sobre nodos no MANUAL): `node server/scripts/apply_nodos_rules.js --apply`. Idempotente: ejecutar dos veces debe dar el mismo resultado.

### Verificar distribución en BD

En **psql** o pgAdmin:

```sql
SELECT tipo_nodo, COUNT(*) FROM nodos GROUP BY 1 ORDER BY 2 DESC;
SELECT tipo_nodo_source, COUNT(*) FROM nodos GROUP BY 1 ORDER BY 2 DESC;
```

Se espera AFORO_MANUAL para nodos con estudios, INFRAESTRUCTURA para nodos sin estudios (red vial), OTROS residual.

### Verificar API nodos

En PowerShell:

```powershell
$r = Invoke-RestMethod "http://localhost:3001/api/aforos/nodos"
$r.features[0].properties | ConvertTo-Json -Depth 10
```

Debe incluir **tipo_nodo**, **tipo_nodo_source**, **tipo_nodo_confidence**, **tipo_nodo_rule_id**. Para administrar reglas: **GET** `http://localhost:3001/api/nodos/rules`, **POST** `/api/nodos/rules/apply` con body `{ "dryRun": true }` o `{ "dryRun": false }`.

---

## Migración 021 — Tablas canónicas (fuente única para capas)

La migración **021_canonical_capas.sql** crea las tablas **obras_canonica** y **eventos_canonica** con geometría propia (SRID 4326), sin depender de `nodos.id`. Son la **fuente única** para los endpoints `/api/obras/nodos`, `/api/eventos/nodos` y `/api/manifestaciones/nodos`. Taxonomía: OBRA solo en obras_canonica; EVENTO_CULTURAL, MANIFESTACION, CIERRE_VIA en eventos_canonica (evitando que "Construcción" aparezca en la capa Eventos).

**Aplicar migración:** igual que el resto (`.\scripts\migrate.ps1 -DbUrl $env:DATABASE_URL` o `npm run db:migrate`).

**Ingesta (idempotente):**

1. **Obras** desde `public/data/calendario_obras_eventos.json`:
   ```powershell
   npm run ingest:obras:dry    # solo muestra cuántos se procesarían
   npm run ingest:obras        # aplica upsert por (source_system, source_id)
   ```

2. **Eventos** desde tabla `contexto_eventos` (OBRA → obras_canonica; EVENTO_CULTURAL/MANIFESTACION/CIERRE_VIA → eventos_canonica):
   ```powershell
   npm run ingest:eventos:dry
   npm run ingest:eventos
   ```

Ejecutar los ingest dos veces no duplica filas (ON CONFLICT actualiza). **Verificación de conteos y sanity:**

```powershell
npm run verify:canon
```

Comprueba que los conteos de GET /api/obras/nodos, /api/eventos/nodos, /api/manifestaciones/nodos coinciden con las tablas canónicas y que ningún ítem OBRA está en eventos_canonica.

**Auditoría:** GET /api/debug/capas-sources-audit devuelve `canonical` (obras_canonica, eventos_canonica por tipo) y `tablas_020` (obras, eventos_urbanos, semaforos legacy).

---

## Migración 022 — Incidentes canónicos (fuente única tipo Waze)

La migración **022_incidentes_canonicos.sql** crea la tabla **incidentes** (fuente única para obras, eventos, manifestaciones, cierres, conciertos) y **incidentes_sources** (auditoría de payload por fuente). Sin TTL; estado ACTIVO/PROGRAMADO/FINALIZADO por datos.

**Aplicar migración:** igual que el resto (`.\scripts\migrate.ps1 -DbUrl $env:DATABASE_URL` o `npm run db:migrate`).

**Ingesta idempotente (orden recomendado):**

1. **Obras** desde `public/data/calendario_obras_eventos.json` → incidentes tipo OBRA:
   ```powershell
   npm run ingest:obras:incidentes:dry    # dry-run
   npm run ingest:obras:incidentes        # aplicar
   ```

2. **Eventos** desde tabla `contexto_eventos` (geom IS NOT NULL) → incidentes (EVENTO/MANIFESTACION/OBRA/CIERRE_VIA):
   ```powershell
   npm run ingest:eventos:incidentes:dry  # dry-run
   npm run ingest:eventos:incidentes      # aplicar
   ```

Ejecutar ambos ingest dos veces no duplica filas (upsert por `fuente_principal` + `source_id`).

**Verificación:**

```powershell
# Conteos por tipo y fuente
Invoke-RestMethod http://localhost:3001/api/debug/incidentes-stats | ConvertTo-Json

# Coincidencia: obras en incidentes = features en /api/obras/nodos
$obras = (Invoke-RestMethod "http://localhost:3001/api/obras/nodos").features.Count
$ev = (Invoke-RestMethod "http://localhost:3001/api/eventos/nodos").features.Count
$man = (Invoke-RestMethod "http://localhost:3001/api/manifestaciones/nodos").features.Count
Write-Host "Obras: $obras | Eventos: $ev | Manifestaciones: $man"
```

**Diagnóstico:** GET /api/debug/incidentes-stats devuelve `by_tipo`, `by_fuente`, `con_geom`, `sin_geom`.

---

## Migración 020 — Capas multicapa (nodos_layers, obras, eventos_urbanos, semaforos)

La migración **020_multicapas.sql** crea las tablas de capas por nodo: **nodos_layers** (puente nodo–capa), **obras**, **eventos_urbanos**, **semaforos**, e inserta datos demo (1 obra, 1 evento MANIFESTACION, 1 semáforo) de forma idempotente.

### Aplicar migración

```powershell
# Desde la raíz del proyecto (donde está package.json)
.\scripts\migrate.ps1 -DbUrl $env:DATABASE_URL
```

(La 020 se ejecuta con el resto al correr el script.)

### Sincronizar presencia de capas (nodos_layers)

Tras la 020, ejecutar el job que rellena **nodos_layers** desde estudios, obras, eventos_urbanos y semaforos:

```powershell
# Desde la raíz del proyecto
node server/scripts/sync_nodos_layers.js --dry-run
node server/scripts/sync_nodos_layers.js --apply
```

Idempotente: puede ejecutarse varias veces sin duplicar.

### Capas reales — Endpoints GeoJSON por capa

El mapa usa **capas reales**: cada categoría es su propia colección GeoJSON (sus propios markers), con color y popup propios. **No hay tabs en el popup**: un marker de Aforos solo muestra Aforos; uno de Obras solo Obras, etc.

**Endpoints (todos devuelven `{ type: "FeatureCollection", features: [...] }`). Fuente única canónica: tabla incidentes (022) para obras/eventos/manifestaciones/conciertos; fallback a obras_canonica/contexto_eventos/020 si incidentes está vacío.**

| Endpoint | Contenido | properties.layerType |
|----------|-----------|----------------------|
| GET /api/aforos/nodos | Solo nodos con estudios (aforos) | AFOROS |
| GET /api/obras/nodos | **incidentes** tipo OBRA (fallback: obras_canonica/calendario) | OBRAS |
| GET /api/eventos/nodos | **incidentes** tipo EVENTO (fallback: contexto_eventos) | EVENTOS |
| GET /api/manifestaciones/nodos | **incidentes** tipo MANIFESTACION (fallback: contexto_eventos) | MANIFESTACIONES |
| GET /api/conciertos/nodos | **incidentes** tipo EVENTO + subtipo CONCIERTO (fallback: eventos_urbanos) | CONCIERTOS |
| GET /api/semaforos/nodos | Semáforos (020, JOIN nodos) | SEMAFOROS |
| GET /api/base/nodos | Nodos sin estudios/obras 020/eventos_urbanos/semáforos | BASE |

**Estudios por nodo (para popup Aforos):**  
GET /api/aforos/nodo/:nodoId/estudios — devuelve `{ studies: [ { dim_id, ... } ] }` para "Ver análisis".

**Taxonomía:** Eventos y manifestaciones se clasifican por keywords (server/utils/capasTaxonomy.js), no solo por `tipo`. MANIFESTACIONES: manifestación, marcha, protesta, bloqueo, etc. EVENTOS: resto (incl. subtype CONCIERTO si hay concierto/festival/show).

**Vigencia:** Params `?active=1` o `?from=YYYY-MM-DD&to=YYYY-MM-DD` en obras/eventos/manifestaciones. Properties: `start_at`, `end_at` (ISO).

**Diagnóstico:**  
GET /api/debug/capas-stats — conteos totales.  
GET /api/debug/incidentes-stats — conteos por tipo/fuente y con/sin geom (fuente única 022).  
GET /api/debug/capas-temporal-stats?active=1 — conteos con filtro activos (para comparar con front en modo Activos).

**Probar endpoints (PowerShell):**

```powershell
Invoke-RestMethod http://localhost:3001/api/debug/capas-stats | ConvertTo-Json
Invoke-RestMethod "http://localhost:3001/api/debug/capas-temporal-stats?active=1" | ConvertTo-Json
(Invoke-RestMethod "http://localhost:3001/api/manifestaciones/nodos?active=1").features.Count
(Invoke-RestMethod "http://localhost:3001/api/eventos/nodos?active=1").features.Count
```

Cada feature tiene `properties.layerType`, `start_at`/`end_at` en capas temporales.

### Verificar UI (capas reales)

1. **http://localhost:5173/aforos** — Chips: Aforos, Obras, Eventos (incl. conciertos), Manifestaciones, Semáforos (o "Semáforos (Demo)"), Base. Toggle **Activos** (hoy+7d) / **Histórico**.
2. **Taxonomía:** "Manifestaciones en la Caracas" (o con keywords marcha/protesta) debe estar en chip Manifestaciones, no en Eventos.
3. **Filtros:** Solo Eventos activa eventos+conciertos. Popup sin tabs; Eventos muestra subtipo y fechas; Base: "Nodo de referencia (sin datos asociados)".
4. **Dev:** "Front vs API stats: OK" con capas-stats (Histórico) o capas-temporal-stats?active=1 (Activos).

---

## Diagnóstico multicapa

Si en /aforos todo aparece como "Infraestructura/Base", usar estos pasos para determinar la causa sin cambiar lógica.

**Si /api/debug/* da 404 (Cannot GET):** estás usando un backend antiguo o un entrypoint distinto. Reinicia el backend desde la raíz del proyecto para que cargue las rutas de diagnóstico.

**Reinicio (comandos exactos):**

```powershell
# Desde la raíz del proyecto (carpeta con package.json)
node scripts/kill-ports.js
.\scripts\dev.ps1
```

**Verificación:** tras arrancar, el backend debe mostrar en consola `[BOOT] Backend entrypoint:` y `[BOOT] NODE_ENV:`. Luego:

```powershell
Invoke-RestMethod http://localhost:3001/api/debug/ping
```

Debe devolver `{ "ok": true, "time": "..." }`. Si responde 200, los endpoints de diagnóstico están montados.

**Verificación automática (script):**

```powershell
npm run verify:debug
```

Si algún endpoint no responde 200, el script imprime qué falló y recomienda reiniciar.

**Pasos de diagnóstico:**

1. **Reiniciar el backend** (comandos de arriba) para que los endpoints de diagnóstico y logs estén activos.

2. **Abrir en el navegador:**
   - http://localhost:3001/api/debug/capas-stats  
     (debe devolver `aforos`, `obras`, `eventos`, `manifestaciones`, `conciertos`, `semaforos`, `base`)
   - http://localhost:3001/api/debug/layers-summary-stats  
     (legacy: `total_nodes`, `aforos_true`, etc.)
   - http://localhost:3001/api/debug/estudios-relation  
     (debe devolver `total_estudios`, `estudios_con_nodo_id`, `nodos_con_estudios`, `nodos_distintos_con_estudios`)

3. **Abrir /aforos** (http://localhost:5173/aforos) y revisar:
   - **Fuente de datos** (encima del panel de filtros): debe decir **API (capas reales)**.
   - **Network**: peticiones a `/api/aforos/nodos`, `/api/obras/nodos`, `/api/eventos/nodos`, etc.; cada una debe devolver FeatureCollection con `properties.layerType`.
   - **Chips:** los contadores deben coincidir con GET /api/debug/capas-stats (en dev aparece "Front vs API stats: OK" o "Mismatch").

4. **Interpretación:**
   - **CASO A** (aforos_true > 0 en stats): la API está bien; el problema es frontend (filtro o que está usando fallback).
   - **CASO B** (aforos_true = 0 y estudios_con_nodo_id = 0): estudios no están vinculados a nodos.
   - **CASO C** (aforos_true = 0 pero estudios_con_nodo_id > 0): el EXISTS en la API no encuentra datos; revisar relación/columna.

**Verificación obligatoria (capas multicapa):**

- Abrir http://localhost:5173/aforos y comprobar:
  - **Fuente de datos:** debe decir **API (capas reales)**.
  - **Chips:** los números deben coincidir con GET /api/debug/capas-stats (aforos, obras, eventos, manifestaciones, conciertos, semaforos, base).
  - **Banner (dev):** **"Front vs API stats: OK"**; si "Mismatch", los conteos del front no coinciden con el backend.
- Probar filtros: activar/desactivar una capa debe mostrar/ocultar **solo** los markers de esa capa.
- Clic en un marker: popup **sin tabs**, según el tipo (Aforos → estudios + "Ver análisis"; Obras/Eventos/etc. → solo su info).
- En "Volumen por periodo" (resumen aforo): debe mostrarse **número** por intervalo, no texto como "NO"; si no hay dato, "—".

---

## ETL DIM (conteos_resumen)

Requerido: migraciones **014** y **016** aplicadas. Llave idempotente: (estudio_id, sentido, intervalo_ini, intervalo_fin).

**Dry-run (no escribe):**  
`node server/scripts/etl_conteos_from_dim.js --studyId=4266 --dry-run`

**Write (escribe en BD):**  
`node server/scripts/etl_conteos_from_dim.js --studyId=4266 --write`

**Verificación:** Ejecutar `--write` dos veces. 1ª: Insertados > 0, Actualizados 0. 2ª: Insertados 0, Actualizados > 0 (sin duplicados).

---

## Regla del proyecto

- **Nunca** usar puertos dinámicos.
- **Nunca** permitir que Vite cambie de puerto (--strictPort).
- **Siempre** arrancar con `.\scripts\dev.ps1` o `npm run dev:all`.
