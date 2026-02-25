# Runbook — Scripts npm (detalle por prefijo)

**Doc canónico de catálogo:** [docs/SCRIPTS.md](SCRIPTS.md). Este archivo es complemento: listado detallado por prefijo.

Referencia de scripts del proyecto. Ejecutar siempre desde el **repo root** (`dir package.json` / `ls package.json`).

---

## Esenciales

| Script | Propósito |
|--------|-----------|
| `npm run dev` | Desarrollo: mata puertos + API (3001) + front (5173) |
| `npm run dev:api` | Solo API en puerto 3001 |
| `npm run dev:web` | Solo front Vite en 5173 |
| `npm run build` | Build de producción (Vite) |
| `npm run start` | Arranca API en producción (node server.js) |
| `npm run worker` | Worker BullMQ (cola ingest); requiere Redis |
| `npm run db:migrate` | Aplica migraciones SQL (server/db/migrations) |
| `npm run jobs:seed` | Registra jobs repetibles en Redis (ejecutar una vez o tras cambios) |

---

## Verificación (red de seguridad)

| Script | Propósito |
|--------|-----------|
| `npm run verify:build` | Ejecuta `npm run build`; falla si el build rompe |
| `npm run verify:dev:api` | Arranca API en puerto 3099 unos segundos y la apaga; falla si server.js crashea |
| `npm run verify:smoke` | Arranca API, GET /health 200, cierra (smoke HTTP) |
| `npm run verify:worker` | Arranca el worker unos segundos y lo apaga; falla si crashea al cargar (ej. Redis) |

---

## Utilitarios (por prefijo)

### dev / kill / check
- `dev:all` — PowerShell dev.ps1 (API + web)
- `kill:ports` — Libera puertos usados por API/web
- `check:root` — Comprueba que se ejecuta desde repo root

### deploy / preview
- `preview` — Sirve build local (Vite)
- `deploy` — build + start

### historial
- `historial:build` — Construye historial masivo
- `historial:incremental` — Incremental
- `historial:test` — Con límite 10

### datos-unificados
- `datos-unificados:obras` — Actualiza calendario obras (IDU/CKAN) → public/data/calendario_obras_eventos.json
- `datos-unificados:eventos` — Actualiza sección eventos del calendario (RSS)
- `datos-unificados:velocidades` — Job velocidades Google Routes

### db
- `db:migrate:win` — Migrar vía PowerShell
- `db:migrate:url` — Migrar con DATABASE_URL
- `db:schema-check` — Comprueba esquema BD
- `db:full-load` — Setup y carga completa
- `db:seed:festivos` — Seed festivos Colombia

### etl
- `etl:nodos-estudios` — Nodos/estudios desde JSON
- `etl:nodos:ckan-geojson` — Nodos desde GeoJSON CKAN
- `etl:conteos` — Conteos desde historial
- `etl:fuente-externa-demo` — Demo fuente externa
- `etl:fuente-externa-csv` — CSV → nodos/estudios/conteos
- `etl:cgt` — Fetch y conversión CGT
- `etl:sensores-bici` — Sensores bicicleta
- `etl:velocidades:cgt` — Velocidades CGT
- `etl:pdf` — ETL PDF genérico
- `etl:estudios-transito` — Estudios tránsito enriquecido
- `etl:contexto` — Contexto eventos
- `etl:contexto-zonas` — Contexto zonas
- `etl:contexto-geocode` — Geocodificar eventos
- `etl:zonas` — Zonas IDECA (CKAN)
- `etl:cgt:daily` — CGT diario
- `etl:sensores-bici:daily` — Sensores bici diario

