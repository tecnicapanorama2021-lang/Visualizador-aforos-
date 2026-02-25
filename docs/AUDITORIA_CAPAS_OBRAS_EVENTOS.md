# Auditoría: datos de obras, eventos, manifestaciones y semáforos

**Objetivo:** Confirmar si existían más datos históricos, dónde estaban y por qué ahora solo hay 1 registro por capa en el mapa.

---

## FASE 1 — Fuentes históricas encontradas

### 1.1 Rutas y endpoints

| Ruta / concepto | Ubicación | Fuente de datos |
|-----------------|-----------|------------------|
| **GET /api/datos-unificados/obras** | `routes/datosUnificados.js` | **Archivo** `public/data/calendario_obras_eventos.json` (obras con geometry) |
| **GET /api/datos-unificados/calendario** | Idem | Mismo archivo (obras + eventos, filtros por nodo_id/desde/hasta) |
| **GET /api/datos-unificados/contexto-eventos** | Idem | **BD** tabla `contexto_eventos` (tiene geom, tipo, fuente IDU/RSS, etc.) |
| **GET /api/obras/nodos** (nuevo) | `routes/capas.js` | **BD** tabla `obras` (migración 020) |
| **GET /api/eventos/nodos** | Idem | **BD** tabla `eventos_urbanos` (020) |
| **GET /api/semaforos/nodos** | Idem | **BD** tabla `semaforos` (020) |

El mapa **antes** (modelo multicapa con tabs) podía mostrar obras desde **datos-unificados/obras** vía el botón "Obras" y `ConstructionLayer`, que consumía ese endpoint y dibujaba los puntos del JSON.  
El mapa **ahora** (capas reales) solo consume **BD**: `/api/obras/nodos`, `/api/eventos/nodos`, etc., que leen de las tablas `obras`, `eventos_urbanos`, `semaforos`.

### 1.2 Archivos ETL y jobs

| Script | Qué hace | Dónde escribe |
|--------|----------|----------------|
| **jobCalendarioObras.js** | Obras desde **IDU FeatureServer** (principal), CKAN/ArcGIS (respaldo) | `public/data/calendario_obras_eventos.json` (sección `obras`) |
| **jobCalendarioEventos.js** | Eventos desde **RSS** (Google News, El Tiempo Bogotá) | Mismo archivo (sección `eventos`) |
| **etl_contexto_eventos.js** | Lee `calendario_obras_eventos.json` e inserta/actualiza | Tabla **contexto_eventos** (no `obras` ni `eventos_urbanos`) |

**Migrations anteriores a 020:**  
- **007_contexto_eventos.sql**: crea tabla `contexto_eventos` (tipo, subtipo, descripcion, geom, fuente, origen_id, etc.).  
- **011**, **012**: añaden localidad_id, upz_id, ubicacion_texto, zona_texto a `contexto_eventos`.  
- **020_multicapas.sql**: crea tablas `obras`, `eventos_urbanos`, `semaforos` (por nodo, con `nodo_id` FK) y **solo inserta 1 registro demo por tabla** (LIMIT 1).

En todo el repo, los **únicos** `INSERT` en `obras`, `eventos_urbanos` y `semaforos` están en la migración 020 (semilla demo). No existe ningún ETL que llene esas tablas a partir de CSV, CKAN, IDU ni de datos-unificados.

### 1.3 Referencias externas (CKAN, SIMUR, IDU, DIM, open data)

- **IDU:** `jobCalendarioObras.js` usa `OBRAS_IDU_URL` (FeatureServer IDU) para poblar el JSON de obras.  
- **CKAN:** mismo job usa `CKAN_BASE` / `CKAN_OBRAS_RESOURCE_ID` como respaldo.  
- **RSS:** `jobCalendarioEventos.js` para eventos del calendario.  
- **SIMUR:** mencionado en docs (red semafórica, velocidades); semáforos en BD solo tienen el demo con `origen = 'SIMUR'`.  
- **DIM:** estudios/aforos (nodos, estudios, conteos); no alimenta obras/eventos/semáforos.  
- **contexto_eventos:** fuentes en BD pueden ser SDM, IDU, UMV, SCRD, RSS, MANUAL, DATOS_ABIERTOS (según 007).

