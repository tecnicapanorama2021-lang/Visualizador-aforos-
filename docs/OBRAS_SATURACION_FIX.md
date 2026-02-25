# Fix: Saturación del mapa Obras + ocultar obras sin calidad

**Fecha:** 2026-02-24

---

## 1) Causa de las delimitaciones masivas

Aunque el front ya pedía `/api/obras/nodos?geomMode=centroid` y el backend devolvía geometría Point en ese modo, **el mapa seguía pintando todas las delimitaciones** porque:

1. **Render genérico por capa:** En `AforosMap.jsx`, el bucle que dibuja las capas trataba **todas** las features igual: si `geometry.type` era `Polygon`, `LineString`, etc., se renderizaba un `<GeoJSON>` para esa feature. Así, si en algún momento el API devolvía geometría completa (cache, fallback, o petición sin `geomMode`), o si otra capa (eventos/manifestaciones) tenía polígonos, se pintaban muchas geometrías.
2. **Capa Obras sin excepción:** Para la capa `obras` no había lógica que forzara “solo punto”. Cualquier obra con geometría Polygon/LineString en la respuesta se dibujaba como GeoJSON en rojo.

**Conclusión:** La causa era el **render en front**: el mismo bucle que pinta puntos pintaba también Polygon/LineString para todas las capas; para Obras no se obligaba a usar solo centroide.

---

## 2) Cambios realizados

### 2.1 Frontend: solo puntos para Obras

- **AforosMap.jsx**
  - Para `key === 'obras'`, si la feature tiene geometría Polygon/LineString/Multi*, **no** se pinta `<GeoJSON>` con la colección. Se usa siempre el **centroide** (`properties.centroid`) y se dibuja un **CircleMarker**. Así la capa Obras solo muestra puntos.
  - La única delimitación que se pinta es **selectedObraShape** (una sola Feature desde `detail.feature`), con `<GeoJSON key={selectedObraShape?.properties?.incidente_id ?? 'none'}>` para forzar remount al cambiar de obra.
  - Log en DEV: `selectedObraShape type` (Feature vs FeatureCollection) para validar que sea una sola feature.
  - Request de obras: se mantiene `geomMode=centroid` y se añaden `onlyWithGeometry=1` y `onlyEnriched=1` cuando los toggles están activos.
  - Estado nuevo: `obrasOnlyWithGeometry`, `obrasOnlyEnriched`; se pasan a `NodeFiltersPanel` y a la URL de obras.

### 2.2 Backend: filtros de calidad

- **routes/capas.js**
  - `getIncidentesAsGeoJSON`: nuevos params `onlyWithGeometry` y `onlyEnriched` (solo para `tipo === 'OBRA'`).
  - `onlyWithGeometry=1`: `AND ST_GeometryType(geom) != 'ST_Point'` (solo obras con geometría rica).
  - `onlyEnriched=1`: `AND metadata->'arcgis'->'attributes_raw'` presente y con al menos una de las claves `titulo`, `objeto`, `entidad`.
  - Ruta `GET /api/obras/nodos`: lee `onlyWithGeometry` y `onlyEnriched` por query y los pasa a `getIncidentesAsGeoJSON`.

### 2.3 UI: toggles Obras

- **NodeFiltersPanel.jsx**
  - Nueva sección “Obras” con dos checkboxes:
    - “Solo obras con delimitación” → `onlyWithGeometry=1`.
    - “Solo obras con detalle” → `onlyEnriched=1`.

### 2.4 Popup Obras: detalle más útil

- **PopupObras.jsx**
  - Timestamps ArcGIS (milisegundos) convertidos a fecha legible con `formatArcGISTimestamp`.
  - Valores que parecen códigos (cortos, alfanuméricos) se muestran como “Código X”.
  - Prioridad de campos: nombre/objeto, tramo/dirección, localidad, entidad, fechas (`PRIORITY_PATTERNS`).

---

## 3) Archivos tocados (diff resumido)

| Archivo | Cambios |
|--------|---------|
| **src/components/map/AforosMap.jsx** | Obras: Polygon/LineString no se pintan como GeoJSON; se usa centroid → CircleMarker. Overlay solo `selectedObraShape` con `key` por `incidente_id`. Log DEV selectedObraShape. Estado y URL `obrasOnlyWithGeometry`, `obrasOnlyEnriched`. Dependencias del useEffect de capas. |
| **routes/capas.js** | `getIncidentesAsGeoJSON`: params `onlyWithGeometry`, `onlyEnriched`; WHERE para OBRA. Ruta `/obras/nodos`: lee query y pasa esos params. |
| **src/components/map/NodeFiltersPanel.jsx** | Props y sección “Obras” con dos checkboxes (delimitación, detalle). |
| **src/components/map/popups/PopupObras.jsx** | `formatArcGISTimestamp`, `formatDisplayValue` (Código X), `PRIORITY_PATTERNS`, `buildDisplayFields` con prioridad y formato. |
| **docs/OBRAS_SATURACION_FIX.md** | Este documento: causa, cambios, archivos, comprobaciones. |

---

## 4) Comprobaciones

- **Carga /aforos:** Solo se ven puntos en la capa Obras (nunca líneas/polígonos masivos).
- **Click en obra:** Aparece una sola delimitación roja + desvíos + around; al cerrar popup desaparecen.
- **Request:** En Network, `GET /api/obras/nodos?...&geomMode=centroid`; en la respuesta, `features[].geometry.type === "Point"`.
- **Toggles:** “Solo obras con delimitación” y “Solo obras con detalle” reducen el conteo y la URL incluye `onlyWithGeometry=1` y/o `onlyEnriched=1`.
