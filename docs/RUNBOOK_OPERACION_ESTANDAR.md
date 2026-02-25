# Runbook — Operación estándar (Visualizador de aforos)

**Repo root:** `C:\Users\Ashle\Panorama desarrollos\Visualizador de aforos`  
**Redis:** corre en WSL (Ubuntu); debe responder PONG antes de levantar workers.

---

## Regla fija

- **Nunca ejecutar `npm run` fuera del directorio que contiene `package.json`.**  
  El error `npm ERR! enoent Could not read package.json ... open 'C:\Users\Ashle\package.json'` ocurre cuando se ejecuta npm desde la carpeta de usuario en lugar del repo.

---

## Antes de cualquier script npm

Comprobar que estás en el repo root:

- **Windows (PowerShell):** `dir package.json`
- **WSL / Linux:** `ls package.json`

Si no aparece `package.json`, hacer `cd` a la ruta del repo antes de ejecutar npm.

---

## Flujo oficial (C)

El flujo canónico para desarrollo y producción es:

- **Dev:** `npm run dev` (API 3001 + web 5173) y en otra terminal `npm run worker` (con Redis en marcha).
- **Prod:** `npm run build && npm run start`; worker aparte con `npm run worker`.
- **Verificación rápida (sin escribir):** `npm run verify:all` (build + API + worker en modo smoke).
- **Bootstrap local (escribe BD/Redis/archivos):** `npm run bootstrap:local` solo cuando quieras preparar BD + jobs en un entorno local; ver abajo.

---

## verify vs bootstrap: cuál usar y cuándo

| Comando | Escribe algo | Cuándo usarlo |
|--------|---------------|----------------|
| **verify:build** | No | Comprobar que el build no está roto (CI, antes de merge). |
| **verify:dev:api** / **verify:worker** | No | Comprobar que la API y el worker arrancan (smoke). |
| **verify:all** | No | Cadena de los tres: build + API + worker. Red de seguridad antes de releases. |
| **bootstrap:local** | Sí (BD, Redis, posiblemente archivos) | Primera vez en un clone, o tras borrar BD/Redis. Ejecuta migraciones y jobs:seed; no corre ingests grandes por defecto. |

No uses `bootstrap:local` en CI ni en servidores compartidos sin leer el banner de advertencia.

---

## Comandos

### Windows (PowerShell)

```powershell
cd "C:\Users\Ashle\Panorama desarrollos\Visualizador de aforos"
dir package.json
npm run jobs:seed
```

### WSL (Ubuntu) — Redis

```bash
redis-cli ping
```

Debe responder: **PONG**. Si no, iniciar Redis: `sudo service redis-server start`.

### Levantar API + worker (dos terminales, desde repo root)

- **Terminal A:** `npm run dev:api` (o `npm run start` en producción)
- **Terminal B:** `npm run worker`

Ambas terminales deben tener como directorio de trabajo la raíz del repo (donde está `package.json`).

---

## Seeds y jobs

- **Registrar repeatables (BullMQ):** desde repo root, con Redis en marcha:  
  `npm run jobs:seed`
- **Manifestación de prueba (geocode):**  
  `npm run seed:manifestacion-geocode-test`

---

## Referencias

- Redis en Windows (WSL): `docs/RUNBOOK_REDIS_WINDOWS.md`
- Jobs BullMQ: `docs/RUNBOOK_JOBS.md`