---

## FASE 2 — Base de datos actual

Queries para ejecutar en tu instancia (psql o cliente):

```sql
-- Conteos por tabla de capas (020)
SELECT COUNT(*) AS total FROM obras;
SELECT COUNT(*) AS total FROM eventos_urbanos;
SELECT COUNT(*) AS total FROM semaforos;

-- Muestra 5 registros de cada una
SELECT id, nodo_id, titulo, estado, fecha_ini, fecha_fin FROM obras ORDER BY id LIMIT 5;
SELECT id, nodo_id, tipo_evento, titulo, fecha_ini, fecha_fin FROM eventos_urbanos ORDER BY id LIMIT 5;
SELECT id, nodo_id, codigo, estado_operativo, origen FROM semaforos ORDER BY id LIMIT 5;
```

Resultado esperado con el estado actual del repo: **1 fila en cada tabla** (las tres son las insertadas por la migración 020 con el seed demo).

Opcional: comparar con la tabla que sí puede tener volumen (rellenada por ETL desde el mismo JSON):

```sql
SELECT COUNT(*) AS total FROM contexto_eventos;
SELECT tipo, fuente, COUNT(*) FROM contexto_eventos GROUP BY tipo, fuente;
```

Si en algún momento se ejecutó `npm run etl:contexto`, `contexto_eventos` puede tener muchas filas (obras y eventos del calendario); pero **el mapa de capas reales no usa esta tabla**, solo `obras` y `eventos_urbanos`.

---

## FASE 3 — Datos-unificados: de dónde salían los datos

- **Implementación:** `routes/datosUnificados.js`.
- **GET /api/datos-unificados/obras:**  
  Lee **solo** el archivo `public/data/calendario_obras_eventos.json` y devuelve `data.obras` filtrando las que tienen `geometry.coordinates` (para dibujar en mapa).  
  No es mock: es un JSON real mantenido por los jobs.
- **GET /api/datos-unificados/calendario:**  
  Mismo archivo; devuelve obras y eventos con filtros opcionales (nodo_id, desde, hasta).
- **GET /api/datos-unificados/contexto-eventos:**  
  Lee de la **tabla BD `contexto_eventos`** (no del JSON). Es la única ruta de datos-unificados que usa BD para eventos/obras.

En el repo, el archivo `public/data/calendario_obras_eventos.json` tiene en `metadata`:

- `"total_obras": 153`
- `"fuentes": { "idu": 153, "ckan": 0, "arcgis": 0 }`

Es decir: **sí existían más datos de obras** (153), en el **archivo** del calendario, servidos por **datos-unificados/obras**. Esos datos **nunca** se cargaron en la tabla `obras` de la migración 020; esa tabla solo tiene el registro demo.

---

## FASE 4 — Refactor reciente (capas reales)

En la migración al modelo de “capas reales”:

- Se dejó de usar en el mapa el endpoint **GET /api/datos-unificados/obras** y el componente **ConstructionLayer** que dibujaba esas obras.
- El mapa pasa a usar solo **GET /api/obras/nodos** (y el resto de capas), que leen de las tablas **obras**, **eventos_urbanos**, **semaforos**.
- Esas tablas solo tienen el **seed de la migración 020** (1 obra, 1 evento, 1 semáforo).

No se eliminó el archivo `calendario_obras_eventos.json` ni las rutas de datos-unificados; siguen disponibles, pero el mapa ya no las usa para las capas de obras/eventos/semáforos.

---

## FASE 5 — Diagnóstico final

**A) ¿Los datos reales nunca existieron en BD (obras / eventos_urbanos / semaforos)?**  
**Sí.** Las tablas `obras`, `eventos_urbanos` y `semaforos` solo se rellenan con el seed de la migración 020 (1 fila por tabla). No hay en el proyecto ningún ETL ni script que inserte más registros en esas tablas.

