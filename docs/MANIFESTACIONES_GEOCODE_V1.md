# Geocodificación v1 de manifestaciones (heurística)

Geocodificación local para manifestaciones provenientes de RSS (fuente `NEWS_RSS`), sin servicios externos pagos. Objetivo: que las manifestaciones tengan `geom` y se rendericen en el mapa como incidentes normales.

## Resumen

- **Módulo:** `server/lib/geocodeManifestationsV1.js`
- **Función:** `geocodeFromText(text) -> { geom, centroid, confidence, method, matched, buffer_m, debug } | null`
- **Diccionario:** `server/data/corredores_bogota.json` (corredores y lugares de Bogotá con patrón, coordenadas y buffer en metros)

## Heurísticas v1

### A) Diccionario de corredores/lugares

Cada entrada en el JSON tiene:

- **id**: identificador (ej. `autonorte`, `caracas`).
- **pattern**: expresión regular o texto para buscar en el contenido (título + descripción + evidencia). Se aplica sobre texto normalizado (minúsculas, sin tildes).
- **lng**, **lat**: punto base WGS84 (centro del corredor o lugar).
- **buffer_m**: radio en metros para generar un polígono alrededor del punto (buffer en Turf, equivalente a “corredor” o zona de influencia).

El orden del array importa: **primer match gana**. Conviene poner patrones más específicos (ej. “portal suba”) antes que genéricos (ej. “suba”).

### B) Geometría y centroid

- A partir del punto `(lng, lat)` se genera un **polígono** con `turf.buffer(point, buffer_m/1000, { units: 'kilometers' })`.
- Ese polígono se guarda en `incidentes.geom` (tipo Polygon).
- El **centroid** del polígono se usa para la visualización en el mapa cuando el API usa `geomMode=centroid` (por defecto en `/api/manifestaciones/nodos`).

### C) Quality status

- **HIGH**: manifestación con `geom` y fechas claras (`start_at` y `end_at`).
- **MED**: manifestación con `geom` pero sin fechas (o solo una).
- **LOW**: solo texto, sin match en el diccionario (no se asigna `geom`).

El mapa por defecto muestra HIGH y MED (`?quality=high`). Con `?quality=all` se incluyen LOW.

### D) Si no hay match

- No se asigna `geom`; el registro queda con `geom IS NULL` y no se pinta en el mapa hasta que un futuro job o geocodificador le asigne geometría.
- Se mantiene `quality_status` LOW (o el que ya tuviera el incidente).

### E) Metadata de geocode

En `incidentes.metadata.geocode` se guarda:

- `method`: `'DICT_V1'`
- `confidence`: valor numérico (ej. 60)
- `matched`: `id` del diccionario que hizo match
- `buffer_m`: radio usado
- `debug`: datos de depuración (pattern, lng, lat)

## Límites

- **Solo texto:** no se usan servicios externos (geocoding API, etc.). La precisión depende del diccionario.
- **Un match por manifestación:** solo se aplica el primer patrón que coincida; no se combinan varios lugares.
- **Solo últimos 7 días:** el job `news:manifestations:geocode` procesa incidentes con `created_at > now() - interval '7 days'` para limitar carga.
- **Bogotá:** el diccionario está pensado para corredores/lugares de Bogotá. Para otras ciudades haría falta otro archivo o ampliar el mismo.

## Cómo ampliar el diccionario

Editar `server/data/corredores_bogota.json` y añadir objetos con:

- `id`: único (ej. `nueva_avenida`)
- `pattern`: regex o texto (ej. `"nueva avenida|nueva av"`)
- `lng`, `lat`: número (WGS84)
- `buffer_m`: número (metros, ej. 300)

Reiniciar el worker no es obligatorio: el módulo carga el JSON en la primera llamada y lo mantiene en memoria; para ver cambios hay que reiniciar el proceso del worker (o el API si se usara desde allí).

## Job BullMQ

- **Nombre:** `news:manifestations:geocode`
- **Frecuencia:** cada 15 minutos (alineado con el fetch RSS).
- **Procesador:** `server/worker/jobs/newsManifestationsGeocode.js`
- **Registro:** incluido en `npm run jobs:seed` (repeatable en la cola `ingest`).

## Verificación

- Contar manifestaciones con/sin geom y por `quality_status`: ver consultas SQL en `docs/RUNBOOK_JOBS.md`.
- **Manifestación de prueba:** ejecutar `npm run seed:manifestacion-geocode-test`.
- Probar con una noticia que mencione un corredor (ej. “manifestación en la Autopista Norte”) y comprobar que el incidente quede con `geom` no nulo y aparezca en el mapa en `/api/manifestaciones/nodos` (y en la capa Manifestaciones del mapa).

## Referencias

- Runbook jobs: `docs/RUNBOOK_JOBS.md`
- API manifestaciones: `GET /api/manifestaciones/nodos` con `geomMode=centroid` y `quality=high` (por defecto).
