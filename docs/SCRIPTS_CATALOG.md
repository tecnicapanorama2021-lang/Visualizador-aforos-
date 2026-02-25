# Catálogo de scripts npm

Referencia por script: propósito, dependencias (Redis/PG), si genera archivos y efectos secundarios. Ejecutar siempre desde el **repo root**. Detalle en `docs/RUNBOOK_SCRIPTS.md`.

---

## Oficial vs legacy/deprecated

**Oficial (flujo C):** `dev`, `dev:api`, `dev:web`, `worker`, `build`, `start`, `verify:all` (incluye `verify:smoke`), `bootstrap:local`, `db:migrate`, `jobs:seed`. Son los que usa el runbook para desarrollo y producción.

**Legacy / deprecated:** scripts que se mantienen por compatibilidad o uso puntual pero no forman parte del flujo oficial. No usar en producción sin revisar; muchos son one-offs, duplicados o variantes con Tor/proxy. Ejemplos: variantes `*:tor`, `*:tor-service`, `secop:catalogo:anexos` (Playwright proxy), pipelines completos (`pipeline:full`, `pipeline:full:tor`), verificaciones específicas (`verify:agendate:eventos`, `verify:eventos:bogota`, `diag:agendate:join`). Ver `docs/RUNBOOK_SCRIPTS.md` por prefijo. No se han renombrado a `legacy:*` para no romper automatizaciones existentes.

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
| **bootstrap:local** | Migraciones + jobs:seed (local); pide "YES" o usar `-- --yes` | Sí | Sí | No | BD, Redis |
| **db:full-load** | Setup y carga completa desde JSON | No | Sí | No | BD |
| **historial:build** | Historial masivo por nodo | No | No | public/data/ia_historial.json | Sí |
| **datos-unificados:obras** | Calendario obras (IDU/CKAN) | No | No | public/data/calendario_obras_eventos.json | Sí |
| **datos-unificados:eventos** | Eventos RSS → calendario | No | No | public/data/calendario_obras_eventos.json | Sí |
| **datos-unificados:velocidades** | Velocidades por nodo | No | No | public/data/velocidades_por_nodo.json | Sí |
| **etl:nodos-estudios** | JSON → nodos/estudios | No | Sí | No | BD |
| **etl:conteos** | ia_historial → conteos_resumen | No | Sí | No | BD |
| **ingest:* (apply)** | Varios: obras, eventos, agendate, etc. | Algunos (worker) | Sí | Algunos | BD, a veces archivos |
| **secop:*** | Catálogo, anexos, PDF | No | Sí (algunos) | data/secop/, etc. | BD, disco |
| **export:agendate:arcgis:snapshot** | Descarga eventos → JSON | No | No | public/data/agendate_eventos_snapshot.json | Sí |

*Para cada script concreto (ingest:obras, ingest:agendate:arcgis:apply, etc.) ver `docs/RUNBOOK_SCRIPTS.md` y los comentarios en los archivos bajo `server/scripts/`.

---

## Convenciones

- **Requiere Redis:** el script falla o no tiene sentido sin Redis (ej. worker, jobs:seed).
- **Requiere PG:** el script escribe o lee PostgreSQL; si falta DATABASE_URL puede abortar.
- **Genera archivos:** escribe en disco (public/data, data/, server/scripts/tmp, etc.).
- **Side-effects:** modifica BD, Redis o puertos; no es solo lectura.
