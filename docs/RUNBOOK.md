# Runbook — Operación estándar (Visualizador de aforos)

**Doc canónico:** único runbook operativo. Catálogo de scripts: [docs/SCRIPTS.md](SCRIPTS.md).

**Repo root:** directorio que contiene `package.json`. **Redis:** corre en WSL (Ubuntu); debe responder PONG antes de levantar workers.

---

## Regla fija

Nunca ejecutar `npm run` fuera del directorio que contiene `package.json`. El error `npm ERR! enoent Could not read package.json` ocurre cuando se ejecuta npm desde la carpeta de usuario en lugar del repo.

---

## Antes de cualquier script npm

Comprobar que estás en el repo root. Windows (PowerShell): `dir package.json`. WSL/Linux: `ls package.json`. Si no aparece, hacer `cd` a la ruta del repo.

---

## Flujo oficial (C)

- **Dev:** `npm run dev` (API 3001 + web 5173) y en otra terminal `npm run worker` (con Redis en marcha).
- **Prod:** `npm run build && npm run start`; worker aparte con `npm run worker`.
- **Verificación rápida (sin escribir):** `npm run verify:all` (build + API arranque + smoke HTTP GET /health + worker en modo smoke).
- **Bootstrap local (escribe BD/Redis/archivos):** `npm run bootstrap:local` solo cuando quieras preparar BD + jobs en un entorno local; ver abajo.

### Comandos oficiales (resumen)

| Uso | Comando |
|-----|---------|
| Desarrollo | npm run dev |
| Worker (otra terminal) | npm run worker |
| Verificación (sin escritura) | npm run verify:all |
| Bootstrap local (BD + Redis) | npm run bootstrap:local (pide YES; con -- --yes se salta prompt) |
| Producción | npm run build y luego npm run start |

El resto de scripts son utilitarios o legacy; ver [docs/SCRIPTS.md](SCRIPTS.md).

---

## verify vs bootstrap

| Comando | Escribe algo | Cuándo usarlo |
|--------|---------------|----------------|
| verify:build | No | Comprobar que el build no está roto (CI, antes de merge). |
| verify:dev:api | No | Comprobar que la API arranca (puerto 3099, sin HTTP). |
| verify:smoke | No | Arranca API, GET /health 200, cierra. Smoke HTTP. |
| verify:worker | No | Comprobar que el worker arranca (smoke). |
| verify:all | No | Cadena build + API + smoke + worker. Red de seguridad antes de releases. |
| bootstrap:local | Sí (BD, Redis) | Primera vez en clone o tras borrar BD/Redis. Pide YES; con -- --yes se salta prompt. |

No uses bootstrap:local en CI ni en servidores compartidos sin leer el banner.

---

## Comandos

**Windows (PowerShell):** `cd` al repo, `dir package.json`, `npm run jobs:seed`.

**WSL (Ubuntu) — Redis:** `redis-cli ping`. Debe responder PONG. Si no: `sudo service redis-server start`.

**Levantar API + worker (dos terminales):** Terminal A: `npm run dev:api` (o `npm run start` en prod). Terminal B: `npm run worker`. Ambas desde repo root.

---

## Seeds y jobs

- Registrar repeatables (BullMQ): con Redis en marcha, `npm run jobs:seed`.
- Manifestación de prueba (geocode): `npm run seed:manifestacion-geocode-test`.

---

## Referencias

- Redis en Windows (WSL): [docs/RUNBOOK_REDIS_WINDOWS.md](RUNBOOK_REDIS_WINDOWS.md)
- Jobs BullMQ: [docs/RUNBOOK_JOBS.md](RUNBOOK_JOBS.md)
