# Runbook — Ingestas canónicas y verificación

Orden recomendado y comandos oficiales.

## Requisitos

- `.env` en la raíz con `DATABASE_URL` (o `PGHOST`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`).
- Migraciones aplicadas: `npm run db:migrate`.

## Ingestas a incidentes (fuente única)

1. **Obras** (calendario → incidentes tipo OBRA):

   ```powershell
   npm run ingest:obras:incidentes:dry   # solo muestra qué se procesaría
   npm run ingest:obras:incidentes       # aplica
   ```

2. **Obras desde ArcGIS** (MapServer Obras Distritales → incidentes con geometría real: Polygon/LineString/Point y `metadata.arcgis.attributes_raw`):

   Configura en `.env`: `ARCGIS_BASE_URL`, `LAYER_ID` (layer con geometría de obras), `FUENTE_PRINCIPAL=OBRAS_DISTRITALES_ARCGIS` (opcional).  
   Llave estable: `(fuente_principal, source_id)`; índice único ya existe en migración 022.

   ```powershell
   npm run ingest:obras:arcgis:dry   # dry-run, sin escribir en BD
   npm run ingest:obras:arcgis       # upsert en incidentes
   ```

   Ver detalles y descubrimiento de capas en `docs/OBRAS_ARCGIS_INGEST.md`.

3. **Eventos** (contexto_eventos con geom → incidentes):

   ```powershell
   npm run ingest:eventos:incidentes:dry
   npm run ingest:eventos:incidentes
   ```

Re-ejecutar es idempotente (upsert por `fuente_principal` + `source_id`).

## Verificación

- **Debug API:**  
  `Invoke-RestMethod http://localhost:3001/api/debug/incidentes-stats | ConvertTo-Json`

- **Endpoints de diagnóstico:**  
  `npm run verify:debug`  
  (comprueba ping, capas-stats, incidentes-stats, etc.)

- **Conteos por capa:**  
  Comparar `(Invoke-RestMethod http://localhost:3001/api/obras/nodos).features.Count` con `by_tipo` en incidentes-stats.

## Scripts involucrados

| Comando | Script |
|--------|--------|
| `npm run ingest:obras:incidentes` | server/scripts/ingest/ingest_obras_calendario_to_incidentes.js |
| `npm run ingest:obras:arcgis` | server/scripts/ingest/ingest_obras_distritales_arcgis.js |
| `npm run ingest:eventos:incidentes` | server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js |
| `npm run verify:debug` | server/scripts/verify/verify_debug_endpoints.js |

Legacy (obras_canonica/eventos_canonica): `npm run ingest:obras`, `npm run ingest:eventos`, `npm run verify:canon`. Ver docs/LEGACY.md.
