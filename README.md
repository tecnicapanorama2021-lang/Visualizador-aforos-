# Panorama Ingeniería 2026

Aplicación web: mapa de aforos, capas de incidentes (obras, eventos, manifestaciones) y estudios de tránsito. Backend Express + PostgreSQL; frontend React + Vite.

**Estado actual (2026):** Fuente única de incidentes en BD (`incidentes`). Capas reales en el mapa desde esa tabla. Un solo entrypoint backend, un flujo oficial de migraciones e ingestas.

---

## Arranque rápido

```bash
npm install
npm run dev
```

- **Front:** http://localhost:5173  
- **API:** http://localhost:3001  
- **Mapa de aforos:** http://localhost:5173/aforos  

En Windows (recomendado): `.\scripts\dev.ps1` — libera puertos 3001 y 5173 y arranca API + Vite.

---

## Comandos oficiales

| Acción | Comando |
|--------|---------|
| **Arrancar** | `.\scripts\dev.ps1` o `npm run dev` |
| **Migrar BD** | `npm run db:migrate` (aplica migraciones 001–023) |
| **Ingestar obras → incidentes** | `npm run ingest:obras:incidentes:dry` luego `npm run ingest:obras:incidentes` |
| **Ingestar eventos → incidentes** | `npm run ingest:eventos:incidentes:dry` luego `npm run ingest:eventos:incidentes` |
| **Verificar API** | `npm run verify:debug` |

Requiere `.env` en la raíz con `DATABASE_URL` (o PGHOST/PGDATABASE/PGUSER/PGPASSWORD) para migrar e ingestar.

---

## Puertos fijos

- **API:** 3001  
- **Front:** 5173  

No se usan puertos dinámicos. `npm run kill:ports` libera 3001 y 5173 si hace falta.

---

## Documentación

Índice completo: **[docs/README.md](docs/README.md)** (mapa de documentación).

| Doc | Contenido |
|-----|-----------|
| [DESARROLLO_LOCAL.md](docs/DESARROLLO_LOCAL.md) | Dev/ops: puertos, migraciones, ingestas, verificación |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura tipo Waze, incidentes, capas |
| [RUNBOOK_INGEST.md](docs/RUNBOOK_INGEST.md) | Ingestas canónicas y verificación paso a paso |
| [LEGACY.md](docs/LEGACY.md) | Scripts y rutas marcados legacy/deprecados |
| [referencia/](docs/referencia/) | Docs de referencia (histórico) |

**Regla:** No agregar .md ni .py a la raíz (solo README.md). Verificación: `npm run check:root`.

---

## Estructura del proyecto

- **server.js** — Único entrypoint del backend.
- **server/db/migrations/** — Migraciones SQL (001–023).
- **server/scripts/ingest/** — Ingestas canónicas (calendario y contexto_eventos → incidentes).
- **server/scripts/verify/** — Verificación de endpoints debug.
- **routes/capas.js** — Endpoints GeoJSON por capa (obras, eventos, manifestaciones, etc.) desde `incidentes`.
- **scripts/dev.ps1** — Arranque oficial en Windows.
- **scripts/python/** — Scripts Python de utilidad (Socrata, Simur, descargas), movidos desde la raíz.

---

## Despliegue

Variables: `DATABASE_URL`, `VITE_API_URL` (URL del API en producción). Ver `docs/referencia/DEPLOY.md` si aplica.
