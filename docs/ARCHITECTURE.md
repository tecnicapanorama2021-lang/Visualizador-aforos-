# Arquitectura — Panorama Ingeniería 2026

Visión tipo Waze: fuente única de incidentes, capas reales en el mapa, sin duplicación de fuentes.

## Fuente única de incidentes

- **Tabla canónica:** `incidentes` + `incidentes_sources` (migraciones 022, 023).
- Todas las capas de “incidentes” (Obras, Eventos, Manifestaciones, Conciertos, Cierres) leen de `incidentes`.
- Sin TTL automático; estado por datos: ACTIVO / PROGRAMADO / FINALIZADO.

## Capas en el mapa

- **Aforos:** nodos con estudios (BD: `nodos`, `estudios`, `conteos_resumen`). Endpoint: `/api/aforos/nodos`.
- **Obras / Eventos / Manifestaciones / Conciertos:** desde `incidentes` vía `/api/obras/nodos`, `/api/eventos/nodos`, etc. (routes/capas.js). Fallback legacy solo si no hay datos en incidentes.
- **Semáforos:** tabla 020 (demo o admin). **Base:** nodos sin estudios ni capas 020.

## Flujo de datos

1. **Incidentes:**  
   - Calendario JSON → `server/scripts/ingest/ingest_obras_calendario_to_incidentes.js` → `incidentes`.  
   - Tabla `contexto_eventos` → `server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js` → `incidentes`.

2. **Aforos/estudios:**  
   - DIM/Excel, PDF (SECOP, etc.) → ETL → `nodos`, `estudios`, `conteos_resumen`.

3. **Contexto eventos (raw):**  
   - RSS/APIs → `etl_contexto_eventos.js` → `contexto_eventos`; luego la ingesta canónica copia a `incidentes`.

## Entrypoint y migraciones

- **Backend:** único entrypoint `server.js` (raíz). Arranque oficial: `.\scripts\dev.ps1` o `npm run dev`.
- **Migraciones:** único comando oficial `npm run db:migrate` (aplica 001–023). No usar solo `scripts/migrate.ps1` para migración completa (solo 014–020).

## Documentación canónica

- **README** — arranque rápido.
- **DESARROLLO_LOCAL.md** — dev/ops, puertos, migraciones, ingestas.
- **ARCHITECTURE.md** — este documento.
- **RUNBOOK_INGEST.md** — ingestas canónicas y verificación.
- **LEGACY.md** — listado de lo deprecado/legacy.
