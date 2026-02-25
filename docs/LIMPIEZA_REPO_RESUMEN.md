# Resumen de limpieza y organización del repo

Resultado de la reorganización sin eliminar funcionalidad. Arquitectura objetivo: fuente única incidentes, un entrypoint, un flujo de migraciones, scripts organizados, legacy marcado.

---

## Resumen de cambios

| Fase | Cambio |
|------|--------|
| 1 | **Entrypoint único:** Banner de boot en server.js (versión, fecha, puerto, "Backend canónico incidentes v1"). start-dev.ps1 marcado DEPRECATED con aviso. migrate.ps1 comentado como legacy-parcial (solo 014–020). |
| 2 | **Migraciones:** DESARROLLO_LOCAL declara único comando oficial `npm run db:migrate`. migrate.ps1 con comentario "NO usar para migración completa". |
| 3 | **Scripts:** Nuevas carpetas server/scripts/ingest/ y server/scripts/verify/. Ingestas canónicas y verify_debug_endpoints movidos allí. Scripts legacy (ingest_obras_from_calendario, ingest_eventos_from_contexto, verify_canon_counts) marcados LEGACY en cabecera. Nuevos npm: ingest:obras:incidentes, ingest:eventos:incidentes, verify:debug. |
| 4 | **Rutas legacy:** routes/datosUnificados.js con comentario LEGACY y header X-Deprecated: true en todas las respuestas. |
| 5 | **Frontend:** ConstructionLayer.jsx marcado DEPRECATED, PanelNodo.jsx marcado LEGACY. AforosMap ya usa solo /api/*/nodos (capas reales). |
| 6 | **Docs:** Creados ARCHITECTURE.md, RUNBOOK_INGEST.md, LEGACY.md. DESARROLLO_LOCAL actualizado con arranque oficial y referencias a doc canónica. |
| 7 | **Debug:** /api/debug/ping, incidentes-stats, capas-stats confirmados. verify:debug incluye incidentes-stats. Capas obras/eventos/manifestaciones leen de incidentes (con fallback legacy si vacío). |
| 8 | Este resumen y comandos oficiales. |

---

## Árbol nuevo relevante del repo

```
<raíz del repo>/
├── server.js                    # Único entrypoint backend
├── package.json                 # Scripts actualizados (ingest:*, verify:debug)
├── scripts/
│   ├── dev.ps1                  # Arranque oficial (API + web)
│   ├── start-dev.ps1            # DEPRECATED
│   ├── migrate.ps1              # LEGACY-PARCIAL (solo 014-020)
│   └── kill-ports.js
├── server/
│   ├── db/
│   │   └── migrations/         # 001 … 023 (orden canónico)
│   ├── scripts/
│   │   ├── dbMigrate.js         # Migración completa (oficial)
│   │   ├── ingest/
│   │   │   ├── ingest_obras_calendario_to_incidentes.js
│   │   │   └── ingest_contexto_eventos_to_incidentes.js
│   │   ├── verify/
│   │   │   └── verify_debug_endpoints.js
│   │   ├── ingest_obras_from_calendario.js   # LEGACY
│   │   ├── ingest_eventos_from_contexto.js   # LEGACY
│   │   └── verify_canon_counts.js            # LEGACY
│   └── utils/
├── routes/
│   ├── capas.js                 # Lee incidentes (obras/eventos/manif)
│   ├── datosUnificados.js       # LEGACY, X-Deprecated
│   ├── debug.js                 # incidentes-stats, capas-stats, ping...
│   └── ...
├── src/components/map/
│   ├── AforosMap.jsx            # Solo /api/*/nodos
│   ├── ConstructionLayer.jsx    # DEPRECATED
│   ├── PanelNodo.jsx            # LEGACY
│   └── popups/
└── docs/
    ├── DESARROLLO_LOCAL.md      # Dev/ops canónico
    ├── ARCHITECTURE.md          # Visión Waze/incidentes
    ├── RUNBOOK_INGEST.md        # Ingestas y verificación
    ├── LEGACY.md                # Listado legacy/deprecados
    └── LIMPIEZA_REPO_RESUMEN.md # Este archivo
```

---

## Archivos marcados como legacy

| Archivo | Estado |
|---------|--------|
| scripts/start-dev.ps1 | DEPRECATED |
| scripts/migrate.ps1 | LEGACY-PARCIAL (solo 014-020) |
| server/scripts/ingest_obras_from_calendario.js | LEGACY |
| server/scripts/ingest_eventos_from_contexto.js | LEGACY |
| server/scripts/verify_canon_counts.js | LEGACY |
| routes/datosUnificados.js | LEGACY (X-Deprecated) |
| src/components/map/ConstructionLayer.jsx | DEPRECATED |
| src/components/map/PanelNodo.jsx | LEGACY |

---

## Archivos movidos

| Origen | Destino |
|--------|---------|
| server/scripts/ingest_obras_calendario_to_incidentes.js | server/scripts/ingest/ingest_obras_calendario_to_incidentes.js |
| server/scripts/ingest_contexto_eventos_to_incidentes.js | server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js |
| server/scripts/verify_debug_endpoints.js | server/scripts/verify/verify_debug_endpoints.js |

(Los archivos en origen fueron eliminados tras crear las copias en destino; los legacy no se movieron de carpeta, solo se marcaron.)

### Reorganización adicional (raíz del repo)

| Antes (raíz) | Después |
|--------------|---------|
| AUDITORIA_LAYERS_IDECA.md, COLORS.md, DEPLOY.md, README-BLOG.md, README-ROUTING.md, README_DOWNLOAD_SENSORS.md, MAPEO_CAMPOS_IDECA_REACT.md, CASO_DE_EXITO_PMT_MOVILIDAD.md | **docs/referencia/** (índice en docs/referencia/README.md) |
| download_sensors.py, geocode_missing_nodes.py, harvest_dim_studies.py, test_socrata_endpoint.py, test_simur_urls.py, etc. | **scripts/python/** (índice en scripts/python/README.md) |

**README único:** Solo README.md en la raíz; contenido actualizado (arranque, comandos oficiales, enlaces a docs). El resto de documentación en docs/ y docs/referencia/.

---

## Comandos oficiales definitivos

### Migrar

```powershell
npm run db:migrate
```

Requiere `DATABASE_URL` (o PGHOST/PGDATABASE/PGUSER/PGPASSWORD) en `.env`.

### Arrancar dev

```powershell
.\scripts\dev.ps1
```

o

```bash
npm run dev
```

### Ingestar (incidentes canónicos)

```powershell
npm run ingest:obras:incidentes:dry
npm run ingest:obras:incidentes

npm run ingest:eventos:incidentes:dry
npm run ingest:eventos:incidentes
```

### Verificar

```powershell
npm run verify:debug
```

Comprueba /api/debug/ping, capas-stats, incidentes-stats, etc.

```powershell
Invoke-RestMethod http://localhost:3001/api/debug/incidentes-stats | ConvertTo-Json
```

---

## Comprobaciones rápidas

- Backend arranca con banner: `[BOOT] Backend canónico incidentes v1`.
- `GET /api/debug/ping` → 200.
- `GET /api/debug/incidentes-stats` → by_tipo, by_fuente, con_geom.
- `GET /api/obras/nodos` y `/api/eventos/nodos` leen de `incidentes` cuando hay datos.
- UI en http://localhost:5173/aforos con chips y "Fuente: API (capas reales)".