**B) ¿Existían en datos-unificados y ahora “se perdieron”?**  
**Parcialmente.** Los datos **no se borraron**: siguen en `public/data/calendario_obras_eventos.json` (153 obras desde IDU) y el endpoint **GET /api/datos-unificados/obras** sigue sirviéndolos. Lo que cambió es que el **mapa ya no usa** ese endpoint para la capa de obras; usa solo `/api/obras/nodos`, que lee de la tabla `obras` (1 registro). Por tanto, lo que “desapareció” es el **uso** de esos datos en el mapa, no los datos en sí.

**C) ¿Había integración externa que ahora no se está usando?**  
**Sí.**  
- **IDU (y opcionalmente CKAN/ArcGIS):** `jobCalendarioObras.js` actualiza el JSON de obras; ese JSON ya no se muestra en el mapa de capas.  
- **RSS (eventos):** `jobCalendarioEventos.js` actualiza la sección eventos del mismo JSON; el mapa de capas no usa esos eventos (usa solo `eventos_urbanos` en BD).  
- **contexto_eventos:** la API **GET /api/datos-unificados/contexto-eventos** sigue leyendo de BD y podría tener muchos registros si se corrió `etl:contexto`; pero las capas del mapa no consumen esta ruta.

**D) ¿Se necesita nuevo ETL para poblar obras/eventos reales?**  
**Sí, si quieres que el mapa de capas reales muestre más de 1 obra y más de 1 evento.** Opciones coherentes con lo que ya existe:

1. **ETL desde calendario → tablas 020**  
   Crear un script (o ampliar uno existente) que:  
   - Lea `public/data/calendario_obras_eventos.json` (o el resultado de los jobs).  
   - Para cada obra con geometría, resuelva o cree un `nodo_id` (por ejemplo por proximidad a nodos existentes en `nodos`) e inserta en **obras**.  
   - Para eventos, análogamente, insertar en **eventos_urbanos** con un `nodo_id` resuelto.  
   Así las rutas `/api/obras/nodos`, `/api/eventos/nodos`, etc., devolverían muchos más puntos.

2. **Reutilizar contexto_eventos**  
   La tabla `contexto_eventos` ya puede contener muchas obras/eventos (si se ejecutó `etl:contexto`). Podrías:  
   - Exponer una capa tipo **GET /api/contexto-eventos/nodos** que convierta registros de `contexto_eventos` a GeoJSON (con geom ya existente) y mostrarla como una capa adicional en el mapa, o  
   - Un ETL que, a partir de `contexto_eventos`, asigne `nodo_id` (por proximidad a `nodos`) e inserte en `obras` / `eventos_urbanos` para que sigan sirviéndose por las rutas actuales de capas.

Para **semaforos**, no aparece en el repo ninguna fuente externa que los popule; solo el registro demo de la 020. Si se dispone de una fuente (p. ej. SIMUR u otra), haría falta un ETL que inserte en la tabla `semaforos` vinculando a `nodos`.

---

## Resumen

| Dónde estaban los datos | Estado actual |
|-------------------------|----------------|
| **calendario_obras_eventos.json** | Sigue existiendo; en el repo actual hay 153 obras (IDU). Servido por /api/datos-unificados/obras. |
| **Mapa “Obras” (antes)** | Usaba datos-unificados/obras + ConstructionLayer → se veían muchas obras. |
| **Mapa capas reales (ahora)** | Usa solo BD: obras, eventos_urbanos, semaforos → solo 1 registro por tabla (seed 020). |
| **contexto_eventos** | Tabla distinta; puede tener muchos registros si se corrió etl:contexto; el mapa de capas no la usa. |
| **ETL a obras/eventos_urbanos** | No existe; solo el seed de la migración 020. |

Conclusión: los datos “históricos” de obras (y eventos del calendario) **sí existían** en el proyecto, en el **archivo de calendario** y en la API **datos-unificados**; no se migraron a las tablas `obras` y `eventos_urbanos`. Para tener más de 1 registro por capa en el mapa actual hace falta un ETL (o uso de `contexto_eventos`) que alimente esas tablas o que exponga sus datos como capas.
