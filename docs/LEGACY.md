# Legacy y deprecados

Elementos marcados como legacy o deprecados. No eliminar en esta fase; preparados para retirada futura.

## Scripts

| Ubicación | Estado | Reemplazo / nota |
|-----------|--------|-------------------|
| server/scripts/ingest_obras_from_calendario.js | LEGACY | Canon: server/scripts/ingest/ingest_obras_calendario_to_incidentes.js → `npm run ingest:obras:incidentes` |
| server/scripts/ingest_eventos_from_contexto.js | LEGACY | Canon: server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js → `npm run ingest:eventos:incidentes` |
| server/scripts/verify_canon_counts.js | LEGACY | Verifica obras_canonica/eventos_canonica; fuente canónica es incidentes. Verificar con /api/debug/incidentes-stats y `npm run verify:debug` |
| scripts/start-dev.ps1 | DEPRECATED | Usar .\scripts\dev.ps1 o npm run dev |
| scripts/migrate.ps1 | LEGACY-PARCIAL | Solo aplica 014–020. Migración completa: npm run db:migrate |

## Rutas API

| Ruta | Estado | Nota |
|------|--------|------|
| /api/datos-unificados/* | LEGACY | Header X-Deprecated: true. Capas reales leen de incidentes (routes/capas.js). |

## Frontend

| Componente | Estado | Nota |
|------------|--------|------|
| ConstructionLayer.jsx | DEPRECATED | Obras desde /api/obras/nodos (incidentes). Stub, no usado. |
| PanelNodo.jsx | LEGACY | Flujo principal: capas separadas y popups por capa sin tabs. |

## Ubicaciones reorganizadas (raíz → carpetas)

- **.md que estaban en la raíz** → movidos a **docs/referencia/** (AUDITORIA_LAYERS_IDECA.md, COLORS.md, DEPLOY.md, README-BLOG.md, README-ROUTING.md, etc.). Índice en docs/referencia/README.md.
- **.py que estaban en la raíz** → movidos a **scripts/python/** (download_sensors.py, geocode_missing_nodes.py, harvest_dim_studies.py, test_socrata_endpoint.py, etc.). Ver scripts/python/README.md.

## Tablas BD (referencia)

- **obras_canonica / eventos_canonica** (021): reemplazadas por `incidentes` como fuente de capas. Se pueden seguir usando para legacy o eliminarse en fase posterior.
