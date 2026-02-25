# Restore completado — 2026-02-24

## Comprobaciones realizadas

1. **PostGIS en pg_available_extensions:** ✅ listado (postgis).
2. **BD aforos:** Creada (no existía).
3. **PostGIS en aforos:** `CREATE EXTENSION IF NOT EXISTS postgis;` → OK.
4. **Restore:** `pg_restore -h localhost -p 5432 -U postgres -d aforos -Fc panorama_db.dump` → exit 0.

---

## Resultados post-restore

### PostGIS_Full_Version()

```
POSTGIS="3.6.1 3.6.1" [EXTENSION] PGSQL="180" GEOS="3.14.1-CAPI-1.20.5" PROJ="8.2.1 ..." LIBXML="2.12.5" LIBJSON="0.12" ...
```

### Conteos

| Tabla           | Total   |
|-----------------|--------|
| nodos           | 1 004  |
| estudios        | 4 260  |
| conteos_resumen | 670 736|
| incidentes      | 1 250  |

---

## .env local para que el proyecto use esta BD

Copia o crea `.env` en la **raíz del proyecto** (junto a `package.json`) y define la conexión. Opción recomendada:

**Opción 1 — DATABASE_URL (recomendada)**

```env
DATABASE_URL=postgresql://postgres:TU_CONTRASEÑA_POSTGRES@localhost:5432/aforos
```

Sustituye `TU_CONTRASEÑA_POSTGRES` por la contraseña real del usuario `postgres`. No la dejes en repositorio ni la compartas.

**Opción 2 — Variables por separado**

```env
PGHOST=localhost
PGPORT=5432
PGDATABASE=aforos
PGUSER=postgres
PGPASSWORD=TU_CONTRASEÑA_POSTGRES
```

El backend (`server/db/client.js`) usa `DATABASE_URL` si existe; si no, usa PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD.

Tras guardar `.env`, reinicia el backend (`npm run dev` o `npm run dev:api`) y comprueba `GET http://localhost:3001/health` — debe devolver `"db": "ok"` y `"postgis": "3.6.1 ..."`.
