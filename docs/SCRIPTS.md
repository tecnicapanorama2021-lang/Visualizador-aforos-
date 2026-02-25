# Catálogo de scripts npm

**Doc canónico:** catálogo de scripts, orden y prerequisitos. Runbook operativo: [docs/RUNBOOK.md](RUNBOOK.md).

Ejecutar siempre desde el **repo root** (`dir package.json` / `ls package.json`).

---

## Orden y prerequisitos

1. **Redis** debe estar en marcha antes de `worker`, `jobs:seed` y `verify:all` (verify:worker usa Redis).
2. **PostgreSQL** (DATABASE_URL) es opcional para API/worker; obligatorio para `db:migrate`, `bootstrap:local` y scripts de ingest/etl que escriben BD.
3. **Golden path:** `npm run verify:all` (build → API smoke → smoke HTTP → worker smoke). Ejecutar antes de merge o release.

---

## Oficial vs legacy/deprecated

**Oficial (flujo C):** `dev`, `dev:api`, `dev:web`, `worker`, `build`, `start`, `verify:all` (incluye `verify:smoke`), `bootstrap:local`, `db:migrate`, `jobs:seed`.

**Legacy / deprecated:** scripts por compatibilidad o uso puntual; no forman parte del flujo oficial. Ejemplos: `*:tor`, `*:tor-service`, `secop:catalogo:anexos`, `pipeline:full`, `verify:agendate:eventos`, `verify:eventos:bogota`. Ver listado por prefijo en [docs/RUNBOOK_SCRIPTS.md](RUNBOOK_SCRIPTS.md).

---

## Resumen (tabla)

| Script | Propósito | Requiere Redis | Requiere PG | Genera archivos | Side-effects |
|--------|-----------|----------------|-------------|-----------------|--------------|
| **dev** | API + web (kill ports + 3001 + 5173) | No | Opcional | No | Puertos |
| **dev:api** | Solo API 3001 | No | Opcional | No | Puertos |
| **dev:web** | Solo Vite 5173 | No | No | No | Puertos |
| **worker** | Worker BullMQ (cola ingest) | Sí | Opcional | No | Redis |
| **build** | Build producción (Vite) | No | No | dist/ | No |
| **start** | API producción | No | Opcional | No | Puertos |
| **db:migrate** | Aplica migraciones SQL | No | Sí | No | BD |
| **jobs:seed** | Registra repeatables BullMQ | Sí | No | No | Redis |
| **verify:build** | Ejecuta build; falla si rompe | No | No | dist/ (temporal) | No |
| **verify:dev:api** | Smoke API (3099, arranque sin HTTP) | No | Opcional | No | Puertos |
| **verify:smoke** | Smoke HTTP GET /health 200 (≤10s) | No | Opcional | No | Puertos |
| **verify:worker** | Smoke worker (arranca y apaga) | Sí | No | No | Redis (lectura) |
| **verify:all** | verify:build + verify:dev:api + verify:smoke + verify:worker | Sí (worker) | Opcional | No | No |
| **bootstrap:local** | Migraciones + jobs:seed (local); pide "YES" o `-- --yes` | Sí | Sí | No | BD, Redis |
| **db:full-load** | Setup y carga completa desde JSON | No | Sí | No | BD |
| **historial:build** | Historial masivo por nodo | No | No | public/data/ia_historial.json | Sí |
| **datos-unificados:obras** | Calendario obras (IDU/CKAN) | No | No | public/data/calendario_obras_eventos.json | Sí |
| **datos-unificados:eventos** | Eventos RSS → calendario | No | No | public/data/calendario_obras_eventos.json | Sí |
| **datos-unificados:velocidades** | Velocidades por nodo | No | No | public/data/velocidades_por_nodo.json | Sí |
| **etl:nodos-estudios** | JSON → nodos/estudios | No | Sí | No | BD |
| **etl:conteos** | ia_historial → conteos_resumen | No | Sí | No | BD |
| **ingest:* (apply)** | Varios: obras, eventos, agendate, etc. | Algunos | Sí | Algunos | BD, a veces archivos |
| **secop:*** | Catálogo, anexos, PDF | No | Sí (algunos) | data/secop/, etc. | BD, disco |
| **export:agendate:arcgis:snapshot** | Descarga eventos → JSON | No | No | public/data/agendate_eventos_snapshot.json | Sí |

Para cada script concreto (ingest:obras, ingest:agendate:arcgis:apply, etc.) ver [docs/RUNBOOK_SCRIPTS.md](RUNBOOK_SCRIPTS.md) y los comentarios en `server/scripts/`.

---

## Convenciones

- **Requiere Redis:** el script falla o no tiene sentido sin Redis.
- **Requiere PG:** el script escribe o lee PostgreSQL; si falta DATABASE_URL puede abortar.
- **Genera archivos:** escribe en disco (public/data, data/, server/scripts/tmp, etc.).
- **Side-effects:** modifica BD, Redis o puertos; no es solo lectura.
