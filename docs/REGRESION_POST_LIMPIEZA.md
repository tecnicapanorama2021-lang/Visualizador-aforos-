# Regresión post-limpieza (movimiento .md / .py)

Checklist ejecutable y criterios de verificación tras mover documentación a `docs/referencia/` y scripts Python a `scripts/python/`. Objetivo: asegurar que el repo no se rompió sin cambiar lógica de negocio.

---

## Comandos exactos (PowerShell, desde la raíz del proyecto)

```powershell
# 1) Raíz limpia (solo README.md como .md; no .py en raíz)
npm run check:root

# 2) Arranque canónico: liberar puertos y levantar API + front
node scripts/kill-ports.js
.\scripts\dev.ps1
# Dejar esta ventana abierta; en otra terminal seguir:

# 3) Verificación de endpoints de diagnóstico (API debe estar en 3001)
npm run verify:debug

# 4) Conteos de features GeoJSON por capa (7 capas)
$base = "http://localhost:3001"
(Invoke-RestMethod "$base/api/aforos/nodos").features.Count
(Invoke-RestMethod "$base/api/obras/nodos").features.Count
(Invoke-RestMethod "$base/api/eventos/nodos").features.Count
(Invoke-RestMethod "$base/api/manifestaciones/nodos").features.Count
(Invoke-RestMethod "$base/api/conciertos/nodos").features.Count
(Invoke-RestMethod "$base/api/semaforos/nodos").features.Count
(Invoke-RestMethod "$base/api/base/nodos").features.Count

# 5) Build del front
npm run build
```

### Script todo-en-uno (opcional)

Para ejecutar todo en una sola ventana **con la API arrancada en background** (solo API, no Vite):

```powershell
.\scripts\regresion-post-limpieza.ps1 -StartApi
```

*Nota:* Con `-StartApi` el script inicia `node server.js` en un proceso separado; ese proceso puede seguir en ejecución tras terminar el script. Para cerrarlo: `node scripts/kill-ports.js` o cerrar la ventana donde se lanzó.

Sin `-StartApi`, el script asume que la API ya está corriendo (por ejemplo tras `.\scripts\dev.ps1` en otra terminal):

```powershell
.\scripts\regresion-post-limpieza.ps1
```

---

## Criterios PASS/FAIL

| Paso | Criterio PASS | Criterio FAIL |
|------|----------------|----------------|
| **check:root** | Exit 0; mensaje "OK: raíz limpia..." | Exit 1; lista de .md/.py en raíz que no deberían estar |
| **Arranque** | Puertos 3001 (API) y 5173 (web) en LISTENING tras `dev.ps1` | Timeout o proceso no arranca |
| **verify:debug** | Exit 0; todos los endpoints `/api/debug/*` responden 200 | Exit 1; alguno no 200 (ver diagnóstico abajo) |
| **Conteos 7 capas** | Cada `GET /api/<capa>/nodos` devuelve JSON con `.features` (array, puede ser 0) | Timeout, 5xx, o respuesta sin `.features` |
| **build** | Exit 0; `dist/` generado sin errores | Exit 1; error de Vite/build |

**Regresión global:** PASS si todos los pasos son PASS; FAIL si alguno falla.

---

## Cómo diagnosticar fallos

### Backend viejo o no arrancado

- **Síntoma:** `verify:debug` falla o los conteos de capas dan error de conexión.
- **Comprobar:** `Invoke-RestMethod http://localhost:3001/api/debug/ping` debe devolver algo (200).
- **Solución:** Reiniciar desde la raíz: `node scripts/kill-ports.js` y luego `.\scripts\dev.ps1` (o `npm run dev`). Asegurar que se usa `server.js` como entrypoint (banner "[BOOT] Backend canónico incidentes v1").

### Rutas API / capas

- **Síntoma:** Algún `/api/<capa>/nodos` devuelve 404 o 500.
- **Comprobar:** Revisar que `routes/capas.js` y `routes/aforos.js` están montados en `server.js` y que la BD/migraciones están al día (`npm run db:migrate` 001–023).
- **Fuente única incidentes:** Obras/eventos/manifestaciones/conciertos leen de tabla `incidentes` (+ `incidentes_sources`); si están vacíos, puede haber fallback a datos legacy.

### Build

- **Síntoma:** `npm run build` falla.
- **Comprobar:** Errores de Vite en consola; imports rotos o variables de entorno. No debería depender de los movimientos .md/.py si no se referencian desde el front.

### Raíz no limpia

- **Síntoma:** `npm run check:root` falla.
- **Comprobar:** No debe haber en la raíz ningún `.md` salvo `README.md`, ni ningún `.py` (deben estar en `docs/referencia/` y `scripts/python/`).

---

## Resumen de cambios aplicados (post-limpieza)

Se corrigieron **referencias y rutas** sin cambiar lógica de negocio:

1. **install_dependencies.bat / install_dependencies.sh**  
   - Movidos a **scripts/setup/**; usan `scripts/python/requirements.txt`. Ejecutar desde la raíz: `scripts\setup\install_dependencies.bat` o `./scripts/setup/install_dependencies.sh`. El mensaje final indica `python scripts\python\download_sensors.py` (Windows) y `python scripts/python/download_sensors.py` (Unix).

2. **scripts/python/README.md**  
   - Nota añadida: ejecutar desde la raíz con `python scripts/python/...` para que las rutas relativas a `src/data` y `public/data` resuelvan correctamente.

3. **Scripts Python (rutas robustas)**  
   - En los scripts que usaban rutas relativas al CWD se introdujo `PROJECT_ROOT = Path(__file__).resolve().parent.parent` y se reemplazaron las rutas por paths relativos a `PROJECT_ROOT`:
     - `download_sensors.py`: `src/data/nodos_ideca.json`
     - `geocode_missing_nodes.py`: `src/data/studies_dictionary.json`, `nodos_unificados.json`, `geocode_progress.json`, `public/data/nodos_unificados.json`
     - `filter_bogota_only.py`: `src/data/nodos_unificados.json`, `public/data/nodos_unificados.json`
     - `get_socrata_metadata.py`: `data/socrata_metadata.json`
     - `download_unified_nodes.py`: `src/data/nodos_unificados.json`
     - `download_nodes_from_socrata.py`: `src/data/nodos_unificados.json`
     - `harvest_dim_studies.py`: `src/data/studies_dictionary.json`
   - Así los scripts funcionan tanto ejecutando desde la raíz como desde `scripts/python/`, sin depender del directorio de trabajo.

Nada se borró ni se movió de carpeta salvo estas correcciones de referencias y paths.

---

## Smoke manual (flujo C) — PR-3 y posteriores

Para validar que el flujo canónico sigue intacto tras cambios en scripts/catálogo:

| Prueba | Comando | Criterio |
|--------|--------|----------|
| **Dev** | Terminal 1: `npm run dev:api`; Terminal 2: `npm run dev:web`; Terminal 3: `npm run worker` | API en 3001, web en 5173, worker sin crash (Redis arriba). |
| **Prod** | `npm run build && npm run start` | Build OK; API arranca y responde. |
| **bootstrap:local** | `npm run bootstrap:local` (entorno local con .env, PG y Redis) | Migraciones aplican; jobs:seed registra repeatables; si falta PG/Redis, falla con mensaje claro (exit ≠ 0). |

Documentar aquí resultados si se ejecutan (ej. “Smoke C OK 2026-02” o “bootstrap:local falla por Redis no disponible, mensaje claro”).