### ingest
- `ingest:obras` / `ingest:obras:dry` — Obras desde calendario (legacy)
- `ingest:obras:incidentes` / `ingest:obras:incidentes:dry` — Calendario → incidentes
- `ingest:obras:arcgis` / `ingest:obras:arcgis:dry` — ArcGIS Obras Distritales → incidentes
- `ingest:eventos` / `ingest:eventos:dry` — Eventos desde contexto (legacy)
- `ingest:eventos:incidentes` / `ingest:eventos:incidentes:dry` — contexto_eventos → incidentes
- `ingest:eventos:web:dry` / `ingest:eventos:web:apply` — Eventos desde web (bogota.gov, idartes)
- `ingest:agendate:contexto:dry` / `ingest:agendate:contexto:apply` — Agéndate (KMZ/ArcGIS) → contexto_eventos
- `ingest:agendate:contexto:file:dry` / `ingest:agendate:contexto:file:apply` — Agéndate desde archivo KMZ
- `ingest:agendate:contexto:force` — Forzar actualización Agéndate
- `ingest:agendate:arcgis:dry` / `ingest:agendate:arcgis:apply` — Agéndate ArcGIS → contexto_eventos
- `ingest:agenda:manual:dry` / `ingest:agenda:manual:apply` — Agenda manual (JSON) → contexto_eventos
- `ingest:agendate:tabla7:contexto:dry` / `ingest:agendate:tabla7:contexto:apply` — Snapshot tabla 7 → contexto_eventos

### import / export / build (agendate)
- `import:agendate:tabla7:snapshot:dry` / `import:agendate:tabla7:snapshot:apply` — Raw tabla 7 → snapshot
- `import:agendate:tabla7:snapshot:apply:all` — Aplicar todos
- `import:eventos:bogota:copy` — Copiar eventos Bogotá desde Downloads
- `import:eventos:bogota:contexto:dry` / `import:eventos:bogota:contexto:apply` — JSON eventos → contexto_eventos
- `build:agendate:snapshot:related:dry` / `build:agendate:snapshot:related:apply` — Snapshot desde registros relacionados
- `export:agendate:arcgis:snapshot` — Exporta snapshot eventos Agéndate (para uso offline)

### arcgis / backfill
- `arcgis:domains:sync` — Sincroniza dominios ArcGIS a BD
- `backfill:obras-canonical` — Backfill columnas canónicas obras

### secop
- `secop:catalogo` — Catálogo estudios SECOP
- `secop:catalogo:headless` — Con Playwright (anexos)
- `secop:catalogo:anexos` — Con proxy Tor
- `secop:descargar` — Descarga anexos
- `secop:procesar` — Procesa anexos
- `secop:ejemplo` — Crea anexos de ejemplo
- `secop:pdf` — ETL PDF SECOP
- `secop:registrar-pdf` — Registrar PDF local
- `secop:registrar-carpeta` — Registrar carpeta
- `secop:registrar-relevantes` — Registra contratos relevantes
- `secop:extraer-urls` — Extrae URLs documentos
- Variantes `:tor` para descarga con proxy

### datos-abiertos / ckan / sdp / pipeline
- `ckan:registrar-aforos` — Registrar recursos aforos en CKAN
- `datos-abiertos:descargar` — Descargar datos abiertos
- `datos-abiertos:descartar-irrelevantes` — Descartar irrelevantes
- `datos-abiertos:full` — Registrar + descargar + procesar
- `sdp:descargar` — Descargar PPRU SDP
- `pipeline:full` — Pipeline completo (SECOP, SDP, ETL, CKAN, scraper, stats)
- `pipeline:full:tor` — Con Tor

### catalogo / scraper / stats / estudios
- `catalogo:sdm-transporte` — Catálogo SDM transporte
- `scraper:portales` — Scraper portales SDM (PDF/XLSX/CSV)
- `stats:fuentes` — Estadísticas por fuente
- `estudios:registrar-pdfs` — Registrar PDFs estudios tránsito

### verify / diag / net
- `verify:canon` — Conteos canónicos
- `verify:debug` — Comprueba endpoints debug
- `verify:agendate:eventos` — Flujo Agéndate eventos
- `verify:eventos:bogota` — Flujo eventos Bogotá 2026
- `verify:predictor` — Calidad predictor
- `diag:agendate:join` — Diagnóstico join Agéndate tabla 7
- `net:diag:agendate` — Diagnóstico conectividad Agéndate
- `net:diag:agendate:arcgis` — PowerShell proxy ArcGIS

### seed / test / validación
- `seed:manifestacion-geocode-test` — Manifestación de prueba + geocode (ver mapa)
- `seed:aforos-secop` — Seed aforos SECOP (ejemplo)
- `test:conectividad` — Test conectividad (opcional Tor)
- `validacion:pre-t2` — Validación pre T2
