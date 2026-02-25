# Reporte post-migración de ruta (repo movido)

**Contexto:** El repositorio se movió de  
`C:\PANORAMA\Visualizador de aforos\Panorama ingenieria 2026`  
a  
`C:\Users\Ashle\Panorama desarrollos\Visualizador de aforos`.

**Objetivo:** Que todo levante correctamente: frontend Vite (5173), backend Express (3001), Postgres (PostGIS), sin referencias a la ruta vieja y con dependencias reproducibles.

---

## 1. Diagnóstico inicial

### 1.1 Entorno
- **Node:** v24.9.0  
- **npm:** 11.6.0  
- **package.json:** uno solo en la raíz (no monorepo).  
- **Engines:** Actualizado a `>=20.0.0 <25.0.0` para aceptar Node 24.

### 1.2 Entrypoints
- **Backend:** `server.js`, puerto **3001** (`npm run dev:api` → `cross-env PORT=3001 node server.js`).  
- **Front:** Vite, puerto **5173** (`npm run dev:web` → `vite --port 5173 --strictPort`).  
- **Arranque unificado:** `npm run dev` → kill-ports + `concurrently "npm run dev:api" "npm run dev:web"`.

### 1.3 Rutas hardcodeadas (corregidas)
Se encontraron y actualizaron referencias a la ruta vieja en documentación:

| Archivo | Cambio |
|--------|--------|
| `docs/PASO_A_PASO_WAZE.md` | `Set-Location "c:\PANORAMA\..."` reemplazado por instrucciones genéricas desde la raíz del repo. |
| `docs/EVENTOS_WAZE_AGENDATE_ARCGIS.md` | `cd "Panorama ingenieria 2026"` → `cd "<ruta-raiz-del-repo>"`. |
| `docs/ENTREGABLES_TAREAS_INCIDENTES_AGENDATE.md` | `C:\PANORAMA\data\` → ejemplo `C:\data\agendate\` y texto aclaratorio. |
| `docs/DESARROLLO_LOCAL.md` | Todas las apariciones de `cd "C:\PANORAMA\Visualizador de aforos\Panorama ingenieria 2026"` y `Set-Location "C:\PANORAMA\..."` reemplazadas por “Desde la raíz del proyecto” / “desde la carpeta del proyecto”. |
| `docs/LIMPIEZA_REPO_RESUMEN.md` | Árbol de ejemplo: `Panorama ingenieria 2026/` → `<raíz del repo>/`. |

**Código/scripts que afectan ejecución:** ninguno. No había rutas absolutas en `server.js`, `vite.config.js`, `scripts/kill-ports.js` ni en scripts que usan `PROJECT_ROOT` (estos usan `path.join(__dirname, '../..')` y son portables).

---

## 2. Dependencias

- **npm ci** ejecutado correctamente (lock sincronizado con `package.json`).  
- **Scripts verificados:**  
  - `npm run dev` → levanta API + web.  
  - `npm run dev:api` → solo API en 3001.  
  - `npm run dev:web` → solo Vite en 5173.  

Si en el futuro hay problemas de dependencias:

```powershell
Remove-Item -Recurse -Force node_modules
npm ci
```

---

## 3. Variables de entorno y dotenv

- **server.js** usa `require('dotenv').config()` sin `path`, por tanto lee `.env` del **cwd** (directorio desde el que se ejecuta `node server.js`), que en dev es la raíz del proyecto. ✅  
- Scripts bajo `server/scripts/` usan `path.join(PROJECT_ROOT, '.env')` con `PROJECT_ROOT = path.join(__dirname, '../..')` (o similar). Eso sigue siendo **relativo al script**, no a una ruta absoluta fija, así que es portable. ✅  
- **.env.example** documenta `DATABASE_URL` / `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `VITE_GOOGLE_MAPS_KEY`, `VITE_API_URL`, etc. No se encontró ningún `dotenv.config({ path: 'C:\\...' })` absoluto.

---

## 4. Vite proxy y API base

- **vite.config.js:**  
  - `server.proxy['/api']` → `target: 'http://localhost:3001'`. ✅  
  - Puerto 5173, `strictPort: true`.  
- **Front:** `src/constants/apiEndpoints.js` usa `API_BASE_URL = import.meta.env.VITE_API_URL ?? ''`, por tanto en dev las peticiones son a `/api/...` y pasan por el proxy. ✅  
- **VITE_API_URL** vacío en dev no rompe el proxy; solo se usa en build cuando el API está en otro dominio.

---

## 5. Puertos y Windows

