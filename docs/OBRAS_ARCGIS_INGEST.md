# Ingesta de Obras Distritales (ArcGIS) y detalle/desvíos/around

Este documento describe cómo ingerir obras desde el MapServer de Obras Distritales (ArcGIS) con geometría real (polígonos/líneas), y cómo configurar el detalle, desvíos y capas "alrededor" en el frontend.

## ¿Persisten algo en BD los endpoints detail y around?

**No.** Esos endpoints son **solo runtime** (leen BD y/o ArcGIS; no hacen INSERT/UPDATE):

| Endpoint | Archivo | Comportamiento |
|----------|---------|----------------|
| `GET /api/obras/:id/detail` | `routes/capas.js` (líneas 195-245) | SELECT en `incidentes` por `id` y tipo OBRA → devuelve feature, bbox, centroid. **No escribe en BD.** |
| `GET /api/obras/:id/around` | `routes/capas.js` (líneas 252-316) | SELECT en `incidentes` para bbox del incidente; luego **fetch a ArcGIS** (URLs en `OBRAS_AROUND_LAYERS`/`OBRAS_AROUND_URL`) y `res.json`. **No escribe en BD.** |

Para tener obras con geometría real (Polygon/LineString) en `incidentes` hay que ejecutar el ingest `npm run ingest:obras:arcgis`. La llave estable es `(fuente_principal, source_id)`; el índice único parcial existe en la migración 022 (`uq_incidentes_fuente_sourceid`).

## Fuentes

- **Obras:** MapServer Obras Distritales  
  `https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/obraspublicas/MapServer`
- **Desvíos (ya integrado):** SIMUR Desvíos por Obra  
  `https://sig.simur.gov.co/arcgis/rest/services/PMT/Desvios_Por_Obra/MapServer/0/query`

## Descubrimiento de capas (layer_id y objectIdFieldName)

Para saber qué **layer_id** tiene geometría de obras (Polygon/Polyline) y cuál es el **objectIdFieldName**:

```bash
node server/scripts/arcgis/list_layers.js
```

O con URL explícita:

```bash
node server/scripts/arcgis/list_layers.js "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/obraspublicas/MapServer"
```

Con variables de entorno:

```bash
ARCGIS_BASE_URL="https://..." node server/scripts/arcgis/list_layers.js
```

El script lista cada layer/tabla con:

- `id` (layer_id)
- `name`
- `geometryType` (esriGeometryPoint, esriGeometryPolyline, esriGeometryPolygon)
- `objectIdFieldName` (normalmente `OBJECTID`)
- `maxRecordCount`
- `fields`

**Selecciona el layer_id** que corresponda a geometría de obra (por ejemplo Polygon o Polyline). Las tablas sin geometría no sirven para este ingest.

## Configuración del ingest

En `.env` (o entorno):

| Variable | Descripción | Ejemplo |
|----------|-------------|--------|
| `ARCGIS_BASE_URL` | URL base del MapServer | `https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/gestionpublica/obraspublicas/MapServer` |
| `LAYER_ID` | ID del layer con geometría de obras (ver list_layers). **Polígonos:** layer `2` = "Obras Polígono". Puntos = 0, Línea = 1. | `2` |
| `FUENTE_PRINCIPAL` | Valor para `incidentes.fuente_principal` | `OBRAS_DISTRITALES_ARCGIS` |
| `TIPO` | Tipo de incidente | `OBRA` |

El script usa por defecto `objectIdFieldName` devuelto por el MapServer (suele ser `OBJECTID`). El **source_id** en incidentes se rellena con el OBJECTID/GlobalID del feature.

## Cómo refrescar el ingest

**Dry-run (solo muestra qué se insertaría/actualizaría, sin escribir en DB):**

```bash
npm run ingest:obras:arcgis:dry
```

**Aplicar ingest (upsert en tabla `incidentes`):**

```bash
npm run ingest:obras:arcgis
```

El script hace paginación con `resultOffset`/`resultRecordCount` según `maxRecordCount` del layer. Los registros se upsert por `(fuente_principal, source_id)`.

En cada incidente se guarda:

- `geom`: geometría en WGS84 (4326), Polygon o LineString según el layer.
- `metadata.arcgis`: `layer_url`, `layer_id`, `objectid`, `attributes_raw` (todos los atributos del feature), `ingested_at`.
- Columnas mapeadas cuando existen en atributos: `titulo`, `descripcion`, `estado`, `start_at`, `end_at`.

## Cómo validar que existen obras no-Point

Tras ejecutar `npm run ingest:obras:arcgis` con un layer que tenga Polygon o Polyline:

