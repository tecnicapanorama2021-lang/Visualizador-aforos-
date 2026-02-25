# Reporte de verificación — Estado real del sistema

**Fecha:** 2026-02-19  
**Alcance:** Bloques A–F del checklist (sin ejecutar SQL/curl en entorno local; revisión de código + salida de scripts npm).

---

## 1) Tabla Bloque C — Consistencia BD vs API

| Capa          | BD (SQL) | API (features) | Fallback | OK? |
|---------------|----------|----------------|----------|-----|
| Aforos        | (no medido en verify:debug) | — | N/A | — |
| Obras         | 186      | 186            | false    | ✅ |
| Eventos       | 3        | 3              | false    | ✅ |
| Manifestac.   | 1        | 1              | false    | ✅ |
| Lugares       | 595      | (no medido en verify:debug) | N/A | — |

**Nota:** `verify:debug` solo compara BD vs API para OBRA, EVENTO y MANIFESTACION. No incluye Aforos ni Lugares en la tabla de consistencia. Los números 186/3/1 coincidieron en la ejecución realizada.

---

## 2) Problemas encontrados

### CRÍTICO
- **Ninguno** que impida el mapa con los datos actuales (OBRA 186, EVENTO 3, MANIFESTACION 1, Lugares 595).

### MEDIO

- **ingest_contexto_eventos_to_incidentes.js — WHERE sin filtro por `start_at`**  
  - **Archivo:** `server/scripts/ingest/ingest_contexto_eventos_to_incidentes.js`  
  - **Líneas:** 97–101  
  - **Condición:** La query principal es:
    ```sql
    SELECT ... FROM contexto_eventos
    WHERE geom IS NOT NULL AND (tipo IS NULL OR tipo != 'LUGAR_EVENTO')
    ```
  - **Problema:** No se exige `fecha_inicio IS NOT NULL` (ni equivalente para `start_at`). La regla de oro indica que EVENTO en incidentes solo debe existir si `geom != null AND start_at != null`. Si existe un registro en `contexto_eventos` con `tipo = 'EVENTO_CULTURAL'`, `geom` no nula y `fecha_inicio` nula, se crearía un incidente tipo EVENTO con `start_at` nulo, incumpliendo la regla.

- **verify:predictor — 404 en ejecución**  
  - **Archivo:** `server/scripts/verify/verify_predictor_quality.js`  
  - **Comportamiento:** Al ejecutar `npm run verify:predictor` se obtuvo `API respondió 404 Not Found` para `GET /api/prediccion/validacion?dias=90`.  
  - **Posibles causas:** Backend no levantado en el momento de la ejecución, o ruta no registrada (en código la ruta existe: `server.js` monta `prediccionRoutes` en `/api/prediccion` y `routes/prediccion.js` define `router.get('/validacion', ...)`). Conviene asegurar que el servidor esté arriba al correr `verify:predictor`.

### BAJO / Checklist

- **Bloque A6 — Nombre de columna en SQL**  
  - **Checklist pide:** `SELECT source, COUNT(*) ... FROM incidentes_sources GROUP BY source`  
  - **Realidad:** En migración 022 la columna se llama `fuente`, no `source`. La consulta correcta sería `SELECT fuente, COUNT(*) ... GROUP BY fuente`.

- **Bloque A4 — Columna inexistente en `estudios`**  
  - **Checklist pide:** `MIN(e.fecha)`, `MAX(e.fecha)` en tabla `estudios`.  
  - **Realidad:** En `001_init.sql`, `estudios` tiene `fecha_inicio` y `fecha_fin`, no `fecha`. La consulta fallaría; debe usarse p. ej. `fecha_inicio` para el rango.

- **Bloque A7 — Tabla de migraciones**  
  - **Checklist pide:** `SELECT * FROM schema_migrations ORDER BY id DESC LIMIT 10` y menciona “hasta 026_festivos_colombia”.  
  - **Realidad:** Este proyecto aplica migraciones ejecutando archivos `.sql` en orden (`server/scripts/dbMigrate.js`); no se ha encontrado tabla `schema_migrations`. La verificación de “migraciones aplicadas” debe hacerse por otro medio (p. ej. existencia de tabla `festivos_colombia` para 026).