- **scripts/kill-ports.js:** usa `netstat -ano | findstr :PORT` y `taskkill /F /PID` en Windows; no contiene rutas absolutas ni dependencia de la carpeta del proyecto. ✅  
- Rutas con espacios: la raíz del proyecto tiene espacios (`Panorama desarrollos`, `Visualizador de aforos`). Los scripts de npm y los `.ps1` que se invocan con `.\scripts\dev.ps1` se ejecutan desde la raíz; no se modificaron rutas en los scripts que ya usan rutas relativas o `path.join`.

---

## 6. DB y PostGIS

- **GET /health** (raíz del backend) ahora incluye comprobación de BD y PostGIS:  
  - Si hay `DATABASE_URL` o `PGHOST`, se llama a `healthCheck()` del cliente Postgres (que ejecuta `SELECT PostGIS_Version()`).  
  - Respuesta: `db: 'ok' | 'error' | 'not_configured'`, `postgis: <versión string> | <mensaje error> | null`.  
- **Migraciones:** sin cambios. Siguen aplicándose con `npm run db:migrate` (o `npm run db:migrate:win` / `db:migrate:url` según doc). El script carga `.env` desde la raíz.  
- Si **GET /health** devuelve `db: "error"` y `postgis: "connection failed"`: comprobar que Postgres esté en marcha y que `.env` tenga `DATABASE_URL` o `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` correctos. Para comprobar extensión PostGIS: `psql -d aforos -c "SELECT PostGIS_Version();"`.

---

## 7. Checklist final

| Ítem | Estado |
|------|--------|
| Dependencias instalables con `npm ci` | ✅ |
| Variables .env / dotenv sin rutas absolutas | ✅ |
| Proxy Vite `/api` → localhost:3001 | ✅ |
| Scripts de puertos (kill-ports) en Windows | ✅ |
| Health con DB y PostGIS | ✅ |
| Cero referencias a `C:\PANORAMA\...` en docs que afecten ejecución | ✅ |
| `npm run dev` levanta API y web | ✅ |

---

## 8. Cambios aplicados (resumen por archivo)

- **server.js**  
  - Import de `healthCheck` desde `./server/db/client.js`.  
  - Ruta `GET /health` convertida en `async` y respuesta ampliada con `db` y `postgis` según conexión a Postgres/PostGIS.

- **package.json**  
  - `engines.node`: `>=20.0.0 <23.0.0` → `>=20.0.0 <25.0.0`.

- **docs/PASO_A_PASO_WAZE.md**  
  - Ruta base: instrucciones genéricas desde la raíz del repo.

- **docs/EVENTOS_WAZE_AGENDATE_ARCGIS.md**  
  - `cd "Panorama ingenieria 2026"` → `cd "<ruta-raiz-del-repo>"`.

- **docs/ENTREGABLES_TAREAS_INCIDENTES_AGENDATE.md**  
  - Ejemplo de ruta KMZ y `AGENDATE_KMZ_FILE` sin `C:\PANORAMA\`.

- **docs/DESARROLLO_LOCAL.md**  
  - Varias apariciones de `cd "C:\PANORAMA\..."` / `Set-Location "C:\PANORAMA\..."` reemplazadas por “Desde la raíz del proyecto” o equivalente.

- **docs/LIMPIEZA_REPO_RESUMEN.md**  
  - Árbol de ejemplo: `Panorama ingenieria 2026/` → `<raíz del repo>/`.

---

## 9. Comandos para levantar y verificar

**Levantar todo (desde la raíz del proyecto):**

```powershell
cd "C:\Users\Ashle\Panorama desarrollos\Visualizador de aforos"
npm run dev
```

O por separado:

```powershell
npm run kill:ports
npm run dev:api    # Terminal 1: API en :3001
npm run dev:web    # Terminal 2: Vite en :5173
```

**Verificar:**

1. **Web:** http://localhost:5173/  
2. **API:** http://localhost:3001/health  
   - Esperado (con Postgres y .env correctos): `"status":"ok"`, `"db":"ok"`, `"postgis":"3.x.x"`.  
   - Si Postgres no está o no hay .env: `"db":"error"`, `"postgis":"connection failed"` (el servicio sigue en marcha).  
3. **Front consumiendo API:** abrir http://localhost:5173/aforos y comprobar que las peticiones a `/api/*` se resuelven (proxy al backend).

**Reinstalar dependencias (reproducible):**

```powershell
Remove-Item -Recurse -Force node_modules
npm ci
```

---

*Generado tras la migración de ruta del repositorio (post-move checklist).*
