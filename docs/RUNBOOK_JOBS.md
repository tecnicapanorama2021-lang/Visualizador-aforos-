# Runbook — Jobs BullMQ

Descripción de los jobs del worker, repeatables y flujos.

## Colas y jobs

| Cola | Job name | Descripción | Repetible |
|------|----------|-------------|-----------|
| `ingest` | `news:rss:fetch` | Lee RSS (Google News, El Tiempo, etc.) y guarda items en `landing_items` (entity_type=NEWS) | Cada 15 min |
| `ingest` | `news:manifestations:extract` | Lee `landing_items` NEWS no procesados, clasifica manifestaciones, upsert a `incidentes` tipo MANIFESTACION | Cada 30 min |
| `ingest` | `news:manifestations:geocode` | Geocodifica manifestaciones NEWS_RSS con geom NULL (heurística v1, diccionario corredores) | Cada 15 min |
| `ingest` | `obras:arcgis` | Ejecuta ingest Obras Distritales ArcGIS → incidentes | Diario (cron) |
| `ingest` | `eventos:incidentes` | Ejecuta contexto_eventos → incidentes + (opcional) Agéndate → contexto_eventos | Cada 6 h |
| `ingest` | `arcgis:domains:sync` | Sincroniza dominios ArcGIS (coded values) a `arcgis_domains_cache` | Diario |

## Flujo RSS → Manifestación → Incidente

1. **news:rss:fetch** (cada 15 min)  
   - Consulta fuentes RSS configuradas.  
   - Por cada item: upsert en `landing_items` por `(source_system, source_id)` con `source_id = hash(url)` o url estable.  
   - Campos: `entity_type=NEWS`, `url`, `payload` (titulo, descripción, fecha, etc.), `fetched_at`.  
   - No marca `processed_at` (lo hace el siguiente job).

2. **news:manifestations:extract** (cada 30 min)  
   - Selecciona filas de `landing_items` con `entity_type='NEWS'` y `processed_at IS NULL`.  
   - Clasificación: keywords/heurística para MANIFESTACION (marcha, protesta, bloqueo, manifestación, etc.).  
   - Por cada item clasificado como manifestación:  
     - Extrae lugar (string), fecha/hora si existe, descripción corta, evidencia (url).  
     - Upsert en `incidentes`: `tipo='MANIFESTACION'`, `fuente_principal='NEWS_RSS'`, `source_id` estable (ej. `news-{id}`), `title`, `descripcion`, `start_at`/`end_at` (o estimación desde `published_at`), `geom` opcional (null si no hay geocode), `metadata.evidence[]`, `quality_status`: HIGH si geom+fechas, MED si solo fechas, LOW si solo texto.  
   - Marca `landing_items.processed_at = now()` para los procesados.

3. **news:manifestations:geocode** (cada 15 min)  
   - Selecciona incidentes `tipo='MANIFESTACION'`, `fuente_principal='NEWS_RSS'`, `geom IS NULL`, últimos 7 días.  
   - Por cada uno: construye texto (titulo + descripcion + evidence), llama `geocodeFromText()` (diccionario `server/data/corredores_bogota.json`).  
   - Si hay match: actualiza `incidentes.geom` (polígono buffer), `quality_status` (HIGH si tiene start_at/end_at, MED si solo geom), `metadata.geocode`.  
   - Ver `docs/MANIFESTACIONES_GEOCODE_V1.md` para heurísticas y límites.

4. El mapa consume manifestaciones desde `GET /api/manifestaciones/nodos` (incidentes tipo MANIFESTACION), con filtro de calidad igual que obras cuando `?quality=high`. Por defecto se devuelve geometría como centroid (`geomMode=centroid`).

## Comandos

- **Arrancar worker:** `npm run worker`
- **Registrar repeatables (seed):** `npm run jobs:seed`
- **Estado de jobs (admin):** `GET /api/admin/jobs/status` (header `Authorization: Bearer <ADMIN_TOKEN>` o en dev sin token si está permitido)

## Verificación SQL (manifestaciones)

Cantidad por `quality_status`:

```sql
SELECT quality_status, COUNT(*)
FROM incidentes
WHERE tipo = 'MANIFESTACION'
GROUP BY 1;
```

Cantidad con geometría (visibles en mapa):

```sql
SELECT COUNT(*)
FROM incidentes
WHERE tipo = 'MANIFESTACION' AND geom IS NOT NULL;
```

## Variables de entorno

- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (opcional): conexión Redis.
- `ADMIN_TOKEN`: opcional; si está definido, el endpoint `/api/admin/jobs/status` exige `Authorization: Bearer <ADMIN_TOKEN>`.
- En desarrollo, si `NODE_ENV !== 'production'`, el endpoint admin puede aceptar requests sin token (configurable).

## Observabilidad

- Tabla **ingest_runs**: cada job que usa el helper registra `job_name`, `started_at`, `finished_at`, `status` (ok/failed), `items_in`, `items_upserted`, `errors_count`, `error_sample`, `meta` (jsonb).
- **GET /api/admin/jobs/status**: devuelve los últimos runs por job para inspección rápida.

## Referencias

- Código worker: `server/worker/index.js`
- Procesadores de jobs: `server/worker/jobs/*.js`
- Definición de colas y repeatables: `server/queue/queues.js`
- Helper ingest_runs: `server/lib/ingestRuns.js`