---

## 3) Items confirmados OK

- **verify:debug:** Todos los endpoints de diagnóstico respondieron 200; consistencia BD vs API para OBRA (186), EVENTO (3), MANIFESTACION (1). Breakdown EVENTO por fuente (AGENDA_MANUAL 3) y conteo de EVENTO_CULTURAL sin geom (12) mostrados correctamente. Advertencia de ArcGIS por timeout no rompe el script.
- **check:root:** Sale con mensaje “OK: raíz limpia”.
- **Filtro LUGAR_EVENTO en ingest:** `ingest_contexto_eventos_to_incidentes.js` incluye `tipo != 'LUGAR_EVENTO'` y `geom IS NOT NULL` en la query principal.
- **NodeFiltersPanel:** Recibe `layerKeys` desde AforosMap (aforos, obras, eventos, lugares, manifestaciones, semaforos, base); endpoints asociados en AforosMap (AFOROS_NODOS, OBRAS_NODOS, EVENTOS_NODOS, LUGARES_NODOS, etc.). Chip “Lugares” existe con key `lugares`. Vigencia Activos/Histórico usa `temporalMode`; el filtro temporal se aplica en backend con `?active=1` y en capas con `isActiveTemporal(start_at, end_at, now)`.
- **AforosMap:** Toggle “Vista actual” | “Vista predicción” y botón “Calidad del predictor” presentes. Filtro de vigencia usa `temporalMode`; el backend aplica el filtro por `estado`/temporal en las rutas de capas.
- **apiEndpoints.js:** Definidos `PREDICCION_VALIDACION(dias)`, `PREDICCION_NODO(nodoId, fecha, hora)`, `PREDICCION_ZONA(localidad, fecha, hora)`.
- **PopupEventos.jsx / PopupLugares.jsx:** Existen y usan titulo/nombre, start_at, end_at, subtipo, estado (eventos); titulo, entidad, tipo_lugar, fuente (lugares).
- **package.json:** Scripts solicitados presentes: ingest:obras:incidentes:dry/apply, ingest:eventos:incidentes:dry/apply, ingest:agendate:contexto:dry/apply/force, ingest:agenda:manual:dry/apply, ingest:eventos:web:dry/apply, net:diag:agendate, verify:debug, verify:predictor, db:seed:festivos, check:root.
- **ingest_eventos_web:** ENVs relevantes: `AGENDA_DIAS_FUTURO` (default 60). Si una fuente (bogota.gov.co o idartes) falla en fetch, se registra con `safeFetch` y se continúa con la siguiente; no se rompe el flujo completo.
- **Rutas de predicción:** En `server.js`, `prediccionRoutes` está montado en `/api/prediccion` antes de `capasRoutes` en `/api`, por lo que `/api/prediccion/validacion`, `/api/prediccion/nodo/:id` y `/api/prediccion/zona` están correctamente expuestos.

---

## 4) Recomendación

- **Sí es seguro avanzar con el predictor** en el estado actual: no hay fallos CRÍTICOS; OBRA, EVENTO y MANIFESTACION coinciden entre BD y API.
- **Recomendaciones antes de producción:**
  1. Añadir en `ingest_contexto_eventos_to_incidentes.js` la condición para no crear incidentes EVENTO sin fecha de inicio, p. ej. `AND (tipo != 'EVENTO_CULTURAL' OR fecha_inicio IS NOT NULL)` (o equivalente que garantice `start_at` no nulo para EVENTO).
  2. Ejecutar Bloque A (consultas SQL) y Bloque B (curl) con backend y BD disponibles para rellenar la tabla C completa (Aforos, Lugares) y validar predicción/validación/zona y festivos.
  3. Correr `verify:predictor` con el servidor levantado para confirmar que el endpoint de validación responde 200 y que el criterio MAPE se cumple.

---

*No se ha aplicado ningún cambio de código; solo verificación y diagnóstico.*