1. **Conteo por tipo de geometría en PostgreSQL:**

   ```sql
   SELECT ST_GeometryType(geom) AS tipo, COUNT(*)
   FROM incidentes
   WHERE tipo = 'OBRA' AND geom IS NOT NULL
   GROUP BY 1;
   ```

   Deberías ver filas como `ST_Polygon` o `ST_LineString` además de `ST_Point` (si mezclas fuentes).

2. **API de nodos:**  
   `GET /api/obras/nodos` devuelve todas las obras de `incidentes` (incluidas no-Point). El frontend usa `centroid` para el marcador y la geometría real para dibujar polígono/línea en el popup.

3. **Detalle de una obra:**  
   `GET /api/obras/:id/detail` incluye `feature.geometry` con el tipo real (Polygon/LineString) y `metadata.arcgis.attributes_raw` si viene del ingest ArcGIS.

**Regla:** no se modifica `/api/obras/nodos` ni el flujo del mapa; el ingest solo inserta/actualiza en `incidentes`.

### Verificación por script (BD)

Para ejecutar las tres consultas SQL de evidencia (tipos geométricos, 5 obras no-point, conteo con metadata arcgis):

```bash
node server/scripts/verify/run_obras_geom_queries.js
```

### Verificación por API (con servidor levantado)

Con el backend en marcha (`npm run dev:api` o `npm run dev`):

1. **Conteo Polygon/MultiPolygon en nodos:**  
   `GET http://localhost:3001/api/obras/nodos?active=1` → revisar `features[].geometry.type` (debe haber `Polygon` o `MultiPolygon`).
2. **Detalle de una obra polígono:**  
   `GET http://localhost:3001/api/obras/<incidente_id>/detail` → comprobar `feature.geometry.type` y `feature.properties.metadata.arcgis.attributes_raw`.

Ejemplo de `incidente_id` polígono tras el ingest de layer 2: el id numérico más alto de la query B anterior (p. ej. 5139).

## Capas "alrededor" (cierres / elementos cercanos)

Al hacer click en una obra, el frontend puede cargar capas ArcGIS en un radio (p. ej. 500 m) para mostrar cierres u otros elementos cercanos.

### Configuración por entorno

**Opción 1 – Varias capas (recomendado)**  
Variable `OBRAS_AROUND_LAYERS`: JSON array de objetos `{ "url": "...", "name": "NombreCapa" }`.

Ejemplo en `.env`:

```env
OBRAS_AROUND_LAYERS=[{"url":"https://sig.simur.gov.co/arcgis/rest/services/PMT/Cierres/MapServer/0","name":"Cierres"}]
```

**Opción 2 – Una sola capa**  
Variable `OBRAS_AROUND_URL`: URL del endpoint de query del layer. Se usará el nombre por defecto "around".

```env
OBRAS_AROUND_URL=https://sig.simur.gov.co/arcgis/rest/services/PMT/Cierres/MapServer/0
```

Si **no** se configura ninguna de las dos, el endpoint `GET /api/obras/:incidenteId/around` devuelve `{}` y el frontend no pinta capas "around".

### Cómo configurar una nueva capa de cierres

1. Localiza el MapServer/layer de cierres (p. ej. en SIMUR o Catastro) que soporte query con `geometry` y `geometryType=esriGeometryEnvelope`.
2. Añade una entrada en `OBRAS_AROUND_LAYERS` con la URL del **layer** (sin `/query`), por ejemplo:  
   `https://servicios.../MapServer/0`
3. Reinicia el servidor y prueba con una obra que tenga geometría; el frontend pedirá `?radius_m=500` por defecto.

El backend hace la query espacial con envelope (bbox del buffer en 4326) y `esriSpatialRelIntersects`, y devuelve `{ [name]: FeatureCollection }`.

## Resumen de endpoints y frontend

| Acción | Endpoint | Uso |
|--------|----------|-----|
| Detalle obra | `GET /api/obras/:incidenteId/detail` | Atributos, geometría, bbox, centroid |
| Desvíos SIMUR | `GET /api/obras/:incidenteId/desvios` | Desvíos asociados a la obra |
| Cierres/alrededor | `GET /api/obras/:incidenteId/around?radius_m=500` | Capas configuradas en `OBRAS_AROUND_LAYERS` / `OBRAS_AROUND_URL` |

En el mapa, al hacer click en una obra:

1. Se cargan **detail**, **desvíos** y **around** (si hay config).
2. El popup muestra atributos del detail (titulo, descripcion, estado, fechas) y opcionalmente "Ver atributos ArcGIS".
3. Se dibujan la geometría de la obra (si es polígono/línea), los desvíos (estilo naranja) y las capas "around" (estilo ámbar, relleno semitransparente).

No se modifican `/api/obras/nodos` ni el flujo de aforos; los nuevos endpoints tienen fallback a vacío si no hay datos o no hay configuración.
