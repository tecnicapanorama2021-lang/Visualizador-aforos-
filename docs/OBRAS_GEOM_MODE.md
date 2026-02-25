# GET /api/obras/nodos — Parámetro geomMode

**Fecha:** 2026-02-24

## Descripción

El endpoint `GET /api/obras/nodos` acepta el query param **`geomMode`** para controlar la geometría devuelta en cada feature:

| Valor      | Comportamiento |
|-----------|----------------|
| **`centroid`** (por defecto) | La `geometry` de cada feature es un **Point** (centroide con `ST_PointOnSurface`). Reduce saturación en el mapa; la delimitación real se obtiene con `GET /api/obras/:id/detail`. |
| **`full`** | La `geometry` es la geometría real (Polygon, LineString, Point, etc.). Comportamiento anterior. |

## Uso recomendado

- **Capa Obras en el mapa:** usar `?geomMode=centroid` (o omitir, que es el default) para ver solo puntos. Al hacer click en una obra, el frontend pide el detalle y pinta la delimitación como overlay temporal.
- **Consumidores que necesiten la geometría completa** (p. ej. export, análisis espacial): usar `?geomMode=full`.

## Propiedades cuando se usa geomMode

Cuando se pasa `geomMode=centroid` o `geomMode=full`, cada feature incluye en `properties`:

- **`centroid`**: GeoJSON Point (centroide).
- **`bbox`**: `{ xmin, ymin, xmax, ymax }`.
- **`geom_type`**: Tipo PostGIS (p. ej. `ST_Polygon`, `ST_LineString`, `ST_Point`).
- **`has_full_geometry`**: `true` si en BD la obra tiene geometría (siempre `true` en la respuesta actual).

## Ejemplos

```bash
# Por defecto: centroides (puntos)
GET /api/obras/nodos?active=1

# Explícito centroides
GET /api/obras/nodos?active=1&geomMode=centroid

# Geometría completa (comportamiento legacy)
GET /api/obras/nodos?active=1&geomMode=full
```

## Archivos tocados (entrega)

| Archivo | Cambios |
|---------|--------|
| `routes/capas.js` | `getIncidentesAsGeoJSON`: param `geomMode` ('centroid' \| 'full'), SQL con bbox/geom_type cuando aplica, geometry = centroid o full. Ruta `GET /obras/nodos`: lee `geomMode` (default `centroid`). |
| `src/components/map/AforosMap.jsx` | URL obras con `geomMode=centroid`. Estado `selectedObraShape`; al elegir obra se asigna del detail si no es Point; overlay GeoJSON rojo solo para la seleccionada. Limpieza en `onClosePopup` y al deseleccionar. |
| `src/components/map/popups/PopupObras.jsx` | Normalizador de `metadata.arcgis.attributes_raw`; `displayFields` con heurística (ENTIDAD, RESP, DIRECC, FECHA, etc.); 8–12 campos útiles arriba; acordeón "Ver atributos ArcGIS" abajo; "Sin datos enriquecidos" cuando no hay attrs. |
| `docs/OBRAS_GEOM_MODE.md` | Documentación de `geomMode` y uso de `geomMode=full` para consumidores que necesiten geometría completa. |

## Antes / Después

- **Antes:** El mapa pintaba todas las delimitaciones (GeoJSON) de obras cuando la BD tenía Polygon/LineString, saturando la vista.
- **Después:** Por defecto solo se muestran puntos (centroides). Al hacer click en una obra se dibuja su delimitación real como overlay temporal (rojo, fillOpacity 0.25), junto con desvíos y “around”; el popup muestra campos enriquecidos desde ArcGIS. Al cerrar o cambiar de obra se limpian las capas temporales.
- **Compatibilidad:** Quien dependa de geometría completa en `/api/obras/nodos` puede usar `?geomMode=full`.
